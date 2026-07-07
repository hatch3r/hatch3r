---
title: Adapter System
---

# Adapter System

Adapters transform canonical content into tool-specific formats. Each adapter implements a `generate()` method that reads canonical files and produces output for its target platform.

```
Bundled canonical content (npm package)
    │
    ├──→ Cursor adapter    → .cursor/rules/*.mdc, .cursor/agents/*.md, ...
    ├──→ Copilot adapter   → .github/copilot-instructions.md, .github/agents/*.md, ...
    └──→ Claude adapter    → CLAUDE.md, .claude/rules/*.md, .mcp.json, ...
```

As of 1.9.0 the adapter set was hard-cut to these 3 (Claude Code, Cursor, GitHub Copilot). Twelve adapters were removed — see the [CHANGELOG](https://github.com/hatch3r/hatch3r/blob/main/CHANGELOG.md) for the full breaking-change list.

## Emission Strategies

The 3 adapters use two emission strategies:

- **Native** -- tool has a specific per-file config format (Cursor `.mdc` rule frontmatter and `.cursor/agents/`; Copilot YAML frontmatter under `.github/instructions/`, `.github/agents/`)
- **Bridge** -- content is folded into a single instruction file the platform reads (Claude Code reads `CLAUDE.md`)

See the [Adapter Capability Matrix](../adapter-capability-matrix) for the full per-tool breakdown.

## Managed Blocks

All hatch3r-generated markdown files use managed blocks to enable safe updates:

```markdown
<!-- HATCH3R:BEGIN -->
...managed content (updated on sync/update)...
<!-- HATCH3R:END -->

## My Custom Section
...never overwritten...
```

Only content between `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` is updated by `hatch3r sync` or `hatch3r update`. Content you add outside these markers is preserved. Config files (JSON, TOML, YAML) are fully regenerated.

For more on how managed blocks interact with customization, see [Customization](../../guides/customization).

## Naming Convention

hatch3r uses a prefix-based naming convention:

- `hatch3r-*` files are **managed** by hatch3r -- updated on sync
- Files without the prefix are **custom** -- never touched by hatch3r

This applies to rules, agents, skills, commands, and all generated tool-specific files.
