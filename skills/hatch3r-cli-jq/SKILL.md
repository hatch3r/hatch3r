---
id: hatch3r-cli-jq
name: hatch3r-cli-jq
type: skill
description: "JSON processor and query language. Use when shaping JSON streams via jq-syntax filters and select expressions; invoke `jq`. Reads stdin and emits stdout; integrates seamlessly into shell pipelines."
tags: ["cli-tools", "json", "orchestration"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
# D9-H-6 (D9, P1): pre-approve the wrapped shell binary on the GitHub Copilot
# Skills surface so the runtime skips per-invocation confirmation for `jq`.
# Rendered as an `allowed-tools:` frontmatter line on `.github/skills/.../SKILL.md`
# by the Copilot adapter; other adapters ignore the field.
allowed_tools: ["jq"]
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

## §0 — Ambiguity & Safety Gate (P8 B1)

Before invoking `jq`, resolve these via `agents/shared/user-question-protocol.md` (default behavior, not exception-driven):
- **Scope:** when the input JSON path is ambiguous (a glob like `*.json` or a slurp over several shards), confirm which files feed the filter before running.
- **Irreversibility:** `jq` reads stdin and writes stdout, so it is non-destructive by itself — but redirecting its output over the source (`jq … input.json > input.json`) truncates the file before `jq` reads it. Write to a temp file and rename, never redirect over the input.
- **Ambiguity:** when the request maps to two or more filter expressions with materially different output shape (raw `-r` vs JSON, `select` vs `map`), ask which one.

## Fan-out Discipline (P8 B2)

Tier 1 reference card — no fan-out. This skill is a single-tool usage reference an agent consults inline; it spawns no sub-agents. Fan-out is owned by the calling workflow per its own Fan-out Discipline block. Source: `.claude/rules/fan-out-discipline.md` (P8 B2).

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
- Don't use `jq` directly on multi-document YAML or front-matter Markdown. Reach for `yq` (toolbox section in `hatch3r-cli-toolbox`) and pipe `yq -o=json` into `jq` only if you need jq's filter language.
- Don't reach for `jq` when the file is a stream of newline-delimited JSON (`.ndjson`); use `jq -c` per line or `jaq`/`fx` for stream-friendly behavior — `jq` without `-c` slurps the whole file.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `yq` (toolbox section) | YAML, TOML, XML input — yq speaks them all, jq is JSON-only. |
| `gron` | Flatten JSON to `path = value` lines for grep-based exploration and reverse-translation. |
| `dasel` | Single binary across JSON/YAML/TOML/XML with a path-query DSL — handy in CI where you do not want jq+yq. Pin to >=3.11.0 (CVE-2026-46377 / -46378 / -33320 fixed there). |
| `fx` | Interactive JSON browsing in a TTY; jq is the right call in scripts. |

## Detection / Install

Verify with:
```bash
command -v jq
```

Install (macOS — default for this machine):

```bash
# brew
brew install jq
```

Install (Linux):

```bash
# apt
sudo apt install jq
```

Install (Windows):

```bash
# scoop
scoop install jq
```

Homepage: https://github.com/jqlang/jq

## Security

Minimum recommended version: `>=1.8.1`. Builds below this floor carry known unpatched advisories — upgrade before relying on the tool.

Multiple unfixed advisories on jq 1.8.1 (the only tagged release as of 2026-05-27). See https://github.com/jqlang/jq/security/advisories for the canonical roster — at audit time the upstream tab listed 10+ GHSA entries (April-May 2026), all stack-overflow / integer-overflow / NUL-truncation classes triggerable by attacker-controlled JSON or attacker-controlled jq filter paths. Validate JSON inputs externally (e.g. python json.tool or jaq) or sandbox jq in a network-isolated container before running on untrusted input.
