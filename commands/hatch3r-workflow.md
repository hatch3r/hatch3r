---
id: hatch3r-workflow
type: command
description: Guided development lifecycle with 4 phases (Analyze, Plan, Implement, Review) and scale-adaptive Quick Mode for small tasks.
---
# Development Workflow -- Guided Lifecycle for Structured Implementation

Optional guided development lifecycle command that walks through structured phases — Analyze, Plan, Implement, Review — using hatch3r's existing agents and skills. Includes a Quick Mode that collapses phases for small tasks. Scale-adaptive: detects task complexity and recommends the appropriate mode. Works standalone or when invoked from `hatch3r-board-pickup`.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Global Rule Overrides

- **Git commands are fully permitted** during Phase 3 (Implement), including `git add`, `git commit`, and `git push`. This override applies to delegated skills and sub-agents invoked during implementation.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 0: Mode Selection (Scale-Adaptive)

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

---

## Full Mode

### Phase 1: Analyze

**Goal:** Fully understand the task, its context, and constraints before writing any code.

#### 1a. Parse the Task

- **GitHub issue:** Read issue body, acceptance criteria, labels, parent epic context using `gh issue view` (fall back to `issue_read` MCP).
- **User description:** Extract requirements, scope, constraints from the provided description.
- **Board-pickup invocation:** Use the issue context already gathered by board-pickup. Skip re-fetching.

#### 1b. Load Relevant Context

1. Read project specs from `docs/specs/` — headers first (~30 lines), expand relevant sections only.
2. Read ADRs that might constrain the approach.
3. Scan existing code in the affected area using targeted file reads and searches.
4. Use **Context7 MCP** (`resolve-library-id` then `query-docs`) for external library documentation referenced by the task.
5. Use **web research** for current best practices, security advisories, or novel problems not covered by local docs or Context7.

#### 1c. Consult Learnings

If `/.agents/learnings/` exists:

1. Search for learnings tagged with relevant areas or technologies.
2. Surface any applicable past experiences that inform this task.

#### 1d. Present Analysis

```
Task Analysis:
  Scope: {what's in / what's out}
  Affected files: {list}
  Constraints: {from specs, ADRs}
  Relevant learnings: {if any}
  Open questions: {if any}
  Risk: {low/med/high}
```

**ASK:** "Analysis complete. Questions: {list}. Proceed to Plan phase? (yes / clarify questions first / adjust scope)"

---

### Phase 2: Plan

**Goal:** Design the solution before implementing.

#### 2a. Draft Implementation Plan

1. List all files to create or modify.
2. For each file: describe the specific changes.
3. Identify test requirements (unit, integration, e2e).
4. Note any dependency changes needed.
5. Consider rollback strategy for risky changes.

#### 2b. Select hatch3r Agents and Skills

Map the task type to the appropriate skill:

| Task Type        | Skill                          |
| ---------------- | ------------------------------ |
| Bug report       | hatch3r-bug-fix                |
| Feature request  | hatch3r-feature-implementation |
| Code refactor    | hatch3r-code-refactor          |
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
  Files to modify: {list with change descriptions}
  New files: {list}
  Tests: {what to test}
  Risks: {list with mitigations}
  Estimated effort: {time}
```

**ASK:** "Plan ready. Proceed to Implement? (yes / revise plan / request review of plan first)"

---

### Phase 3: Implement

**Goal:** Execute the plan using the selected hatch3r skill, delegating to sub-agents per the Universal Sub-Agent Pipeline.

#### 3a. Context Gathering (Researcher Sub-Agent)

You MUST spawn a `hatch3r-researcher` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) before implementation. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes).

- Select research modes by task type (bug → symptom-trace/root-cause/codebase-impact, feature → codebase-impact/feature-design/architecture, refactor → current-state/refactoring-strategy/migration-path, QA → codebase-impact).
- Use depth `quick` for low-risk, `standard` for medium-risk, `deep` for high-risk.
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
- All `scope: always` rule directives from `/.agents/rules/`.
- Relevant learnings from `/.agents/learnings/`.
- Explicit instruction: do NOT create branches, commits, or PRs.

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

**ASK:** "Implementation complete. All quality checks pass. Proceed to Review? (yes / fix issues first)"

---

### Phase 4: Review (Sub-Agent Quality Pipeline)

**Goal:** Verify quality and completeness via specialist sub-agents before finalizing.

#### 4a. Spawn Quality Sub-Agents

You MUST spawn specialist sub-agents for quality assurance. Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many independent sub-agents in parallel as the platform supports.

**Always spawn (mandatory for every code change):**

1. **`hatch3r-reviewer`** — code review of all changes. Include the diff and acceptance criteria in the prompt.
2. **`hatch3r-test-writer`** — tests for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
3. **`hatch3r-security-auditor`** — security review of all code changes. Audit data flows, access control, input validation, and secret management.

**Always evaluate (spawn when applicable):**

4. **`hatch3r-docs-writer`** — spawn when changes affect public APIs, architectural patterns, user-facing behavior, or when specs/ADRs need updating. Skip silently if no documentation impact.

**Conditional specialists (spawn when triggered):**

5. **`hatch3r-lint-fixer`** — when lint or type errors are present after implementation.
6. **`hatch3r-a11y-auditor`** — when UI or accessibility changes are made.
7. **`hatch3r-perf-profiler`** — when performance-sensitive changes are made.

Each specialist sub-agent prompt MUST include:
- The agent protocol to follow.
- All `scope: always` rule directives from `/.agents/rules/`.
- The diff or file changes to review.
- The task's acceptance criteria.

Await all specialist sub-agents. Apply their feedback (fixes, additional tests, documentation updates).

#### 4b. Verify Against Acceptance Criteria

Check each acceptance criterion from the original task or issue. Mark as met or not-met with evidence.

#### 4c. Present Review

```
Review Results:
  Acceptance Criteria: {N/M met}
  Code Quality: {reviewer findings}
  Security: {security-auditor findings}
  Test Coverage: {test-writer results}
  Documentation: {docs-writer results / not applicable}
  Performance: {pass/issues}
```

**ASK:** "Review complete. {summary}. Ready to finalize? (yes / address review issues / request human review)"

#### 4d. Capture Learnings

If `/.agents/learnings/` exists:

1. Extract learnings from this implementation session (patterns discovered, pitfalls encountered, decisions made).
2. Store in `/.agents/learnings/` with appropriate area tags.

---

## Quick Mode

Collapses the 4 phases into a streamlined flow for small, well-defined tasks. Sub-agent delegation is still mandatory — Quick Mode uses lighter prompts, not fewer sub-agents.

### Quick Step 1: Rapid Analysis + Plan (Combined)

1. Spawn `hatch3r-researcher` with depth `quick` for brief context gathering. Skip only for trivial single-line edits.
2. Quick plan: list changes, identify the appropriate hatch3r skill.
3. Skip ADR/spec review unless the task touches architecture.

**ASK:** "Quick analysis: {scope}, {approach}. Proceed? (yes / switch to Full Mode)"

### Quick Step 2: Implement

1. Spawn `hatch3r-implementer` sub-agent via the Task tool. Do NOT implement inline.
2. Run quality checks (lint, typecheck, test).
3. Fix any issues before proceeding.

### Quick Step 3: Quick Review (Sub-Agent Quality Pipeline)

Spawn specialist sub-agents in parallel — same mandatory pipeline as Full Mode:

1. **`hatch3r-reviewer`** — ALWAYS. Use a focused prompt covering correctness and quality.
2. **`hatch3r-test-writer`** — ALWAYS for code changes.
3. **`hatch3r-security-auditor`** — ALWAYS for code changes.
4. **`hatch3r-docs-writer`** — evaluate; spawn when documentation impact exists.
5. Verify acceptance criteria are met.
6. Confirm lint/typecheck/test pass.

**ASK:** "Changes complete. Quality checks pass. Finalize? (yes / deeper review needed → switch to Full Mode Phase 4)"

---

## Integration with Board Workflow

### Invoked from `hatch3r-board-pickup`

- Phase 1 uses the issue context already gathered by board-pickup — skip re-fetching.
- Phase 3 skips PR creation — board-pickup handles it in its own Steps 7a–8.
- Phase 4 results feed into board-pickup's quality verification (Step 7).

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
- **Cost thresholds**: Stop if estimated token cost exceeds configured limit (default: $10 per task)

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
- **This command composes existing hatch3r agents and skills** — it does not replace them.
