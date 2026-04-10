---
id: hatch3r-bug-fix
description: Step-by-step bug fix workflow. Diagnose root cause, implement minimal fix, write regression test. Use when fixing bugs, working on bug report issues, or when the user mentions a bug.
tags: [core, implementation]
quality_charter: agents/shared/quality-charter.md
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Bug Fix Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue and relevant specs
- [ ] Step 2: Produce a diagnosis plan
- [ ] Step 2b: Browser reproduction (if UI bug)
- [ ] Step 2c: Test-first approach (TDD alternative — optional)
- [ ] Step 3: Implement minimal fix
- [ ] Step 4: Write regression test
- [ ] Step 5: Verify all tests pass
- [ ] Step 5b: Browser verification (if UI bug)
- [ ] Step 6: Open PR
```

## Step 1: Read Inputs

- Parse the issue body: problem description, reproduction steps, expected/actual behavior, severity, affected area.
- Read relevant project documentation based on affected area (see spec mapping in project context).
- Review existing tests in the affected area.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Diagnosis Plan

Before fixing, output:

- **Root cause hypothesis:** what is wrong and why (distinguish between the symptom the user reported and the underlying cause)
- **Files to investigate:** list of files with reason each file is relevant
- **Reproduction strategy:** how to confirm the bug via tests (specific test scenario, expected vs. actual result)
- **Error handling check:** does the affected code have proper error handling? If the bug is caused by a missing or incorrect error path, note this explicitly
- **Risks:** what could go wrong with the fix (regression risk, related code paths that could be affected)
- **Confidence:** high/medium/low for the hypothesis. If low, describe what additional investigation is needed before proceeding

## Step 2b: Browser Reproduction (if UI Bug)

Skip this step if the bug has no visual or interactive symptoms.

- Confirm the dev server is running by checking the expected port. If not running, start it in the background.
- Navigate to the page where the bug manifests.
- Follow the reproduction steps from the issue to confirm the bug is observable.
- Take a screenshot of the broken state as baseline evidence.
- Note any browser console errors or warnings associated with the bug.

## Step 2c: Test-First Approach (TDD Alternative)

When the root cause is clear from diagnosis, write the regression test BEFORE implementing the fix:

1. **Write a failing test** that reproduces the exact bug scenario from the issue's reproduction steps.
2. **Run the test** — confirm it fails with the expected symptom (not a setup error).
3. **Implement the minimal fix** (Step 3) to make the test pass.
4. **Verify** the test now passes AND no other tests broke.

This approach guarantees the fix addresses the actual bug and prevents regression. Prefer TDD when:
- The bug has clear reproduction steps
- The affected code has existing test infrastructure
- The root cause is well-understood from Step 2

Skip TDD and use the standard flow (Steps 3→4) when:
- The bug requires exploratory debugging to locate
- Test infrastructure needs setup first
- The fix involves configuration or environment changes

## Step 3: Minimal Fix

- Fix the root cause with minimal changes.
- Do not refactor unrelated code.
- Do not introduce new dependencies unless absolutely necessary.
- Remove dead code created by the fix.

## Step 4: Regression Test

- Write a test that **fails before** the fix and **passes after**.
- Add edge case tests if the bug reveals coverage gaps.
- Run the full test suite and confirm 0 failures — all existing tests still pass.

## Step 5: Verify

```bash
npm run lint && npm run typecheck && npm run test
```

## Step 5b: Browser Verification (if UI Bug)

Skip this step if the bug had no visual or interactive symptoms.

- Navigate to the same page where the bug was reproduced in Step 2b.
- Follow the original reproduction steps — confirm the bug is now fixed.
- Take a screenshot of the corrected state.
- Verify no new visual regressions were introduced in the surrounding UI.
- Check the browser console for errors or warnings.

## Step 6: Open PR

Use the project's PR template. Include:

- Root cause explanation
- Fix description with before/after behavior
- Test evidence
- Rollback plan (required for P0/P1)

## Required Agent Delegation

> **Note:** When this skill is invoked via the orchestration pipeline (board-pickup or workflow commands), skip this section — the orchestrator handles agent delegation in Phases 3 and 4.

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-researcher`** — MUST spawn before implementation with modes `symptom-trace`, `root-cause`, `codebase-impact`. For Tier 2+ tasks (per `hatch3r-deep-context`), also include `requirements-elicitation` (bugs often have underspecified reproduction steps and ambiguous expected behavior). Skip only for trivially simple bugs (`risk:low` AND `priority:p3`).
- **`hatch3r-test-writer`** — MUST spawn after fix implementation to write regression tests covering the fixed behavior and related edge cases.
- **`hatch3r-reviewer`** — MUST spawn after implementation for code review before PR creation.

## Related Skills

- **Skill**: `hatch3r-qa-validation` — use this skill for end-to-end verification of the bug fix

## Error Handling

- **Root cause cannot be identified**: If tracing reaches a dead end, document the investigation path taken, the hypotheses eliminated, and recommend additional instrumentation (debug logging, reproduction steps) to narrow down the cause.
- **Fix introduces test failures elsewhere**: Analyze whether the failing tests relied on the buggy behavior. Update those tests if they were testing incorrect expectations; otherwise, rethink the fix approach.
- **Bug is in a third-party dependency**: If the root cause is in external code, implement a workaround with a code comment linking to the upstream issue, and file or reference the upstream bug report.

## Definition of Done

- [ ] Root cause identified and documented in PR
- [ ] Fix implemented with minimal diff
- [ ] Regression test written
- [ ] All existing tests pass
- [ ] No new linter warnings
- [ ] Browser-verified fix (if UI bug)
- [ ] Performance budgets maintained
- [ ] Security/privacy invariants respected
- [ ] If P0/P1: rollback plan documented
