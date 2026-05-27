---
id: hatch3r-cli-ripgrep
description: "Fast recursive grep with sane defaults and gitignore awareness. Use when regex content searches across large source trees with gitignore filtering; invoke `rg`. Outputs newline-separated hit records; bound results with `-c` or `--max-count`."
tags: ["cli-tools", "search", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
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
