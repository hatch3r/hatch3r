---
id: hatch3r-release
name: hatch3r-release
type: skill
description: Cut a release with version bump, changelog, tagging, and deploy verification. Use when preparing a release, cutting a version, or deploying to production.
tags: [devops]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
> **Note:** Commands below use `npm` as an example. Substitute with your project's package manager (`yarn`, `pnpm`, `bun`) or build tool when your project uses a different package manager.

# Release Workflow

## Relationship to `commands/hatch3r-release.md` (Decision 13 handoff)

This skill shares the `id: hatch3r-release` with the orchestrator command `commands/hatch3r-release.md`. The two are NOT duplicates — they split the release workflow by execution model per CONSTITUTION §6 Decision 13:

- **`commands/hatch3r-release.md` (orchestrator entry):** the multi-agent release pipeline — implementer applies the version-bump + changelog + SBOM mutations, docs-writer reconciles repo/website docs, a reviewer↔fixer loop verifies the diff, testability + security run the final-quality pass, ci-watcher diagnoses red gates (`agentPipeline: [hatch3r-implementer, hatch3r-docs-writer, hatch3r-reviewer, hatch3r-fixer, hatch3r-testability, hatch3r-security, hatch3r-ci-watcher]`). Use the command when the release warrants sub-agent fan-out (parallel mutation + review-loop + specialist gates) and stops before publish/merge for human approval.
- **This skill (inline procedure):** the single-pass reference body the command's implementer and docs-writer stages follow for the bump → changelog → quality-gate → tag → supply-chain → deploy sequence. Use the skill directly for a Tier 1 single-maintainer patch release where no fan-out is needed, OR as the step-by-step procedure cited inside the command's mutation stages.
- **Unique to this skill:** Step 5b (CycloneDX SBOM + npm provenance + SLSA L3 + cosign wiring, with solo/team maturity gating) and the Rollback Procedure are the inline-procedure detail the command references rather than restates.

The merge-candidate review (F16.3-H3) flagged the shared id; this handoff documentation is the explicit workflow-split declaration that disambiguates the pair, enforced by the Decision-13 command↔skill gate in `src/cli/commands/validate.ts`. A future collapse into a single command appendix requires coordinated edits to the command body, the bundled content inventory (skills count), and that gate.

**Irreversibility alignment (D10-14):** the command and this skill now share the same stop-before-irreversible boundary, so `/release` resolving to either artifact is safe. The command stops at its Step 9 before publish/merge; this skill's Irreversibility Gate makes every irreversible step (tag push, publish, production deploy) default-OFF behind `--publish` or a typed confirmation. Neither artifact auto-publishes or auto-deploys on a bare invocation — the prior mismatch (a stop-before-publish command vs an auto-publish+deploy skill at one slash name) is closed.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Determine version bump (major/minor/patch) based on changes
- [ ] Step 2: Generate changelog from merged PRs and commit history
- [ ] Step 3: Update version in package.json and any other version references
- [ ] Step 4: Verify quality gates (lint, typecheck, all tests)
- [ ] Step 5: Create git tag and platform release with changelog
- [ ] Step 5b: Generate supply-chain artifacts (SBOM + provenance + SLSA + cosign)
- [ ] Step 6: Deploy and verify (staging first if applicable, then production)
- [ ] Step 7: Monitor post-deploy for errors/regressions
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: bump level (major vs minor vs patch), deploy authority (cut-only vs deploy-and-monitor), staging gate (required vs skipped), rollback policy (auto vs manual), and irreversible tag/publish operations (npm publish, GitHub release).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Irreversibility Gate (irreversible steps default-OFF)

This skill drives irreversible publish/deploy actions — `git push`, `gh release create` / `glab release create`, `npm publish --provenance`, and production deploy. Each is a one-way door: a published npm version cannot be re-published, a pushed tag and a created release are public immediately. Reversibility-first: every irreversible step is **default-OFF** and requires explicit operator confirmation before it runs. The default path produces and verifies the artifacts, then **stops before the irreversible action** and asks.

| Step | Action | Default | Run-trigger |
|------|--------|---------|-------------|
| 5 | `git push origin vX.Y.Z` + platform release create | OFF | `--publish` flag OR operator types the target version `vX.Y.Z` at the confirm prompt |
| 5b.2 | `npm publish --provenance` | OFF | same `--publish`/typed-version trigger as Step 5; runs in CI on the human-pushed tag (no local publish) |
| 6 | Deploy to production | OFF | operator types `DEPLOY` at the confirm prompt after staging smoke tests pass |

Rules:
- **No silent auto-publish.** Invoking this skill (`/release`, or as the inline procedure inside `commands/hatch3r-release.md`) without `--publish` runs Steps 0-4 + 5b.1/5b.3-5b.6 artifact emission, then prints the staged release summary and the exact publish/deploy commands, and stops. The operator runs the gated step or re-invokes with `--publish`.
- **Typed confirmation matches the target.** A free-text "yes" is insufficient for Steps 5/5b.2/6 — the operator types the literal token (`vX.Y.Z` for publish, `DEPLOY` for production) so a reflexive confirmation cannot trigger an irreversible action.
- **Fail-closed.** No response, an empty response, or a token mismatch leaves the irreversible step un-run and the release un-published. Prefer deprecation over unpublish in Rollback.
- For a delegated release, the orchestrator command `commands/hatch3r-release.md` enforces the same stop-before-publish boundary at its Step 9 — this skill's gate is the inline-procedure equivalent of that handoff.

## Step 1: Determine Version Bump

- Review changes since last release: merged PRs/MRs, commit history.
- List merged PRs/MRs since last tag using the platform tools (check `platform` in `.hatch3r/hatch.json`):
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
${HATCH3R:VERIFY_GATE_ALL}
npm run build
```

The gate line is resolved to the project's language-aware command set at sync time (fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`); the build line is illustrative — substitute the project's build command.

- All tests pass (unit, integration, E2E).
- Bundle size within budget (if defined).
- Security rules tests pass if rules changed.
- No TODO without linked issue.
- See project quality documentation for full pre-release gates.

## Step 5: Create Tag and Release

Tag-push and release-create are irreversible (default-OFF per the Irreversibility Gate). Create the annotated tag locally, then **stop and confirm** before pushing it or creating the public release. Run the push + release-create only with `--publish` or after the operator types the target `vX.Y.Z` at the confirm prompt.

- Create annotated tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"` (local, reversible — delete with `git tag -d vX.Y.Z`).
- **Confirm gate (irreversible from here):** push tag: `git push origin vX.Y.Z`.
- Create the release using the platform CLI (check `platform` in `.hatch3r/hatch.json`):
  - **GitHub:** `gh release create vX.Y.Z --title "vX.Y.Z" --notes "{changelog}"` (or use **GitHub MCP** if available)
  - **Azure DevOps:** `az repos tag create vX.Y.Z` — attach release notes as a wiki page or work item, and upload build artifacts via Azure Artifacts
  - **GitLab:** `glab release create vX.Y.Z --name "vX.Y.Z" --notes "{changelog}"`
- Attach build artifacts if applicable.

## Step 5b: Generate Supply-Chain Artifacts

F15.8-H4 (Cycle 10 D15-SA15.8): every release surface MUST emit an SBOM + provenance + SLSA attestation + container signature before deploy. Skipping these produces un-attested artifacts that fail consumer-side `npm audit signatures` and SLSA-Build-L3 verification.

Maturity-tier gating (per the P5 maturity-tier model — solo/team/scaleup/enterprise; see `agents/shared/principles.md`):
- `solo` — MAY defer SBOM emission and SLSA generator for a single-maintainer release. Provenance (`--provenance` flag below) and `cosign` for any container image remain mandatory.
- `team`, `scaleup`, `enterprise` — MUST execute every sub-step below; consumer verification depends on these artifacts being present.

### 5b.1 — Emit CycloneDX SBOM (npm packages)

```
npm sbom --sbom-format=cyclonedx --sbom-type=application > dist/sbom.cdx.json
```

Attach `dist/sbom.cdx.json` to the GitHub release. Reference: `npm sbom` (npm CLI >=10.5.0) emits CycloneDX 1.5 or SPDX 2.3.

### 5b.2 — npm provenance via Trusted Publishing (OIDC)

Configure Trusted Publisher once on the npm settings page, then publish via GitHub Actions only:

```yaml
permissions:
  id-token: write   # OIDC token for Sigstore signing
  contents: read
steps:
  - run: npm publish --provenance --access public
```

`--provenance` emits a Sigstore-signed attestation through Fulcio + Rekor. Reference: https://docs.npmjs.com/trusted-publishers/ (accessed 2026-05-27). Publish is irreversible (default-OFF per the Irreversibility Gate): it fires from CI only on the human-pushed Step 5 tag — there is no local `npm publish` on the default path.

### 5b.3 — SLSA Build Level 3 attestation

Pin the slsa-github-generator action by 40-character commit SHA — never a tag:

```yaml
uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@<40-char-SHA>
with:
  base64-subjects: ${{ needs.publish.outputs.digest }}
  upload-assets: true
```

Reference: https://github.com/slsa-framework/slsa-github-generator.

### 5b.4 — Container image signing (cosign keyless)

When the release ships a container image:

```
cosign sign --yes \
  --oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/<owner>/<image>@<digest>
```

Reference: https://github.com/sigstore/cosign (cosign 2.x keyless flow).

### 5b.5 — Consumer verification snippet

Document the verification commands in the release notes:

```
npm audit signatures
slsa-verifier verify-artifact --provenance-path attestation.intoto.jsonl --source-uri github.com/<owner>/<repo> --source-tag <tag> <artifact-file>
cosign verify --certificate-identity-regexp 'https://github\.com/<owner>/<repo>/' --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/<owner>/<image>:<tag>
```

### 5b.6 — Mark gates satisfied

- [ ] `dist/sbom.cdx.json` attached to platform release
- [ ] `npm publish --provenance` exit 0; `npm view <pkg>@<version> --json | jq .dist.signatures` returns a signature
- [ ] SLSA attestation uploaded; `slsa-verifier verify-artifact` exit 0
- [ ] Container image signed (when applicable); `cosign verify` exit 0
- [ ] Verification snippet copied into the release notes

## Step 6: Deploy and Verify

Production deploy is irreversible (default-OFF per the Irreversibility Gate). Staging is reversible and runs on the default path; the production step **stops and confirms** (operator types `DEPLOY`) only after staging smoke tests pass.

- Deploy to staging first (if applicable). Run smoke tests.
- **Confirm gate (irreversible):** deploy to production (project-specific pipeline) only after the typed `DEPLOY` confirmation or `--publish`.
- Verify: health check, key flows.
- Document deploy method and environment in project docs if not already.

## Step 7: Monitor Post-Deploy

- Monitor error rate (target per project SLO).
- Monitor function/API error rate.
- Check for startup time regression.
- Watch user-reported issues for first 24h.
- If errors spike: rollback and investigate.

## Pre-Release Support

Version formats: alpha (`x.y.z-alpha.N`), beta (`x.y.z-beta.N`), release candidate (`x.y.z-rc.N`). Workflow:

1. Tag pre-release (e.g., `v1.2.0-beta.1`).
2. Publish to npm with `--tag` (`npm publish --tag beta`) — irreversible, same default-OFF gate as Step 5b.2 (publish via CI on the pushed pre-release tag).
3. Smoke-test against the pre-release package.
4. Promote: publish stable without pre-release suffix.
5. Deprecate pre-release versions after stable release.

npm distribution tags: `latest` (stable), `beta`, `next` (RCs), `alpha`. GitHub releases for pre-releases use `--prerelease`.

## CHANGELOG.md Format

Follow Keep a Changelog:
- `### Added` — new features
- `### Changed` — changes to existing functionality
- `### Deprecated` — soon-to-be removed
- `### Removed` — removed features
- `### Fixed` — bug fixes
- `### Security` — vulnerability fixes

Entries grouped under `## [x.y.z] - YYYY-MM-DD`. Generate entry as part of the release commit; stage `CHANGELOG.md` alongside `package.json`. If `CHANGELOG.md` does not exist, create it with the standard header pointing to keepachangelog.com and semver.org.

## Rollback Procedure

If a release introduces critical issues:

- **npm:** `npm deprecate package@version "Critical issue — use version X instead"`. Within 72h, `npm unpublish package@version` is permitted (only inside npm's unpublish window). Publish a hotfix as a new patch release.
- **Git:** create a revert commit on the default branch, tag a new patch version, push to trigger the release workflow.
- **Communication:** update CHANGELOG with rollback notice, open a post-mortem issue, notify users via release notes/discussions.
- Always create a tracking issue documenting the incident. Never auto-rollback or auto-unpublish without explicit user confirmation; prefer deprecation over unpublish.

## Error Handling

- **Quality gates fail during release preparation**: Do not proceed with the release. Fix the failing gate (test failures, lint errors, type errors), re-run all gates, and restart the release process.
- **Git tag already exists for the target version**: Check whether the existing tag points to the correct commit. If it was created in error, delete and recreate it. If it was a previous release attempt, bump the version and start over.
- **Post-deploy monitoring detects regressions**: Execute the rollback plan immediately. Document the regression in a post-mortem issue and block the next release until the regression is fixed.

## Definition of Done

- [ ] Version bumped in package.json
- [ ] Changelog generated and included in release
- [ ] Each irreversible step (tag push, publish, production deploy) ran only after `--publish` or its typed confirmation (Irreversibility Gate) — never silently
- [ ] Git tag created and pushed
- [ ] Release published with changelog (GitHub Release / ADO wiki + tag / GitLab Release)
- [ ] Supply-chain artifacts emitted (SBOM + npm provenance + SLSA + cosign per Step 5b; solo MAY defer SBOM + SLSA, team+ MUST execute all)
- [ ] Deployed to production and verified
- [ ] Post-deploy monitoring completed (no critical regressions)
- [ ] All release gates satisfied

## References

- [Semantic Versioning 2.0.0](https://semver.org/) — accessed 2026-05-31, official-docs (Tom Preston-Werner / SemVer). Source for the MAJOR.MINOR.PATCH bump rules and the pre-release suffix grammar (`-alpha.N`, `-beta.N`, `-rc.N`) in Step 3 and Pre-Release Support.
- [npm sbom — npm CLI docs](https://docs.npmjs.com/cli/v10/commands/npm-sbom) — accessed 2026-05-31, official-docs (npm, Inc.). Source for the `npm sbom` CycloneDX 1.5 / SPDX 2.3 output and the >=10.5.0 CLI floor cited in the supply-chain step (5b).
