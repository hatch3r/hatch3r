---
id: hatch3r-cli-overview
description: "Catalog of all hatch3r-recommended CLI tools — discovery entry with tier tables and decision tree."
tags: ["cli-tools", "reference", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# CLI Tool Catalog

hatch3r recommends a small set of terminal-native CLI tools agents can call instead of MCP servers or wrapped APIs. Each tool listed below has its own skill file with recipes, anti-patterns, and per-OS install instructions. Run `npx hatch3r cli-tools` to (de)select tools, or `npx hatch3r cli-tools detect` for a read-only install report.

## Tier 1 — default-on

| Tool | Skill ID | Use for |
|------|----------|---------|
| `ast-grep` | `hatch3r-cli-ast-grep` | Structural search and rewrite for code via AST patterns |
| `bat` | `hatch3r-cli-bat` | cat clone with syntax highlighting and git integration |
| `delta` | `hatch3r-cli-delta` | Syntax-highlighting git diff pager |
| `fd` | `hatch3r-cli-fd` | User-friendly find replacement, gitignore-aware |
| `gh` | `hatch3r-cli-gh` | GitHub CLI — repos, issues, PRs, releases, gists |
| `jq` | `hatch3r-cli-jq` | JSON processor and query language |
| `ripgrep` | `hatch3r-cli-ripgrep` | Fast recursive grep with sane defaults and gitignore awareness |
| `sd` | `hatch3r-cli-sd` | Intuitive sed replacement with literal string patterns |
| `yq` | `hatch3r-cli-yq` | YAML processor (mikefarah Go implementation) |
| `zstd` | `hatch3r-cli-zstd` | Fast lossless compression with high ratio |

## Tier 2 — conditional (offered on project signal)

| Tool | Skill ID | Use for |
|------|----------|---------|
| `az-devops` | `hatch3r-cli-az-devops` | Azure DevOps work items, repos, pipelines via az CLI extension |
| `difftastic` | `hatch3r-cli-difftastic` | Structural diff that understands syntax |
| `docker` | `hatch3r-cli-docker` | Container runtime and CLI |
| `duckdb` | `hatch3r-cli-duckdb` | Embedded analytical database with first-class CSV/Parquet support |
| `fzf` | `hatch3r-cli-fzf` | Interactive fuzzy finder for TTY pickers |
| `glab` | `hatch3r-cli-glab` | GitLab CLI — merge requests, issues, pipelines |
| `lazygit` | `hatch3r-cli-lazygit` | Terminal UI for git with keyboard-driven workflows |
| `llm` | `hatch3r-cli-llm` | simonw/llm — invoke LLMs from the command line with prompt templates |
| `playwright` | `hatch3r-cli-playwright` | Browser automation, web testing, and UI interaction |
| `taplo` | `hatch3r-cli-taplo` | TOML toolkit (format, lint, query) for pyproject.toml / Cargo.toml |
| `qsv` | `hatch3r-cli-qsv` | Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor |

## Tier 3 — opt-in advanced

| Tool | Skill ID | Use for |
|------|----------|---------|
| `aichat` | `hatch3r-cli-aichat` | Multi-provider LLM chat CLI with RAG and session memory |
| `comby` | `hatch3r-cli-comby` | Structural search and replace across languages with declarative patterns |
| `csvkit` | `hatch3r-cli-csvkit` | csvkit — Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat) |
| `miller` | `hatch3r-cli-miller` | awk/sed/cut/join for CSV/TSV/JSON/Parquet streams |
| `mods` | `hatch3r-cli-mods` | Charm mods — Unix-friendly LLM pipeline tool |
| `podman` | `hatch3r-cli-podman` | Daemonless container engine, rootless by default (Docker alternative) |
| `rtk` | `hatch3r-cli-rtk` | CLI output-compression proxy (see ⚠ caveat) |
| `stagehand` | `hatch3r-cli-stagehand` | Browserbase Stagehand — AI-driven browser automation |

## Decision Tree

Need text search → `rg`. Structural → `ast-grep`. Files → `fd`. JSON → `jq`. YAML → `yq`. Replace → `sd`. Git/forge → `gh` / `glab` / `az-devops`. Browser → `playwright`. View → `bat`. Diff → `delta`. Archive → `zstd`.
