---
id: hatch3r-feature
name: hatch3r-feature
type: skill
description: End-to-end feature implementation workflow. Covers data model, domain logic, API, and UI as a vertical slice. Use when implementing new features or working on feature request issues.
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Feature Implementation Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read the issue and all relevant specs
- [ ] Step 1c: Design System Inventory (if UI) — invoke `hatch3r-design-system-detect`
- [ ] Step 2: Produce an implementation plan
- [ ] Step 2b: Test-first approach (TDD alternative — optional)
- [ ] Step 3: Implement the vertical slice
- [ ] Step 4: Write tests (unit, integration, security, E2E)
- [ ] Step 5: Verify quality gates
- [ ] Step 5b: Browser verification (if UI)
- [ ] Step 5c: UI/UX Verification Gate (if UI) — invoke `hatch3r-ui-ux-verify`; all 9 gates must pass before Step 6
- [ ] Step 6: Open PR
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target files, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: acceptance criteria incomplete or untestable, data shape or error behavior unspecified, UI states (loading/empty/error/partial) undefined, security/entitlement model unstated, or the change requires a schema/API migration with downstream consumers. If the orchestrator already supplied `requirements-elicitation` answers, read them first (Step 1) and ask only about residual gaps.

## Step 1: Read Inputs

- Parse the issue body: problem/goal, proposed solution, acceptance criteria, scope (in/out), UX notes, edge cases, security considerations, rollout plan.
- Read relevant project documentation (glossary, user flows, behavior, event model, data model, privacy, monetization, as applicable).
- Review existing code patterns in the affected area.
- **Review reference implementations**: If the orchestrator provided `similar-implementation` researcher output, read the reference implementations and their extracted conventions. These define the patterns this feature should follow (file structure, state management, error handling, data fetching, test structure, component composition).
- **Review resolved requirements**: If the orchestrator provided `requirements-elicitation` answers, read them to understand explicit user decisions on ambiguities (data shape, error behavior, UI states, security model, etc.). Do not guess when explicit answers are available.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 1c: Design System Inventory (if UI)

Skip this step if acceptance criteria do not touch UI (no new component, no new page or route, no modification to an existing component or visual surface, no design-token change). Trigger: any file path matching `**/*.{tsx,jsx,vue,svelte}` or `**/components/**` would be created or modified.

- Invoke `skills/hatch3r-design-system-detect` BEFORE writing any UI code. The skill produces a Design System Inventory: token source, component-library version, breakpoint set, theming convention, reuse-vs-extend-vs-create verdict.
- Embed the inventory in the Step 2 plan under "Convention alignment" so the implementer can choose reuse > extend > create per `rules/hatch3r-design-system-detection.md`.
- Skipping detection is a regression — features that invent new tokens or duplicate primitives are rejected at the Step 5c verdict.

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
${HATCH3R:VERIFY_GATE_ALL}
```

Resolved to the project's language-aware gate at sync time (fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`).

## Step 5b: Browser Verification (if UI)

Skip this step if the feature has no user-facing UI changes.

- Confirm the dev server is running by checking the expected port. If not running, start it in the background.
- Navigate to the page or surface affected by the new feature.
- Walk through the acceptance criteria visually — confirm the feature renders and behaves as specified in the issue.
- Interact with new UI elements: click, type, trigger state transitions.
- Check the browser console for errors or warnings.
- If the feature is responsive, test at different viewport sizes.
- Capture screenshots showing the feature working as expected.

## Step 5c: UI/UX Verification Gate (if UI)

Skip this step if the feature has no user-facing UI changes. Trigger: same surface match as Step 1c (`**/*.{tsx,jsx,vue,svelte}` or `**/components/**`). Browser verification (Step 5b) records that the surface renders; this step records that the surface meets the CQ1/CQ2/CQ7 measurement floor.

- Invoke `skills/hatch3r-ui-ux-verify` after Step 5b and BEFORE Step 6 (PR open).
- Record a single-line verdict per gate in the format `GATE_N: PASS|FAIL <evidence-path>` and aggregate them in the PR description.
- A single FAIL on a required gate blocks PR opening regardless of browser-verification screenshots or QA-validation status. Resolve the failing gate or surface a BLOCKED report to the orchestrator with the failing gate + evidence; do not open the PR.
- Gate 9 (manual screen-reader pass) is required at release-cut time only; PR-time runs skip Gate 9 per the skill's "When this skill runs" section.

## Step 6: Open PR

Use the project's PR template. Include:

- Feature summary and motivation
- Implementation approach
- Screenshots/recordings (if UI)
- Test evidence
- Rollout plan (feature flag if specified)

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file feature): inline execution acceptable.
- Tier 2 (multi-file or multi-concern feature): spawn parallel sub-agents per concern (researcher modes, one implementer per sub-issue) via the Task tool.
- Tier 3 (multi-module / cross-cutting feature): one fresh sub-agent per independent module or CQ gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

Source: `rules/hatch3r-fan-out-discipline.md` (P8 B2); `agents/shared/efficiency-patterns.md`.

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
- [ ] Design System Inventory recorded via `skills/hatch3r-design-system-detect` (if UI)
- [ ] Browser-verified against acceptance criteria (if UI)
- [ ] UI/UX Verification Gate (`skills/hatch3r-ui-ux-verify`) — all 9 gates report PASS (if UI):
  - [ ] **Gate 1** — Automated a11y scan (axe-core via Playwright): 0 serious + 0 critical violations on every interactive route; WCAG 2.2 AA target including SC 2.5.8 / SC 2.4.11 / SC 2.5.7. Specialist: `hatch3r-ui` (CQ1). Trigger: any change touching a route or component file in scope.
  - [ ] **Gate 2** — Scripted keyboard trace: 100% interactive elements reached, 0 traps, 0 focus-visibility failures. Specialist: `hatch3r-ux` (CQ2 flow ownership) cross-referenced with `hatch3r-ui` (focus management). Trigger: any keyboard-reachable element added or modified.
  - [ ] **Gate 3** — Accessibility-tree snapshot: exactly one `<h1>` per route, landmark coverage (`banner`/`main`/`nav`/`contentinfo`), every form input labelled, every image has `alt` or `role="presentation"`. Specialist: `hatch3r-ui` (CQ1). Trigger: structural change to a route or page.
  - [ ] **Gate 4** — Four-state coverage check: `loading` + `empty` + `error` + `partial` snapshots present for every async surface per `rules/hatch3r-ux-states-and-flows.md`. Specialist: `hatch3r-ui` (CQ1 four-state contract owner). Trigger: any `useQuery` / `useSWR` / `fetch` / `axios` introduced or modified.
  - [ ] **Gate 5** — Visual regression baseline: 0 unintentional drift via `playwright.toHaveScreenshot()` or Chromatic/Percy; baselines committed. Specialist: `hatch3r-ui` (CQ1). Trigger: layout-affecting CSS, template, or token change.
  - [ ] **Gate 6** — Microcopy lint: no filler tokens ("oops", "whoops", "something went wrong"), corrective verb in every error string, `autocomplete` attribute on `email`/`password`/`name`/`address` inputs. Specialist: `hatch3r-ux` (CQ2 microcopy owner). Trigger: any user-facing string added or modified.
  - [ ] **Gate 7** — Core Web Vitals (p75, mobile slow-4G + 4x CPU throttle): LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 per CQ7 (see `agents/shared/principles.md`). Specialist: `hatch3r-performance` (CQ7). Trigger: any change to the route's render tree, hydration, or critical-path asset.
  - [ ] **Gate 8** — AI-UX checks (when feature ships LLM-driven UI): streaming hooks in use, tool-call cards visible by default, human-approval gates on side-effectful tools, cancel/abort wired to an `AbortController`. Specialist: `hatch3r-ui` (CQ1) cross-referenced with `hatch3r-ux` (CQ2) per `rules/hatch3r-ai-ux-patterns.md`. Trigger: any `useChat` / `useCompletion` / `streamUI` import or LLM-output rendering surface.
  - [ ] **Gate 9** — Manual screen-reader pass (per release, not per PR): one human pass with VoiceOver or NVDA on the key user flow; trace documented in release notes. Specialist: `hatch3r-ux` (CQ2 human verification owner). Trigger: release-cut; skipped on per-PR runs.
- [ ] Performance budgets maintained
- [ ] Privacy invariants respected
- [ ] Rollout plan documented
- [ ] Relevant spec docs updated

## References

- [WCAG 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/) — accessed 2026-05-31, official-docs (W3C). Source for the WCAG 2.2 AA target and the specific success criteria (SC 2.5.8 Target Size (Minimum), SC 2.4.11 Focus Not Obscured (Minimum), SC 2.5.7 Dragging Movements) named in Gate 1.
- [Core Web Vitals — web.dev](https://web.dev/articles/vitals) — accessed 2026-05-31, official-docs (Google / Chrome team). Source for the Gate 7 p75 thresholds (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) and the mobile-throttle measurement basis.
