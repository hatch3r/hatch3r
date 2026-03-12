# hatch3r — Audit Execution Prompt

## Purpose

Implement all agent-actionable findings from an audit report using a wave-based progressive execution model with regression gates between waves. This is the execution companion to `AUDIT.md` (audit prompt) and `AUDIT-REPORT.md` (audit report).

```
Execution Flow:
  Baseline → Wave 1 (Critical) → Gate 1 → Wave 2 (High) → Gate 2 →
  Wave 3 (Medium) → Gate 3 → Wave 4 (Low) → Gate 4 → Final Review
```

### Report Ingestion Strategy

Do NOT read `AUDIT-REPORT.md` in full. Read sections on-demand:
- **Phase 0:** Tier 1 + Tier 2 only (for baseline domain scores)
- **Phase 1:** Enhanced Action Items table only (for triage)
- **Phase 4:** Tier 3 sections relevant to current wave only (for sub-agents)
- **Report Update:** Only sections being modified

---

## Pre-Execution Protocol

Before spawning any sub-agents, ask the user:

1. **Report path** — Confirm `AUDIT-REPORT.md` or provide alternative.
2. **Exclusions** — Findings to skip, remove, or deprioritize?
3. **Scope** — All severity levels, or stop at a threshold?
4. **Constraints** — Project-specific context agents need.
5. **Model inheritance** — Confirm sub-agents inherit current model.
6. **Wave granularity** — Full 4-wave or compressed 2-wave (Critical+High, Medium+Low)?
7. **Git strategy** — Wave-tagged commits or branch-per-wave?
8. **Abort threshold** — Consecutive gate failures before halt? Default: 2.

Apply exclusions immediately with rationale notes.

### Pre-Analysis

After user answers, before Phase 0 — automated, no user input required.

**B1. Conflict Detection** — Build file-to-findings map. Flag files touched by multiple findings.

**B2. Dependency Ordering** — Topological sort using `Depends On` column. Detect circular dependencies.

**B3. Effort Estimation** — Sum per-wave totals (S=0.5h, M=2h, L=4h, XL=8h).

Present results and wait for user acknowledgment:

```
## Pre-Analysis Results

Files with potential conflicts: N
  [file path]: Finding #X (Severity), Finding #Y (Severity), ...

Dependency chains: N
  Finding #X -> Finding #Y -> Finding #Z

Circular dependencies: N (must be resolved before execution)

Estimated effort per wave:
  Wave 1 (Critical): ~X hours (N findings)
  Wave 2 (High):     ~X hours (N findings)
  Wave 3 (Medium):   ~X hours (N findings)
  Wave 4 (Low):      ~X hours (N findings)
  Total:             ~X hours (N findings)
```

---

## Phase 0: Baseline Capture

Before any modifications, capture the immutable baseline. This is the comparison target for ALL regression gates. Never shift the baseline.

### Steps

1. **Run validation commands:**
   ```
   npm test           -> Record: total, passed, failed, skipped
   npx tsc --noEmit   -> Record: error count
   npm run lint        -> Record: warning count, error count
   npm run build       -> Record: success or failure
   ```

2. **Record rollback target:** `git rev-parse HEAD` → store as `BASELINE_COMMIT`

3. **Record domain health scores:** Extract from Tier 2 — Domain Summaries (D1–D18).

4. **Store structured baseline:**
   ```json
   {
     "commit": "BASELINE_COMMIT",
     "timestamp": "ISO-8601",
     "tests": { "total": 0, "passed": 0, "failed": 0, "skipped": 0 },
     "typecheck": { "errors": 0 },
     "lint": { "errors": 0, "warnings": 0 },
     "build": "pass",
     "domainScores": { "D1": 0, "D2": 0, "...": "...", "D18": 0 }
   }
   ```

Pre-existing failures are NOT regressions.

---

## Phase 1: Enhanced Triage

Parse every action item from the Enhanced Action Items table.

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

### 4-Tier Deduplication

| Tier | Signal | Confidence | Default Action |
|------|--------|-----------|----------------|
| 1 | Exact file match | HIGH | Merge |
| 2 | Line range overlap in same file | HIGH | Merge |
| 3 | Semantically similar recommendations | MEDIUM | Group into one work unit |
| 4 | Cross-domain semantic near-duplicates | LOW | Keep both, same work unit |

Only merge Tier 3–4 when: root cause is identical, fix is identical, merge loses no severity/effort/attribution. Record all decisions in the Finding Registry.

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

Record in registry under `mixed_decomposition`. Trivial agent portion → implement inline. Inseparable → reclassify as Human.

### Severity Bucket

| Severity | Wave | Priority |
|----------|------|----------|
| Critical | 1 | Security > correctness > blockers |
| High | 2 | Quality > competitiveness > UX |
| Medium | 3 | Benefit > optimization > consistency |
| Low | 4 | Polish > docs > cosmetic |

---

## Finding Registry

Central manifest tracking every finding through its lifecycle. Store as `finding-registry.json`. Update in-place per phase. Read full registry only at checkpoints. For wave execution, load only the current wave's entries. The file is the source of truth.

### Registry Fields

| Field | Set During | Description |
|-------|-----------|-------------|
| `finding_id` | Phase 1 | Unique identifier from Enhanced Action Items |
| `domain` | Phase 1 | Domain number and name |
| `severity` | Phase 1 | Critical / High / Medium / Low |
| `owner` | Phase 1 | Agent / Human / Mixed / Resolved / Deferred |
| `description` | Phase 1 | Action item description |
| `dedup_action` | Phase 1 | `keep` / `merge_into:[id]` / `merged_from:[id]` |
| `dedup_tier` | Phase 1 | 1–4 |
| `dedup_rationale` | Phase 1 | Why the dedup decision was made |
| `mixed_decomposition` | Phase 1 | Agent/human portions, boundary, criteria (Mixed only) |
| `disposition` | Phase 1 | `targeted` / `excluded` / `human_only` / `deferred` / `already_resolved` |
| `work_unit` | Phase 2 | Work unit name |
| `wave` | Phase 2 | Wave number (1–4) |
| `sub_wave_batch` | Phase 2 | Batch number within wave |
| `execution_status` | Phase 4 | `pending` → `done` / `partial` / `failed` / `rolled_back` / `never_attempted` |
| `commit_sha` | Phase 4 | Git commit hash |
| `execution_duration` | Phase 4 | Time taken |
| `rollback_reason` | Phase 4 | Why rolled back (if applicable) |
| `rollback_level` | Phase 4 | 1 / 2 / 3 |
| `reviewer_verdict` | Final Review | PASS / PARTIAL / FAIL / REGRESSION / ROLLED-BACK |
| `reviewer_notes` | Final Review | Per-finding notes |

### Invariants

These MUST hold at their respective checkpoints. Violation is a HALT condition.

1. **Completeness**: Every finding has exactly one registry entry.
2. **Dedup Linkage**: `merge_into` ↔ `merged_from` are bidirectionally linked.
3. **Assignment Coverage**: After Phase 2, every `targeted` finding has a `work_unit`.
4. **Wave Coverage**: After Phase 2, every `targeted` finding has a `wave`.
5. **Terminal Status**: After execution, no `targeted` finding remains `pending`.

### Checkpoints

| Checkpoint | Phase | Invariants | Key Metric |
|---|---|---|---|
| 1 | After triage | 1, 2 | disposition breakdown |
| 2 | After grouping | 3, 4 | orphaned = 0 |
| 3 | Each wave | — | per-status counts |
| 4 | Completion | 5 | coverage rate = (done + partial) / targeted |

---

## Phase 2: Advanced Grouping

Cluster related items into **work units** using six dimensions: file proximity, domain affinity, dependency chain, semantic similarity, risk level, wave assignment.

### Sizing Constraints

| Constraint | Value |
|------------|-------|
| Minimum | 1 finding per work unit |
| Maximum | 10 findings per work unit |
| Target | 3–6 findings per work unit |

### Grouping Rules

- **Adapter rule:** Group by adapter (one work unit per adapter), not by finding type.
- **Content rule:** Group by content type (agents, rules, commands, skills).
- **Security rule:** Group by attack surface, not by severity.
- **Cross-wave constraint:** Work units NEVER cross wave boundaries.

### Completeness Gate

**Mandatory. Must pass before execution begins.**

After grouping, verify every targeted finding has a work unit assigned. If orphaned > 0: assign orphans, re-run gate. Repeat until orphaned = 0. Run Registry Checkpoint 2.

---

## Phase 3: Conflict Resolution Planning

### Same-Wave Conflicts

Multiple findings in same wave touching same file: (1) Preferred: assign to same work unit. (2) Alternative: serialize work units within wave.

### Cross-Wave Conflicts

Later wave's sub-agent must re-read files at execution time, not rely on triage state. Include "file changed in previous wave" awareness in sub-agent prompt.

### Dependency-Linked Conflicts

| Relationship | Resolution |
|-------------|------------|
| Same wave | Serialize — A completes before B starts |
| Different waves (A higher severity) | Natural ordering |
| Different waves (A lower severity) | Promote A to B's wave, or defer B |

### Post-Wave Merge Window

After each wave, before regression gate: review changes for consistency, resolve merge conflicts between work units, verify no overwrites, stage all changes.

---

## Phase 4: Execution Waves

Execute findings in severity-based waves. Each wave is atomic: passes its gate and is retained, or fails and is rolled back.

### Wave Parameters

| Wave | Severity | Findings | Work Units | Concurrency | Priority | Tag |
|------|----------|----------|------------|-------------|----------|-----|
| 1 | Critical | 5–15 | 2–5 | 4–6 | Security > correctness > blockers | `audit-wave-1-critical` |
| 2 | High | 15–30 | 5–10 | 6–8 | Quality > competitiveness > UX | `audit-wave-2-high` |
| 3 | Medium | 30–50 | 8–15 | 6–8 | Benefit > optimization > consistency | `audit-wave-3-medium` |
| 4 | Low | 15–25 | 5–10 | 4–6 | Polish > docs > cosmetic | `audit-wave-4-low` |

### Sub-Wave Batching

When work units exceed concurrency limit: sort by priority, divide into batches ≤ concurrency limit, execute batches sequentially (within-batch concurrent), regression gate runs once after ALL batches. Record `sub_wave_batch` in registry.

### Per-Wave Execution Flow

```
1.  Record pre-wave commit: git rev-parse HEAD → PRE_WAVE_COMMIT
2.  Spawn work unit sub-agents (respect serialization for same-file conflicts)
3.  Wait for all sub-agents / sub-wave batches to complete
4.  Update Finding Registry (status, commit_sha, duration). Run Checkpoint 3.
5.  Post-wave merge window: resolve conflicts, verify no overwrites
6.  Stage: git add [modified files]
7.  Commit: git commit -m "audit: wave N -- [severity] findings"
8.  Run regression gate
9.  If gate passes: calculate domain re-scores, proceed to next wave
10. If gate fails: execute gate failure protocol, update registry
11. Release sub-agent details from context (retain only wave summary)
```

Prioritize within wave: dependency-first, then impact-to-effort ratio, then security before cosmetic.

---

## Regression Gates

After each wave commit, run 5-check gate comparing against Phase 0 baseline (NOT a shifted baseline).

### Gate Checks

| Check | Command | PASS if | FAIL if |
|-------|---------|---------|---------|
| Tests | `npm test` | failed ≤ baseline failed | Any NEW test failure |
| Typecheck | `npx tsc --noEmit` | errors ≤ baseline errors | Any NEW type error |
| Lint | `npm run lint` | errors ≤ baseline errors | Any NEW lint error |
| Build | `npm run build` | Build succeeds | Build fails AND baseline succeeded |
| Diff | `git diff --stat BASELINE..HEAD` | No unintended mods, no binaries, no credentials | Anomalies detected |

### Gate Result Format

```
## Gate [N] Results — Wave [N] ([Severity])

| Check | Result | Detail |
|-------|--------|--------|
| Tests | PASS/FAIL | X failed (baseline: Y, delta: +Z) |
| Typecheck | PASS/FAIL | X errors (baseline: Y, delta: +Z) |
| Lint | PASS/FAIL | X errors (baseline: Y, delta: +Z) |
| Build | PASS/FAIL | — |
| Diff | PASS/FAIL | [issues, if any] |

Gate Verdict: PASS / FAIL
```

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
new_score = baseline_score + (resolved / total) * (100 - baseline_score) * 0.8
```

Where `resolved` = findings resolved across all completed waves, `total` = total findings in domain, `0.8` = diminishing returns factor.

Flag any domain whose score decreased — indicates cross-domain side effects.

---

## Rollback Protocols

| Level | Scope | Command | When | Post-Action |
|-------|-------|---------|------|-------------|
| 1 | Work unit files | `git checkout <PRE_WAVE> -- <files>` | One unit fails | Re-run gate, recommit rest |
| 2 | Full wave | `git reset --soft <PRE_WAVE>` | Multiple fail / L1 failed | Inspect, unstage, discard |
| 3 | All changes | `git reset --hard <BASELINE>` | Cascading, no salvage. **USER CONFIRM** | — |

### Decision Matrix

| Condition | Level |
|-----------|-------|
| Single work unit fails, others pass | 1 |
| Multiple work units fail, no dependency chain | 1 (each) |
| Multiple fail, shared dependencies | 2 |
| Gate fails after Level 1 | 2 |
| Gate fails after Level 2 | Halt wave, next |
| Abort threshold, successful waves exist | Keep successful, halt |
| Abort threshold, no successful waves | 3 (user confirmation) |

---

## Sub-Agent Instructions

### Implementation Sub-Agents

Read and adapt `audit/templates/implementation-sub-agent.md` for each work unit. Replace placeholders (`[Wave]`, `[Work Unit]`, `[findings]`) with registry values.

### Final Reviewer

Spawn after all waves complete (or after halt). **Mandatory — must not be skipped.**

Read `audit/templates/reviewer-sub-agent.md`. Pass: Finding Registry, wave re-scores, Never-Attempted Manifest.

### SHIP Gate

The SHIP verdict requires:
1. Pass 0 = PASS — zero orphaned findings
2. All `never_attempted` findings explicitly acknowledged
3. All `failed` and `rolled_back` findings have documented reasons

If Pass 0 = FAIL, maximum verdict is BLOCK. If reviewer reports FAIL/REGRESSION, spawn targeted fix sub-agents. Max 2 fix-review cycles.

---

## Report Update Protocol

After reviewer verdict, spawn a **Report Update Agent**. It receives: Finding Registry, reviewer verdict, domain re-scores, Never-Attempted Manifest, execution telemetry.

Self-check: count status markers in updated report and verify they match registry counts. Fix discrepancies before completing.

### Update Steps

1. **Update Tier 2 — Domain Summaries:** Health scores, finding counts, replace resolved top-3 findings, add resolution notes.

2. **Update Tier 3 — Domain Detail:** Add `Status` column. Mark: `**Done**`, `PARTIAL`, `ROLLED-BACK`. Unresolved remains unmarked. Must be consistent with Enhanced Action Items.

3. **Update Enhanced Action Items:** Mark: `DONE`, `PARTIAL`, `OPEN` (with failure reason), `ROLLED-BACK` (with wave and reason).

4. **Update Enhanced Release Plan:** Move resolved items to "Resolved" subsection. Recalculate remaining effort and confidence score.

5. **Update Delta Since Previous Audit:** Resolution statistics, wave-level breakdown, updated open count.

6. **Add Execution Log:** Append to Audit History table.

7. **Present Summary:**

```
## Audit Execution Summary

Execution Date: YYYY-MM-DD
Report: AUDIT-REPORT.md

### Wave Results
| Wave | Severity | Findings | Resolved | Partial | Failed | Rolled Back |
|------|----------|----------|----------|---------|--------|-------------|
| 1    | Critical | N        | N        | N       | N      | N           |
| 2    | High     | N        | N        | N       | N      | N           |
| 3    | Medium   | N        | N        | N       | N      | N           |
| 4    | Low      | N        | N        | N       | N      | N           |

### Overall Results
- Total targeted: N | Resolved: N | Partial: N | Failed: N | Rolled back: N | Human-only: N

### Domain Score Changes
| Domain | Before | After | Delta |
|--------|--------|-------|-------|

### Remaining Human Actions
| # | Domain | Action Item | Severity | Effort |
|---|--------|-------------|----------|--------|

### Reviewer Verdict: [SHIP / FIX-AND-SHIP / PARTIAL-SHIP / BLOCK]

### Next Steps
[Concrete list]
```

---

## Execution Telemetry

Record after full execution:

```
Total Execution Time: HH:MM:SS
Waves Completed: N/4
Waves Rolled Back: N
Work Units Executed: N
Sub-Agents Spawned: Implementation: N, Fix: N, Reviewer: N

Gate Results:
  Gate 1-4: PASS/FAIL (attempts: N)

Rollbacks: Level 1: N, Level 2: N, Level 3: N

Domain Score Delta: Improved: N (avg +X), Unchanged: N, Regressed: N
Finding Resolution Rate: N/N (X%)
```

### Per-Finding Resolution Log

Columns: `Finding`, `Domain`, `Severity`, `Work Unit`, `Wave`, `Batch`, `Status`, `Duration`, `Commit`, `Notes`.

### Rollback Detail Log

Columns: `Event`, `Wave`, `Level`, `Trigger`, `Work Unit`, `Findings Affected`, `Resolution`.

---

## Guardrails

1. **Do not fabricate findings.** Only implement items from the audit report.
2. **Do not skip the reviewer.** Final reviewer sub-agent is mandatory.
3. **Do not modify the audit prompt.** `AUDIT.md` is read-only during execution.
4. **Do not mark human-only items as done.**
5. **Preserve report structure.** Maintain existing markdown format and section numbering.
6. **Be honest about failures.** Report unresolvable findings as unresolved.
7. **Respect user exclusions.**
8. **Never skip regression gates.** Every wave must pass its gate. No exceptions.
9. **Never cross wave boundaries.** Work units belong to exactly one wave.
10. **Always execute rollbacks.** Actually perform git operations — do not just mark as rolled back.
11. **Preserve wave commits.** No squashing during execution.
12. **Baseline is immutable.** Always compare against Phase 0, not a progressive baseline.
13. **Every finding must be registered.** No processing without a registry entry.
14. **No silent drops.** Every targeted finding must reach a terminal status.
15. **Registry checkpoints are mandatory.** Checkpoint failure is a HALT condition.
16. **Completeness Gate is blocking.** Phase 2 gate must pass (orphaned = 0) before execution.

---

## Execution History

| Date | Report Version | Model | Waves | Findings Targeted | Resolved | Partial | Failed | Rolled Back | Never Attempted | Duration | Resolution Rate | Remaining Human |
|------|---------------|-------|-------|-------------------|----------|---------|--------|-------------|-----------------|----------|-----------------|-----------------|
| 2026-03-05 | v3 (80/100) | -- | 4/4 | 36 | 36 | 0 | 0 | 0 | 0 | -- | 100% | 4 (#3, #4, #5, #6) |
| 2026-03-05 | v4 (82/100) | -- | 4/4 | 31 | 30 | 1 | 0 | 0 | 0 | -- | 97% | 4 (#1, #2, #3, #4) |
