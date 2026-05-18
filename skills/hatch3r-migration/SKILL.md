---
id: hatch3r-migration
type: skill
description: Plan and execute migrations for databases, frameworks, and dependencies. Covers breaking change analysis, phased rollout, and rollback procedures.
tags: [implementation, brownfield]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

# Migration Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Assess migration scope
- [ ] Step 2: Analyze breaking changes
- [ ] Step 3: Create migration plan
- [ ] Step 4: Execute migration phases
- [ ] Step 5: Validate and verify
- [ ] Step 6: Document and clean up
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: target version pinned, allowed downtime window, irreversible operations (schema drops, data deletes), rollback acceptable as cold restore vs hot revert, and consumer compatibility window (single PR vs phased).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

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

## Error Handling

- **Migration phase fails partway through**: Roll back to the last successful phase checkpoint. Diagnose the failure before retrying. Each phase must leave the codebase in a working state.
- **Rollback procedure does not restore original behavior**: Treat this as a critical gap. Fix the rollback procedure before proceeding with the migration, since an untested rollback path is a deployment risk.
- **Dependency version conflict during migration**: Pin the conflicting dependency to the version compatible with the migration target. Document the pin and plan its removal after all consumers are updated.

## Definition of Done

- [ ] All phases completed and verified
- [ ] Full test suite passes
- [ ] Rollback procedure tested
- [ ] No backward-compatibility shims remain
- [ ] Documentation updated
- [ ] Performance verified against baseline
