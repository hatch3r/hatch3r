# hatch3r — Audit Execution Prompt

> **Reusable prompt for agentic AI to implement all agent-actionable findings from an audit report.**
> Invoke by reading this file and executing the instructions below.

---

## Purpose

This is the execution companion to `AUDIT.md` (audit prompt) and `AUDIT-REPORT.md` (audit report). The audit produces findings across **18 domains** using **98 sub-agents**. While `AUDIT.md` produces findings, this prompt **resolves** them using a **wave-based progressive execution model** with **regression gates** between waves.

The orchestrating agent reads the audit report, identifies every action item implementable by agents, organizes them into severity-based execution waves, spawns sub-agents to implement each wave's work units, runs regression gates to verify each wave did not introduce regressions, recalculates domain health scores, and updates the report with results. If a wave introduces regressions, the gate triggers a rollback protocol before proceeding.

```
Execution Flow:
  Baseline → Wave 1 (Critical) → Gate 1 → Wave 2 (High) → Gate 2 →
  Wave 3 (Medium) → Gate 3 → Wave 4 (Low) → Gate 4 → Final Review
```

---

## Input

The audit report at `AUDIT-REPORT.md` (or a user-specified path) is the source of truth. Parse these sections:

- **Section 3 — Per-Domain Findings**: detailed finding tables across 18 domains with columns `#`, `Severity`, `Area`, `Finding`, `Recommendation`, `Effort`
- **Section 5 — Prioritized Action Items**: master action list with columns `#`, `Domain`, `Action Item`, `Severity`, `Effort`, `Owner`, `Depends On`, `Status`
- **Section 7 — Next Version Release Plan**: release-scoped tables (Blockers, Should-Have, Deferred) with columns `#`, `Domain`, `Item`, `Severity`, `Effort`, `Status`/`Owner`, including risk scoring and confidence score

The `Owner` column in Section 5 determines implementability:

| Owner Value   | Meaning                                    |
|---------------|--------------------------------------------|
| `Agent`       | Fully implementable by sub-agents          |
| `Human/Agent` | Partially implementable — do the agent part |
| `Human`       | Skip — requires human action               |

---

## Pre-Execution Protocol

Before spawning any sub-agents, ask the user these questions:

1. **Report path** — Confirm `AUDIT-REPORT.md` is the correct report, or provide an alternative path.
2. **Exclusions** — Are there specific findings to skip, remove from the report, or deprioritize? (e.g., false positives, items already handled externally, findings that do not apply to the project's distribution model)
3. **Scope** — Should the execution cover all severity levels (Critical through Low), or stop at a threshold (e.g., Critical + High only)?
4. **Constraints** — Any project-specific context the agents need (e.g., "we use trusted releases so NODE_AUTH_TOKEN is unnecessary", "documentation site is in progress separately", "do not modify files in X directory").
5. **Model inheritance** — Confirm that sub-agents should inherit the current model. Do not downgrade sub-agent models unless the user explicitly requests it.
6. **Wave granularity** — Full 4-wave execution (Critical, High, Medium, Low) or compressed 2-wave execution (Critical+High, Medium+Low) for smaller finding sets? The 4-wave model provides finer rollback granularity. The 2-wave model reduces overhead when there are fewer than 30 total findings.
7. **Git strategy** — Wave-tagged commits (`audit-wave-1-critical`, `audit-wave-2-high`, etc.) or branch-per-wave (`audit/wave-1-critical`, `audit/wave-2-high`, etc.)? Wave-tagged commits keep history linear. Branch-per-wave enables per-wave PRs for review.
8. **Abort threshold** — How many consecutive gate failures before full execution stop? Default: 2. Setting this to 1 is aggressive but safe. Setting above 3 is not recommended.

Apply exclusions immediately: remove excluded items from the working set before proceeding, with a note in the finding's row explaining the removal rationale.

### Pre-Analysis

After gathering user answers and before entering Phase 0, perform the following automated analysis. No user input required.

**B1. Conflict Detection**

Build a file-to-findings map. For every finding, extract the file paths referenced in Section 3. Identify files touched by multiple findings. Flag potential conflicts.

**B2. Dependency Ordering**

Topological sort of findings using the explicit `Depends On` column from Section 5. Detect circular dependencies and flag them as errors.

**B3. Effort Estimation**

Sum the effort estimates per severity tier to produce per-wave totals. Use the following effort-to-hours conversion: S = 0.5h, M = 2h, L = 4h, XL = 8h.

Present the pre-analysis results to the user:

```
## Pre-Analysis Results

Files with potential conflicts: N
  [file path]: Finding #X (Severity), Finding #Y (Severity), ...
  [file path]: Finding #A (Severity), Finding #B (Severity), ...

Dependency chains: N
  Finding #X -> Finding #Y -> Finding #Z
  Finding #A -> Finding #B

Circular dependencies: N
  [list, if any — these must be resolved before execution]

Estimated effort per wave:
  Wave 1 (Critical): ~X hours (N findings)
  Wave 2 (High):     ~X hours (N findings)
  Wave 3 (Medium):   ~X hours (N findings)
  Wave 4 (Low):      ~X hours (N findings)
  Total:             ~X hours (N findings)
```

Wait for user acknowledgment before proceeding to Phase 0.

---

## Phase 0: Baseline Capture

Before any modifications, capture the baseline state. This baseline is the immutable comparison target for ALL subsequent regression gates. Never shift the baseline.

### Step 1: Run Validation Commands

Execute each command and record results:

```
npm test           -> Record: total tests, passed, failed, skipped
npx tsc --noEmit   -> Record: error count
npm run lint        -> Record: warning count, error count
npm run build       -> Record: success or failure
```

### Step 2: Record Rollback Target

```
git rev-parse HEAD  -> Store as BASELINE_COMMIT
```

This commit hash is the rollback target for Level 3 rollbacks and the comparison target for all regression gates.

### Step 3: Record Domain Health Scores

Extract the health score for each of the 18 domains from Section 3 of the audit report. These scores are the baseline for domain re-scoring after each wave.

### Step 4: Store Structured Baseline

Assemble and retain the following structured baseline for reference throughout execution:

```json
{
  "commit": "BASELINE_COMMIT",
  "timestamp": "ISO-8601",
  "tests": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0
  },
  "typecheck": {
    "errors": 0
  },
  "lint": {
    "errors": 0,
    "warnings": 0
  },
  "build": "pass",
  "domainScores": {
    "D1": 0,
    "D2": 0,
    "D3": 0,
    "D4": 0,
    "D5": 0,
    "D6": 0,
    "D7": 0,
    "D8": 0,
    "D9": 0,
    "D10": 0,
    "D11": 0,
    "D12": 0,
    "D13": 0,
    "D14": 0,
    "D15": 0,
    "D16": 0,
    "D17": 0,
    "D18": 0
  }
}
```

This baseline is immutable. It is the comparison target for ALL subsequent regression gates. Pre-existing failures recorded here are NOT regressions. Only NEW failures introduced by wave execution are regressions.

---

## Phase 1: Enhanced Triage

Parse every action item from Section 5. Build three lists:

1. **Agent-implementable** — `Owner: Agent` items
2. **Mixed** — `Owner: Human/Agent` items (implement the agent-actionable portion)
3. **Human-only** — `Owner: Human` items (skip, but track for the final summary)

For each agent-implementable item, cross-reference Section 3 (Per-Domain Findings) to gather:
- The detailed finding description and recommendation
- The specific files, functions, or areas referenced
- The acceptance criteria (from Section 7 if present)
- The `Depends On` references for ordering

### 4-Tier Deduplication

With 98 audit sub-agents, multiple agents will surface the same finding through different lenses. Before grouping, deduplicate across four confidence tiers:

**Tier 1: Exact File Match (HIGH confidence)**

Same file path referenced in multiple findings. These are almost certainly duplicates or overlapping concerns.

**Tier 2: Line Range Overlap (HIGH confidence)**

Overlapping line ranges in the same file across different findings. Even if the descriptions differ, overlapping line ranges indicate the same code region is being addressed.

**Tier 3: Recommendation Similarity (MEDIUM confidence)**

Semantically similar recommendations across different files. For example, "add input validation to path parameter" surfaced in three different adapter files. These are not duplicates but should be grouped into one work unit.

**Tier 4: Cross-Domain Semantic Near-Duplicates (LOW confidence)**

The same underlying issue surfaced by different domain auditors. For example, a missing error handler flagged by the code quality auditor (Domain 2) and the reliability auditor (Domain 12). These require manual judgment — merge only when the recommendations are clearly addressing the same root cause.

### Merge Strategy for Duplicates

When merging duplicate findings:
- Keep the **highest severity** rating from any source finding
- Merge recommendations (union of all unique recommendations)
- Keep the **largest effort** estimate
- Union all cross-references and source sub-agent IDs
- Log all merges for traceability (e.g., "Finding #12 merged with #47 — same path traversal issue in `cursor.ts`, sources: D2-SA3, D5-SA1")

### Severity Bucket Classification

Map each finding to its execution wave:

| Severity | Wave    | Typical Priority Within Wave                          |
|----------|---------|-------------------------------------------------------|
| Critical | Wave 1  | Security fixes first, then correctness, then blockers |
| High     | Wave 2  | Quality impact first, then competitiveness, then UX   |
| Medium   | Wave 3  | Clear benefit first, then optimization, then consistency |
| Low      | Wave 4  | Polish, documentation, cosmetic                       |

---

## Phase 2: Advanced Grouping

Cluster related items into coherent **work units** to minimize context switching and avoid conflicting edits. Use six grouping dimensions:

1. **File proximity** — Items touching the same files or modules
2. **Domain affinity** — Items from the same audit domain
3. **Dependency chain** — Items where one must complete before another
4. **Semantic similarity** — Items addressing the same conceptual concern
5. **Risk level** — Group higher-risk items together for focused attention
6. **Wave assignment** — Work units NEVER cross wave boundaries

### Sizing Constraints

| Constraint | Value |
|------------|-------|
| Minimum    | 1 finding per work unit |
| Maximum    | 10 findings per work unit |
| Target     | 3-6 findings per work unit |

Single-item units are expected for isolated adapter or content fixes.

### Grouping Rules

**Adapter grouping rule:** Findings from adapter audit sub-agents should be grouped by adapter (one work unit per adapter), not by finding type. This ensures each adapter's changes are self-contained and independently testable.

**Content grouping rule:** Findings from content audit sub-agents should be grouped by content type (agents, rules, commands, skills) rather than by severity. This minimizes context switching across unrelated content artifacts.

**Security grouping rule:** Security findings should be grouped by attack surface, not by severity. A path traversal fix and an input validation fix in the same module belong together even if one is Critical and the other is High — provided they fall in the same wave.

**Cross-wave constraint:** Each work unit must belong to exactly one wave. If a security grouping spans Critical and High findings, split into two work units (one per wave).

Example groupings (adapt to actual findings):

| Work Unit             | Wave | Typical Contents                                           |
|-----------------------|------|------------------------------------------------------------|
| Security hardening    | 1    | Protected flag fixes, deny-list extensions, input validation |
| Adapter: Cursor       | 2    | All findings for `cursor.ts` within this severity tier     |
| Adapter: Copilot      | 2    | All findings for `copilot.ts` within this severity tier    |
| Adapter: [name]       | 2    | One work unit per adapter                                  |
| Code quality / DRY    | 3    | Refactors, dead code removal, consistency fixes            |
| Content: Agents       | 3    | Agent frontmatter, check file fixes                        |
| Content: Rules        | 3    | Rule `.md`/`.mdc` file fixes                               |
| Content: Commands     | 3    | Command file expansions and corrections                    |
| Content: Skills       | 3    | Skill file improvements                                    |
| Test improvements     | 3    | Missing tests, coverage gaps, test infrastructure          |
| Documentation fixes   | 4    | README corrections, CHANGELOG fixes, manifest updates      |
| Wiring / pipeline     | 4    | Safe write fixes, validation gaps, MCP config fixes        |

---

## Phase 3: Conflict Resolution Planning

For findings that touch the same files, establish a conflict resolution strategy before execution begins.

### Same-Wave Conflicts

Multiple findings in the same wave touching the same file:

1. **Preferred:** Assign to the same work unit. This eliminates the conflict entirely because one sub-agent handles all changes to that file.
2. **Alternative:** Serialize work units within the wave. One work unit completes and commits its file changes before the next work unit starts modifying the same file.

### Cross-Wave Conflicts

Findings in different waves touching the same file:

1. The lower-severity wave's work unit must account for changes made by the higher-severity wave.
2. Include "file changed in previous wave" awareness in the sub-agent prompt for the later wave.
3. The sub-agent must re-read the file at execution time, not rely on the state captured during triage.

### Dependency-Linked Conflicts

Finding B depends on Finding A completing first:

| Relationship | Resolution |
|-------------|------------|
| Same wave   | Serialize within wave — A completes before B starts |
| Different waves (A higher severity) | Natural ordering — A's wave runs first |
| Different waves (A lower severity) | Promote A to B's wave, or defer B to A's wave |

### Post-Wave Merge Window

After each wave completes but before the regression gate runs:

1. Review all changes from the wave for internal consistency
2. Resolve any merge conflicts between work units in the completed wave
3. Verify no work unit overwrote another work unit's changes
4. Stage all changes for the wave commit

---

## Phase 4: Execution Waves

Execute findings in severity-based waves with regression gates between each wave. Each wave is an atomic unit: it either passes its gate and is retained, or it fails and is rolled back.

```
Baseline -> Wave 1 (Critical) -> Gate 1 -> Wave 2 (High) -> Gate 2 ->
Wave 3 (Medium) -> Gate 3 -> Wave 4 (Low) -> Gate 4 -> Final Review
```

### Wave 1: Critical Findings

| Parameter | Value |
|-----------|-------|
| Expected findings | 5-15 |
| Expected work units | 2-5 |
| Concurrency | 4-6 sub-agents |
| Priority | Security fixes first, then correctness, then blocking issues |
| Commit tag | `audit-wave-1-critical` |

### Wave 2: High Findings

| Parameter | Value |
|-----------|-------|
| Expected findings | 15-30 |
| Expected work units | 5-10 |
| Concurrency | 6-8 sub-agents |
| Priority | Quality impact first, then competitiveness, then UX |
| Commit tag | `audit-wave-2-high` |

### Wave 3: Medium Findings

| Parameter | Value |
|-----------|-------|
| Expected findings | 30-50 |
| Expected work units | 8-15 |
| Concurrency | 6-8 sub-agents (may batch if finding count is high) |
| Priority | Clear benefit first, then optimization, then consistency |
| Commit tag | `audit-wave-3-medium` |

### Wave 4: Low Findings

| Parameter | Value |
|-----------|-------|
| Expected findings | 15-25 |
| Expected work units | 5-10 |
| Concurrency | 4-6 sub-agents |
| Priority | Polish, documentation, cosmetic |
| Commit tag | `audit-wave-4-low` |

### Per-Wave Execution Flow

For each wave, execute the following steps in order:

```
1. Record the pre-wave commit:
   git rev-parse HEAD -> Store as PRE_WAVE_COMMIT

2. Spawn all work unit sub-agents for this wave
   - Respect serialization constraints for same-file conflicts
   - Independent work units run in parallel
   - Dependent work units run sequentially

3. Wait for all sub-agents to complete

4. Post-wave merge window:
   - Resolve any conflicts between work units
   - Verify no work unit overwrote another's changes

5. Stage all changes:
   git add [modified files]

6. Commit with wave tag:
   git commit -m "audit: wave N -- [severity] findings"

7. Run regression gate (see Regression Gates section)

8. If gate passes:
   - Calculate domain re-scores (see Domain Re-Scoring section)
   - Proceed to next wave

9. If gate fails:
   - Execute gate failure protocol (see Regression Gates section)
   - If resolved: proceed to next wave
   - If abort threshold reached: halt execution, proceed to Final Review
```

Within the same wave, prioritize work units by:
- Items that unblock other items (dependency-first)
- Higher impact-to-effort ratio (S effort before XL effort)
- Security fixes before cosmetic fixes

---

## Regression Gates

After each wave commit, run a 5-check regression gate. The gate compares the current state against the Phase 0 baseline (BASELINE_COMMIT), NOT a shifted baseline. Pre-existing failures are not regressions.

### Gate Protocol

**Gate Check 1: Test Suite**

```
npm test
  -> Compare against Phase 0 baseline
  -> PASS if: failed test count <= baseline failed test count
  -> FAIL if: any NEW test failure (test that passed in baseline now fails)
```

**Gate Check 2: Type Checking**

```
npx tsc --noEmit
  -> PASS if: error count <= baseline error count
  -> FAIL if: any NEW type error
```

**Gate Check 3: Linting**

```
npm run lint
  -> PASS if: error count <= baseline error count (warnings may increase)
  -> FAIL if: any NEW lint error
```

**Gate Check 4: Build**

```
npm run build
  -> PASS if: build succeeds
  -> FAIL if: build fails AND baseline build succeeded
```

**Gate Check 5: Diff Analysis**

```
git diff --stat BASELINE_COMMIT..HEAD
  -> Verify: no unintended file modifications outside finding scope
  -> Verify: no binary files added without justification
  -> Verify: no credential-like strings introduced (API keys, tokens, passwords)
```

### Gate Result Summary

Present the gate result in this format:

```
## Gate [N] Results — Wave [N] ([Severity])

| Check | Result | Detail |
|-------|--------|--------|
| Tests | PASS/FAIL | X failed (baseline: Y failed, delta: +Z) |
| Typecheck | PASS/FAIL | X errors (baseline: Y errors, delta: +Z) |
| Lint | PASS/FAIL | X errors (baseline: Y errors, delta: +Z) |
| Build | PASS/FAIL | — |
| Diff | PASS/FAIL | [issues, if any] |

Gate Verdict: PASS / FAIL
```

### Gate Failure Protocol

When a gate fails, execute the following protocol in order. Each attempt is progressively more disruptive.

**Attempt 1: Targeted Fix**

1. Identify the specific change(s) causing the gate failure
2. Trace the failure to the responsible work unit and finding
3. Spawn a targeted fix sub-agent for the failing work unit
4. The fix sub-agent receives the gate failure details, the work unit's original findings, and the current file state
5. After the fix sub-agent completes, re-run the gate

**Attempt 2: Selective Rollback**

1. If the targeted fix fails or introduces additional failures, rollback the specific work unit that caused the failure
2. Use Level 1 rollback: `git checkout <PRE_WAVE_COMMIT> -- <file1> <file2> ...` for only the files modified by the failing work unit
3. Preserve all other work units in the wave
4. Re-run the gate
5. Mark the rolled-back findings as `ROLLED-BACK`

**Attempt 3: Full Wave Rollback**

1. If selective rollback fails to resolve the gate failure, rollback the entire wave
2. Use Level 2 rollback: `git reset --soft <PRE_WAVE_COMMIT>`
3. Log the wave as FAILED with the gate failure details
4. Mark all findings in the wave as `ROLLED-BACK`
5. Proceed to next wave (if abort threshold not reached)

**Abort Threshold:**

If consecutive gate failures reach the abort threshold (default: 2), halt execution entirely. Proceed directly to Final Review with partial results. The abort threshold counts consecutive failures across waves — a passing gate resets the counter.

---

## Domain Re-Scoring

After each wave's gate passes, recalculate the health scores for all domains that had findings addressed in the completed wave.

### Diminishing Returns Formula

```
new_score = baseline_score + (resolved / total) * (100 - baseline_score) * 0.8
```

Where:
- `baseline_score` = domain score from Phase 0 (audit report Section 3)
- `resolved` = count of findings resolved in this domain across all completed waves so far
- `total` = total findings in this domain from the audit
- `0.8` = diminishing returns factor (perfect resolution does not equal a perfect score — new issues may emerge, and the audit cannot verify what it did not test)

### Regression Detection

After re-scoring, flag any domain whose score **decreased** compared to the previous wave's score. A decreasing score indicates that a wave's changes introduced issues in a domain they were not targeting. This is a signal to investigate cross-domain side effects.

### Re-Score Output

Present the re-score after each wave in this format:

```
## Domain Re-Scores After Wave [N]

| Domain | Baseline | After Wave 1 | After Wave 2 | After Wave 3 | After Wave 4 |
|--------|----------|-------------|-------------|-------------|-------------|
| D1     | XX/100   | XX/100      | --          | --          | --          |
| D2     | XX/100   | XX/100      | --          | --          | --          |
| D3     | XX/100   | --          | --          | --          | --          |
| D4     | XX/100   | --          | --          | --          | --          |
| D5     | XX/100   | --          | --          | --          | --          |
| D6     | XX/100   | --          | --          | --          | --          |
| D7     | XX/100   | --          | --          | --          | --          |
| D8     | XX/100   | --          | --          | --          | --          |
| D9     | XX/100   | --          | --          | --          | --          |
| D10    | XX/100   | --          | --          | --          | --          |
| D11    | XX/100   | --          | --          | --          | --          |
| D12    | XX/100   | --          | --          | --          | --          |
| D13    | XX/100   | --          | --          | --          | --          |
| D14    | XX/100   | --          | --          | --          | --          |
| D15    | XX/100   | --          | --          | --          | --          |
| D16    | XX/100   | --          | --          | --          | --          |
| D17    | XX/100   | --          | --          | --          | --          |
| D18    | XX/100   | --          | --          | --          | --          |

Domains with score regression: [list, or "none"]
```

Fill in columns progressively as each wave completes. Use `--` for waves not yet executed.

---

## Rollback Protocols

Three levels of rollback, from least to most disruptive. Always use the least disruptive level that resolves the issue.

### Level 1: Work Unit Rollback

| Parameter | Value |
|-----------|-------|
| Scope | Revert changes from a single work unit within a wave |
| Method | Selective file checkout from the pre-wave commit |
| Command | `git checkout <PRE_WAVE_COMMIT> -- <file1> <file2> ...` |
| Use when | A specific work unit causes a gate failure but other work units in the wave are fine |
| Preserves | All other work units in the wave |

After Level 1 rollback:
1. Re-run the regression gate
2. Mark the rolled-back findings as `ROLLED-BACK` with the reason
3. Recommit the remaining changes

### Level 2: Full Wave Rollback

| Parameter | Value |
|-----------|-------|
| Scope | Revert all changes from an entire wave |
| Method | Soft reset to preserve changes for inspection |
| Command | `git reset --soft <PRE_WAVE_COMMIT>` |
| Use when | Multiple work units cause gate failures, or selective rollback did not resolve the issue |
| Preserves | Changes are staged (not lost) for manual review |

After Level 2 rollback:
1. Inspect the staged changes to understand what went wrong
2. Unstage all changes: `git reset HEAD`
3. Discard the changes: `git checkout -- .`
4. Re-run the regression gate to verify clean state
5. Mark all findings in the wave as `ROLLED-BACK`
6. Proceed to next wave

### Level 3: Full Execution Rollback

| Parameter | Value |
|-----------|-------|
| Scope | Revert ALL changes from the entire execution run |
| Method | Hard reset to baseline commit (destructive) |
| Command | `git reset --hard <BASELINE_COMMIT>` |
| Use when | Cascading failures across multiple waves, or abort threshold reached with no salvageable waves |
| Requires | **Explicit user confirmation before executing** |

Level 3 is destructive. All wave commits, including successful ones, are lost. Only use when the codebase is in a worse state than the baseline.

### Decision Matrix

| Condition | Rollback Level |
|-----------|---------------|
| Single work unit fails gate, others pass | Level 1 |
| Multiple work units fail, no dependency chain | Level 1 (each failing unit) |
| Multiple work units fail, shared dependencies | Level 2 |
| Gate fails after Level 1 rollback | Level 2 |
| Gate fails after Level 2 rollback | Halt wave, proceed to next |
| Abort threshold reached, successful waves exist | Keep successful waves, halt |
| Abort threshold reached, no successful waves | Level 3 (with user confirmation) |

---

## Sub-Agent Instructions

Every implementation sub-agent receives the following structured prompt. Adapt the template to each work unit's specific findings, wave context, and conflict awareness.

```
## Task

Implement the following audit findings for [project name].
You are executing **Wave [N] of [M]** -- [severity level] findings.

## Wave Context

- Wave: [N] ([Critical/High/Medium/Low])
- Work Unit: [name/description]
- Concurrent work units in this wave: [list of other work units and their file scopes]
- Files shared with other work units: [list, if any]
- Baseline state: [pre-existing test failures, lint warnings, etc. from Phase 0]

## Findings to Implement

For each finding, provide:
- **Finding [ID]**: [Action item description from Section 5]
  - **Detail**: [Finding + Recommendation from Section 3]
  - **Files**: [Specific files to read and modify]
  - **Effort**: [S/M/L/XL]
  - **Domain**: [Domain number and name]
  - **Depends On**: [Finding IDs this depends on, if any]

## Requirements

1. **Read before writing.** Read every file you will modify before making changes.
   Understand the surrounding context, conventions, and patterns in use.

2. **Research when needed.** If the finding references external standards, platform
   documentation, or best practices, use web search to verify current guidance
   before implementing.

3. **Atomic changes.** Each finding should be a self-contained, correct change.
   Do not introduce partial implementations.

4. **Preserve existing behavior.** Do not break existing tests, introduce lint
   errors, or change unrelated code. If a finding requires modifying a public API,
   ensure all callers are updated.

5. **Follow project conventions.** Match the existing code style, naming patterns,
   and architectural patterns. Do not introduce new dependencies without explicit
   justification.

6. **No placeholders.** Every file must be complete and compilable. No `// TODO`,
   `// ...`, or `"existing code here"` stubs.

7. **Verify your work.** After all changes:
   - Run the test suite (`npm test`)
   - Run the type checker (`npx tsc --noEmit`)
   - Run the linter (`npm run lint`)
   - Fix any failures you introduced

## Constraints

- Do not modify files outside the scope of your assigned findings
- Do not refactor code beyond what the finding requires
- If a finding is ambiguous, implement the conservative interpretation
- If a finding conflicts with another finding in your set, flag it and
  implement whichever is safer
- **Wave discipline:** Do not fix issues outside your severity scope. If you
  notice a Medium-severity issue while implementing a Critical fix, note it
  but do not fix it -- it belongs to a later wave.
- **Conflict awareness:** If your work unit shares files with another work unit
  in this wave, coordinate changes to avoid conflicts. Make minimal, targeted
  changes to shared files.
- **Baseline awareness:** Pre-existing test failures (recorded in Phase 0) are
  NOT regressions. Only flag failures you introduce.
```

---

## Final Reviewer Sub-Agent

After ALL waves complete (or after execution halts due to abort threshold), spawn a dedicated reviewer sub-agent. This step is mandatory and must not be skipped.

### Reviewer Instructions

```
## Task

You are the final quality gate for a wave-based audit execution run. All
implementation waves have completed (or execution was halted). Your job is to
perform a comprehensive 4-pass review and produce a structured verdict.

## Pass 1: Functional Verification

1. Run the full test suite: `npm test`
   Report: total, passed, failed, skipped. Flag regressions vs baseline.

2. Run typecheck: `npx tsc --noEmit`
   Report: error count. Flag new errors vs baseline.

3. Run lint: `npm run lint`
   Report: error count, warning count. Flag new errors vs baseline.

4. Run build: `npm run build`
   Report: success/failure.

5. Review the full git diff (all changes from BASELINE_COMMIT to HEAD):
   - Each change matches its finding's recommendation
   - No unrelated code modified
   - No dead code, debug logging, or TODO comments left behind
   - Changes follow project conventions

## Pass 2: Security Verification

1. Review all changes for security implications:
   - No new attack surfaces introduced
   - Security fixes from Wave 1 are complete and correct
   - No credential-like strings in code or config
   - No path traversal vulnerabilities
   - Input validation present where needed

2. Cross-reference against Domain 15 findings:
   - Were all security findings properly addressed?
   - Did any implementation introduce new security concerns?

## Pass 3: Cross-Wave Consistency

1. Verify Wave 1 changes not broken by later waves:
   - Critical fixes still intact after Medium/Low wave changes
   - No regression in security hardening from Wave 1

2. Verify wave commits are internally consistent:
   - Each wave's changes are coherent
   - No partial implementations spanning waves

3. Verify dependency ordering was respected:
   - Findings with `Depends On` were implemented in the correct order

## Pass 4: Domain Health Score Validation

1. Independently recalculate domain health scores:
   - For each domain, count resolved vs remaining findings
   - Apply the diminishing returns formula
   - Compare against the wave-by-wave re-scores from Phase 4

2. Verify overall weighted score calculation:
   - Apply domain weights (Critical 3x, Important 2x, Supporting 1x)
   - Calculate weighted overall score
   - Determine score band

## Output

### Test Results
- Total: X | Passed: X | Failed: X | Skipped: X
- Typecheck: PASS/FAIL (N errors, N new)
- Lint: PASS/FAIL (N errors, N new)
- Build: PASS/FAIL

### Per-Wave Summary

| Wave | Findings | Resolved | Partial | Failed | Rolled Back |
|------|----------|----------|---------|--------|-------------|
| 1    | N        | N        | N       | N      | N           |
| 2    | N        | N        | N       | N      | N           |
| 3    | N        | N        | N       | N      | N           |
| 4    | N        | N        | N       | N      | N           |

### Per-Finding Verdict

| Finding ID | Wave | Status      | Notes                          |
|------------|------|-------------|--------------------------------|
| [ID]       | 1    | PASS        | Implemented as recommended     |
| [ID]       | 1    | PARTIAL     | [What's missing]               |
| [ID]       | 2    | FAIL        | [What went wrong]              |
| [ID]       | 3    | REGRESSION  | [What broke]                   |
| [ID]       | 2    | ROLLED-BACK | [Why rolled back]              |

### Regressions
[List any new failures introduced by the implementation, grouped by wave]

### Security Assessment
[Summary of Pass 2 findings]

### Domain Health Score Re-Evaluation

| Domain | Baseline | Final  | Delta | Findings Resolved | Findings Remaining |
|--------|----------|--------|-------|-------------------|-------------------|
| D1     | X/100    | Y/100  | +/-N  | count             | count             |
| D2     | X/100    | Y/100  | +/-N  | count             | count             |
| ...    | ...      | ...    | ...   | ...               | ...               |
| D18    | X/100    | Y/100  | +/-N  | count             | count             |

### Overall Weighted Score
- Previous: X/100
- Current: Y/100
- Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]

### Recommendation
[SHIP / FIX-AND-SHIP / PARTIAL-SHIP / BLOCK]

PARTIAL-SHIP verdict: Ship waves 1-N, rollback waves N+1 onwards. Use when
early waves improved the codebase but later waves introduced issues.

[Detailed rationale for the recommendation]
```

If the reviewer reports FAIL or REGRESSION findings, attempt to fix them (spawn a targeted fix sub-agent for each failed item). Re-run the reviewer after fixes. Maximum 2 fix-review cycles — if issues persist after 2 cycles, report them as unresolved.

---

## Report Update Protocol

After the reviewer sub-agent produces its final verdict, update the audit report.

**High-volume handling:** For executions with >50 findings, group status updates by domain and severity for readability. Present a domain-level summary first, then expand details only for PARTIAL, FAIL, and ROLLED-BACK findings.

### 1. Update Section 5 — Prioritized Action Items

For each implemented finding:
- Add or update the `Status` column
- Mark successfully implemented items as `DONE`
- Mark partially implemented items as `PARTIAL` with a note
- Mark failed items as `OPEN` with the failure reason
- Mark rolled-back items as `ROLLED-BACK` with wave and reason
- Leave human-only items unchanged

### 2. Update Section 7 — Next Version Release Plan

- Move resolved items to a "Resolved" subsection
- Update the `Status` column from `OPEN` to `DONE`/`PARTIAL`/`ROLLED-BACK`
- Recalculate the estimated remaining effort
- Update the release confidence score based on resolution rates

### 3. Update Section 6 — Delta Since Previous Audit

- Update resolution statistics
- Include wave-level breakdown (resolved per wave)
- Update total open findings count

### 4. Add Execution Log

Append an entry to the Audit History table at the bottom of the report:

```
| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| YYYY-MM-DD | [version] | [score] | [model] -- wave execution (W1-W4) | AUDIT-REPORT.md (post-execution) |
```

### 5. Present Summary to User

After updating the report, present a clear summary:

```
## Audit Execution Summary

Execution Date: YYYY-MM-DD
Report: AUDIT-REPORT.md
Execution Model: Wave-based (4 waves)

### Wave Results
| Wave | Severity | Findings | Resolved | Partial | Failed | Rolled Back |
|------|----------|----------|----------|---------|--------|-------------|
| 1    | Critical | N        | N        | N       | N      | N           |
| 2    | High     | N        | N        | N       | N      | N           |
| 3    | Medium   | N        | N        | N       | N      | N           |
| 4    | Low      | N        | N        | N       | N      | N           |
| **Total** | | **N** | **N** | **N** | **N** | **N** |

### Overall Results
- Total findings targeted: N
- Successfully resolved: N
- Partially resolved: N
- Failed / unresolved: N
- Rolled back: N
- Skipped (human-only): N

### Domain Score Changes
| Domain | Before | After | Delta |
|--------|--------|-------|-------|
| [domains with changes] | X/100 | Y/100 | +/-N |

### Remaining Human Actions
| # | Domain | Action Item | Severity | Effort |
|---|--------|-------------|----------|--------|
| ... | ... | ... | ... | ... |

### Reviewer Verdict: [SHIP / FIX-AND-SHIP / PARTIAL-SHIP / BLOCK]

### Next Steps
[Concrete list of what the user needs to do next]
```

---

## Execution Telemetry

After the full execution completes (all waves processed or execution halted), record telemetry for operational visibility and future calibration.

```
## Execution Telemetry

Total Execution Time: HH:MM:SS
Waves Completed: N/4
Waves Rolled Back: N

Work Units Executed: N
Sub-Agents Spawned:
  - Implementation: N
  - Fix (targeted): N
  - Reviewer: N

Gate Results:
  - Gate 1 (Critical): PASS/FAIL (attempts: N)
  - Gate 2 (High): PASS/FAIL (attempts: N)
  - Gate 3 (Medium): PASS/FAIL (attempts: N)
  - Gate 4 (Low): PASS/FAIL (attempts: N)

Rollbacks:
  - Level 1 (work unit): N
  - Level 2 (full wave): N
  - Level 3 (full execution): N

Domain Score Delta Summary:
  - Domains improved: N (avg +X points)
  - Domains unchanged: N
  - Domains regressed: N (list domains)

Finding Resolution Rate: N/N (X%)
```

Record this telemetry in the execution history and include it in the summary presented to the user.

---

## Guardrails

### Original Guardrails

- **Do not fabricate findings.** Only implement items that exist in the audit report.
- **Do not skip the reviewer.** The final reviewer sub-agent is mandatory.
- **Do not modify the audit prompt.** `AUDIT.md` is read-only during execution.
- **Do not mark human-only items as done.** Only mark items that were actually implemented.
- **Preserve report structure.** When updating `AUDIT-REPORT.md`, maintain the existing markdown format, table structure, and section numbering.
- **Be honest about failures.** If a finding cannot be implemented (ambiguous, requires human judgment, blocked by missing context), report it as unresolved rather than attempting a bad fix.
- **Respect user exclusions.** Items the user explicitly excluded in the pre-execution protocol must not be implemented.

### Wave Execution Guardrails

- **Never skip regression gates.** Every wave must pass its gate before proceeding. No exceptions. A wave without a passing gate is not complete.
- **Never cross wave boundaries.** Work units belong to exactly one wave. Do not implement Medium-severity fixes in the Critical wave, or vice versa. If you notice an issue outside your wave's severity scope, note it for the correct wave but do not fix it.
- **Always execute rollbacks.** When a rollback is needed, actually perform the git operations. Do not mark items as "rolled back" without reverting the code. The codebase state must match the rollback level's specification.
- **Preserve wave commits.** Do not squash wave commits during execution. Each wave's commit must remain individually identifiable for rollback purposes. Squashing may happen post-execution at the user's discretion, but never during execution.
- **Baseline is immutable.** Never shift the comparison target for regression gates. Always compare against the Phase 0 baseline, not a progressive baseline. A test that was failing at baseline is not a regression if it continues to fail.

---

## Execution History

Record completed execution runs here for tracking:

| Date | Report Version | Model | Waves | Findings Targeted | Resolved | Partial | Failed | Rolled Back | Remaining Human |
|------|---------------|-------|-------|-------------------|----------|---------|--------|-------------|-----------------|
| 2026-03-05 | v3 (80/100) | -- | 4/4 | 36 | 36 | 0 | 0 | 0 | 4 (#3, #4, #5, #6) |
| 2026-03-05 | v4 (82/100) | -- | 4/4 | 31 | 30 | 1 | 0 | 0 | 4 (#1, #2, #3, #4) |
