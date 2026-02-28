---
sidebar_position: 1
title: Introduction
slug: introduction
---

# hatch3r

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository. One command gives you agents, skills, rules, commands, and MCP integrations -- optimized for your coding tool of choice.

## What is hatch3r?

hatch3r maintains a **single canonical source** of agent configuration in `/.agents/` and generates **native configuration** for 13 AI coding platforms. You define your agent setup once and hatch3r adapts it to whatever tool you use.

```
/.agents/              <- Canonical source (tool-agnostic)
  ├── agents/
  ├── skills/
  ├── rules/
  ├── commands/
  ├── mcp/
  ├── AGENTS.md
  └── hatch.json       <- Manifest

.cursor/               <- Generated (Cursor adapter)
.github/               <- Generated (Copilot adapter)
CLAUDE.md              <- Generated (Claude adapter)
.windsurfrules         <- Generated (Windsurf adapter)
AGENTS.md              <- Generated (OpenCode, Amp, Codex adapters)
GEMINI.md              <- Generated (Gemini adapter)
.clinerules            <- Generated (Cline adapter)
```

## Key Features

- **One command setup** -- `npx hatch3r init` detects your repo, asks which tools you use, and generates everything
- **Tool-agnostic** -- single source of truth with adapters for 13 platforms
- **Board management** -- full GitHub Projects V2 lifecycle from `todo.md` to merged PRs
- **Sub-agentic delegation** -- implementer agents, dependency-aware orchestration, collision detection
- **Safe merge system** -- managed blocks preserve your customizations across syncs
- **Extensible** -- per-agent model selection, `.customize.yaml` overrides, composable recipes, event-driven hooks

## Requirements

- **Node.js 22+** (check with `node --version`)
- A git repository (for board features, a GitHub remote)

## Next Steps

- [Quick Start](./quick-start) -- install hatch3r in under a minute
- [What You Get](./what-you-get) -- explore the agents, skills, rules, and commands included
- [Supported Tools](./supported-tools) -- see which coding tools are supported
