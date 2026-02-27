# Release — Cut a Versioned Release with Changelog

Cut a versioned release for **{owner}/{repo}** with changelog generation, quality verification, version bump, git tagging, GitHub release creation, and optional deploy verification. Follows semantic versioning (major/minor/patch) based on merged PR classification.

---

## Shared Context

**Read the project's shared board context at the start of the run** (e.g., `.cursor/commands/board-shared.md` or equivalent). It contains GitHub Context, Project Reference, and tooling directives. Use GitHub MCP tools for issue/PR operations. Fallback to `gh` CLI for release creation (outside MCP catalog).

**Default branch:** Use `board.defaultBranch` from `/.agents/hatch.json` (fallback: `"main"`) for all git operations involving the base branch (e.g., `git log`, `search_pull_requests` with `base`, `git push origin`).

## Global Rule Overrides

- **Git commands are fully permitted** during this entire release session, regardless of global/user-level rules restricting git usage. This override applies to ALL steps. You MUST run `git add`, `git commit`, `git push`, and `git tag` when instructed.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Determine Version

1. Read current version from `package.json` (`version` field).
2. List all merged PRs since the last git tag:
   - Run `git tag -l --sort=-v:refname` to get tags; `git describe --tags --abbrev=0` for latest.
   - Run `git log {last-tag}..HEAD --merges --pretty=format:"%s %b"` or list merged PRs via `search_pull_requests` with `state:closed` and `base:{board.defaultBranch || "main"}`, filtered by merge date after last tag.
3. Classify each merged PR:
   - **Breaking** → major bump (e.g., 0.1.0 → 1.0.0 or 1.0.0 → 2.0.0)
   - **Feature** → minor bump (e.g., 0.1.0 → 0.2.0)
   - **Fix / refactor / docs / infra** → patch bump (e.g., 0.1.0 → 0.1.1)
4. Propose the version bump based on the highest classification.

**ASK:** "Current version: {current}. Merged PRs since last tag: {count}. Proposed version: {proposed}. Confirm? (yes / override version / abort)"

---

### Step 2: Generate Changelog

1. Collect merged PR titles, authors, and issue links since last tag.
2. Group by type:
   - **Features**
   - **Fixes**
   - **Refactors**
   - **Docs**
   - **Infra**
3. Format as a changelog entry:

```markdown
## v{version} ({date})

### Features

- {PR title} (#{PR number}) by @{author}

### Fixes

- {PR title} (#{PR number}) by @{author}

### Refactors

- ...

### Docs

- ...

### Infra

- ...
```

**ASK:** "Changelog preview above. Confirm? (yes / edit / abort)"

---

### Step 3: Quality Verification

Run (adapt to project):

```bash
npm run lint && npm run typecheck && npm run test
```

- **All must pass.** If any fail, **STOP** and report the failure.
- Do not proceed to the version bump until all checks pass.

**ASK:** "Quality checks passed. Proceed to version bump? (yes / abort)"

---

### Step 4: Version Bump

1. Update `version` in `package.json` to the confirmed version.
2. If `functions/package.json` exists and tracks version, update it to the same version.
3. If other workspace packages track version, update them as needed.

**ASK:** "Version bump applied. Proceed to commit and tag? (yes / abort)"

---

### Step 5: Stage Changes

```bash
git add package.json
```

If other `package.json` files were changed:

```bash
git add functions/package.json
# or other workspace packages
```

Commit:

```bash
git commit -m "chore: release v{version}"
```

**ASK:** "Commit created. Proceed to create tag? (yes / abort)"

---

### Step 6: Create Git Tag

```bash
git tag v{version}
```

- If tag already exists: **WARN** and **ASK** "Tag v{version} already exists. (a) abort, (b) delete and recreate (requires force), (c) use different version"
- If user chooses (b): `git tag -d v{version}` then `git tag v{version}`. Note: pushing will require `--force` for tags.

**ASK:** "Tag created. Proceed to push? (yes / abort)"

---

### Step 7: Push

Use `{base}` = `board.defaultBranch` from `/.agents/hatch.json` (fallback: `"main"`).

```bash
git push origin {base} && git push origin v{version}
```

- If push fails: **STOP** and provide manual instructions:
  - `git push origin {base}`
  - `git push origin v{version}`

**ASK:** "Push complete. Proceed to create GitHub release? (yes / abort)"

---

### Step 8: Create GitHub Release

GitHub releases are outside the MCP catalog. Use `gh` CLI:

```bash
gh release create v{version} --title "v{version}" --notes "{changelog}"
```

- Use the confirmed changelog from Step 2. Escape any special characters in the notes for the shell.
- If `gh` is unavailable: provide manual instructions for creating the release via GitHub web UI.

**ASK:** "GitHub release created. Proceed to deploy verification? (yes / abort)"

---

### Step 9: Deploy Verification

**ASK:** "Deploy to production now? (yes / manual later)"

If **yes**:

- Provide deploy commands appropriate to the project. Examples:
  - Static hosting: `npm run deploy` or `vercel --prod` or similar
  - Serverless: `npm run deploy:functions` or equivalent
  - Docker: `docker build` and push to registry
  - Generic: "Run your project's deploy script (e.g., `npm run deploy`, CI/CD pipeline trigger)"

If **manual later**:

- Remind user to run deploy commands when ready.

---

### Step 10: Post-Release

1. Remind user to **monitor for 24h** after deployment.
2. Suggest creating a monitoring issue if the project has incident response processes.
3. Optionally: create a monitoring issue via `issue_write` with labels `type:infra`, `status:in-progress`, `executor:human`, title "Post-release monitoring: v{version}".

---

## Pre-Release Support

For pre-release versions (alpha, beta, release candidate):

### Version Format
- Alpha: `x.y.z-alpha.N` (e.g., `1.2.0-alpha.1`)
- Beta: `x.y.z-beta.N` (e.g., `1.2.0-beta.1`)
- Release Candidate: `x.y.z-rc.N` (e.g., `1.2.0-rc.1`)

### Pre-Release Workflow
1. **Tag**: Create pre-release tag (e.g., `v1.2.0-beta.1`)
2. **Publish**: Publish to npm with `--tag` flag (`npm publish --tag beta`)
3. **Validate**: Run smoke tests against pre-release package
4. **Promote**: When ready, publish stable version without pre-release suffix
5. **Clean up**: Deprecate pre-release versions after stable release

### npm Distribution Tags
- `latest` — stable releases only (default install)
- `beta` — beta pre-releases (`npm install package@beta`)
- `next` — release candidates (`npm install package@next`)
- `alpha` — alpha pre-releases

### Pre-Release in Step 1

When the user requests a pre-release, modify version determination:

**ASK:** "Pre-release type? (alpha / beta / rc). Current pre-release count for this version will be auto-incremented."

The proposed version becomes `{base}-{type}.{N}` where `N` is the next sequential number for that type/base combination. GitHub releases created for pre-releases use the `--prerelease` flag:

```bash
gh release create v{version} --title "v{version}" --notes "{changelog}" --prerelease
```

---

## CHANGELOG Management

### Auto-Generation
1. Parse conventional commits since last release tag
2. Group by type: Features, Bug Fixes, Breaking Changes, Performance, Documentation
3. Include PR references and contributor attribution
4. Generate entry under `## [x.y.z] - YYYY-MM-DD`

### Format
Follow Keep a Changelog format:
- `### Added` — new features
- `### Changed` — changes to existing functionality
- `### Deprecated` — soon-to-be removed features
- `### Removed` — removed features
- `### Fixed` — bug fixes
- `### Security` — vulnerability fixes

### Workflow Integration
- CHANGELOG entry generated as part of release PR
- User reviews and approves CHANGELOG before merge
- CHANGELOG committed alongside version bump

### Integration with Step 2

The changelog generated in Step 2 should also be written to `CHANGELOG.md` at the project root. If `CHANGELOG.md` exists, prepend the new entry after the file header. If it doesn't exist, create it with a standard header:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [x.y.z] - YYYY-MM-DD
...
```

In Step 5, stage `CHANGELOG.md` alongside `package.json`:

```bash
git add package.json CHANGELOG.md
```

---

## Rollback Procedure

If a release introduces critical issues:

### npm Rollback
1. **Deprecate**: `npm deprecate package@version "Critical issue — use version X instead"`
2. **Unpublish** (within 72h): `npm unpublish package@version` (only if within npm's unpublish window)
3. **Publish hotfix**: Increment patch version with fix, publish as new release

### Git Rollback
1. **Revert commit**: Create revert commit on default branch (`board.defaultBranch` or `main`)
2. **Tag hotfix**: Tag new patch version
3. **Trigger release**: Push tag to trigger release workflow

### Communication
- Update CHANGELOG with rollback notice
- Create GitHub issue documenting the incident
- Notify users via release notes / discussions

### Rollback in Post-Release (Step 10)

Add to the post-release step:

**ASK:** "If critical issues are found during monitoring, do you want me to initiate rollback? (yes / no — I'll handle manually)"

If yes, execute the rollback procedure above. Always create a GitHub issue documenting the incident regardless of rollback method.

---

## Error Handling

- **Quality gate failure:** Stop release. Report failure. Do not proceed to version bump. User must fix and re-run.
- **Tag collision:** Warn and ask user (abort / delete and recreate / use different version).
- **Push failure:** Provide manual instructions. Do not force push.
- **`gh release create` failure:** Provide manual instructions. Do not skip the release.
- **Pre-release version conflict:** If pre-release tag already exists, increment the pre-release number automatically.
- **CHANGELOG parse failure:** If `CHANGELOG.md` has unexpected format, append entry at the top and warn user to verify.
- **Rollback failure:** Provide manual rollback instructions. Never force-unpublish without explicit user confirmation.

---

## Guardrails

- **Never release with failing tests.** Quality verification must pass before any version bump.
- **Never skip changelog.** Every release must have a changelog entry and `CHANGELOG.md` must be updated.
- **Never force push tags** unless user explicitly requested deletion and recreation.
- **Always create a GitHub release with notes.** Do not skip release creation.
- **Pre-releases must use `--prerelease` flag** on GitHub releases and `--tag` on npm publish.
- **Never auto-rollback without user confirmation.** Always ASK before initiating rollback.
- **Never unpublish from npm without explicit confirmation.** Prefer deprecation over unpublish.
- **ASK at every checkpoint.** Do not proceed without user confirmation.
