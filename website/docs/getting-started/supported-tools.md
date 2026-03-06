---
sidebar_position: 4
title: Supported Tools
---

# Supported Tools

hatch3r generates native configuration for 13 AI coding platforms from a single canonical source.

## Platform Overview

| Tool | Rules | Agents | Skills | Commands | MCP | Hooks |
|------|:-----:|:------:|:------:|:--------:|:---:|:-----:|
| **Cursor** | Y | Y | Y | Y | Y | Y |
| **GitHub Copilot** | Y | Y | Y | Y | Y | -- |
| **Claude Code** | Y | Y | Y | Y | Y | Y |
| **Cline / Roo Code** | Y | Y | Y | Y | Y | Y |
| **OpenCode** | Y | Y | Y | Y | Y | -- |
| **Codex CLI** | B | B | Y | -- | Y | -- |
| **Gemini CLI** | Y | B | Y | Y | Y | Y |
| **Windsurf** | Y | B | Y | Y | Y | -- |
| **Amp** | B | B | Y | ~ | Y | -- |
| **Aider** | B | B | Y | -- | -- | -- |
| **Kiro** | Y | B | Y | -- | Y | -- |
| **Goose** | B | B | B | -- | -- | -- |
| **Zed** | B | B | -- | -- | -- | -- |

**Legend:** **Y** = adapter emits files, **B** = bridge (content folded into instruction file), **~** = platform reads canonical paths natively, **--** = no platform support

## Output Paths

Each adapter generates files in the format its platform expects:

### Cursor

| Capability | Output Path |
|------------|-------------|
| Rules | `.cursor/rules/hatch3r-{id}.mdc` |
| Agents | `.cursor/agents/hatch3r-{id}.md` |
| Skills | `.cursor/skills/hatch3r-{id}/SKILL.md` |
| Commands | `.cursor/commands/hatch3r-{id}.md` |
| MCP | `.cursor/mcp.json` |

### GitHub Copilot

| Capability | Output Path |
|------------|-------------|
| Rules (always) | `.github/copilot-instructions.md` |
| Rules (scoped) | `.github/instructions/hatch3r-{id}.instructions.md` |
| Agents | `.github/agents/hatch3r-{id}.md` |
| Prompts | `.github/prompts/hatch3r-{id}.prompt.md` |
| MCP | `.vscode/mcp.json` |

### Claude Code

| Capability | Output Path |
|------------|-------------|
| Rules | `.claude/rules/hatch3r-{id}.md` |
| Agents | `.claude/agents/hatch3r-{id}.md` |
| Skills | `.claude/skills/hatch3r-{id}/SKILL.md` |
| Bridge | `CLAUDE.md` |
| MCP | `.mcp.json` |

For all platforms, see the full [Adapter Capability Matrix](../reference/adapter-capability-matrix).

## MCP Configuration

MCP server config location varies by tool:

| Tool | Config path |
|------|-------------|
| Cursor | `.cursor/mcp.json` |
| Cursor plugin | `mcp.json` (project root) |
| Claude Code | `.mcp.json` |
| Copilot / VS Code | `.vscode/mcp.json` |
| Cline / Roo | `.roo/mcp.json` |

See the [MCP Setup guide](../guides/mcp-setup) for connecting servers and managing secrets.
