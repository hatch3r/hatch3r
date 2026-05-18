---
id: hatch3r-cli-comby
description: "Structural search and replace across languages with declarative patterns. Use when declarative pattern match-and-rewrite spanning mixed-language repositories; invoke `comby`. Language-agnostic: a single `{:[hole]}` template works against any of 30+ grammars."
tags: ["cli-tools", "search", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: comby
  bin: comby
  tier: 3
  category: search
  homepage: https://comby.dev/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# comby

Structural search and replace across languages with declarative patterns

## When to Use

Reach for `comby` when the task is in the **search** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
comby 'console.log(:[arg])' 'logger.info(:[arg])' -i src/
```
Rewrite every `console.log(...)` to `logger.info(...)` in `src/`, preserving the captured argument.

```bash
comby 'if :[cond] { return :[ret] }' 'if (:[cond]) return :[ret];' -i .
```
Reshape brace-style returns into single-line returns — works across Go, Rust, TypeScript, Java.

```bash
comby -config patterns.toml -d src/
```
Run a batch of templated rewrites from a TOML config (each `[[match]]` entry holds a match/rewrite pair).

```bash
comby 'TODO(:[author]): :[msg]' 'FIXME(:[author]): :[msg]' -i -extensions js,ts,go
```
Restrict the rewrite to specific file extensions.

```bash
comby 'foo(:[args])' 'bar(:[args])' -stats -d src/
```
Preview-only run with summary stats — no files written. Useful before a destructive rewrite.

## Wrong Choice When

- **Security/SAST policy enforcement:** semgrep has a vetted rule registry, dataflow analysis, and CI-grade reporting — comby's surface-level templates miss taint flow.
- **Pure-text find/replace (no balanced delimiters):** `hatch3r-cli-ripgrep` + `hatch3r-cli-sd` (both tier 1) are faster and have no template parser overhead.
- **Language-precise refactors that need type info:** `hatch3r-cli-ast-grep` (tier 1) operates on the parse tree; comby is brace-aware but not type-aware.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-ast-grep` (tier 1) | Tree-sitter-backed, language-precise rewrites |
| `hatch3r-cli-sd` (tier 1) | Plain literal-text replacement, no template syntax |
| semgrep | SAST rule registry, taint analysis, CI integration |
| `hatch3r-cli-ripgrep` (tier 1) | Read-only inventory before deciding on a rewrite tool |

## Detection / Install

Verify with:
```bash
command -v comby
```

Install (mac):

```bash
# brew
brew install comby
```

Homepage: https://comby.dev/
