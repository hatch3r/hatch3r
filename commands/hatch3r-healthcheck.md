---
id: hatch3r-healthcheck
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-ui, hatch3r-security]
description: Open a QA and reliability epic surveying coverage gaps, flaky tests, and regression blind spots with one testing sub-issue per module plus cross-module wiring audit
tags: [maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: deep
triage_tiers: [2, 3]
supports_resume: true
sub_agents_spawned:
  count: 3
  rationale: Module-taxonomy discovery and audit-sub-issue authoring delegate to `hatch3r-implementer`; the two cross-cutting QA axes fan out in parallel to `hatch3r-ui` (CQ1 — accessibility / axe-core / design-token / four-state coverage gaps) and `hatch3r-security` (CQ3 — dependency-CVE + supply-chain regression risks). Fan-out is disjoint across the two audit axes; serialization would not preserve P8 B2 task decomposition. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: contradictory inputs, missing target, unknown convention.

## Agent Pipeline

This command discovers the module taxonomy via static analysis, then delegates issue-body authoring and two cross-cutting audit axes to parallel sub-agents via the Task tool. Pipeline:

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context & Pre-flight | Orchestrator (inline) | No | Yes |
| 2. Module Audit Authoring | `hatch3r-implementer` (one Task call per module sub-issue body) | Yes (across modules) | Yes |
| 3. Cross-Cutting QA Axes | `hatch3r-ui` (CQ1) + `hatch3r-security` (CQ3, supply-chain slice) (parallel sub-issue authoring) | Yes | Yes |
| 4. Issue Creation | Orchestrator (GitHub MCP) | No | Yes |
| 5. Board Sync | Orchestrator (Projects v2 sync) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

All issue operations MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

Sub-agent fan-out scales with module count per `rules/fan-out-discipline.md` (P8 B2). For each discovered module, a `hatch3r-implementer` Task call authors that module's audit sub-issue body in parallel; the two cross-cutting audits (`hatch3r-ui` for CQ1 accessibility coverage, `hatch3r-security` for the CQ3 supply-chain slice) run as one parallel batch.

## Triage

Classify the healthcheck request before fan-out:

- **Tier 2 (standard)**: single repository with discovered module count <=8; parallel module sub-agents bounded by `max_phase4_parallel`.
- **Tier 3 (deep)**: monorepo with module count >8 OR cross-module wiring depth >=3; same fan-out shape, longer review loop.

Tier is derived from Module Discovery output (Step 2). Tier 1 is not supported — single-target QA fixes belong to `hatch3r-quick-change`.

Emit the `tier: <2|3> — <module-count summary>` rationale line at classification; per-tier pipeline depth inside the declared tier set defers to `agents/shared/triage-vocabulary.md` → Pipeline pruning per tier.

### Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 4 module audit-authoring fan-out), surface the cost preview so a wide module fan-out is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Tier derived from module count:

```yaml
cost_estimate:
  expected_sa_count: <module count + 2 cross-cutting axes; Tier 2 ~module-count<=8, Tier 3 module-count>8, bounded by max_phase4_parallel per batch>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: standard | deep
  estimated_duration_min: <int>
```

Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering derives from discovered module count, which can misclassify — a monorepo with many small modules over-scored, or a dense single-package repo under-scored. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=standard|deep` forces the named tier, bypassing the module-count auto-classification. `--effort=light` is rejected — Tier 1 is unsupported here (single-target QA fixes route to `hatch3r-quick-change`).
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No `--effort` passed → a persisted `defaultEffort` (`.hatch3r/hatch.json`; `light` rejected here likewise) stands next, else the module-count auto-classification — precedence per `agents/shared/triage-vocabulary.md` → Auto-tiering inputs.

## Confidence Propagation Contract

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Confidence Propagation Contract. Per-command slot: `<readiness-kind>` = module-audit + cross-cutting-axis finding readiness — every authored module-audit sub-issue body and each cross-cutting axis finding MUST carry the high/medium/low confidence rating sourced from the authoring sub-agent; dropping the signal between stages is a gate failure.

# Healthcheck — Full Product QA & Testing Audit

Create a healthcheck epic on **{owner}/{repo}** with one sub-issue per logical project module, plus cross-module wiring and vision/roadmap alignment audits. Each sub-issue is a deep static-analysis audit task that, when picked up by the board workflow, produces a findings epic with actionable sub-issues for achieving full QA and testing coverage. The command only creates the initial audit epic — it does NOT execute any audits.

---

## Shared Context

**Read the project's shared board context at the start of the run** (e.g., `commands/hatch3r-board-shared/SKILL.md` or equivalent). It contains GitHub Context, Project Reference, Projects v2 sync procedure, and Board Overview template. Cache all values for the duration of this run.

## Token-Saving Directives

Follow any **Token-Saving Directives** in the shared context file.

---

## Module Discovery

> Epic-audit scaffold: see `commands/shared/epic-audit-frame.md` → Module Discovery. Per-command slot: spec-kind = primary specs (the general form — map each module to its relevant spec files).

Plus two cross-cutting audits:

| # | Audit | Scope |
|---|-------|-------|
| W | Cross-Module Wiring | Integration points between all modules |
| R | Product vs Vision, Roadmap & Concept Alignment | Implementation vs product vision, roadmap, and specs |

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Load Context & Pre-Flight Check

1. Read the shared board context and cache GitHub Context, Projects v2 config, and sync procedure.
2. If `docs/specs/00_glossary.md` exists, read the first 30 lines for TOC/section headers.
3. Scan for existing healthcheck epics: `search_issues` with `owner: {owner}`, `repo: {repo}`, query `label:meta:healthcheck state:open`.
4. If an open healthcheck epic exists:

**ASK:** "An open healthcheck epic already exists: #{number} — {title}. (a) Abort, (b) close the existing one and create a new healthcheck, (c) proceed and create a second healthcheck."

5. Fetch all open issues (`list_issues`, paginate, exclude `meta:board-overview`). Cache for Board Overview regeneration in Step 7.

---

### Step 2: Determine Audit Modules

1. Build the module taxonomy from directory structure (see Module Discovery above).
2. If the user specified specific modules in their invocation, filter the taxonomy to only those modules. The two cross-cutting audits (Wiring, Roadmap) are always included unless the user explicitly excludes them.
3. Validate that the directories for each selected module exist in the workspace. Warn if any directory is missing.

Present the selected modules:

```
Healthcheck Audit Scope:

Level 1 (parallel):
  1. {Module 1} — {path}/
  2. {Module 2} — {path}/
  ...

Level 2 (after all Level 1 complete):
  W. Cross-Module Wiring — integration points
  R. Product vs Vision, Roadmap & Concept Alignment — vision + roadmap + specs
```

**ASK:** "These modules will be audited. Confirm, add, or remove modules."

---

### Step 3: Create Healthcheck Epic

Create the parent epic via `issue_write` with `method: create`, `owner: {owner}`, `repo: {repo}`.

**Title:** `[Healthcheck]: Full Product QA & Testing Audit`

**Labels:** `type:epic`, `meta:healthcheck`, `status:ready`, `executor:agent`, `priority:p1`, `area:testing`

**Body:**

```markdown
## Overview

Full-product healthcheck audit covering {N} logical modules plus cross-module wiring and roadmap alignment analysis. Each sub-issue performs a deep static analysis of one module and produces a findings epic with actionable sub-issues for achieving full QA and testing coverage.

## Sub-Issues

### Level 1 — Module Audits (parallel)

- [ ] #{part-1} — Audit: {Module 1}
- [ ] #{part-2} — Audit: {Module 2}
      ...

### Level 2 — Cross-Cutting Audits (after all Level 1)

- [ ] #{wiring} — Audit: Cross-Module Wiring
- [ ] #{roadmap} — Audit: Product vs Vision, Roadmap & Concept Alignment

## Implementation Order

### 1

- [ ] #{part-1} — Audit: {Module 1}
- [ ] #{part-2} — Audit: {Module 2}
      ...all module audits...

### 2 -- after #{part-1}, #{part-2}, ... #{part-N}

- [ ] #{wiring} — Audit: Cross-Module Wiring
- [ ] #{roadmap} — Audit: Product vs Vision, Roadmap & Concept Alignment

## Acceptance Criteria

- [ ] All sub-issue audits completed
- [ ] One findings epic created per audited module (with `meta:healthcheck-findings` label)
- [ ] All findings epics have sub-issues with acceptance criteria
- [ ] All findings epics integrated into Projects v2 board
- [ ] Cross-cutting findings epics have correct dependencies on module findings epics

## Dependencies

None.
```

Record the returned `number` and internal numeric `id` for the epic.

---

### Step 4: Create Module Audit Sub-Issues

For each module in the selected taxonomy, create a sub-issue via `issue_write` with `method: create`.

**Title:** `Audit: {Module Name}`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`

**Body:** Use the Module Audit Sub-Issue Template below, filling in the module-specific fields.

After creating each sub-issue, link it to the parent epic via `sub_issue_write` with `method: add`, using the parent `issue_number` and the child's internal numeric `id`.

Record all returned sub-issue numbers for use in Step 5.

#### Module Audit Sub-Issue Template

```markdown
## Audit: {Module Name}

> Parent: #{healthcheck-epic-number} — [Healthcheck]: Full Product QA & Testing Audit

### Scope

**Directories:** {comma-separated directory paths from taxonomy}
**Primary Specs:** {spec filenames from taxonomy}
**Test Directories:** Search `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/rules/` for files matching this module.

### Audit Protocol

Perform a deep static analysis of this module. Do NOT execute tests or modify code — review source files, spec documents, and existing test files only.

#### 1. Test Coverage Analysis

- List all exported functions, classes, and modules in the scope directories
- Map each to existing test files in `tests/`
- Identify untested code paths and missing test scenarios
- Assess test quality: meaningful assertions, edge cases, error paths

#### 2. Spec Compliance

- Read the referenced specs fully
- Compare implementation against every requirement in the spec
- Flag deviations, partial implementations, and missing features

#### 3. Testing Pyramid Assessment

- Unit tests: coverage percentage estimate and quality assessment
- Integration tests: cross-module interactions and contract tests
- E2E tests: critical user flows covered for this module
- Security tests: invariants validated
- Performance tests: budget compliance verified

#### 4. Code Quality

- Error handling completeness (all error paths covered)
- Edge case coverage (boundary values, empty states, overflow)
- Input validation at module boundaries
- TypeScript strict mode compliance (no `any`, no `@ts-ignore` without linked issue)
- Max function length and file length compliance per project standards

#### 5. Performance & Privacy

- Performance budget compliance per project quality docs
- Privacy invariant adherence per project security docs

### Output — Findings Epic

After completing the audit, create a findings epic on GitHub.

**Create via `issue_write`:**

- **Title:** `[QA Findings]: {Module Name}`
- **Labels:** `type:epic`, `meta:healthcheck-findings`, `status:ready`, `executor:agent`, `priority:p1`
- **Body:** Overview of findings count and severity, sub-issues checklist, implementation order, acceptance criteria ("done when all finding sub-issues are resolved").

**Create sub-issues** — one per actionable finding. Each must include:

- Problem description with evidence (file paths, line references, spec section)
- Suggested fix approach
- Acceptance criteria (specific and testable)
- Labels: `type:qa` for test gaps, `type:bug` for spec deviations, `type:refactor` for code quality, plus relevant `area:*` label

**Link sub-issues** to the findings epic via `sub_issue_write`.

**Board integration** — for the findings epic and every sub-issue:

Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary). Set status to Ready using the project's status field option ID.

### Completion

Return to the parent orchestrator with:

- Findings epic issue number
- Total findings count
- Breakdown by type (test gaps, spec deviations, code quality, performance, privacy)
- Any blockers encountered
```

---

### Step 5: Create Cross-Cutting Audit Sub-Issues

Create two additional sub-issues with dependencies on all module audit sub-issues.

#### 5a. Cross-Module Wiring Audit

**Title:** `Audit: Cross-Module Wiring`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`, `has-dependencies`

**Body:** Scope: Analyze integration points between all project modules. This audit runs AFTER all module audits complete — use their findings for additional context. Follow the same Output — Findings Epic instructions as module audits. Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}

Link to parent epic via `sub_issue_write`.

#### 5b. Product vs Vision, Roadmap & Concept Alignment Audit

**Title:** `Audit: Product vs Vision, Roadmap & Concept Alignment`

**Labels:** `type:qa`, `status:ready`, `executor:agent`, `priority:p1`, `has-dependencies`

**Body:** Scope: Compare the current implementation against the product vision, roadmap, and all specification documents. This audit runs AFTER all module audits complete. Include Dependencies section: Blocked by #{part-audit-1}, #{part-audit-2}, ... #{part-audit-N}. Follow the same Output — Findings Epic instructions.

Link to parent epic via `sub_issue_write`.

---

### Step 6: Finalize Epic & Set Dependencies

1. **Update the healthcheck epic body** with the actual sub-issue numbers in the Sub-Issues checklist and Implementation Order section. Use `issue_write` with `method: update`.

2. **Verify dependency sections** on the wiring and roadmap sub-issues contain the correct module audit sub-issue numbers.

3. Present a summary with epic number, sub-issues, and total count.

---

### Step 7: Board Integration

> Epic-audit scaffold: see `commands/shared/epic-audit-frame.md` → Board Integration. Per-command slot: epic-kind = "healthcheck".

---

## Resumability (Decision 27/30)

healthcheck is long-running — module discovery (Step 2) seeds a per-module hatch3r-implementer fan-out for audit sub-issue authoring (Step 4) bounded by `max_phase4_parallel`, alongside parallel hatch3r-ui (CQ1) + hatch3r-security (CQ3 supply-chain slice) cross-cutting axes (Step 5), then Step 6 batch-creates GitHub issues and Step 7 syncs Projects v2 board state. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-creating issues or re-running implementers for modules already audited.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.healthcheck-workspace/`; step range the Step 1 → Step 7 progression; `wave` = per-module implementer-batch index across modules and the cross-cutting axes batch; snapshot/rollback paths any module-audit-spec writes under `docs/audits/`. Write points: after Step 2 module discovery locks `discoveredModules`, after each Step 4 implementer batch returns per `max_phase4_parallel` slot (so completed audit-sub-issue bodies survive a crash and are not re-authored), after the Step 5 cross-cutting axes batch returns, after each Step 6 GitHub issue create call records its `issueId` in `createdIssueIds` (so already-created issues survive a crash and are not re-created — the resume path skips issues with an entry in `createdIssueIds`), after Step 6 epic-link creation, and after Step 7 Projects v2 board sync completes.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for healthcheck: `1` = scope + maturity-tier detection, `2` = specialist sub-agent dispatch across health dimensions, `3` = severity-graded aggregation + finding-registry update, `4` = epic/issue write + iteration-summary.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: findings epic, child issues, registry updates.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in the Pre-Execution Cost Preview above before the first module audit-authoring dispatch (Step 4).
- **Post-execution `cost_actuals` + `delta`** — the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 3`, which is the static floor; actual fan-out scales with discovered module count per `rules/fan-out-discipline.md` P8 B2): one `hatch3r-implementer` Task per module sub-issue body + `hatch3r-ui` (CQ1) + `hatch3r-security` (CQ3 supply-chain slice) for the two cross-cutting axes. Tier 2 (module count ≤8) and Tier 3 (module count >8) both bound the parallel module batch by `max_phase4_parallel`. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

> Epic-audit scaffold: see `commands/shared/epic-audit-frame.md` → Error Handling. Per-command slot: epic-kind = "healthcheck".

## Guardrails

> Epic-audit scaffold: see `commands/shared/epic-audit-frame.md` → Guardrails. Per-command slot: epic-label = `healthcheck`; no command-specific extra guardrails.
