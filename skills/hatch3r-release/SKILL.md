---
id: hatch3r-release
description: Cut a release with version bump, changelog, tagging, and deploy verification. Use when preparing a release, cutting a version, or deploying to production.
tags: [devops]
quality_charter: agents/shared/quality-charter.md
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool as appropriate.

# Release Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Determine version bump (major/minor/patch) based on changes
- [ ] Step 2: Generate changelog from merged PRs and commit history
- [ ] Step 3: Update version in package.json and any other version references
- [ ] Step 4: Verify quality gates (lint, typecheck, all tests)
- [ ] Step 5: Create git tag and platform release with changelog
- [ ] Step 6: Deploy and verify (staging first if applicable, then production)
- [ ] Step 7: Monitor post-deploy for errors/regressions
```

## Step 1: Determine Version Bump

- Review changes since last release: merged PRs/MRs, commit history.
- List merged PRs/MRs since last tag using the platform tools (check `platform` in `.agents/hatch.json`):
  - **GitHub:** Use **GitHub MCP** (`search_issues`, PR search) or `gh pr list --state merged --base {defaultBranch}`
  - **Azure DevOps:** `az repos pr list --status completed --target-branch {defaultBranch}`
  - **GitLab:** `glab mr list --state merged --target-branch {defaultBranch}`
- Apply [Semantic Versioning](https://semver.org/):
  - **Major:** Breaking changes (API, data model, config)
  - **Minor:** New features, backward-compatible
  - **Patch:** Bug fixes, security patches, non-breaking improvements
- Check project release gates: no P0/P1 bugs open, E2E pass, performance budgets met.

## Step 2: Generate Changelog

- List merged PRs/MRs since last release (e.g., `git log v1.2.0..HEAD --oneline` or the platform's release/PR API).
- Group by category: Features, Bug Fixes, Security, Dependencies, Chore.
- Format each entry: `- description (#PR-number)` or `- description (commit hash)`.
- Include breaking changes section if major bump.
- Follow project changelog format (e.g., `CHANGELOG.md` or GitHub Release notes).

## Step 3: Update Version

- Update `version` in `package.json`.
- Update any other version references: `package-lock.json` (via `npm version`), docs, config files.
- Run `npm install` to refresh lockfile if needed.
- Commit with message: `chore(release): vX.Y.Z` or similar.

## Step 4: Verify Quality Gates

```bash
npm run lint && npm run typecheck && npm run test
npm run build
```

- All tests pass (unit, integration, E2E).
- Bundle size within budget (if defined).
- Security rules tests pass if rules changed.
- No TODO without linked issue.
- See project quality documentation for full pre-release gates.

## Step 5: Create Tag and Release

- Create annotated tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
- Push tag: `git push origin vX.Y.Z`.
- Create the release using the platform CLI (check `platform` in `.agents/hatch.json`):
  - **GitHub:** `gh release create vX.Y.Z --title "vX.Y.Z" --notes "{changelog}"` (or use **GitHub MCP** if available)
  - **Azure DevOps:** `az repos tag create vX.Y.Z` — attach release notes as a wiki page or work item, and upload build artifacts via Azure Artifacts
  - **GitLab:** `glab release create vX.Y.Z --name "vX.Y.Z" --notes "{changelog}"`
- Attach build artifacts if applicable.

## Step 6: Deploy and Verify

- Deploy to staging first (if applicable). Run smoke tests.
- Deploy to production (project-specific pipeline).
- Verify: health check, key flows.
- Document deploy method and environment in project docs if not already.

## Step 7: Monitor Post-Deploy

- Monitor error rate (target per project SLO).
- Monitor function/API error rate.
- Check for startup time regression.
- Watch user-reported issues for first 24h.
- If errors spike: rollback and investigate.

## Definition of Done

- [ ] Version bumped in package.json
- [ ] Changelog generated and included in release
- [ ] Git tag created and pushed
- [ ] Release published with changelog (GitHub Release / ADO wiki + tag / GitLab Release)
- [ ] Deployed to production and verified
- [ ] Post-deploy monitoring completed (no critical regressions)
- [ ] All release gates satisfied
