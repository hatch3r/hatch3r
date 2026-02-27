---
id: hatch3r-release
description: Cut a release with version bump, changelog, tagging, and deploy verification. Use when preparing a release, cutting a version, or deploying to production.
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
- [ ] Step 5: Create git tag and GitHub release with changelog
- [ ] Step 6: Deploy and verify (staging first if applicable, then production)
- [ ] Step 7: Monitor post-deploy for errors/regressions
```

## Step 1: Determine Version Bump

- Review changes since last release: merged PRs, commit history.
- Use **GitHub MCP** (`search_issues`, PR search) to list merged PRs since last tag.
- Apply [Semantic Versioning](https://semver.org/):
  - **Major:** Breaking changes (API, data model, config)
  - **Minor:** New features, backward-compatible
  - **Patch:** Bug fixes, security patches, non-breaking improvements
- Check project release gates: no P0/P1 bugs open, E2E pass, performance budgets met.

## Step 2: Generate Changelog

- List merged PRs since last release (e.g., `git log v1.2.0..HEAD --oneline` or GitHub Releases API).
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

## Step 5: Create Tag and GitHub Release

- Create annotated tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
- Push tag: `git push origin vX.Y.Z`.
- Create GitHub Release with:
  - Title: `vX.Y.Z`
  - Changelog as release notes
  - Attach build artifacts if applicable
- Use **GitHub MCP** if available for release creation; otherwise use `gh release create` or GitHub UI.

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
- [ ] GitHub release published with changelog
- [ ] Deployed to production and verified
- [ ] Post-deploy monitoring completed (no critical regressions)
- [ ] All release gates satisfied
