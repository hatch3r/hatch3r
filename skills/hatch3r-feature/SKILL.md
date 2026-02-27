---
id: hatch3r-feature
description: End-to-end feature implementation workflow. Covers data model, domain logic, API, and UI as a vertical slice. Use when implementing new features or working on feature request issues.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Feature Implementation Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue and all relevant specs
- [ ] Step 2: Produce an implementation plan
- [ ] Step 2b: Test-first approach (TDD alternative — optional)
- [ ] Step 3: Implement the vertical slice
- [ ] Step 4: Write tests (unit, integration, security, E2E)
- [ ] Step 5: Verify quality gates
- [ ] Step 5b: Browser verification (if UI)
- [ ] Step 6: Open PR
```

## Step 1: Read Inputs

- Parse the issue body: problem/goal, proposed solution, acceptance criteria, scope (in/out), UX notes, edge cases, security considerations, rollout plan.
- Read relevant project documentation (glossary, user flows, behavior, event model, data model, privacy, monetization, as applicable).
- Review existing code patterns in the affected area.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Implementation Plan

Before coding, output:

- **Approach:** high-level strategy
- **Files to create/modify:** list with what changes
- **Data model changes:** new collections/fields, if any
- **Event changes:** new event types, if any
- **Entitlement changes:** new gates, if any
- **Risks:** what could go wrong
- **Phasing:** how to split into PRs if large

## Step 2b: Test-First Approach (TDD Alternative)

When acceptance criteria are specific and testable, write tests BEFORE implementing:

1. **Write acceptance tests** from the issue's acceptance criteria. Each criterion becomes at least one test.
2. **Write unit test shells** for planned functions/modules from the implementation plan.
3. **Run all new tests** — confirm they fail (proves they're testing real behavior, not tautologies).
4. **Implement the vertical slice** (Step 3) to make tests pass incrementally.
5. **Add edge case tests** as you discover them during implementation.

Prefer TDD when:
- Acceptance criteria are specific and quantifiable
- Building a well-defined API, service, or utility
- Working in a domain with complex business logic

Use standard flow (implement → test) when:
- Acceptance criteria are exploratory ("improve UX of...")
- Heavy UI work where visual verification is primary
- Prototyping or spike work

## Step 3: Implement

- Deliver a complete vertical slice (data -> logic -> UI).
- Use stable IDs from the project glossary.
- If database/backend data is needed, include security rules updates.
- If feature is gated, enforce entitlements client-side AND server-side.
- If new events, follow the project's event schema.

## Step 4: Tests

- **Unit tests:** All new business logic.
- **Integration tests:** Cross-module interactions.
- **Security rules tests:** If database collections/rules modified.
- **Contract tests:** If new event types or API contracts.
- **E2E tests:** If user-facing flow.

## Step 5: Verify

```bash
npm run lint && npm run typecheck && npm run test
```

## Step 5b: Browser Verification (if UI)

Skip this step if the feature has no user-facing UI changes.

- Ensure the dev server is running. If not, start it in the background.
- Navigate to the page or surface affected by the new feature.
- Walk through the acceptance criteria visually — confirm the feature renders and behaves correctly.
- Interact with new UI elements: click, type, trigger state transitions.
- Check the browser console for errors or warnings.
- If the feature is responsive, test at different viewport sizes.
- Capture screenshots showing the feature working as expected.

## Step 6: Open PR

Use the project's PR template. Include:

- Feature summary and motivation
- Implementation approach
- Screenshots/recordings (if UI)
- Test evidence
- Rollout plan (feature flag if specified)

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-researcher`** — MUST spawn before implementation with modes `codebase-impact`, `feature-design`, `architecture`. Skip only for trivially simple features (`risk:low` AND `priority:p3`).
- **`hatch3r-implementer`** — MUST spawn one per sub-issue when the feature is decomposed into multiple tasks. Each implementer receives its own sub-issue context.
- **`hatch3r-reviewer`** — MUST spawn after implementation for code review before PR creation.

## Related Skills

- **Skill**: `hatch3r-qa-validation` — use this skill for end-to-end verification of the implemented feature

## Definition of Done

- [ ] All acceptance criteria met
- [ ] Unit + integration tests cover new logic
- [ ] Security rules tested (if data model changed)
- [ ] Entitlement gates enforced server-side (if gated)
- [ ] Accessibility requirements met (if UI)
- [ ] Browser-verified against acceptance criteria (if UI)
- [ ] Performance budgets maintained
- [ ] Privacy invariants respected
- [ ] Rollout plan documented
- [ ] Relevant spec docs updated
