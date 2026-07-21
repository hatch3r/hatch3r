---
id: hatch3r-release
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-docs-writer, hatch3r-reviewer, hatch3r-fixer, hatch3r-testability, hatch3r-security, hatch3r-ci-watcher]
description: Release-workflow orchestrator — preflight, SemVer bump, changelog sync, build + CycloneDX SBOM, adapter-output verification, quality gates, release-notes reconciliation, then stop before publish/merge for human approval.
disable-model-invocation: true
tags: [devops, board, review]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
plan_gate: true
sub_agents_spawned:
  count: 7
  rationale: Per-release fanout — implementer applies the version-bump + changelog + SBOM mutations and docs-writer reconciles repo/website docs (parallel, disjoint files); reviewer ↔ fixer review loop verifies the release diff (max 3 iterations); testability (CQ5) and security (CQ3) run the mandatory final-quality pass in parallel; ci-watcher diagnoses any red gate. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

Before any version bump or write, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts. If any are found, ask via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Release-specific triggers (per `rules/hatch3r-clarification-default.md`):

- **Ambiguous scope** — release line unclear (patch vs minor vs major per SemVer §below); breaking-adapter-contract scope undeclared; whether `.claude-plugin/plugin.json` + `docs/marketplace-submission.md` manifests bump in lock-step.
- **Multiple valid interpretations** — changelog grouping (Added / Changed / Deprecated / Removed / Fixed / Security) when a PR could land in two groups; whether to roll up multiple unreleased patch PRs into one minor.
- **Irreversible action** — `npm publish`, tag force-push, force-push to `main`, marketplace re-submission with a public manifest change. These are NEVER taken by this command (Step 9 stops before them).
- **Missing acceptance criteria** — CHANGELOG section header absent or version-mismatched; orphan PRs missing from the new section; lockfile or `npm audit` gate failing without an owner.

Acceptable to proceed without asking ONLY when the release line is unambiguous, the changelog target section is named, and the brief alone is testable. Any residual ambiguity discovered mid-run re-invokes the same protocol.

---

# Release -- Cut-and-Verify Orchestrator (Stops Before Publish)

Orchestrates a hatch3r framework release end-to-end on a release branch: preflight, SemVer bump, changelog completeness + sync, build + CycloneDX SBOM emission, adapter-output verification, quality gates, release-notes reconciliation, then **stops before publish/merge** for human approval. Mutating sub-steps are delegated to pipeline sub-agents via the Task tool — the orchestrator never edits release files inline.

This command is the delegating orchestrator around the single-pass `/h4tcher-release-prep` skill (`.claude/skills/h4tcher-release-prep/SKILL.md`): the skill documents the local 10-step gate procedure; this command spawns sub-agents to execute the mutating steps, runs the reviewer ↔ fixer loop on the release diff, and emits the delegation attestation. Use the skill for a fast solo dev-run; use this command when you want delegated execution with the review-loop + final-quality gate and the bypass-protection attestation.

---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Preflight | Orchestrator (inline, read-only `git status` / branch check) | No | Yes |
| 2. Version bump (SemVer) | `hatch3r-implementer` | No | Yes |
| 3. Changelog completeness + sync | `hatch3r-implementer` | No | Yes |
| 4. Build + SBOM (CycloneDX) | `hatch3r-implementer` (build script + SBOM emission), `hatch3r-ci-watcher` (diagnose red build) | No | Yes |
| 5. Adapter-output verification | Orchestrator (inline, read-only `hatch3r verify`) | No | Yes |
| 6. Quality gates | Orchestrator (inline gate runs); `hatch3r-ci-watcher` diagnoses failures | No | Yes |
| 7a. Review loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential loop) | When release diff is non-trivial (Tier 2/3) |
| 7b. Final quality — mandatory | `hatch3r-testability`, `hatch3r-security` | Yes | When code changed |
| 7c. Final quality — docs | `hatch3r-docs-writer` | Yes (parallel with 7b) | When APIs / adapters / CLI surface changed |
| 8. Release-notes reconciliation | Orchestrator (inline, compares CHANGELOG section ↔ CI extraction contract) | No | Yes |
| 9. Marketplace-lane handoff (STOP before publish/merge) | Orchestrator (inline, presents the human-approval gate) | No | Yes |
| 10. Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above (Step 7b testability + security; Step 7c docs-writer alongside 7b) holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state. Step 2 (version bump) and Step 3 (changelog) serialize on a dependency edge: the changelog header must match the bumped `package.json` version, so version-bump precedes changelog.

---

## Shared Context

If board context exists (`.hatch3r/hatch.json` present), read the `hatch3r-board-shared` skill at run start and cache `board.platform`, `board.owner`, `board.repo`, and `board.defaultBranch`. If absent, fall back to GitHub and proceed — the release flow runs on any repo where `gh auth login` is complete.

Read the `/h4tcher-release-prep` skill (`.claude/skills/h4tcher-release-prep/SKILL.md`) once at run start; cache its 10-step procedure and pass the relevant step text into the Step 2/3/4 implementer prompts so the sub-agent executes the exact documented commands without re-reading the skill.

## Global Rule Overrides

- **Git commands are permitted** for read-only inspection (Step 1: `git status`, `git branch --show-current`, `git describe --tags`, `git log`) and for staging the release commit on the **release branch** in Step 9 (`git add`, `git commit -s`). This override applies to delegated sub-agents.
- **`npm publish`, `git push --force`, `git push` to `board.defaultBranch`, tag force-push, and any marketplace write are forbidden in every step.** Step 9 stops before them and hands off to the human. See Guardrails.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents carry the `quality_charter: agents/shared/quality-charter.md` reference, but the orchestrator repeats the directive to override runtime prompt defaults per charter §1.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every gate verdict, the review-loop verdict, and the Step 9 release-readiness assessment MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## SemVer Decision Table (SemVer 2.0.0)

Pick the release line per the SemVer 2.0.0 increment rules (`https://semver.org/`, accessed 2026-06-02):

| Increment | Trigger in hatch3r terms |
|-----------|--------------------------|
| **MAJOR** (`X+1.0.0`) | Incompatible API change — breaking adapter contract change, breaking canonical content-format change, removed CLI command or public artifact id. |
| **MINOR** (`X.Y+1.0`) | Backward-compatible functionality — new adapter, new content type, new CLI command, new artifact, or a deprecation (the feature still works). |
| **PATCH** (`X.Y.Z+1`) | Backward-compatible bug fix, documentation update, dependency bump that changes no public surface. |

A MAJOR bump is an irreversible-scope decision — route it through the §0 B1 gate before Step 2 even when the user named a version.

---

## Workflow

Execute these steps in order. **Do not skip any step.** The only ASK gates are §0 (ambiguity), the Step 1.5 plan gate (Tier >= 2), the SemVer-line confirmation in Step 2a, and the human-approval handoff in Step 9. For every ASK, use the platform-native question tool per `agents/shared/user-question-protocol.md`.

---

## Step 0: Triage

Classify the release before delegating:

- **Tier 1** (patch — docs/dependency/single bug fix, no public-surface change): reduced pipeline — Steps 1-6, skip the Step 7a review loop, still run Step 7b mandatory specialists (sole exception: the criteria-gated Tier-1 relaxation, `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria), Steps 8-10.
- **Tier 2** (minor — new content/CLI/adapter, no breaking change): standard pipeline — Steps 1-6, 7a (review loop, max 3 iterations), 7b mandatory + 7c when triggered, Steps 8-10.
- **Tier 3** (major OR any breaking adapter/canonical-format change OR cross-cutting release): full pipeline + an explicit breaking-change migration-note check in Step 3 and a release-readiness assessment in Step 9.

Emit the mandatory tier-rationale line before delegating — `tier: <1|2|3> — <signal summary>` per `agents/shared/triage-vocabulary.md` → Auto-tiering inputs (absent signals select Tier 2 — Standard, never Deep); the selected tier's phase depth follows the same file's Pipeline pruning per tier table.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 2), emit the cost preview per `rules/hatch3r-iteration-summary.md` Pre-Execution Cost Preview and `rules/hatch3r-cost-visibility.md`, calibrated to the Step 0 tier:

```yaml
cost_preview:
  expected_sa_count: <tier → Tier 1 ~3, Tier 2 ~6, Tier 3 up to 7>
  estimated_input_tokens_static_frame: <int>
  triage_tier: 1 | 2 | 3
  web_research_budget: <int queries, 0 if none>
  estimated_duration_min: <int>
```

Post-execution actuals + `delta_percent` land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

### Effort Override (Decision 17)

`--effort=light|standard|deep` forces the named tier (light → Tier 1, standard → Tier 2, deep → Tier 3), bypassing Step 0 auto-classification. The override wins over the auto-detected tier; record both so the cost block reports the budget delta. The override never suppresses a Safety Guardrail — a `--effort=light` run that turns out to carry a breaking change still runs the Tier-3 migration-note check and release-readiness assessment. Safety dominates the cost override.

---

## Step 1: Preflight (read-only)

Establish a clean, branch-correct starting state. All commands here are read-only.

1. **Clean tree:** `git status --porcelain`. A non-empty result halts with the actionable error below (P1 actionable-error contract):

   ```
   Working tree is not clean — release requires a clean tree.

   Commit or stash your changes first:
     git stash            # set aside, restore after release
     git status           # review what is uncommitted
   ```

   Exit code 2 (usage error).

2. **Branch policy:** `git branch --show-current`. Per the repo's commit conventions (no force-push to `main`; feature branches only) and its release norm, the release commit lands on a `release/X.Y.Z` branch — never on `board.defaultBranch`. If the current branch equals `board.defaultBranch` (fallback `main`), halt with:

   ```
   On the default branch '{defaultBranch}'. Releases run on a release branch.

   Cut one first:
     git switch -c release/{intended-version}
   ```

   Exit code 2. If already on a `release/*` branch, proceed.

3. **Last tag + change set:** `git describe --tags --abbrev=0` for the prior tag; `git log {lastTag}..HEAD --oneline` for the change set feeding the SemVer decision and the changelog completeness probe. Cache both.

---

## Step 1.5: In-Session Plan Gate (Tier >= 2)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: artifact = the release plan — proposed target version (SemVer Decision Table over the cached change set), changelog scope (`{lastTag}..HEAD`), and the Step 4–8 gate list; slug version-free (`docs/plans/{YYYY-MM-DD}-release.md`) — the proposed target version is stated in the artifact body pending Step 2a confirmation, and a Step 2a version change updates the body via the gate's revise path (re-persist); gated dispatch = Step 2b implementer bump; revise returns to Step 1.5 synthesis; no unattended flag — Step 9 stops before publish/merge regardless. Tier-1 patch bumps are exempt (Tier < 2 skips artifact persistence per the frame).

---

## Step 2: Version Bump (SemVer) — delegated

#### 2a. Resolve the release line

Apply the SemVer Decision Table above to the cached change set. **ASK** to confirm: "Change set since `{lastTag}` indicates a **{MAJOR|MINOR|PATCH}** release → `{X.Y.Z}`. Proceed with this version? (yes / choose a different line / let me set it explicitly)". A MAJOR line always asks (irreversible-scope, §0 B1). Default-if-no-response: the auto-derived line.

#### 2b. Delegate the bump

Spawn one `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Do NOT edit version files inline. The prompt MUST include the `/h4tcher-release-prep` Step 2 procedure (cached at run start) plus:

- Target version `{X.Y.Z}`.
- Files to update in lock-step: `package.json` `version` (single source of truth), `.claude-plugin/plugin.json` `version`, and the embedded manifest copy in `docs/marketplace-submission.md`. `.cursor-plugin/plugin.json` bumps only if the Cursor plugin changed this cycle (independent cadence per the skill).
- Run `npm install` to refresh the lockfile version, then `npm run inventory:check-docs` to confirm 0 version drift.
- All `scope: always` rule directives from `rules/`.
- Explicit: do NOT create branches, tags, commits, or PRs; do NOT run `npm publish`.
- The Confidence expression requirement (verbatim).

Await the implementer. Record its `delegation_proof_id` for the Step 9 attestation.

---

## Step 3: Changelog Completeness + Sync — delegated

Author the new changelog section in Keep-a-Changelog 1.1.0 format (`https://keepachangelog.com/en/1.1.0/`, accessed 2026-06-02) and gate on PR completeness.

#### 3a. PR-completeness probe (gate)

Every merged PR since `{lastTag}` MUST appear in the new CHANGELOG section by its `#NNN` reference or be explicitly classified as `Chore`-omitted with rationale. Run the orphan-detection probe from `/h4tcher-release-prep` Step 6 (the `git log {lastTag}..HEAD --merges` ∖ CHANGELOG-section diff). Any orphan halts Step 3 until the entry is added or the omission is documented inline.

#### 3b. Delegate the changelog write

Spawn one `hatch3r-implementer` sub-agent (serialized after Step 2 — the section header depends on the bumped version). The prompt MUST include the cached `/h4tcher-release-prep` Step 6 procedure plus:

- The cached change set, grouped into the six Keep-a-Changelog change types (**Added / Changed / Deprecated / Removed / Fixed / Security**); the repo's domain grouping (Adapters / Content / CLI / Governance / Dependencies / Chore) maps onto these — preserve whichever the existing CHANGELOG uses.
- The new section header `## [{X.Y.Z}] - {YYYY-MM-DD}` MUST equal `package.json` version exactly (the CI release step extracts this section by version match for the GitHub release body — a mismatch fails the release).
- Latest version first; one entry per PR `#NNN`; the orphan list from 3a resolved.
- **Tier 3 only:** every breaking change carries a migration note under a `### Breaking Changes` subsection.
- All `scope: always` rule directives; the Confidence expression requirement (verbatim); do NOT commit/tag/publish.

Await the implementer. Record its `delegation_proof_id`.

---

## Step 4: Build + SBOM (CycloneDX) — delegated

#### 4a. Build

Spawn (or reuse) a `hatch3r-implementer` sub-agent to run `npm run build` and confirm `dist/` output. If the build fails, spawn `hatch3r-ci-watcher` with the failure log to diagnose root cause and propose a focused fix, then re-run. Max 2 build-fix loops; persistent failure surfaces as `Status: PARTIAL` in Step 10.

#### 4b. SBOM emission (CycloneDX)

A CycloneDX SBOM (`bomFormat: "CycloneDX"`, `specVersion`, `components`, `metadata`) inventories the published dependency tree for supply-chain transparency (`https://cyclonedx.org/docs/1.6/json/`, accessed 2026-06-02). Per hatch3r's supply-chain release criteria, the release emits a CycloneDX (or SPDX) SBOM and attaches it to the GitHub release assets. Delegate to the same implementer:

- Generate the SBOM via the project's configured tool — npm's `--sbom` flag or `syft` (CycloneDX JSON output). Write it to a release asset path (e.g., `dist/sbom.cdx.json`).
- Verify the emitted file is valid CycloneDX JSON (`bomFormat` == `CycloneDX`, non-empty `components`).
- The SBOM is attached to the GitHub release in the CI publish step (Step 9 human-approved); this command produces and verifies the artifact, it does not upload it.
- Confidence expression requirement (verbatim); do NOT publish or upload.

Record the implementer `delegation_proof_id`. If no SBOM tooling is configured, surface a single actionable note in Step 9 (do not fabricate a file).

---

## Step 5: Adapter-Output Verification (read-only)

Verify the bundled canonical content regenerates the on-disk adapter outputs with no drift. This is inline and read-only (no `.integrity.json` checksum file exists — drift detection regenerates and diffs per `rules/hatch3r-security-patterns.md`).

1. Run `npx hatch3r verify` — adapter outputs regenerated from bundled content match on-disk copies (0 drift required).
2. Confirm all 3 supported adapters (claude, cursor, copilot) are registered in `src/adapters/index.ts` and `ADAPTER_CAPABILITIES` has no undefined entries (3 supported adapters — claude, cursor, copilot — fixed by the 1.9.0 adapter hard-cut).
3. Confirm `package.json` `files` includes every content directory shipped in the npm package (`agents/`, `checks/`, `commands/`, `rules/`, `skills/`, `prompts/`, `github-agents/`, `mcp/`, `hooks/`).

Any drift or missing registration halts and routes the specific failure into Step 6 (or back to Step 2/3 implementer when caused by a stale generated file).

---

## Step 6: Quality Gates (inline; ci-watcher diagnoses failures)

Run the publish-critical gate set (the local stricter-than-CI subset from `/h4tcher-release-prep` Steps 3 + 5). The first line is the language-aware lint+typecheck+test gate (resolved at sync time; fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`); the lines below it are npm-ecosystem publish tooling — substitute the equivalent supply-chain audit + lockfile lint for the project's package manager when it is not npm:

```bash
${HATCH3R:VERIFY_GATE_ALL}    # lint + typecheck + test, 0 failures
npm run validate    # 0 validation errors
npx lockfile-lint --type npm --allowed-schemes https: --path package-lock.json
npm audit --audit-level=moderate --omit=dev
```

> Severity note: `npm audit`'s `--audit-level=moderate` is npm's native severity scale; its `moderate` level maps to the canonical Medium tier per `agents/shared/severity-mapping.md`. The gate fails the release on any advisory at Medium (npm `moderate`) or above.

If any gate fails: spawn `hatch3r-ci-watcher` with the failure output to diagnose root cause and propose a focused fix; route a code-level fix to `hatch3r-fixer` (record its `delegation_proof_id`) or loop back to the Step 2/3 implementer for a release-file fix. Max 2 retry loops; after 2, record in the run errors and continue — the unresolved failure surfaces as `Status: PARTIAL` in Step 10 and blocks the Step 9 approval recommendation.

---

## Step 7: Quality Verification (sub-agent pipeline)

#### 7a. Review Loop (Tier 2/3; Tier 1 skips)

Spawn `hatch3r-reviewer` with the full release diff (`git diff {lastTag}..HEAD`) and the release acceptance criteria (version bump correct, changelog complete + header-matched, SBOM emitted, gates green, adapter drift zero). Extract Critical/Warning findings AND the reviewer's top-level `confidence` field.

1. **0 Critical + 0 Warning AND confidence != low:** loop clean → proceed to 7b.
2. **0 Critical + 0 Warning AND confidence == low:** trigger a second reviewer pass before exiting.
3. **Critical/Warning findings exist:** spawn `hatch3r-fixer` with the reviewer output (record its `delegation_proof_id`), re-review.
4. **Repeat** for a maximum of **3 iterations** (code-class cap per `commands/hatch3r-workflow.md` Phase 4a rationale). If still not clean, **ASK** the user (force continue / manual fix / abort the release).

Each reviewer/fixer prompt MUST include: the agent protocol, all `scope: always` rules, the release diff, the acceptance criteria, the `correlation_id` (UUID v4 per `rules/hatch3r-agent-orchestration.md` → Correlation ID), and the Confidence expression requirement (verbatim).

#### 7b. Final Quality — mandatory (parallel, code changed)

After 7a is clean, spawn in parallel:

- **`hatch3r-testability`** (CQ5) — confirm tests for changed code paths meet the mandate map / coverage floor; release-blocking if coverage regressed below the `vitest.config.ts` thresholds.
- **`hatch3r-security`** (CQ3) — security review of the release diff; audit dependency changes flagged by `npm audit`, secret handling, and any new tool surface.

#### 7c. Final Quality — docs (parallel with 7b, when triggered)

- **`hatch3r-docs-writer`** — spawn when the release changed public APIs, adapter behavior, the CLI surface, or canonical content. Reconcile `README.md`, `docs/adapter-capability-matrix.md` (must reflect current `ADAPTER_CAPABILITIES`), `docs/marketplace-submission.md`, and the `website/` Docusaurus pages (`onBrokenLinks: 'throw'` — a broken link fails the deploy build). Run the feature-surface grep from `/h4tcher-release-prep` Step 7: any command/adapter/skill renamed or removed this release must NOT appear by its old name in the docs (0 hits). Skip silently if no doc surface changed.

Each specialist prompt mirrors 7a's required fields. Apply specialist outputs; if any specialist produced fixes (not just findings), run a focused re-review on the changed files (max 1 extra iteration) so Step 7 fixes do not bypass the gate, then re-run the Step 6 gates.

---

## Step 8: Release-Notes Reconciliation

Confirm the GitHub release body the CI publish step will produce matches the authored changelog:

1. The `## [{X.Y.Z}] - {YYYY-MM-DD}` section exists and the version equals `package.json` version (the CI release workflow extracts this section by version match via `body_path`; a missing or malformed header fails the CI release step).
2. The section's PR `#NNN` set equals the Step 3a completeness set (no orphan re-introduced by a Step 7 fix).
3. For a Tier 3 release, the `### Breaking Changes` migration notes are present.

Any mismatch routes back to the Step 3 implementer (record the `delegation_proof_id`) before Step 9. Do not hand off to the human with an unreconciled changelog.

---

## Step 9: Marketplace-Lane Handoff — STOP before publish/merge

This command **never publishes, merges, tags-and-pushes, or submits to a marketplace.** It assembles the release on the `release/X.Y.Z` branch, stages and commits with DCO sign-off, then stops and hands the publish decision to the human.

Terminus alignment (D10-14): this command and its id-sharing inline sibling `skills/hatch3r-release/SKILL.md` enforce the same stop-before-irreversible boundary, so `/release` is safe regardless of which artifact it resolves to. This command stops here at Step 9; the skill gates every irreversible step (tag push, publish, production deploy) default-OFF behind `--publish` or a typed confirmation (skill → Irreversibility Gate). Neither auto-publishes or auto-deploys on a bare invocation.

#### 9a. Stage + commit on the release branch (DCO)

When release files changed, stage and commit on the current `release/*` branch with a Conventional-Commit, DCO-signed message (`git commit -s` adds the `Signed-off-by:` footer):

```bash
git add -A
git commit -s -m "$(cat <<'EOF'
chore(release): v{X.Y.Z}

- version bump {prev} -> {X.Y.Z} (package.json, .claude-plugin/plugin.json, marketplace manifest)
- CHANGELOG section [{X.Y.Z}] ({n} PRs)
- CycloneDX SBOM emitted to dist/sbom.cdx.json

Refs #{linked_issue_n}
EOF
)"
```

Do NOT `git push` to `board.defaultBranch`, do NOT force-push, do NOT create or push a tag. Pushing the release branch and opening the PR is the human's call (the repo's release norm: cut/operate on a release branch; do not auto-publish/merge).

#### 9b. Present the distribution-lane handoff + approval gate

Present the release-readiness summary and the marketplace-lane map, then ASK for explicit human approval. Per hatch3r's distribution roadmap, the 3 supported adapters map to these distribution lanes:

| Lane | Channel | Status (roadmap) | Release action (human-owned) |
|------|---------|---------------------|------------------------------|
| i | npm / CLI | Shipped | CI `release.yml` publishes with OIDC provenance (Sigstore / SLSA) on the pushed tag — `npm publish --provenance`. |
| iii | Cursor plugin marketplace | Q3 2026 target | Resubmit `docs/marketplace-submission.md` package only on a public-manifest change. |
| ii | Claude Code plugin marketplace | Q3 2026 target | Update the PR in `anthropics/claude-plugins-official/external_plugins`. |
| 2d | GitHub Copilot | Q4 2026 target | npm/CLI lane only — `.github/copilot-instructions.md` consumed natively; no separate marketplace. |

**ASK (final gate):** "Release v{X.Y.Z} assembled on `{branch}` and committed (DCO-signed). Gates: {pass summary with confidence}. SBOM: {emitted/not-configured}. Review-loop: {clean after N iterations}. Next step is human-owned — none taken by this command. Choose: (1) I'll push the branch + open the PR myself / (2) print the exact tag + push + `npm publish --provenance` commands for me to run / (3) hold — something needs fixing first)." Default-if-no-response: (3) hold (fail-closed — never auto-publish).

The npm publish itself runs in CI (`.github/workflows/release.yml`) on the human-pushed tag with OIDC provenance — provenance attestation links the published package to its source + build via Sigstore and requires a cloud runner with `id-token: write`, so a local `npm publish` would not carry provenance and is out of scope here (`https://docs.npmjs.com/generating-provenance-statements`, accessed 2026-06-02).

---

## Step 10: Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

**Status enum:** SUCCESS (release assembled + committed on the branch, all gates green, awaiting human publish) | PARTIAL (a gate ended on a retry-limit miss or SBOM tooling absent) | FAILED (build broken, no release commit produced) | BLOCKED (review loop unresolved after 3 iterations, or a breaking-change decision needs the user). SUCCESS here means "ready for human publish" — never "published".

---

## Resumability (Decision 27/30)

release is long-running — a Tier 3 release runs preflight, version bump, changelog sync, build + SBOM, adapter verification, the gate set, the reviewer ↔ fixer loop, the final-quality specialist batch, and release-notes reconciliation. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-bumping the version or re-emitting the SBOM.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.release-workspace/`; step range the Step 0 → Step 10 progression; `wave` = review-loop iteration index in Step 7a; snapshot/rollback paths every release file touched by Step 2/3/4 implementers and Step 7a fixers. Write points: after Step 1 preflight passes, after Step 1.5 plan-gate artifact write + approval, after the Step 2 version-bump implementer returns, after the Step 3 changelog implementer returns, after the Step 4 build + SBOM step, after Step 5 adapter verification, after the Step 6 gate run, after each Step 7a review-loop iteration, after the Step 7b/7c specialist batch, and after Step 8 reconciliation. The Step 9 commit is recorded so a resume does not double-commit.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for release: `1` = preflight + SemVer decision, `2` = version-bump / changelog / build-SBOM implementer dispatch, `3` = adapter verification + gates + review loop + final-quality batch, `4` = reconciliation + Step 9 human-approval handoff + iteration summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: version files, CHANGELOG, SBOM, docs, fixes. The only inline writes this command performs are the read-only inspections (Steps 1, 5, 6 gate runs) and the Step 9a release commit on the branch; every file mutation (version bump, changelog, SBOM, docs, code fixes) is delegated.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_preview`** — emitted in Step 0.5 before the Step 2 implementer dispatch.
- **Post-execution actuals + `delta_percent`** — appended to the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

Per-tier `expected_sa_count` (from frontmatter `sub_agents_spawned.count: 7` × tier heuristic in `rules/hatch3r-cost-visibility.md`): Tier 1 ≈ 3 (bump + changelog implementer, testability, security); Tier 2 ≈ 6 (+ review loop reviewer/fixer + ci-watcher when a gate trips); Tier 3 up to 7 (full pipeline incl. docs-writer). Token telemetry sources from `src/pipeline/observability.ts`.

---

## Guardrails

1. **Never publish.** `npm publish` is run by CI on a human-pushed tag, never by this command.
2. **Never merge or push to the default branch.** Step 9 commits to the `release/*` branch only; pushing the branch + opening the PR is the human's action.
3. **Never force-push, never push a tag.** Tag creation + push is the human-approved publish trigger.
4. **DCO sign-off required** on the Step 9a release commit (`git commit -s` adds the `Signed-off-by:` footer).
5. **Clean tree + release branch are preconditions** (Step 1) — halt with an actionable error otherwise.
6. **Changelog header must match `package.json` version exactly** — the CI release body extraction depends on it (Step 8).
7. **No inline implementation.** Every file mutation is delegated to a pipeline sub-agent (Mandatory Delegation Directive, `rules/hatch3r-agent-orchestration.md`); the orchestrator performs only read-only inspections and the Step 9a branch commit.
8. **Confidence propagation.** Every gate verdict, review-loop verdict, and Step 9 readiness assessment carries a confidence rating from the upstream sub-agent. Dropping the signal is a gate failure.
9. **Fail-closed approval.** The Step 9 default-if-no-response is hold — a release is never auto-advanced past the human gate.
10. **This command composes existing hatch3r agents and the `/h4tcher-release-prep` skill** — it does not replace them.

## References

- Semantic Versioning 2.0.0 — version increment rules (MAJOR/MINOR/PATCH). `https://semver.org/` — accessed 2026-06-02. Trust tier: official specification.
- Keep a Changelog 1.1.0 — changelog guiding principles, six change-type groupings, ISO-8601 dated headers, Unreleased section. `https://keepachangelog.com/en/1.1.0/` — accessed 2026-06-02. Trust tier: established community standard with named maintainer.
- CycloneDX JSON spec 1.6 — SBOM `bomFormat`/`specVersion`/`components`/`metadata` and supply-chain transparency use (ECMA-424). `https://cyclonedx.org/docs/1.6/json/` — accessed 2026-06-02. Trust tier: OWASP / ECMA international standard.
- npm provenance statements — `--provenance`, Sigstore keyless signing, GitHub Actions OIDC, SLSA build-provenance attestation. `https://docs.npmjs.com/generating-provenance-statements` — accessed 2026-06-02. Trust tier: official vendor documentation.
- hatch3r distribution roadmap — the 3-lane distribution model (npm shipped; Cursor + Claude Q3 2026; Copilot Q4 2026) and the SBOM release criterion the Step 4b/9b lanes implement. Internal product requirements; not a public citation.
