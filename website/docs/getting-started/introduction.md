---
sidebar_position: 1
title: Introduction
slug: introduction
---

# hatch3r

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI and Cursor plugin that installs a battle-tested, tool-agnostic agentic coding setup into any repository. One command gives you agents, skills, rules, commands, and MCP integrations -- optimized for your coding tool of choice.

## What is hatch3r?

hatch3r maintains a **single canonical source** of agent configuration in `.agents/` and generates **native configuration** for 15 AI coding platforms. You define your agent setup once and hatch3r adapts it to whatever tool you use.

```
.agents/                <- Canonical source (tool-agnostic)
  ├── agents/           # Agent definitions (16 agents)
  ├── rules/            # Rule files (27 rules)
  ├── skills/           # Skill directories (26 skills)
  ├── commands/         # Slash commands (34 commands)
  ├── mcp/              # MCP server config
  ├── hooks/            # Event hooks (commit, merge, CI failure, etc.)
  ├── AGENTS.md         # Canonical agent instructions
  └── hatch.json        # Project manifest

.cursor/                <- Generated (Cursor adapter)
.github/                <- Generated (Copilot adapter)
CLAUDE.md               <- Generated (Claude adapter)
.windsurfrules          <- Generated (Windsurf adapter)
AGENTS.md               <- Generated (OpenCode, Amp, Codex adapters)
GEMINI.md               <- Generated (Gemini adapter)
.clinerules             <- Generated (Cline adapter)
.roo/                   <- Generated (Roo Code adapter)
.kiro/                  <- Generated (Kiro adapter)
.amp/                   <- Generated (Amp adapter)
.codex/                 <- Generated (Codex adapter)
.gemini/                <- Generated (Gemini adapter)
.windsurf/              <- Generated (Windsurf adapter)
.amazonq/               <- Generated (Amazon Q adapter)
.worktreeinclude        <- Generated (worktree isolation)
```

## Key Features

- **One command setup** -- `npx hatch3r init` detects your repo, asks about your project context, lets you choose a content profile, and generates everything
- **Selective init** -- choose what you need: Minimal (core only), Standard (recommended), Full, or Custom content profiles with greenfield/brownfield and solo/team filtering
- **Tool-agnostic** -- single source of truth with adapters for 15 platforms
- **Board management** -- full GitHub Projects V2 lifecycle from `todo.md` to merged PRs
- **Sub-agentic delegation** -- implementer agents, dependency-aware orchestration, collision detection
- **Safe merge system** -- managed blocks preserve your customizations across syncs
- **Multi-repo workspaces** -- manage multiple git repos from a shared workspace root with content inheritance and per-repo overrides
- **Extensible** -- per-agent model selection, `.customize.yaml` overrides, composable recipes, event-driven hooks

## Requirements

- **Node.js 22+** (check with `node --version`)
- A git repository (for board features, a GitHub remote)

## Next Steps

- [Quick Start](./quick-start) -- install hatch3r in under a minute
- [What You Get](./what-you-get) -- explore the agents, skills, rules, and commands included
- [Supported Tools](./supported-tools) -- see which coding tools are supported
