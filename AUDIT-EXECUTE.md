# hatch3r — Audit Execution Prompt

> **Reusable prompt for agentic AI to implement all agent-actionable findings from an audit report.**
> Invoke by reading this file and executing the instructions below.

---

## Purpose

This is the execution companion to `AUDIT.md` (audit prompt) and `AUDIT-REPORT.md` (audit report). While `AUDIT.md` produces findings, this prompt **resolves** them. The orchestrating agent reads the audit report, identifies every action item implementable by agents, spawns sub-agents to implement them in parallel, runs a final reviewer sub-agent for verification, and updates the report with results.

---

## Input

The audit report at `AUDIT-REPORT.md` (or a user-specified path) is the source of truth. Parse these sections:

- **Section 3 — Per-Domain Findings**: detailed finding tables with columns `#`, `Severity`, `Area`, `Finding`, `Recommendation`, `Effort`
- **Section 5 — Prioritized Action Items**: master action list with columns `#`, `Domain`, `Action Item`, `Severity`, `Effort`, `Owner`
- **Section 7 — Next Version Release Plan**: release-scoped tables (Blockers, Should-Have, Deferred) with columns `#`, `Domain`, `Item`, `Severity`, `Effort`, `Status`/`Owner`

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
2. **Exclusions** — Are there specific findings to skip, remove from the report, or deprioritize? (e.g., false positives, items already handled externally, findings that don't apply to the project's distribution model)
3. **Scope** — Should the execution cover all severity levels (Critical through Low), or stop at a threshold (e.g., Critical + High only)?
4. **Constraints** — Any project-specific context the agents need (e.g., "we use trusted releases so NODE_AUTH_TOKEN is unnecessary", "documentation site is in progress separately", "do not modify files in X directory").
5. **Model inheritance** — Confirm that sub-agents should inherit the current model. Do not downgrade sub-agent models unless the user explicitly requests it.

Apply exclusions immediately: remove excluded items from the report before proceeding, with a note in the finding's row explaining the removal rationale.

---

## Execution Strategy

### Phase 1: Triage

Parse every action item from Section 5. Build three lists:

1. **Agent-implementable** — `Owner: Agent` items
2. **Mixed** — `Owner: Human/Agent` items (implement the agent-actionable portion)
3. **Human-only** — `Owner: Human` items (skip, but track for the final summary)

For each agent-implementable item, cross-reference Section 3 (Per-Domain Findings) to gather:
- The detailed finding description and recommendation
- The specific files, functions, or areas referenced
- The acceptance criteria (from Section 7 if present)

### Phase 2: Grouping

Cluster related items into coherent **work units** to minimize context switching and avoid conflicting edits. Group by:

1. **File proximity** — items touching the same files or modules
2. **Domain** — items in the same audit domain
3. **Dependency** — items where one must complete before another

Each work unit becomes a single sub-agent spawn. Target 3-8 items per work unit. Single-item units are acceptable for isolated changes.

Example groupings (adapt to actual findings):

| Work Unit             | Typical Contents                                           |
|-----------------------|------------------------------------------------------------|
| Security hardening    | Protected flag fixes, deny-list extensions, input validation |
| Documentation fixes   | README corrections, CHANGELOG fixes, manifest updates      |
| Code quality / DRY    | Refactors, dead code removal, consistency fixes            |
| Test improvements     | Missing tests, coverage gaps, test infrastructure          |
| Content quality       | Agent frontmatter, command expansions, check files         |
| Wiring / pipeline     | Safe write fixes, validation gaps, MCP config fixes        |

### Phase 3: Ordering

Execute work units in this priority order:

1. **Blockers / Critical** — items from Section 7 "Blockers" table
2. **High severity** — items that significantly impact quality or competitiveness
3. **Medium severity** — improvements with clear benefit
4. **Low severity** — polish items

Within the same severity, prioritize:
- Items that unblock other items (dependency-first)
- Higher impact-to-effort ratio (S effort before L effort)
- Security fixes before cosmetic fixes

### Phase 4: Parallel Execution

Spawn one sub-agent per work unit. Independent work units run in parallel (respecting the platform's concurrency limits — typically 3-4 concurrent sub-agents). Dependent work units run sequentially.

---

## Sub-Agent Instructions

Every implementation sub-agent receives the following structured prompt. Adapt the template to each work unit's specific findings.

```
## Task

Implement the following audit findings for [project name].

## Findings to Implement

For each finding, provide:
- **Finding [ID]**: [Action item description from Section 5]
  - **Detail**: [Finding + Recommendation from Section 3]
  - **Files**: [Specific files to read and modify]
  - **Effort**: [S/M/L]

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
   - Run the test suite (e.g., `npm test`)
   - Run the type checker (e.g., `npx tsc --noEmit`)
   - Run the linter (e.g., `npm run lint`)
   - Fix any failures you introduced

## Constraints

- Do not modify files outside the scope of your assigned findings
- Do not refactor code beyond what the finding requires
- If a finding is ambiguous, implement the conservative interpretation
- If a finding conflicts with another finding in your set, flag it and
  implement whichever is safer
```

---

## Final Reviewer Sub-Agent

After **all** implementation sub-agents have completed, spawn a dedicated reviewer sub-agent. This step is mandatory and must not be skipped.

### Reviewer Instructions

```
## Task

You are the final quality gate for an audit execution run. All implementation
sub-agents have completed their work. Your job is to verify every change,
catch regressions, and produce a structured verdict.

## Verification Steps

1. **Run the full test suite.**
   Execute `npm test` (or the project's test command). Report: total tests,
   passed, failed, skipped. If any test fails that was passing before, flag
   it as a regression.

2. **Run typecheck and lint.**
   Execute `npx tsc --noEmit` and `npm run lint` (or equivalents). Report
   any new errors. Zero tolerance for introduced type or lint errors.

3. **Review the diff.**
   Read the full git diff of all changes made during this execution run.
   For each changed file, verify:
   - The change matches the finding's recommendation
   - No unrelated code was modified
   - No dead code, debug logging, or TODO comments were left behind
   - The change follows project conventions

4. **Cross-reference findings.**
   For each finding that was assigned to an implementation sub-agent,
   verify:
   - Was the finding addressed? (yes / partially / no)
   - Does the implementation match the acceptance criteria from Section 7?
   - Are there any edge cases the implementation missed?

5. **Check for conflicts.**
   Verify that changes from different sub-agents don't conflict with each
   other (e.g., two agents modifying the same function in incompatible ways).

## Output

Produce a structured verdict:

### Test Results
- Total: X | Passed: X | Failed: X | Skipped: X
- Typecheck: PASS/FAIL (N errors)
- Lint: PASS/FAIL (N errors)

### Per-Finding Verdict

| Finding ID | Status    | Notes                          |
|------------|-----------|--------------------------------|
| [ID]       | PASS      | Implemented as recommended     |
| [ID]       | PARTIAL   | [What's missing]               |
| [ID]       | FAIL      | [What went wrong]              |
| [ID]       | REGRESSION| [What broke]                   |

### Regressions
[List any new failures introduced by the implementation]

### Recommendation
[SHIP / FIX-AND-SHIP / BLOCK — with rationale]
```

If the reviewer reports FAIL or REGRESSION findings, attempt to fix them (spawn a targeted fix sub-agent for each failed item). Re-run the reviewer after fixes. Maximum 2 fix-review cycles — if issues persist after 2 cycles, report them as unresolved.

---

## Report Update Protocol

After the reviewer sub-agent produces its final verdict, update the audit report:

### 1. Update Section 5 — Prioritized Action Items

For each implemented finding:
- Add a `Status` column if one doesn't exist, or append status to the `Owner` column
- Mark successfully implemented items as `DONE`
- Mark partially implemented items as `PARTIAL` with a note
- Mark failed items as `OPEN` with the failure reason
- Leave human-only items unchanged

### 2. Update Section 7 — Next Version Release Plan

- Move resolved Blockers and Should-Have items to a "Resolved" subsection
- Update the `Status` column from `OPEN` to `DONE` for completed items
- Recalculate the estimated remaining effort

### 3. Update Section 6 — Delta Since Previous Audit

If a Resolution Statistics table exists, update the counts:
- Increment resolved/partially resolved counts
- Update total open findings count

### 4. Add Execution Log

Append an entry to the Audit History table at the bottom of the report:

```
| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| YYYY-MM-DD | [version] | [score] | [model] — audit execution | AUDIT-REPORT.md (post-execution) |
```

### 5. Present Summary to User

After updating the report, present a clear summary:

```
## Audit Execution Summary

Execution Date: YYYY-MM-DD
Report: AUDIT-REPORT.md

### Results
- Total findings targeted: N
- Successfully resolved: N
- Partially resolved: N
- Failed / unresolved: N
- Skipped (human-only): N

### Remaining Human Actions
| # | Domain | Action Item | Severity | Effort |
|---|--------|-------------|----------|--------|
| ... | ... | ... | ... | ... |

### Reviewer Verdict: [SHIP / FIX-AND-SHIP / BLOCK]

### Next Steps
[Concrete list of what the user needs to do next]
```

---

## Guardrails

- **Do not fabricate findings.** Only implement items that exist in the audit report.
- **Do not skip the reviewer.** The final reviewer sub-agent is mandatory.
- **Do not modify the audit prompt.** `AUDIT.md` is read-only during execution.
- **Do not mark human-only items as done.** Only mark items that were actually implemented.
- **Preserve report structure.** When updating `AUDIT-REPORT.md`, maintain the existing markdown format, table structure, and section numbering.
- **Be honest about failures.** If a finding cannot be implemented (ambiguous, requires human judgment, blocked by missing context), report it as unresolved rather than attempting a bad fix.
- **Respect user exclusions.** Items the user explicitly excluded in the pre-execution protocol must not be implemented.

---

## Execution History

Record completed execution runs here for tracking:

| Date | Report Version | Findings Targeted | Resolved | Partial | Failed | Remaining Human |
|------|---------------|-------------------|----------|---------|--------|-----------------|
| 2026-03-05 | v3 (80/100) | 36 | 36 | 0 | 0 | 4 (#3, #4, #5, #6) |
| 2026-03-05 | v4 (82/100) | 31 | 30 | 1 | 0 | 4 (#1, #2, #3, #4) |
