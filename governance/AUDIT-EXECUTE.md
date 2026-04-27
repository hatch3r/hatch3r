# hatch3r — Audit Execution Prompt

> Last updated: 2026-04-21

## Purpose

Implement all agent-actionable findings from an audit report using a wave-based progressive execution model with regression gates between waves. This is the execution companion to `AUDIT.md` (audit prompt) and `AUDIT-REPORT.md` (audit report).

> **Path Convention:** All file paths in this document are relative to the **repository root**. Governance files live under `governance/`. The ephemeral `.audit-workspace/` directory is created at repository root.

```
Execution Flow:
  Baseline → Wave 1 (Critical) → Gate 1 → Wave 2 (High) → Gate 2 →
  Wave 3 (Medium) → Gate 3 → Wave 4 (Low) → Gate 4 → Final Review →
  Phase 5: PRD Update → Phase 6: Content Generation Planning →
  Phase 7: Audit Prompt Evolution (user consent required)
```

### Report Ingestion Strategy

Do NOT read `AUDIT-REPORT.md` in full. Read sections on-demand:
- **Phase 0:** Tier 1 + Tier 2 only (for baseline domain scores)
- **Phase 1:** Enhanced Action Items table only (for triage)
- **Phase 4:** Tier 3 sections relevant to current wave only (for sub-agents)
- **Phase 5:** PRD Evolution Candidates table + `governance/hatch3r-prd.md` + `governance/VISION.md` (if available)
- **Phase 6:** Content Gap Artifacts table + verified component inventory
- **Phase 7:** Audit Self-Evolution Proposals table + current `governance/AUDIT.md` + relevant domain files (`governance/audit/domains/`)
- **Report Update:** Only sections being modified

---

## Pre-Execution Protocol

Before spawning any sub-agents, ask the user:

1. **Exclusions** — Findings to skip, remove, or deprioritize?
2. **Scope** — All severity levels, or stop at a threshold?
3. **Constraints** — Project-specific context agents need.
4. **Wave granularity** — Full 4-wave or compressed 2-wave (Critical+High, Medium+Low)?
5. **Git strategy** — Wave-tagged commits or branch-per-wave?
6. **Abort threshold** — Consecutive gate failures before halt? Default: 2.

Apply exclusions immediately with rationale notes.

### Pre-Analysis

After user answers, before Phase 0 — automated, no user input required.

**B1. Conflict Detection** — Build file-to-findings map. Flag files touched by multiple findings.

**B2. Dependency Ordering** — Topological sort using `Depends On` column. Detect circular dependencies.

**B3. Effort Estimation** — Sum per-wave totals (S=0.5h, M=2h, L=4h, XL=8h).

**Pre-Analysis output:** Present conflict count, dependency chains, circular dependencies, and per-wave effort estimates. Wait for user acknowledgment before proceeding.

---

## Phase 0: Baseline Capture

Before any modifications, capture the immutable baseline. This is the comparison target for ALL regression gates. Never shift the baseline.

### Steps

1. **Run validation commands:**
   ```
   npm test              -> Record: total, passed, failed, skipped
   npx tsc --noEmit      -> Record: error count
   npm run lint           -> Record: warning count, error count
   npm run build          -> Record: success or failure
   npx hatch3r validate  -> Record: error count
   ```

2. **Record rollback target:** `git rev-parse HEAD` → store as `BASELINE_COMMIT`

3. **Record domain health scores:** Extract from Tier 2 — Domain Summaries (all audit domains).

4. **Store structured baseline:** Follow the schema in `governance/audit/baseline.json`. Capture: commit SHA, timestamp, test results (total/passed/failed/skipped), typecheck errors, lint warnings/errors, build status, content errors, and per-domain scores.

   **Finding counts with source labels.** Capture BOTH `preDedup` and `postDedup` blocks under `findingCounts`, each with an explicit `source` field. Also capture `cycleNResolved`, `cycleNTarget`, and `cycleNPlusRollover` blocks so Phase 1+ consumers never re-derive numbers. Schema:

   ```
   "findingCounts": {
     "preDedup":  { "source": "AUDIT-REPORT.md Tier 3 raw sub-agent output", "critical": N, "high": N, "medium": N, "low": N, "info": N, "total": N },
     "postDedup": { "source": "AUDIT-REPORT.md Executive Dashboard (after AUDIT.md §Deduplication Protocol)", "critical": N, "high": N, "medium": N, "low": N, "info": N, "total": N },
     "cycleNResolved":     { "source": "governance/audit/execution-insights.json cycle N", ... },
     "cycleNTarget":       { "source": "Phase 1 Triage output", ... },
     "cycleNPlusRollover": { "source": "Phase 1 Triage output, findings marked deferred", ... }
   }
   ```

   Phase 1 Triage MUST size the target set against `postDedup.total` (not `preDedup.total`). Phase 5/6/7 summaries MUST cite the `source` field when reporting counts. Backward compat: absent `source` on pre-existing Cycle 7 entries is treated as post-dedup Executive Dashboard.

Pre-existing failures are NOT regressions.

---

## Phase 1: Enhanced Triage

Parse every action item from the Enhanced Action Items table.

### Previous Cycle Insights

If `governance/audit/execution-insights.json` exists from a previous execution cycle, read it and apply adjustments:
- Use fix success rates to adjust work unit concurrency — unreliable finding types (high rolled-back rate) get serialized work units rather than parallel.
- Use sizing accuracy data to calibrate effort estimates — if a category consistently under-estimates, adjust upward.
- Flag recurring failure files as "high-risk" work units requiring extra review attention.

If the file does not exist (first cycle), skip this step.

### Table Completeness Validation

1. Read post-dedup finding count from Executive Dashboard
2. Count rows in Enhanced Action Items table
3. If row count ≈ post-dedup count (within 10%): PASS. If row count << post-dedup count: **HALT** — table was truncated.

### Owner Classification

| Status Value | Owner | Action |
|-------------|-------|--------|
| `Open` | Agent | Fully implementable by sub-agents |
| `Open (human-only)` | Human | Skip — requires human action |
| `**Done**` | Resolved | Verify, skip if confirmed |
| `Deferred (...)` | Deferred | Present to user for disposition |

Build three lists: Agent-implementable, Mixed, Human-only. Cross-reference Tier 3 for detailed descriptions, files, acceptance criteria, and `Depends On` references.

- **Rigor carry-forward.** Carry `confidence`, `causal_chain_depth`, and `sources` fields verbatim from each sub-agent finding into the registry per [audit/templates/rigor-contract.md](audit/templates/rigor-contract.md) §Required Finding Output Schema. Findings missing any of these fields are flagged for re-research before triage; do not assign placeholder values.

### Prior-Cycle Resolution Check

Before promoting any finding to `targeted`, cross-reference recent audit-cycle commits for keyword + file-reference matches:

1. Compute git log range: `git log --since="90 days ago" --pretty=format:"%H %s"` AND `git log --grep="audit: wave" --pretty=format:"%H %s"`. Require repo depth ≥90 days (shallow clones fail this check).
2. For each finding, search the range for: (a) the finding's primary file path (exact string), (b) the finding's title keywords (≥2 word-stem matches), (c) any prior finding ID referenced in the description (e.g., "H48", "CL-3 P3").
3. If a commit matches ≥2 of the above: re-read the finding description AND the matching commit diff.
   - If the commit already addresses the root cause → set `disposition: already_resolved`; skip execution.
   - If the commit addresses a symptom but leaves the root cause → keep `targeted`; add `rigor_note: "prior-cycle symptomatic fix at <commit_sha>; this cycle addresses root cause"` to the registry.
4. Log cross-check results to `.audit-workspace/phase1-prior-cycle-check.md`.

### Central-Path Classification

A finding is **central-path** if its primary modified file is one of: `src/cli/shared/ui.ts` (stdout/stderr routing), `src/cli/shared/errors.ts` or `src/cli/shared/HatchError*` (exit-code map), `src/pipeline/observability.ts` (log sinks), `src/merge/safeWrite.ts` (atomic-write contract), `src/integrity/*` (hash sinks), or any `src/pipeline/*` file cited by ≥3 other files as "contract".

Central-path findings MUST include this audit-test-fixtures acceptance criterion: *tests in `src/__tests__/**` spying on the old contract (e.g., `vi.spyOn(console, 'log')` for stdout, `vi.spyOn(console, 'error')` for stderr) either continue to assert the correct channel OR are explicitly updated by the fix sub-agent; central-path fixes MUST produce a net-positive test count on the specific channel assertion they change.* Flag the finding with `central_path: true` in the registry; Phase 4 reviewer Pass 1.5 uses this flag to require an explicit test-audit line in the results file.

### New Code Classification

When the audit report references code not present in the previous audit baseline (e.g., new workspace module in v1.3.0), classify findings as:
- **New Coverage:** Gap in newly written code. Normal priority.
- **Legacy Fix:** Bug in existing code. Normal priority.
- **Integration Gap:** Missing integration between new and existing code. Elevated priority — represents incomplete feature work.

### 4-Tier Deduplication

**Relationship to AUDIT.md dedup:** The audit already deduplicates (2-of-3 signal match). This phase performs second-pass dedup for near-duplicates that only become visible when grouping for execution. Focus on Tier 3-4 signals (semantic similarity, cross-domain near-duplicates). Do not re-apply the audit's dedup rules.

| Tier | Signal | Confidence | Default Action |
|------|--------|-----------|----------------|
| 1 | Exact file match | HIGH | Merge |
| 2 | Line range overlap in same file | HIGH | Merge |
| 3 | Semantically similar recommendations | MEDIUM | Group into one work unit |
| 4 | Cross-domain semantic near-duplicates | LOW | Keep both, same work unit |

Only merge Tier 3–4 when: root cause is identical, fix is identical, merge loses no severity/effort/attribution. Record all decisions in the Finding Registry.

#### Pillar Justification Filter
Every finding must cite at least one Binding Pillar (P1-P6) it serves. Findings serving zero pillars are rejected during triage as out-of-scope.

### Merge Strategy

- Keep highest severity, largest effort estimate
- Union all recommendations, cross-references, and source sub-agent IDs
- Log all merges for traceability

### Mixed Item Decomposition

For `Mixed` items, decompose into:
1. **Agent portion** — concrete, self-contained change
2. **Human portion** — what the agent cannot do
3. **Boundary** — agent work is complete without human part
4. **Completion criteria** — how to verify agent portion independently

Record decomposition in registry. Trivial agent portion → implement inline. Inseparable → reclassify as Human.

### Severity Bucket

| Severity | Wave | Priority |
|----------|------|----------|
| Critical | 1 | Security > correctness > blockers |
| High | 2 | Quality > competitiveness > UX |
| Medium | 3 | Benefit > optimization > consistency |
| Low | 4 | Polish > docs > cosmetic |

---

## Finding Registry

Central manifest tracking every finding through its lifecycle. Store as `governance/audit/finding-registry.json`. Update in-place per phase. Read full registry only at checkpoints. For wave execution, load only the current wave's entries. The file is the source of truth.

### Registry Fields

| Field | Set During | Description |
|-------|-----------|-------------|
| `finding_id` | Phase 1 | Unique identifier from Enhanced Action Items |
| `domain` | Phase 1 | Domain number and name |
| `severity` | Phase 1 | Critical / High / Medium / Low |
| `owner` | Phase 1 | Agent / Human / Mixed / Resolved / Deferred |
| `description` | Phase 1 | Action item description |
| `confidence` | Phase 1 | `high` / `medium` / `low`. Copied verbatim from sub-agent finding's rigor schema header per `governance/audit/templates/rigor-contract.md` §Required Finding Output Schema. Phase 1 Triage flags Low-confidence Critical/High findings for prioritised re-verification. |
| `causal_chain_depth` | Phase 1 | Integer ≥3. Count of `→` arrows in the sub-agent finding's `causal_chain` field. Used by reviewer Pass 1.5 (Fix-to-Finding Alignment) to verify the implementation addresses the root, not the symptom. |
| `sources` | Phase 1 | Array of `{url, accessed, author, trust_tier}` objects. Copied verbatim from sub-agent finding's `sources` block. Used by implementation-sub-agent freshness re-check (refetch URL before implementing; if 404, mark finding PARTIAL). |
| `dedup_action` | Phase 1 | `keep` / `merge_into:[id]` / `merged_from:[id]` |
| `dedup_tier` | Phase 1 | 1–4 |
| `dedup_rationale` | Phase 1 | Why the dedup decision was made |
| `disposition` | Phase 1 | `targeted` / `excluded` / `human_only` / `deferred` / `already_resolved` |
| `central_path` | Phase 1 | Boolean. `true` if the finding's primary file is central-path per §Central-Path Classification. When `true`, Phase 4 reviewer Pass 1.5 requires an explicit test-audit line in the results file. |
| `work_unit` | Phase 2 | `finding_id` when 1:1 (default). `"file-lock:<filename>"` when grouped by same-file rule. `"chain:<root_finding_id>"` when grouped by Depends On chain. |
| `wave` | Phase 2 | Wave number (1–4) |
| `sub_wave_batch` | Phase 2 | Batch number within wave. Vestigial since aggressive fan-out adoption — nullable for new registries, preserved for backward compatibility. |
| `execution_status` | Phase 4 | `pending` → `done` / `partial` / `failed` / `rolled_back` / `never_attempted` |
| `feature_status` | Phase 1 | 4-tuple `{implemented, wired, cli_registered, tested}` of booleans capturing the implementation stage of the artifact targeted by the finding. `implemented` = source file exists; `wired` = invoked from a parent module; `cli_registered` = reachable via a `src/cli/commands/` entry; `tested` = covered by a vitest case. Triage flags any finding where `implemented=true` but any later stage is `false` as an Integration Gap candidate. |
| `commit_sha` | Phase 4 | Git commit hash |
| `rollback_reason` | Phase 4 | Why rolled back (if applicable) |
| `rollback_level` | Phase 4 | 1 / 2 / 3 |
| `reviewer_verdict` | Final Review | PASS / PARTIAL / FAIL / REGRESSION / ROLLED-BACK. Tracked per-wave in execution telemetry, not per-finding. |
| `reviewer_notes` | Final Review | Per-finding notes |
| `false_positive` | Final Review | Boolean — reviewer flags findings that were incorrectly identified (fix revealed it was not an issue) |
| `cl1_status` | Phase 5 | `none` / `candidate` / `approved` / `applied` / `rejected` — tracks PRD evolution candidate lifecycle per finding |
| `sdr_status` | Phase 7 | `none` / `proposed` / `accepted` / `rejected` / `deferred` — tracks Strategic Decision Register entries linked to this finding |

### Invariants

These MUST hold at their respective checkpoints. Violation is a HALT condition.

1. **Completeness**: Every finding has exactly one registry entry.
2. **Dedup Linkage**: `merge_into` ↔ `merged_from` are bidirectionally linked.
3. **Assignment Coverage**: After Phase 2, every `targeted` finding has a `work_unit`.
4. **Wave Coverage**: After Phase 2, every `targeted` finding has a `wave`.
5. **Terminal Status**: After execution, no `targeted` finding remains `pending`.
6. **Registry Anchor**: After each Phase writes `governance/audit/finding-registry.json`, compute `sha256sum` and append `{phase, timestamp, sha256, entry_count}` to `.audit-workspace/registry-anchor-log.jsonl`. Before the next Phase, verify the current file's sha256 matches the last logged anchor. MISMATCH = HALT; present the diff between anchor-expected state (from git log of the registry file) and current state to the user for manual resolution. Same rule applies to `governance/audit/baseline.json` once Phase 0 writes it; baseline anchor is verified at every checkpoint. Rotate the log across cycles: keep the last 3 cycles' anchors, archive older.

### Checkpoints

| Checkpoint | Phase | Invariants | Key Metric |
|---|---|---|---|
| 1 | After triage | 1, 2 | disposition breakdown |
| 2 | After grouping | 3, 4 | orphaned = 0 |
| 3 | Each wave | — | per-status counts |
| 4 | Completion | 5 | coverage rate = (done + partial) / targeted |

---

## Phase 2: Sub-Agent Allocation

Default rule: **1 finding = 1 sub-agent**. No numeric concurrency cap. Concurrency is bounded only by Phase 3 file-lock serialization and dependency graph edges.

### Allocation Algorithm

1. If finding shares a primary modified file with any other in same wave → merge into the same sub-agent (file-lock group).
2. Else if finding has `Depends On: <id>` AND `<id>` is same wave → merge into the same sub-agent OR sequence them (see Phase 3).
3. Else → standalone sub-agent (1 finding = 1 work_unit = 1 sub-agent).

**Cross-wave constraint:** Sub-agents NEVER cross wave boundaries.

### Sizing Modes

| Mode | Findings per sub-agent | Trigger |
|------|------------------------|---------|
| Default (1:1) | 1 | No file/dep conflict |
| File-lock group | 2–N | ≥2 findings touch same file |
| Dependency chain | 2–N | Same-wave Depends On chain |

**Hard ceiling:** A sub-agent SHOULD handle ≤6 findings. If a file-lock group exceeds 6, split logically and serialize per Phase 3.

#### Governance Size Check
Flag any work unit that increases total governance line count. These require explicit justification that the added content serves a pillar and the net value exceeds the size cost.

### Completeness Gate

**Mandatory. Must pass before execution begins.**

After grouping, verify every targeted finding has a work unit assigned. If orphaned > 0: assign orphans, re-run gate. Repeat until orphaned = 0. Run Registry Checkpoint 2.

---

## Phase 3: Conflict Resolution & Serialization

### Same-File Serialization (MANDATORY)

Build a file map before dispatch:

```
file_map = {}
for finding in wave_findings:
  for file in finding.files:
    file_map[file].append(finding.id)
```

For each file with >1 finding: all findings touching that file MUST execute under one sub-agent (file-lock group), OR MUST be sequenced across separate sub-agents that share a `prereq_finding_id` and execute strictly serially. Default rule: merge into one sub-agent unless effort > L OR cross-domain (then sequence them; later sub-agent receives "rebase awareness" instruction to re-read the file post-prior-commit).

**Special-case rule for governance .md files:** If the shared file is `governance/*.md` or `governance/audit/**/*.md`, ALWAYS merge into one sub-agent regardless of effort. Rationale: prevents fragmented anti-slop and governance-weight gate failures from cumulative independent edits.

### Cross-Wave Conflicts

Later wave sub-agents MUST re-read every assigned file at execution time; never trust triage-time content.

### Dependency-Linked Conflicts

| Relationship | Resolution |
|-------------|------------|
| Same wave | Serialize — A completes before B starts |
| Different waves (A higher severity) | Natural ordering |
| Different waves (A lower severity) | Promote A to B's wave, or defer B |

### Pre-Spawn Validation Gate

Before orchestrator dispatches a wave fan-out, verify: (1) file_map shows no file appears in two distinct concurrent sub-agents; (2) dependency_graph shows no edge crosses concurrent sub-agents. If either violated, HALT and re-run Phase 2 allocation.

### Post-Wave Merge Window

After each wave, before regression gate: review changes for consistency, resolve merge conflicts between work units, verify no overwrites, stage all changes. Per-finding result-file synthesis (see Context Management Protocol) happens here too.

---

## Phase 4: Execution Waves

Execute findings in severity-based waves. Each wave is atomic: passes its gate and is retained, or fails and is rolled back.

### Wave Parameters

| Wave | Severity | Findings | Sub-Agents (typical = findings minus file-locks) | Priority | Tag |
|------|----------|----------|--------------------------------------------------|----------|-----|
| 1 | Critical | 5–15 | 5–15 | Security > correctness > blockers | `audit-wave-1-critical` |
| 2 | High | 15–30 | 15–60 | Quality > competitiveness > UX | `audit-wave-2-high` |
| 3 | Medium | 30–50 | 25–50 | Benefit > optimization > consistency | `audit-wave-3-medium` |
| 4 | Low + systemic patterns | 15–25 | 12–25 | Polish > docs > cosmetic; D16 cross-domain pattern findings (any severity) execute here regardless of bucket | `audit-wave-4-systemic` |

**Wave 4 systemic-pattern allocation:** D16 findings flagged as cross-domain patterns (spanning 3+ domains, per the Deduplication Protocol's qualification rule in `governance/AUDIT.md`) are routed to Wave 4 even when their severity would otherwise place them in Wave 1–3. Rationale: systemic fixes touch multiple files across domains and benefit from Wave 1–3 stabilizing the per-domain code first. Cycle 7 produced 3 D16 Highs spanning 5+ domains each.

**Empty Wave Protocol:** If a wave has 0 targeted findings after triage (e.g., 0 Critical findings), skip the wave entirely. Log: "Wave N ([Severity]): 0 targeted findings — skipped." Proceed to next wave. Do not run a regression gate for empty waves.

### Wave Fan-Out

Orchestrator spawns ALL sub-agents for the wave in a single parallel dispatch (one Agent tool call per sub-agent, batched in one message). No numeric concurrency cap. Concurrency is bounded only by Phase 3 file-lock serialization and dependency graph edges. Mirror the AUDIT.md precedent: 60 concurrent sub-agents is normal. Context discipline preserved by file-based output (see Context Management Protocol below).

### Per-Wave Execution Flow

```
1.  Record pre-wave commit: git rev-parse HEAD → PRE_WAVE_COMMIT
2.  Spawn sub-agents per Wave Fan-Out (single parallel dispatch). Each sub-agent writes results to `.audit-workspace/wave-{N}/{finding_id}.results.md`.
3.  Wait for all sub-agents to report completion (file presence + summary line).
3a. If `.audit-workspace/wave-{N}/*.results.md` count is less than spawned sub-agent count, identify missing finding_ids, mark each as `failed` with reason "no result file", do NOT block the gate.
3b. Diff-Backed Status Verification (MANDATORY). For each finding whose `{id}.results.md` reports Status `done` or `partial`: parse the `Files modified:` line; run `git diff --name-only PRE_WAVE_COMMIT..HEAD -- <claimed_files>`; if any claimed-modified file returns empty, downgrade status to `rolled_back` with `rollback_reason: "concurrent-edit clobber — result file claim not in wave diff"` and re-dispatch in an isolated retry batch (no other same-file finding concurrent, max 1 retry; beyond that mark `failed`).
4.  Update Finding Registry (status, commit_sha, duration). Run Checkpoint 3.
5.  Post-wave merge window: resolve conflicts, verify no overwrites
6.  Stage: git add [modified files]
7.  Commit: git commit -m "audit: wave N -- [severity] findings"
8.  Run regression gate
9.  If gate passes: calculate domain re-scores, proceed to next wave
10. If gate fails: execute gate failure protocol, update registry
11. Synthesis gate: read only `.audit-workspace/wave-{N}/SUMMARY.md` (orchestrator-built index of one-line per-finding statuses). Discard per-finding result files from context. Retain wave summary only for Final Reviewer input.
```

Prioritize within wave: dependency-first, then impact-to-effort ratio, then security before cosmetic.

---

## Context Management Protocol

Mirrors the AUDIT.md fan-out pattern. Sub-agents write detailed results to disk; orchestrator main-context retains only summaries.

### Sub-Agent Output Contract

Every implementation sub-agent MUST write to:
`.audit-workspace/wave-{N}/{finding_id}.results.md`

Schema:
```
## Finding {finding_id}
- Status: done | partial | failed
- Files modified: [list]
- Commit-ready: yes | no
- Rigor re-check: fresh | stale (PARTIAL)
- Causal chain addressed: yes (depth N) | no
- Notes: [≤3 sentences]
```

Sub-agent's chat reply to orchestrator: ONE line — `"Finding {id}: {status} → .audit-workspace/wave-{N}/{id}.results.md"`. No diffs, file contents, or explanations in chat.

### Orchestrator Synthesis

After fan-out completes:
1. Read all `.audit-workspace/wave-{N}/*.results.md`.
2. Build `SUMMARY.md`: `finding_id | status | files | one-line note` (one row per finding).
3. Update Finding Registry from `SUMMARY.md` only.
4. Pass `SUMMARY.md` (NOT individual results) to regression gate analysis.
5. After wave commits, retain `SUMMARY.md` for Final Reviewer; release individual result files from context.

### Workspace Lifecycle

`.audit-workspace/` is created at Phase 0, retained through Final Review for traceability, deleted only after Report Update Protocol completes successfully. Add `.audit-workspace/` to `.gitignore` if not already present. The registry anchor log (`.audit-workspace/registry-anchor-log.jsonl`, per Invariant 6) follows the same .gitignore rule.

---

## Regression Gates

After each wave commit, run 17-check gate comparing against Phase 0 baseline (NOT a shifted baseline).

### Gate Checks

| Check | Command / Signal | FAIL if |
|-------|------------------|---------|
| Tests | `npm test` | Any NEW test failure vs baseline |
| Typecheck | `npx tsc --noEmit` | Any NEW type error vs baseline |
| Lint | `npm run lint` | Any NEW lint error vs baseline |
| Build | `npm run build` | Fails AND baseline succeeded |
| Content | `npx hatch3r validate` | Content structure / cross-ref errors introduced |
| Diff | `git diff --stat BASELINE..HEAD` | Unintended mods, binaries, or credentials |
| Diff-backed status | `git diff --name-only PRE_WAVE..HEAD` vs `SUMMARY.md` | Any `done` finding has zero claimed files in the wave diff |
| Fix-Finding | Per-finding `SUMMARY.md` row | Row missing or `Causal chain addressed: no` (full alignment = Final Reviewer Pass 1.5) |
| Governance | Modified `.md` in `commands/`, `agents/`, `skills/` vs pre-wave | Lost ASK checkpoint, quality-gate reference, or sub-agent delegation pattern |
| Governance weight | `wc -l` on modified governance `.md` | Any file exceeds its CONSTITUTION.md §2 P5 threshold |
| Anti-slop | Two-pass wordlist scan (CONSTITUTION.md §2 P5) | Hits lacking a measurable qualifier within 8 words |
| Severity Vocab | grep across modified `.md` in `agents/`, `checks/`, `governance/` | Off-canonical severity term without mapping reference |
| Governance currency | `> Last updated: YYYY-MM-DD` on modified EVOLVE-in-scope files | Header missing or older than commit date |
| Doc accuracy | Documented counts vs filesystem actuals | Any stated count diverges from `ls` / `find` |
| Cross-domain dedup | Current-wave findings vs remaining-wave findings | Same root cause + file not merged during Phase 1 dedup |
| 16. Triage-first | `tsx scripts/validate-efficiency-invariants.ts --triage-first` | Any `orchestrator: true` command lacks `triage_tiers` array OR a triage step in body |
| 17. Static-first ordering | `tsx scripts/validate-efficiency-invariants.ts --static-first` | Any orchestrator command or agent places volatile token (timestamp, run-ID, session-counter) above the role/system block |

> Gates 16 and 17 hard-exempt the audit-cycle file list: `governance/AUDIT.md`, `governance/AUDIT-EXECUTE.md`, `governance/RE-ENVISION.md`, and `commands/hatch3r-audit*.md`. The validator script `scripts/validate-efficiency-invariants.ts` enforces this exemption — depth in the audit cycle is non-negotiable per pillar P7.

Report each check PASS/FAIL with baseline delta. Overall PASS = all checks pass. On FAIL: name the check, the delta, and whether it is a true regression or a pre-existing baseline condition.

### Gate Failure Protocol

| Attempt | Action | If fails |
|---------|--------|----------|
| 1 | Targeted fix sub-agent for failing work unit | → Attempt 2 |
| 2 | Level 1 rollback (failing unit's files only) | → Attempt 3 |
| 3 | Level 2 rollback (entire wave) | Mark wave FAILED, next wave |

**Abort threshold:** Consecutive gate failures reaching threshold (default: 2) halts execution.

### Never-Attempted Manifest

When execution halts early, before Final Review:
1. Set remaining `pending` entries to `never_attempted`
2. Produce manifest grouped by wave: Finding ID, Domain, Description, Effort
3. Include in Final Review input and Report Update

---

## Domain Re-Scoring

After each wave gate passes:

```
weighted_resolved = SUM(severity_weight[f] for f in resolved_findings_in_domain)
weighted_total = SUM(severity_weight[f] for f in all_findings_in_domain)
new_score = baseline_score + (weighted_resolved / weighted_total) * (100 - baseline_score) * 0.8

Where severity_weight: Critical=25, High=10, Medium=3, Low=1 (matching AUDIT.md quality score formula)
```

Where `resolved_findings_in_domain` = findings resolved across all completed waves for this domain, `all_findings_in_domain` = total findings in domain, `0.8` = diminishing returns factor. This ensures resolving a Critical finding improves the score more than resolving a Low finding.

Flag any domain whose score decreased — indicates cross-domain side effects.

---

## Rollback Protocols

| Level | Scope | Command | When | Post-Action |
|-------|-------|---------|------|-------------|
| 1 | Work unit files | `git checkout <PRE_WAVE> -- <files>` | Single unit fails OR multiple units fail with no dependency chain (apply per-unit) | Re-run gate, recommit rest |
| 2 | Full wave | `git reset --soft <PRE_WAVE>` | Multiple units fail with shared dependencies; OR gate fails after Level 1 attempt; OR gate fails after Level 2 (then halt wave, proceed to next) | Inspect, unstage, discard |
| 3 | All changes | `git reset --hard <BASELINE>` | Abort threshold reached AND no successful waves exist. **USER CONFIRM required within 5 minutes.** If no response: keep successful waves, halt remaining. Log timeout and default action. If abort threshold reached with successful waves present, keep them and halt instead of escalating to Level 3. | — |

---

## Sub-Agent Instructions

### Implementation Sub-Agents

Read and adapt `governance/audit/templates/implementation-sub-agent.md` for each work unit. Replace placeholders (`[Wave]`, `[Work Unit]`, `[findings]`) with registry values.

### Final Reviewer

Spawn after all waves complete (or after halt). **Mandatory — must not be skipped.**

Read `governance/audit/templates/reviewer-sub-agent.md`. Pass: Finding Registry, wave re-scores, Never-Attempted Manifest.

### SHIP Gate

The reviewer emits one of four verdicts at Final Review, based on registry + regression-gate state. Pass 0 = PASS means the Completeness Invariant holds (every targeted finding has terminal status, no orphans).

| Verdict | Criteria |
|---------|----------|
| SHIP | Pass 0 = PASS. All targeted findings terminal-status `done`. All regression gates PASS. Zero `failed` / `rolled_back`. All `never_attempted` findings explicitly acknowledged. |
| FIX-AND-SHIP | Pass 0 = PASS. ≥1 `partial` BUT 0 `failed` AND 0 `rolled_back`. Remaining work has explicit Cycle N+1 rollover entries in registry. All regression gates PASS. |
| PARTIAL-SHIP | Pass 0 = PASS. Cycle is explicitly scoped as partial (e.g., "40 of 224 rolled-over Mediums" for Cycle 8). All targeted findings terminal-status; untargeted remainder documented in a rollover umbrella finding. All regression gates PASS. |
| BLOCK | Pass 0 = FAIL (≥1 orphaned) OR ≥1 `failed` without documented cause OR ≥1 regression gate FAIL. |

PARTIAL-SHIP differs from FIX-AND-SHIP: PARTIAL-SHIP cycles explicitly do not claim full coverage of the audit report's findings — only the user-scoped subset. FIX-AND-SHIP or BLOCK: spawn targeted fix sub-agents. Max 2 fix-review cycles. If BLOCK after 2 cycles: halt, escalate. PARTIAL-SHIP proceeds to Phases 5/6/7 as normal; the remainder umbrella finding feeds the next cycle's triage.

### False Positive Detection

The final reviewer should flag findings where the implementation revealed that the finding was incorrectly identified — the reported issue did not actually exist, or the recommended fix was inapplicable. Set the `false_positive` field to `true` in the registry for these findings.

Track false positive rate per domain: `false_positives_in_domain / total_findings_in_domain`. Domains with false positive rates exceeding 15% should receive CL-3 evolution proposals targeting their checklist precision. Include per-domain false positive rates in the Execution Telemetry.

---

### Closed-Loop Phases 5–7

| Phase | Trigger | Prerequisite | Constraints | Agent Template |
|-------|---------|--------------|-------------|----------------|
| 5: PRD Update | CL-1 produced PRD Evolution Candidates AND user approved closed-loop execution | All execution waves complete; candidate findings not failed/rolled-back | Do not restructure PRD; individual approval for Vision Review items; skip if no candidates survive filtering | `governance/audit/templates/closed-loop-agents.md` Phase 5 |
| 6: Content Generation Planning | CL-2 produced Content Gap Artifacts AND user approved closed-loop execution | Phase 5 complete (PRD up-to-date for spec alignment) | Specs only — do not implement content; follow existing conventions; P1 specs must include acceptance criteria | `governance/audit/templates/closed-loop-agents.md` Phase 6 |
| 7: Audit Prompt Evolution | CL-3 produced Audit Self-Evolution Proposals AND user approved closed-loop execution | Phase 6 complete | Maximum 10 proposals per cycle; per-proposal user consent required; Guardrail 3 (no self-modification) is suspended only for this phase; commit each accepted proposal separately | `governance/audit/templates/closed-loop-agents.md` Phase 7 |

**Phase 5 execution logic:** Filter candidates whose source findings have `execution_status: "failed"` or `rollback_level: not null`; present remaining for batch approval (Vision Review items individually); apply approved changes to `governance/hatch3r-prd.md`; update PRD version, date, changelog; commit separately from execution wave commits.

**Phase 6 execution logic:** Priority filter — P1 (full specs for artifacts blocking user success), P2 (outline specs for quality improvements), P3 (list only for nice-to-haves); scan existing content for conventions, frontmatter patterns, naming standards; output to `.audit-workspace/content-specs/` organized by priority tier. User-content adoption signals (frequently re-authored project-local artifacts surfaced via D20.2 findings, ≥3 instances across cycles) flow into Phase 6 as P2 promotion candidates: a project-local pattern that ≥3 user projects independently re-implement is a Content Gap signal that should be specced as a canonical artifact.

**Phase 7 execution logic:** Present each proposal individually to user (never batch-approve); for accepted proposals, apply changes to AUDIT.md and/or domain files; run invariant checks after each accepted proposal — Tier weight totals (A=0.308, B=0.348, C=0.266 split across D11–D16+D20 at 0.038 each, D=0.078), sub-agent count consistency between AUDIT.md summary table and domain files, all domain file references in AUDIT.md have corresponding files.

---

## Report Update Protocol

After reviewer verdict, spawn a **Report Update Agent**. It receives: Finding Registry, reviewer verdict, domain re-scores, Never-Attempted Manifest, execution telemetry.

Self-check: count status markers in updated report and verify they match registry counts. Fix discrepancies before completing.

### Update Steps

1. **Update Tier 2 — Domain Summaries:** Health scores, finding counts, replace resolved top-3 findings, add resolution notes.

2. **Update Tier 3 — Domain Detail:** Add `Status` column. Mark: `**Done**`, `PARTIAL`, `ROLLED-BACK`. Unresolved remains unmarked. Must be consistent with Enhanced Action Items.

3. **Update Enhanced Action Items:** Mark: `DONE`, `PARTIAL`, `OPEN` (with failure reason), `ROLLED-BACK` (with wave and reason). Recalculate remaining effort in Blockers/Should-Have/Deferred sections.

4. **Update Executive Dashboard:** Update overall score, score band, domain heatmap, top-3 strengths/issues, and holistic assessment to reflect post-execution state.

5. **Update Delta Since Previous Audit:** Resolution statistics, wave-level breakdown, updated open count.

6. **Add Execution Log:** Append to Audit History table.

7. **Add PRD Update Summary** (if Phase 5 ran): List approved PRD changes with section references and audit finding traceability.

8. **Add Content Generation Plan Summary** (if Phase 6 ran): Count of P1/P2/P3 specs produced, location of spec files.

9. **Add Audit Evolution Summary** (if Phase 7 ran): List of accepted/rejected proposals with rationale.

10. **Present Summary:**

**Report update format:** Update each section below in AUDIT-REPORT.md. Use the domain health table and execution telemetry as data sources.

---

## Execution Telemetry

Record after full execution. Fields: total_time, waves_completed/N, waves_rolled_back, work_units_executed, sub_agents_spawned {implementation, fix, reviewer}, gate_results {gate_N: PASS/FAIL with attempts}, rollbacks {L1, L2, L3}, domain_score_delta {improved(avg+X), unchanged, regressed}, finding_resolution_rate (N/N, X%), closed_loop {phase5, phase6, phase7 — each: ran/skipped + counts}.

**Per-Finding Resolution Log columns:** `Finding | Domain | Severity | Work Unit | Wave | Batch | Status | Duration | Commit | Notes`.

**Rollback Detail Log columns:** `Event | Wave | Level | Trigger | Work Unit | Findings Affected | Resolution`.

**File-Lock Group Telemetry** (per Phase 2 sizing): Append to `governance/audit/execution-insights.json` under `file_lock_groups`: `[{wave, file, size, ceiling_hit, retries, rolled_back, cycle}]`. Calibration: if ≥2 size=6 groups show ≥1 retry each across one cycle → consider ceiling reduction to 5 via CL-3; if zero size=6 retries across 3 cycles → consider lift to 7.

---

## Execution Learning

After each complete execution cycle, produce an Execution Insights summary to inform the next cycle's triage and planning. This creates a compounding knowledge loop where each cycle improves the next.

### Tracked Patterns

1. **Fix success rate by finding type:** Categorize findings as code/content/config/documentation and track first-attempt vs retry vs rolled-back rates per category to surface which types need different execution strategies.
2. **Work unit sizing accuracy:** Compare audit-report effort (S/M/L/XL) against actual execution duration to flag systematic over-estimates (wasted parallelism) or under-estimates (cascading delays).
3. **Recurring failure patterns:** Flag any file/module causing rollbacks across multiple cycles as a structural issue requiring architectural intervention rather than incremental fixes.
4. **Fix-type effectiveness:** Track which approaches (refactor, add validation, update content, restructure architecture, add tests) have the highest first-attempt success rates to guide future fix strategy selection.
5. **False positive patterns:** Aggregate reviewer false-positive data across cycles to identify domain-level patterns (e.g., "D9 adapter findings frequently turn out to be intentional platform differences").

### Output

Write to `governance/audit/execution-insights.json` (persistent — survives across audit cycles):

```json
{
  "cycle_date": "YYYY-MM-DD",
  "fix_success_rate": {
    "code": { "first_attempt": 0, "retry": 0, "rolled_back": 0 },
    "content": { "first_attempt": 0, "retry": 0, "rolled_back": 0 },
    "config": { "first_attempt": 0, "retry": 0, "rolled_back": 0 },
    "docs": { "first_attempt": 0, "retry": 0, "rolled_back": 0 }
  },
  "sizing_accuracy": {
    "over_estimated": 0,
    "under_estimated": 0,
    "accurate": 0
  },
  "recurring_failures": [],
  "false_positive_rate_by_domain": {},
  "top_insights": []
}
```

### Consumption

See Phase 1 "Previous Cycle Insights" for adjustment rules.

---

## Guardrails

1. **Do not fabricate findings.** Only implement items from the audit report.
2. **Do not skip the reviewer.** Final reviewer sub-agent is mandatory.
3. **Do not modify the audit prompt during waves.** `AUDIT.md` is read-only during Phases 0-4 and Final Review. Phase 7 (Audit Prompt Evolution) is the sole exception, and requires per-proposal user consent.
4. **Preserve report structure.** Maintain existing markdown format and section numbering.
5. **Respect user exclusions.**
6. **Never skip regression gates.** Every wave must pass its gate. No exceptions.
7. **Never cross wave boundaries.** Work units belong to exactly one wave.
8. **Always execute rollbacks.** Actually perform git operations — do not just mark as rolled back.
9. **Preserve wave commits.** No squashing during execution.
10. **Baseline is immutable.** Always compare against Phase 0, not a progressive baseline.
11. **Every finding must be registered.** No processing without a registry entry. Every targeted finding must reach a terminal status.
12. **Registry checkpoints are mandatory.** Checkpoint failure is a HALT condition.
13. **Completeness Gate is blocking.** Phase 2 gate must pass (orphaned = 0) before execution.
14. **PRD changes require user approval.** Phase 5 must present all PRD change candidates for user selection before applying.
15. **Content specs are specifications, not implementations.** Phase 6 produces specs only. Actual content creation is a separate task.
16. **Audit evolution requires per-proposal consent.** Phase 7 must present each proposal individually. No batch approval for audit infrastructure changes.

---

## Execution History

| Date | Report Version | Waves | Findings Targeted | Resolved | Partial | Failed | Rolled Back | Never Attempted | Duration | Resolution Rate | Remaining Human | PRD Updates | Content Specs | Audit Evolution |
|------|---------------|-------|-------------------|----------|---------|--------|-------------|-----------------|----------|-----------------|-----------------|-------------|---------------|-----------------|
| 2026-03-05 | v3 (80/100) | 4/4 | 36 | 36 | 0 | 0 | 0 | 0 | -- | 100% | 4 (#3, #4, #5, #6) | -- | -- | -- |
| 2026-03-05 | v4 (82/100) | 4/4 | 31 | 30 | 1 | 0 | 0 | 0 | -- | 97% | 4 (#1, #2, #3, #4) | -- | -- | -- |
| 2026-04-19 | Cycle 7 (39/100 post) | 4/4 | 22 | 21 | 1 | 0 | 0 | 0 | -- | 100% | 1 (C7-H16 marketplace PR) | 10 (PRD v4.1→v4.2) | P1: 4, P2: 2, P3: 1 | 10/10 accepted |
