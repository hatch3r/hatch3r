---
title: Content Model
---

# Content Model

Canonical hatch3r content ships inside the bundled npm package — it is the single source of truth, and tool-specific outputs are generated from it. As of 1.9.0 end-user repos no longer materialize a `.agents/` mirror; adapters read canonical content directly from the package. Your repo holds only the manifest, your overrides, and the generated tool outputs (see [Quick Start — What gets created](../../getting-started/quick-start#what-gets-created)).

During `hatch3r init`, only the content matching your selected profile and context is generated. The full catalog has 30 agents, 55 skills, 74 rules, 33 commands, 7 hooks, 5 checks, and 4 GitHub agents — but a typical project uses a subset. (The `prompts` class ships no canonical content; it is reserved for distributed packs.)

```
Bundled npm package (canonical source)
  ├── agents/          Agent definitions (markdown with YAML frontmatter)
  ├── skills/          Skill bundles (each a directory with SKILL.md)
  ├── rules/           Rule files (markdown with YAML frontmatter)
  ├── commands/        Command workflows (markdown)
  ├── hooks/           Event-driven automation triggers
  ├── checks/          Quality check definitions
  └── github-agents/   GitHub Copilot-specific agent definitions

Your repo (.hatch3r/)
  ├── hatch.json       Project manifest (includes content selection)
  ├── overrides/       User-tier canonical overrides (preferred over bundled content)
  ├── mcp/mcp.json     Resolved MCP server configuration
  ├── learnings/       Project learnings (pitfalls, patterns, decisions)
  └── handoffs/        Cross-session task handoff bundles
```

## Content Types

Source paths below are relative to the canonical content root (the bundled npm package, or the framework repo's top level). User-tier overrides mirror this layout under `.hatch3r/overrides/`.

| Type | Source Path | Frontmatter | Purpose |
|------|-----------|-------------|---------|
| **Agent** | `agents/*.md` | `id`, `type`, `description`, `model`, `readonly`, `background`, `tags` | Agent role definitions with behavioral instructions |
| **Skill** | `skills/*/SKILL.md` | `id`, `type`, `description`, `tags` | On-demand instruction bundles for specific tasks |
| **Rule** | `rules/*.md` | `id`, `type`, `description`, `alwaysApply`, `globs`, `precedence`, `tags` | Persistent instructions (coding standards, conventions) |
| **Command** | `commands/*.md` | `id`, `type`, `description`, `tags` | Slash-command workflows |
| **Hook** | `hooks/*.md` | `id`, `type`, `description`, `event`, `agent`, `tags` | Event-triggered automation |

All content files use markdown with YAML frontmatter. The `id` field uses the `hatch3r-` prefix (e.g., `hatch3r-code-standards`) to distinguish managed content from custom files.

Rules may also declare an optional `precedence: critical|high|normal|low` field (default `normal`). Per-file rule adapters (cursor, copilot) emit filenames prefixed with a two-digit rank (`10-`, `30-`, `50-`, `70-`) so generated output loads in precedence order. See [Rules reference](../rules#rule-precedence-and-description-quality) for details.

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
    "preset": "full",
    "projectType": "brownfield",
    "teamSize": "solo",
    "items": {
      "agents": ["hatch3r-implementer", "hatch3r-reviewer", "..."],
      "skills": ["hatch3r-feature", "hatch3r-bug-fix", "..."],
      "rules": ["hatch3r-code-standards", "hatch3r-testing", "..."],
      "commands": ["hatch3r-workflow", "hatch3r-quick-change", "..."],
      "hooks": ["..."],
      "githubAgents": ["..."]
    }
  }
}
```

Use `hatch3r config` to add or remove items after init. `hatch3r update` respects the content selection and only updates installed items.
