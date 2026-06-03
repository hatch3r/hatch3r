---
id: hatch3r-migrations
type: rule
description: Database migration and schema change patterns — expand-contract, online DDL, backfills, compatibility windows, reversibility, multi-region, tooling
scope: conditional
globs: "**/migrations/**,**/*migration*,**/migrate/**,**/seeds/**,**/seeders/**,**/prisma/migrations/**,**/drizzle/**,**/knex/**"
tags: [implementation, ctx:brownfield-only]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Migrations

- Migration scripts live in a dedicated `migrations/` directory. One script per migration.
- Every migration is idempotent (re-running produces the same result). Use a version column, `migratedAt` timestamp, or migration ledger row to skip already-applied work.
- Test every migration against an emulator or staging dataset before production. Verify data integrity after each step, not just at the end.
- Document the schema change in the project data model spec. Hot documents must stay within size limits after migration.

## Expand-Contract Pattern (mandatory for non-trivial schema changes)

Non-trivial = anything beyond pure-additive nullable columns on small tables, or any rename/drop/type-change. Use a 3-deploy cadence; split Migrate into two deploys when dual-write is required (4 deploys total).

1. **Deploy 1 — Expand.** Add new column nullable, add new table, or `CREATE INDEX CONCURRENTLY`. Add new constraints with `NOT VALID` first. Old code paths still work. No app behavior change in this deploy.
2. **Deploy 2 — Migrate (backfill + dual-write).** Run a batched, idempotent, resumable backfill job. If the change is a column rename / type swap, app code writes to both old and new columns during this phase. Validate row counts and per-block checksums on the new shape before proceeding.
3. **Deploy 3 — Contract.** Switch reads to the new shape (feature-flag-gated; flip is the rollback). Drop the old column, old table, or old index. Wait at least one full release cycle plus one on-call rotation between Expand and Contract — old code must remain executable to roll back inside the deploy window.

Hard rules: never rename a column in a single step; never add a `NOT NULL` column to a populated table without a default or a deferred `SET NOT NULL NOT VALID` → `VALIDATE`; every phase must be valid in isolation so that any deploy is independently rollbackable.

## Online Schema Changes

Set `lock_timeout` and `statement_timeout` before every DDL statement to bound blast radius. Selection by engine:

- **Postgres 18.x.** Use `CREATE INDEX CONCURRENTLY` (outside any transaction block — disable the migration tool's transaction wrapper). On failure, the index is left `INVALID`; emit a `DROP INDEX IF EXISTS` + retry step. For FK and CHECK constraints, use `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` followed later by `VALIDATE CONSTRAINT` (skips full scan, downgrades to `SHARE UPDATE EXCLUSIVE`). Postgres 18 also supports `SET NOT NULL NOT VALID` for column nullability. Use `pg_repack` 1.5.x for bloat removal instead of `VACUUM FULL`. Avoid `ALTER TABLE ... ADD COLUMN ... DEFAULT non_constant_expression` on large tables — it rewrites every row.
- **MySQL 8.4 LTS.** `ALGORITHM=INSTANT` is the default for many metadata ops (ADD COLUMN at end, RENAME COLUMN, some index meta) — verify against the 8.4 online DDL operations matrix. Hard limit: 64 row versions per table in 8.4. When `INSTANT` is rejected, fall back to `ALGORITHM=INPLACE`. For `ALGORITHM=COPY` operations on large tables, use `gh-ost` v1.1.8 (trigger-free, binlog-based, checkpoint + resume + revert) when the table has no incoming FKs and the cluster is not Galera / Percona XtraDB. Use `pt-online-schema-change` when FKs are present (`--alter-foreign-keys-method`) or under Galera. `lhm` is unmaintained — do not propose it for new code.

## Backfill Jobs

Every backfill must be batched, idempotent, resumable, throttled, and observable.

- **Batched.** Order by PK or a monotonic key. Chunk by `id BETWEEN ? AND ?` (range), not `LIMIT/OFFSET` — offsets drift under concurrent writes. Default chunk 1k–10k rows; tune by table width.
- **Idempotent.** Write `UPDATE ... SET new = f(old) WHERE id = ? AND new IS NULL` (or upsert with a deterministic source-derived value). Re-running on the same range must produce the same final state.
- **Resumable.** Persist the last-processed boundary (`last_id` or timestamp cursor) to a control table after each batch commit. Resume from the checkpoint on restart; never restart from zero on partial failure.
- **Throttled.** Poll replication lag (`pg_stat_replication`, `SHOW REPLICA STATUS`) between batches; pause when lag exceeds 30 seconds or the SLO threshold. Cap concurrency at the IO budget of the slowest replica.
- **Observable.** Emit `migration.backfill.rows_processed` (counter), `migration.backfill.error_rate` (counter), `migration.backfill.eta_seconds` (gauge), and `migration.backfill.current_boundary` (gauge). Wire dashboards before launch. Avoid single mega-DML — one `UPDATE` over 50M+ rows produces multi-hour locks and table bloat.

## Compatibility Window

Schema changes deploy before the code that depends on them when widening (add column, add table, add index). Schema changes deploy after the code that no longer depends on them when narrowing (drop column, drop table). During the window, app code reads both shapes — the new shape if populated, fall back to the old shape otherwise. Rollback compatibility (old code remains executable against the current schema) must hold for at least 1 full release cycle plus 1 on-call rotation — minimum 7 calendar days, longer when the on-call rotation is longer.

## Reversibility

Every migration ships a tested down-migration script. Forward-only migrations are permitted only when the operation is data-destructive (e.g., a `DROP COLUMN` after Contract) — these require an explicit `IRREVERSIBLE: <reason>` annotation in the migration header and reviewer sign-off. A compensating forward migration that restores the prior shape is acceptable in place of a down-script for tools that lack reversibility (Prisma Migrate, Drizzle Kit — surface the gap to the reviewer). Default for every migration: reversible.

## Data Integrity Verification

Apply layered verification from cheapest to most thorough; stop at the cheapest layer that detects no drift.

1. **Pre-migration backup drill.** Full restore to staging plus a smoke query within 24 hours prior to a destructive migration. "Backup exists" is not verification.
2. **Row-count parity per chunk.** Source rows processed equals target rows written. Log discrepancies as errors, not warnings.
3. **Aggregate checks.** SUM, MIN, MAX, COUNT(DISTINCT) on numeric and date columns per partition or batch.
4. **Per-block checksums.** SHA-256 or MD5 over concatenated key columns for blocks of N rows (e.g., `md5(string_agg(id::text || col::text, ',' ORDER BY id))`).
5. **Cross-system diff.** Datafold Reconcile, dbt-data-diff, or a hand-rolled sample-then-drill comparison for value-level differences.
6. **Canary dual-read.** Read both shapes in production for 24–72 hours before cutover; shadow-diff and alert on mismatch.
7. **Reconciliation control table.** Per-batch row count plus checksum stored alongside the checkpoint; auto-stop the backfill on drift above the configured threshold.

## Multi-Region & Replica Lag

- Pause backfill writes when any replica lag exceeds 30 seconds (or the project's lag SLO, whichever is lower). Resume only after lag returns to baseline for 5 consecutive minutes.
- Roll migrations across regions sequentially; never alter an active partition during the peak traffic window of any region.
- FK validation (`VALIDATE CONSTRAINT`) reads the entire dependent table — schedule outside peak read windows on replica-heavy topologies.
- For Postgres major-version upgrades, use native logical replication (PG17+ preserves slots through `pg_upgrade`); advance sequences manually at cutover — logical replication does not replicate sequences, DDL, or large objects.
- For ongoing cross-system replication, prefer Debezium (when Kafka is already deployed) or AWS DMS (managed, AWS-native). DMS hard limit: 200 tasks per replication instance — relevant for schema-per-tenant designs.

## Tooling Mandate

Pick one schema-management tool per project and commit the schema declaration to the repo. Greenfield default: Atlas (50+ destructive/locking linters, auto-generated down migrations, GitHub Actions approval policies) or dbmate (plain-SQL portability with first-class `-- migrate:down`). Existing-project default: whatever already ships migrations in the repo. Acceptable tools: Atlas, Prisma Migrate (forward-only — surface to reviewer), Drizzle Kit (forward-only — surface), Flyway 11+, Liquibase 4.27+ Pro, sqitch, Alembic, Knex, dbmate, Bytebase. Run a migration linter in CI — Atlas analyze, `squawk` for raw Postgres SQL — fail the PR on destructive operations without an explicit `IRREVERSIBLE:` annotation.

Cross-references: see `hatch3r-data-classification` (PII / encrypted-column migration requirements), `hatch3r-feature-flags` (read-path switchover gating), `hatch3r-observability-metrics` (backfill progress metrics).
