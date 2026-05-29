---
id: hatch3r-workflow
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-reviewer, hatch3r-fixer, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-ui, hatch3r-ux, hatch3r-security, hatch3r-reliability, hatch3r-testability, hatch3r-scalability, hatch3r-performance, hatch3r-maintainability, hatch3r-enhancability]
description: Guided development lifecycle with 4 phases (Analyze, Plan, Implement, Review) and scale-adaptive Quick Mode for small tasks.
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
  rationale: Full 4-phase delivery pipeline — researcher (Phase 1), implementer (one per independent module, Phase 3), reviewer ↔ fixer review loop (Phase 4a), then a parallel Phase-4b final-quality batch (docs-writer + lint-fixer + CQ1-CQ9 vector specialists ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability — testability and security cover the always-on test + security gates) bounded by max_phase4_parallel. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

# Development Workflow -- Guided Lifecycle for Structured Implementation

Optional guided development lifecycle command that walks through structured phases — Analyze, Plan, Implement, Review — using hatch3r's existing agents and skills. Includes a Quick Mode that collapses phases for small tasks. Scale-adaptive: detects task complexity and recommends the appropriate mode. Works standalone or when invoked from `hatch3r-board-pickup`.

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
| 3e. Final Quality — Conditional | `hatch3r-lint-fixer`, `hatch3r-ui`, `hatch3r-performance` | Yes | When triggered |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above (multi-module implementers in Phase 3, the Phase-4b final-quality batch) holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

If **yes**: implementation (Phase 3) and review (Phase 4) stages include browser verification steps — navigate to affected pages, interact with changed elements, check console for errors, capture screenshots.

If **no**: all browser verification steps are skipped silently throughout the entire command.

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

---

## Triage

Classify the development task before delegating. Detailed mode classification runs in Step 0 (Triage / Scale-Adaptive Mode Selection); this section summarizes the routing:

- **Tier 1 (trivial)**: single-line edit, typo, or trivial config change; Quick Mode runs the streamlined 3-step path. The B1 ambiguity gate (`§0 Detect Ambiguity` per `.claude/rules/clarification-default.md`) is NEVER skipped — Tier 1 admission already requires that the brief alone be testable, single-file, and single-concern, so the gate evaluates trivially and passes silently when those preconditions hold. ASK checkpoints downstream of the brief (mid-plan, end-of-implementation, mid-review) are reduced to one consolidated end-of-run "merge or revise?" prompt rather than per-phase prompts — Tier 1 work is short enough that incremental ASK fatigue would dominate the workflow without proportional benefit. Any mid-run ambiguity that wasn't visible at the brief surface re-invokes the B1 protocol on the spot. This satisfies P8 B1 default-not-exception: the protocol still applies; the checkpoint cadence is right-sized (Finding D7-M11 / D7-SA7.4-4).
- **Tier 2 (standard)**: bug fix or small feature in 1–3 files; Quick Mode with full sub-agent delegation (researcher, implementer, reviewer, fixer, test-writer, security-auditor).
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

Evaluate the task against both signal sets. Count matching signals to determine recommendation.

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

Post-execution actuals + delta land in the Phase 4 / Quick Step 3 iteration summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Step 0.6: Effort Override (Decision 17)

Auto-tiering (Step 0 mode selection) can misclassify — a single-file edit scored as Full Mode, or a cross-cutting refactor scored as Quick Mode. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier (light → Quick Tier 1, standard → Quick Tier 2, deep → Full Tier 3), bypassing the Step 0 auto-classification. This composes with the existing `--mode=full|quick` flag: an explicit `--mode` wins over the `--effort`-derived mode.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- The override never disables the Safety Guardrails (destructive operations, breaking changes, open questions, quality-gate failures always stop) — those are mode-independent.
- No override passed → the Step 0 auto-classification stands.

---

## Full Mode

### Phase 1: Analyze

**Goal:** Fully understand the task, its context, and constraints before writing any code.

#### 1a. Parse the Task

- **GitHub issue:** Read issue body, acceptance criteria, labels, parent epic context using `gh issue view` (fall back to `issue_read` MCP).
- **User description:** Extract requirements, scope, constraints from the provided description.
- **Board-pickup invocation:** Use the issue context already gathered by board-pickup. Skip re-fetching.

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

Identify supporting agents needed: test-writer, docs-writer, reviewer, security-auditor.

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

**Goal:** Execute the plan using the selected hatch3r skill, delegating to sub-agents per the Universal Sub-Agent Pipeline.

#### 3a. Context Gathering (Researcher Sub-Agent)

You MUST spawn a `hatch3r-researcher` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) before implementation. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes).

- Select research modes by task type (bug → symptom-trace/root-cause/codebase-impact, feature → codebase-impact/feature-design/architecture, refactor → current-state/refactoring-strategy/migration-path, QA → codebase-impact).
- Add tier-appropriate modes per the `hatch3r-deep-context` rule if not already run in Phase 1 Step 1b.
- Use depth `quick` for low-risk, `standard` for medium-risk, `deep` for high-risk. The complexity tier may override depth upward.
- Await the researcher result. Use its structured output to inform Step 3b.

#### 3b. Core Implementation (Implementer Sub-Agent)

You MUST spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Do NOT implement inline — always delegate to a dedicated implementer.

1. Read the matching hatch3r skill file and include it in the implementer prompt.
2. Do NOT execute the skill's PR creation steps if invoked from `hatch3r-board-pickup` (board-pickup handles PR creation in its own Steps 7a–8).
3. For tasks spanning multiple independent parts, spawn one `hatch3r-implementer` per independent module. Launch as many in parallel as the platform supports.
4. Coordinate changes across files to avoid conflicts.

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

Run the project's quality checks (adapt to project conventions):

```bash
npm run lint && npm run typecheck && npm run test
```

Fix any issues before proceeding. If quality checks fail, loop back and resolve before advancing to Phase 4.

**ASK:** "Implementation complete. All quality checks pass. Confidence in implementation quality: {high/medium/low — based on test coverage depth, edge case handling, and researcher coverage}. Proceed to Review? (yes / fix issues first)"

---

### Phase 4: Review (Sub-Agent Quality Pipeline)

**Goal:** Verify quality and completeness via a two-stage sub-agent pipeline before finalizing. The Review Loop (4a) iterates until code quality is clean, then Final Quality (4b) runs remaining specialists in parallel.

#### 4a. Review Loop (Reviewer → Fixer)

Spawn a `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Include the diff and acceptance criteria in the prompt.

1. **Review:** Await the reviewer result. Extract Critical and Warning findings AND the reviewer's top-level `confidence` field (high/medium/low).
2. **Confidence-aware gate:**
   - **0 Critical + 0 Warning AND reviewer confidence != low:** Review loop is clean. Proceed to 4b.
   - **0 Critical + 0 Warning AND reviewer confidence == low:** Trigger a second reviewer pass before exiting. Do not proceed to 4b until the second pass returns non-low confidence OR the user explicitly accepts the low-confidence PASS at the ASK checkpoint in step 5.
3. **If Critical or Warning findings exist:** Spawn a `hatch3r-fixer` sub-agent with the reviewer output. The fixer applies fixes for all Critical and Warning findings.
4. **Re-review:** After the fixer completes, spawn `hatch3r-reviewer` again to verify fixes.
5. **Repeat** steps 2-4 for a maximum of **3 iterations** (code-class cap). If still not clean after 3 iterations, **ASK** the user how to proceed (force continue / manual fix / abort).

> **Iteration-cap rationale (D10-SA10.7-F10.7.7).** Code reviews diverge faster than spec reviews — a code finding can spawn a regression the next iteration must catch — so the code-class loop here caps at 3. The spec-class loop in `hatch3r-board-fill` Step 7.9d caps at 4 because issue-spec reviews converge more slowly and deterministically (text refinement, no runtime regressions). Both are bounded below `DEFAULT_MAX_REVIEW_ITERATIONS` (4) in `src/pipeline/reviewLoop.ts`, which keeps the oscillation detector reachable in default config. Expected convergence is 1–2 iterations; the cap is the divergence backstop, not the target.

After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings. The reviewer sub-agent output MUST include a top-level `confidence: high | medium | low` field (not just per-finding) so step 2 can evaluate it deterministically.

Each reviewer/fixer sub-agent prompt MUST include:
- The agent protocol to follow.
- All `scope: always` rule directives from `rules/`.
- The diff or file changes to review/fix.
- The task's acceptance criteria.
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

#### 4b. Final Quality (Parallel Specialists)

**ONLY after the review loop (4a) reports 0 Critical + 0 Warning findings**, spawn the remaining specialist sub-agents. Use the Task tool with `subagent_type: "generalPurpose"`. Dispatch is bounded by `max_phase4_parallel` (default `8`, env-overridable via `HATCH3R_MAX_PHASE4_PARALLEL`, valid range 1-16) per `rules/hatch3r-agent-orchestration.md` Phase 4 — Final Quality. The bound exists for upstream provider rate-limit headroom, not per-orchestrator context cost (P8 dominates P7). When the applicable specialists exceed the bound, batch by severity priority `CRITICAL → HIGH → MEDIUM → LOW`; each batch runs to completion before the next.

**Always spawn (mandatory for every code change):**

1. **`hatch3r-testability`** (CQ5) — confirm tests meet the mandate map / coverage floor for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
2. **`hatch3r-security`** (CQ3) — security review of all code changes. Audit data flows, access control, input validation, and secret management against the CQ3 threshold set.

**Always evaluate (spawn when applicable):**

3. **`hatch3r-docs-writer`** — spawn when changes affect public APIs, architectural patterns, user-facing behavior, or when specs/ADRs need updating. Skip silently if no documentation impact.

**Conditional specialists (spawn when triggered):**

4. **`hatch3r-lint-fixer`** — when lint or type errors are present after implementation.
5. **`hatch3r-ui`** (CQ1) — when UI or accessibility changes are made.
6. **`hatch3r-performance`** (CQ7) — when performance-sensitive changes are made.

> **Single source of truth for triggers (D6-M11):** the canonical trigger map lives in `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE` and the predicate `shouldTriggerSpecialist(specialist, changedFiles, projectType)` returns `{ triggered, reasons }` for any specialist. The brief prose list above is a quick reference only; for the authoritative trigger evaluation at runtime, call `shouldTriggerSpecialist` from the orchestrator harness (or the equivalent mirror in `rules/hatch3r-agent-orchestration.md` → Phase 4 Specialist Trigger Table). Adding a specialist to the prose without updating the TS table is rejected by `npm run validate:specialist-roster`.

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
3. **If no clone is detected:** proceed to 4c. Skip silently when the diff touches a single file (no cross-file clone possible).

#### 4c. Verify Against Acceptance Criteria

Check each acceptance criterion from the original task or issue. Mark as met or not-met with evidence.

For each criterion, rate verification confidence: high (tested and confirmed via code, tests, or browser), medium (logically satisfied but not independently verified), low (uncertain, recommend human testing).

#### 4d. Present Review

```
Review Results:
  Acceptance Criteria: {N/M met}
  Code Quality: {reviewer findings}
  Security: {security-auditor findings}
  Test Coverage: {test-writer results}
  Documentation: {docs-writer results / not applicable}
  Performance: {pass/issues}
  Overall Confidence: {high/medium/low}
    Lowest-confidence area: {description or "none"}
```

**ASK:** "Review complete. {summary}. Ready to finalize? (yes / address review issues / request human review)"

#### 4e. Capture Learnings

If `.hatch3r/learnings/` exists:

1. Extract learnings from this implementation session (patterns discovered, pitfalls encountered, decisions made).
2. Store in `.hatch3r/learnings/` with appropriate area tags.

---

## Quick Mode

Collapses the 4 phases into a streamlined flow for small, well-defined tasks. Sub-agent delegation is still mandatory — Quick Mode uses lighter prompts, not fewer sub-agents.

### Quick Step 1: Rapid Analysis + Plan (Combined)

1. Score complexity per `hatch3r-deep-context`. If the score yields Tier 3, recommend switching to Full Mode.
2. Spawn `hatch3r-researcher` with depth `quick` for brief context gathering. Skip only for trivial single-line edits. For Tier 2, include `requirements-elicitation` and `similar-implementation` at `quick` depth.
3. Quick plan: list changes, identify the appropriate hatch3r skill. If `similar-implementation` found a reference, note the convention to follow.
4. Skip ADR/spec review unless the task touches architecture.

**ASK:** "Quick analysis: {scope}, {approach}. {Unresolved questions from elicitation, if any.} Proceed? (yes / switch to Full Mode)"

### Quick Step 2: Implement

1. Spawn `hatch3r-implementer` sub-agent via the Task tool. Do NOT implement inline.
2. Run quality checks (lint, typecheck, test).
3. Fix any issues before proceeding.

### Quick Step 3: Quick Review (Sub-Agent Quality Pipeline)

Same two-stage pipeline as Full Mode, with lighter prompts:

**Stage 1 — Review Loop:**

1. Spawn **`hatch3r-reviewer`** with a focused prompt covering correctness and quality.
2. If Critical or Warning findings exist, spawn **`hatch3r-fixer`**, then re-review. Max 3 iterations.

**Stage 2 — Final Quality (after review loop is clean):**

3. **`hatch3r-testability`** (CQ5) — ALWAYS for code changes.
4. **`hatch3r-security`** (CQ3) — ALWAYS for code changes.
5. **`hatch3r-docs-writer`** — evaluate; spawn when documentation impact exists.
6. Verify acceptance criteria are met.
7. Confirm lint/typecheck/test pass.

**ASK:** "Changes complete. Quality checks pass. Finalize? (yes / deeper review needed → switch to Full Mode Phase 4)"

---

## Integration with Board Workflow

### Invoked from `hatch3r-board-pickup`

- Phase 1 uses the issue context already gathered by board-pickup — skip re-fetching.
- Phase 3 skips PR creation — board-pickup handles it in its own Steps 7a–8.
- Phase 4 results feed into board-pickup's quality verification (Step 7).

When operating with board context, all issue operations MUST follow the Projects v2 Enforcement rules defined in `hatch3r-board-shared`.

### Invoked Standalone

- All phases run independently with full context loading.
- User decides whether to create a PR at the end of Phase 4.

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
| Review finalization (Phase 4) | ASK user to finalize | Auto-finalize if all AC met |

### Safety Guardrails (Always Active)

These checkpoints are NEVER skipped, even in auto mode:
- **Destructive operations**: Database migrations, file deletions, security rule changes always require confirmation
- **Breaking changes**: API contract changes, public interface modifications always require confirmation
- **Open questions**: If Phase 1 analysis surfaces unresolvable ambiguity, stop and ASK regardless of mode
- **Quality gate failures**: If lint/typecheck/test fail after 2 fix attempts, stop and ASK
- **Cost thresholds**: When the estimated cost for the selected tier exceeds the configured limit (default: $10 per task), do NOT abort silently. Call `proposeAlternativeTier(currentTier, currentEstimate, budget)` from `src/pipeline/costEstimator.ts` and surface a 3-option ASK: **(a) downgrade** to the suggested lower tier (saves the reported delta — drops the deep researcher modes / Phase-4 specialist depth that the lower tier omits), **(b) raise the budget** and proceed at the current tier, **(c) abort**. Default-if-no-response: abort (preserves the fail-closed contract). When `proposeAlternativeTier` returns `null` (current tier is already the cheapest, or no lower tier fits), present only raise-budget / abort.

### Activation

```
/hatch3r workflow --auto
/hatch3r workflow --auto --mode=full
/hatch3r workflow --auto --mode=quick
```

### Auto Mode with Board Pickup

When invoked from `hatch3r board-pickup --auto`, the workflow inherits the auto flag. All non-safety ASK checkpoints are automatically resolved. The workflow reports its structured result back to board-pickup for PR creation.

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

workflow is long-running — a Tier 2/3 run walks the 4-phase delivery pipeline (Analyze → Plan → Implement → Review), fans out one implementer per independent module in Phase 3, and runs a reviewer ↔ fixer loop plus Phase 4b CQ1–CQ9 specialist batch in Phase 4. Per `governance/CONSTITUTION.md` §6 Decision 30 (Workspace-checkpointed resumability), checkpoint progress so an interrupted run re-enters at the last completed phase rather than re-running researchers or re-implementing already-applied module changes.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.workflow-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (1 Analyze / 2 Plan / 3 Implement / 4 Review), `wave` (per-module implementer batch index for Phase 3 and reviewer-fixer iteration count for Phase 4a), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, moduleManifest, implementerProofIds }`. The cached researcher outputs from Phase 1 live alongside in `.workflow-workspace/research-cache.json` so Phase 2/3 do not re-spawn researcher modes on resume.
2. **Write points:** after Phase 1 researcher fan-out returns, after the Phase 2 plan synthesis is confirmed by ASK, after each Phase 3 implementer sub-agent returns (one write per module so a mid-batch crash preserves prior `delegation_proof_id`s), after each Phase 4a reviewer-fixer iteration, and after the Phase 4b parallel specialist batch (docs-writer + lint-fixer + CQ1–CQ9 specialists) completes.
3. **`--resume` invocation:** `hatch3r-workflow --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the working tree / branch state changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage before resuming. Phase 3 resume reads `implementerProofIds` so already-applied module changes are not re-applied.
4. **Snapshot rollback:** pre-mutation snapshots of every file touched by Phase 3 implementers and Phase 4a fixers land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's mutations. Diff preview precedes every implement / fix mutation per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for workflow: `1` = workflow intake + step decomposition, `2` = per-step sub-agent dispatch, `3` = aggregation + verification of step outputs, `4` = workflow report + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (workflow definition, step outputs, automation manifests) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via <hatch3r-agent-name> (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output. The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `governance/audit/templates/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first sub-agent dispatch (both Full and Quick Mode).
- **Post-execution `cost_actuals` + `delta`** — appended to the Phase 4 / Quick Step 3 iteration summary's Fan-out + Cost section.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 15` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Quick Tier 1 ≈ 2 (researcher + implementer, reviewer/fixer/testability/security when triggered), Quick Tier 2 ≈ 6 (researcher + implementer + reviewer + fixer + testability + security), Full Tier 3 up to 15 (full pipeline including the Phase-4b CQ1-CQ9 specialist batch bounded by `max_phase4_parallel`). Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Quality check failure in Phase 3:** Loop back and fix before proceeding to Phase 4. Do not advance with failing checks.
- **Acceptance criteria not met in Phase 4:** Loop back to Phase 3 with specific items to address.
- **Sub-agent failure:** Retry once, then fall back to direct implementation.
- **Context degradation (>25 turns):** Suggest starting a fresh chat with a progress summary capturing completed work and remaining items.
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
