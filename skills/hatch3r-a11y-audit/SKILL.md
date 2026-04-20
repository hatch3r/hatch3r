---
name: hatch3r-a11y-audit
id: hatch3r-a11y-audit
description: "WCAG AA accessibility audit covering color contrast, semantic HTML, ARIA attributes, keyboard navigation, and screen reader compatibility. Use when auditing accessibility, verifying WCAG compliance, fixing a11y violations, or improving accessibility across the application."
tags: [review, a11y]
quality_charter: agents/shared/quality-charter.md
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

- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Automated Scan

Run axe-core on all pages and key components:

```typescript
// Playwright example
import AxeBuilder from '@axe-core/playwright';

const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa'])
  .analyze();
expect(results.violations).toEqual([]);
```

- Run against: main routes, key components (if testable in isolation).
- Capture all violations. Map to WCAG criteria (e.g., 1.1.1, 1.4.3, 2.1.1, 4.1.2).
- Document: rule ID, impact, elements affected, WCAG level.

## Step 3: Manual Audit

**Keyboard navigation:**

- Tab through all interactive elements. Verify logical order and confirm no focus traps exist.
- All buttons, links, inputs, custom controls focusable.
- Visible focus indicator (outline or ring) — no `outline: none` without replacement.
- Escape closes modals/dropdowns. Enter/Space activates buttons.

**Color contrast:**

- Check text vs background: ≥ 4.5:1 for normal text, ≥ 3:1 for large text.
- Use DevTools or contrast checker. Test with design tokens — flag any ad-hoc colors that fall below the 4.5:1 ratio.

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
- Verify `prefers-reduced-motion` is respected by enabling the media query in DevTools and confirming animations are disabled or simplified.
- Add or fix focus styles. Use design tokens for focus ring.
- Verify reduced-motion behavior in tests.

## Step 6: Verify Fixes

- Re-run automated scan. No critical or major violations.
- Manual keyboard and screen reader check on fixed areas.
- Run full test suite and confirm 0 failures to verify no regressions.
- Document remaining minor findings for future backlog.

## Required Agent Delegation

You MUST spawn these agents via the Task tool (`subagent_type: "generalPurpose"`) at the appropriate points:

- **`hatch3r-a11y-auditor`** — MUST spawn to perform the full WCAG AA compliance audit autonomously. Provide the list of surfaces/components to audit and the current violation list.

## Related Rules

- **Rule**: `hatch3r-browser-verification` — follow this rule for live browser-based accessibility testing

## Error Handling

- **No automated scanner available**: If axe-core, Lighthouse, or equivalent is not installed, report the gap and proceed with manual checklist-only audit. Do not skip the audit.
- **Scanner produces false positives**: Cross-reference automated findings against manual inspection. Mark confirmed false positives with justification and exclude from the violation count.
- **Component renders differently across browsers**: Test in at least two browser engines (Chromium + Firefox or Safari). Document browser-specific a11y gaps with reproduction steps.

## Definition of Done

- [ ] No critical a11y violations
- [ ] WCAG AA compliance on all audited surfaces
- [ ] Reduced motion respected (`prefers-reduced-motion` + user setting)
- [ ] Keyboard navigation complete with visible focus
- [ ] Color contrast ≥ 4.5:1 for text
- [ ] ARIA live regions for dynamic content
- [ ] Automated scan clean for critical/major
- [ ] Manual verification completed
