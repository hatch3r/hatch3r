---
name: h4tcher-release-prep
description: Prepare a hatch3r release — version bump, changelog completeness + sync, repo + website docs currency, quality gates, adapter output verification, and release-notes reconciliation with CI.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

> Last updated: 2026-05-29

# Release Prep

Prepare a hatch3r framework release with full quality gates. The dev runs Steps 1-10 locally; CI (`.github/workflows/release.yml`) re-runs the publish-critical subset and extracts the `CHANGELOG.md` section authored here as the GitHub release body.

## Step 0: P8 B1 Ambiguity Gate

Before any version bump or write, scan the release intent against the four B1 triggers from `.claude/rules/clarification-default.md` (verbatim directive from `governance/CONSTITUTION.md` §2 P8 B1):

1. **Ambiguous scope** — release line unclear (patch vs minor vs major); breaking-change scope undeclared; whether website + plugin manifests bump in lock-step.
2. **Multiple valid interpretations** — release notes grouping (Adapters/Content/CLI/Governance/Dependencies/Chore) when a PR could land in two groups; whether to roll up multiple unreleased patch PRs into a minor.
3. **Irreversible action** — `npm publish`, force-push of a tag, force-push to main, marketplace re-submission with a public manifest change.
4. **Missing acceptance criteria** — CHANGELOG section header absent or version-mismatched; orphan PRs missing from the new section; lockfile or audit gate failing without owner assignment.

If any trigger fires, ask via the platform-native question tool per `agents/shared/user-question-protocol.md`: one question per turn; bundle related sub-questions into a single multiple-choice prompt; 2-4 numbered options with one-line trade-offs; declare the default-if-no-response option. Do NOT proceed to Step 1 until the ambiguity is resolved or the user has confirmed the default. This block subsumes the ad-hoc Step 9.31 "Confirm with user before pushing" prompt.

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

15. Verify all 3 supported adapters (claude, cursor, copilot) are registered in `src/adapters/index.ts` (count tracked dynamically at `governance/inventory.json::counts.adapters` — auto-derived per CONSTITUTION §6 Decision 12)
16. Verify `ADAPTER_CAPABILITIES` matrix is complete (no undefined entries)
17. Check that `package.json` `files` array includes all content directories:
    - `agents/`, `checks/`, `commands/`, `rules/`, `skills/`, `prompts/`, `github-agents/`, `mcp/`, `hooks/`

## Step 5: Lockfile & Supply Chain

18. Verify lockfile integrity: `npx lockfile-lint --type npm --allowed-schemes https: --path package-lock.json`
19. Run security audit: `npm audit --audit-level=moderate --omit=dev` (aligned with `.github/workflows/release.yml` — local stricter than CI is fine; never looser)

## Step 6: Changelog + PR Completeness

20. Generate CHANGELOG entries grouped by: Adapters, Content, CLI, Governance, Dependencies, Chore
21. Verify the new section header matches `package.json` version exactly: `## [{version}] - {YYYY-MM-DD}` (Keep-a-Changelog format — required by Step 9 CI extraction)
22. **PR-completeness probe (gate).** Every merged PR since the last tag MUST appear in the new CHANGELOG section by its `#NNN` reference, or be explicitly classified as `Chore` and noted as omitted with rationale. Detect orphans:
    ```bash
    LAST=$(git describe --tags --abbrev=0)
    git log "$LAST"..HEAD --merges --pretty=format:"%s" | grep -oE "#[0-9]+" | sort -u > /tmp/prs-merged.txt
    awk '/^## \[/{n++} n==1' CHANGELOG.md | grep -oE "#[0-9]+" | sort -u > /tmp/prs-changelog.txt
    diff /tmp/prs-merged.txt /tmp/prs-changelog.txt
    ```
    Any line in `prs-merged.txt` not present in `prs-changelog.txt` is an orphan PR. STOP and add the entry (or document the Chore omission inline) before proceeding.
23. Prepend the new section to `CHANGELOG.md` directly after the file header. Stage with `git add CHANGELOG.md`.

## Step 7: Repo Docs Currency

24. **Adapter capability matrix** (`docs/adapter-capability-matrix.md`) MUST reflect current `ADAPTER_CAPABILITIES` in `src/adapters/index.ts`. Spot-check that every column key from the source object appears as a row/column in the matrix; new capabilities added this cycle that are missing from the matrix are a blocker.
25. **Feature-surface grep**: any command/adapter/skill renamed or removed in this release MUST NOT appear by old name in `README.md`, `docs/mcp-setup.md`, `docs/troubleshooting.md`, `docs/marketplace-submission.md`. Grep each for the removed names; zero hits required.
26. Re-run `npm run inventory:check-docs` after CHANGELOG and docs edits — must still report 0 drift.

## Step 8: Website Build & Sync (`website/`)

The canonical Docusaurus site lives in `website/` and deploys to `docs.hatch3r.com` via `.github/workflows/deploy-docs.yml` on push to main. `onBrokenLinks: 'throw'` in `website/docusaurus.config.ts` means broken links fail the build.

27. Build the website locally to catch broken links before tagging:
    ```bash
    cd website && npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build && cd ..
    ```
    0 errors required.
28. **Inventory parity.** For any new command/adapter/skill since the last tag, verify a corresponding `website/docs/**/*.md` page exists or is updated. Compare `governance/inventory.json` `counts` against the sidebar groupings in `website/sidebars.ts` and the page set in `website/docs/`.
29. If `website/` has unstaged edits, commit them alongside the release (`docs(website): sync to v{version}`).

## Step 9: Tag & Release Notes

30. Create annotated git tag:
    ```bash
    git tag -a v{version} -m "hatch3r v{version}"
    ```
31. **Confirm with user before pushing.** On push, CI runs `.github/workflows/release.yml` which:
    - Re-validates tag version == `package.json` version
    - Re-runs `npm ci`, build, test, `npm audit --audit-level=moderate --omit=dev`
    - Publishes to npm with provenance
    - Extracts the new `CHANGELOG.md` section (matching `v{version}`) and passes it as the GitHub release body via `body_path`
32. If the CHANGELOG section is missing or malformed for the tag version, the CI release step fails — fix `CHANGELOG.md`, retag, and force-push the tag only with explicit user approval.

## Step 10: Post-Release Verification

33. After CI green, verify:
    - npm package is published at the expected version: `npm view hatch3r@{version} version`
    - GitHub release exists and body matches the CHANGELOG section: `gh release view v{version}`
    - Docs site rebuilt with the new version (deploy-docs workflow ran on the merge commit): https://docs.hatch3r.com
