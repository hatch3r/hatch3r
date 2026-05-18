---
id: hatch3r-cli-difftastic
description: "Structural diff that understands syntax. Use when syntax-aware diffing that reports semantic edits instead of textual lines; invoke `difft`. Skips whitespace and reordering noise by computing edits over parsed syntax trees."
tags: ["cli-tools", "git"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: difftastic
  bin: difft
  tier: 2
  category: git
  homepage: https://difftastic.wilfred.me.uk/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# difftastic

Structural diff that understands syntax

## When to Use

Reach for `difft` when the task is in the **git** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
difft a.ts b.ts
```
Compare two files using a syntax-aware tree diff; rename-of-block does not show as wholesale rewrite.

```bash
git -c diff.external=difft diff HEAD~1 HEAD
```
One-shot syntactic git diff for the last commit without mutating global config.

```bash
git config --global diff.external difft
```
Wire `difft` as the default git external diff (human setup; agents should prefer the `-c` form above for transparency).

```bash
difft --background light a.ts b.ts
```
Render with a light-background palette — pick to match the terminal theme.

```bash
difft --display side-by-side a.py b.py
```
Side-by-side layout for review; fall back to the default inline mode for narrow terminals.

## Wrong Choice When

- A script needs stable, parseable diff output — `diff -u` or `git diff --no-color` produce deterministic POSIX output; `difft` is for human reading.
- You only need a prettier pager for unified diffs — `delta` (Tier 1) renders standard git output with syntax highlighting and is faster.
- The languages involved are unsupported by tree-sitter parsers `difft` ships — fall back to `diff -u`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `delta` | Want syntax-highlighted unified diff for git output. |
| `diff -u` | Script consumes the output; need POSIX stability. |
| `git diff --word-diff` | Care about prose changes; line-noise from refactors is acceptable. |

## Detection / Install

Verify with:
```bash
command -v difft
```

Install (mac):

```bash
# brew
brew install difftastic
```

Homepage: https://difftastic.wilfred.me.uk/
