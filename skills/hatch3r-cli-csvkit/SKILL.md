---
id: hatch3r-cli-csvkit
description: "csvkit — Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat). Use when Python-powered CSV toolkit covering csvlook, csvsql, csvjoin, csvstat; invoke `csvlook`. Streams records lazily; works on datasets that exceed available RAM."
tags: ["cli-tools", "data", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: csvkit
  bin: csvlook
  tier: 3
  category: data
  homepage: https://csvkit.readthedocs.io/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# csvkit

csvkit — Python CSV toolkit (csvlook, csvsql, csvjoin, csvstat)

## When to Use

Reach for `csvlook` when the task is in the **data** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
csvcut -c name,email records.csv
```
Project two named columns from a CSV — column-name addressing instead of positional.

```bash
csvstat records.csv
```
One-shot column-by-column summary: type, count, null %, min/max/mean. Drop-in EDA.

```bash
csvgrep -c status -m active records.csv
```
Row filter where column `status` matches literal `active`.

```bash
csvjoin -c id a.csv b.csv
```
Join two CSVs on column `id` (inner join by default; `--left` / `--outer` available).

```bash
csvsql --query 'SELECT name FROM data WHERE active = 1' data.csv
```
Run SQL directly against a CSV using an in-memory SQLite — no schema file required.

## Wrong Choice When

- **Files larger than ~1M rows:** csvkit is Python-startup-heavy; `hatch3r-cli-duckdb` (tier 2) loads and queries the same file in a fraction of the time.
- **Production SQL workloads:** csvsql is convenient but evaluates against in-memory SQLite — use a real database for anything served.
- **Single-column slice or count under a few hundred MB:** `hatch3r-cli-qsv` (tier 2) is faster with lower memory pressure.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-duckdb` (tier 2) | Large files, analytical SQL, Parquet, multi-file joins |
| `hatch3r-cli-qsv` (tier 2) | Fast column slicing, sampling, deduping |
| `hatch3r-cli-miller` (tier 3) | Streaming put/filter DSL, format conversion |

## Detection / Install

Verify with:
```bash
command -v csvlook
```

Install (mac):

```bash
# pipx
pipx install csvkit
```

Homepage: https://csvkit.readthedocs.io/
