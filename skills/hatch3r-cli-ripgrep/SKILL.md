---
id: hatch3r-cli-ripgrep
name: hatch3r-cli-ripgrep
type: skill
description: "Fast recursive grep with sane defaults and gitignore awareness. Use when regex content searches across large source trees with gitignore filtering; invoke `rg`. Outputs newline-separated hit records; bound results with `-c` or `--max-count`."
tags: ["cli-tools", "search", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
# D9-H-6 (D9, P1): pre-approve the wrapped shell binary on the GitHub Copilot
# Skills surface so the runtime skips per-invocation confirmation for `rg`.
# Rendered as an `allowed-tools:` frontmatter line on `.github/skills/.../SKILL.md`
# by the Copilot adapter; other adapters ignore the field.
allowed_tools: ["rg"]
cli_tool:
  id: ripgrep
  bin: rg
  tier: 1
  category: search
  homepage: https://github.com/BurntSushi/ripgrep
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# ripgrep

Fast recursive grep with sane defaults and gitignore awareness

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking `rg`, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the search root is ambiguous or the request implies piercing ignore rules (`--no-ignore`, `--hidden`) over a large tree, confirm the intended path before running — an unscoped scan over a monorepo can return tens of thousands of hits.
- **Irreversibility:** `rg` is read-only — it never mutates files, so no destructive confirmation is needed. The only risk is unbounded output flooding context; cap with `--max-count` / `-l` / `-c` when match density is unknown.
- **Ambiguity:** when the request maps to two or more pattern interpretations (literal `-F` vs regex, case-sensitive vs `-i`), ask which one.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a single-tool usage reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `.claude/rules/fan-out-discipline.md` (P8 B2).

## When to Use

Reach for `rg` when the task is in the **search** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
rg --json -tts 'createServer\(' src/
```
Structured JSON output scoped to TypeScript — parse hits with `jq` instead of re-reading files.

```bash
rg -c 'TODO' --type ts
```
Per-file match counts for `.ts` files; cheap stand-in for issue-debt triage.

```bash
rg -B 2 -A 4 'BREAKING' --max-count 50 CHANGELOG.md
```
Context windows around BREAKING entries, capped at 50 hits to bound output size.

```bash
rg --hidden --no-ignore 'API_KEY' .
```
Pierces both dotfiles and `.gitignore` rules — use when scanning for accidentally-committed secrets.

```bash
rg --files-with-matches 'deprecated' src/ | xargs -I{} rg -n 'deprecated' {}
```
Two-phase: file list first, then ranged scan — keeps stdout small when match density is uneven.

## Wrong Choice When

- Don't use `rg` to match by code structure (function calls, type signatures, JSX shape); literal regex misses renames and whitespace variants. Reach for `ast-grep` (see the ast-grep section in `hatch3r-cli-toolbox`).
- Don't run `rg` against binary blobs (`.zst`, `.png`, lockfile snapshots); it skips them silently by default but explicit `-a` mode wastes CPU. Reach for category-specific tools (`zstd -d` then `rg`, or `xxd | rg` for hex).
- Don't use `rg` to search a specific git revision or stash — it only sees the working tree. Reach for `git grep <rev>`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `ast-grep` (toolbox section) | Structural code patterns: matchers like `console.log($MSG)` that survive whitespace and identifier renames. |
| `git grep` | Search at a specific revision, tag, or stash — `rg` only reads the working tree. |
| `fd` (`hatch3r-cli-fd`) piped into `rg` | Filename pre-filter when scoping by extension/age is faster than `rg --type`. |
| `grep -RIn` | POSIX-only environment where ripgrep is not on PATH and install is blocked. |

## Detection / Install

Verify with:
```bash
command -v rg
```

Install (macOS — default for this machine):

```bash
# brew
brew install ripgrep
```

Install (Linux):

```bash
# apt
sudo apt install ripgrep
```

Install (Windows):

```bash
# scoop
scoop install ripgrep
```

Homepage: https://github.com/BurntSushi/ripgrep
