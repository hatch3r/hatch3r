---
id: hatch3r-accessibility-standards
type: rule
description: Accessibility standards covering WCAG 2.2 AA compliance, keyboard navigation, screen readers, and ARIA patterns
scope: conditional
globs: "**/*.vue,**/*.jsx,**/*.tsx,**/*.svelte,**/components/**,**/*.html,**/*a11y*,**/*accessibility*"
tags: [floor:ui-ux, a11y, tier:team-plus]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Accessibility Standards

## WCAG 2.2 AA Compliance

All user-facing features must meet WCAG 2.2 Level AA conformance. This is the baseline — Level AAA is aspirational for critical user flows.

## Keyboard Navigation

- All interactive elements must be reachable and operable via keyboard alone.
- Tab order follows the visual reading order (left-to-right, top-to-bottom for LTR languages).
- Never use `tabindex` values greater than 0. Use `tabindex="0"` to add to natural flow, `tabindex="-1"` for programmatic focus only.
- Custom widgets implement standard keyboard patterns: arrow keys for navigation within a group, Enter/Space for activation, Escape to dismiss.
- Keyboard traps are forbidden. Every focused element must have a keyboard-accessible exit.
- Skip navigation links appear as the first focusable element on pages with repeated navigation.

## Focus Management

- Focus is visible at all times. Custom focus indicators must have a minimum 3:1 contrast ratio against the background.
- When content changes dynamically (modals, drawers, toasts), move focus to the new content.
- When a modal or dialog closes, return focus to the element that triggered it.
- Single-page application route changes move focus to the main content heading or a skip link target.
- Never remove focus outlines globally. If overriding browser defaults, provide an equally visible alternative.

## Color and Contrast

- Text contrast ratio: minimum 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).
- Non-text contrast: minimum 3:1 for UI components (borders, icons, form controls) and graphical objects.
- Never convey information through color alone. Use additional indicators: icons, text labels, patterns.
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia).
- Dark mode and light mode must independently meet contrast requirements.

## Screen Reader Support

- All images have meaningful `alt` text or `alt=""` for decorative images.
- Form controls have associated `<label>` elements (using `for`/`id` or wrapping).
- Use semantic HTML elements (`<nav>`, `<main>`, `<header>`, `<footer>`, `<section>`, `<article>`) before reaching for ARIA roles.
- Dynamic content updates use `aria-live` regions: `polite` for non-urgent updates, `assertive` for critical alerts.
- Tables have `<caption>` and use `<th scope="col|row">` for header cells.
- Icon-only buttons include `aria-label` or visually hidden text.

## ARIA Patterns

- Follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) for all custom widgets.
- ARIA role must match keyboard behavior — a `role="button"` element must respond to Enter and Space.
- Use `aria-expanded`, `aria-selected`, `aria-checked` to communicate widget state.
- `aria-describedby` links error messages and help text to form controls.
- Avoid ARIA when native HTML provides the same semantics. First rule of ARIA: don't use ARIA if native HTML works.
- Test ARIA implementations with at least two screen readers (VoiceOver + NVDA or JAWS).

## Motion and Animation

- All animations must respect `prefers-reduced-motion: reduce`. Disable non-essential motion.
- Essential animations (progress indicators, loading states) simplify rather than disable entirely.
- No content flashes more than 3 times per second (seizure safety — WCAG 2.3.1).
- Auto-playing media has a visible pause/stop mechanism.

## Forms and Input

- Group related form controls with `<fieldset>` and `<legend>`.
- Error messages identify the field in error and describe how to fix it.
- Required fields are indicated both visually and programmatically (`aria-required="true"` or `required`).
- Input validation provides feedback inline and in an error summary.
- Time limits are either removable, adjustable (10x minimum), or preceded by a warning with option to extend.

## Testing with Assistive Technology

- Test with a screen reader on every feature branch that modifies UI.
- Minimum testing matrix: VoiceOver (macOS/iOS) + Chrome, NVDA + Firefox (Windows).
- Run automated accessibility checks (axe-core, Lighthouse) in CI.
- Automated tools catch ~30% of accessibility issues. Manual testing is required for keyboard flows, screen reader experience, and cognitive accessibility.
- Maintain an accessibility test checklist per component type (form, modal, navigation, data table).

## WCAG 2.2 New Success Criteria (Mandatory Audit Items)

WCAG 2.2 (W3C Recommendation, October 2023) added nine Success Criteria; three apply to most UI surfaces and are listed here as required audit items.

- **SC 2.5.8 Target Size (Minimum) — AA:** every pointer-target's hit area is at least 24 by 24 CSS pixels. Smaller targets are permitted only when surrounded by ≥24px of spacing (the spacing exception) or when the larger inline target is also reachable (the inline exception). Test densest UI elements (sidebar collapse, table-row checkboxes, icon-only toolbar buttons).
- **SC 2.4.11 Focus Not Obscured (Minimum) — AA:** when a control receives keyboard focus, the focused element must not be entirely hidden by author-created content. Common violations: sticky headers, persistent cookie banners, chatbot launcher widgets, fixed action bars. Mitigate with `scroll-margin-top` on focus targets equal to the sticky header height, or by collapsing sticky chrome on focus.
- **SC 2.5.7 Dragging Movements — AA:** any drag operation (reorder, slider thumb drag, map pan, kanban card move) must offer a single-pointer non-drag alternative. Examples: list reorder with up/down arrow buttons; slider with numeric input or +/- buttons; map pan with arrow-key navigation.

Reference: https://www.w3.org/TR/WCAG22/

## Mobile and Touch Accessibility

Touch surfaces have stricter target and spacing requirements than pointer-only surfaces; native platform guidance supersedes WCAG 2.5.8 on touch.

- Touch targets: 44 by 44 points on iOS (Apple Human Interface Guidelines), 48 by 48 dp on Android (Material Design 3). These supersede WCAG 2.5.8's 24-pixel minimum on touch-only surfaces.
- Spacing between interactive elements: ≥8 pixels of separation to prevent mis-taps; ≥4 mm on physical-density screens.
- Avoid tap-to-reveal patterns (hover tooltips, pure-hover dropdowns) — touch has no hover state. Replace with permanent visible labels or with long-press that has a visible affordance and announces itself to screen readers.
- Apply `env(safe-area-inset-*)` padding on full-bleed surfaces so content clears notches, home indicators, and rounded corners on iOS and Android edge devices.
- Support Dynamic Type (iOS) and rem-based font scaling — declare body text in `rem` or `em` units, never `px`, so OS-level font size settings cascade.
- Zoom to 200% and 400% (per WCAG 1.4.4 and 1.4.10 Reflow) must remain functional with no horizontal scroll trap. Audit for `width: 100vw` and fixed pixel widths that break reflow.
