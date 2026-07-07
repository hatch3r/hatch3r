---
sidebar_position: 4
title: Model Selection
---

# Model Selection

hatch3r lets you configure preferred AI models for your agents — and, where the tool supports it, for skills and commands. You can set a global default (agents only), override per artifact id, or use project-specific customization files.

## Overview

When you configure a model, hatch3r includes it in the generated config for each tool (Claude Code, Cursor, Copilot). Some platforms support native model selection in their config; others receive the recommendation as guidance text. Either way, the preference is preserved across `npx hatch3r sync` runs.

When no model is configured at any level, hatch3r does not emit a model preference. Each platform uses its own default.

## Configuration Points

The same four layers apply per artifact class (`agents`, `skills`, `commands`):

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/{class}/{id}.customize.yaml` | Highest |
| Manifest per-artifact | `hatch.json` -> `models.{class}.{id}` | 2nd |
| Canonical frontmatter | `agents/{id}.md` (etc.) frontmatter `model:` (bundled content; override under `.hatch3r/overrides/{class}/`) | 3rd |
| Manifest default | `hatch.json` -> `models.default` — **agents only** | 4th |
| (none) | -- | Platform auto-select |

## Resolution Order

1. **Customization file** -- `.hatch3r/{class}/{id}.customize.yaml` with a `model` field wins
2. **Manifest per-artifact** -- `hatch.json` -> `models.{class}[id]` (`models.agents`, `models.skills`, `models.commands`)
3. **Canonical frontmatter** -- `model:` in the bundled artifact (or its `.hatch3r/overrides/` override)
4. **Manifest default** -- `hatch.json` -> `models.default` -- applies to **agents only**. Skills and commands never inherit `models.default`: a default that fed them would add `model:` lines to every generated skill/command the moment it is set, and a command-level model switches the whole conversation model — that must stay an explicit per-id choice.
5. **No model** -- platform uses its own default

## Emission Surfaces

Model lines are emitted only where the tool documents a `model` field on that surface. `inherit` is never written — an omitted field IS the inherit/unset semantic on every surface — and values the platform cannot recognize (for example `gpt-4` on Claude Code, or the hatch3r tier words `standard`/`fast`) are omitted rather than shipped as dead frontmatter.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| Claude Code | `model:` in `.claude/agents/*.md` (+ `## Recommended Model` prose) | `model:` in `.claude/skills/*/SKILL.md` | `model:` in `.claude/commands/*.md` |
| Copilot | `model:` in `.github/agents/*.agent.md` | never (SKILL.md model support unverified) | `model:` in `.github/prompts/*.prompt.md` (string form; no `inherit` keyword — unset = field omitted) |
| Cursor | `model:` in `.cursor/agents/*.md` | never (no documented field) | never (no documented field) |

## Aliases

Use short aliases instead of full model IDs. hatch3r resolves them before emitting.

| Alias | Resolves To |
|-------|-------------|
| `opus` | `claude-opus-4-8` |
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
      "hatch3r-testability": "gemini-pro"
    }
  }
}
```

### Canonical agent frontmatter

In the canonical `agents/hatch3r-implementer.md` (bundled content):

```yaml
---
id: hatch3r-implementer
description: Focused implementation agent for a single issue.
model: opus
---
```

### Customization YAML

In `.hatch3r/agents/hatch3r-reviewer.customize.yaml` (keyed by id via its filename, so set only override fields):

```yaml
model: codex
```

## Built-in Agent Defaults

Some agents ship with a default model in their canonical frontmatter. These defaults are tuned for the agent's cognitive profile.

| Agent | Default | Rationale |
|-------|---------|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition; fast feedback |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy |
| `hatch3r-security` | `sonnet` | OAuth/OIDC/supply-chain analysis |
| `hatch3r-ui` | `sonnet` | WCAG 2.2 AA + design-token interpretation |
| `hatch3r-testability` | `sonnet` | Edge-case identification and test design |

Agents without a default (`hatch3r-implementer`, `hatch3r-researcher`, `hatch3r-reviewer`, `hatch3r-performance`) use the platform's own default.

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

Built-in defaults resolve to Anthropic model IDs. Cursor and Copilot can also drive non-Anthropic providers (e.g. OpenAI GPT models) — to run hatch3r agents on those, set a project-wide override:

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
| Copilot | Yes (VS Code) | `model:` in agent/prompt YAML; ignored on github.com |
| Claude Code | Yes | `model:` in agent/skill/command YAML frontmatter (Claude-recognizable values); agents also carry `## Recommended Model` guidance for the `/model` + env-var override path |

- **Native config** -- the tool can apply the model directly
- **Guidance** -- the model is included as instructional text; users set it manually
