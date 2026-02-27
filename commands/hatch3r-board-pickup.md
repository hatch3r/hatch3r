---
id: hatch3r-board-pickup
type: command
description: Pick up one or more epics/issues from the GitHub board for development. Handles dependency-aware selection, collision detection, branching, parallel sub-agent delegation, and batch execution.
---
# Board Pickup -- Develop Issues from the GitHub Board

Pick up an epic (with all sub-issues), a single sub-issue, a standalone issue, or **a batch of independent issues** from **{owner}/{repo}** (read from `/.agents/hatch.json` board config) for development. Supports single-issue and multi-issue batch modes. When no specific issue is referenced, auto-picks the next best candidate(s). Respects dependency order and readiness status. Performs collision detection, creates a branch, then delegates implementation via one sub-agent per issue running in parallel.

---

## Integration with GitHub Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above GitHub Agentic Workflows. While GitHub's agentic workflows handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide

GitHub Agentic Workflows and hatch3r are complementary: use agentic workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Global Rule Overrides

- **Git commands are fully permitted** during this entire board-pickup session, regardless of global/user-level rules restricting git usage. This override applies to ALL steps, including delegated skills and sub-agents. You MUST run `git add`, `git commit`, and `git push` when instructed in Steps 5, 7a, and 8.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: List Available Work (Dependency-Aware)

#### 1a. Fetch and Parse Board State

1. `list_issues` with `owner: {board.owner}`, `repo: {board.repo}`, `state: OPEN`, sorted by `CREATED_AT` descending. Paginate to get all. **Exclude** `meta:board-overview` issues.
2. For each issue, check sub-issues (`issue_read` with `method: get_sub_issues`).
3. Fetch labels (`issue_read` with `method: get_labels`).
4. Parse `## Dependencies` sections for hard (`Blocked by #N`) and soft (`Recommended after #N`) references. Only hard dependencies affect availability categorization and block pickup; soft dependencies are advisory (note them in the presentation but do not treat as blockers).
5. For epics, parse `## Implementation Order` sections.

**Cache all data retrieved here for reuse in later steps.**

#### 1b. Build Dependency Graph

1. Construct graph from parsed dependency references (both hard and soft).
2. A **hard** dependency is **satisfied** if the blocking issue is closed, **unsatisfied** if open. Soft dependencies (`Recommended after`) do not affect satisfaction -- they are advisory only.
3. Categorize issues into three tiers (based on hard dependencies only):
   - **Available** -- `status:ready` (or `in-progress`) AND all hard blockers satisfied.
   - **Blocked** -- has unsatisfied hard blockers. Remains `status:ready` (not `status:blocked`).
   - **Not Ready** -- still `status:triage`.

#### 1c. Sort by Implementation Order

1. Within epics: `## Implementation Order` position (fall back to issue number).
2. Across board: priority first (`p0` > `p1` > `p2` > `p3`), then dependency order.
3. Group parallelizable items (same topological level, no mutual dependencies).

#### 1d. Present the Board

Present in tiers:

```
Available Work (ready + unblocked):
  Epic #N — Title [status:in-progress]
    Next up: #M — Title [executor:agent] [after #K ✓]

  Independent (parallelizable):
    #N — Title [type:bug] [executor:agent] [priority:p1] [no blockers]
    #M — Title [type:feature] [executor:agent] [priority:p2] [no blockers]
    #K — Title [type:refactor] [executor:agent] [priority:p2] [recommended after #N]

Waiting on Dependencies (hard blockers unsatisfied):
    #N — Title [blocked by #M (open)]

Not Ready (run board-fill to triage):
    #N — Title [missing: priority, area labels]
```

**ASK:** "Here are the open issues. Recommended next picks: [list]. What to pick up? (a) entire epic, (b) specific sub-issue, (c) standalone issue, (d) filter by label, (e) auto-pick, **(f) batch -- pick up multiple independent issues in parallel**."

When the user selects **(f) batch** or references multiple issue numbers (e.g., "pick up #1, #3, #7"):

1. Present all available independent issues (those with no mutual dependencies).
2. **ASK:** "Which issues to batch? (list numbers, or 'all available' for up to {max} independent issues)"
3. Validate that selected issues have no mutual dependencies. If dependencies exist, group into levels (see Step 6c.1).
4. Proceed with all selected issues as a **batch** through Steps 2-9.

#### 1e. Auto-Pick (No Specific Issue Referenced)

If the user invoked without referencing a specific issue, present an auto-pick. Skip if a specific issue was referenced.

**Selection criteria (in order):**

1. Available: `status:ready`, all blockers satisfied, not already `status:in-progress`.
2. `executor:agent` or `executor:hybrid` (skip `executor:human`).
3. Follow the board's Implementation Order (earliest open level, highest-priority entry, most downstream unblocking). Fall back to priority-weighted topological sort.
4. Tiebreaker: epic sub-issues > standalone; most downstream unblocking; higher priority.

**Auto-pick batch mode:** When multiple independent issues are available, auto-pick selects all independent issues that share no mutual dependencies (configurable via `--max-batch`). Present as a batch recommendation.

**ASK:** "Pick up #N? Or batch: #N, #M, #K (independent, parallelizable). Options: (yes single / yes batch / pick alternative / show full board)"

---

### Step 2: Scope Selection & Dependency Validation

#### 2a. Dependency Pre-Check

Parse selected issue's `## Dependencies`. Check each blocker.

**If all satisfied or none:** Proceed.

**If unsatisfied:** **ASK** with options: (a) pick up highest-priority blocker instead, (b) proceed anyway, (c) pick different issue.

#### 2b. Readiness Pre-Check

If not `status:ready` or `status:in-progress`:

**ASK:** "(a) Proceed anyway, (b) run board-fill first, (c) pick a ready issue."

#### 2c. Scope Selection

**Epic selected:** Fetch sub-issues, show implementation order breakdown with status and dependencies. **ASK** which sub-issues to pick up.

**Sub-issue selected:** Show in context of parent epic.

**Standalone selected:** Proceed to collision check.

#### 2d. Parallel Work Suggestions

Note any parallelizable siblings or independent issues.

#### 2e. Batch Validation (Multi-Issue Pickup)

When multiple issues are selected as a batch:

1. Run dependency pre-check (2a) and readiness pre-check (2b) for **each** issue in the batch.
2. Build a cross-issue dependency graph among the selected issues:
   - Issues with no mutual dependencies → same dependency level (can run in parallel).
   - Issues where one depends on another → sequential levels (Level 1 before Level 2).
3. Remove any issues that fail validation (unsatisfied blockers, not ready) and inform the user.
4. Confirm the final batch composition and dependency levels before proceeding.

---

### Step 3: Collision Detection

1. **In-progress issues:** `search_issues` with `label:status:in-progress state:open`.
2. **Open PRs:** `search_pull_requests` with `state:open`.
3. **Overlap analysis:** Flag hard collisions (same problem/files), soft collisions (related work), or no collision.
4. **Intra-batch overlap (batch mode):** Check whether any issues within the batch are likely to touch the same files. If so, move conflicting issues to sequential dependency levels rather than parallel.

**If hard collision:** **ASK** with options: proceed / pick different / wait.
**If soft collision:** **ASK** to proceed with awareness.
**If none:** Proceed.

---

### Step 3b: Specification Generation (Optional)

When the picked issue lacks a detailed specification, generate one before implementation:

#### When to Generate

- Issue body has acceptance criteria but no implementation spec
- Issue is type `feature` or `refactor` (bugs typically don't need specs)
- Issue has complexity label `complex` or `epic`

#### Specification Generation Process

1. **Analyze the issue**: Parse title, body, labels, linked issues, and parent epic context.
2. **Research context**: Read relevant project documentation, existing code in the affected area, and related specs.
3. **Generate specification** with the following structure:

```
## Specification: #{issue_number} — {title}

### Problem Statement
{what needs to change and why}

### Proposed Solution
{high-level approach}

### Technical Design
- **Data model changes**: {new/modified schemas}
- **API changes**: {new/modified endpoints}
- **UI changes**: {new/modified components}
- **Dependencies**: {new libraries or services}

### Implementation Plan
1. {ordered steps}

### Test Strategy
- Unit: {what to unit test}
- Integration: {what to integration test}
- E2E: {what to E2E test}

### Risks & Mitigations
- {risk}: {mitigation}

### Out of Scope
- {explicitly excluded items}
```

4. **ASK:** Present the generated specification to the user for validation before proceeding to implementation.
5. **Store**: Save the validated spec as a comment on the GitHub issue for traceability.

#### Skip Specification

Skip this step when:
- Issue already has a linked spec document
- Issue is a simple bug fix with clear reproduction steps
- Issue has `skip-spec` label
- Auto-advance mode is active (see below)

---

### Step 4: Update Issue Status

> Mark the issue(s) `in-progress` immediately after collision detection passes -- before creating a branch.

> When picking up any sub-issue, the **parent epic MUST also be marked `status:in-progress`**.

1. `issue_write` with `method: update` to replace `status:triage`/`status:ready` with `status:in-progress`.
2. Always mark parent epic as `status:in-progress`.
3. When picking up an entire epic: mark ALL remaining open sub-issues as `status:in-progress`.
4. **Batch mode:** Mark ALL issues in the batch as `status:in-progress`.

#### 4a. Sync Projects v2 Status

Follow the **Projects v2 Sync Procedure** from `hatch3r-board-shared` (gh CLI primary) for each issue marked `status:in-progress` (including parent epic). Set status to "In progress" using `board.statusOptions.inProgress`.

---

### Step 5: Branch Creation

1. Branch prefix from type label: `type:bug` → `fix/`, `type:feature` → `feat/`, `type:refactor` → `refactor/`, `type:qa` → `qa/`, default → `feat/`.
2. Short description from issue title: lowercase, hyphens, 3-5 words max.
3. Epic pickup: use epic title. Sub-issue pickup: use sub-issue title.
4. **Batch pickup:** Use `batch/{short-description}` where `{short-description}` summarizes the batch (e.g., `batch/ui-fixes-and-auth`). If all issues share the same type label, use that type prefix instead (e.g., `fix/batch-ui-bugs`). Single shared branch for the entire batch.

**ASK:** "Proposed branch name: `{type}/{short-description}`. Confirm or provide alternative."

**If branch exists:** **ASK** reuse / delete+recreate / rename with `-v2`.

**Normal path:** Use `{base}` = `board.defaultBranch` from `/.agents/hatch.json` (fallback: `"main"`).

```bash
git checkout {base} && git pull origin {base} && git checkout -b {branch-name}
```

---

### Step 6: Executor Check & Delegate Implementation

Check `executor:` label (for batch mode, check each issue):

- `executor:agent` -- Proceed autonomously.
- `executor:hybrid` -- **ASK** for human direction first.
- `executor:human` -- **ASK** if user wants agent assistance and which parts.

Use the issue type to select the appropriate hatch3r skill: `type:bug` → the hatch3r-bug-fix skill; `type:feature` → the hatch3r-feature-implementation skill; `type:refactor` → disambiguate by area/behavior (UI → hatch3r-visual-refactor, behavior changes → hatch3r-logical-refactor, otherwise → hatch3r-code-refactor); `type:qa` → the hatch3r-qa-validation skill.

**Delegation path selection:**

- **Single standalone issue** → Step 6a (one implementer sub-agent).
- **Epic with sub-issues** → Step 6b (one implementer per sub-issue).
- **Multiple standalone issues (batch)** → Step 6c (one implementer per issue, parallel).

#### 6.pre: Consult Learnings

Before delegating implementation:

1. If `/.agents/learnings/` exists, scan for learnings with matching `area` or `tags` that overlap with the issue's area labels or tech stack.
2. Read the `## Applies When` section of matching learnings.
3. Include any relevant learnings (especially `pitfall` category) in the sub-agent prompt or direct implementation context.
4. If no learnings directory exists, skip silently.

> **For audit epics:** If the selected epic represents an audit (e.g., healthcheck, security audit, dependency audit), customize this step based on the project's audit protocol. Audit epics typically produce GitHub issues as findings rather than code changes -- adjust the delegation flow accordingly and skip Steps 7-8a if no code changes are produced.

**Do NOT execute the skill's PR creation steps.** Testing and PR creation are handled by board-pickup Steps 7-8 below, which include board-specific requirements (epic linking, label transitions, Projects v2 sync) that individual skills do not cover.

**After all implementation completes, return here and continue with Step 7.**

---

#### 6a. Single Standalone Issue -- Subagent Delegation

For a single standalone issue (no sub-issues, not part of a batch), follow this three-phase approach: research, delegate to implementer, then specialist review.

##### 6a.1. Context Gathering (Researcher Subagent)

**Skip this step only** for trivially simple issues (`risk:low` AND `priority:p3`).

Spawn a **hatch3r-researcher** sub-agent via the Task tool (`subagent_type: "generalPurpose"`) with:

- **Research brief:** The issue title, body, acceptance criteria, and area labels.
- **Modes by issue type:**
  - `type:bug` → `symptom-trace`, `root-cause`, `codebase-impact`
  - `type:feature` → `codebase-impact`, `feature-design`, `architecture`
  - `type:refactor` → `current-state`, `refactoring-strategy`, `migration-path`
  - `type:qa` → `codebase-impact`
  - `type:docs` → `codebase-impact`
  - `type:infra` → `codebase-impact`, `risk-assessment`
- **Depth:** `quick` for `risk:low`, `standard` for `risk:med`, `deep` for `risk:high`.
- **Project context:** Pre-loaded documentation references from area labels.

Await the researcher result. Use its structured output to inform Steps 6a.2-6a.3.

##### 6a.2. Core Implementation (Implementer Subagent)

You MUST spawn a **hatch3r-implementer** sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Do NOT implement inline — always delegate to a dedicated implementer to preserve orchestrator context for coordination, review, and integration.

The implementer sub-agent prompt MUST include:
- The issue number, title, full body, and acceptance criteria.
- The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
- The researcher output from Step 6a.1 (if that step was not skipped).
- Documentation references relevant to this issue.
- Instruction to follow the **hatch3r-implementer agent protocol**.
- All `scope: always` rule directives from `/.agents/rules/` — subagents do not inherit rules automatically.
- Relevant learnings from `/.agents/learnings/` (from Step 6.pre).
- Explicit instruction: do NOT create branches, commits, or PRs.

Await the implementer sub-agent. Collect its structured result (files changed, tests written, issues encountered).

##### 6a.3. Post-Implementation Specialist Delegation

After implementation completes, spawn specialist sub-agents for quality assurance. Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many independent sub-agents in parallel as the platform supports.

**Always spawn (mandatory for every code change):**
- **hatch3r-reviewer** — code review of all changes. Include the diff and acceptance criteria in the prompt.
- **hatch3r-test-writer** — tests for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
- **hatch3r-security-auditor** — security review of all code changes. Audit data flows, access control, input validation, and secret management.

**Always evaluate (spawn when applicable):**
- **hatch3r-docs-writer** — spawn when changes affect public APIs, architectural patterns, or user-facing behavior. Skip silently if no documentation impact.

**Conditional specialists (spawn when triggered):**
- **hatch3r-lint-fixer** — spawn when lint errors are present after implementation.
- **hatch3r-a11y-auditor** — spawn when issue has `area:ui` or `area:a11y` labels.
- **hatch3r-perf-profiler** — spawn when issue has `area:performance` label or changes touch hot paths.

Each specialist sub-agent prompt MUST include:
- The agent protocol to follow (e.g., "Follow the hatch3r-reviewer agent protocol").
- All `scope: always` rule directives from `/.agents/rules/` (subagents do not inherit rules automatically).
- The diff or file changes to review.
- The issue's acceptance criteria.

Await all specialist sub-agents. Apply their feedback (fixes, additional tests, documentation updates) before proceeding to Step 7.

---

#### 6b. Epics -- Sub-Agent Delegation (One Implementer Per Sub-Issue)

For epics with sub-issues, delegate each sub-issue to a dedicated implementer sub-agent. The parent orchestrator (this agent) coordinates dependency order, parallelism, and git operations.

##### 6b.1. Parse Sub-Issues Into Dependency Levels

1. Fetch the epic's `## Implementation Order` section.
2. Group sub-issues by dependency level:
   - **Level 1:** Sub-issues with no unsatisfied blockers (can start immediately).
   - **Level N:** Sub-issues whose blockers are all in levels < N.
3. Within each level, identify parallelizable sub-issues (no mutual dependencies).

##### 6b.2. Prepare Shared Context

Before spawning implementer sub-agents, delegate context gathering to the **hatch3r-researcher agent protocol**.

1. Read the epic body (goal, scope, constraints).
2. Spawn a researcher sub-agent following the **hatch3r-researcher agent protocol** with:
   - **Research brief:** The epic title, goal, scope, constraints, and area labels.
   - **Modes:** `codebase-impact`, `risk-assessment`
   - **Depth:** `standard` for most epics. Use `quick` if the epic has fewer than 3 sub-issues or is well-specified with linked specs. Use `deep` if the epic spans multiple modules or introduces new patterns.
   - **Project context:** Pre-loaded documentation references from area labels.
3. Await the researcher result. Include the structured output as shared context in all implementer sub-agent prompts in Step 6b.3.

##### 6b.3. Execute Level-by-Level With Parallel Sub-Agents

For each dependency level, starting at Level 1:

1. **Spawn one implementer sub-agent per sub-issue in the current level.** Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many sub-agents concurrently as the platform supports.

2. **Each sub-agent prompt must include:**
   - The sub-issue number, title, full body, and acceptance criteria.
   - The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
   - Parent epic context (title, goal, related sub-issues at the same level).
   - The researcher output from Step 6b.2 (codebase impact and risk assessment as shared context).
   - Documentation references relevant to this sub-issue.
   - Instruction to follow the hatch3r-implementer agent protocol.
   - All `scope: always` rule directives from `/.agents/rules/` — subagents do not inherit rules automatically.
   - Relevant learnings from `/.agents/learnings/` (from Step 6.pre).
   - Instruction to use GitHub MCP for issue reads, and follow the project's tooling hierarchy for external knowledge augmentation.
   - Explicit instruction: do NOT create branches, commits, or PRs.

3. **Await all sub-agents in the current level.** Collect their structured results (files changed, tests written, issues encountered).

4. **Review sub-agent results:**
   - If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, fix manually, retry).
   - If sub-agents modified overlapping files, review for conflicts and resolve before proceeding.

5. **Advance to the next dependency level.** Repeat steps 1-4 until all levels are complete.

##### 6b.4. Post-Delegation Verification

After all sub-agents complete:

1. Run a combined quality check across all changes.
2. Resolve any cross-sub-issue integration issues.
3. Verify no file conflicts between parallel sub-agent outputs.

---

#### 6c. Multi-Issue Batch -- Parallel Subagent Delegation (One Implementer Per Issue)

For batches of multiple standalone issues (selected via batch mode in Step 1d or by referencing multiple issue numbers), delegate each issue to a dedicated implementer sub-agent. The parent orchestrator (this agent) coordinates dependency levels, parallelism, collision avoidance, and git operations.

##### 6c.1. Group Issues Into Dependency Levels

1. Use the updated cross-issue dependency graph (from Step 2e, adjusted by Step 3.4).
2. Group issues by dependency level:
   - **Level 1:** Issues with no dependencies on other issues in the batch (can start immediately). Most standalone issues will be Level 1.
   - **Level N:** Issues that depend on other issues in levels < N.
3. Within each level, all issues are parallelizable (no mutual dependencies — conflicts were moved to separate levels in Step 3).

##### 6c.2. Context Gathering (Parallel Researchers)

**Skip this step only** if ALL issues in the batch are trivially simple (`risk:low` AND `priority:p3`).

Unlike epics (which share a single researcher), standalone issues in a batch are unrelated and each need individual context gathering.

1. **Spawn one hatch3r-researcher sub-agent per issue** via the Task tool (`subagent_type: "generalPurpose"`). Launch as many concurrently as the platform supports.

2. **Each researcher prompt must include:**
   - The issue title, body, acceptance criteria, and area labels.
   - Research modes by issue type (same as Step 6a.1).
   - Depth by risk level (`quick` / `standard` / `deep`).
   - Project context and documentation references.

3. **Await all researchers.** Collect structured outputs. Each researcher's output feeds exclusively into its corresponding implementer in Step 6c.3.

##### 6c.3. Execute Level-by-Level With Parallel Implementers

For each dependency level, starting at Level 1:

1. **Spawn one hatch3r-implementer sub-agent per issue in the current level.** Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many sub-agents concurrently as the platform supports.

2. **Each sub-agent prompt must include:**
   - The issue number, title, full body, and acceptance criteria.
   - The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
   - Batch context: sibling issues in the batch at the same level (for awareness, not implementation).
   - The researcher output from Step 6c.2 for this specific issue (if that step was not skipped).
   - Documentation references relevant to this issue.
   - Instruction to follow the **hatch3r-implementer agent protocol**.
   - All `scope: always` rule directives from `/.agents/rules/` — subagents do not inherit rules automatically.
   - Relevant learnings from `/.agents/learnings/` (from Step 6.pre).
   - Explicit instruction: do NOT create branches, commits, or PRs.

3. **Await all sub-agents in the current level.** Collect their structured results (files changed, tests written, issues encountered).

4. **Review sub-agent results:**
   - If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, fix manually, retry).
   - If sub-agents modified overlapping files, review for conflicts and resolve before proceeding.

5. **Advance to the next dependency level.** Repeat steps 1-4 until all levels are complete.

##### 6c.4. Post-Batch Verification

After all implementer sub-agents complete across all levels:

1. Run a combined quality check across all changes from all issues.
2. Resolve any cross-issue file conflicts or integration issues.
3. Verify no regressions between parallel sub-agent outputs.

##### 6c.5. Post-Implementation Specialist Delegation

After all implementations complete, spawn specialist sub-agents across the entire batch. Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many independent sub-agents in parallel as the platform supports.

**Always spawn (mandatory for every code change):**
- **hatch3r-reviewer** — code review of ALL changes across the batch. Include the full diff and acceptance criteria for each issue.
- **hatch3r-test-writer** — tests for all code changes across the batch.
- **hatch3r-security-auditor** — security review of all code changes across the batch.

**Always evaluate (spawn when applicable):**
- **hatch3r-docs-writer** — spawn when any changes affect public APIs, architectural patterns, or user-facing behavior.

**Conditional specialists (spawn when triggered by any issue in the batch):**
- **hatch3r-lint-fixer** — spawn when lint errors are present after implementation.
- **hatch3r-a11y-auditor** — spawn when any issue has `area:ui` or `area:a11y` labels.
- **hatch3r-perf-profiler** — spawn when any issue has `area:performance` label.

Await all specialist sub-agents. Apply their feedback before proceeding to Step 7.

---

### Step 7: Quality Verification

Run the project's quality checks (linting, type checking, tests). Refer to the project's `AGENTS.md`, `README.md`, or `package.json` scripts for the appropriate commands.

Verify: all AC met, tests passing, no lint errors, dead code removed, project-specific invariants respected.

---

### Step 7a: Commit & Push

Stage, commit, and push all changes so the branch exists on the remote before PR creation.

**Single issue or epic:**

```bash
git add -A
git commit -m "{type}: {short description} (#{issue})"
git push -u origin {branch-name}
```

- Use the branch type prefix (`feat`, `fix`, `refactor`, `qa`) matching the branch name.
- Reference the issue number in the commit message.
- If `git push` fails (e.g., branch already exists on remote), use `git push` without `-u`.

**Batch mode:** Create one commit covering all issues in the batch.

```bash
git add -A
git commit -m "batch: {short description} (#N, #M, #K)"
git push -u origin {branch-name}
```

- List all issue numbers in the commit message.
- If all issues share a type, use that type prefix instead of `batch`.

---

### Step 8: Create Pull Request

Follow the project's PR creation skill or conventions:

1. **Title:** `{type}: {short description} (#issue)` — for batch mode: `batch: {short description} (#N, #M, #K)`.
2. **Determine epic link type:** If working on an epic's sub-issues, check whether ALL sub-issues of the parent epic are addressed by this PR (listed as `Closes #N`) or are already closed. If yes → use `Closes #<epic-number>` so the epic auto-closes on merge. If some sub-issues remain open and unaddressed → use `Relates to #<epic-number>`.
3. **Body:** Use the repository's PR template if available (`.github/PULL_REQUEST_TEMPLATE.md`). Fill: Summary, Type, Changes, Testing, Rollout plan. Include a **Related Issues** section listing:
   - `Closes #N` for each issue addressed by this PR (including all batch issues).
   - `Closes #<epic>` (all sub-issues addressed) OR `Relates to #<epic>` (partial) for the parent epic.
   - Always list both the epic and all sub-issues in the Related Issues section regardless of partial/full completion.
   - **Batch mode:** List `Closes #N` for every issue in the batch. Include a per-issue summary of changes in the body.
4. **Create:** Use `gh pr create` (primary) with `--head {branch}`, `--base {base}`, `--title`, `--body`; fall back to `create_pull_request` if `gh` CLI unavailable. `{base}` = `board.defaultBranch` from `/.agents/hatch.json` (fallback: `"main"`).
5. **Link PR to epic:** Use `gh issue comment` (primary) on the epic with PR reference; fall back to `add_issue_comment` if `gh` CLI unavailable.

---

### Step 8a: Post-PR Label Transition & Project Board Sync

1. **Transition labels to `status:in-review`:** For each `Closes #N` issue (including all batch issues), remove `status:in-progress`, add `status:in-review`. If ALL sub-issues addressed, also transition the parent epic.

2. **Sync Projects v2:** Run the full **Projects v2 Sync Procedure** from `hatch3r-board-shared` (add + capture `item_id` + update status) for **each** of the following items individually:
   - **a. The PR:** `item_type: pull_request`, `pull_request_number: <N>` → set to "In review" using `board.statusOptions.inReview`.
   - **b. Each `Closes #N` issue:** `item_type: issue`, `issue_number: <N>` → set to "In review" using `board.statusOptions.inReview`. In batch mode, this includes every issue in the batch.
   - **c. Parent epic (all sub-issues addressed):** `item_type: issue`, `issue_number: <epic>` → set to "In review" using `board.statusOptions.inReview`. The PR body uses `Closes #<epic>`, so the epic will auto-close on merge and transition to Done.
   - **d. Parent epic (partial -- some sub-issues remain):** `item_type: issue`, `issue_number: <epic>` → verify status is "In progress" using `board.statusOptions.inProgress`; set it if not. The PR body uses `Relates to #<epic>` (epic stays open after merge).

---

### Step 9: Post-PR Housekeeping

1. If all sub-issues addressed, confirm the PR body uses `Closes #<epic-number>` so the epic will auto-close on merge and transition to Done.
2. Remind user `Closes #N` auto-closes on merge.
3. If partial:

**ASK:** "PR created. N remaining sub-issues on epic #X. Continue with next sub-issue or stop?"

#### 9a. Refresh Board Dashboard

**This step is mandatory. Do not skip.**

If a `meta:board-overview` issue exists on the board, refresh it now using cached board data updated with mutations from Steps 4, 8, and 8a. Include the `Recommended Model` column in all issue listings per the Board Overview section in `hatch3r-board-shared`. Do NOT re-fetch all issues; use cached data. Skip silently if no `meta:board-overview` issue exists.

---

### Step 10: Capture Learnings

After PR creation, capture learnings from this development session.

1. Reflect on the implementation:
   - Were there any unexpected challenges or blockers?
   - Did any patterns or approaches work particularly well?
   - Were there decisions made that future developers should know about?
   - Were any pitfalls discovered that should be avoided next time?

2. If learnings are identified:
   - Create learning files in `/.agents/learnings/` following the learning file format (see `hatch3r-learn` command).
   - Include the issue number as `source-issue`.
   - Tag with relevant area labels from the issue.
   - **ASK:** "Learnings captured: {list}. Anything else to note? (add more / done)"

3. If no significant learnings: skip silently. Not every task produces learnings. Do not prompt in this case.

---

## Auto-Advance Mode

When invoked with `--auto` or `--unattended`, the board pickup operates with reduced human checkpoints for sustained autonomous operation.

### Behavior Changes in Auto Mode

| Checkpoint | Normal Mode | Auto Mode |
|-----------|-------------|-----------|
| Issue selection | ASK user to confirm | Auto-select highest priority ready issue(s); **auto-batch** independent issues up to `--max-batch` (default 4) |
| Specification generation | ASK user to validate | Auto-generate and attach, skip validation |
| Implementation plan | ASK user to review | Auto-proceed with plan |
| PR creation | ASK user to confirm | Auto-create PR |
| Review feedback | Wait for human review | Proceed to next issue/batch |

In auto mode, batch pickup is the default when multiple independent issues are available. The system auto-selects up to `--max-batch` independent issues and processes them in parallel via Step 6c.

### Safety Guardrails (Always Active)

These checkpoints are NEVER skipped, even in auto mode:
- **Destructive operations**: Database migrations, file deletions, security rule changes always require confirmation
- **Breaking changes**: API contract changes, public interface modifications always require confirmation
- **Cost thresholds**: Stop if estimated token cost exceeds configured limit (default: $10 per issue)
- **Error threshold**: Stop after 3 consecutive implementation failures
- **Scope limits**: Maximum 10 issues per auto session (configurable)

### Activation

```
/hatch3r board-pickup --auto
/hatch3r board-pickup --auto --max-issues=5 --cost-limit=20
/hatch3r board-pickup --auto --max-batch=4
```

### Session Report

At the end of an auto session, generate a summary:
- Issues completed: {count}
- Issues batched: {count per batch}
- PRs created: {list}
- Issues blocked: {list with reasons}
- Total estimated cost: {tokens/cost}
- Learnings captured: {count}

---

## Error Handling

- `list_issues`/`search_issues` failure: retry once, then ask user for issue number.
- `issue_write` failure: warn and continue (labels not blocking).
- Quality verification failure: fix before creating PR.
- `create_pull_request` failure: present error and manual instructions.

## Guardrails

- **Never skip collision check** (Step 3).
- **Never skip ASK checkpoints.**
- **Always work on a dedicated branch.** Never commit to the default branch.
- **Stay within scope.** Note related work but do not implement it.
- **One PR per pickup session.** A single issue, epic, or batch produces one PR. Split large epics into multiple PRs.
- **One sub-agent per issue.** Every issue MUST be delegated to its own `hatch3r-implementer` sub-agent -- never implement multiple issues inline. This applies to standalone issues (6a), epic sub-issues (6b), and batch issues (6c).
- **Maximize parallelism.** Launch as many independent sub-agents concurrently as the platform supports. Only serialize when dependency order or file conflicts require it.
- **Respect the issue-type skill** as source of truth for implementation.
- **Respect dependency and implementation order.** Warn and suggest blockers.
- **Prefer `status:ready` issues.** Warn if selecting non-ready.
- **Board Overview is auto-maintained.** Exclude from all analysis.
- **Always create a PR.** Every board-pickup session MUST end with a PR (Steps 7a-8) unless explicitly abandoned by the user or the epic is an audit that produces no code changes. If quality checks fail in Step 7, fix the issues and re-run Step 7 -- do not exit without completing Steps 7a, 8, 8a, and 9.
