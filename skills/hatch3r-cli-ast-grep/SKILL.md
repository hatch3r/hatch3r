---
id: hatch3r-cli-ast-grep
description: "Structural search and rewrite for code via AST patterns. Use when Tree-sitter AST pattern rewrites scoped to a single grammar; invoke `sg`. Grammar-aware: queries are written in the same syntax as the language being edited."
tags: ["cli-tools", "search", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: ast-grep
  bin: sg
  tier: 1
  category: search
  homepage: https://ast-grep.github.io/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# ast-grep

Structural search and rewrite for code via AST patterns

## When to Use

Reach for `sg` when the task is in the **search** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
sg --pattern 'console.log($MSG)' --lang ts src/
```
Pattern with a meta-variable (`$MSG`) — matches any `console.log` call regardless of whitespace or argument shape.

```bash
sg run -p 'await $FN()' -r 'await ($FN()).catch(e => log(e))' --update-all src/
```
Structural rewrite: every bare `await $FN()` gains a `.catch` arm; `--update-all` writes in place.

```bash
sg scan --config sgconfig.yml
```
Runs a rule pack from `sgconfig.yml` — repo-pinned lints that survive regex edits.

```bash
sg test --update-snapshots
```
Snapshot-style tests for rules — keeps rule packs honest as the codebase shifts.

```bash
sg --pattern 'function $NAME($$$ARGS) { $$$BODY }' --lang ts --json src/
```
Triple-`$` captures the rest of an argument list or body — JSON output feeds `jq` for downstream filtering.

## Wrong Choice When

- Don't reach for `sg` when the target is plain literal text (a TODO marker, a string in CHANGELOG). Reach for `ripgrep` (`hatch3r-cli-ripgrep`) — orders of magnitude faster on raw matching.
- Don't use `sg` for cross-language SAST policy work (e.g., taint analysis). Reach for `semgrep`, which has rule packs, CI integrations, and a security-audit lineage.
- Don't reach for `sg` on languages it does not parse (Bash, Makefile, INI). The pattern compiler will reject the request — fall back to `ripgrep` + `sd`.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `ripgrep` (`hatch3r-cli-ripgrep`) | Literal regex over text — ast-grep is overkill if you do not need structural matching. |
| `semgrep` | Security/policy rule packs, multi-language SAST, central rule registry. |
| `comby` | Multi-language structural rewrites with template syntax and no per-language plugin. |
| Editor refactor / language server | Authoritative rename or extract-method with full type information. |

## Detection / Install

Verify with:
```bash
command -v sg
```

Install (mac):

```bash
# brew
brew install ast-grep
```

Homepage: https://ast-grep.github.io/
