---
sidebar_position: 4
title: Model Selection
---

# Model Selection

hatch3r lets you configure preferred AI models for your agents. You can set a global default, override per agent, or use project-specific customization files.

## Overview

When you configure a model, hatch3r includes it in the generated config for each tool (Cursor, Copilot, Claude Code, etc.). Some platforms support native model selection in their config; others receive the recommendation as guidance text. Either way, the preference is preserved across `npx hatch3r sync` runs.

When no model is configured at any level, hatch3r does not emit a model preference. Each platform uses its own default.

## Configuration Points

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/agents/{agent-id}.customize.yaml` | Highest |
| Manifest per-agent | `hatch.json` -> `models.agents.{agent-id}` | 2nd |
| Canonical agent | `.agents/agents/{agent-id}.md` frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` -> `models.default` | 4th |
| (none) | -- | Platform auto-select |

## Resolution Order

1. **Customization file** -- `.hatch3r/agents/{agent-id}.customize.yaml` with a `model` field wins
2. **Manifest per-agent** -- `hatch.json` -> `models.agents[agent-id]`
3. **Canonical agent frontmatter** -- `model:` in `.agents/agents/{agent-id}.md`
4. **Manifest default** -- `hatch.json` -> `models.default`
5. **No model** -- platform uses its own default

## Aliases

Use short aliases instead of full model IDs. hatch3r resolves them before emitting.

| Alias | Resolves To |
|-------|-------------|
| `opus` | `claude-opus-4-6` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` |
| `codex` | `gpt-5.3-codex` |
| `codex-prev` | `gpt-5.2-codex` |
| `codex-mini` | `gpt-5.1-codex-mini` |
| `codex-spark` | `gpt-5.3-codex-spark` |
| `gemini-pro` | `gemini-3.1-pro` |
| `gemini-flash` | `gemini-3-flash` |
| `gemini-stable` | `gemini-2.5-pro` |

Unknown values are passed through as-is.

## Examples

### hatch.json

```json
{
  "models": {
    "default": "opus",
    "agents": {
      "hatch3r-lint-fixer": "sonnet",
      "hatch3r-test-writer": "gemini-pro"
    }
  }
}
```

### Canonical agent frontmatter

In `.agents/agents/hatch3r-implementer.md`:

```yaml
---
id: hatch3r-implementer
description: Focused implementation agent for a single issue.
model: opus
---
```

### Customization YAML

In `.hatch3r/agents/hatch3r-reviewer.customize.yaml`:

```yaml
agent: hatch3r-reviewer
model: codex
```

## Built-in Agent Defaults

Some agents ship with a default model in their canonical frontmatter. These defaults are tuned for the agent's cognitive profile.

| Agent | Default | Rationale |
|-------|---------|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition; fast feedback |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy |
| `hatch3r-dependency-auditor` | `sonnet` | Structured CVE/freshness analysis |
| `hatch3r-a11y-auditor` | `sonnet` | WCAG standard interpretation |
| `hatch3r-test-writer` | `sonnet` | Edge-case identification and test design |

Agents without a default (`hatch3r-implementer`, `hatch3r-researcher`, `hatch3r-reviewer`, `hatch3r-security-auditor`, `hatch3r-perf-profiler`) use the platform's own default.

Override at any higher precedence level:

```json
{
  "models": {
    "agents": {
      "hatch3r-lint-fixer": "sonnet"
    }
  }
}
```

### Cross-Platform Override

Built-in defaults resolve to Anthropic model IDs. On platforms that only support their own models (Codex CLI, Gemini CLI), set a project-wide override:

```json
{
  "models": {
    "default": "codex",
    "agents": {
      "hatch3r-lint-fixer": "codex-spark",
      "hatch3r-ci-watcher": "codex-spark"
    }
  }
}
```

## Platform Behavior

| Platform | Native config? | When model is set |
|----------|:--------------:|-------------------|
| Cursor | Yes | `model:` in agent YAML frontmatter |
| Copilot | Yes (VS Code) | `model:` in agent YAML; ignored on github.com |
| OpenCode | Yes | `model: provider/id` in agent config |
| Codex | Yes | `model = "id"` in TOML |
| Claude Code | No | Guidance: `/model` command and env var |
| Cline/Roo | No | Guidance in role definition |
| Gemini | No | Guidance in GEMINI.md |
| Windsurf | No | Guidance in .windsurfrules |
| Amp | No | Guidance in .amp/AGENTS.md |

- **Native config** -- the tool can apply the model directly
- **Guidance** -- the model is included as instructional text; users set it manually
