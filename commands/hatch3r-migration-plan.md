---
id: hatch3r-migration-plan
type: command
description: Create a phased migration plan for a major dependency or framework upgrade. Analyzes breaking changes and produces an actionable plan with rollback procedures.
---
# Migration Plan Generator

## Inputs

- **Migration target:** dependency name and target version, or framework/platform change description
- **Current version:** auto-detected from lockfile or specified manually
- **Scope:** `full` (default) or `assessment-only` (just the analysis, no plan)

## Procedure

1. **Detect current state:**
   - Read `package.json`, lockfile, or equivalent for current version
   - Identify all direct and transitive dependents of the migration target
   - Count usage sites in the codebase (imports, API calls)

2. **Research breaking changes:**
   - Read the changelog/release notes between current and target versions
   - Use web research for migration guides, known issues, and community solutions
   - Identify deprecated APIs, removed features, and behavioral changes

3. **Impact analysis:**
   - Map each breaking change to affected files in the codebase
   - Classify impact: `trivial` (find-replace), `moderate` (logic change), `significant` (architectural change)
   - Estimate effort per change (hours)
   - Identify risk areas (data loss potential, security implications, performance impact)

4. **Generate phased plan:**
   - Phase 0: Preparation (add compatibility shims, increase test coverage on affected areas)
   - Phase 1: Non-breaking updates (update config, add new imports alongside old)
   - Phase 2: Migrate consumers (update code to use new APIs)
   - Phase 3: Remove old code (delete shims, deprecated usage, old dependencies)
   - Each phase includes: files to change, validation criteria, rollback steps

5. **Output the plan** as a markdown document or GitHub issue(s).

## Output

- Migration assessment with breaking change inventory
- Phased migration plan with effort estimates
- Rollback procedure for each phase
- Checklist of validation steps

## Related

- **Skill:** `hatch3r-migration` — execution workflow for the plan
- **Skill:** `hatch3r-dep-audit` — dependency health check
