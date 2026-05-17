---
sidebar_position: 4
title: Supported Tools
---

# Supported Tools

hatch3r generates native configuration for 15 AI coding platforms from a single canonical source.

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
| **Kiro** | Y | B | Y | -- | Y | Y |
| **Goose** | B | B | B | -- | Y | -- |
| **Zed** | B | B | -- | -- | -- | -- |
| **Amazon Q** | B | B | Y | -- | Y | -- |
| **Antigravity** | B | B | Y | -- | Y | -- |

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

Since 1.7.5 MCP is opt-in (default No during `init`). See the [MCP Setup guide](../guides/mcp-setup) for connecting servers and managing secrets.

## CLI Tools

Since 1.7.5, hatch3r ships a 29-tool CLI surface area as the token-efficient alternative to MCP. Each selected tool emits a per-tool skill to the 13 skill-capable adapters (Cursor, Claude Code, Copilot, Cline, OpenCode, Codex, Gemini, Windsurf, Kiro, Aider, Goose, Amazon Q, Antigravity) plus the `hatch3r-cli-overview` decision-tree skill.

### Tier-1 (default-on, 10 tools)

| Tool | Probe | Purpose |
|------|-------|---------|
| ripgrep | `rg` | Fast recursive grep with sane defaults and gitignore awareness |
| fd | `fd` | User-friendly find replacement, gitignore-aware |
| jq | `jq` | JSON processor and query language |
| yq | `yq` | YAML processor (mikefarah Go implementation) |
| gh | `gh` | GitHub CLI — repos, issues, PRs, releases, gists |
| delta | `delta` | Syntax-highlighting git diff pager |
| bat | `bat` | cat clone with syntax highlighting and git integration |
| sd | `sd` | Intuitive sed replacement with literal string patterns |
| ast-grep | `sg` | Structural search and rewrite for code via AST patterns |
| zstd | `zstd` | Fast lossless compression with high ratio |

### Tier-2 (conditional, 11 tools)

Pre-checked when the matching trigger holds against the active project.

| Tool | Trigger | Purpose |
|------|---------|---------|
| Playwright | `web-project` | Browser automation, web testing, and UI interaction |
| duckdb | `data-project` | Embedded analytical database with first-class CSV/Parquet |
| xsv | `data-project` | Fast CSV toolkit (slice, search, join, stats) |
| taplo | `rust-project` / `python-project` | TOML toolkit (format, lint, query) |
| glab | `gitlab-remote` | GitLab CLI — merge requests, issues, pipelines |
| az-devops | `azure-remote` | Azure DevOps work items, repos, pipelines via az CLI extension |
| Docker | `docker-detected` | Container runtime and CLI |
| llm | `ci-llm-project` | simonw/llm — invoke LLMs from the command line |
| fzf | `interactive-tty` | Interactive fuzzy finder for TTY pickers |
| lazygit | `interactive-tty` | Terminal UI for git with keyboard-driven workflows |
| difftastic | `interactive-tty` | Structural diff that understands syntax |

### Tier-3 (opt-in advanced, 8 tools)

Never pre-checked — opt in informed.

| Tool | Probe | Purpose |
|------|-------|---------|
| RTK | `rtk` | CLI output-compression proxy (⚠ pipe-output corruption — see skill) |
| Stagehand | `stagehand` | Browserbase Stagehand — AI-driven browser automation |
| aichat | `aichat` | Multi-provider LLM chat CLI with RAG and session memory |
| mods | `mods` | Charm mods — Unix-friendly LLM pipeline tool |
| Comby | `comby` | Structural search and replace across languages |
| miller | `mlr` | awk/sed/cut/join for CSV/TSV/JSON/Parquet streams |
| csvkit | `csvlook` | Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat) |
| Podman | `podman` | Daemonless container engine, rootless by default |

See [CLI Tools](./cli-tools) for the decision tree, install commands per OS, and the trade-off discussion vs MCP.
