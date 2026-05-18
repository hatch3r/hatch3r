---
id: hatch3r-cli-jq
description: "JSON processor and query language. Use when shaping JSON streams via jq-syntax filters and select expressions; invoke `jq`. Reads stdin and emits stdout; integrates seamlessly into shell pipelines."
tags: ["cli-tools", "json", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: jq
  bin: jq
  tier: 1
  category: json
  homepage: https://github.com/jqlang/jq
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# jq

JSON processor and query language

## When to Use

Reach for `jq` when the task is in the **json** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
gh pr list --json number,title,isDraft | jq '.[] | select(.isDraft|not) | .number'
```
Pipeline from `gh` JSON into a selector — emits only open non-draft PR numbers.

```bash
jq -r '.[] | .name' inventory.json
```
Raw string output (`-r`) drops the JSON quoting — feeds straight into `xargs` or shell loops.

```bash
jq 'group_by(.category) | map({key: .[0].category, value: length}) | from_entries' findings.json
```
Group-then-count idiom — produces a `{category: count}` object suitable for direct comparison against a baseline.

```bash
jq --slurp 'add | unique_by(.id)' shard-*.json
```
Slurp multiple files into a single array, concatenate, dedupe by `id` — the canonical merge pattern for sharded JSON output.

```bash
jq -c '{id, title, severity}' findings.json
```
Compact (`-c`) one-object-per-line projection — perfect input for `xargs -L1` or `grep`-style downstream tools.

## Wrong Choice When

- Don't use `jq` for bidirectional grep on flattened paths; the inverse (`gron` outputs `obj.foo.bar = …` lines you can `rg` then translate back). Reach for `gron`.
- Don't use `jq` directly on multi-document YAML or front-matter Markdown. Reach for `yq` (`hatch3r-cli-yq`) and pipe `yq -o=json` into `jq` only if you need jq's filter language.
- Don't reach for `jq` when the file is a stream of newline-delimited JSON (`.ndjson`); use `jq -c` per line or `jaq`/`fx` for stream-friendly behavior — `jq` without `-c` slurps the whole file.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `yq` (`hatch3r-cli-yq`) | YAML, TOML, XML input — yq speaks them all, jq is JSON-only. |
| `gron` | Flatten JSON to `path = value` lines for grep-based exploration and reverse-translation. |
| `dasel` | Single binary across JSON/YAML/TOML/XML with a path-query DSL — handy in CI where you do not want jq+yq. |
| `fx` | Interactive JSON browsing in a TTY; jq is the right call in scripts. |

## Detection / Install

Verify with:
```bash
command -v jq
```

Install (mac):

```bash
# brew
brew install jq
```

Homepage: https://github.com/jqlang/jq
