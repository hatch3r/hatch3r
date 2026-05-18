---
id: hatch3r-cli-bat
description: "cat clone with syntax highlighting and git integration. Use when scrolling one source file with syntax colours, line numbers, and header decorations; invoke `bat`. Prints to a terminal pager (`less`-compatible) for quick visual inspection."
tags: ["cli-tools", "view", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: bat
  bin: bat
  tier: 1
  category: view
  homepage: https://github.com/sharkdp/bat
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# bat

cat clone with syntax highlighting and git integration

## When to Use

Reach for `bat` when the task is in the **view** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
bat src/cli/commands/init.ts
```
Default view — syntax-highlighted output with line numbers and git modification markers.

```bash
bat --plain --line-range 50:100 src/adapters/cursor.ts
```
`--plain` strips decorations; range syntax mimics `sed -n '50,100p'` without invoking sed.

```bash
bat --paging=never -A whitespace.txt
```
`-A` reveals tabs, trailing spaces, and CRLF — handy when debugging YAML indentation failures.

```bash
git diff | bat --language=diff
```
Force a language when stdin lacks a filename hint — `--language=diff` produces a unified-diff colorscheme.

```bash
fd '\.md$' governance/ -x bat --style=plain
```
Pipeline: list files with `fd`, render each through `bat` with no header — bulk preview of canonical content.

## Wrong Choice When

- Don't use `bat` against binary files (`.zst`, executables); it prints the bytes verbatim and pollutes the terminal. Reach for `xxd | bat --language=hex` or `file <path>` first.
- Don't pipe `bat` into machine consumers in a strict POSIX environment — ANSI escapes and `--paging=auto` defaults break grep/awk chains. Reach for plain `cat`.
- Don't reach for `bat` to compare two files; it views one at a time. Reach for `delta` (`hatch3r-cli-delta`) or `diff -u | bat --language=diff`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `cat` (POSIX) | Strict scripted pipelines, embedded systems, environments where escape sequences break consumers. |
| `less` | Paginate raw text without coloring; large files where rebuilding the syntax tree is wasted work. |
| `delta` (`hatch3r-cli-delta`) | Diff view rather than single-file render. |
| `xxd \| bat --language=hex` | Inspect binary payloads with column-aligned hex + ASCII. |

## Detection / Install

Verify with:
```bash
command -v bat
```

Install (mac):

```bash
# brew
brew install bat
```

Homepage: https://github.com/sharkdp/bat
