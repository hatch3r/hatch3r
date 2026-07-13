---
sidebar_position: 6
title: CLI Tools
---

# CLI Tools

Since 1.7.5, hatch3r ships a first-class CLI-tools surface area as the token-efficient default for agentic coding. MCP is demoted to opt-in.

## Why the pivot

External research and runtime measurement converged on the same conclusion: piping output through CLI binaries is consistently more token-efficient than tool-calling an MCP server for the same operation. Three primary signals drove the pivot:

- **Anthropic engineering — Code execution with MCP (Nov 4 2025)**: code that orchestrates CLI binaries beats one-shot MCP tool calls when the operation can be expressed as a pipeline.
- **GitHub Blog — Improving token efficiency in agentic workflows (May 7 2026)**: agent runs that prefer CLI tooling over MCP shave 30-60% off token consumption on file-walk / search / format / diff workloads.
- **Cloudflare — Code Mode (Feb 20 2026)** + **ThoughtWorks Tech Radar Vol 34 (Apr 2026)**: industry consensus is pushing agents toward subprocess-tool composition over network-tool federation.

hatch3r still supports MCP — the pivot is about defaults, not deprecation. Since 2.0.0 interactive `npx hatch3r init` does not prompt for MCP at all (the fifth prompt is the CLI-tools picker); opt in with `npx hatch3r init --mcp` or `npx hatch3r mcp setup` on demand.

## The 39-tool catalog

Three tiers. Tier-1 is default-on for every project. Tier-2 is pre-checked per detected project signals. Tier-3 is opt-in advanced.

### Tier 1 — default-on (11 tools)

| Tool | Probe | Description |
|------|-------|-------------|
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

### Tier 2 — conditional (13 tools)

Pre-checked when the matching trigger holds.

| Tool | Probe | Trigger | Description |
|------|-------|---------|-------------|
| Playwright | `playwright` | `web-project` | Browser automation, web testing, and UI interaction |
| duckdb | `duckdb` | `data-project` | Embedded analytical database with first-class CSV/Parquet |
| qsv | `qsv` | `data-project` | Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor |
| taplo | `taplo` | `rust-project` / `python-project` | TOML toolkit (format, lint, query) |
| glab | `glab` | `gitlab-remote` | GitLab CLI — merge requests, issues, pipelines |
| az-devops | `az` | `azure-remote` | Azure DevOps work items, repos, pipelines via az CLI extension |
| Docker | `docker` | `docker-detected` | Container runtime and CLI |
| llm | `llm` | `ci-llm-project` | simonw/llm — invoke LLMs from the command line |
| fzf | `fzf` | `interactive-tty` | Interactive fuzzy finder for TTY pickers |
| lazygit | `lazygit` | `interactive-tty` | Terminal UI for git with keyboard-driven workflows |
| difftastic | `difft` | `interactive-tty` | Structural diff that understands syntax |
| HTTPie | `http` | `web-project` | Human-friendly HTTP/S client with intuitive UI, JSON output, syntax highlighting, and session management |
| xh | `xh` | `web-project` | Fast Rust HTTP/S client with HTTPie-compatible syntax — HTTP/2 + HTTP/3, single-binary install |

### Tier 3 — opt-in advanced (15 tools)

Never pre-checked. Opt in informed.

| Tool | Probe | Description |
|------|-------|-------------|
| RTK | `rtk` | CLI output-compression proxy — ⚠ see pipe-output corruption caveat in the `hatch3r-cli-toolbox` skill (rtk section) |
| Stagehand | `stagehand` | Browserbase Stagehand — AI-driven browser automation |
| aichat | `aichat` | Multi-provider LLM chat CLI with RAG and session memory |
| mods | `mods` | Charm mods — Unix-friendly LLM pipeline tool (upstream archived 2026-03-09; superseded by crush) |
| Comby | `comby` | Structural search and replace across languages with declarative patterns |
| miller | `mlr` | awk/sed/cut/join for CSV/TSV/JSON/Parquet streams |
| csvkit | `csvlook` | Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat) |
| Podman | `podman` | Daemonless container engine, rootless by default (Docker alternative) |
| dasel | `dasel` | Cross-format selector — JSON / YAML / TOML / XML / CSV under one path-query DSL |
| container-use | `container-use` | Dagger sandbox runtime for agentic coding environments (pre-1.0; see caveat) |
| Crush | `crush` | Charm Crush — terminal agentic coding assistant (multi-model, MCP + LSP aware); successor to the archived mods |
| jaq | `jaq` | Memory-safe Rust jq clone — jq-compatible filters with faster startup; security-audited |
| Tombi | `tombi` | TOML formatter, linter, and language server — maintained alternative to taplo |
| Hurl | `hurl` | Declarative HTTP testing — runs plain-text .hurl request files with captures and asserts in CI |
| tea | `tea` | Gitea official CLI — issues, pull requests, releases on Gitea / Forgejo / Codeberg |

## Install commands per OS

The installer prints copy-paste commands grouped by package manager. It never executes on your behalf. Examples for the tier-1 default-on tools:

| Tool | macOS | Linux | Windows |
|------|-------|-------|---------|
| ripgrep | `brew install ripgrep` | `sudo apt install ripgrep` | `scoop install ripgrep` |
| fd | `brew install fd` | `sudo apt install fd-find` | `scoop install fd` |
| jq | `brew install jq` | `sudo apt install jq` | `scoop install jq` |
| yq | `brew install yq` | `sudo snap install yq` | `scoop install yq` |
| gh | `brew install gh` | `sudo apt install gh` | `winget install GitHub.cli` |
| delta | `brew install git-delta` | `sudo apt install git-delta` | `scoop install delta` |
| bat | `brew install bat` | `sudo apt install bat` | `winget install sharkdp.bat` |
| sd | `brew install sd` | `cargo install sd` | `scoop install sd` |
| ast-grep | `brew install ast-grep` | `cargo install ast-grep` | `scoop install ast-grep` |
| zstd | `brew install zstd` | `sudo apt install zstd` | `winget install Facebook.Zstandard` |

Run `npx hatch3r cli-tools install` to print install commands for everything currently selected but not detected on `PATH`.

## Decision tree — which tool for which job?

The `hatch3r-cli-toolbox` skill that ships in every project includes the full decision tree across 24 specialist tools (plus the five always-on standalone skills: `hatch3r-cli-ripgrep`, `hatch3r-cli-jq`, `hatch3r-cli-gh`, `hatch3r-cli-fd`, `hatch3r-cli-fzf`). Summary:

- **Text search** → `rg` (fast literal/regex grep). For structural patterns (AST-aware) use `ast-grep` instead. For cross-language declarative rewrites, escalate to `comby`.
- **Find files** → `fd` (sane defaults, gitignore-aware).
- **JSON queries** → `jq`. For tabular CSV/TSV pipelines, prefer `qsv` or `miller`.
- **YAML / TOML** → `yq` for YAML, `taplo` for TOML.
- **View a file** → `bat` (syntax-highlighted cat). For diff display use `delta`.
- **Edit-in-place** → `sd` for literal-string substitution. For structural rewrites use `ast-grep` or `comby`.
- **GitHub / GitLab / Azure DevOps / Gitea APIs** → `gh` / `glab` / `az` (with the `azure-devops` extension) / `tea` (also Forgejo and Codeberg).
- **Compression / archive** → `zstd`.
- **Browser automation** → `playwright` (deterministic) or `stagehand` (AI-driven).
- **Data analytics on CSV/Parquet** → `duckdb`.
- **LLM in a pipeline** → `llm` (simple), `crush run` (Unix-friendly streaming — replaces the archived `mods`), `aichat` (RAG + session memory).
- **Containers** → `docker` (default) or `podman` (rootless / daemonless).

The full toolbox skill (`skills/hatch3r-cli-toolbox/SKILL.md`) ships into every project and surfaces this decision tree directly to your agent at runtime.

## Choosing between CLI tools and MCP

| Dimension | CLI tools | MCP servers |
|-----------|-----------|-------------|
| Token cost per call | Low — output goes back as text via subprocess stdout | Higher — each tool description + each call carries protocol overhead |
| Latency | Local subprocess (ms) | Stdio / HTTP roundtrip (+startup if not warm) |
| Composability | Native shell pipelines (pipe, redirect, substitution) | One operation per tool call; chaining requires repeated tool-calling |
| Discoverability | `command -v` probe + skill recipes | Tool list announced by server at connect time |
| Provenance | Per-tool install command from registry (vendor-verified) | Server package + version pin |
| Secret handling | Env vars set in shell (`.env.mcp` source pattern reusable) | Server config injects env vars per call |
| Best for | File walks, grep, JSON/YAML/CSV processing, GitHub/GitLab API surfaces, diff/format/lint, container ops, structural rewrites | Authenticated remote services without a stable CLI (Linear, Sentry, Context7), tool surfaces tied to a vendor protocol |

The pivot makes CLI tools the default, not the only option. `npx hatch3r mcp setup` reopens the MCP picker; both surfaces coexist.

## Manage CLI tools

```bash
npx hatch3r cli-tools           # open picker (default action)
npx hatch3r cli-tools list      # selection + install status
npx hatch3r cli-tools install   # print install commands for missing tools
npx hatch3r cli-tools detect    # read-only detection report
```

Selection is recorded in `hatch.json` under `cliTools.selected` and survives `npx hatch3r clean → npx hatch3r init` via `PreservedManifestFields`. The consolidated `hatch3r-cli-toolbox` skill plus the five standalone per-tool skills are emitted to the 3 skill-capable adapters during `sync`.

## Upgrading from 1.7.1 or earlier

The CLI tooling pivot lands in 1.7.5. Two upgrade considerations:

- **`--yes` non-interactive MCP default flipped**: `npx hatch3r init --yes` no longer auto-configures MCP. CI scripts must pass `--mcp` to opt back in.
- **Opt-in flow on existing projects**: Run `npx hatch3r cli-tools` to open the picker. Tier-1 plus matching tier-2 are pre-checked; detection runs against `PATH` and the installer offers per-OS commands.

See the [Workflow guide](../guides/workflow) for the full lifecycle context.
