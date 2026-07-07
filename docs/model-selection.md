# Model Selection

hatch3r lets you configure preferred AI models for your agents — and, where the tool supports it, for skills and commands. You can set a global default (agents only), override per artifact id, or use project-specific customization files. Each adapter emits the model in the format its platform expects.

## Overview

When you configure a model, hatch3r includes it in the generated config for each tool (Claude Code, Cursor, Copilot, etc.). Some platforms support native model selection in their config; others receive the recommendation as guidance text. Either way, the preference is preserved across `npx hatch3r sync` runs.

**When no model is configured at any level**, hatch3r does not emit a model preference. Each platform (Claude Code, Cursor, Copilot, etc.) uses its own default.

**When you change a model on an already-generated artifact**, the new value lands in the YAML frontmatter stub at the top of the generated file — a region hatch3r treats as user-owned and preserves across `sync`/`update` (the managed `HATCH3R:BEGIN…END` block below it is what gets refreshed). To apply a model change to an existing file, delete that generated file and run `npx hatch3r update` (it re-emits missing files with current config); freshly generated files always carry the configured model.

## Configuration Points

The same four layers apply per artifact class (`agents`, `skills`, `commands`):

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/{class}/{id}.customize.yaml` | Highest |
| Manifest per-artifact | `hatch.json` → `models.{class}.{id}` (`models.agents`, `models.skills`, `models.commands`) | 2nd |
| Canonical frontmatter | bundled artifact frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` → `models.default` — **agents only** | 4th |
| (none) | — | Platform auto-select |

> **Authoring `.customize.*` files.** No terminal command writes these files. Create `.hatch3r/{type}/{id}.customize.yaml` (settings — `model`, `scope`, `description`, `enabled`) or `.hatch3r/{type}/{id}.customize.md` (markdown appended under the managed block) by hand, or run the `/hatch3r-customize` workflow which authors them for you. `hatch3r sync` then propagates the override into the generated outputs. The `hatch.json` and frontmatter columns above ARE edited via `hatch3r config`; the `.customize.*` layer is not.

## Resolution Order

1. **Customization file** — If `.hatch3r/{class}/{id}.customize.yaml` exists and has a `model` field, that value wins.
2. **Manifest per-artifact** — `hatch.json` → `models.{class}[id]`
3. **Canonical frontmatter** — `model:` in the bundled artifact
4. **Manifest default** — `hatch.json` → `models.default` — applies to **agents only**. Skills and commands never inherit `models.default`: a default that fed them would add `model:` lines to every generated skill/command the moment it is set, and a command-level model switches the whole conversation model — that must stay an explicit per-id choice.
5. **No model** — hatch3r emits nothing; the platform uses its own default.

## Emission Surfaces (per adapter)

Model lines are emitted only where the tool documents a `model` field on that surface. `inherit` is never written — an omitted field IS the inherit/unset semantic — and platform-unrecognizable values (e.g. `gpt-4` on Claude Code, the hatch3r tier words `standard`/`fast`) are omitted rather than shipped as dead frontmatter.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| Claude Code | `model:` in `.claude/agents/*.md` (+ `## Recommended Model` prose) | `model:` in `.claude/skills/*/SKILL.md` | `model:` in `.claude/commands/*.md` |
| Copilot | `model:` in `.github/agents/*.agent.md` | never (SKILL.md model support unverified as of 2026-07-08) | `model:` in `.github/prompts/*.prompt.md` (string form only; no `inherit` keyword — unset = field omitted) |
| Cursor | `model:` in `.cursor/agents/*.md` | never (no documented field) | never (no documented field) |

## Aliases

You can use short aliases instead of full model IDs. hatch3r resolves them before emitting.

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

In the bundled `agents/hatch3r-implementer.md` (or a `.hatch3r/overrides/agents/hatch3r-implementer.md` override):

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

Some agents ship with a default model in their canonical frontmatter. These defaults are tuned for the agent's cognitive profile: mechanical tasks use a fast model to save cost, while quality-sensitive tasks lock in a balanced model as a floor.

| Agent | Default | Rationale |
|-------|---------|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost matter most |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition; fast feedback loops |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy need a capable model |
| `hatch3r-security` | `sonnet` | OAuth/OIDC/supply-chain analysis requires solid reasoning |
| `hatch3r-ui` | `sonnet` | WCAG 2.2 AA + design-token interpretation requires solid reasoning |
| `hatch3r-testability` | `sonnet` | Edge-case identification and test design need reasoning depth |

Agents without a default (`hatch3r-implementer`, `hatch3r-researcher`, `hatch3r-reviewer`, `hatch3r-performance`, `hatch3r-architect`, `hatch3r-context-rules`, `hatch3r-devops`, `hatch3r-fixer`, `hatch3r-learnings-loader`) use the platform's own default. Their task complexity varies too widely for a single tier to fit.

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
| Copilot | Yes (VS Code) | Emits `model:` in agent/prompt YAML; ignored on github.com |
| OpenCode | Yes | Emits `model: provider/id` in agent config |
| Codex (OpenAI) | Yes | Emits `model = "id"` in TOML |
| Claude Code | Yes | Emits `model:` in agent/skill/command YAML frontmatter (Claude-recognizable values); agents also carry `## Recommended Model` guidance (`/model` command and env var) |
| Cline/Roo | No | Emits guidance in role definition |
| Gemini | No | Emits guidance in GEMINI.md |
| Windsurf | No | Emits guidance in .windsurfrules |
| Amp | No | Emits guidance in .amp/AGENTS.md |
| Aider | No | Emits guidance as comment in CONVENTIONS.md |
| Kiro | No | Emits guidance in steering files |
| Goose | No | Emits guidance as comment in .goosehints |
| Zed | No | Emits guidance as comment in .rules |

## Adapter Support

- **Native config** — Claude Code, Cursor, Copilot, OpenCode, Codex emit the model in the platform's config format. The tool can apply it directly.
- **Guidance** — Cline, Gemini, Windsurf, Amp receive the model as instructional text. Users set it manually (e.g., via CLI flag or UI). Claude Code agents additionally carry `## Recommended Model` guidance for the per-session override path.

## Related

- [adapter-capability-matrix.md](adapter-capability-matrix.md) — Platform support matrix and model emission per adapter
- [hatch3r-customize](../skills/hatch3r-customize/SKILL.md) — Per-artifact customization (agents, commands, rules, skills) including model overrides via `.hatch3r/agents/{id}.customize.yaml`
