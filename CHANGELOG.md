# Changelog

All notable changes to hatch3r are documented in this file.

## [1.6.1] - 2026-04-22

### Fixed

- **`full` preset now actually installs everything**: the default `hatch3r init` profile silently dropped the 6 `hatch3r-board-*` commands (pickup, groom, refresh, init, fill, shared) and `hatch3r-onboard` because the solo team-size filter ran unconditionally over the resolved selection, even when the user's chosen preset explicitly promised "Everything including board management". The filter now scopes to non-`full` presets — users who opt into `full` receive the full catalog regardless of `teamSize`. Project-type and language filters continue to apply (they are technical compatibility filters, not preferences). Fix: `src/content/index.ts::resolveSelection` guard at line 436.
- **Worktree support now explicitly configurable in `init`**: previously `hatch3r init` auto-enabled worktree file isolation without prompting whenever a worktree-capable tool (currently `claude`) was selected, while `hatch3r config` did prompt — an asymmetric UX that hid a side-effect from interactive users. Init now mirrors the config prompt after tools selection and adds `--worktree` / `--no-worktree` CLI flags for headless callers. `--yes` without the flag preserves today's auto-enable behavior for CI compatibility. Fix: `src/cli/commands/init.ts` interactive and workspace branches; `src/cli/program.ts` flag registration; `src/manifest/hatchJson.ts::createManifest` honors explicit `worktreeEnabled` option. `src/cli/commands/clean.ts` reinit path threaded through the new option to keep `RunInitOptions` consistent.

### Tests

- 3 existing `resolveSelection` tests updated to reflect the new preset-aware semantic; 5 new tests cover `full + solo` behavior (keeps team/board items, still applies projectType filter, `standard + solo` unchanged as scope check, `skipContextFilters` path unchanged).
- 5 new `init.test.ts` cases cover the worktree prompt paths (interactive accept, interactive decline, `--no-worktree` override, `--worktree` force-enable, no prompt when no worktree-capable tool). 13 existing interactive init tests updated to queue the new prompt where applicable. Test count 2,594 → 2,604.

## [1.6.0] - 2026-04-21

### Added

- **Rule precedence system**: Optional `precedence: critical|high|normal|low` field in canonical frontmatter (default `normal`) with deterministic ordering across all adapters — `sortByPrecedence()` helper in `src/adapters/canonical.ts`, per-file adapters (cursor, windsurf, copilot, claude, cline) emit `NN-hatch3r-*` numeric filename prefixes, inline adapters (gemini, aider, amp, goose, zed, antigravity, amazonq, codex) sort before concatenation, OpenCode emits an explicit precedence-ordered `instructions[]` list. Parity-validated via `scripts/validate-rule-parity.ts`
- **Description quality lint**: `src/cli/commands/validate.ts` fails validation when a description is under 60 characters or collides within its tag cluster (cosine similarity ≥ 0.55). 27 offending descriptions rewritten across rules, customize family, planning, and maintenance commands
- **Mode tag backfill**: 16 subject modes under `agents/modes/` dual-tagged `[core, ...]` to preserve minimal preset membership; 4 meta-modes (current-state, library-docs, prior-art, similar-implementation) remain untagged by design
- **Task-type routing table**: `buildTaskRouterModel()` in `src/cli/shared/agentsContent.ts` emits 11 workflow+domain routing rows (agent/command/skill fallback with `/slash` and `_(skill)_` kind hints) inherited by the Claude, Cursor, Windsurf, and Copilot adapters
- **Orphan cleanup on sync**: `src/merge/orphanCleanup.ts` unlinks files previously emitted but no longer produced, tracked via manifest `managedFilesByAdapter`. Four safety refusals — user-wrapped content, paths outside adapter roots, non-`hatch3r-` basenames, and no-history first-run no-op
- **Board sync production-readiness review**: `board-init` adds programmatic workflow verification via GitHub GraphQL with a `--resume` flag and persists `board.workflows.{itemClosedEnabled,pullRequestMergedEnabled}` in `hatch.json`; `board-fill` Step 7.9 adds a reviewer/fixer loop that treats issue bodies as specs (6-criteria checklist, 4-iteration cap, oscillation detection); `pickup-post-impl` Step 9c adds terminal-state verification (label flip + V2 board state) after PR merge; `shared-github` mandates per-sync verification plus an option-mapping race rule and halts when both `gh` and MCP are unavailable; `board-shared` Board Sync Enforcement rules 8–10 add retry-then-halt with rollback, null-option abort, and a 20% batch retry-budget ceiling
- **Inventory and drift-gate scripts**: `scripts/inventory.ts` (tsx) derives `governance/inventory.json` from the filesystem and ships 11 count probes plus 2 `VERSION_PROBES` against `package.json` as single source of truth; `scripts/validate-rule-parity.ts` diffs body content across every `rules/hatch3r-*.md` ↔ `.mdc` pair. Wired as CI drift gates and surfaced via `npm run inventory`, `npm run inventory:check-docs`, `npm run validate:rule-parity`
- **Marketplace submission package**: `docs/marketplace-submission.md` and `.claude-plugin/plugin.json` prepared for submission to `anthropics/claude-plugins-official`; Claude adapter emits `.claude/hooks/hatch3r-hooks.json` alongside `settings.json`
- **Severity mapping template**: `governance/audit/templates/severity-mapping.md` (51 lines) with a 5-column canonical map across reviewer verdicts, reviewer levels, security-auditor severity, check tags, and audit severity, cross-referenced from reviewer, fixer, security-auditor, `checks/code-quality.md`, and both audit prompts
- **Resilience wiring across CLI**: `src/pipeline/retryWithBackoff.ts` (122 lines) plus circuitBreaker, adapterTimeout, phaseTimeout, pipelineTimeout, and phaseOutputSchema wired into the sync, update, and verify commands. `complianceVerification.ts` now verifies import-presence via 6 `resilience-*` ASI-RESILIENCE checks
- **EVOLVE proposal batch**: 15 EVOLVE proposals from the 2026-04-19 self-check run applied — aggressive one-sub-agent-per-finding fan-out, Scientific Rigor Contract elevated to core audit methodology, plus Cycle 7 CL-3 P1–P10 audit-self-evolution items (D16 18-file synthesis methodology, D18 live distribution baseline, `feature_status` taxonomy, D11 Medium severity cap at 8, per-adapter currency citations, home-domain redundancy rejection, Wave 4 systemic-patterns wave, domain orchestrator bundling, Inconclusive Areas MUST for <3 High domains, pre-audit inventory validation gate)

### Changed

- **Audit methodology rewrite**: Web research and the Scientific Rigor Contract (falsifiability, ≥2 independent sources with trust tier, confidence with basis, ≥3-step causal chain, bias check, adversarial peer review) are now required for every audit sub-agent in `governance/AUDIT.md` and `governance/AUDIT-EXECUTE.md` rather than optional rigor add-ons
- **Audit execution fan-out**: One sub-agent per finding replaces the prior severity-wave batching; same-file findings group into file-lock sub-agents, same-wave dependency chains serialize, and sub-agents write to `.audit-workspace/wave-{N}/{finding_id}.results.md` per the new Context Management Protocol with the orchestrator reading only `SUMMARY.md`
- **CLI entry point slimmed**: `src/cli/index.ts` refactored 209 → 67 lines, delegating to `src/cli/program.ts` (150 → 155 lines). `createProgram()` is the canonical builder; `index.ts` is a thin orchestrator for signal handling, error banner, and exit codes. All 11 commands plus `verify --fix` preserved (net −137 lines of duplication)
- **Update command split**: `runUpdate` now decomposes into `runPackageUpdate` + `runRegenerate`; `config` and `verify --fix` call `runRegenerate` only, avoiding the 30-second npm fetch penalty
- **HatchError migration**: 18 `throw new Error` sites across 11 production files converted to `throw new HatchError(message, exitCode, errorCode)` with codes from the existing `HatchErrorCode` union. A custom `hatch-error/use-hatch-error` ESLint plugin (severity warn) flags future regressions in `src/` outside tests
- **Silent-failure contract**: New `silent-failure/no-silent-catch` ESLint flat-config plugin surfaces empty or logging-only `catch` blocks (severity warn, does not break builds). Contract codified as a subsection under `governance/CONSTITUTION.md` §2 P5
- **Canonical read result shape**: `src/adapters/canonical.ts` now returns `CanonicalReadResult { file, content?, frontmatter?, body?, error? }` with an `error.code` enum (NOT_FOUND, PERMISSION_DENIED, UTF8_DECODE_ERROR, YAML_PARSE_ERROR, UNKNOWN) and an optional `warnings?: string[]` channel surfaced through 14 adapter files. `readCanonicalFiles()` keeps its backward-compatible 2-arg signature; `readCanonicalFilesDetailed` exported for strict consumers
- **Init write-order hardening**: `writeManifest` now deferred in `init.ts` until after adapter generation succeeds, preventing partial-state manifests when every adapter fails. Equivalent integrity-manifest contingency added to `update.ts:304` and `workspace/sync.ts:340`
- **Sync/update/add preflight integrity**: `verifyIntegrity()` runs before sync, update, and add with a `--force` escape hatch (`HatchError INTEGRITY_ERROR` on drift)
- **Language-aware content selection**: `projectLanguages` now threads through 5 `resolveSelection()` sites in `init.ts` plus 2 `estimatePresetItemCount` sites. `resolveLanguageTags` + `filterByLanguages` extracted into `src/content/tags.ts`; 3 language-specific rules (component-conventions, i18n, theming) tagged `lang:typescript` (covers JS via the TypeScript alias)
- **Confusables coverage widened**: `HOMOGLYPH_MAP` in `customization.ts` extended with 30 Coptic + 16 Deseret + 10 Osage confusables per UAX #39; `normalizeHomoglyphs` switched from NFKC to NFKD with `/[̀-ͯ]/g` combining-mark strip so Latin Extended Additional decomposes (for example ḅ → b). Supplementary-plane scripts handled via `/gu` regex flag
- **MCP version-pin check**: `checkVersionPin` helper in `mcp-utils.ts` wired into `validateMcpEntry` flags unpinned `npx @scope/pkg` patterns and `@latest` tags as supply-chain risk per Palo Alto Networks' 2025 npm supply-chain attack report and OWASP ASI 2026
- **Review confidence gate**: `evaluateReviewGate` in `src/pipeline/reviewLoop.ts` with an optional `confidence` field on `ReviewResult` routes low-confidence clean verdicts into `second_pass` or escalation rather than silent auto-pass
- **Amazon Q hook event names**: Fixed to the AWS canonical schema — `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop` — per `aws.github.io/amazon-q-developer-cli/agent-format.html`
- **Antigravity skills path**: Corrected `.antigravity/skills/` → `.agent/skills/` per Google's documentation
- **Kiro adapter**: Picked up Kiro Powers coverage (cycle 8 D9 Medium) per live platform documentation
- **Zed adapter**: Picked up `spawn_agent` coverage (cycle 8 D9 Medium) per live platform documentation
- **Parallel safety guidance**: `rules/hatch3r-agent-orchestration.md` (+ `.mdc`) documents 4 parallel-safe patterns, 5 not-parallel-safe patterns, and a three-conditions-to-parallelize gate

### Fixed

- **Cursor Bugbot PR #54 findings (8 resolved)**: Pipeline module count drift in `docs/marketplace-submission.md` (15 → 17, now matches `governance/inventory.json`); `board-fill` Step 7.8 now routes to Step 7.5 before Step 8 (dashboard refresh no longer skipped); Step 7.9b/c gain Azure DevOps and GitLab variants alongside the `gh` CLI; `board-fill` frontmatter flipped to `orchestrator: true` with `agentPipeline: [hatch3r-reviewer, hatch3r-fixer]` reflecting Task-tool delegation; version bumped across `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, and the embedded copy in `docs/marketplace-submission.md` with `VERSION_PROBES` guarding future drift; `.claude/settings.json` SessionStart hook restores `2>/dev/null` and the "Registry not found" graceful fallback; `.claude-plugin/plugin.json` removes the stale `hooks` key that pointed at a non-existent `hooks/hooks.json`; SessionStart cycle filter generalized to `execution_status=="pending"` (was hardcoded `cycle==7`, misreported on the 315-entry registry)
- **`writeManifest` schema revalidation**: New `validateManifest` guard in `src/manifest/hatchJson.ts` prevents in-memory invalid manifests from persisting; throws `HatchError(CONFIG_ERROR)` on schema failure
- **Verify command flag registration**: `--fix` and `--max-fix-attempts` now registered on the `verify` command in `src/cli/index.ts` (previously present in `program.ts` only)

### Tests

- Test suite grew from 1,734 at v1.5.1 to 2,594 passing across 100 files at release (+860, +50%)
- 13 new test files under `src/__tests__/`: `adapters/capability-matrix`, `cli/agentsContent`, `cli/errorClassification`, `helpers/configHelpers`, `importers/cursor`, `integrity/provenance`, `merge/orphanCleanup`, `merge/safeWrite.fileLock`, `pipeline/adapterToolTranslator`, `pipeline/injectionPatternsSync`, `pipeline/mcpDescriptionScan`, `pipeline/retryWithBackoff`, `types`
- 51 existing test files extended — heaviest deltas in `cli/config.test.ts` (rewritten against shared helpers), `cli/init.test.ts` (+1,193 lines across validation flags, partial adapter failure, re-init cleanup, worktree generation, language detection, and interactive flows), `cli/sync.test.ts` (+366), `adapters/canonical.test.ts` (+510), and `adapters/customization.test.ts` (+356)
- Aggregate test-directory diff: 64 files changed, 11,082 insertions, 1,244 deletions

### Documentation

- **PRD evolution through the cycle**: `governance/hatch3r-prd.md` updated in three increments — Cycle 7 CL-1, Cycle 7.5 Wave 2 Batch 2 CL-1 (v4.3), and Cycle 8 partial CL-1 (v4.5)
- **Audit report**: `governance/AUDIT-REPORT.md` extended with post-execution reports for Cycles 7, 7.5 Wave 2 Batch 2, and Cycle 8 partial. Cycle 8 verdict upgraded from PARTIAL-SHIP to SHIP after Wave 3 fix landed 3 rolled-back findings
- **Finding registry**: `governance/audit/finding-registry.json` extended with Cycle 7, 7.5, and 8 finding resolution tracking and per-wave execution telemetry
- **Marketplace submission manifest**: `docs/marketplace-submission.md` updated to 1.6.0 with the full `VERSION_PROBES` file map
- **`release-prep` skill** expanded with every version-file location so future bumps stay in sync

### Dependencies

- Add `proper-lockfile ^4.1.2` (production) — powers safe-write file locking
- Add `@types/proper-lockfile ^4.1.4` (dev)
- Add `tsx ^4.21.0` (dev) — runs `scripts/inventory.ts` and `scripts/validate-rule-parity.ts` for the new CI drift gates

## [1.5.1] - 2026-04-19

### Added

- **EVOLVE governance prompt**: `governance/EVOLVE.md` (375 lines) — a proposal-only constitutional self-check that assesses the 7-file governance corpus plus domain and template files against nine measurable dimensions. Routes each proposal to one of three buckets (Vision / Audit system / Constitution and prompt mechanics), enforces a Model-Independence Contract with a forbidden-pattern table, a Web Research Mandate requiring at least two independent sources per topic with trust-tier and recency constraints, a six-test Scientific Rigor Contract (falsifiability, citation + triangulation, confidence expression, root-cause orientation, bias check, adversarial peer-review), four hard-stop ASK gates, 16 guardrails, and a 15-proposal cap per run ranked by severity × pillar impact × North-Star multiplier
- **Shared custom content choices helper**: `src/cli/shared/customContentChoices.ts` extracts `CONTENT_TAG_LABELS` and `buildTagGroupedCustomContentChoices()` so `config` and `init` (including workspace flow) stay consistent when tags change

### Changed

- **Config content flow**: Replaced "Manage content items?" confirm prompt with direct preset selection (minimal/standard/full/custom) and tag-grouped custom picker, matching the init experience
- **Default content profile**: Changed default from "Standard" to "Full (recommended)" for both interactive and headless (`--yes`) init
- **Default tool fallback**: Changed fallback tool from Cursor to Claude Code when auto-detection finds no existing tools
- **Revision command decomposed**: Split monolithic `commands/hatch3r-revision.md` (517 lines) into a 5-file structure matching board-pickup quality patterns — `revision-delegation.md` (complexity-aware fix delegation with blast-radius grouping), `revision-quality.md` (two-stage quality pipeline with 3 conditional specialists), `revision-modes.md` (auto-advance mode, safety guardrails, platform-aware error handling), `revision-board-integration.md` (run cache, PR summary updates, dashboard refresh). Core file retains Steps 1-5 and 8-10 inline; platform abstraction added to Step 1b (GitHub, GitLab, Azure DevOps)
- **Custom content helpers module-private**: Restricted exposure of CLI helpers to reduce surface area

### Fixed

- **Config preset resolution ignored context filters**: `resolveSelection` applied `projectType`/`teamSize` filtering which silently dropped board/team-only items (e.g. `hatch3r-board-fill`, `hatch3r-onboard`) for solo users. Correct for `init`, wrong for `config` where the user is explicitly choosing a preset. Added `skipContextFilters` option and use it from `config`
- **Preset item count estimates were misleadingly low for solo users**: `estimatePresetItemCount` calls `resolveSelection` internally; now passes `skipContextFilters` so hints in the preset selector show the actual count (e.g. "Full (~109 items)" instead of "~95")
- **Manifest not persisted when only content preset metadata changed**: `isDiffEmpty` ignored `manifest.content` preset/projectType/teamSize, so switching to an equivalent item set (e.g. `full` → `custom`) skipped `writeManifest` and reverted the in-memory preset. Now tracks metadata changes and bypasses the early return when they differ

## [1.5.0] - 2026-04-13

### Added

- **Pipeline infrastructure**: 14 new modules in `src/pipeline/` — adapter timeout, agent identity verification, agent tool allowlist, circuit breaker, compliance verification, diff hashing, failure logging, observability spans, phase output schema validation, phase timeout, pipeline context, pipeline timeout, prompt guard, and review loop
- **Secret detection**: `src/env/secretDetection.ts` scans MCP environment variable values for accidentally committed API keys, tokens, passwords, and private keys
- **Verification gates**: `src/detect/verificationGates.ts` abstracts test/lint/typecheck commands per detected language (not just npm)
- **Learnings validation**: `src/content/learningsValidation.ts` enforces file size limits (64KB per file, 512KB total), safe filenames, and deny-pattern scanning on user-provided learnings
- **Worktree cleanup command**: `src/cli/commands/worktreeCleanup.ts` for removing stale worktree directories
- **Accessibility check**: `checks/accessibility.md` — WCAG compliance, semantic HTML, keyboard navigation, screen reader support, and inclusive design review criteria
- **Trust framework**: `governance/trust-delegation-chain.md` and `governance/trust-framework-compliance.md` documenting trust flow from user through orchestrator to agents and tools
- **Observability rule modules**: Split `hatch3r-observability` into three focused rules — `hatch3r-observability-logging`, `hatch3r-observability-metrics`, and `hatch3r-observability-tracing`
- **Competitive analysis**: `governance/COMPETITIVE-ANALYSIS.md` (772 lines) benchmarking hatch3r against the ecosystem
- **PRD refresh**: `governance/hatch3r-prd.md` fully rewritten (1,511 lines) reflecting current architecture and roadmap

### Changed

- **Goose adapter rewrite**: Replaced speculative recipe/ACP schema with actual Goose platform schema — `instructions` array, `stdio`/`sse` extension types, `env_keys` for environment variables
- **Verify command**: Added `--fix` flag for self-healing loop (verify → fix → re-verify, max 5 cycles)
- **Researcher agent**: Major restructuring (~960 lines changed) with improved analysis mode organization
- **Observability rule**: Comprehensive rewrite (~457 lines changed) with structured logging, metrics, and distributed tracing guidance
- **Agent orchestration rules**: Expanded with pipeline context propagation and phase boundary enforcement
- **16 agent spec files**: Updated with finding-driven improvements — structured reasoning sections, verification gate references, and cross-agent protocol alignment
- **CI hardening**: `persist-credentials: false` on all checkout steps, `timeout-minutes` on all jobs, supply chain security job (lockfile lint + tiered npm audit), DCO sign-off check
- **Adapter improvements**: Bug fixes and schema corrections across adapters
- **Validate command**: Extended with learnings validation and verification gate integration
- **Update command**: Enhanced reconciliation with verification output
- **46 rule files updated**: Content quality and tag alignment across all standard rules
- **45 command docs updated**: Content tag alignment and accuracy improvements
- **26 skill docs updated**: Content tag alignment

### Fixed

- **Goose adapter schema**: Replaced fabricated `recipes`, `acp`, and `name`/`description` profile fields with actual Goose platform schema
- **Adapter customization**: Duplicate `readCanonicalFiles` calls in Goose adapter eliminated
- **Content index**: Improved error handling and edge case coverage
- **TypeScript 6 compatibility**: Added explicit `@types/node` references for TypeScript 6 module resolution
- **DCO sign-off check**: Skip merge commits in CI sign-off verification to avoid false failures

### Security

- **Audit execution (Cycle 4)**: 233/249 agent-actionable findings resolved across 4 severity waves (Critical, High, Medium, Low) with zero rollbacks — framework score improved from 68/100 to 85/100
- **Secret pattern detection**: New `secretDetection` module prevents accidental credential exposure in MCP configuration
- **Trust delegation chain**: Documented monotonically decreasing privilege model from user through pipeline to tools
- **Trust framework compliance**: Mapped all pipeline boundaries to trust verification checkpoints
- **Supply chain hardening**: Lockfile-lint validation and tiered npm audit added to CI pipeline
- **DCO enforcement**: Signed-off-by trailer check on all PR commits
- **Credential persistence disabled**: All GitHub Actions checkout steps now use `persist-credentials: false`

### Tests

- 24 new test files with comprehensive coverage:
  - **Pipeline tests** (15 files): adapterTimeout, agentIdentity, agentToolAllowlist, circuitBreaker, complianceVerification, diffHash, failureLog, observability, phaseOutputSchema, phaseTimeout, pipelineContext, pipelineTimeout, promptGuard, reviewLoop, wave3Medium
  - **Security tests** (2 files): secretDetection, verificationGates
  - **CLI tests** (3 files): entrypoint, lifecycle, worktreeSetup
  - **Integration tests** (4 files): mcp-dataflow, concurrentWrite, learningsValidation, setupCleanup
- 51 total test files modified
- Test count: 1,089 → 1,734 (+645 new tests, +59%)

### Documentation

- Audit report: `governance/AUDIT-REPORT.md` (1,445 lines) with executive dashboard, domain heatmap, and holistic assessment
- Finding registry: `governance/audit/finding-registry.json` (7,306 lines) with full resolution tracking
- Execution insights: `governance/audit/execution-insights.json` documenting cross-cycle patterns
- 45 command documentation files updated
- 26 skill documentation files updated
- Website docs: quick-start, MCP setup guide, and adapter capability matrix updated

### Dependencies

- Bump inquirer from 13.3.2 to 13.4.1
- Bump dev dependencies: @vitest/coverage-v8, eslint, typescript, typescript-eslint, vitest (6 updates)
- Bump GitHub Actions: softprops/action-gh-release 2.2.2→2.6.1, actions/upload-artifact 6.0.0→7.0.0, actions/deploy-pages 4.0.5→5.0.0, github/codeql-action 0.62.5→0.65.6

## [1.4.0] - 2026-03-25

### Added

- VISION.md -- stable north-star vision document for the framework
- RE-ENVISION.md -- framework-owner prompt for structured vision capture and refinement
- Closed-loop audit phases: CL-1 (PRD Evolution), CL-2 (Content Gap Identification), CL-3 (Audit Self-Evolution) in AUDIT.md
- Post-execution phases: Phase 5 (PRD Update), Phase 6 (Content Generation Planning), Phase 7 (Audit Prompt Evolution) in AUDIT-EXECUTE.md
- Sub-agent 16.5 (Closed-Loop Effectiveness) in D16 compound system evaluation
- Audit templates for closed-loop agents (PRD Update, Content Spec, Audit Evolution)
- Dynamic inventory verification protocol in AUDIT.md
- **`status:done` label**: Added to the board label taxonomy, closing the gap between the existing `BoardConfig.statusOptions.done` TypeScript type and the agent command instructions. All platform status mapping tables now include the `status:done` row.
- **Post-Merge Terminal State handling**: New section in `hatch3r-board-shared` documenting platform-specific behavior after PR merge — GitHub Projects V2 built-in workflow verification, Azure DevOps opt-in checkbox, GitLab label drift advisory.
- **PR Closed Without Merge handling**: New section in `hatch3r-board-shared` defining revert behavior for abandoned PRs. Board-groom Step 3l detects orphaned `status:in-review` issues with no associated open PR/MR.
- **Abandoned work detection in collision check**: All three platform pickup files (GitHub, Azure DevOps, GitLab) now check for closed/abandoned PRs during Step 3 collision detection and surface context to the user.
- **Orphaned in-review remediation in board-groom**: Health Fix (Step 4i) expanded to remediate board sync drift (label vs. board status mismatch) and orphaned in-review issues (both open with no PR and closed but not status:done).
- **End-of-Run Reconciliation step 5**: Orphaned in-review detection for all cached `status:in-review` issues, not just those transitioned during the current run. Reconciliation report now includes orphaned in-review line.
- **Board-init automation guidance**: GitHub section recommends verifying the Projects V2 "Item closed" built-in workflow after board creation. GitLab section notes labels are not auto-updated on close. ADO section documents column split recommendations.
- Sub-Agent Behavioral Charter in AUDIT.md -- 10 directives governing audit sub-agent mindset and conduct
- Orchestrator Quality Guidance in AUDIT.md -- synthesis standards, cross-domain discovery, sub-agent failure handling, report assembly
- Shared agent quality charter (`agents/shared/quality-charter.md`) -- 7 behavioral standards for end-user agents
- Fix-to-Finding verification gate check in AUDIT-EXECUTE.md regression gates
- Adversarial verification pass (Pass 2.5) and fix-to-finding alignment pass (Pass 1.5) in reviewer template
- Execution Learning section in AUDIT-EXECUTE.md with cross-cycle pattern tracking and insights JSON
- Content Quality Principles checklist in D05 audit domain for verifying content against quality charter
- Holistic Assessment section in audit report Executive Dashboard output format
- False positive detection and tracking in AUDIT-EXECUTE.md final review
- governance/CONSTITUTION.md -- foundational decisions, quality principles, and design rationale for the governance system

### Changed

- PRD Section 2 references VISION.md as the north-star vision document
- PRD Section 6 adds 4 new principles: weekly audit cadence, closed-loop evolution, automatic learning, up-to-date information
- PRD Section 6 adds "Audit Cycle as Product Feature" subsection
- AUDIT.md sub-agent count updated from 106 to 107
- AUDIT.md adds pre-audit question for closed-loop phases
- AUDIT-EXECUTE.md adds 4 new guardrails (#17-20) for closed-loop phase governance
- AUDIT-EXECUTE.md finding registry gains 3 new fields (prd_impact, content_generated, audit_evolution)
- D18 (PRD, Roadmap & Distribution) now audits VISION.md alignment
- **Sub-issue linking fallback chain parity**: Azure DevOps and GitLab sub-issue linking upgraded from 2-tier to 3-tier fallback chains, matching GitHub's structure (Native -> Advisory body-reference -> Comment-only). The "Three-Tier" section headers now match their content.
- **Board Sync Enforcement rule 2**: Updated from "four canonical statuses" to "five canonical statuses" (Ready, In Progress, In Review, Done, Blocked).
- **GitLab required board lists**: Added "Done" (`status::done`) to the required board lists created during `board-init`.
- **Board-groom health-fix scope**: Expanded from missing metadata only to also include board sync drift remediation and orphaned in-review resolution.
- AUDIT.md Universal Audit Checklist expanded with git history context, measurable criteria, and multi-stakeholder impact directives
- AUDIT.md adds reproducibility/non-determinism note, scoring calibration check, adaptive resource allocation for mature domains, domain file quality standard, and enhanced context propagation mechanism
- AUDIT-EXECUTE.md finding registry gains `false_positive` field for tracking incorrectly identified findings
- Implementation sub-agent template expanded with 3 new requirements: understand the why, consider side effects, verify root cause
- D05, D07, D13, D16, D19 audit domain checklists expanded with content interaction testing, negative scenario testing, simulated execution, content quality principles, and assumption challenging
- VISION.md adds principles 13-14: quality through measurable standards and behavioral charter governance
- hatch3r-prd.md adds principle 17: behavioral quality standards referencing shared quality charter
- Consolidated all governance files into `governance/` directory: AUDIT.md, AUDIT-EXECUTE.md, RE-ENVISION.md, VISION.md, hatch3r-prd.md, COMPETITIVE-ANALYSIS.md, AUDIT-REPORT.md, and audit/ subdirectory

### Documentation

- **ADO status granularity**: Documented the known limitation where `status:ready` and `status:in-progress` both map to ADO state "Active". Added recommendations for custom process templates and board column splits.
- **GitLab scoped labels caveat**: Noted that scoped labels (`status::done`) require GitLab Premium or Ultimate tier.

## [1.3.0] - 2026-03-18

### Added

- **Multi-repo workspace support**: Detect sub-repos in non-git parent directories, `workspace.json` manifest for repo registry and sync strategy, workspace-aware `hatch3r init --workspace` with auto-detection, `hatch3r config` workspace management (add/remove repos, per-repo overrides, sync strategy)
- **Sync cascade**: `hatch3r sync` propagates content from workspace root to sub-repos with `--repos`, `--dry-run`, `--force`, and `--minimal` flags; copy-based distribution so sub-repos work in isolation
- **Per-repo overrides**: Workspace repos can override tools, features, and content selection (include/exclude lists) relative to workspace defaults
- **`hatch3r status` command**: Check sync status between canonical `.agents/` and generated files, show drifted/missing files, estimated token count, workspace topology with repo sync timestamps
- **`hatch3r validate` command**: Validate `.agents/` structure including cross-references, orchestration dependencies, customizations, hooks, and deny-pattern scanning
- **`hatch3r config` workspace management**: Add/remove sub-repos, toggle sync, change per-repo overrides, switch sync strategy
- **AntiGravity adapter**: 15th platform adapter (`.antigravity/rules.md`, `.antigravity/skills/`, `.antigravity/settings.json`)
- **Enhanced Goose adapter**: Extended configuration generation with MCP server support and structured output
- **20 new agent analysis modes**: architecture, boundary-analysis, codebase-impact, complexity-risk, coverage-analysis, current-state, feature-design, impact-analysis, library-docs, migration-path, prior-art, refactoring-strategy, regression, requirements-elicitation, risk-assessment, risk-prioritization, root-cause, similar-implementation, symptom-trace, test-pattern
- **Shared external knowledge**: `agents/shared/external-knowledge.md` for cross-agent reference material
- **Board shared content supplement**: Additional board command shared content files
- **`.npmrc` with `ignore-scripts=true`**: Prevent lifecycle script execution during install

### Fixed

- **Compound content copy**: Non-prefixed support subdirectories (e.g. `commands/board/`) now correctly copied during `init` and `update` via `copyCompoundContentFiles()`
- **Adapter workspace awareness**: Claude, Cline, Copilot, Cursor, and Windsurf adapters updated to include workspace membership metadata in generated configs

### Changed

- **Init workspace detection**: `hatch3r init` auto-detects multi-repo workspace layout when run in a non-git directory with git subdirectories
- **Sync command signature**: `syncCommand()` now accepts options object (`repos`, `dryRun`, `force`, `minimal`) instead of zero-arg
- **Config command extended**: Workspace repo management integrated into existing `hatch3r config` flow
- **Content index**: `copyCompoundContentFiles()` added for compound content types with nested subdirectories
- **Agent orchestration rule**: Extended with workspace-aware directives
- **Learnings loader agent**: Enhanced with structured knowledge sections and provenance tracking

### Security

- **Audit completion**: 137/137 findings resolved across 4 audit waves (high, medium, low, finalization)
- **Safe path assertions**: Extended `assertSafePath` coverage for compound content paths
- **Content validation**: Strengthened cross-reference and orchestration dependency validation in `validate` command

### Tests

- 10 new/modified test files with ~3,300 lines of new test code:
  - `workspace/sync.test.ts` (451 lines) — workspace sync cascade
  - `content/compound.test.ts` (518 lines) — compound content copy
  - `worktree/resolve.test.ts` (373 lines) — worktree resolution
  - `adapters/snapshots.test.ts` (204 lines) — adapter snapshot tests
  - `workspace/manifest.test.ts` (179 lines) — workspace manifest I/O
  - `workspace/git.test.ts` (157 lines) — git remote parsing
  - `workspace/resolve.test.ts` (157 lines) — repo config resolution
  - `adapters/antigravity.test.ts` (149 lines) — AntiGravity adapter
  - `adapters/amazonq.test.ts` (127 lines) — Amazon Q adapter
  - `workspace/exports.test.ts` (117 lines) — workspace module exports
- Adapter snapshot suite: 574 lines of snapshot coverage
- Total test count: 851 → 1060

### Documentation

- **Workspace guide**: `website/docs/guides/workspace.md` — full setup, manifest reference, sync strategies, per-repo overrides
- **README**: Multi-repo workspace section with directory layout diagram and CLI examples
- **Quick start**: Updated with workspace init instructions
- **CLI commands reference**: Added `status`, `validate` commands; expanded `sync` and `init` flags
- **Configuration reference**: Workspace configuration documentation (+90 lines)

## [1.2.0] - 2026-03-10

### Added

- **Worktree file isolation**: Git worktree support for parallel agent sessions — `.worktreeinclude` generation, `hatch3r worktree-setup` CLI command, `WorktreeConfig` in manifest, auto-enabled for worktree-capable tools (claude), migration checkpoint for existing projects, Claude PostToolUse hook for automatic `git worktree add` detection
- **Dynamic bridge orchestration**: `generateBridgeOrchestration()` reads skills from disk and injects a Skill Dispatch Table into every adapter's bridge output (all 12 adapters migrated from static constant to dynamic generation)
- **Inline skill checklists in AGENTS.md**: `extractSkillChecklist()` pulls condensed steps from skill content (max 20 lines per skill), displayed as "Skill Quick Reference" in canonical AGENTS.md so agents don't need a separate file read
- **Cross-reference validation**: `validateCrossReferences()` scans installed content for broken `hatch3r-*` references between agents, skills, rules, and commands — integrated into `hatch3r validate`
- **Orchestration dependency guard**: `validateOrchestrationDependencies()` warns when content selection is missing pipeline-critical agents (researcher, implementer, reviewer, test-writer, security-auditor) — checks during both `init` and `validate`
- **Spec staleness detection**: `hatch3r sync` compares `docs/specs/` file modification times against latest git commit, warns if oldest spec is >7 days old
- **Spec awareness in agents**: Implementer agent reads `docs/specs/` headers for relevant specifications; reviewer agent cross-references specs against changed files for compliance checks
- **Mandatory behavior #5**: Bridge orchestration adds "Consult specs" directive for all adapters
- **`worktree-create` and `worktree-remove` hook events**: New lifecycle hooks for worktree operations
- **`specs` manifest field**: Tracks project spec paths and generation timestamps in `hatch.json`
- **Worktree configuration in `hatch3r config`**: Interactive prompt for enabling/disabling worktree isolation
- **`test-plan` command**: Plan comprehensive test strategies with parallel researchers (coverage analysis, complexity risk, test pattern extraction, boundary analysis, risk-based prioritization). Produces test plan specs, todo.md entries, and optional ADRs. Supports feature-scoped and module/codebase-level planning. Chains to `hatch3r-test-writer` or `hatch3r-board-fill`.
- 5 new researcher modes for test planning: `coverage-analysis`, `complexity-risk`, `test-pattern`, `boundary-analysis`, `risk-prioritization`
- **Selective init with content presets**: `hatch3r init` now asks project type (greenfield/brownfield), team size (solo/team), and content profile (minimal/standard/full/custom) to install only the content files you need
- Content tagging system: all 105 content files (agents, skills, rules, commands, prompts, hooks, github-agents) tagged with workflow, context, and domain tags for intelligent filtering
- 4 content presets: **Minimal** (core agents/workflows only), **Standard** (full dev lifecycle without niche audits, recommended), **Full** (everything), **Custom** (pick exactly what you need)
- Context-aware filtering: greenfield projects exclude brownfield-only items, solo developers exclude team-only items (board commands, onboard, etc.)
- `hatch3r config` content management: add/remove individual content items post-init via interactive checkbox
- Dynamic `AGENTS.md` generation: `.agents/AGENTS.md` now reflects only installed agents, skills, and commands instead of a static roster
- `ContentSelection` tracking in `hatch.json` manifest for explicit content item tracking
- Legacy migration checkpoint: `hatch3r update` on pre-selective-init projects auto-populates content tracking from disk
- `hatch3r config` CLI command for interactive reconfiguration of tools, MCP servers, features, and platform after init
- Archive system: removed tool outputs are moved to `.hatch3r-archive/<tool>/<timestamp>/` instead of being deleted
- Customization migration: manual customizations outside managed blocks are auto-migrated to `.hatch3r/<type>/<id>.customize.md` when a tool is removed
- Shared `runUpdate()` function extracted from the update command for reuse by config
- Signal handlers (SIGINT/SIGTERM) for graceful CLI shutdown
- OTel GenAI semantic conventions for AI agent observability (gen_ai.* spans, agent invocation, tool call, LLM tracing)
- Tool call audit trail schema in observability rule
- Correlation IDs for agent workflow tracing
- External verification signals (`npm test`, `npm run lint`, `npx tsc --noEmit`) in reviewer agent
- `_hatch3r` metadata markers on generated JSON adapter configs (Claude, Gemini, Cline, OpenCode)
- `protected: true` flag on implementer, fixer, researcher agents

### Fixed

- **Structured hook activation**: All 5 hook-enabled adapters (claude, gemini, cursor, cline, kiro) now emit `HATCH3R_HOOK_ACTIVATED` directives with explicit agent protocol paths instead of generic echo placeholders — 100% of hook-based automation was previously non-functional
- **Claude TaskCompleted hook**: Replaced generic quality gate message with `HATCH3R_QUALITY_GATE` directive listing Phase 3/4 verification checks
- **Claude TeammateIdle hook**: Replaced generic pipeline message with `HATCH3R_PIPELINE_CHECK` directive listing pending Phase 4 specialist tasks
- **Adapter capabilities**: Amp `commands` and Zed `skills` flags corrected in capability matrix
- **MCP filtering**: `readFilteredMcp` now respects `manifest.mcp.servers` selection instead of emitting all servers
- **Website documentation**: stale reference counts, ghost `error-handling` rule reference, `/.agents/` path inconsistencies across 6 docs pages
- **README**: reduced from 514 to 204 lines, bridge adapter count corrected 11→13
- **Bug report template**: Node.js version updated to 22.0.0+ minimum
- **Command files**: 4 stale `.cursor/commands/` paths updated to `.agents/commands/`
- **Content system**: `Error` → `HatchError` for consistent error handling in addContentItem
- Adapter singleton warning array leakage on failed `generate()` calls
- Customization warnings silently dropped in 10 adapters (14 call sites)
- Dead `CANONICAL_AGENTS_MD` constant and unused import removed
- `execFileSync` blocking without timeout — added 30s timeout with SIGTERM kill signal

### Security

- **Atomic writes**: `safeWriteFile` now uses write-to-temp-then-rename pattern to prevent corruption on crash
- **Path traversal guard**: `assertSafePath()` validates all content paths before copy/add/remove operations
- **Symlink detection**: canonical file reader skips symlinks via `lstat()` check to prevent directory traversal
- **Homoglyph normalization**: deny-list scanning normalizes Cyrillic confusables and strips zero-width characters
- **Archive verification**: copy verified via `stat()` before removing source files
- `atomicWriteFile` now used for all manifest writes (`hatch.json`, `.integrity.json`, `.env.mcp`)
- GitHub Actions pinned to SHA digests (11 references across 4 workflows)

### Changed

- **Bridge orchestration is now dynamic**: `BaseAdapter.bridgeHeader()` changed from synchronous (static constant) to async (reads skills from disk), ensuring every adapter's bridge output includes the current skill inventory
- **safeWrite simplified**: Removed `backup` option, `createBackup()`/`writeWithBackup()` functions, and `.backups/` directory. Corrupted managed blocks now rely on git for recovery. `MergeResult.action` no longer includes `"backed-up"`.
- **`docs/specs/` in worktree isolation**: Spec files are now included in worktree copy patterns so parallel agent sessions see project specifications
- **DRY extraction**: 8 shared constants/functions extracted from init.ts and config.ts to `src/cli/shared/constants.ts`
- **`TYPE_TO_SELECTION_KEY`**: content type mapping exported as single constant (was duplicated 3x)
- **Validate command**: refactored from monolithic 362-line function into 9 focused sub-validators
- **CI workflows**: added `permissions: { contents: read }` to ci.yml and pr-checks.yml
- **PRD**: added sections for content system (FR-12), config command (FR-13), archive functionality (FR-14)
- **Competitive analysis**: updated command/MCP counts, docs site status
- **Plugin metadata**: command count updated 33→34
- `hatch3r init --yes` defaults to **standard** preset with auto-detected greenfield/brownfield and solo team size
- `hatch3r update` now respects content selections — only updates files matching the manifest's content selection (legacy projects without selections continue copying everything)
- `hatch3r validate` uses dynamic agent roster from manifest instead of hardcoded agent list
- Init summary box now shows content profile and item count breakdown
- Board commands modularized: `board-shared.md` split into core + 4 sub-files, `board-pickup.md` split into core + 7 sub-files (under `commands/board/`)
- OWASP Agentic Top 10 (ASI01–ASI10) expanded with detection heuristics, code pattern examples, and remediation steps

### Tests

- Added 200 new tests across 4 files: `tags.test.ts` (15), `verify.test.ts` (20), `content/index.test.ts` (71), `config.test.ts` (79)
- New audit test suites: `toml-utils.test.ts` (9 tests), `constants.test.ts` (15 tests), `assertSafePath.test.ts` (19 tests) — +43 tests from audit execution
- Statement/line coverage: 77.54% → 90.5% (threshold: 80%)
- Total test count: 543 → 786

### Audit Execution (103/104 findings resolved — score 79→95)

#### Added
- Amazon Q adapter — 14th platform adapter (`.amazonq/rules/`, `.amazonq/mcp.json`)
- Kiro hook emission via steering file (`.kiro/steering/hatch3r-hooks.md`)
- Goose MCP config emission in `.goosehints`
- MCP setup guide (`website/docs/guides/mcp-setup.md`)
- Adapter depth strategy document (`website/docs/reference/architecture/`)
- Audit domain reports and execution templates (`audit/`)
- Migration checkpoint tests, malformed manifest tests (+65 tests total, 786→851)
- Hook condition fixtures (labels/branches)
- Base adapter error path and branch coverage tests
- Structured reasoning sections in implementer, reviewer, researcher agents
- Provenance tracking and confidence levels for learnings consumption
- Learnings dispute/correction workflow
- Token budget estimation in `hatch3r status`
- Non-JS monorepo markers (Cargo workspaces, Go workspaces, Gradle multi-project, Pants)
- Detected languages stored in manifest for tag filtering
- Content ID collision warnings in content index
- Archive pruning (max 5 entries per tool)
- MCP server name allowlist validation

#### Fixed
- `atomicWriteFile` now calls `fdatasync()` before rename for power-loss safety
- `atomicWriteFile` retries once on `EBUSY`/`EPERM` (Windows AV lock) with 100ms delay
- Managed block auto-repair now creates backup before overwriting
- Deny pattern replacement uses global regex (was only replacing first match)
- Customization input normalized: homoglyphs, boundary markers, zero-width chars, multi-line collapse
- Copilot MCP config key changed from `mcpServers` to `servers`
- Copilot envFile replaced with env object
- Windsurf trigger format corrected to YAML frontmatter
- OpenCode schema URL corrected (`config-schema.json` → `config.json`)
- Claude `teammateMode` updated to documented values
- Aider adapter now uses managed block support
- `unhandledRejection` handler prevents raw stack trace crashes
- Manifest validation now throws descriptive error (was silently returning null)
- Update timeout now shows timeout-specific message via `err.killed`/`err.signal` check
- Exit code 2 for usage/argument errors (POSIX convention)
- Signal handler drains stdout/stderr before exit
- Error messages include help URL (`https://hatch3r.dev/docs/troubleshooting`)
- `runInit` refactored from 12 positional params to `RunInitOptions` interface
- Warning array no longer reset on adapter `generate()` error
- npm pinned to `npm@11.5.1` in release workflow
- Release workflow adds `environment: npm-publish` protection
- Lockfile version synced to match package.json

#### Security
- HMAC integrity replaced with SHA-256 content-addressed hashing
- Greek-to-Latin homoglyph mappings added (~20 codepoints)
- Boundary marker spoofing blocked (strips `MANAGED-BLOCK:*` and `USER-CUSTOMIZATION:*` markers)
- MCP filesystem scope narrowed to exclude `.env.mcp`
- `npx -y` guidance expanded in security patterns
- Integrity manifest documents guarantees and limitations (no signing caveat)
- Structural verification heuristic for rule propagation to sub-agents
- Circuit breaker tracking (CLOSED/OPEN/HALF-OPEN states)

#### Changed
- Bridge orchestration minimized from ~2,500 to ~500 tokens
- Tiered rule inclusion per agent phase role
- PipelineContext schema with correlation IDs and phase handoffs
- Confirmation pass after clean reviewer verdict (non-determinism mitigation)
- Per-task review within multi-task batches
- Research completeness check before implementer handoff
- Canonical severity mapping across agent families
- Stall detection for oscillating fix-break cycles
- Blast radius summary passed from Phase 1 to specialists
- OTel span naming updated to `invoke_agent {gen_ai.agent.name}`
- Adapter capability matrix version updated to v1.2.0
- Kiro removed from Intentional Omissions in capability matrix
- Status codes standardized to SUCCESS/PARTIAL/BLOCKED
- 5 missing rules added to reference docs page
- Introduction file tree updated to show all adapter outputs
- Quick Start MCP server listing expanded

## [1.1.0] - 2026-03-05

### Added

- Multi-platform support: GitHub (default), Azure DevOps, and GitLab as first-class platforms
- Platform auto-detection from git remote during `hatch3r init`
- Azure DevOps MCP server integration (@tiberriver256/mcp-server-azure-devops)
- GitLab MCP server integration (glab mcp)
- 4 new adapter targets: Aider (`CONVENTIONS.md`), Kiro (`kiro.md`, specs), Goose (`.goosehints`), Zed (`.rules`)
- Fixer agent for targeted fix implementation in the agentic review loop
- Agentic review loop: reviewer + fixer cycle (max 3 iterations), four-phase pipeline (research, implement, review loop, final quality)
- Deep context analysis rule for codebase understanding and efficient context management
- `board-groom` command for ongoing backlog refinement (re-prioritize, reclassify, re-scope, archive, decompose, merge duplicates)
- `debug` command for structured root-cause analysis and debugging workflows
- `quick-change` command for small, board-free changes (typos, config tweaks, small refactors)
- `revision` command for structured post-implementation revision with specialist sub-agent delegation
- `hatch3r verify` CLI command for integrity verification of canonical sources
- `hatch3r add` CLI command for community pack installation (coming soon)
- Integrity verification system for validating `.agents/` structure and content
- MCP adapter utilities with TOML configuration support
- Package manager auto-detection (npm, yarn, pnpm, bun)
- Performance budget checks framework
- Migration infrastructure for existing users (`migrateManifest`, update checkpoints)
- Greenfield/brownfield post-init guidance
- Product vision support in `board-fill`
- Board operation batching with single-approval workflow
- Quick/defaults mode for `board-init`
- Docusaurus documentation site with getting started, architecture, configuration, and guide pages
- Agentic process diagrams and workflow documentation
- Cursor-format rule files (`.mdc`) for agent orchestration, deep context, and other rules
- PAT scope documentation with project scope guidance

### Changed

- Agent count expanded from 11 to 16; skills from 22 to 25; rules from 18 to 22; commands from 25 to 34
- MCP servers expanded from 5 to 8 (3 default + 5 opt-in: GitHub, Brave Search, Sentry, Postgres, Linear)
- Review cycle upgraded from single-pass to iterative reviewer + fixer loop (max 3 iterations)
- Board pickup now performs adaptive deep context analysis with complexity scoring and requirements elicitation
- Manifest schema version bumped to 2.0.0 with `namespace`/`project`/`repo` fields replacing `owner`/`repo` (backward-compatible)
- All board commands, agents, rules, and skills support GitHub, Azure DevOps, and GitLab
- All agents use platform-conditional CLI references
- All rules use platform-aware tooling hierarchy
- All command references standardized with `hatch3r-` prefix for consistency
- Quality improvements across all agents, commands, rules, skills, and hooks (100+ content files revised)
- CI matrix expanded to Node 22 + 24 across Ubuntu, macOS, and Windows
- PR checks: added bundle size reporting and conventional commit title validation
- Release workflow: added version tag validation against `package.json`
- Test coverage expanded with new suites for MCP utilities, CLI add command, and integrity verification
- Canonical source path corrected from `/.agents/` to `.agents/` across all references

### Fixed

- Claude Code `.mcp.json` compatibility: env var syntax and type field
- WSL multi-select checkbox rendering
- README command terminology consistency

### Removed

- `hatch3r-error-handling` rule (consolidated into security patterns and code standards)

## [1.0.0] - 2026-02-27

Initial release. Battle-tested agentic coding setup framework with 11 agents, 22 skills, 18 rules, 25 commands, and MCP integrations for Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, and Cline.
