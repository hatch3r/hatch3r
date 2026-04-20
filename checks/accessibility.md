---
id: accessibility
type: check
description: Accessibility review criteria covering WCAG compliance, semantic HTML, keyboard navigation, screen reader support, and inclusive design patterns
---
# Accessibility Check

> **Severity vocabulary:** see [governance/audit/templates/severity-mapping.md](../governance/audit/templates/severity-mapping.md) for canonical 5-column mapping.

Review criteria for evaluating accessibility in pull requests.

## Semantic HTML and ARIA

- `[CRITICAL]` Interactive elements use native HTML controls (`<button>`, `<a>`, `<input>`, `<select>`) rather than styled `<div>` or `<span>` elements with click handlers.
- `[CRITICAL]` Custom interactive components have appropriate ARIA roles, states, and properties (`role`, `aria-expanded`, `aria-selected`, `aria-disabled`, etc.).
- `[CRITICAL]` Images have meaningful `alt` text, or `alt=""` and `aria-hidden="true"` if purely decorative.
- `[CRITICAL]` Form inputs have associated `<label>` elements (via `for`/`id` or nesting). No input relies solely on placeholder text for identification.
- `[RECOMMENDED]` Headings follow a logical hierarchy (`h1` > `h2` > `h3`) without skipping levels.
- `[RECOMMENDED]` Landmark regions (`<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`) are used to structure the page.

## Keyboard Navigation

- `[CRITICAL]` All interactive elements are reachable and operable via keyboard (Tab, Shift+Tab, Enter, Space, Arrow keys as appropriate).
- `[CRITICAL]` Focus is not trapped in a component unless it is a modal dialog with an explicit close mechanism.
- `[CRITICAL]` Custom keyboard shortcuts do not conflict with screen reader or browser shortcuts.
- `[RECOMMENDED]` Focus order follows the visual reading order (logical DOM order). No use of positive `tabindex` values.
- `[RECOMMENDED]` Focus indicators are visible and meet contrast requirements. No `outline: none` without a custom visible focus style.

## Visual Design and Color

- `[CRITICAL]` Text meets WCAG 2.1 AA contrast ratios: 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).
- `[CRITICAL]` Information is not conveyed by color alone. Status indicators, errors, and required fields use icons, text, or patterns in addition to color.
- `[CRITICAL]` UI remains functional and readable at 200% browser zoom without horizontal scrolling or content clipping.
- `[RECOMMENDED]` Touch targets are at least 44x44 CSS pixels for mobile interfaces.
- `[RECOMMENDED]` Animations respect the `prefers-reduced-motion` media query — reduce or remove motion for users who have requested it.

## Screen Reader Support

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
