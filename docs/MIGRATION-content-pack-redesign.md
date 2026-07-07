# Migration — Content Pack Redesign (1.9.0)

The 1.9.0 release replaces the flat `tags: string[]` content taxonomy with three logical facets (capability / floor / context) and changes how presets admit items. **If you have authored custom canonical content under `.hatch3r/overrides/`, your tags need updating.** Bundled canonical content is migrated for you.

## What changed

The new filter pipeline admits items via three orthogonal gates instead of one flat `includeTags` / `excludeTags` list:

1. **Floor admission** — items carrying any `floor:*` tag are admitted to every preset (except `custom` with an explicit ID list). Floor is non-negotiable; no preset can opt out.
2. **Capability gate** — non-floor items must declare a capability tag that intersects the preset's `capabilities` list. Items with zero capability tags are dropped (this is a reversal from 1.8 — empty tag arrays are no longer a passthrough).
3. **Context filter** — items carrying `ctx:greenfield-only`, `ctx:brownfield-only`, or `ctx:team-only` are dropped on the opposite context. Floor items bypass team-size filtering.

The `customize` family is gated by `preset.includeCustomize: boolean` (false on minimal, true on standard + full).

## Tag rename table

If your override frontmatter contains any of these tags, rewrite to the new value.

| Old tag | New tag | Notes |
|---------|---------|-------|
| `core` | depends on the artifact's role | Pipeline-critical agents (researcher / implementer / reviewer / fixer / test-writer) and orchestration-rules get `floor:protocol`. Everything else previously tagged `core` gets `orchestration` (capability). |
| `security` (as a plain tag) | `floor:security` | Promoted from domain to floor — admits the item in every preset. |
| `team` | `ctx:team-only` | Context facet, with `:only` suffix making the semantics explicit (incompatible with solo). |
| `greenfield` | `ctx:greenfield-only` | Same. |
| `brownfield` | `ctx:brownfield-only` | Same. |
| `solo` | drop entirely | Decorative in 1.8; nothing in the corpus was solo-exclusive. |
| `ai` (as a **CLI category** tag on `hatch3r-cli-*` skills) | `ai-cat` | Disambiguated from the new `ai` capability tag. Only affects CLI-tool skills with category `ai`. |

## Tag addition guidance for overrides

Pick the tags that match your artifact's role:

- **`floor:security`** — if your artifact enforces a security invariant (input validation, secrets handling, auth, CSP, etc.). Lands in every preset.
- **`floor:ui-ux`** — if your artifact enforces a UI/UX invariant (state design, accessibility, design-system adherence). Lands in every preset.
- **`floor:protocol`** — reserved for items that the orchestration pipeline depends on at every preset level. Use sparingly; most overrides will not need this.
- **Capability tag(s)** — pick from `orchestration`, `planning`, `implementation`, `review`, `devops`, `maintenance`, `board`, `performance`, `ai`. Required for every non-floor item. Multiple capability tags are fine.
- **Context tag** — only when the artifact is genuinely incompatible with the opposite context. Most overrides should omit context tags.

## Preset behaviour changes

| Preset | Old behavior | New behavior |
|--------|--------------|--------------|
| `minimal` | `includeTags: ["core"]` — admitted any item tagged `core` | `capabilities: [orchestration, implementation]` + every `floor:*` item unconditionally. ~93 items (up from ~62). |
| `standard` | `includeTags: [core, planning, implementation, review, devops, maintenance]` + `excludeTags: [board, a11y, performance, customize]` | `capabilities: [orchestration, planning, implementation, review, devops, maintenance, board]` + `includeCustomize: true` + floor. Board lifecycle now included by default. ~159 items. |
| `full` | empty include/exclude lists | All capabilities + `includeCustomize: true` + `includeIds` for 8 tier-3 CLI skills. ~168 items. |
| `custom` | explicit ID list | Same, plus floor items pass through. |

## Quick verification

After upgrading, run:

```
npx hatch3r status
npx hatch3r validate
```

If any of your overrides are silently absent from the manifest output that you expected to be present, check that they carry a capability tag or a `floor:*` tag. The validate command surfaces tagging gaps in the next release.

## Background

The redesign is documented in:

- Pillars served (of the 8 governance pillars): P1 CLI UX, P2 Scientific Quality, P4 Lean Coverage, P6 Security & Trust.
- `src/content/tags.ts` — authoritative facet registry.
- `src/content/index.ts::resolveSelection` — filter pipeline.
- `scripts/wave2-retag.ts` + `scripts/wave2-fix-cli-skills.ts` — auditable migration scripts applied to bundled content.
