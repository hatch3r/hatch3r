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
9. Apply pillar justification filter: every finding must trace to P1-P6
10. Classify owners: auto-fixable vs requires-human-review

## Phase 2 — Grouping

11. Allocate sub-agents per Phase 2: default 1 finding = 1 sub-agent; group only on same-file conflict (file-lock) or same-wave Depends On chain
12. Assign sub-agents to waves: Critical → Wave 1, High → Wave 2, Medium → Wave 3, Low → Wave 4
13. Verify completeness: every triaged finding assigned to exactly one sub-agent and wave; run Pre-Spawn Validation Gate

## Phase 3 — Wave Execution

For each wave (1 through 4):

14. Tag pre-wave state: `git tag audit-wave-{N}-pre`
15. Spawn ALL sub-agents for the wave in a single parallel dispatch (no concurrency cap); each sub-agent writes detailed results to `.audit-workspace/wave-{N}/{finding_id}.results.md`. Orchestrator reads only the wave SUMMARY.md per Context Management Protocol.
16. After all sub-agents complete, run **15-check regression gate** against Phase 0 baseline:
    - Tests, Typecheck, Lint, Build, Content validation, Git diff, Diff-backed status
    - Fix-Finding (SUMMARY.md scan), Governance, Governance weight, Anti-slop
    - Severity vocabulary, Governance currency, Doc accuracy, Cross-domain dedup
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

## Tracking

25. Update `governance/audit/finding-registry.json` throughout: finding status (pending → in_progress → resolved/deferred/rejected)
26. Update `governance/audit/execution-insights.json`: fix success rates, sizing accuracy, false positive rates
