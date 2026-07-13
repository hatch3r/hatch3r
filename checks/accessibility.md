---
id: accessibility
type: check
description: Accessibility review criteria covering WCAG 2.2 AA compliance, semantic HTML, keyboard navigation, screen reader support, and inclusive design patterns
cache_friendly: true
---
# Accessibility Check

> **Severity vocabulary:** see [agents/shared/severity-mapping.md](../agents/shared/severity-mapping.md) for canonical 5-column mapping.

Review criteria for evaluating accessibility in pull requests.

## Semantic HTML and ARIA

- `[CRITICAL]` Interactive elements use native HTML controls (`<button>`, `<a>`, `<input>`, `<select>`) rather than styled `<div>` or `<span>` elements with click handlers.
- `[CRITICAL]` Custom interactive components carry ARIA roles, states, and properties that match the WAI-ARIA 1.2 Authoring Practices pattern for the widget type (`role`, `aria-expanded`, `aria-selected`, `aria-disabled`, etc.); axe-core 4.5+ reports 0 `aria-required-attr` / `aria-allowed-role` violations.
- `[CRITICAL]` Images have meaningful `alt` text, or `alt=""` and `aria-hidden="true"` if purely decorative.
- `[CRITICAL]` Form inputs have associated `<label>` elements (via `for`/`id` or nesting). No input relies solely on placeholder text for identification.
- `[RECOMMENDED]` Headings follow a logical hierarchy (`h1` > `h2` > `h3`) without skipping levels.
- `[RECOMMENDED]` Landmark regions (`<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`) are used to structure the page.

## Keyboard Navigation

- `[CRITICAL]` All interactive elements are reachable and operable via keyboard (Tab, Shift+Tab, Enter, Space; Arrow keys for composite widgets per the WAI-ARIA APG keyboard-interaction table for that widget — menu, listbox, tablist, grid).
- `[CRITICAL]` Focus is not trapped in a component unless it is a modal dialog with an explicit close mechanism.
- `[CRITICAL]` Custom keyboard shortcuts do not conflict with screen reader or browser shortcuts.
- `[RECOMMENDED]` Focus order follows the visual reading order (logical DOM order). No use of positive `tabindex` values.
- `[CRITICAL]` WCAG 2.2 SC 2.4.7 Focus Visible (AA): the keyboard focus indicator is visible on every operable element. No `outline: none` without a conforming custom focus style.
- `[CRITICAL]` WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum) (AA): the focused element is not entirely hidden by author-created content (sticky headers, footers, cookie banners, overlays). `[RECOMMENDED]` SC 2.4.13 Focus Appearance (AAA) as the enhanced target: the focus indicator has a contrast ratio of at least 3:1 against adjacent colors and a minimum area equal to a 1px-thick perimeter (or 4px-thick along the shortest side).

## Visual Design and Color

- `[CRITICAL]` Text meets WCAG 2.2 AA contrast ratios: 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold). Verify with axe-core 4.5+ `color-contrast` rule — 0 violations.
- `[CRITICAL]` Information is not conveyed by color alone. Status indicators, errors, and required fields use icons, text, or patterns in addition to color.
- `[CRITICAL]` UI remains functional and readable at 200% browser zoom without horizontal scrolling or content clipping.
- `[RECOMMENDED]` Animations respect the `prefers-reduced-motion` media query — reduce or remove motion for users who have requested it.

## Touch and Pointer Targets (WCAG 2.2)

- `[CRITICAL]` WCAG 2.2 SC 2.5.8 Target Size (Minimum): pointer targets are at least 24x24 CSS px, OR have 24px of spacing to adjacent targets, unless an inline/essential exception applies. Mobile interfaces target 44x44 CSS px (Apple HIG / Material).
- `[CRITICAL]` WCAG 2.2 SC 2.5.7 Dragging Movements: any drag operation (slider, drag-to-reorder, map pan) provides a single-pointer alternative that does not require dragging (tap, click, or button control).

## Screen Reader Support

- `[CRITICAL]` WCAG 2.2 SC 4.1.3 Status Messages: status messages (success/error/progress, search-result counts, loading state) are programmatically conveyed via `role="status"`, `role="alert"`, or an `aria-live` region without moving focus, so assistive tech announces them.
- `[CRITICAL]` Dynamic content updates (toast notifications, live regions, inline validation) use `aria-live` regions (`polite` or `assertive`) to announce changes.
- `[CRITICAL]` Modal dialogs trap focus, announce their title via `aria-labelledby`, and return focus to the trigger element on close.
- `[CRITICAL]` Icon-only buttons and links have accessible names via `aria-label`, `aria-labelledby`, or visually hidden text.
- `[RECOMMENDED]` Tables use `<th>` with `scope` attributes for column and row headers. Complex tables use `id`/`headers` associations.
- `[RECOMMENDED]` Loading states are announced to screen readers, not just shown visually (e.g., `aria-busy="true"` on the updating region).

## Content and Language

- `[CRITICAL]` The page has a `lang` attribute on the `<html>` element matching the content language.
- `[CRITICAL]` Error messages are descriptive, identify the field in error, and suggest how to fix the problem.
- `[RECOMMENDED]` Link text is descriptive and makes sense out of context. Avoid generic "click here" or "read more" links.
- `[RECOMMENDED]` Abbreviations and acronyms are expanded on first use or wrapped in `<abbr>` with a `title` attribute.

## Media and Embedded Content

- `[CRITICAL]` Video content has captions. Audio content has transcripts.
- `[CRITICAL]` Auto-playing media can be paused or stopped by the user. No content flashes more than 3 times per second.
- `[RECOMMENDED]` Audio descriptions are provided for video content where visual information is not conveyed through the audio track.
- `[RECOMMENDED]` Embedded content (iframes, embeds) has a descriptive `title` attribute.
