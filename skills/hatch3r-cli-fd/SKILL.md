---
id: hatch3r-cli-fd
name: hatch3r-cli-fd
type: skill
description: "User-friendly find replacement, gitignore-aware. Use when locating filenames or directories by glob with parallel walking; invoke `fd`. Outputs newline-separated hit records; bound results with `-c` or `--max-count`."
tags: ["cli-tools", "search", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
# D9-H-6 (D9, P1): pre-approve the wrapped shell binary on the GitHub Copilot
# Skills surface so the runtime skips per-invocation confirmation for `fd`.
# Rendered as an `allowed-tools:` frontmatter line on `.github/skills/.../SKILL.md`
# by the Copilot adapter; other adapters ignore the field.
allowed_tools: ["fd"]
cli_tool:
  id: fd
  bin: fd
  tier: 1
  category: search
  homepage: https://github.com/sharkdp/fd
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# fd

User-friendly find replacement, gitignore-aware

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking `fd`, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the search root or pattern matches more files than intended (a bare glob over the repo root, `-H` including dotfiles), confirm the target path before running.
- **Irreversibility:** `fd` is read-only on its own, but `fd … -x` / `-X` runs an arbitrary command per match. `fd <pat> -x rm` or any mutating `--exec` is destructive and fan-out-wide — confirm the command and the match set before running, and prefer printing the list first.
- **Ambiguity:** when the request maps to two or more matchers with materially different result sets (regex vs `-g` glob, `-e ext` vs path regex), ask which one.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a single-tool usage reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `rules/hatch3r-fan-out-discipline.md` (P8 B2).

## When to Use

Reach for `fd` when the task is in the **search** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
fd '\.test\.ts$' src/
```
Regex match against the path tail — locates every test file under `src/` without traversing `node_modules` or `.git` (gitignore-aware by default).

```bash
fd -e ts -e tsx --exec wc -l
```
Extension filter plus parallel `--exec` — one process per match, returns line counts for sizing audits.

```bash
fd -H -E .git -E node_modules 'config'
```
Includes hidden files (`-H`) and explicitly excludes vendor trees — useful when scanning dotfiles for stale config.

```bash
fd --changed-within 7d -e md
```
Time-windowed query for recent edits — pairs with `gh pr list` to spot undocumented changes.

```bash
fd 'SKILL\.md$' skills/ -x rg -l 'placeholder'
```
Pipeline: locate every `SKILL.md`, then `rg`-search each for a marker string in one parallel batch.

## Wrong Choice When

- Don't reach for `fd` when the recursive predicate needs POSIX `find` features like `-mtime +N -delete`, `-path` with mixed Boolean operators, or NFS-mount handling. Reach for system `find`.
- Don't use `fd` as a content searcher — it matches paths, not file bodies. Reach for `ripgrep` (`hatch3r-cli-ripgrep`), optionally piped after `fd` for filename pre-filtering.
- Don't use `fd` against a system-wide indexed search ("which package owns this file?"); it walks the live filesystem each call. Reach for `locate` / `mlocate`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `find` (POSIX) | Mixed predicates with `-and`/`-or`, `-mtime`, `-prune`, or actions like `-delete` and `-execdir`. |
| `locate` | Pre-indexed lookups across the entire filesystem (no live walk). |
| `ripgrep` (`hatch3r-cli-ripgrep`) | When you want content matches, not path matches — `fd ... -x rg` if both. |
| `git ls-files` | Restrict to tracked files only; ignores untracked even if not in `.gitignore`. |

## Detection / Install

Verify with:
```bash
command -v fd
```

Install (macOS — default for this machine):

```bash
# brew
brew install fd
```

Install (Linux):

```bash
# apt
sudo apt install fd-find
```

Install (Windows):

```bash
# scoop
scoop install fd
```

Homepage: https://github.com/sharkdp/fd
