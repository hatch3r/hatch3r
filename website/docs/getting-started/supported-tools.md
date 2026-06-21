---
sidebar_position: 5
title: Supported Tools
---

# Supported Tools

hatch3r generates native configuration for 3 AI coding platforms from a single bundled canonical source.

:::info v1.9.0 scope cut
As of 1.9.0 hatch3r supports only Claude Code, Cursor, and GitHub Copilot. Twelve adapters (aider, amazonq, amp, antigravity, cline, codex, gemini, goose, kiro, opencode, windsurf, zed) were removed in a hard cut. See the [CHANGELOG](https://github.com/hatch3r-dev/hatch3r/blob/main/CHANGELOG.md) for the full breaking-change list and migration notes.
:::

## Platform Overview

| Tool | Rules | Agents | Skills | Commands | MCP | Hooks |
|------|:-----:|:------:|:------:|:--------:|:---:|:-----:|
| **Claude Code** | Y | Y | Y | Y | Y | Y |
| **Cursor** | Y | Y | Y | Y | Y | Y |
| **GitHub Copilot** | Y | Y | Y | Y | Y | -- |

**Legend:** **Y** = adapter emits files, **B** = bridge (content folded into instruction file), **--** = no platform support

## Output Paths

Each adapter generates files in the format its platform expects:

### Claude Code

| Capability | Output Path |
|------------|-------------|
| Rules | `.claude/rules/hatch3r-{id}.md` |
| Agents | `.claude/agents/hatch3r-{id}.md` |
| Skills | `.claude/skills/hatch3r-{id}/SKILL.md` |
| Bridge | `CLAUDE.md` |
| MCP | `.mcp.json` |

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

For all platforms, see the full [Adapter Capability Matrix](../reference/adapter-capability-matrix).

## MCP Configuration

MCP server config location varies by tool:

| Tool | Config path |
|------|-------------|
| Cursor | `.cursor/mcp.json` |
| Cursor plugin | `mcp.json` (project root) |
| Claude Code | `.mcp.json` |
| Copilot / VS Code | `.vscode/mcp.json` |

Since 1.7.5 MCP is opt-in (default No during `init`). See the [MCP Setup guide](../guides/mcp-setup) for connecting servers and managing secrets.

## CLI Tools

Since 1.7.5, hatch3r ships a 29-tool CLI surface area as the token-efficient alternative to MCP. In v1.9.0 the per-tool skills were consolidated: five high-frequency tools (`ripgrep`, `jq`, `gh`, `fd`, `fzf`) retain standalone skill files, and the remaining 24 are sections of the consolidated `hatch3r-cli-toolbox` reference skill. Canonical content is emitted to all 3 supported adapters (Claude Code, Cursor, Copilot).

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
| qsv | `data-project` | Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor |
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

## Switching between tools

You can mix tools (e.g. Cursor + Claude Code on the same repo) or migrate from one to another. The path is deterministic and adapter outputs survive a swap:

| Goal | Command | What it does |
|------|---------|--------------|
| Add a tool (e.g. add Claude Code to a Cursor repo) | `npx hatch3r config` | Pick the new tool from the multi-select. The next `sync` materializes its outputs (`.claude/`, `CLAUDE.md`, `.mcp.json`); existing tools' outputs are untouched. |
| Remove a tool (e.g. drop Copilot) | `npx hatch3r config` | Deselect the tool. hatch3r previews the file list it will archive — confirm to move the outputs to `.hatch3r-archive/<tool>/<timestamp>/` (an inspection copy). The same run captures a `config-<timestamp>` rollback snapshot. Manifest is updated; other tools' outputs are untouched. |
| Replace tool A with tool B in one step | `npx hatch3r config` | Deselect A, select B in the same picker. The archive runs first (preview + confirm), then `sync` generates B's outputs. |
| Recover a removed tool | `npx hatch3r rollback --session=config-<timestamp>` (id printed in the config summary) | `rollback` is the supported restore. `.hatch3r-archive/<tool>/<timestamp>/` is an inspection copy only — it is gitignored and `hatch3r clean` deletes it, so do not rely on it as the restore source. To inspect manually, copy from `.hatch3r-archive/<tool>/<timestamp>/` back to the tool's output root, then re-enable the tool in `config`. |
| Inspect what a tool wrote | `cat .hatch3r/hatch.json` → `managedFilesByAdapter[<tool>]` | The manifest tracks every path each adapter emitted, so you can audit the footprint before changing tool selection. |

MCP credentials in `.env.mcp` survive tool changes — secrets are tool-agnostic. After a tool switch, restart the new tool's editor process so it picks up the freshly generated config.
