---
id: hatch3r-logical-refactor
description: Workflow for changing behavior or logic flow without adding new features or overhauling UI. Use when modifying business logic, data flows, behavioral rules, or working on logical refactor issues.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Logical Refactor Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue, specs, and existing tests
- [ ] Step 2: Produce a change plan
- [ ] Step 3: Implement the behavior change
- [ ] Step 4: Update tests and verify invariants
- [ ] Step 5: Open PR
```

## Step 1: Read Inputs

- Parse the issue body: motivation, before/after behavior, invariants preserved, invariants changed, acceptance criteria, affected files, risk analysis, testing plan.
- Read relevant project documentation: behavior engine, event model, data model, privacy, quality.
- Review existing tests to understand what behavior is currently asserted.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Change Plan

Before modifying code, output:

- **Current behavior:** how it works now
- **New behavior:** how it will work after
- **Invariants preserved:** list from issue + specs
- **Invariants changed:** list, with justification
- **Cascading effects:** which other flows/components are affected
- **Files to modify:** list with what changes
- **Risks:** what could go wrong

## Step 3: Implement

- Implement behavior change as described in the before/after section.
- Verify every listed invariant is maintained (or explicitly updated with justification).
- Update any spec docs affected by the behavior change.

## Step 4: Test

- **Update existing tests** that assert old behavior to assert new behavior.
- **Add new tests** for the new behavior, especially edge cases.
- **Regression tests** for preserved invariants.
- **Integration tests** if change affects cross-module interactions.

```bash
npm run lint && npm run typecheck && npm run test
```

## Step 5: Open PR

Use the project's PR template. Include:

- Before/after behavior with concrete examples
- Invariants preserved and changed
- Test evidence for both new behavior and preserved behavior
- Spec docs updated (if any)

## Definition of Done

- [ ] New behavior matches the "after" description
- [ ] All preserved invariants verified with tests
- [ ] Changed invariants documented and justified
- [ ] Existing tests updated, new tests added
- [ ] Performance budgets maintained
- [ ] Privacy/security invariants respected
- [ ] Spec docs updated if behavior diverges from spec
