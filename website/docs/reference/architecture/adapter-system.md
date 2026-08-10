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
    ├──→ Claude adapter    → CLAUDE.md, .claude/rules/*.md, .mcp.json, ...
    └──→ Codex adapter     → AGENTS.md, .agents/skills/, .codex/agents/, .codex/config.toml
```

The current adapter set is Claude Code, Cursor, GitHub Copilot, and Codex. Codex uses `.agents/skills`, not the obsolete `.codex/skills` layout.

## Emission Strategies

The four adapters use three emission strategies:

- **Native** -- tool has a specific per-file config format (Cursor `.mdc` rule frontmatter and `.cursor/agents/`; Copilot YAML frontmatter under `.github/instructions/`, `.github/agents/`)
- **Bridge** -- content is folded into an official instruction/skill surface (for example, Codex glob rules route through `AGENTS.md` and commands become `$hatch3r-command-*` skills)
- **Unsupported** -- no safe documented equivalent is emitted; Codex native slash commands, native glob-rule files, and an always-available native question tool are examples

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

Only Hatcher-owned regions and namespaced entries are updated by `hatch3r sync` or `hatch3r update`. Content you add outside managed markers is preserved. Shared Codex TOML and hook JSON are parsed, validated, and merged without claiming unrelated entries. Codex support companions under `.hatch3r/codex-support/` are dependency-closure projections with path and vocabulary translation, not verbatim canonical copies.

For more on how managed blocks interact with customization, see [Customization](../../guides/customization).

## Naming Convention

hatch3r uses a prefix-based naming convention:

- `hatch3r-*` files are **managed** by hatch3r -- updated on sync
- Files without the prefix are **custom** -- never touched by hatch3r

This applies to rules, agents, skills, commands, and all generated tool-specific files.
