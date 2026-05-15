---
id: hatch3r-cli-duckdb
description: "Embedded analytical database with first-class CSV/Parquet support. Use when ad-hoc analytical SQL over local Parquet, CSV, and JSON files; invoke `duckdb`. Streams records lazily; works on datasets that exceed available RAM."
tags: ["cli-tools", "data"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: duckdb
  bin: duckdb
  tier: 2
  category: data
  homepage: https://duckdb.org/
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# duckdb

Embedded analytical database with first-class CSV/Parquet support

## When to Use

Reach for `duckdb` when the task is in the **data** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
duckdb -c "SELECT count(*) FROM 'data/*.parquet'"
```
Count rows across a Parquet glob — no schema declaration, no import step.

```bash
duckdb -c "COPY (SELECT * FROM 'in.csv' WHERE active) TO 'out.parquet' (FORMAT PARQUET)"
```
Filter a CSV and emit columnar Parquet in one pass; ideal for downstream `xsv`/`jq` chains.

```bash
duckdb -c "ATTACH 'app.sqlite' AS sqlite; SELECT * FROM sqlite.users LIMIT 10"
```
Query a SQLite file without conversion — useful for app debugging from the terminal.

```bash
duckdb -json -c "DESCRIBE 'data.parquet'"
```
Emit JSON schema rows for column inspection; pipe to `jq` to extract specific column types.

```bash
duckdb -c "SELECT date_trunc('day', ts) AS d, count(*) FROM 'events/*.csv' GROUP BY 1 ORDER BY 1"
```
Aggregate over a CSV directory; DuckDB streams the read so memory stays bounded.

## Wrong Choice When

- The CSV has <10k rows and you only need to slice/select columns — `xsv` (Tier 2 sibling) starts faster and has no install dependency in many environments.
- The workload is transactional (writes from multiple clients, ACID across rows) — use SQLite or Postgres; DuckDB is read-optimized OLAP.
- A single `jq` filter would do the job (the data is already JSON, the operation is field extraction) — skip the SQL detour.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `xsv` | Single CSV file, <100MB, just need slice/select/sort. |
| `sqlite3` | Need OLTP writes or row-level updates rather than analytics. |
| `python -m pandas` | Already in a Python script and the data fits in memory. |

## Detection / Install

Verify with:
```bash
command -v duckdb
```

Install (mac):

```bash
# brew
brew install duckdb
```

Homepage: https://duckdb.org/
