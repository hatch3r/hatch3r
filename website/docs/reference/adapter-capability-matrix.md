---
sidebar_position: 5
title: Adapter Capability Matrix
---

# Adapter Capability Matrix

Living reference for framework capabilities vs. adapter implementations. Tracks what each adapter emits, what each platform supports natively, and where gaps remain.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Y** | Adapter emits files for this capability |
| **~** | Platform reads canonical `.agents/` paths natively; no adapter output needed |
| **B** | Bridge: content folded into an instruction file the platform reads |
| **--** | Platform has no known support for this capability |
| **skip** | Platform supports this but only globally; intentionally omitted |

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | hooks | model |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:-----:|:-----:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | Y | Y |
| **copilot** | Y | Y | Y | Y | Y | Y | -- | -- | Y |
| **claude** | Y | Y | Y | -- | Y | Y | -- | Y | Y |
| **cline** | Y | Y | Y | -- | Y | Y | -- | Y | Y |
| **codex** | B | B | Y | -- | -- | Y | -- | -- | Y |
| **gemini** | Y | B | Y | -- | Y | Y | -- | Y | Y |
| **windsurf** | Y | B | Y | -- | Y | Y | -- | -- | Y |
| **amp** | B | B | Y | -- | ~ | Y | -- | -- | Y |
| **opencode** | Y | Y | Y | -- | Y | Y | -- | -- | Y |
| **aider** | B | B | Y | -- | -- | -- | -- | -- | Y |
| **kiro** | Y | B | Y | -- | -- | Y | -- | -- | Y |
| **goose** | B | B | B | -- | -- | -- | -- | -- | Y |
| **zed** | B | B | -- | -- | -- | -- | -- | -- | Y |

## Agent Model Customization

All adapters emit model preferences when configured. See [Model Selection](../guides/model-selection) for configuration and aliases.

| Adapter | Emission | Notes |
|---------|----------|-------|
| **cursor** | Native | `model:` in agent YAML frontmatter |
| **copilot** | Native (VS Code) | `model:` in agent YAML; ignored on github.com |
| **opencode** | Native | `model: provider/id` in agent config |
| **codex** | Native | `model = "id"` in TOML agent section |
| **claude** | Guidance | Text in agent content |
| **cline** | Guidance | Text in `roleDefinition` |
| **gemini** | Guidance | Text in GEMINI.md |
| **windsurf** | Guidance | Text in .windsurfrules |
| **amp** | Guidance | Text in .amp/AGENTS.md |
| **aider** | Guidance | Text in CONVENTIONS.md |
| **kiro** | Guidance | Text in .kiro/steering/hatch3r-agents.md |
| **goose** | Guidance | Text in .goosehints |
| **zed** | Guidance | Text in .rules |

## Secret Management {#secret-management}

All MCP secrets are centralized in `.env.mcp` at the project root.

| Adapter | Secret loading method | Auto-loads `.env.mcp`? |
|---------|----------------------|:----------------------:|
| **copilot** | `envFile` field per STDIO server | Yes |
| **cursor** | `${env:VAR}` from process env | No |
| **claude** | `${env:VAR}` from process env | No |
| **cline** | `${env:VAR}` from process env | No |
| **opencode** | `${env:VAR}` from process env | No |
| **amp** | `${env:VAR}` from process env | No |
| **gemini** | `${env:VAR}` from process env | No |
| **codex** | `${env:VAR}` from process env | No |
| **windsurf** | `${env:VAR}` from process env | No |
| **aider** | N/A | No |
| **kiro** | `${env:VAR}` from process env | No |
| **goose** | N/A (global MCP only) | No |
| **zed** | N/A (global MCP only) | No |

For editors that don't auto-load, source before launching:

```bash
set -a && source .env.mcp && set +a && <editor-command> .
```

## Intentional Omissions

| Adapter | Capability | Reason |
|---------|------------|--------|
| windsurf | hooks | No documented hook/event system |
| opencode | hooks | No documented hook/event system |
| amp | hooks | No documented hook/event system |
| codex | hooks | No documented hook/event system |
| aider | mcp | No project-level MCP config format |
| aider | hooks | No documented hook/event system |
| goose | mcp | Global-only MCP config |
| goose | hooks | No documented hook/event system |
| kiro | hooks | No documented hook/event system |
| zed | mcp | Global-only MCP config |
| zed | hooks | No documented hook/event system |
| zed | skills | No skills concept; rules cover all guidance |
| all | guardrails | Canonical location exists for future use |
| all | prompts (except copilot) | Only Copilot has dedicated prompts format |
