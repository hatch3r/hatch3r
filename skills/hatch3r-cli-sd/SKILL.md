---
id: hatch3r-cli-sd
description: "Intuitive sed replacement with literal string patterns. Use when literal-string stream substitution with no regex foot-guns; invoke `sd`. Operates byte-by-byte; safe for fixed-string edits where regex would over-match."
tags: ["cli-tools", "edit", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: sd
  bin: sd
  tier: 1
  category: edit
  homepage: https://github.com/chmln/sd
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# sd

Intuitive sed replacement with literal string patterns

## When to Use

Reach for `sd` when the task is in the **edit** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
sd 'foo\(' 'bar(' src/lib/util.ts
```
Single-file substitution — sd defaults to regex, no escaping for forward slashes or `&`.

```bash
sd -p 'oldName' 'newName' src/main.ts
```
`-p` (preview) prints the diff without writing — safer than running sed and re-reading.

```bash
sd '\bAPI_KEY\b' 'GH_TOKEN' .env
```
Word-boundary anchors catch the symbol without rewriting `API_KEY_BACKUP` or similar.

```bash
rg --files-with-matches 'oldName' -tts | xargs sd 'oldName' 'newName'
```
Two-phase rewrite: `rg` finds candidate files, `sd` applies the substitution per file in parallel.

```bash
sd -s 'literal string with $special chars' 'replacement' README.md
```
`-s` switches to literal-string mode — no regex interpretation, useful when the pattern contains `.`, `*`, `(`.

## Wrong Choice When

- Don't use `sd` for multi-step stream transforms (insert, delete, swap lines in one pass). Reach for `sed -e ... -e ...`, awk, or a real script.
- Don't use `sd` to refactor identifiers that need type awareness — it cannot tell `count` (the variable) from `count` (the field name). Reach for `ast-grep` (`hatch3r-cli-ast-grep`).
- Don't reach for `sd` to rewrite extremely large files (>1 GB); it buffers the file in memory. Reach for streaming tools like `sed`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `sed` (POSIX) | Multi-step transforms, ed-style addressing, or any place sd's flag surface is too thin. |
| `ast-grep` (`hatch3r-cli-ast-grep`) | Identifier-aware rewrites that must respect language structure. |
| `perl -pi -e` | Backreferences and lookaround in mature scripts where Perl is already a dependency. |
| Editor's "rename symbol" (LSP) | Authoritative rename across modules with type information. |

## Detection / Install

Verify with:
```bash
command -v sd
```

Install (mac):

```bash
# brew
brew install sd
```

Homepage: https://github.com/chmln/sd
