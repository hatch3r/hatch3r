---
id: hatch3r-workflow
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-reviewer, hatch3r-fixer, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-ui, hatch3r-ux, hatch3r-security, hatch3r-reliability, hatch3r-testability, hatch3r-scalability, hatch3r-performance, hatch3r-maintainability, hatch3r-enhancability, hatch3r-edge-case-analyst]
description: Guided development lifecycle with 4 phases (Analyze, Plan, Implement, Review) and scale-adaptive Quick Mode for small tasks; --plan-file executes an approved plan document without re-deriving it.
argument-hint: "[--plan-file=<path>] [--mode=full|quick] [--effort=light|standard|deep] [--confidence-floor=any|medium|high] [--auto]"
disable-model-invocation: true
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 15
  rationale: Full delivery pipeline across the canonical phases (1 Research → 2 Implement → 3 Review Loop → 4 Final Quality per the Phase Crosswalk) — researcher (canonical phase 1), implementer (one per independent module, canonical phase 2), reviewer ↔ fixer review loop (canonical phase 3), then a parallel Final-Quality batch (canonical phase 4 — docs-writer + lint-fixer + CQ1-CQ9 vector specialists ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability — testability and security cover the always-on test + security gates) bounded by max_phase4_parallel. The count of 15 is the standard Full Tier 3 fan-out; `hatch3r-edge-case-analyst` is listed as a conditional CQ4/CQ5 supporting analyst (phase_4_trigger-gated on multi-entity wiring), spawned beyond the baseline only when the diff wires ≥2 domain entities. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: unstated mode (Full vs Quick) or effort tier when scope is ambiguous; a target spanning >1 module with no stated boundary; acceptance criteria absent from the issue or description; a requested change that alters user-visible behavior beyond the issue's stated scope; a stale plan file (freshness drift between a `--plan-file` plan and the files it names — see 1a-plan).

# Development Workflow -- Guided Lifecycle for Structured Implementation

Optional guided development lifecycle command that walks through structured phases — Analyze, Plan, Implement, Review — using hatch3r's existing agents and skills. Includes a Quick Mode that collapses phases for small tasks. Scale-adaptive: detects task complexity and recommends the appropriate mode. `/workflow` is the standalone (no-board) delivery path; `hatch3r-board-pickup` runs this same 4-phase pipeline inline (see `commands/board/pickup-delegation.md`) rather than invoking this command — same pipeline shape, separate entry points.

---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (modes by task type) | Per focus area | Yes (skip for trivial edits) |
| 2. Implementation | `hatch3r-implementer` (one per module) | Yes (independent modules) | Yes |
| 3a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations until clean) | No (sequential loop) | Yes |
| 3b. Final Quality — Testing | `hatch3r-testability` | Yes | Yes (code changes) |
| 3c. Final Quality — Security | `hatch3r-security` | Yes | Yes (code changes) |
| 3d. Final Quality — Docs | `hatch3r-docs-writer` | Yes | When APIs/architecture/UX affected |
| 3e. Final Quality — Triggered | `hatch3r-lint-fixer` + `hatch3r-ui` + `hatch3r-ux` (mandatory-on-match — each triggered one MUST spawn as its own dedicated instance at Tier 2/3) + the conditional CQ specialists (`hatch3r-reliability`, `hatch3r-scalability`, `hatch3r-performance`, `hatch3r-maintainability`, `hatch3r-enhancability`) per `SPECIALIST_TRIGGER_TABLE` | Yes | Spawn each whose trigger matches the diff |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above (multi-module implementers in Phase 3, the Phase-4b final-quality batch) holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

### Phase Crosswalk (canonical integer ↔ workflow narrative)

The canonical four-phase pipeline — **1 Research, 2 Implement, 3 Review Loop, 4 Final Quality** (`rules/hatch3r-agent-orchestration.md` → The Rule, typed as the `PipelineContext` phase slices in `src/pipeline/pipelineContext.ts`) — is the only coordinate system typed consumers accept: `validatePhaseTransition(context, targetPhase)`, `SnapshotRef.afterPhase`, `PHASE_SKIP_CRITERIA[].phase`, and the `[hatch3r-pipeline: phase N]` per-turn header all take the canonical integer. This command's narrative uses its own labels; translate at every typed boundary (Finding D7-SA7.1-01):

| Canonical phase (typed integer) | Full Mode narrative | Quick Mode | Agent-Pipeline stage above |
|---------------------------------|---------------------|------------|----------------------------|
| **1 — Research** | Phase 1 (Analyze) + Phase 2 (Plan — the orchestrator plan gate inside canonical Phase 1) | Quick Step 1 | 1. Research |
| **2 — Implement** | Phase 3 (Implement) | Quick Step 2 | 2. Implementation |
| **3 — Review Loop** | Phase 4a (Review Loop) | Quick Step 3 Stage 1 | 3a. Review Loop |
| **4 — Final Quality** | Phase 4b–4e (Final Quality) | Quick Step 3 Stage 2 | 3b–3e. Final Quality |

Never feed a narrative phase number into a typed consumer: narrative "Phase 3 (Implement)" validates as `validatePhaseTransition(context, 2)`, and a checkpoint `SnapshotRef.afterPhase: 3` restores to post-Review-Loop state (narrative 4a complete), not post-Implement.

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

> Browser-verification contract (spec-first, tiered): see `commands/shared/orchestration-frame.md` → Browser Verification (opt-in); protocol home `rules/hatch3r-browser-verification.md`. Per-command slot: when enabled, the implementation (Phase 3) and review (Phase 4) stages run browser-verification steps on UI-affecting changes; if declined, skip every browser-verification step for the session and do not re-ask.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Global Rule Overrides

- **Git commands are fully permitted** during Phase 3 (Implement), including `git add`, `git commit`, and `git push`. This override applies to delegated skills and sub-agents invoked during implementation.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces merge-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

Absent-confidence clause (D13-SA13.2-F3): a clean verdict (0 Critical + 0 Warning) whose reviewer `confidence` field is absent or unparseable is treated as `confidence: low` at every gate — trigger the second pass / ASK, never proceed. This matches the code gate in `src/pipeline/reviewLoop.ts` (`evaluateReviewGate`), where an `unknown`/absent confidence ranks below `low` (`CONFIDENCE_RANK.unknown = 0`) and so does not pass. A prose gate that reads `confidence != low` would otherwise let absence pass silently — inverting the code gate. Resolve absence to `low` before applying the Step 0.7 floor.

---

## Triage

Classify the development task before delegating. Detailed mode classification runs in Step 0 (Triage / Scale-Adaptive Mode Selection); this section summarizes the routing:

- **Tier 1 (trivial)**: single-line edit, typo, or trivial config change; Quick Mode runs the streamlined 3-step path. The B1 ambiguity gate (`§0 Detect Ambiguity` per `.claude/rules/clarification-default.md`) is NEVER skipped — Tier 1 admission already requires that the brief alone be testable, single-file, and single-concern, so the gate evaluates trivially and passes silently when those preconditions hold. ASK checkpoints downstream of the brief (mid-plan, end-of-implementation, mid-review) are reduced to one consolidated end-of-run "merge or revise?" prompt rather than per-phase prompts — Tier 1 work is short enough that incremental ASK fatigue would dominate the workflow without proportional benefit. Any mid-run ambiguity that wasn't visible at the brief surface re-invokes the B1 protocol on the spot. This satisfies P8 B1 default-not-exception: the protocol still applies; the checkpoint cadence is right-sized (Finding D7-M11 / D7-SA7.4-4).
- **Tier 2 (standard)**: bug fix or small feature in 1–3 files; Quick Mode with full sub-agent delegation (researcher, implementer, reviewer, fixer, hatch3r-testability, hatch3r-security).
- **Tier 3 (deep)**: multi-module feature, architectural change, or cross-cutting refactor; Full Mode with all 4 phases (Analyze, Plan, Implement, Review) and deep research before mutating files.

If Tier 1, take Quick Mode with reduced sub-agent prompts. If Tier 2, take Quick Mode below. If Tier 3, switch to Full Mode and confirm the plan with the user before implementation.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. For every ASK checkpoint, use the platform-native question tool per `agents/shared/user-question-protocol.md`.

### Step 0: Triage (Scale-Adaptive Mode Selection)

Assess the task to recommend a mode.

#### Complexity Signals for Full Mode

- Multiple files or modules affected
- Architectural decisions needed
- New dependencies or integrations
- Security-sensitive changes
- Cross-cutting concerns (database schema, API contracts, event schemas)
- Estimated effort > 1 day
- Task is an epic or has sub-issues

#### Complexity Signals for Quick Mode

- Single file change
- Bug fix with clear reproduction
- Small refactor (rename, extract function)
- Documentation update
- Test addition for existing code
- Estimated effort < 2 hours

#### Assessment

Evaluate the task against both signal sets. Count matching signals to determine recommendation. Emit the mandatory tier line before the ASK — `tier: <1|2|3> — <signal summary>` per `agents/shared/triage-vocabulary.md` → Auto-tiering inputs (absent signals select Tier 2 — Standard, never Deep). When the selection lands on Tier 2 or 3 for a task whose surface reads small (single file named, short description), the rationale MUST name which signal drove the escalation — module span, decision class, or AC clarity.

**ASK:** "Task: {user's task description}. Complexity assessment: {assessment}. Recommended mode: {Full/Quick}. Proceed with {recommended}? (yes / switch to {other} / let me decide per phase)"

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Phase 1 / Quick Step 1), surface the cost preview to the user so a multi-agent run is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the triage tier selected in Step 0:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Quick Tier 1 ~2, Quick Tier 2 ~6, Full Tier 3 up to 15>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Step 0.6: Effort Override (Decision 17)

Auto-tiering (Step 0 mode selection) can misclassify — a single-file edit scored as Full Mode, or a cross-cutting refactor scored as Quick Mode. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier (light → Quick Tier 1, standard → Quick Tier 2, deep → Full Tier 3), bypassing the Step 0 auto-classification. This composes with the existing `--mode=full|quick` flag: an explicit `--mode` wins over the `--effort`-derived mode.
- `--mode=quick` with no explicit `--effort` is the Tier-1 entry point: it maps to `--effort=light` (Quick Tier 1). Pair `--mode=quick --effort=standard` to run Quick Mode at Tier 2.
- **Tier-source precedence** (`agents/shared/triage-vocabulary.md` → Auto-tiering inputs): explicit `--effort` flag > persisted `defaultEffort` scalar in `.hatch3r/hatch.json` > Step 0 auto-classification. When `defaultEffort` supplies the tier, record the source in the run context and in the emitted `tier:` rationale line.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- The override never disables the Safety Guardrails (destructive operations, breaking changes, open questions, quality-gate failures always stop) — those are mode-independent.
- Neither an `--effort`/`--mode` flag nor a persisted `defaultEffort` present → the Step 0 auto-classification stands.

### Step 0.7: Confidence Floor (Decision 16 / D13-SA13.3-F13.3.3)

`--effort` calibrates work-effort depth; `--confidence-floor` calibrates the confidence threshold at which the review gate blocks. They are orthogonal — a Tier 1 typo fix and a Tier 3 refactor can each carry any floor. This is the user's pre-flight assertiveness knob (the forced-second-pass on low confidence in Phase 4a is post-hoc; the floor lets the user set the bar before the run):

- `--confidence-floor=any|medium|high` (default `any`). Resolution order: explicit flag wins over the persisted `hatch3r config confidence_floor=...` default, which wins over the built-in `any`.
- **`any`** (current behavior): the Phase 4a confidence-aware gate forces a second reviewer pass only when reviewer confidence `== low` with 0 Critical + 0 Warning.
- **`medium`**: force a second pass on ANY finding rated `confidence == low`, even with 0 Critical + 0 Warning.
- **`high`**: force a second pass on any finding rated `confidence != high`, AND ASK the user on every low-confidence finding regardless of severity.
- Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`. The floor never relaxes a Safety Guardrail — it only tightens the second-pass / ASK trigger.

---

## Full Mode

### Phase 1: Analyze

**Goal:** Fully understand the task, its context, and constraints before writing any code.

#### 1a. Parse the Task

- **Plan file (--plan-file):** an approved plan document is the task source — run the Plan-File Intake below (1a-plan) instead of deriving the task from an issue or description.
- **GitHub issue:** Read issue body, acceptance criteria, labels, parent epic context using `gh issue view` (fall back to `issue_read` MCP).
- **User description:** Extract requirements, scope, constraints from the provided description.
- **No board-pickup handoff:** `/workflow` runs standalone, so Phase 1a always fetches issue context fresh; `hatch3r-board-pickup` gathers its own context inside its inline pipeline and does not invoke this command (see Integration with Board Workflow).

#### 1a-plan. Plan-File Intake

Runs only when `--plan-file=<path>` is passed — typically pasted from the Plan-Execution Handoff block a `plan_handoff: true` planning command emitted (`commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block)).

1. **Existence guard.** If `<path>` does not resolve to a file, stop with this actionable error and do not proceed:

   > Plan file not found: `<path>`. Check the planning output directories — `docs/specs/`, `docs/investigations/`, `docs/migrations/`, `docs/rework/`, `docs/plans/`, `docs/api/` — for the plan document, or re-run `/hatch3r-workflow` without `--plan-file` and describe the task instead.

2. **Parse the plan into task context:** scope, acceptance criteria, files to create/modify, implementation order, dependencies, constraints/ADR references, and out-of-scope items.
3. **Freshness guard.** For each file the plan names, compare its last-commit time (`git log -1 --format=%cI -- <file>`) against the plan document's own last-commit time (for an uncommitted plan, use its working-tree mtime). If any named file is newer than the plan, list the drifted files and **ASK:** "(a) proceed — drift is compatible with the plan (b) re-validate the plan first — re-run the producing planning command (c) abort". Never execute a stale plan silently.
4. **Skip re-derivation.** Phase 1b scores complexity from the plan's stated scope; Phase 1c loads ONLY the specs/ADRs the plan references; Phase 2a presents the PARSED plan — **ASK:** "Execute this plan as written? (yes / adjust / re-plan)" — instead of drafting a new one. Phases 3–4 run unchanged.
5. **Conflicting sources.** `--plan-file` combined with a GitHub issue or user description → ASK which source is authoritative before parsing anything.

Quick Mode's Step 1 accepts `--plan-file` identically (same guards, same parsed-plan presentation). Recommend Quick Mode when the plan lists ≤3 files.

#### 1b. Complexity Scoring and Deep Context

Score the task's complexity per the `hatch3r-deep-context` rule to determine the analysis tier (Light / Standard / Deep). This determines which additional researcher modes run in Step 3a alongside the standard task-type modes.

For **Tier 2 and Tier 3** tasks, spawn the tier-appropriate researcher modes now (in parallel with context loading):

- **Tier 2**: `requirements-elicitation` at `quick` depth + `similar-implementation` at `quick` depth
- **Tier 3**: `requirements-elicitation` at `deep` depth + `similar-implementation` at `deep` depth + `codebase-impact` at `deep` depth (with transitive tracing)

Cache the researcher outputs for use in Phase 2 and Phase 3.

#### 1c. Load Relevant Context

1. Read project specs from `docs/specs/` — headers first (~30 lines), expand relevant sections only.
2. Read ADRs that might constrain the approach.
3. Scan existing code in the affected area using targeted file reads and searches.
4. Use **Context7 MCP** (`resolve-library-id` then `query-docs`) for external library documentation referenced by the task.
5. Use **web research** for current best practices, security advisories, or novel problems not covered by local docs or Context7.

#### 1d. Consult Learnings

If `.hatch3r/learnings/` exists:

1. Search for learnings tagged with relevant areas or technologies.
2. Surface any applicable past experiences that inform this task.

#### 1e. Present Analysis

```
Task Analysis:
  Complexity: Tier {1/2/3} ({Light/Standard/Deep}) — score {N}
  Scope: {what's in / what's out}
  Affected files: {list}
  Blast radius: {N direct + M transitive files at risk} (Tier 3 only)
  Similar implementations found: {reference names} (Tier 2/3 only)
  Constraints: {from specs, ADRs}
  Relevant learnings: {if any}
  Open questions: {if any — including unresolved requirements-elicitation questions}
  Cross-cutting concerns: {list with addressed/unaddressed status} (Tier 2/3 only)
  Risk: {low/med/high}
```

**For Tier 2:** Present the `requirements-elicitation` questions inline and await answers before proceeding.

**For Tier 3:** Present a full Pre-Implementation Summary per the `hatch3r-deep-context` rule. Do NOT proceed until all unresolved questions are answered.

**ASK:** "Analysis complete. {Unresolved questions list, if any}. Proceed to Plan phase? (yes / clarify questions first / adjust scope)"

---

### Phase 2: Plan

**Goal:** Design the solution before implementing.

**Research-completeness directive (P8 B2).** If the Plan phase discovers unknowns not covered by Phase 1 research, spawn additional researcher modes before Phase 3 (Implementation). Do not defer research unknowns to implementation time. Spawning more researcher sub-agents is cheaper than discovered rework.

#### 2a. Draft Implementation Plan

1. List all files to create or modify.
2. For each file: describe the specific changes.
3. Identify test requirements (unit, integration, e2e).
4. Note any dependency changes needed.
5. Consider rollback strategy for risky changes.
6. **Convention alignment** (Tier 2/3 only): If `similar-implementation` output is available from Phase 1, specify which reference implementation's conventions the plan follows for file structure, state management, error handling, data fetching, and testing. Note planned divergences with justification.

#### 2b. Select hatch3r Agents and Skills

Map the task type to the appropriate skill:

| Task Type        | Skill                          |
| ---------------- | ------------------------------ |
| Bug report       | hatch3r-bug-fix                |
| Feature request  | hatch3r-feature                |
| Code refactor    | hatch3r-refactor               |
| Logical refactor | hatch3r-logical-refactor       |
| Visual refactor  | hatch3r-visual-refactor        |
| QA validation    | hatch3r-qa-validation          |

Identify supporting agents needed: hatch3r-testability, docs-writer, reviewer, hatch3r-security.

#### 2c. Identify Risks

- Breaking changes? Migration needed?
- Performance implications?
- Security implications?

#### 2d. Present Plan

```
Implementation Plan:
  Approach: {description}
  Skill: {selected hatch3r skill}
  Convention reference: {reference module name — "following patterns from X"} (Tier 2/3 only)
  Files to modify: {list with change descriptions}
  New files: {list}
  Tests: {what to test}
  Risks: {list with mitigations}
  Resolved requirements: {N}/{M} answered (Tier 2/3 only)
  Estimated effort: {time}
```

**ASK:** "Plan ready. Proceed to Implement? (yes / revise plan / request review of plan first)"

---

### Phase 3: Implement

**Goal:** Execute the plan using the selected hatch3r skill, delegating to sub-agents per the Universal sub-agent Pipeline.

#### 3a. Context Gathering (Researcher sub-agent)

You MUST spawn a `hatch3r-researcher` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) before implementation. Phase-skip conditions per `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria (canonical `PHASE_SKIP_CRITERIA`) — skip Phase 1 on a trivial single-line edit, a Tier-1 single-file change with no cross-module impact, or when research is already cached; do not invent a command-specific skip rule.

- Select research modes by task type (bug → symptom-trace/root-cause/codebase-impact, feature → codebase-impact/feature-design/architecture, refactor → current-state/refactoring-strategy/migration-path, QA → codebase-impact).
- Add tier-appropriate modes per the `hatch3r-deep-context` rule if not already run in Phase 1 Step 1b.
- Use depth `quick` for low-risk, `standard` for medium-risk, `deep` for high-risk. The complexity tier may override depth upward.
- **Question decomposition (K-parallel-researcher path, per `rules/hatch3r-agent-orchestration.md` → Scaling Heuristic):** when the task decomposes into ≥2 independent research questions — answers that do not depend on each other (e.g. "what is the current auth flow?" and "what does the billing webhook expect?" for a cross-cutting feature) — spawn one `hatch3r-researcher` sub-agent per question in parallel (each scoped to its question with the modes above), then union their structured findings into a single Phase-1 brief before Step 3b. This is the parallel-safe Phase-1 case (read-only, deterministic union, no shared mutable state per the Three Conditions to Parallelize). Keep the single-researcher path for a single-question task; do not serialize independent questions to save tokens (P8 dominates P7).
- Await the researcher result(s). Use the structured output (unioned across researchers when fanned out) to inform Step 3b.

#### 3b. Core Implementation (Implementer sub-agent)

You MUST spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Do NOT implement inline — always delegate to a dedicated implementer.

1. Read the matching hatch3r skill file and include it in the implementer prompt.
2. Do NOT execute the skill's PR creation steps inline — standalone `/workflow` leaves the PR decision to the user at the end of Phase 4 (see Integration with Board Workflow). (`hatch3r-board-pickup` owns PR creation in its own inline pipeline, Steps 7a–8 — not via this command.)
3. For tasks spanning multiple independent parts, spawn one `hatch3r-implementer` per independent module. Launch as many in parallel as the platform supports.
4. Coordinate changes across files to avoid conflicts.
5. Allocate each implementer's model class per `rules/hatch3r-model-allocation.md` (matrix: `max(agent floor, task-tier class)`, passed explicitly per spawn) and scope each spawn prompt per `rules/hatch3r-context-budget.md` (paths + line ranges over file bodies; ≤15k-token input frame; distilled-return contract stated in the prompt).

The implementer sub-agent prompt MUST include:
- The task description, acceptance criteria, and type.
- The researcher output from Step 3a (if not skipped).
- The selected hatch3r skill name and instructions.
- All `scope: always` rule directives from `rules/`.
- Relevant learnings from `.hatch3r/learnings/`.
- Explicit instruction: do NOT create branches, commits, or PRs.
- **Reference conventions** from `similar-implementation` output (Tier 2/3) — triggers the implementer's Convention Lock step.
- **Resolved requirements** from `requirements-elicitation` answers (Tier 2/3) — explicit decisions on ambiguities.
- **Blast radius data** from enhanced `codebase-impact` (Tier 3) — transitive dependency trace and API consumer map.
- `correlation_id` (UUID v4 generated per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID) — the sub-agent echoes it in logs, outputs, and status reports for cross-phase attribution.
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Await the implementer sub-agent. Collect its structured result.

#### 3c. Track Progress

1. Mark completed items from the plan.
2. Note any deviations from the plan and the reasoning.

#### 3d. Run Quality Checks

Run the project's quality checks (adapt to project conventions; resolved to the project's language-aware command set at sync time, fallback when detection is unknown: `npm run lint && npm run typecheck && npm run test`):

```bash
${HATCH3R:VERIFY_GATE_ALL}
```

Fix any issues before proceeding. If quality checks fail, loop back and resolve before advancing to Phase 4.

**ASK:** "Implementation complete. All quality checks pass. Confidence in implementation quality: {high/medium/low per the quality charter §1 verification-method framing (`agents/shared/quality-charter.md`) — high = verified via tests/code, medium = pattern-based and not independently verified, low = best judgment}. Proceed to Review? (yes / fix issues first)"

---

### Phase 4: Review (sub-agent Quality Pipeline)

**Goal:** Verify quality and completeness via a two-stage sub-agent pipeline before finalizing. The Review Loop (4a) iterates until code quality is clean, then Final Quality (4b) runs remaining specialists in parallel.

#### 4a. Review Loop (Reviewer → Fixer)

Spawn a `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Include the diff and acceptance criteria in the prompt.

1. **Review:** Await the reviewer result. Extract Critical and Warning findings, the reviewer verdict (`APPROVE` / `REQUEST CHANGES` / `DESIGN_OBJECTION`), AND the reviewer's top-level `confidence` field (high/medium/low).
   - **Design-objection early exit (before the confidence gate and any fixer dispatch):** If the reviewer verdict is `DESIGN_OBJECTION` — a fundamental design flaw that cannot be fixed by iterating on the current code, distinct from Critical/Warning findings (`agents/hatch3r-reviewer.md` → Review Verdicts; Review Loop Termination Conditions #2) — do NOT run the confidence gate and do NOT spawn `hatch3r-fixer`. Terminate the review loop immediately and **ASK** the user with the objection rationale plus the reviewer's ≥1 alternative approach, mirroring the `hatch3r-board-fill` forced-termination branch and the `terminateReviewLoopDesignObjection` helper in `src/pipeline/reviewLoop.ts`. This routes the objection to the architectural decision the reviewer requested instead of cycling the fixer on an unfixable premise. On exit, reconcile the findings ledger per step 5's run-exit invariant.
2. **Confidence-aware gate** (the second-pass trigger tightens with the `--confidence-floor` set in Step 0.7 — `any` = default below, `medium`/`high` raise the bar). First resolve the reviewer `confidence` field per the Confidence Propagation Contract absent-confidence clause: an absent or unparseable value is treated as `low` (it does NOT satisfy `!= low`), matching the code gate where `unknown` ranks below `low`. **Then reconcile (D13-21):** derive the deterministic iteration signal `reviewLoopConfidence` (`low` if the loop took ≥3 iterations or terminated non-clean, else `high`/`medium` by iteration count; `src/pipeline/reviewLoop.ts`) and evaluate the floor against `effectiveConfidence = min(reviewLoopConfidence, self-assigned reviewer confidence)` by rank, mirroring `evaluateReviewGate` and `agents/shared/confidence-gate.md`. Read the bullets below against `effectiveConfidence` — the reconciled value — not the raw self-rating; the deterministic signal caps an over-confident self-rating, so a `medium` self-rating on a 3-iteration loop reconciles to `low` and forces the second pass.
   - **0 Critical + 0 Warning AND effective confidence == high or medium:** Review loop is clean. Proceed to 4b. (Floor `medium`: also force a second pass if any individual finding is `confidence == low`. Floor `high`: force a second pass if reviewer confidence `!= high` OR any finding is `!= high`, AND ASK on every low-confidence finding.)
   - **Runtime calibration second pass (would-be-clean exit):** before exiting clean to 4b, the orchestrator runs the runtime calibration second pass — an out-of-band re-review routed to an independent model class, fired on the every-Nth-clean-PASS cadence (lowered to the first clean PASS for a high-risk `floor:security`/auth/migration diff) — per `rules/hatch3r-agent-orchestration.md` → Post-Implementation Quality Pipeline → Phase 3 step 3 (Runtime calibration second pass) and `rules/hatch3r-reviewer-calibration.md` (Trigger + Action). A divergent second pass reverts this exit to step 3 (REQUEST CHANGES) before 4b.
   - **0 Critical + 0 Warning AND effective confidence == low (including absent/unparseable, resolved to `low` above):** Trigger a second reviewer pass before exiting. Do not proceed to 4b until the second pass returns high/medium confidence OR the user explicitly accepts the low-confidence PASS at the ASK checkpoint in step 5.
3. **If Critical or Warning findings exist (and the verdict is NOT `DESIGN_OBJECTION` — see the design-objection early exit under step 1):** Spawn a `hatch3r-fixer` sub-agent with the reviewer output. The fixer applies fixes for all Critical and Warning findings — append the W1 write-ahead rows before the fixer dispatch and the W2 disposition rows after the re-review (`rules/hatch3r-findings-ledger.md` → Write Points).
4. **Re-review:** After the fixer completes, spawn `hatch3r-reviewer` again to verify fixes.
5. **Repeat** steps 2-4 for a maximum of **3 iterations** (code-class cap). Delta re-review (per `rules/hatch3r-agent-orchestration.md`): iterations >=2 re-review only changed hunks plus findings marked verify-fix; Medium/Low findings carry forward, not re-litigated; cap-out is an UNRESOLVED escalation, never silent continuation. If still not clean after 3 iterations, **ASK** the user how to proceed (force continue / manual fix / abort). The ASK lists each open `finding_id` with its legal closures (fix manually / defer → todo.md anchor / accept risk — user-attested only); on exit, reconcile the ledger to the run-exit invariant (W3, `rules/hatch3r-findings-ledger.md`); in `--auto` mode record open findings as `escalated` and exit PARTIAL.
   - **Suggestion terminalization (W5):** every Suggestion row goes terminal at loop exit — `surfaced` (ID on the recap's `Open findings:` line), `deferred` (todo.md anchor), or `declined` (quoted user reply); unattended default is `surfaced` (`rules/hatch3r-findings-ledger.md`).

> **Iteration-cap rationale (D10-SA10.7-F10.7.7).** Code reviews diverge faster than spec reviews — a code finding can spawn a regression the next iteration must catch — so the code-class loop here caps at 3. The spec-class loop in `hatch3r-board-fill` Step 7.9d caps at 4 because issue-spec reviews converge more slowly and deterministically (text refinement, no runtime regressions). The code-class cap (3) sits one below `DEFAULT_MAX_REVIEW_ITERATIONS` (4) in `src/pipeline/reviewLoop.ts`; the spec-class cap (4) equals it. The cap is set from convergence economics (Finding D7-16), not from oscillation-detector reachability — the detector is decoupled and fires at `history.length >= 3` independent of the cap. Expected convergence is 1–2 iterations (informed estimate — `CALIBRATION.basis` in `src/pipeline/reviewLoop.ts`, unmeasured on hatch3r runs until the runtime telemetry ledger `.hatch3r/review-loop-metrics.jsonl`, read by `scripts/calibrate-review-loop.ts`, reaches its 30-sample threshold); the cap is the divergence backstop, not the target.

After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings. The reviewer sub-agent output MUST include a top-level `confidence: high | medium | low` field (not just per-finding) so step 2 can evaluate it deterministically.

Each reviewer/fixer sub-agent prompt MUST include:
- The agent protocol to follow.
- All `scope: always` rule directives from `rules/`.
- The diff or file changes to review/fix.
- The task's acceptance criteria.
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

#### 4b. Final Quality (Parallel Specialists)

**ONLY after the review loop (4a) reports 0 Critical + 0 Warning findings**, spawn the remaining specialist sub-agents. Use the Task tool with `subagent_type: "generalPurpose"`. Dispatch is bounded by the orchestrator-honored fan-out width `max_phase4_parallel` (default `8`) per `rules/hatch3r-agent-orchestration.md` Phase 4 — Final Quality — LLM-honored guidance, not a code-enforced cap (the host Task tool applies no platform fan-out limit). The bound exists for upstream provider rate-limit headroom, not per-orchestrator context cost (P8 dominates P7). When the applicable specialists exceed the bound, batch by severity priority `CRITICAL → HIGH → MEDIUM → LOW`; each batch runs to completion before the next. Allocate each specialist's model class per `rules/hatch3r-model-allocation.md` (verdict-class specialists carry floor `frontier`, so allocation resolves to `frontier` at every tier) and scope each specialist prompt to the Specialist Prompt Enrichment set per `rules/hatch3r-context-budget.md`.

**Always spawn (mandatory for every code change):**

1. **`hatch3r-testability`** (CQ5) — confirm tests meet the mandate map / coverage floor for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
2. **`hatch3r-security`** (CQ3) — security review of all code changes. Audit data flows, access control, input validation, and secret management against the CQ3 threshold set.

**Always evaluate (spawn when applicable):**

3. **`hatch3r-docs-writer`** — spawn when changes affect public APIs, architectural patterns, user-facing behavior, or when specs/ADRs need updating. Skip silently if no documentation impact.

**Triggered specialists (spawn each whose trigger matches the diff):**

Spawn **all triggered CQ specialists (CQ1-CQ9) per `SPECIALIST_TRIGGER_TABLE`** plus `hatch3r-lint-fixer` — not the lint/ui/performance subset alone. Evaluate each via `shouldTriggerSpecialist(specialist, changedFiles, projectType)` (D6-M11); spawn the ones that return `{ triggered: true }`. A `mandatory: true` return (mode `mandatory-on-match`) is non-skippable at Tier 2/3 — that specialist MUST spawn as its own dedicated sub-agent instance:

4. **`hatch3r-lint-fixer`** — lint or type errors present after implementation.
5. **`hatch3r-ui`** (CQ1, mandatory-on-match) — UI component / design-token / theme files modified. When triggered at Tier 2/3, a dedicated `hatch3r-ui` instance is a hard mandate.
6. **`hatch3r-ux`** (CQ2, mandatory-on-match) — flow / route-transition / modal / error-state files or microcopy/i18n strings modified. When triggered at Tier 2/3, a dedicated `hatch3r-ux` instance is a hard mandate (never merged into the `hatch3r-ui` spawn).
7. **`hatch3r-reliability`** (CQ4) — service/request handler, OTel/SLO, retry/circuit-breaker, or Kubernetes-probe code modified.
8. **`hatch3r-scalability`** (CQ6) — request handler, queue client, connection-pool, cache, or background-job code modified.
9. **`hatch3r-performance`** (CQ7) — ORM/data-access, UI-rendering, or bundle/hot-path code modified.
10. **`hatch3r-maintainability`** (CQ8) — any code mutation (duplication + complexity scan); schema / migration / API spec modified.
11. **`hatch3r-enhancability`** (CQ9) — user-visible behavior, public API surface, config schema, or extension-point interface modified.

(`hatch3r-architect` and `hatch3r-devops` are also conditional in `SPECIALIST_TRIGGER_TABLE` but are not CQ-vector specialists; spawn them too when their architectural / CI-CD triggers match.)

**Supporting edge-case analyst (conditional, not in `SPECIALIST_TRIGGER_TABLE`):** spawn `hatch3r-edge-case-analyst` when its own `phase_4_trigger` conditions match — the diff wires ≥2 domain entities, or adds a state-machine / uniqueness / data-mutation path reachable by more than one actor. It enumerates the domain edge-case + error-handling ledger and verifies zero dropped cases between Plan, Implement, and Review, handing the missing-test subset to `hatch3r-testability` and the missing-handling subset to `hatch3r-fixer`. It is a CQ4/CQ5 supporting analyst, not a CQ primary (`hatch3r-reliability` / `hatch3r-testability` retain ownership). This realizes the reviewer's MAY-delegate path (`agents/hatch3r-reviewer.md`) through the workflow `agentPipeline`, so the analyst is no longer the only trigger-bearing agent the command omits.

> **Single source of truth for triggers (D6-M11):** the canonical trigger map lives in `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE` and the predicate `shouldTriggerSpecialist(specialist, changedFiles, projectType)` returns `{ triggered, reasons, mandatory? }` for any specialist. The brief prose list above is a quick reference only; for the authoritative trigger evaluation at runtime, call `shouldTriggerSpecialist` from the orchestrator harness (or the equivalent mirror in `rules/hatch3r-agent-orchestration.md` → Phase 4 Specialist Trigger Table). Adding a specialist to the prose without updating the TS table is rejected by `npm run validate:specialist-roster`.

Each specialist sub-agent prompt MUST include:
- The agent protocol to follow.
- All `scope: always` rule directives from `rules/`.
- The diff or file changes to review.
- The task's acceptance criteria.
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Await all specialist sub-agents. Apply their feedback (fixes, additional tests, documentation updates).

#### 4b.1. Re-Review After Phase 4 Fixes

If any Phase 4 specialist produced fixes (not just findings), run a lightweight re-review to catch regressions introduced by the specialist changes. Spawn `hatch3r-reviewer` with a focused prompt covering only the files modified by Phase 4 specialists. If the re-review finds Critical findings, spawn `hatch3r-fixer` and re-review once more (max 1 additional iteration). This prevents Phase 4 fixes from bypassing the review gate.

#### 4b.2. Post-Write Duplication Scan (Decision 21)

Before clearing the review gate, run a duplication scan on the working-tree diff to catch near-duplicate code that parallel Phase-3 implementers (one per module) can each pass their own review independently (D13-SA13.2-F7). This operationalizes the CONSTITUTION §6 Decision 21 post-write duplication scan at runtime, not only at audit time.

1. Run `npx jscpd --min-lines 40 --threshold 80 --reporters json --silent <changed-paths>` (or the project's configured duplication tool). The gate fires when any cross-file clone block is **≥40 lines OR ≥80% byte-similar**.
2. **If a clone is detected:** route the duplication report back to `hatch3r-fixer` to extract the shared logic (DRY refactor), then re-run 4b.1 re-review on the refactored files. Max 1 duplication-fix iteration; if it persists, surface to the user with the clone locations.
3. **If no clone is detected:** proceed to 4b.3. Skip silently when the diff touches a single file (no cross-file clone possible).

#### 4b.3. Consolidate Cross-Specialist Findings (D7-SA7.3-04)

The Phase-4b batch fans out up to 13 specialists over one diff, and adjacent CQ vectors own overlapping surfaces (ui + ux both cover the four-state / error-state surface; performance + scalability both cover the query / connection-pool path; maintainability + enhancability both cover the API-surface change), so ≥2 specialists can surface the same underlying finding. §4b.2 dedups *code* (jscpd); this step dedups *findings*. After awaiting all specialists and before §4c, consolidate the union of specialist findings:

1. Two findings are the same finding when at least **2 of 3** signals match: same **File**, same **Root Cause**, same **Recommendation**.
2. For each duplicate cluster, keep the highest-severity instance and record the co-reporting specialists as sub-points (reuse the `rules/hatch3r-findings-ledger.md` finding vocabulary) — the user sees one finding attributed to N specialists in §4d, not N near-identical rows.
3. Count distinct Criticals from the consolidated set: a Critical that two specialists both surface is **one** unresolved Critical, not two. Feed the deduplicated distinct-Critical count into §4d and attribute each shared Critical to a single `SpecialistResult.criticalCount`. (The typed `evaluatePhase4Completion` gate in `src/pipeline/pipelineContext.ts` sums `criticalCount` per specialist; attributing a shared Critical once here keeps that sum at the distinct count.)

#### 4c. Verify Against Acceptance Criteria

Check each acceptance criterion from the original task or issue. Mark as met or not-met with evidence.

For each criterion, rate verification confidence: high (tested and confirmed via code, tests, or browser), medium (logically satisfied but not independently verified), low (uncertain, recommend human testing).

#### 4d. Present Review

```
Review Results:
  Acceptance Criteria: {N/M met}
  Code Quality: {reviewer findings}
  Security: {hatch3r-security findings}
  Test Coverage: {hatch3r-testability results}
  Documentation: {docs-writer results / not applicable}
  Performance: {pass/issues}
  Overall Confidence: {high/medium/low}
    Lowest-confidence area: {description or "none"}
    Review independence: {different-family = provider-independent | same-family or not-declared = self-preference bias possible, clean PASS is not provider-independent}
```

The `Review independence` line reports the reviewer↔fixer `verdictIndependence` (`src/pipeline/reviewLoop.ts`). hatch3r's default routes both agents to one model family, so a clean PASS carries LLM self-preference bias — treat it as a weaker merge signal and prefer independent human review before merge. It reads `different-family` only when a pack integrator routes the two agents to distinct providers. This mirrors the `Review independence` exception line in `rules/hatch3r-iteration-summary.md`, surfacing the caveat at the merge-readiness decision point rather than only in the audit trail.

**ASK:** "Review complete. {summary}. Ready to finalize? (yes / address review issues / request human review)"

#### 4e. Capture Learnings

If `.hatch3r/learnings/` exists:

1. Extract learnings from this implementation session (patterns discovered, pitfalls encountered, decisions made).
2. Store in `.hatch3r/learnings/` with appropriate area tags.

---

## Quick Mode

Collapses the 4 phases into a streamlined flow for small, well-defined tasks. Sub-agent delegation is still mandatory — Quick Mode uses lighter prompts, and sub-agent count follows the tier's pruning table (`agents/shared/triage-vocabulary.md` → Pipeline pruning per tier): tier-derived, never token-cost-derived.

### Quick Step 1: Rapid Analysis + Plan (Combined)

With `--plan-file`, run the Plan-File Intake guards first (1a-plan: existence, parse, freshness), then present the parsed plan at the ASK below instead of drafting one — Quick Mode accepts the flag identically to Full Mode.

1. Score complexity per `hatch3r-deep-context`. If the score yields Tier 3, recommend switching to Full Mode.
2. Spawn `hatch3r-researcher` with depth `quick` for brief context gathering. Skip Phase 1 only per the canonical Phase Skip Criteria (`rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria / `PHASE_SKIP_CRITERIA`): trivial single-line edit, Tier-1 single-file no-cross-module change, or cached research. For Tier 2, include `requirements-elicitation` and `similar-implementation` at `quick` depth.
3. Quick plan: list changes, identify the appropriate hatch3r skill. If `similar-implementation` found a reference, note the convention to follow.
4. Skip ADR/spec review unless the task touches architecture.

**ASK:** "Quick analysis: {scope}, {approach}. {Unresolved questions from elicitation, if any.} Proceed? (yes / switch to Full Mode)"

### Quick Step 2: Implement

1. Spawn `hatch3r-implementer` sub-agent via the Task tool. Do NOT implement inline.
2. Run quality checks (lint, typecheck, test).
3. Fix any issues before proceeding.

### Quick Step 3: Quick Review (sub-agent Quality Pipeline)

Same two-stage pipeline as Full Mode, with lighter prompts:

**Stage 1 — Review Loop:**

1. Spawn **`hatch3r-reviewer`** with a focused prompt covering correctness and quality. Extract Critical/Warning findings AND the reviewer's top-level `confidence` field.
2. If the reviewer verdict is `DESIGN_OBJECTION`, do NOT spawn the fixer — terminate the loop and **ASK** the user with the objection rationale plus the reviewer's ≥1 alternative approach (parity with Full Mode 4a design-objection early exit). Otherwise, if Critical or Warning findings exist, spawn **`hatch3r-fixer`**, then re-review. Max 3 iterations — iterations >=2 re-review only changed hunks plus findings marked verify-fix; Medium/Low findings carry forward, not re-litigated; cap-out is an UNRESOLVED escalation, never silent continuation.
3. **Confidence-aware gate (parity with Full Mode 4a step 2 — the `--confidence-floor` from Step 0.7 is NOT inert in Quick Mode):** resolve an absent/unparseable reviewer `confidence` to `low` per the Confidence Propagation Contract, then apply the same floor branch as Full Mode 4a:
   - **0 Critical + 0 Warning AND confidence == high or medium:** clean — proceed to Stage 2. (Floor `medium`: also force a second pass on any finding `confidence == low`. Floor `high`: force a second pass if reviewer confidence `!= high` OR any finding is `!= high`, AND ASK on every low-confidence finding.)
   - **0 Critical + 0 Warning AND confidence == low (including absent/unparseable):** trigger a second reviewer pass before exiting; do not proceed to Stage 2 until it returns high/medium confidence OR the user accepts the low-confidence PASS at the finalize ASK.

**Stage 2 — Final Quality (after review loop is clean):**

4. **`hatch3r-testability`** (CQ5) — ALWAYS for code changes (sole exception: a Tier-1 run meeting ALL four criteria of the Tier-1 relaxation, `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria).
5. **`hatch3r-security`** (CQ3) — ALWAYS for code changes (same sole Tier-1-relaxation exception; any unmet criterion pins CQ5+CQ3 back on).
6. **`hatch3r-docs-writer`** — evaluate; spawn when documentation impact exists.
7. Verify acceptance criteria are met (rate each criterion high/medium/low per Full Mode 4c).
8. Confirm lint/typecheck/test pass.

Before the finalize ASK, emit an `Overall Confidence` line (parity with Full Mode 4d, including its `Review independence` caveat) sourced from the lowest upstream confidence across reviewer, testability, security, and the acceptance-criteria checks:

```
Overall Confidence: {high/medium/low}
  Lowest-confidence area: {description or "none"}
  Review independence: {different-family = provider-independent | same-family or not-declared = self-preference bias possible, clean PASS is not provider-independent}
```

**ASK:** "Changes complete. Quality checks pass. Overall confidence: {high/medium/low}. Finalize? (yes / deeper review needed → switch to Full Mode Phase 4)"

---

## Integration with Board Workflow

`/workflow` and `hatch3r-board-pickup` share the same 4-phase pipeline **shape** but not a call edge — board-pickup does NOT invoke this command. They are two separate entry points into the same Research → Implement → Review-Loop → Final-Quality pipeline:

### `hatch3r-board-pickup` — board work, pipeline runs inline

- board-pickup reimplements this identical pipeline **inline** via `commands/board/pickup-delegation.md`: it spawns `hatch3r-researcher`, then `hatch3r-implementer` (with the type-matched skill), then its own `hatch3r-reviewer` ↔ `hatch3r-fixer` review loop, then the final-quality specialists — directly, never by invoking `/workflow`.
- It gathers its own issue context, runs its own review loop, and owns PR creation in its own later steps (Steps 7a–8).
- Consequence for maintainers: an edit to this command's phase logic does NOT reach the board path. Mirror any cross-cutting pipeline change into `pickup-delegation.md` as well.

### `/workflow` — standalone (no-board) equivalent

- All phases run independently with full context loading; Phase 1 fetches issue context fresh.
- User decides whether to create a PR at the end of Phase 4.
- When `/workflow` operates on an issue that lives on a Projects v2 board, all issue operations MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

---

## Auto-Advance Mode

When invoked with `--auto` or `--unattended`, the workflow operates with reduced human checkpoints for sustained autonomous operation. Compatible with both Full Mode and Quick Mode.

### Behavior Changes in Auto Mode

| Checkpoint | Normal Mode | Auto Mode |
|-----------|-------------|-----------|
| Mode selection (Step 0) | ASK user to confirm | Auto-select based on complexity signals |
| Analysis review (Phase 1) | ASK user to proceed | Auto-proceed if no open questions |
| Plan review (Phase 2) | ASK user to approve | Auto-proceed with plan |
| Implementation review (Phase 3) | ASK user before Review | Auto-proceed if quality checks pass |
| Review finalization (Phase 4) | ASK user to finalize | Auto-finalize only when all AC met AND no unattested product decision is recorded (see Safety Guardrails) |

### Safety Guardrails (Always Active)

These checkpoints are NEVER skipped, even in auto mode:
- **Destructive operations**: Database migrations, file deletions, security rule changes always require confirmation
- **Breaking changes**: API contract changes, public interface modifications always require confirmation
- **Product-behavior decisions:** a change that deletes or transforms user data, or alters user-visible behavior beyond the issue's acceptance criteria, always requires user confirmation — a code comment or PR sentence authored by this run is not user consent (`agents/shared/user-question-protocol.md` → Unattested product decision). Unattended: record the decision as `escalated` in the findings ledger and exit PARTIAL.
- **Open questions**: If Phase 1 analysis surfaces unresolvable ambiguity, stop and ASK regardless of mode
- **Quality gate failures**: If lint/typecheck/test fail after 2 fix attempts, stop and ASK
- **Cost thresholds**: When the estimated cost for the selected tier exceeds the configured limit (default: $10 per task), do NOT abort silently. Call `proposeAlternativeTier(currentTier, currentEstimate, budget)` from `src/pipeline/costEstimator.ts` and surface a 3-option ASK: **(a) downgrade** to the suggested lower tier (saves the reported delta — drops the deep researcher modes / Phase-4 specialist depth that the lower tier omits), **(b) raise the budget** and proceed at the current tier, **(c) abort**. Default-if-no-response: abort (preserves the fail-closed contract). When `proposeAlternativeTier` returns `null` (current tier is already the cheapest, or no lower tier fits), present only raise-budget / abort.

### Activation

```
/hatch3r-workflow --auto
/hatch3r-workflow --auto --mode=full
/hatch3r-workflow --auto --mode=quick
```

### Auto Mode Under Board Pickup

`hatch3r-board-pickup --auto` does NOT invoke `/workflow` — it runs the same pipeline inline (see Integration with Board Workflow) with its own `--auto` handling. The reduced-checkpoint behavior and Safety Guardrails above apply within board-pickup's inline pipeline, and board-pickup owns PR creation in its Steps 7a–8.

### Session Report

At the end of an auto workflow session, generate a summary:
- Mode used: {Full/Quick}
- Phases completed: {list}
- Quality checks: {pass/fail with details}
- Acceptance criteria: {N/M met}
- Learnings captured: {count}
- Time in auto mode: {duration}

---

## Resumability (Decision 27/30)

workflow is long-running — a Tier 2/3 run walks the 4-phase delivery pipeline (Analyze → Plan → Implement → Review), fans out one implementer per independent module in Phase 3, and runs a reviewer ↔ fixer loop plus Phase 4b CQ1–CQ9 specialist batch in Phase 4. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed phase rather than re-running researchers or re-implementing already-applied module changes.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.workflow-workspace/`; step range the command's step progression; `wave` = per-module implementer batch index for Phase 3 and reviewer-fixer iteration count for Phase 4a; snapshot/rollback paths every file touched by Phase 3 implementers and Phase 4a fixers. Write points: after Phase 1 researcher fan-out returns, after the Phase 2 plan synthesis is confirmed by ASK, after each Phase 3 implementer sub-agent returns (one write per module so a mid-batch crash preserves prior `delegation_proof_id`s), after each Phase 4a reviewer-fixer iteration, and after the Phase 4b parallel specialist batch (docs-writer + lint-fixer + CQ1–CQ9 specialists) completes.

**Plan-gate resume fidelity (D7-SA7.1-03).** The narrative Phase 2 "Plan" is an ephemeral orchestrator-local approval gate inside canonical Phase 1 (Research) per the Phase Crosswalk — it has no typed `PipelineContext` slice (the typed phase-output slices are research / implementation / review / quality only; `src/pipeline/pipelineContext.ts`). The "after the Phase 2 plan synthesis is confirmed by ASK" checkpoint write point above records THAT plan approval occurred (the phase pointer + baseline), not the approved plan text. A run that resumes after plan approval therefore re-derives the plan from the Phase-1 research + context and re-presents it for re-approval before Implement — it does not restore the exact approved plan blob. Do not read `supports_resume: true` as a promise to preserve verbatim plan content; the approved plan is reproduced and re-confirmed, not persisted.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for workflow — the canonical integers per the Phase Crosswalk under Agent Pipeline, the same coordinate `validatePhaseTransition` / `SnapshotRef.afterPhase` consume (Finding D7-SA7.1-01): `1` = Research (narrative Analyze + Plan; Quick Step 1), `2` = Implement (narrative Phase 3; Quick Step 2), `3` = Review Loop (narrative Phase 4a; Quick Step 3 Stage 1), `4` = Final Quality (narrative Phase 4b–4e; Quick Step 3 Stage 2). Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: workflow definition, step outputs, automation manifests.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

### Cost Visibility (Decision 24)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first sub-agent dispatch (both Full and Quick Mode).
- **Post-execution `cost_actuals` + `delta`** — appended to the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 15` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Quick Tier 1 ≈ 2 (researcher + implementer, reviewer/fixer/testability/security when triggered), Quick Tier 2 ≈ 6 (researcher + implementer + reviewer + fixer + testability + security), Full Tier 3 up to 15 (full pipeline including the Phase-4b CQ1-CQ9 specialist batch bounded by `max_phase4_parallel`). Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Quality check failure in Phase 3:** Loop back and fix before proceeding to Phase 4. Do not advance with failing checks.
- **Acceptance criteria not met in Phase 4:** Loop back to Phase 3 with specific items to address.
- **Sub-agent failure:** Per the shared sub-agent-failure clause in `rules/hatch3r-agent-orchestration.md` -> Cross-Phase Error Propagation: retry once, then re-spawn `hatch3r-fixer` with the failure context, then `BLOCKED_OTHER` + ASK. Never fall back to inline implementation (issue #73 bypass mode).
- **Context degradation:** per the canonical Context-Degradation Policy (`rules/hatch3r-agent-orchestration-detail.md` -> Context-Degradation Policy) — the policy owns the window-fraction compress/restart thresholds and the turn-count fallback; workflow maps to the policy's implementation/review lane. On restart, suggest a fresh chat with a progress summary capturing completed work and remaining items.
- **Handoff information loss (>0.3):** When a lossy phase transition crosses the `informationLossEstimate > 0.3` threshold, emit the `formatPhaseHandoffWarning` line in the iteration summary per `rules/hatch3r-agent-orchestration.md` -> Phase Handoff Contract (Handoff-loss trigger) so the next phase verifies critical context survived — distinct from the turn-count degradation rule above.
- **Mode switch:** User can switch from Quick to Full (or vice versa) at any ASK checkpoint. State carries forward — no work is lost.

## Guardrails

- **Never skip ASK checkpoints.**
- **Never skip Phase 4 (Review) in Full Mode** — even if implementation seems complete.
- **Quick Mode is opt-in** — user must confirm the mode selection in Step 0.
- **Always run quality checks** before declaring implementation complete.
- **Stay within the task scope** — note related work but do not implement it.
- **Recommend Full Mode** if the task grows beyond Quick Mode complexity during execution.
- **All phases produce structured output** that can feed into other hatch3r commands.
- **Respect the project's tooling hierarchy** for knowledge augmentation (Context7 MCP for library docs, web research for current events).
- **Never force a mode** — user always has final say at every ASK checkpoint.
- **Concurrent invocation:** acquire `.hatch3r/.lock` before Phase 1 and detect-then-warn on a conflicting active pipeline (same branch / open `.hatch3r/hatch.json` transaction) per `rules/hatch3r-agent-orchestration.md` → Parallel Safety → Concurrent Invocation Handling. Cross-task learnings consolidate at completion, never mid-pipeline.
- **This command composes existing hatch3r agents and skills** — it does not replace them.
