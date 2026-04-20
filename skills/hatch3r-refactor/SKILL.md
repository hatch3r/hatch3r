---
name: hatch3r-refactor
id: hatch3r-refactor
description: "Internal code quality improvement without changing external behavior. Extracts methods, reduces duplication, simplifies control flow, and eliminates dead code. Use when refactoring code structure, cleaning up tech debt, addressing code smells, simplifying modules, or reorganizing code for maintainability."
tags: [core, implementation]
quality_charter: agents/shared/quality-charter.md
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

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

- Parse the issue body: motivation, proposed change, affected files, risk analysis, acceptance criteria.
- Read project quality standards and specs for the area being refactored.
- Review all existing tests — every one must still pass after refactoring.
- **Review reference implementations**: If `similar-implementation` researcher output is available, align refactored code with its extracted conventions.
- **Review resolved requirements**: If `requirements-elicitation` answers are available, use them for behavioral invariants and scope.

## Step 2: Refactor Plan

Before changing code, output:

- **Goal:** what improves (readability, performance, maintainability)
- **Strategy:** how the refactor works
- **Convention alignment:** which reference implementation's patterns the refactored code will follow (from `similar-implementation` output), with divergences noted. If no reference was provided, note "using existing codebase conventions."
- **Files to modify:** list with what changes
- **Behavioral invariant:** what must NOT change
- **Risk assessment:** what could go wrong, how to detect
- **Rollback:** how to revert if needed

## Step 3: Implement

- Refactor with minimum changes needed.
- Preserve all public interfaces and external behavior.
- Remove dead code created by the refactor.
- Do not introduce new dependencies.
- If a bug is found, document it -- fix in a separate PR.
- **Error handling preservation.** Verify error types, context, and propagation paths are unchanged after restructuring. Run error-path tests after each structural change.

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

> **Note:** When this skill is invoked via the orchestration pipeline (board-pickup or workflow commands), skip this section — the orchestrator handles agent delegation in Phases 3 and 4.

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-researcher`** — MUST spawn before implementation with modes `current-state`, `refactoring-strategy`, `migration-path`. For Tier 2+ tasks (per `hatch3r-deep-context`), also include `similar-implementation` (refactors benefit most from convention alignment — ensures the refactored code follows established patterns) and `requirements-elicitation`. Skip only for trivially simple refactors (`risk:low` AND `priority:p3`).
- **`hatch3r-reviewer`** — MUST spawn after implementation for code review, verifying behavioral preservation.

## Related Skills

- **Skill**: `hatch3r-logical-refactor` — use when the refactor changes internal logic flow while preserving external behavior
- **Skill**: `hatch3r-visual-refactor` — use when the refactor targets UI/styling changes without altering functionality

## Error Handling

- **Existing tests fail after refactor**: Do not modify tests to make them pass unless the test was verifying an implementation detail (not behavior). If a behavioral test fails, the refactor changed external behavior and must be revised.
- **Refactor scope expands beyond the original module**: If additional modules need changes due to coupling, stop and assess whether the refactor should be split into phases. Get confirmation before expanding scope.
- **Type errors after restructuring**: Resolve all type errors before running tests. If the type system reveals unexpected dependencies, document them as findings for the codebase health record.

## Definition of Done

- [ ] All existing tests pass without modification
- [ ] Regression tests added for at-risk behavior
- [ ] No new linter warnings
- [ ] Performance budgets maintained
- [ ] Dead code removed
- [ ] No external behavior changed
- [ ] No new dependencies introduced
