---
id: hatch3r-design-system-detection
type: rule
description: Mandatory detection of existing design tokens, theme primitives, and component library before AI agents author new UI components
scope: conditional
globs: "**/*.vue,**/*.jsx,**/*.tsx,**/*.svelte,**/*.css,**/*.scss,**/components/**,**/tokens*,**/theme*,**/design-system/**,**/tailwind*"
tags: [implementation, floor:ui-ux, ui, design-system, frontend]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Design System Detection

## Reuse-Before-Author Principle

Existing tokens beat extended tokens beat new tokens. Before authoring any UI primitive, an agent must detect whether tokens, themes, or component libraries already exist in the project and reuse them. Skipping detection is a regression: it produces duplicate primitives, drift in semantic naming, and visual inconsistency with shipped UI.

## Detection Routine (5 Steps, Ordered)

Run these five steps in order before authoring any UI artifact. Record each finding in the implementation plan or PR description.

### Step 1 — Scan `package.json` for design-system signals

Grep dependencies and `devDependencies` for: `@radix-ui/*`, `@shadcn/ui` references in `components.json`, `tailwindcss` (record the major version), `@chakra-ui/*`, `@mui/*` (Material), `bootstrap`, `headlessui`, `@ariakit/*`, `@reach/*`. Each signal pins the headless or styled library the project already commits to.

```
jq '.dependencies + .devDependencies | keys[]' package.json | grep -E '(radix|shadcn|tailwind|chakra|mui|bootstrap|headlessui|ariakit|reach)'
```

### Step 2 — Locate the token source

Search in this exact order — the first hit wins:

1. `tokens.json` at repo root or under `design-system/` — DTCG 2025.10 format
2. `src/styles/tokens.css` or `app/styles/tokens.css` — CSS custom properties
3. Tailwind v4 `@theme` block inside `app.css`, `globals.css`, or `src/styles/main.css`
4. `tailwind.config.{js,ts,mjs}` `theme.extend` — Tailwind v3 fallback
5. `figma.tokens.json` — Tokens Studio export, transformed downstream

```
fd -e json -e css 'tokens|theme' . && rg '^\s*@theme\b' --type css
```

### Step 3 — Map the component library

Look for these markers, in order:

- `components.json` — shadcn CLI registry config; records the components directory and registry URLs
- `src/components/ui/*` — shadcn convention
- `src/components/primitives/*` — generic primitives directory
- `app/components/*` — Nuxt/Vue convention
- `packages/ui/src/*` — monorepo shared package

Record the directory, the import pattern (`@/components/ui/button` etc.), and whether components wrap a headless library or hand-roll DOM.

### Step 4 — Identify the color space

Inspect token values:

- OKLCH (`oklch(0.7 0.15 250)`) — preferred 2026 default for shadcn v4 and Tailwind v4
- Display-P3 (`color(display-p3 1 0.5 0)`) — wide-gamut explicit
- sRGB hex (`#3b82f6`) — legacy; flag for migration when adding tokens

Document the convention. New tokens must match the existing color space — mixed-space palettes produce inconsistent blending in `color-mix()`.

### Step 5 — Record findings

Add a short section to the implementation plan or PR description listing: token source path, component library directory, headless library (Radix/Ariakit/Headless UI/none), color space, breakpoint strategy (container queries via `@container` or media queries via `@media`).

## DTCG Token Format (2025.10)

When emitting or proposing new tokens, conform to the W3C Design Tokens Community Group format. Required fields per token: `$value`, `$type` (one of `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`). Optional: `$description`. Alias another token via `{group.token}` reference syntax. Transform pipelines: Style Dictionary 4.x or Tokens Studio. Source: `design-tokens.github.io/community-group`.

```json
{
  "color": {
    "primary": { "$value": "oklch(0.7 0.15 250)", "$type": "color" },
    "brand":   { "$value": "{color.primary}",     "$type": "color" }
  }
}
```

## shadcn Baseline (2026)

When scaffolding React UI in a project without a component library:

- `npx shadcn@latest init` — initialize `components.json`, base tokens, and `cn()` util
- `npx shadcn@latest add <component> --dry-run` — inspect the diff before writing
- Pull from namespaced registries (`@my-org/...`) for org-specific components
- Never fork primitives into local copies; extend via composition

## Tailwind v4 CSS-First

For new projects targeting Tailwind v4: configure entirely via the `@theme` block in CSS. Do not generate `tailwind.config.js` — that is the v3 model. v4 defaults to OKLCH color space; use `color-mix(in oklch, ...)` for tints, shades, and surface elevations.

```css
@import "tailwindcss";
@theme {
  --color-primary: oklch(0.7 0.15 250);
  --color-primary-hover: color-mix(in oklch, var(--color-primary) 90%, black);
}
```

## Radix Primitives + WAI-ARIA APG

Never hand-roll focus traps, ARIA roles, roving tabindex, or keyboard navigation for: menu, dialog, popover, tabs, select, combobox, listbox, dropdown, tooltip, accordion. Compose Radix Primitives, Ariakit, or React Aria, and verify behavior against the WAI-ARIA Authoring Practices Guide (`w3.org/WAI/ARIA/apg/`). Hand-rolled implementations of these patterns are rejected.

## Modern CSS Over JS (Interop 2026 Baseline)

Prefer the native CSS or HTML feature over a JS equivalent whenever the Interop 2026 baseline includes it:

- `:has()` selector — replaces JS-based parent-state classes
- Container queries (`@container`) — replaces `@media` for component-scoped breakpoints
- View Transitions API — replaces Framer Motion route transitions
- Native `<dialog>` + Popover API (`popover` attribute) — replaces Headless UI modals for non-trapping cases
- CSS anchor positioning — replaces Floating UI for menus and tooltips
- Cascade layers (`@layer`) — replaces specificity hacks
- `color-mix()` — replaces JS color manipulation libs

## Reuse > Extend > Create — Decision Tree

| Situation | Action |
|---|---|
| Token exists with matching semantic name | Use directly |
| Token exists with adjacent semantic | Alias new semantic to existing primitive |
| No token, primitive exists in scale | Add semantic alias pointing at the existing primitive |
| No primitive at all | Add primitive plus semantic alias; justify the new primitive in the PR |

## Verification Before "Done"

- Design-token adoption >= 95% in generated code — no hard-coded hex, rgb, or pixel values for colors and spacing
- `npx shadcn@latest add <component> --diff` shows no unintentional local drift from the registry
- Components imported from the primitives library; not duplicated inline
- Color values in OKLCH where the existing token source uses OKLCH
- New tokens conform to DTCG `$value`/`$type` shape and pass the project's Style Dictionary build

## References

- W3C Design Tokens Community Group spec: `design-tokens.github.io/community-group` (2025.10 working draft)
- shadcn docs: `ui.shadcn.com`
- Tailwind v4 docs: `tailwindcss.com/docs` (CSS-first `@theme` chapter)
- Radix Primitives: `radix-ui.com/primitives`
- WAI-ARIA Authoring Practices Guide: `w3.org/WAI/ARIA/apg/`
- Interop 2026 dashboard: `wpt.fyi/interop-2026`
