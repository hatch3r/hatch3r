---
sidebar_position: 2
title: Model Selection
---

# Model Selection

hatch3r lets you configure preferred AI models for your agents. You can set a global default, override per agent, or use project-specific customization files.

## Configuration Points

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/agents/{agent-id}.customize.yaml` | Highest |
| Manifest per-agent | `hatch.json` → `models.agents.{agent-id}` | 2nd |
| Canonical agent | `.agents/agents/{agent-id}.md` frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` → `models.default` | 4th |
| (none) | — | Platform auto-select |

## Aliases

You can use short aliases instead of full model IDs:

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

Some agents ship with a default model in their canonical frontmatter:

| Agent | Default | Rationale |
|-------|---------|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy |
| `hatch3r-dependency-auditor` | `sonnet` | Structured CVE/freshness analysis |
| `hatch3r-a11y-auditor` | `sonnet` | WCAG standard interpretation |
| `hatch3r-test-writer` | `sonnet` | Edge-case identification and test design |

## Platform Behavior

| Platform | Native config? | When model is set |
|----------|----------------|-------------------|
| Cursor | Yes | Emits `model:` in agent YAML frontmatter |
| Copilot | Yes (VS Code) | Emits `model:` in agent YAML; ignored on github.com |
| OpenCode | Yes | Emits `model: provider/id` in agent config |
| Codex (OpenAI) | Yes | Emits `model = "id"` in TOML |
| Claude Code | No | Emits guidance: `/model` command and env var |
| Cline/Roo | No | Emits guidance in role definition |
| Gemini | No | Emits guidance in GEMINI.md |
| Windsurf | No | Emits guidance in .windsurfrules |
| Amp | No | Emits guidance in .amp/AGENTS.md |
| Aider | No | Emits guidance as comment in CONVENTIONS.md |
| Kiro | No | Emits guidance in steering files |
| Goose | No | Emits guidance as comment in .goosehints |
| Zed | No | Emits guidance as comment in .rules |
