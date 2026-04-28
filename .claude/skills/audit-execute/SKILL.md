---
name: audit-execute
description: Execute audit findings using the 4-wave progressive model with regression gates, finding registry tracking, and closed-loop phases.
effort: max
allowed-tools: Read Grep Glob Bash(*) Write Edit Agent WebSearch
---

# Audit Execute

Execute findings from an audit report using `governance/AUDIT-EXECUTE.md`.

## Pre-Execution

1. Read `governance/AUDIT-EXECUTE.md` fully — this is the authoritative execution protocol
2. Read the audit report: default `governance/AUDIT-REPORT.md`
3. Ask the user:
   - Finding exclusions (IDs to skip)
   - Scope constraints (specific domains or waves only)
   - Git strategy: single branch or branch-per-wave
   - Abort threshold (default: 2 consecutive gate failures)

## Phase 0 — Baseline

> **Workspace cleanup gate (audit-state hygiene v1).** Run `npm run audit:reset --check` before reading any audit state. If exit code is non-zero, run `npm run audit:reset --auto` to clear stale-cycle markers, or pass `--strict` for a clean-room baseline. The preserve list (`registry-anchor-log.jsonl`, `verified-inventory.json`, `current-insights.json`) is hard-coded.

4. Capture immutable baseline:
   ```
   npm test                  → record pass/fail counts
   npx tsc --noEmit          → record error count
   npm run lint              → record error count
   npm run build             → record pass/fail
   npx hatch3r validate      → record error count
   git rev-parse HEAD        → record commit SHA
   ```
5. Write baseline to `governance/audit/baseline.json`
6. Load `governance/audit/execution-insights.json` if exists (cross-cycle learning)

## Phase 1 — Enhanced Triage

7. Parse Enhanced Action Items from audit report
8. Run 4-tier deduplication: same file + same root cause + same fix → keep highest severity
9. Apply pillar justification filter: every finding must trace to P1-P7
10. Classify owners: auto-fixable vs requires-human-review

## Phase 2 — Tier Classification & Grouping

11. Classify each finding into `execution_tier` 1, 2, or 3 per `governance/AUDIT-EXECUTE.md` §Tier Classification:
    - Tier 1 (batch sub-agent) — Low/Info, effort=S, single-file, mechanical `tier1_pattern`, no file-lock conflict
    - Tier 2 (file-lock sub-agent) — ≥2 findings on same file
    - Tier 3 (dedicated sub-agent) — Critical/High always; everything else not Tier 1/2
12. Allocate sub-agents for all three tiers. Tier 1 findings group by `tier1_pattern` into batch sub-agents (≤30 findings per batch; spill into parallel batches if exceeded). Tier 2/3 follow file-lock and 1:1 rules. Assign to waves: Critical → Wave 1, High → Wave 2, Medium → Wave 3, Low → Wave 4
13. Verify completeness: every triaged finding has `execution_tier` set and a `work_unit`; run Pre-Spawn Validation Gate

## Phase 3 — Wave Execution

For each wave (1 through 4):

14. Tag pre-wave state: `git tag audit-wave-{N}-pre`
15. Spawn ALL sub-agents for the wave in a single parallel dispatch — Tier 1 batch sub-agents (per `governance/audit/templates/tier1-batch-sub-agent.md`), Tier 2 file-lock sub-agents, and Tier 3 dedicated sub-agents (both per `governance/audit/templates/implementation-sub-agent.md`). The orchestrator never edits files itself. Each sub-agent writes one results file per finding to `.audit-workspace/wave-{N}/{finding_id}.results.md`.
16. After all sub-agents complete, run **17-check regression gate** against Phase 0 baseline:
    - Tests, Typecheck, Lint, Build, Content validation, Git diff, Diff-backed status
    - Fix-Finding (SUMMARY.md scan), Governance, Governance weight, Anti-slop
    - Severity vocabulary, Governance currency, Doc accuracy, Cross-domain dedup
    - Triage-first (P7 invariant), Static-first ordering (P7 invariant)
17. On gate PASS: tag `audit-wave-{N}-post`, update finding-registry.json statuses, re-score domains
18. On gate FAIL: follow Gate Failure Protocol (targeted fix → L1 rollback → L2 rollback)

## Phase 4 — Final Review

19. Spawn reviewer sub-agent using template: `governance/audit/templates/reviewer-sub-agent.md`
20. 5-pass review: correctness, regressions, governance compliance, security, overall verdict
21. Verdict: SHIP, FIX-AND-SHIP, NEEDS-WORK, or REJECT

## Phases 5-7 — Closed Loop

22. **Phase 5 (PRD Update):** Filter CL-1 candidates by execution results. Apply approved changes to `governance/hatch3r-prd.md`
23. **Phase 6 (Content Spec):** Generate content specifications from CL-2 artifacts. Specs only — no implementation
24. **Phase 7 (Audit Evolution):** Apply CL-3 proposals individually. Each requires explicit user consent. Verify tier weight invariants after each

> **End-of-cycle archival (audit-state hygiene v1).** After Final Review approves the cycle, run `npm run audit:archive --in-place --cycle <N>`. This: (1) splits the live finding-registry into open + cycle {N, N-1} terminals + rollovers (kept) and older terminals (archived to `governance/audit/archive/cycle-{N}-finding-registry.json`); (2) updates `governance/audit/archive/index.json` with sha256 manifest entry; (3) promotes `.audit-workspace/current-insights.json` into `governance/audit/execution-insights.json::history[]` (oldest evicted at length 3); (4) rotates `registry-anchor-log.jsonl` keeping last 3 cycles. All writes atomic via `safeWrite.ts::atomicWriteFile`.

## Tracking

25. Update `governance/audit/finding-registry.json` throughout: finding status (pending → in_progress → resolved/deferred/rejected). Carry `execution_tier` and `tier1_pattern` from triage through to terminal status.
26. Update `governance/audit/execution-insights.json`: fix success rates, sizing accuracy, false positive rates, `tier1_mismatch_rate_by_pattern`
