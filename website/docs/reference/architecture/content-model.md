---
title: Content Model
---

# Content Model

All hatch3r content lives in the `.agents/` directory. This is the single source of truth -- tool-specific outputs are generated from it.

During `hatch3r init`, only the content matching your selected profile and context is copied. The full catalog has 16 agents, 25 skills, 22 rules, 34 commands, 3 prompts, 6 hooks, and 4 GitHub agents — but a typical project uses a subset.

```
.agents/
  ├── agents/          Agent definitions (markdown with YAML frontmatter)
  ├── skills/          Skill bundles (each a directory with SKILL.md)
  ├── rules/           Rule files (markdown with YAML frontmatter)
  ├── commands/        Command workflows (markdown)
  ├── prompts/         Reusable prompt templates
  ├── hooks/           Event-driven automation triggers
  ├── mcp/             MCP server configuration (mcp.json)
  ├── learnings/       Project learnings (pitfalls, patterns, decisions)
  ├── checks/          Quality check definitions
  ├── policy/          Guardrails and deny lists (future)
  ├── github-agents/   GitHub Copilot-specific agent definitions
  ├── AGENTS.md        Dynamically generated orchestration instructions
  └── hatch.json       Project manifest (includes content selection)
```

## Content Types

| Type | Source Path | Frontmatter | Purpose |
|------|-----------|-------------|---------|
| **Agent** | `.agents/agents/*.md` | `id`, `type`, `description`, `model`, `readonly`, `background`, `tags` | Agent role definitions with behavioral instructions |
| **Skill** | `.agents/skills/*/SKILL.md` | `id`, `type`, `description`, `tags` | On-demand instruction bundles for specific tasks |
| **Rule** | `.agents/rules/*.md` | `id`, `type`, `description`, `alwaysApply`, `globs`, `tags` | Persistent instructions (coding standards, conventions) |
| **Command** | `.agents/commands/*.md` | `id`, `type`, `description`, `tags` | Slash-command workflows |
| **Prompt** | `.agents/prompts/*.md` | `id`, `type`, `description`, `tags` | Reusable prompt templates |
| **Hook** | `.agents/hooks/*.md` | `id`, `type`, `description`, `event`, `agent`, `tags` | Event-triggered automation |

All content files use markdown with YAML frontmatter. The `id` field uses the `hatch3r-` prefix (e.g., `hatch3r-code-standards`) to distinguish managed content from custom files.

## Content Tags

Every content file has a `tags` field in its frontmatter that categorizes it for selective init:

| Tag Category | Tags | Purpose |
|-------------|------|---------|
| **Workflow** | `core`, `planning`, `implementation`, `review`, `devops`, `maintenance` | Development lifecycle phase |
| **Context** | `greenfield`, `brownfield`, `solo`, `team` | Project type and team size |
| **Domain** | `board`, `security`, `a11y`, `performance`, `customize` | Specialized areas |

Tags are used by the preset system to filter content during `hatch3r init`. The `core` tag identifies items essential for any hatch3r project. Context tags enable automatic filtering based on project type and team size.

## Content Selection

The `hatch.json` manifest includes a `content` field that tracks which items are installed:

```json
{
  "content": {
    "preset": "standard",
    "projectType": "brownfield",
    "teamSize": "solo",
    "items": {
      "agents": ["hatch3r-implementer", "hatch3r-reviewer", "..."],
      "skills": ["hatch3r-feature", "hatch3r-bug-fix", "..."],
      "rules": ["hatch3r-code-standards", "hatch3r-testing", "..."],
      "commands": ["hatch3r-workflow", "hatch3r-quick-change", "..."],
      "prompts": ["hatch3r-bug-triage", "..."],
      "hooks": ["..."],
      "githubAgents": ["..."]
    }
  }
}
```

Use `hatch3r config` to add or remove items after init. `hatch3r update` respects the content selection and only updates installed items.
