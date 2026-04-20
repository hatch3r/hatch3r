# Content Authoring

**Pillars:** P4 (Lean Coverage), P2 (Scientific Quality)

When creating or modifying canonical content artifacts in `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`:

1. **YAML frontmatter required:** `id`, `type` (agent|skill|rule|command|hook|prompt|github-agent), `description`, `tags`
2. **Filename prefix:** `hatch3r-` on all top-level published content files (e.g., `hatch3r-implementer.md`). Exceptions (no prefix required): support/reference content under named support subdirectories — `agents/shared/*`, `agents/modes/*`, `commands/board/*`, `commands/revision/*`, and `checks/*`. These files are companion/reference material, not standalone published artifacts; `src/content/index.ts:610-626` and `src/cli/commands/validate.ts:158-164` already model this split (manifest `managedFiles` excludes these paths from the prefix check).
3. **Quality charter:** Reference or embody standards from `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable criteria
4. **Duplication check:** Before creating a new artifact, search existing artifacts for overlapping coverage. Existing content with overlapping scope is a false positive for "missing content"
5. **Skills format:** `skills/hatch3r-{name}/SKILL.md` directory structure with Quick Start + Step pattern
6. **Rules format:** Produce both `.md` (canonical) and `.mdc` (Cursor) variants. Body bytes must match (checked by `scripts/validate-rule-parity.ts`); frontmatter follows the scope transform below.
7. **Pillar alignment:** Every artifact must serve at least one Binding Pillar (P1-P6). Document which

## Rule Scope Transform (`.md` -> `.mdc`)

Canonical `.md` files declare rule scope using one of three frontmatter shapes. The corresponding `.mdc` frontmatter is deterministic.

| `.md` shape | `.mdc` frontmatter |
|-------------|--------------------|
| `scope: always` | `alwaysApply: true` (no `globs`) |
| `scope: "<g1>,<g2>,..."` (CSV string) | `globs: ["<g1>", "<g2>", ...]` + `alwaysApply: false` |
| `scope: conditional` + `globs: "<g1>,<g2>,..."` | `globs: ["<g1>", "<g2>", ...]` + `alwaysApply: false` |
| `scope: conditional` with no `globs:` (deprecated rules) | `alwaysApply: false` (no `globs`) |

Enforced by `scripts/validate-rule-parity.ts` (CI gate via `npm run validate:rule-parity`):
- Every `.mdc` has a `description:` field matching the `.md` `description:`.
- `.mdc` files with `globs` carry `alwaysApply: false`.
- `.mdc` `globs` is a JSON array of quoted strings (no bare CSV).
- The set of globs on the `.mdc` side equals the set derived from the `.md` side via the transform above.

D05 audit checklist (prompt engineering quality): `governance/audit/domains/D05-prompt-engineering.md`
