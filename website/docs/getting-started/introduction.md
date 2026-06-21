---
sidebar_position: 1
title: Introduction
slug: introduction
---

# hatch3r

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI and Cursor plugin that installs a tool-agnostic agentic coding setup into any repository — 29 agents, 53 skills, 65 rules, 30 commands, and 7 hooks generated from one canonical source. One command gives you agents, skills, rules, commands, and MCP integrations -- optimized for your coding tool of choice.

## What is hatch3r?

hatch3r maintains a **single canonical source** of agent configuration (bundled inside the npm package) and generates **native configuration** for 3 AI coding platforms (Claude Code, Cursor, GitHub Copilot). You define your agent setup once and hatch3r adapts it to whatever supported tool you use.

```
<your repo>/
  .hatch3r/                       <- Sole hatch3r footprint in your repo
    ├── hatch.json                # Manifest (schemaVersion 3)
    ├── overrides/                # User-authored canonical overrides (escape hatch)
    ├── learnings/                # /learn captures
    ├── handoffs/                 # Cross-session handoff bundles
    └── mcp/mcp.json              # Resolved MCP server config

  .cursor/                        <- Generated (Cursor adapter)
  .claude/                        <- Generated (Claude Code adapter)
  CLAUDE.md                       <- Generated (Claude Code bridge)
  .github/copilot-instructions.md <- Generated (Copilot adapter, plus .github/instructions, .github/prompts, .github/agents)
  .worktreeinclude                <- Generated (worktree isolation)
```

Canonical content (agents, skills, rules, commands, hooks) lives inside the bundled npm package — adapters read from there directly, so end-user repos no longer contain a `.agents/` mirror. (Removed in 1.9.0; see [CHANGELOG](https://github.com/hatch3r-dev/hatch3r/blob/main/CHANGELOG.md).)

## Key Features

- **One command setup** -- `npx hatch3r init` detects your repo, asks about your project context, lets you choose a content profile, and generates everything
- **Selective init** -- choose what you need: Minimal (core only), Standard (recommended), Full, or Custom content profiles with greenfield/brownfield and solo/team filtering
- **Tool-agnostic** -- single source of truth with adapters for 3 platforms (Claude Code, Cursor, GitHub Copilot)
- **Two-axis pillar framework (2.0.0)** -- 8 governance pillars (P1-P8) plus 9 content-quality pillars (CQ1-CQ9), each owned by a specialist agent with measurable thresholds. See [Quality-Vector Specialists](../guides/quality-vector-specialists).
- **Board management** -- full GitHub Projects V2 lifecycle from `todo.md` to merged PRs
- **Sub-agentic delegation** -- implementer agents, dependency-aware orchestration, collision detection
- **Safe merge system** -- managed blocks preserve your customizations across syncs
- **Multi-repo workspaces** -- manage multiple git repos from a shared workspace root with content inheritance and per-repo overrides
- **Extensible** -- per-agent model selection, `.customize.yaml` overrides, composable recipes, event-driven hooks

## Requirements

- **Node.js 22+** (check with `node --version`)
- A git repository (for board features, a GitHub remote)

## Next Steps

- [Core Concepts](./core-concepts) -- the six load-bearing terms, in one screen, before you install
- [Quick Start](./quick-start) -- install hatch3r in under a minute
- [What You Get](./what-you-get) -- explore the agents, skills, rules, and commands included
- [Supported Tools](./supported-tools) -- see which coding tools are supported
