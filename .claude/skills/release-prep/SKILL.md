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

4. Update `package.json` version field
5. Run `npm install` to refresh lockfile version

## Step 3: Quality Gates

Run all gates — ALL must pass:

6. `npm test` — 0 failed tests
7. `npx tsc --noEmit` — 0 type errors
8. `npm run lint` — 0 lint errors
9. `npm run build` — build succeeds, output in `dist/`
10. `npx hatch3r validate` — 0 validation errors

## Step 4: Adapter Verification

11. Verify all 15 adapters are registered in `src/adapters/index.ts`
12. Verify `ADAPTER_CAPABILITIES` matrix is complete (no undefined entries)
13. Check that `package.json` `files` array includes all content directories:
    - `agents/`, `checks/`, `commands/`, `rules/`, `skills/`, `prompts/`, `github-agents/`, `mcp/`, `hooks/`

## Step 5: Lockfile & Supply Chain

14. Verify lockfile integrity: `npx lockfile-lint --type npm --allowed-schemes https: --path package-lock.json`
15. Run security audit: `npm audit --audit-level=high --omit=dev`

## Step 6: Changelog

16. Generate CHANGELOG entries grouped by: Adapters, Content, CLI, Governance, Dependencies, Chore
17. Verify version header matches package.json version

## Step 7: Tag & Release

18. Create annotated git tag: `git tag -a v{version} -m "hatch3r v{version}"`
19. Ask user to confirm before pushing tag and creating GitHub release
