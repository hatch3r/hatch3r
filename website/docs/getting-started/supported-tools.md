---
sidebar_position: 5
title: Supported Tools
---

# Supported Tools

hatch3r generates native configuration and documented bridges for 4 AI coding platforms from a single bundled canonical source.

:::info Current scope
hatch3r supports Claude Code, Cursor, GitHub Copilot, and Codex. The Codex adapter was restored on current project-native contracts; eleven other adapters removed in v1.9.0 remain unsupported. See the [CHANGELOG](https://github.com/hatch3r/hatch3r/blob/main/CHANGELOG.md) for migration notes.
:::

## Platform Overview

| Tool | Rules | Agents | Skills | Commands | MCP | Hooks |
|------|:-----:|:------:|:------:|:--------:|:---:|:-----:|
| **Claude Code** | Y | Y | Y | Y | Y | Y |
| **Cursor** | Y | Y | Y | Y | Y | Y |
| **GitHub Copilot** | Y | Y | Y | Y | Y | -- |
| **Codex** | B | Y | Y | B | Y | Y |

**Legend:** **Y** = native/direct adapter output, **B** = Hatcher bridge on an official instruction or skill surface, **--** = not implemented or unsupported

## Output Paths

Each adapter generates files in the format its platform expects:

### Codex

| Capability | Output Path |
|------------|-------------|
| Skills | `.agents/skills/hatch3r-{id}/SKILL.md` |
| Command bridge | `.agents/skills/hatch3r-command-{id}/SKILL.md` |
| Agents | `.codex/agents/hatch3r-{id}.toml` |
| Rules/instructions bridge | `AGENTS.md` + `.hatch3r/codex-support/` |
| MCP | `.codex/config.toml` |
| Hooks | `.codex/hooks.json` or managed inline config, plus `.codex/hatch3r/hooks/` |

Codex has no repository-defined slash-command, native glob-scoped rule, or native handoff surface, so commands (including `$hatch3r-command-handoff`) and rules are explicit skill/AGENTS.md bridges. `hatch3r-report` is omitted because its Claude transcript/JSONL contract has no Codex equivalent. Project hooks still require the user to trust the repository and approve the hook hash; hatch3r never writes trust state. Sync, update, platform removal, archive, clean, rollback snapshots, and worktrees preserve unrelated files and subtract only Hatcher-owned entries from shared files.

The obsolete `.codex/skills/` layout is never emitted. Move user-owned skills to `.agents/skills/`; Hatcher-managed legacy output may be removed after verifying it is not customized.

Official contracts: [skills](https://learn.chatgpt.com/docs/build-skills), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), and [hooks](https://learn.chatgpt.com/docs/hooks).

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
| Codex | `.codex/config.toml` |

Since 1.7.5 MCP is opt-in (default No during `init`). See the [MCP Setup guide](../guides/mcp-setup) for connecting servers and managing secrets.

## CLI Tools

Since 1.7.5, hatch3r ships a 39-tool CLI surface area as the token-efficient alternative to MCP. Five high-frequency tools (`ripgrep`, `jq`, `gh`, `fd`, `fzf`) retain standalone skill files, and the remaining 34 are sections of the consolidated `hatch3r-cli-toolbox` reference skill. These skills emit for all four adapters; in Codex, invoke one explicitly with `$hatch3r-cli-ripgrep` or `$hatch3r-cli-toolbox` when automatic skill selection is not desired.

### Tier-1 (default-on, 11 tools)

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
| curl | `curl` | HTTP/S transfer tool — POST/GET/PUT, file upload, custom headers, cookies, scripting |

### Tier-2 (conditional, 13 tools)

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
| HTTPie | `web-project` | Human-friendly HTTP/S client with intuitive UI, JSON output, syntax highlighting, and session management |
| xh | `web-project` | Fast Rust HTTP/S client with HTTPie-compatible syntax — HTTP/2 + HTTP/3, single-binary install |

### Tier-3 (opt-in advanced, 15 tools)

Never pre-checked — opt in informed.

| Tool | Probe | Purpose |
|------|-------|---------|
| RTK | `rtk` | CLI output-compression proxy (⚠ pipe-output corruption — see skill) |
| Stagehand | `stagehand` | Browserbase Stagehand — AI-driven browser automation |
| aichat | `aichat` | Multi-provider LLM chat CLI with RAG and session memory |
| mods | `mods` | Charm mods — Unix-friendly LLM pipeline tool (upstream archived — superseded by crush) |
| Comby | `comby` | Structural search and replace across languages |
| miller | `mlr` | awk/sed/cut/join for CSV/TSV/JSON/Parquet streams |
| csvkit | `csvlook` | Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat) |
| Podman | `podman` | Daemonless container engine, rootless by default |
| dasel | `dasel` | Cross-format selector — JSON / YAML / TOML / XML / CSV under one path-query DSL |
| container-use | `container-use` | Dagger sandbox runtime for agentic coding environments (pre-1.0; see caveat) |
| Crush | `crush` | Charm Crush — terminal agentic coding assistant; successor to the archived mods |
| jaq | `jaq` | Memory-safe Rust jq clone — jq-compatible filters, security-audited |
| Tombi | `tombi` | TOML formatter, linter, and language server — maintained alternative to taplo |
| Hurl | `hurl` | Declarative HTTP testing — plain-text .hurl files with captures and asserts in CI |
| tea | `tea` | Gitea official CLI — Gitea / Forgejo / Codeberg forge family |

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
