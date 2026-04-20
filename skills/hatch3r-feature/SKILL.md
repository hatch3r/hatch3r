---
name: hatch3r-feature
id: hatch3r-feature
description: "End-to-end feature implementation workflow. Creates database migrations, implements service logic, builds API endpoints, and scaffolds UI components as a vertical slice. Use when implementing new features, building new functionality, working on feature request issues, or delivering a full-stack user story."
tags: [core, implementation]
quality_charter: agents/shared/quality-charter.md
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

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

- Parse the issue body: problem/goal, acceptance criteria, scope (in/out), edge cases, security considerations.
- Read relevant project documentation (glossary, data model, user flows, as applicable).
- Review existing code patterns in the affected area.
- **Review reference implementations**: If `similar-implementation` researcher output is available, follow its extracted conventions for file structure, state management, error handling, and test structure.
- **Review resolved requirements**: If `requirements-elicitation` answers are available, use them for explicit decisions on ambiguities. Do not guess when explicit answers exist.

## Step 2: Implementation Plan

Before coding, output:

- **Approach:** high-level strategy
- **Convention alignment:** which reference implementation's patterns this follows (from `similar-implementation` output), with divergences noted and justified. If no reference was provided, note "no reference — using best judgment from codebase conventions."
- **Files to create/modify:** list with what changes
- **Data model changes:** new collections/fields, if any
- **Event changes:** new event types, if any
- **Entitlement changes:** new gates, if any
- **Risks:** what could go wrong
- **Phasing:** how to split into PRs if large

## Step 2b: Test-First Approach (TDD Alternative)

When acceptance criteria are specific and testable, write failing tests BEFORE implementing:

1. **Write acceptance tests** from the issue's criteria — each criterion becomes at least one test.
2. **Run all new tests** — confirm they fail with the expected behavior gap, not a setup error.
3. **Implement the vertical slice** (Step 3) to make tests pass incrementally.
4. **Add edge case tests** as discovered during implementation.

## Step 3: Implement

- Deliver a complete vertical slice (data -> logic -> UI).
- Follow the convention lock from Step 1 / the implementer's Step 1b -- match the reference implementation's patterns for file structure, state management, error handling, data fetching, and testing. Do not invent new patterns when established ones exist in the codebase.
- Use stable IDs from the project glossary.
- If database/backend data is needed, include security rules updates.
- If feature is gated, enforce entitlements client-side AND server-side.
- If new events, follow the project's event schema.
- **Error handling for new code paths.** Every new function that can fail must use the project's error handling patterns (Result types for expected failures, custom error classes for domain errors, error boundaries at architectural boundaries). Do not defer error handling to "a future PR" -- incomplete error handling is a Critical review finding.

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

- Confirm the dev server is running by checking the expected port. If not running, start it in the background.
- Navigate to the page or surface affected by the new feature.
- Walk through the acceptance criteria visually — confirm the feature renders and behaves as specified in the issue.
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

> **Note:** When this skill is invoked via the orchestration pipeline (board-pickup or workflow commands), skip this section — the orchestrator handles agent delegation in Phases 3 and 4.

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-researcher`** — MUST spawn before implementation with modes `codebase-impact`, `feature-design`, `architecture`. For Tier 2+ tasks (per `hatch3r-deep-context`), also include `similar-implementation` and `requirements-elicitation`. Skip only for trivially simple features (`risk:low` AND `priority:p3`).
- **`hatch3r-implementer`** — MUST spawn one per sub-issue when the feature is decomposed into multiple tasks. Each implementer receives its own sub-issue context, plus reference conventions and resolved requirements from the researcher output.
- **`hatch3r-reviewer`** — MUST spawn after implementation for code review before PR creation.

## Related Skills

- **Skill**: `hatch3r-qa-validation` — use this skill for end-to-end verification of the implemented feature

## Error Handling

- **Acceptance criteria are ambiguous or incomplete**: Stop implementation, document the specific ambiguities, and ask the user for clarification before proceeding. Do not guess at requirements.
- **Feature touches a module with no existing tests**: Write foundational tests for the existing behavior first, then implement the feature. This prevents regressions in untested code.
- **Database migration fails or is irreversible**: Test the migration against a local database or emulator before applying. If rollback is needed, verify the down-migration restores the original schema.

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
