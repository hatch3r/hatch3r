---
id: hatch3r-cli-taplo
description: "TOML toolkit (format, lint, query) for pyproject.toml / Cargo.toml. Use when formatting and linting pyproject.toml or Cargo.toml manifests; invoke `taplo`. Preserves YAML anchors, comments, and ordering when editing in place."
tags: ["cli-tools", "yaml"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: taplo
  bin: taplo
  tier: 2
  category: yaml
  homepage: https://taplo.tamasfe.dev/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# taplo

TOML toolkit (format, lint, query) for pyproject.toml / Cargo.toml

## When to Use

Reach for `taplo` when the task is in the **yaml** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
taplo fmt
```
Format every TOML file under the cwd in-place; idempotent — safe to run in pre-commit.

```bash
taplo fmt --check
```
Exit non-zero if any TOML file would change; CI-friendly drift detector.

```bash
taplo lint
```
Surface syntax and schema-violation diagnostics; works with bundled schemas for `Cargo.toml`, `pyproject.toml`.

```bash
taplo get -f Cargo.toml package.version
```
Extract a single TOML value as plain stdout — replaces a multi-line `grep`/`sed` recipe.

```bash
taplo get -f pyproject.toml -o json 'project.dependencies'
```
Emit the value as JSON for piping into `jq` — keeps quoting unambiguous.

## Wrong Choice When

- The project has no TOML files (pure YAML/JSON config) — skip entirely; use `yq` for YAML, `jq` for JSON.
- You are converting TOML to YAML/JSON as the goal — `yq` or `dasel` handle multi-format conversion in one binary.
- The TOML lives inside a templating system (Jinja/Handlebars) — render the template first, then run `taplo` on the output.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `yq` | Mixed YAML/TOML/JSON; want a single multi-format query tool. |
| `dasel` | Same as `yq` plus XML; cross-format updates. |
| `grep` + `sed` | A single value lookup in a script with no `taplo` dependency available. |

## Detection / Install

Verify with:
```bash
command -v taplo
```

Install (mac):

```bash
# brew
brew install taplo
```

Homepage: https://taplo.tamasfe.dev/
