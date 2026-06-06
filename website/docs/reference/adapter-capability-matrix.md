---
sidebar_position: 5
title: Adapter Capability Matrix
---

# Adapter Capability Matrix

Living reference for framework capabilities vs. adapter implementations. As of 1.9.0 hatch3r supports 3 adapters: Cursor, GitHub Copilot, and Claude Code. Twelve adapters were removed in a hard cut — see the [CHANGELOG](https://github.com/hatch3r-dev/hatch3r/blob/main/CHANGELOG.md) for the full breaking-change list.

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

## Agent Model Customization

All 3 adapters emit model preferences when configured. See [Model Selection](../guides/model-selection) for configuration and aliases.

| Adapter | Emission | Notes |
|---------|----------|-------|
| **cursor** | Native | `model:` in agent YAML frontmatter |
| **copilot** | Native (VS Code) | `model:` in agent YAML; ignored on github.com |
| **claude** | Guidance | Text in agent content |

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
