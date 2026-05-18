---
id: hatch3r-cli-delta
description: "Syntax-highlighting git diff pager. Use when viewing unified git diffs with side-by-side syntax colourised hunks; invoke `delta`. Replaces the legacy `less`-based diff renderer with terminal-native ANSI colour blocks."
tags: ["cli-tools", "git", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: delta
  bin: delta
  tier: 1
  category: git
  homepage: https://github.com/dandavison/delta
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# delta

Syntax-highlighting git diff pager

## When to Use

Reach for `delta` when the task is in the **git** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
git config --global core.pager delta
git config --global interactive.diffFilter 'delta --color-only'
```
Enables delta as the diff pager for `git diff`, `git log -p`, and interactive add/stash.

```ini
# ~/.gitconfig
[delta]
    side-by-side = true
    line-numbers = true
    syntax-theme = Monokai Extended
    navigate = true
```
Side-by-side panes with line numbers and `n`/`N` hunk navigation — the high-signal review layout.

```bash
git diff HEAD~5..HEAD -- 'src/**/*.ts' | delta --features=side-by-side
```
Pipe a constrained diff range into delta directly when the pager is not globally configured.

```bash
delta --list-syntax-themes | rg -i 'mono\|gruv\|night'
```
Inventory available syntax themes — use the output to set `syntax-theme` in `~/.gitconfig`.

## Wrong Choice When

- Don't pipe `delta` output into another script — it injects ANSI escape sequences that break downstream parsing. Reach for plain `diff -u` or `git diff --no-color` for machine consumers.
- Don't use `delta` to review semantic refactors (renames across files, signature reshapes); line-by-line color highlight misses tree-level moves. Reach for `difftastic` (`hatch3r-cli-difftastic`).
- Don't expect `delta` to fix the diff itself — it is a pager, not a merge tool. Reach for `git mergetool` or your editor's diff view.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `difftastic` (`hatch3r-cli-difftastic`) | Tree-aware diff that understands renames and reshaped expressions. |
| `diff -u` | Scripted consumers needing plain unified text without ANSI. |
| GitHub web UI / `gh pr diff 123` | Review on the forge with inline comments. |
| `git diff --word-diff=color` | Quick word-granularity diff without a separate binary. |

## Detection / Install

Verify with:
```bash
command -v delta
```

Install (mac):

```bash
# brew
brew install git-delta
```

Homepage: https://github.com/dandavison/delta
