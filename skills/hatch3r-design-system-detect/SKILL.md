---
id: hatch3r-design-system-detect
name: hatch3r-design-system-detect
type: skill
description: Detects existing design tokens, component library, and theming convention in a project before authoring new UI primitives — output a concise inventory for downstream implementers
tags: [implementation, floor:ui-ux, ui, design-system, frontend]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Design System Detection Workflow

## Quick Start

When an agent is about to author or modify UI, run this skill first to produce a Design System Inventory. Skip = the implementer may duplicate primitives or invent tokens that already exist. Embed the inventory in the implementation plan, PR description, or `.audit-workspace/design-system-inventory.md` for the current task before any UI code is written.

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Scan package.json for design-system signals
- [ ] Step 2: Locate token source
- [ ] Step 3: Map component library
- [ ] Step 4: Identify breakpoint and responsive strategy
- [ ] Step 5: Record findings (Design System Inventory)
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: project root path (monorepo subpackage vs root), canonical token source when multiple exist, primitive directory convention, responsive strategy expected (container-first vs media-first), and verdict authority (reuse vs extend vs create).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Scan package.json for design-system signals

Look for the following packages and record both presence and version:

- `@radix-ui/*` or `radix-ui` (headless primitives, WAI-ARIA compliant)
- `shadcn` reference in `components.json` (source-in-repo registry)
- `tailwindcss` — note major version (v3 has `tailwind.config.js`; v4 uses `@theme` in CSS)
- `@chakra-ui/*`, `@mui/material`, `@mui/joy`
- `bootstrap`, `@headlessui/react`, `@base-ui-components/react`

Detection command:

```
cat package.json | jq '.dependencies, .devDependencies | keys[]' | grep -iE 'radix|tailwind|chakra|mui|shadcn|headless|base-ui'
```

Output: a list of design-system packages with semver. If zero matches, record "no UI library detected — confirm with maintainer before scaffolding a new one."

## Step 2: Locate token source

Detection order (first match wins):

1. `tokens.json` at repo root or in `src/`, `design/`, `tokens/` — check for `$value`/`$type` keys; DTCG 2025.10 conformance.
2. CSS `@theme` block in any `*.css` file (Tailwind v4) — `rg -l '@theme\s*\{' --type css`.
3. `src/styles/tokens.css` or similar — CSS custom properties at `:root`.
4. `tailwind.config.{js,ts}` `theme.extend` (Tailwind v3 fallback).
5. Figma export (`figma.tokens.json`, `tokens-studio.json`).

For each source found, record:

- File path
- Format (DTCG / `@theme` / CSS custom properties / Tailwind v3 config)
- Color space (OKLCH / Display-P3 / hex/RGB legacy)

If multiple sources exist, flag the duplication — DTCG mandates a single source of truth. The Design System Inventory must call out which source the implementer should treat as canonical.

## Step 3: Map component library

Check `components.json` (shadcn registry config). Record: `style`, `tailwind.config`, `aliases.components`, `aliases.ui`.

Find component directories:

- `src/components/ui/*` (shadcn convention)
- `src/components/primitives/*`
- `app/components/*` (Nuxt / Next.js app router)
- `packages/ui/*` (monorepo)

Detection command:

```
fd -t d -E node_modules 'ui|primitives|components' src app packages 2>/dev/null | head -10
```

List the existing primitives by filename (Button, Input, Dialog, Card, Tooltip, ...). The implementer uses this list in Step 5 to decide reuse vs extend vs create.

## Step 4: Identify breakpoint and responsive strategy

Container queries (preferred for component-scoped responsiveness in 2026):

```
rg -l '@container' --type css
```

Media queries (viewport-scoped):

```
rg -o '@media\s*\([^)]+\)' --type css | sort -u | head -10
```

Breakpoint tokens: check `--breakpoint-*` custom properties or Tailwind `screens` config.

Record one of: container-query-first / media-query-first / mixed. A component-library project that ships `@container`-based primitives must not be extended with `@media`-only additions.

## Step 5: Record findings

Produce a Design System Inventory block. Embed it in the implementation plan, PR description, or `.audit-workspace/design-system-inventory.md`:

```
Design System Inventory
-----------------------
Component library: <shadcn|Radix|MUI|Chakra|custom|none> (version X)
Token source: <file path> (<DTCG|@theme|CSS vars|Tailwind config>)
Color space: <OKLCH|Display-P3|hex>
Responsive strategy: <container-first|media-first|mixed>
Existing primitives: Button, Input, Dialog, ...
Verdict: <reuse|extend|create-with-justification>
```

## Reuse decision tree

| Situation | Action |
|-----------|--------|
| Primitive exists, matches use case | Import + use directly |
| Primitive exists, doesn't quite fit | Extend via composition; do not fork |
| No primitive | Author new, add to `ui/` directory, document in PR |

## Error Handling

- **No package.json found**: Project may be a non-JS stack. Record stack (Rails, Phoenix, Go templates) and check for stack-native token sources before declaring "no design system."
- **Multiple token sources detected**: Flag in the inventory verdict. Implementer must reconcile to a single source before adding tokens; new work blocked until reconciliation owner is named.
- **shadcn `components.json` present but `src/components/ui/` empty**: Project is shadcn-initialized but no primitives copied yet. Run `npx shadcn@latest add <component> --dry-run` to preview before authoring.

## Definition of Done

- [ ] package.json scanned and library list recorded
- [ ] Token source located and color space confirmed
- [ ] Component primitive list captured
- [ ] Breakpoint strategy classified
- [ ] Inventory block written to plan / PR / `.audit-workspace/`
- [ ] Reuse / extend / create verdict explicit per surface

## References

- [W3C Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/) — DTCG canonical format
- [shadcn CLI docs](https://ui.shadcn.com/docs/cli) — `add`, `init`, `--dry-run`, `--diff`, `--view`
- [Tailwind v4 theme docs](https://tailwindcss.com/docs/theme) — `@theme` block configuration
- [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) — headless WAI-ARIA primitives
- [Interop 2026](https://wpt.fyi/interop-2026) — container queries, `:has()`, anchor positioning, View Transitions baseline status

## Cross-references

Consumer: `commands/hatch3r-design-system-create.md` — creation-side orchestrator; invokes this skill as its mandatory Step 1 and routes on the inventory verdict (reuse → halt, extend → gap-scoped, create → full generation).

Rules consumed by this skill:

- `rules/hatch3r-design-system-detection.md` — rule version of this guidance (mandate + scope)
- `rules/hatch3r-component-conventions.md` — primitive composition + state patterns
- `rules/hatch3r-theming.md` — token layering (primitive → semantic → component)
