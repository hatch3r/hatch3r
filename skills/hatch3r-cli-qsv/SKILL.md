---
id: hatch3r-cli-qsv
description: "Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor. Use when slicing huge CSV documents by row range or column without materialising the dataset; invoke `qsv`. Streams records lazily; works on datasets that exceed available RAM."
tags: ["cli-tools", "data"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: qsv
  bin: qsv
  tier: 2
  category: data
  homepage: https://github.com/jqnatividad/qsv
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# qsv

Fast CSV toolkit (slice, search, join, stats, 80+ commands) — actively-maintained xsv successor

## When to Use

Reach for `qsv` when the task is in the **data** category and the agent would otherwise call an MCP tool or read large outputs into context.

`qsv` is a drop-in superset of `xsv` — every `xsv` sub-command name and flag works under `qsv`, plus 50+ additional commands (`apply`, `fetch`, `validate`, `tojsonl`, `sqlp`, etc.). The upstream `BurntSushi/xsv` repository was archived on 2025-04-24; `jqnatividad/qsv` is the active fork with regular releases.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
qsv stats huge.csv
```
Per-column min/max/mean/stddev/cardinality — single streaming pass over the file.

```bash
qsv select name,email,active records.csv
```
Project a subset of columns without rewriting; output stays CSV for downstream tools.

```bash
qsv sort -s amount records.csv | qsv slice -e 100
```
Sort by `amount` then take the first 100 rows — composable pipe; both stages stream.

```bash
qsv frequency -s status events.csv
```
Tabulate value counts for a column; output is itself CSV, parsable by the next step.

```bash
qsv search -s email '@example\.com$' users.csv
```
Regex-filter a column — much cheaper than loading the whole file into a SQL engine.

```bash
qsv join id orders.csv id customers.csv > joined.csv
```
Hash join two CSVs on a common column without spinning up DuckDB.

## Wrong Choice When

- The query needs aggregation across millions of rows or multiple files — DuckDB (Tier 2 sibling) is built for that scan plan.
- You need a multi-way join with type coercion or window functions — `qsv join` is hash-only and untyped; use DuckDB.
- The data is JSON or Parquet, not CSV — pipe through `jq`/DuckDB instead of CSV-converting first.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| DuckDB | Aggregations, joins, or non-CSV inputs (Parquet/JSON). |
| Miller (`mlr`) | Need TSV/JSON-Lines support or per-record transforms in the same tool. |
| csvkit | Want CSV-to-SQL or CSV-to-JSON conversions out of the box. |

## Detection / Install

Verify with:
```bash
command -v qsv
```

Install (mac):

```bash
# brew
brew install qsv
```

Homepage: https://github.com/jqnatividad/qsv
