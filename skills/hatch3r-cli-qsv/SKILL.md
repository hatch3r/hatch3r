---
id: hatch3r-cli-xsv
description: "Fast CSV toolkit (slice, search, join, stats). Use when slicing huge CSV documents by row range or column without materialising the dataset; invoke `xsv`. Streams records lazily; works on datasets that exceed available RAM."
tags: ["cli-tools", "data"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: xsv
  bin: xsv
  tier: 2
  category: data
  homepage: https://github.com/BurntSushi/xsv
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# xsv

Fast CSV toolkit (slice, search, join, stats)

## When to Use

Reach for `xsv` when the task is in the **data** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
xsv stats huge.csv
```
Per-column min/max/mean/stddev/cardinality — single streaming pass over the file.

```bash
xsv select name,email,active records.csv
```
Project a subset of columns without rewriting; output stays CSV for downstream tools.

```bash
xsv sort -s amount records.csv | xsv slice -e 100
```
Sort by `amount` then take the first 100 rows — composable pipe; both stages stream.

```bash
xsv frequency -s status events.csv
```
Tabulate value counts for a column; output is itself CSV, parsable by the next step.

```bash
xsv search -s email '@example\.com$' users.csv
```
Regex-filter a column — much cheaper than loading the whole file into a SQL engine.

```bash
xsv join id orders.csv id customers.csv > joined.csv
```
Hash join two CSVs on a common column without spinning up DuckDB.

## Wrong Choice When

- The query needs aggregation across millions of rows or multiple files — DuckDB (Tier 2 sibling) is built for that scan plan.
- You need a multi-way join with type coercion or window functions — `xsv join` is hash-only and untyped; use DuckDB.
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
command -v xsv
```

Install (mac):

```bash
# brew
brew install xsv
```

Homepage: https://github.com/BurntSushi/xsv
