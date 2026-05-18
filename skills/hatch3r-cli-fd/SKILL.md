---
id: hatch3r-cli-fd
description: "User-friendly find replacement, gitignore-aware. Use when locating filenames or directories by glob with parallel walking; invoke `fd`. Outputs newline-separated hit records; bound results with `-c` or `--max-count`."
tags: ["cli-tools", "search", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
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

Install (mac):

```bash
# brew
brew install fd
```

Homepage: https://github.com/sharkdp/fd
