---
description: Theming, dark mode, and color system conventions for the project
globs: src/**/*.vue, src/**/*.tsx, src/**/*.jsx, src/**/*.css, src/**/*.scss
alwaysApply: false
---
# Theming & Dark Mode

## Color System

- Define all colors as semantic CSS custom properties (`--color-surface`, `--color-text-primary`, `--color-text-secondary`, `--color-border`, `--color-brand`, `--color-error`, `--color-success`, `--color-warning`).
- Maintain three token sets: **light** (default), **dark**, and **high-contrast**.
- Never use raw hex, `rgb()`, or `hsl()` values in component code — always reference tokens.
- Layer tokens: primitive (`--gray-900`) → semantic (`--color-text-primary: var(--gray-900)`) → component (`--btn-text: var(--color-text-primary)`).

## Theme Detection & Persistence

- Detect system preference with `prefers-color-scheme` media query for CSS defaults.
- Read system preference in JS via `window.matchMedia('(prefers-color-scheme: dark)')` and listen for changes with `addEventListener('change', ...)`.
- Persist explicit user override in `localStorage` (or equivalent settings store).
- Resolution order: user override → system preference → light fallback.

## Theme Switching

- Apply theme via `data-theme` attribute on `<html>` (e.g., `<html data-theme="dark">`).
- Define token overrides scoped to `[data-theme="dark"]` and `[data-theme="high-contrast"]` selectors.
- Add `color-scheme: light dark` on `:root` so browser-native controls (scrollbars, form elements) adapt automatically.
- Prevent flash of wrong theme (FOWT): inject a blocking `<script>` in `<head>` that reads the stored preference and sets `data-theme` before first paint.
- Use `transition: background-color 200ms ease, color 200ms ease` on body for smooth theme changes — but disable transitions on initial load.

## Dark Mode Patterns

- Reduce color saturation 10–20% for dark backgrounds to avoid visual vibration.
- Express elevation through progressively lighter surface colors (e.g., `--color-surface-raised`, `--color-surface-overlay`) — not box-shadows.
- Adjust images: apply `filter: brightness(0.9)` or reduce opacity on decorative images; provide dark-optimized variants for logos and illustrations when possible.
- Use reduced contrast (e.g., `--color-text-secondary: #a0a0a0`) for secondary text in dark mode — primary text should remain high contrast (≥ 7:1).
- Avoid pure white (`#fff`) text on pure black (`#000`) backgrounds — use off-white on dark gray for reduced eye strain.

## High Contrast Support

- Provide a `high-contrast` token set with ≥ 7:1 contrast ratios for all text and ≥ 3:1 for non-text UI.
- Detect user preference with `@media (prefers-contrast: more)` and apply high-contrast tokens.
- Support `forced-colors` mode: use system color keywords (`Canvas`, `CanvasText`, `LinkText`, `ButtonFace`, `ButtonText`) and test that information is not conveyed by color alone.
- Ensure focus indicators and borders remain visible under forced-colors by using `Highlight` / `SelectedItem` keywords.

## Testing

- Verify theme toggle switches all tokens correctly — no unstyled or hard-coded colors leak through.
- Validate contrast ratios per theme using automated tools (axe-core, Lighthouse) against WCAG AA (4.5:1 text, 3:1 non-text).
- Capture screenshots across light, dark, and high-contrast themes at key viewport sizes for visual regression comparison.
- Test `prefers-color-scheme` and `prefers-contrast` media query overrides using browser DevTools emulation or Playwright `emulateMedia`.
- Confirm no flash of wrong theme on hard refresh (disable cache, reload, verify first paint matches stored preference).
