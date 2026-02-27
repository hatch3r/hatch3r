---
id: hatch3r-a11y-audit
description: Comprehensive WCAG AA accessibility audit with findings and fixes. Use when auditing accessibility, verifying WCAG compliance, or improving a11y across the application.
---
# Accessibility Audit Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read accessibility requirements from rules and specs
- [ ] Step 2: Automated scan — run axe-core or similar on all pages/components
- [ ] Step 3: Manual audit — keyboard, contrast, ARIA, reduced motion, screen reader
- [ ] Step 4: Catalog findings by severity (critical/major/minor)
- [ ] Step 5: Fix critical and major findings
- [ ] Step 6: Verify fixes with re-scan and manual check
```

## Step 1: Read Accessibility Requirements

**From project component rules (Accessibility section):**

- All animations: wrap in `prefers-reduced-motion` media query AND check user's reduced motion setting.
- Color contrast: ≥ 4.5:1 for text (WCAG AA).
- Interactive elements: keyboard focusable with visible focus indicator.
- Dynamic content changes: use `aria-live` regions.
- Support high contrast mode.

**From project quality documentation:**

| Requirement         | Standard | Details                                                          |
| ------------------- | -------- | ---------------------------------------------------------------- |
| Reduced motion      | WCAG 2.1 | All animations respect `prefers-reduced-motion` and user setting |
| Color contrast      | WCAG AA  | Text contrast ratio ≥ 4.5:1                                      |
| Keyboard navigation | WCAG 2.1 | All interactive elements focusable and operable via keyboard     |
| Screen reader       | WCAG 2.1 | Dynamic state and reactions announced via ARIA live regions      |
| High contrast mode  | Custom   | User-configurable high contrast theme (if applicable)            |

- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Automated Scan

- Install and run `@axe-core/vue`, `vitest-axe`, or Playwright's `@axe-core/playwright` on all pages and key components.
- Run against: main routes, key components (if testable in isolation).
- Capture all violations. Map to WCAG criteria (e.g., 1.1.1, 1.4.3, 2.1.1, 4.1.2).
- Document: rule ID, description, impact, elements affected, WCAG level.

## Step 3: Manual Audit

**Keyboard navigation:**

- Tab through all interactive elements. Ensure logical order, no focus traps.
- All buttons, links, inputs, custom controls focusable.
- Visible focus indicator (outline or ring) — no `outline: none` without replacement.
- Escape closes modals/dropdowns. Enter/Space activates buttons.

**Color contrast:**

- Check text vs background: ≥ 4.5:1 for normal text, ≥ 3:1 for large text.
- Use DevTools or contrast checker. Test with design tokens — ensure no ad-hoc colors fail.

**ARIA attributes:**

- `aria-label` or `aria-labelledby` for icon-only buttons, custom controls.
- `aria-live="polite"` or `aria-live="assertive"` for dynamic state changes, notifications.
- `role` correct for custom widgets (button, link, tab, etc.).
- `aria-expanded`, `aria-selected`, `aria-hidden` where appropriate.

**Reduced motion:**

- Test with `prefers-reduced-motion: reduce` (DevTools → Rendering → Emulate CSS media).
- Verify animations are disabled or simplified. Check user's reduced motion setting.
- No motion-dependent information (per WCAG 2.1).

**Screen reader:**

- Test with NVDA, VoiceOver, or similar. Verify announcements for dynamic content.
- Dynamic state, errors, and success messages announced.
- Form labels associated, error messages linked via `aria-describedby` or `aria-errormessage`.

**High contrast mode:**

- Verify user-configurable high contrast theme works (if applicable). No loss of information.

## Step 4: Catalog Findings

| Severity | Definition                              | Examples                                                      |
| -------- | --------------------------------------- | ------------------------------------------------------------- |
| Critical | Blocks core functionality, fails WCAG A | Missing form labels, no keyboard access to primary actions    |
| Major    | Significant barrier, fails WCAG AA      | Contrast < 4.5:1, missing focus indicators, no reduced motion |
| Minor    | Improves experience, best practice       | Redundant labels, suboptimal heading order                    |

- Produce a findings table: ID, severity, WCAG criterion, description, location, fix suggestion.
- Prioritize: critical first, then major. Minor can be batched.

## Step 5: Fix Critical and Major Findings

- Implement fixes following project component and quality requirements.
- Use semantic HTML where possible (`<button>`, `<a>`, `<nav>`, `<main>`).
- Add `aria-*` attributes for custom components.
- Ensure `prefers-reduced-motion` respected in CSS and JS.
- Add or fix focus styles. Use design tokens for focus ring.
- Verify reduced-motion behavior in tests.

## Step 6: Verify Fixes

- Re-run automated scan. No critical or major violations.
- Manual keyboard and screen reader check on fixed areas.
- Run full test suite to ensure no regressions.
- Document remaining minor findings for future backlog.

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-a11y-auditor`** — MUST spawn to perform the full WCAG AA compliance audit autonomously. Provide the list of surfaces/components to audit and the current violation list.

## Related Rules

- **Rule**: `hatch3r-browser-verification` — follow this rule for live browser-based accessibility testing

## Definition of Done

- [ ] No critical a11y violations
- [ ] WCAG AA compliance on all audited surfaces
- [ ] Reduced motion respected (`prefers-reduced-motion` + user setting)
- [ ] Keyboard navigation complete with visible focus
- [ ] Color contrast ≥ 4.5:1 for text
- [ ] ARIA live regions for dynamic content
- [ ] Automated scan clean for critical/major
- [ ] Manual verification completed
