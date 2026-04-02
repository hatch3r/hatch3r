---
id: hatch3r-migrations
type: rule
description: Database migration and schema change patterns for the project
scope: "**/migrations/**,**/*migration*,**/migrate/**,**/seeds/**,**/seeders/**,**/prisma/migrations/**,**/drizzle/**,**/knex/**"
tags: [implementation, brownfield]
---
# Migrations

- Schema changes must be backward-compatible. Add fields with defaults; never remove or rename without migration.
- Migration scripts live in a dedicated `migrations/` directory. One script per migration.
- Every migration is idempotent. Safe to re-run. Use document version or `migratedAt` to skip.
- Migration functions log progress and are resumable. Handle partial failures.
- Test migrations against emulator or staging before deploying. Verify data integrity.
- Order: deploy new code (handles old + new schema) → run migration → remove old schema handling.
- Document schema changes in project data model spec.
- Rollback plan required for every migration. Never run destructive migrations without backup verification.
- Hot documents must stay within size limits after migration.

## Data Validation During Migration

- Validate data integrity after each migration step, not just at the end. Check that migrated records match the expected schema, required fields are populated, and no data was silently dropped.
- Include count checks: the number of records processed should match the number of records in the source collection. Log discrepancies as errors, not warnings.
- For large datasets, migrate in batches with progress checkpoints. If a batch fails, resume from the last checkpoint rather than restarting the entire migration.

## Migration Coordination in Multi-Service Environments

- When a migration affects shared data (e.g., a schema used by multiple services), coordinate the migration order across services. The consuming services must be deployed with backward-compatible readers before the migration runs.
- Never assume that all service instances will be running the same code version during a migration window. Design migrations to tolerate mixed-version reads and writes during the rollout period.
