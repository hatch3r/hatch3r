---
id: hatch3r-migration
type: skill
description: Plan and execute migrations for databases, frameworks, and dependencies. Covers breaking change analysis, phased rollout, and rollback procedures.
---

# Migration Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Assess migration scope
- [ ] Step 2: Analyze breaking changes
- [ ] Step 3: Create migration plan
- [ ] Step 4: Execute migration phases
- [ ] Step 5: Validate and verify
- [ ] Step 6: Document and clean up
```

## Step 1: Assess Migration Scope

- Identify the migration type: database schema, framework version, dependency upgrade, language version, or infrastructure change.
- Inventory all affected files, modules, and services.
- Check for transitive dependency impacts — upgrading one package may force others.
- Review the target version's changelog, migration guide, and known issues.
- Estimate effort and risk level (low/medium/high) based on scope.

## Step 2: Analyze Breaking Changes

- Compare current vs target API surfaces for changed/removed features.
- Search the codebase for usage of deprecated or removed APIs.
- For database migrations: identify schema changes, data transformations, and index impacts.
- For framework upgrades: check configuration format changes, plugin compatibility, and behavioral differences.
- Document each breaking change with affected file locations and required code modifications.

## Step 3: Create Migration Plan

- Define phases with clear boundaries — each phase should be independently deployable and rollback-safe.
- Phase ordering: compatibility layer first, then consumer migration, then removal of old code.
- For database migrations: write both `up` and `down` migration scripts. Test both directions.
- Include a rollback plan for each phase with specific steps and time estimates.
- Set validation criteria for each phase before proceeding to the next.

## Step 4: Execute Migration Phases

- Implement one phase at a time. Verify before proceeding.
- For dependency upgrades: update lockfile, fix type errors, update API calls, run tests.
- For database migrations: run against a staging copy first, verify data integrity, measure execution time.
- For framework migrations: use codemods where available, manual fixes where not.
- Keep backward compatibility during transition — both old and new code paths should work.

## Step 5: Validate and Verify

- Run the full test suite after each phase.
- For database migrations: verify row counts, check constraint integrity, test queries against migrated data.
- For dependency upgrades: verify bundle size impact, check for runtime behavior changes.
- Performance benchmark critical paths before and after.
- Test rollback procedure on a staging environment.

## Step 6: Document and Clean Up

- Remove compatibility shims and old code paths after the migration is complete.
- Update project documentation (README, setup guides, deployment docs).
- Update CI configuration if build steps changed.
- Delete unused migration scripts after they've been applied to all environments.
- Write a migration retrospective noting what went well and any issues encountered.

## Definition of Done

- [ ] All phases completed and verified
- [ ] Full test suite passes
- [ ] Rollback procedure tested
- [ ] No backward-compatibility shims remain
- [ ] Documentation updated
- [ ] Performance verified against baseline
