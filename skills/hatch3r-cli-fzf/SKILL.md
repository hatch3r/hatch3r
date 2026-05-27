---
id: hatch3r-cli-fzf
description: "Interactive fuzzy finder for TTY pickers. Use when ad-hoc interactive picker over piped stdin streams from another command; invoke `fzf`. Requires a TTY; degrade gracefully to non-interactive batch in CI."
tags: ["cli-tools", "interactive", "maintenance"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: fzf
  bin: fzf
  tier: 2
  category: interactive
  homepage: https://github.com/junegunn/fzf
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# fzf

Interactive fuzzy finder for TTY pickers

## When to Use

Reach for `fzf` when the task is in the **interactive** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
fzf --filter 'auth' < paths.txt
```
Headless mode — ranks lines by fuzzy match score and prints them in order; no TTY needed. This is the agent-safe entrypoint.

```bash
git branch --format='%(refname:short)' | fzf --filter main
```
Score branch names against `main`; pipe to `head -1` to pick the best match deterministically.

```bash
rg -l 'TODO' . | fzf --filter 'src/cli'
```
Re-rank a `ripgrep` file list by proximity to a fuzzy hint; combine with `head` for a deterministic top pick.

```bash
fzf --filter 'auth' --print0 < paths.txt | xargs -0 wc -l
```
Stream NUL-delimited matches to a downstream pipeline — safe across filenames with spaces.

```bash
fzf < paths.txt
```
Interactive picker — only useful in a human TTY; do not call this form from an autonomous agent.

## Wrong Choice When

- Running in a non-TTY context (CI, agent loop) — interactive `fzf` will hang on stdin; always use `--filter` headless mode.
- The ranking needs semantic understanding (synonyms, embeddings) — `fzf` is character-level fuzzy; reach for an embedding-based tool.
- A simple `grep -F` or `rg --files | head` would already return the right answer — no need to layer scoring on top.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `skim` (`sk`) | Need a Rust binary with similar fuzzy scoring and the same `--filter` headless mode. |
| `rg --files \| head` | Already filtered; want stable lexicographic order rather than fuzzy ranking. |
| `grep -F` | Exact substring match; no scoring needed. |

## Detection / Install

Verify with:
```bash
command -v fzf
```

Install (macOS — default for this machine):

```bash
# brew
brew install fzf
```

Install (Linux):

```bash
# apt
sudo apt install fzf
```

Install (Windows):

```bash
# scoop
scoop install fzf
```

Homepage: https://github.com/junegunn/fzf
