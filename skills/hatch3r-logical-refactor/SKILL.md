---
id: hatch3r-logical-refactor
name: hatch3r-logical-refactor
type: skill
description: Workflow for changing behavior or logic flow without adding new features or overhauling UI. Use when modifying business logic, data flows, behavioral rules, or working on logical refactor issues.
tags: [implementation]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Logical Refactor Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read the issue, specs, and existing tests
- [ ] Step 2: Produce a change plan
- [ ] Step 3: Implement the behavior change
- [ ] Step 4: Update tests and verify invariants
- [ ] Step 5: Open PR
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: invariants to preserve vs change, before/after behavior specification, downstream consumer impact, spec update authority (this PR vs follow-up), and characterization-test requirement when current behavior is undertested.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

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

## Error Handling

- **Behavioral invariant violated during refactor**: If a test that should pass now fails, check whether the invariant was incorrectly preserved or whether the refactor inadvertently changed behavior. Fix the refactor, not the test, unless the test was wrong.
- **Refactor scope grows beyond the original task**: If additional modules need changes to complete the refactor, stop, document the expanded scope, and get confirmation before continuing.
- **Cannot verify behavioral equivalence due to missing tests**: Write characterization tests for the current behavior before applying the refactor. This provides a safety net for the transformation.

## Definition of Done

- [ ] New behavior matches the "after" description
- [ ] All preserved invariants verified with tests
- [ ] Changed invariants documented and justified
- [ ] Existing tests updated, new tests added
- [ ] Performance budgets maintained
- [ ] Privacy/security invariants respected
- [ ] Spec docs updated if behavior diverges from spec
