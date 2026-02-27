# Model Selection

hatch3r lets you configure preferred AI models for your agents. You can set a global default, override per agent, or use project-specific customization files. Each adapter emits the model in the format its platform expects.

## Overview

When you configure a model, hatch3r includes it in the generated config for each tool (Cursor, Copilot, Claude Code, etc.). Some platforms support native model selection in their config; others receive the recommendation as guidance text. Either way, the preference is preserved across `npx hatch3r sync` runs.

**When no model is configured at any level**, hatch3r does not emit a model preference. Each platform (Cursor, Copilot, Claude Code, etc.) uses its own default.

## Configuration Points

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/agents/{agent-id}.customize.yaml` | Highest |
| Manifest per-agent | `hatch.json` → `models.agents.{agent-id}` | 2nd |
| Canonical agent | `.agents/agents/{agent-id}.md` frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` → `models.default` | 4th |
| (none) | — | Platform auto-select |

## Resolution Order

1. **Customization file** — If `.hatch3r/agents/{agent-id}.customize.yaml` exists and has a `model` field, that value wins.
2. **Manifest per-agent** — `hatch.json` → `models.agents[agent-id]`
3. **Canonical agent frontmatter** — `model:` in `.agents/agents/{agent-id}.md`
4. **Manifest default** — `hatch.json` → `models.default`
5. **No model** — hatch3r emits nothing; the platform uses its own default.

## Aliases

You can use short aliases instead of full model IDs. hatch3r resolves them before emitting.

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

Some agents ship with a default model in their canonical frontmatter. These defaults are tuned for the agent's cognitive profile: mechanical tasks use a fast model to save cost, while quality-sensitive tasks lock in a balanced model as a floor.

| Agent | Default | Rationale |
|-------|---------|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost matter most |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition; fast feedback loops |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy need a capable model |
| `hatch3r-dependency-auditor` | `sonnet` | Structured CVE/freshness analysis with clear SLAs |
| `hatch3r-a11y-auditor` | `sonnet` | WCAG standard interpretation requires solid reasoning |
| `hatch3r-test-writer` | `sonnet` | Edge-case identification and test design need reasoning depth |

Agents without a default (`hatch3r-implementer`, `hatch3r-researcher`, `hatch3r-reviewer`, `hatch3r-security-auditor`, `hatch3r-perf-profiler`) use the platform's own default. Their task complexity varies too widely for a single tier to fit.

These defaults sit at precedence level 3 (canonical frontmatter). Override them at any higher level:

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

The built-in defaults resolve to Anthropic model IDs (`claude-haiku-4-5`, `claude-sonnet-4-6`). On platforms that only support their own models (e.g., Codex CLI, Gemini CLI), set a project-wide override in `hatch.json`:

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

Manifest-level overrides (precedence 2 and 4) take priority over canonical frontmatter defaults, so all agents will use your platform's models.

## Platform Behavior

When no model is set, each tool uses its own default.

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

## Adapter Support

- **Native config** — Cursor, Copilot, OpenCode, Codex emit the model in the platform's config format. The tool can apply it directly.
- **Guidance** — Claude Code, Cline, Gemini, Windsurf, Amp receive the model as instructional text. Users set it manually (e.g., via CLI flag or UI).

## Related

- [adapter-capability-matrix.md](adapter-capability-matrix.md) — Platform support matrix and model emission per adapter
- [hatch3r-agent-customize](../commands/hatch3r-agent-customize.md) — Per-agent customization including model overrides via `.hatch3r/agents/{id}.customize.yaml`
