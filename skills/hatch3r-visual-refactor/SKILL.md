---
id: hatch3r-visual-refactor
description: UI/UX change workflow matching design, accessibility, and responsiveness requirements. Use when making visual changes, updating components, working on UI issues, or implementing design mockups.
tags: [implementation]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Visual Refactor Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read the issue, mockups, and design system
- [ ] Step 2: Produce a visual change plan
- [ ] Step 3: Implement matching the mockup
- [ ] Step 4: Verify accessibility and responsiveness
- [ ] Step 5: Open PR with before/after screenshots
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: mockup source (provided vs derived from design system), reuse vs extend vs create verdict from `hatch3r-design-system-detect`, responsive breakpoint set, animation budget, and snapshot-regeneration authority.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Read Inputs

- Parse the issue body: proposed changes, before/after mockups, affected surfaces, accessibility checklist, responsiveness requirements.
- Read project quality documentation (accessibility, animation budgets).
- Invoke `hatch3r-design-system-detect` to produce the Design System Inventory (`skills/hatch3r-design-system-detect/SKILL.md`). Use the inventory to choose between reuse / extend / create paths. Skipping detection is a regression — visual refactors that invent new tokens or duplicate primitives are rejected at review.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Visual Change Plan

Before modifying code, output:

- **Surfaces affected:** list with stable IDs
- **Components to modify/create:** list (prefer modifying existing)
- **Design tokens used:** colors, spacing, typography
- **Accessibility approach:** how WCAG AA compliance is achieved
- **Responsiveness:** how it adapts across widget/panel sizes
- **Animation changes:** new/modified animations, frame budget

## Step 3: Implement

- Match the mockup/screenshot exactly. Do not improvise design.
- Use existing design system tokens and components.
- Verify animations respect `prefers-reduced-motion` by enabling the media query in DevTools and confirming animations are disabled or simplified.
- Verify color contrast meets WCAG AA (4.5:1 for text) using a contrast checker tool.
- Verify interactive elements are keyboard accessible by tabbing through them and confirming visible focus indicators.
- Add ARIA attributes for screen reader support.

## Step 4: Verify

### 4a. Automated Checks

- Snapshot tests updated for all modified components.
- Animations at 60fps (if applicable).

```bash
npm run lint && npm run typecheck && npm run test
```

### 4b. Browser Verification

- Confirm the dev server is running by checking the expected port. If not running, start it in the background.
- Navigate to every surface affected by the visual change.
- Compare the rendered result against the mockup or design from the issue.
- Test at multiple viewport sizes if the change affects responsive behavior.
- Tab through interactive elements to verify keyboard accessibility and visible focus indicators.
- Check color contrast on new or changed text and backgrounds.
- If animations were changed, verify they play at 60fps and respect `prefers-reduced-motion`.
- Check the browser console for errors or warnings.
- Capture before/after screenshots for the PR. If a "before" screenshot was not taken prior to implementation, note this in the PR.
- Verify no visual regressions on unaffected surfaces adjacent to the change.

## Step 5: Open PR

Use the project's PR template. Include:

- Before/after screenshots (required)
- Accessibility verification evidence
- Responsive behavior across sizes

## Error Handling

- **No design mockup or reference provided**: Ask the user for a design reference before implementing. If none is available, propose the design based on existing design system tokens and get approval before proceeding.
- **Snapshot tests fail after visual changes**: Update the snapshots only after visually verifying the new rendering is correct. Do not blindly update snapshots without visual confirmation.
- **Component renders differently across browsers**: Test in at least two browser engines. Document browser-specific rendering differences and fix those that affect usability or accessibility.

## Definition of Done

- [ ] UI matches mockup/design in the issue
- [ ] Color contrast >= 4.5:1 (WCAG AA)
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Interactive elements keyboard accessible
- [ ] ARIA attributes for screen readers
- [ ] Responsive across applicable host sizes
- [ ] Snapshot tests updated
- [ ] No visual regressions
- [ ] Design system tokens used (no ad-hoc styling)
