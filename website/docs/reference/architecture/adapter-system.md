---
title: Adapter System
---

# Adapter System

Adapters transform canonical content into tool-specific formats. Each adapter implements a `generate()` method that reads canonical files and produces output for its target platform.

```
.agents/ (canonical)
    │
    ├──→ Cursor adapter    → .cursor/rules/*.mdc, .cursor/agents/*.md, ...
    ├──→ Copilot adapter   → .github/copilot-instructions.md, .github/agents/*.md, ...
    ├──→ Claude adapter    → CLAUDE.md, .claude/rules/*.md, .mcp.json, ...
    ├──→ OpenCode adapter  → opencode.json, .opencode/agents/*.md, ...
    ├──→ Windsurf adapter  → .windsurfrules, .windsurf/rules/*.md, ...
    ├──→ Amp adapter       → .amp/AGENTS.md, .amp/settings.json, ...
    ├──→ Codex adapter     → AGENTS.md, .codex/config.toml, ...
    ├──→ Gemini adapter    → GEMINI.md, .gemini/settings.json, ...
    ├──→ Cline adapter     → .roomodes, .roo/rules/*.md, .roo/mcp.json, ...
    ├──→ Aider adapter     → CONVENTIONS.md, .aider.conf.yml, ...
    ├──→ Kiro adapter      → .kiro/steering/*.md, .kiro/settings/mcp.json, ...
    ├──→ Goose adapter     → .goosehints
    └──→ Zed adapter       → .rules
```

## Emission Strategies

Adapters handle three emission strategies:

- **Native** -- tool has a specific config format (e.g., Cursor `.mdc` frontmatter, Copilot YAML frontmatter)
- **Bridge** -- content is folded into a single instruction file the platform reads (e.g., `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`)
- **Canonical match** -- platform reads `.agents/` paths natively (e.g., Amp reads `.agents/commands/`)

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
