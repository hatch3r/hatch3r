---
sidebar_position: 5
title: Adapter Capability Matrix
---

# Adapter Capability Matrix

Living reference for framework capabilities vs. adapter implementations. As of 1.9.0 hatch3r supports 3 adapters: Claude Code, Cursor, and GitHub Copilot. Twelve adapters were removed in a hard cut — see the [CHANGELOG](https://github.com/hatch3r/hatch3r/blob/main/CHANGELOG.md) for the full breaking-change list.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Y** | Adapter emits files for this capability |
| **B** | Bridge: content folded into an instruction file the platform reads |
| **--** | Platform has no known support for this capability |
| **skip** | Platform supports this but only globally; intentionally omitted |

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | hooks | model | githubAgents | agentTeams |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:-----:|:-----:|:------------:|:----------:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | Y | Y | -- | -- |
| **copilot** | Y | Y | Y | Y | Y | Y | -- | -- | Y | Y | Y |
| **claude** | Y | Y | Y | -- | Y | Y | -- | Y | Y | -- | -- |

## Model Customization

All 3 adapters emit agent model preferences when configured; skill and command model emission (release/2.2.0, `models.skills` / `models.commands`) is per-adapter — only surfaces whose platform documents a `model` frontmatter field carry one. `models.default` feeds agents only. `inherit` and platform-unrecognizable values are omitted (an omitted field is the inherit/unset semantic). See [Model Selection](../guides/model-selection) for configuration, aliases, and resolution order.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| **cursor** | Native — `model:` in agent YAML frontmatter | -- | -- |
| **copilot** | Native (VS Code) — `model:` in agent YAML; ignored on github.com | -- (SKILL.md model support unverified) | Native — string-form `model:` in `.github/prompts/*.prompt.md` |
| **claude** | Native — `model:` in sub-agent YAML frontmatter, plus `## Recommended Model` prose for the per-session override path | Native — `model:` in SKILL.md frontmatter | Native — `model:` in command frontmatter |

Model-class routing (release/2.7.0 — canonical agents declare `frontier | advanced | standard | economy` plus an optional `low | medium | high | xhigh | max` effort level; see [Model Selection → Model Classes](../guides/model-selection#model-classes)):

- **cursor** routes `frontier`/`advanced` to concrete id pins (`claude-fable-5` / `claude-opus-4-8`), `economy` to the `fast` keyword, and omits `standard`; effort rides as an `[effort=high]` bracket suffix on the `frontier`/`advanced` pins, appended only when the resolved effort is `xhigh` or `max` and clamped to the documented `high`.
- **copilot** routes `frontier`/`advanced`/`economy` to supported-models display names (`Claude Fable 5` / `Claude Opus 4.8` / `Claude Haiku 4.5`) and omits `standard`; there is no effort surface, so the resolved effort is dropped at emission.
- **claude** routes classes to model aliases (`fable`/`opus`/`sonnet`/`haiku`) and emits the resolved effort verbatim as a native `effort:` frontmatter key beside `model:` (`standard` gets neither an effort default nor, when nothing resolves, an `effort:` line).

## Secret Management {#secret-management}

All MCP secrets are centralized in `.env.mcp` at the project root.

| Adapter | Secret loading method | Auto-loads `.env.mcp`? |
|---------|----------------------|:----------------------:|
| **copilot** | `envFile` (STDIO) + `${input:NAME}` (HTTP headers) | STDIO: yes |
| **cursor** | `${env:VAR}` from process env | No |
| **claude** | `${env:VAR}` from process env | No |

For editors that don't auto-load, source before launching:

```bash
set -a && source .env.mcp && set +a && <editor-command> .
```

## Intentional Omissions

| Adapter | Capability | Reason |
|---------|------------|--------|
| copilot | hooks | No documented hook/event system on GitHub Copilot Chat |
| all | guardrails | Canonical location exists in bundled content for future use |
| all | prompts (except copilot) | Only Copilot has a dedicated prompts format |
| all | githubAgents (except copilot) | Copilot-specific capability |
