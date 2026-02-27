---
id: hatch3r-visual-refactor
description: UI/UX change workflow matching design, accessibility, and responsiveness requirements. Use when making visual changes, updating components, working on UI issues, or implementing design mockups.
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Visual Refactor Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue, mockups, and design system
- [ ] Step 2: Produce a visual change plan
- [ ] Step 3: Implement matching the mockup
- [ ] Step 4: Verify accessibility and responsiveness
- [ ] Step 5: Open PR with before/after screenshots
```

## Step 1: Read Inputs

- Parse the issue body: proposed changes, before/after mockups, affected surfaces, accessibility checklist, responsiveness requirements.
- Read project quality documentation (accessibility, animation budgets).
- Review the existing design system tokens and component hierarchy.
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
- Ensure animations respect `prefers-reduced-motion`.
- Ensure color contrast meets WCAG AA (4.5:1 for text).
- Ensure interactive elements are keyboard accessible with focus indicators.
- Add ARIA attributes for screen reader support.

## Step 4: Verify

### 4a. Automated Checks

- Snapshot tests updated for all modified components.
- Animations at 60fps (if applicable).

```bash
npm run lint && npm run typecheck && npm run test
```

### 4b. Browser Verification

- Ensure the dev server is running. If not, start it in the background.
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
