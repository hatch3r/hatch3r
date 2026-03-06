---
title: Content Model
---

# Content Model

All hatch3r content lives in the `.agents/` directory. This is the single source of truth -- tool-specific outputs are generated from it.

```
.agents/
  ├── agents/          16 agent definitions (markdown with YAML frontmatter)
  ├── skills/          25 skill bundles (each a directory with SKILL.md)
  ├── rules/           22 rule files (markdown with YAML frontmatter)
  ├── commands/        33 command workflows (markdown)
  ├── prompts/         Reusable prompt templates
  ├── hooks/           Event-driven automation triggers
  ├── mcp/             MCP server configuration (mcp.json)
  ├── policy/          Guardrails and deny lists (future)
  ├── github-agents/   GitHub Copilot-specific agent definitions
  ├── AGENTS.md        Shared orchestration instructions
  └── hatch.json       Project manifest
```

## Content Types

| Type | Source Path | Frontmatter | Purpose |
|------|-----------|-------------|---------|
| **Agent** | `.agents/agents/*.md` | `id`, `type`, `description`, `model`, `readonly`, `background` | Agent role definitions with behavioral instructions |
| **Skill** | `.agents/skills/*/SKILL.md` | `id`, `type`, `description` | On-demand instruction bundles for specific tasks |
| **Rule** | `.agents/rules/*.md` | `id`, `type`, `description`, `alwaysApply`, `globs` | Persistent instructions (coding standards, conventions) |
| **Command** | `.agents/commands/*.md` | `id`, `type`, `description` | Slash-command workflows |
| **Prompt** | `.agents/prompts/*.md` | `id`, `type`, `description` | Reusable prompt templates |
| **Hook** | `.agents/hooks/*.md` | `id`, `type`, `description`, `event`, `agent` | Event-triggered automation |

All content files use markdown with YAML frontmatter. The `id` field uses the `hatch3r-` prefix (e.g., `hatch3r-code-standards`) to distinguish managed content from custom files.
