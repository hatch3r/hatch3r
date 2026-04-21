# Manual A11y Audit Checklist — Detailed Criteria

Loaded on demand during Step 3 of the accessibility audit workflow when a detailed manual checklist is needed beyond the automated scan.

## WCAG Requirements Matrix

| Requirement         | Standard | Details                                                          |
| ------------------- | -------- | ---------------------------------------------------------------- |
| Reduced motion      | WCAG 2.1 | All animations respect `prefers-reduced-motion` and user setting |
| Color contrast      | WCAG AA  | Text contrast ratio >= 4.5:1                                     |
| Keyboard navigation | WCAG 2.1 | All interactive elements focusable and operable via keyboard     |
| Screen reader       | WCAG 2.1 | Dynamic state and reactions announced via ARIA live regions      |
| High contrast mode  | Custom   | User-configurable high contrast theme (if applicable)            |

## Keyboard Navigation

- Tab through all interactive elements. Verify logical order and confirm no focus traps exist.
- All buttons, links, inputs, custom controls focusable.
- Visible focus indicator (outline or ring) — no `outline: none` without replacement.
- Escape closes modals/dropdowns. Enter/Space activates buttons.

## Color Contrast

- Check text vs background: >= 4.5:1 for normal text, >= 3:1 for large text.
- Use DevTools or contrast checker. Test with design tokens — flag any ad-hoc colors that fall below the 4.5:1 ratio.

## ARIA Attributes

- `aria-label` or `aria-labelledby` for icon-only buttons, custom controls.
- `aria-live="polite"` or `aria-live="assertive"` for dynamic state changes, notifications.
- `role` correct for custom widgets (button, link, tab, etc.).
- `aria-expanded`, `aria-selected`, `aria-hidden` where appropriate.

## Reduced Motion

- Test with `prefers-reduced-motion: reduce` (DevTools → Rendering → Emulate CSS media).
- Verify animations are disabled or simplified. Check user's reduced motion setting.
- No motion-dependent information (per WCAG 2.1).

## Screen Reader

- Test with NVDA, VoiceOver, or similar. Verify announcements for dynamic content.
- Dynamic state, errors, and success messages announced.
- Form labels associated, error messages linked via `aria-describedby` or `aria-errormessage`.

## High Contrast Mode

- Verify user-configurable high contrast theme works (if applicable). No loss of information.

## Severity Cataloging

| Severity | Definition                              | Examples                                                      |
| -------- | --------------------------------------- | ------------------------------------------------------------- |
| Critical | Blocks core functionality, fails WCAG A | Missing form labels, no keyboard access to primary actions    |
| Major    | Significant barrier, fails WCAG AA      | Contrast < 4.5:1, missing focus indicators, no reduced motion |
| Minor    | Improves experience, best practice      | Redundant labels, suboptimal heading order                    |

Produce a findings table: ID, severity, WCAG criterion, description, location, fix suggestion. Prioritize critical first, then major. Minor can be batched.
