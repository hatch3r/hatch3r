---
id: hatch3r-refactor
description: Internal code quality improvement workflow without changing external behavior. Use when refactoring code structure, simplifying modules, or improving maintainability.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Code Refactor Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue, specs, and existing tests
- [ ] Step 2: Produce a refactor plan
- [ ] Step 3: Implement with behavioral preservation
- [ ] Step 4: Verify all tests pass, add regression tests
- [ ] Step 5: Open PR
```

## Step 1: Read Inputs

- Parse the issue body: motivation, proposed change, affected files, safety plan, risk analysis, acceptance criteria.
- Read project quality standards documentation.
- Read specs for the area being refactored.
- Review all existing tests — every one must still pass after refactoring.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Refactor Plan

Before changing code, output:

- **Goal:** what improves (readability, performance, maintainability)
- **Strategy:** how the refactor works
- **Files to modify:** list with what changes
- **Behavioral invariant:** what must NOT change
- **Risk assessment:** what could go wrong, how to detect
- **Rollback:** how to revert if needed

## Step 3: Implement

- Refactor with minimum changes needed.
- Preserve all public interfaces and external behavior.
- Remove dead code created by the refactor.
- Do not introduce new dependencies.
- If a bug is found, document it — fix in a separate PR.

## Step 4: Verify

- All existing tests must pass without modification.
- Add regression tests for previously untested at-risk behavior.
- Performance verification if refactored code is on a hot path.

```bash
npm run lint && npm run typecheck && npm run test
```

## Step 5: Open PR

Use the project's PR template. Include:

- Motivation (why this refactor now)
- Before/after structure (high-level description)
- Proof of behavioral preservation (test results)
- Performance impact (if applicable)

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-researcher`** — MUST spawn before implementation with modes `current-state`, `refactoring-strategy`, `migration-path`. Skip only for trivially simple refactors (`risk:low` AND `priority:p3`).
- **`hatch3r-reviewer`** — MUST spawn after implementation for code review, verifying behavioral preservation.

## Related Skills

- **Skill**: `hatch3r-logical-refactor` — use when the refactor changes internal logic flow while preserving external behavior
- **Skill**: `hatch3r-visual-refactor` — use when the refactor targets UI/styling changes without altering functionality

## Definition of Done

- [ ] All existing tests pass without modification
- [ ] Regression tests added for at-risk behavior
- [ ] No new linter warnings
- [ ] Performance budgets maintained
- [ ] Dead code removed
- [ ] No external behavior changed
- [ ] No new dependencies introduced
