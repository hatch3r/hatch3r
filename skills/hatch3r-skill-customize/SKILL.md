---
id: hatch3r-skill-customize
description: Redirect to rewrite dispatch text that the model uses for auto-selection under .hatch3r/skills/ -- use when a capability is chosen for the wrong task or vice versa
tags: [customize]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
redirect_to: hatch3r-customize
---
# Skill Customization

> **This skill has been consolidated.** Use the `hatch3r-customize` skill with `type: skill`.

For skill-specific reference (YAML schema, examples), see the `hatch3r-skill-customize` command.

## Rejected Merge Alternative (D16.3 add-vs-remove bias)

Per `governance/audit/domains/D16-compound-system.md` SA 16.3, the default recommendation on functional overlap is MERGE rather than removal. Full deletion of this redirect file was rejected for two reasons:

1. **Preserves UX entry points.** Users typed `/h4tcher-skill-customize` or referenced the id `hatch3r-skill-customize` (per `rules/hatch3r-browser-verification.md:58` and sibling cross-references) before consolidation. Deleting the id breaks those entry points without a redirect target.
2. **Signals umbrella canonicality.** The `redirect_to: hatch3r-customize` frontmatter field marks `hatch3r-customize` as the single source of truth — tooling, audit scans, and adapters can resolve any redirect to the canonical without re-reading body prose.

The 13-LOC redirect cost is paid once per type; the umbrella body lives in `skills/hatch3r-customize/SKILL.md`.
