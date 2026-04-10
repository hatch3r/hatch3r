# Content Authoring

When creating or modifying canonical content artifacts in `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`:

1. **YAML frontmatter required:** `id`, `type` (agent|skill|rule|command|hook|prompt|github-agent), `description`, `tags`
2. **Filename prefix:** `hatch3r-` on all content files (e.g., `hatch3r-implementer.md`)
3. **Quality charter:** Reference or embody standards from `agents/shared/quality-charter.md` — confidence levels, root-cause orientation, measurable criteria
4. **Duplication check:** Before creating a new artifact, search existing artifacts for overlapping coverage. Existing content with overlapping scope is a false positive for "missing content"
5. **Skills format:** `skills/hatch3r-{name}/SKILL.md` directory structure with Quick Start + Step pattern
6. **Rules format:** Produce both `.md` (canonical) and `.mdc` (Cursor) variants with matching content
7. **Pillar alignment:** Every artifact must serve at least one Binding Pillar (P1-P6). Document which

D05 audit checklist (prompt engineering quality): `governance/audit/domains/D05-prompt-engineering.md`
