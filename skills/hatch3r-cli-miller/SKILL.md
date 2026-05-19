---
id: hatch3r-cli-miller
description: "awk/sed/cut/join for CSV/TSV/JSON/Parquet streams. Use when awk-like record processing across CSV, TSV, JSON line streams; invoke `mlr`. Streams records lazily; works on datasets that exceed available RAM."
tags: ["cli-tools", "data", "opt-in"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: miller
  bin: mlr
  tier: 3
  category: data
  homepage: https://miller.readthedocs.io/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# miller

awk/sed/cut/join for CSV/TSV/JSON/Parquet streams

## When to Use

Reach for `mlr` when the task is in the **data** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
mlr --c2t cat data.csv
```
Convert CSV to TSV on stdout — handy for piping into shell tools that prefer tab delimiters.

```bash
mlr --csv stats1 -a mean,stddev -f price products.csv
```
Compute mean and stddev of the `price` column.

```bash
mlr --icsv --ojson put '$tax = $amount * 0.07' transactions.csv
```
Read CSV, add a computed column, emit JSON — chained format conversion plus DSL transform.

```bash
mlr --csv filter '$status == "active"' users.csv
```
Row filter using the put/filter DSL — operates on streams of arbitrary size.

```bash
mlr --csv join -j id -f orders.csv customers.csv
```
SQL-style join on `id` between two CSVs, streamed.

## Wrong Choice When

- **Multi-gigabyte analytical queries with joins:** `hatch3r-cli-duckdb` (tier 2) has a query planner and parallel scan; mlr is streaming-single-thread.
- **One-column slice or count:** `hatch3r-cli-qsv` (tier 2) is faster for trivial slicing.
- **Production ETL with schema enforcement:** use a real database or dbt — mlr is a CLI-scratchpad tool.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `hatch3r-cli-duckdb` (tier 2) | Multi-GB data, joins, analytical SQL, Parquet |
| `hatch3r-cli-qsv` (tier 2) | Single-column slice, count, sample on plain CSV |
| `hatch3r-cli-csvkit` (tier 3) | SQL-over-CSV with `csvsql`, Python integration |

## Detection / Install

Verify with:
```bash
command -v mlr
```

Install (mac):

```bash
# brew
brew install miller
```

Homepage: https://miller.readthedocs.io/
