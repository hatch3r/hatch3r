---
name: release-prep
description: Prepare a hatch3r release — version bump, changelog, quality gates, adapter output verification, and npm publish readiness.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

# Release Prep

Prepare a hatch3r framework release with full quality gates.

## Step 1: Determine Version

1. Check current version: `node -e "console.log(require('./package.json').version)"`
2. Review changes since last tag:
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```
3. Apply semver:
   - **Major:** Breaking adapter contract changes, breaking canonical format changes
   - **Minor:** New adapter, new content type, new CLI command
   - **Patch:** Bug fixes, documentation, dependency updates

## Step 2: Update Version

4. Update `package.json` version field (single source of truth)
5. Update `.claude-plugin/plugin.json` version field to the same semver
6. Update the embedded manifest copy in `docs/marketplace-submission.md` (search for `"version":` inside the plugin-manifest JSON block) to the same semver
7. Run `npm install` to refresh lockfile version
8. Run `npm run inventory:check-docs` to verify no version drift (the version probes in `scripts/inventory.ts` compare `package.json` against the files above)
9. `.cursor-plugin/plugin.json` version is tracked independently (Cursor plugin release cadence can diverge from hatch3r package cadence); bump only if the Cursor plugin changes

## Step 3: Quality Gates

Run all gates — ALL must pass:

10. `npm test` — 0 failed tests
11. `npx tsc --noEmit` — 0 type errors
12. `npm run lint` — 0 lint errors
13. `npm run build` — build succeeds, output in `dist/`
14. `npx hatch3r validate` — 0 validation errors

## Step 4: Adapter Verification

15. Verify all 15 adapters are registered in `src/adapters/index.ts`
16. Verify `ADAPTER_CAPABILITIES` matrix is complete (no undefined entries)
17. Check that `package.json` `files` array includes all content directories:
    - `agents/`, `checks/`, `commands/`, `rules/`, `skills/`, `prompts/`, `github-agents/`, `mcp/`, `hooks/`

## Step 5: Lockfile & Supply Chain

18. Verify lockfile integrity: `npx lockfile-lint --type npm --allowed-schemes https: --path package-lock.json`
19. Run security audit: `npm audit --audit-level=high --omit=dev`

## Step 6: Changelog

20. Generate CHANGELOG entries grouped by: Adapters, Content, CLI, Governance, Dependencies, Chore
21. Verify version header matches package.json version

## Step 7: Tag & Release

22. Create annotated git tag: `git tag -a v{version} -m "hatch3r v{version}"`
23. Ask user to confirm before pushing tag and creating GitHub release
