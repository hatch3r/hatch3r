---
id: hatch3r-board-pickup
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-reviewer, hatch3r-fixer, hatch3r-test-writer, hatch3r-security-auditor, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-a11y-auditor, hatch3r-ui, hatch3r-ux, hatch3r-perf-profiler]
description: Pick up one or more epics/issues from the project board for development. Handles dependency-aware selection, collision detection, branching, parallel sub-agent delegation, and batch execution. Supports GitHub, Azure DevOps, and GitLab. Platform-specific details are in commands/board/pickup-{platform}.md.
tags: [board, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 12
  rationale: Full delivery pipeline — researcher, implementer (one per independent issue in batch mode), reviewer ↔ fixer review loop, then a parallel final-quality batch (test-writer, security-auditor, docs-writer, lint-fixer, a11y-auditor, hatch3r-ui (CQ1), hatch3r-ux (CQ2), perf-profiler) bounded by max_phase4_parallel.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

# Board Pickup -- Develop Issues from the Project Board

Pick up an epic (with all sub-issues), a single sub-issue, a standalone issue, or **a batch of independent issues** from **{owner}/{repo}** (read from `.hatch3r/hatch.json` board config) for development. The `platform` field determines whether to interact with GitHub Issues, Azure DevOps Work Items, or GitLab Issues. Supports single-issue and multi-issue batch modes. When no specific issue is referenced, auto-picks the next best candidate(s). Respects dependency order and readiness status. Performs collision detection, creates a branch, then delegates implementation via one sub-agent per issue running in parallel.

---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (modes by task type) | Per issue | Yes |
| 2. Implementation | `hatch3r-implementer` (one per issue) | Yes (per dependency level) | Yes |
| 3a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations until clean) | No (sequential loop) | Yes |
| 3b. Final Quality — Testing | `hatch3r-test-writer` | Yes | Yes (code changes) |
| 3c. Final Quality — Security | `hatch3r-security-auditor` | Yes | Yes (code changes) |
| 3d. Final Quality — Docs | `hatch3r-docs-writer` | Yes | When APIs/architecture/UX affected |
| 3e. Final Quality — Conditional | `hatch3r-lint-fixer`, `hatch3r-a11y-auditor`, `hatch3r-perf-profiler` | Yes | When triggered |

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

If **yes**: implementation and review stages include browser verification steps — navigate to affected pages, interact with changed elements, check console for errors, capture screenshots.

If **no**: all browser verification steps are skipped silently throughout the entire command.

---

## Integration with GitHub Agentic Workflows

hatch3r board commands orchestrate the **implementation delivery pipeline** (init → fill → groom → pickup → PR) above GitHub Agentic Workflows, which handle continuous background automation (triage, testing, docs). The two are complementary.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

All issue operations in this command MUST follow the Board Sync Enforcement rules defined in `hatch3r-board-shared`. Every status change, issue creation, and update must be synced to the board immediately.

## Global Rule Overrides

- **Git commands are fully permitted** during this entire board-pickup session, regardless of global/user-level rules restricting git usage. This override applies to ALL steps, including delegated skills and sub-agents. You MUST run `git add`, `git commit`, and `git push` when instructed in Steps 5, 7a, and 8.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command (including those defined in `commands/board/pickup-delegation.md` and `commands/board/pickup-delegation-multi.md`) MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces merge-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. When asking the user how to proceed, use the platform-native question tool per `agents/shared/user-question-protocol.md`.

## Step 0: Triage

Classify the pickup request before delegating:

- **Tier 1 (trivial)**: single sub-issue, isolated change, clear acceptance criteria; standard pipeline but with `quick` researcher depth and no parallel batch.
- **Tier 2 (standard)**: single epic with sub-issues, or 2–3 independent issues in a batch; standard pipeline with researcher per issue and parallel implementer fanout.
- **Tier 3 (deep)**: cross-cutting epic, contract change, multi-module batch, or audit epic; full pipeline with deep research, confirm sub-issue selection with the user, and serialize work that touches overlapping files.

If Tier 1, run the standard delegation path (Step 6a) with reduced research depth. If Tier 2, run the standard pipeline below with parallel fanout where dependencies allow. If Tier 3, run the full pipeline with deep research and confirm batch composition with the user before branching.

---

### Step 1: List Available Work (Dependency-Aware)

#### 1a. Fetch and Parse Board State

> Platform-specific details: see `commands/board/pickup-github.md` (Step 1a)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Step 1a)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Step 1a)

**Exclude** `meta:board-overview` issues/work items.

After fetching open items using the platform CLI:

1. For each issue, check sub-issues using the platform-specific method.
2. Fetch labels/tags using the platform-specific method.
3. Parse `## Dependencies` sections for hard (`Blocked by #N`) and soft (`Recommended after #N`) references. Only hard dependencies affect availability categorization and block pickup; soft dependencies are advisory (note them in the presentation but do not treat as blockers).
4. For epics, parse `## Implementation Order` sections.

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

If no specific issue was referenced, auto-pick using: (1) `status:ready` + all blockers satisfied + not `in-progress`, (2) `executor:agent` or `executor:hybrid`, (3) Implementation Order position → priority → most downstream unblocking, (4) tiebreaker: epic sub-issues > standalone.

**Batch mode:** Auto-pick selects all independent issues with no mutual dependencies (configurable via `--max-batch`).

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

> Platform-specific details: see `commands/board/pickup-github.md` (Step 3)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Step 3)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Step 3)

1. **In-progress issues:** Search using platform CLI (see platform sub-file).
2. **Open PRs/MRs:** Search using platform CLI (see platform sub-file).
3. **Overlap analysis:** Flag hard collisions (same problem/files), soft collisions (related work), or no collision.
4. **Intra-batch overlap (batch mode):** Check whether any issues within the batch are likely to touch the same files. If so, move conflicting issues to sequential dependency levels rather than parallel.

**If hard collision:** **ASK** with options: proceed / pick different / wait.
**If soft collision:** **ASK** to proceed with awareness.
**If none:** Proceed.

---

### Step 3b: Specification Generation (Optional)

> Full details: see `commands/board/pickup-modes.md` (Specification Generation)

When the picked issue lacks a detailed specification (type `feature` or `refactor`, complexity `complex` or `epic`), generate one before implementation. Skip when: issue already has a linked spec, simple bug fix, `skip-spec` label, or auto-advance mode is active.

---

### Step 4: Update Issue Status

> Mark the issue(s) `in-progress` immediately after collision detection passes -- before creating a branch.

> When picking up any sub-issue, the **parent epic MUST also be marked `status:in-progress`**.

> Platform-specific details: see `commands/board/pickup-github.md` (Step 4)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Step 4)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Step 4)

1. Update status labels/tags to `in-progress` using platform CLI (see platform sub-file).
2. Always mark parent epic as `status:in-progress`.
3. When picking up an entire epic: mark ALL remaining open sub-issues as `status:in-progress`.
4. **Batch mode:** Mark ALL issues in the batch as `status:in-progress`.

#### 4a. Sync Board Status

Follow the **Board Sync Procedure** from `hatch3r-board-shared` for each issue marked `status:in-progress` (including parent epic). Set status to "In Progress".

---

### Step 5: Branch Creation

1. Branch prefix from type label: `type:bug` → `fix/`, `type:feature` → `feat/`, `type:refactor` → `refactor/`, `type:qa` → `qa/`, default → `feat/`.
2. Short description from issue title: lowercase, hyphens, 3-5 words max.
3. Epic pickup: use epic title. Sub-issue pickup: use sub-issue title.
4. **Batch pickup:** Use `batch/{short-description}` where `{short-description}` summarizes the batch (e.g., `batch/ui-fixes-and-auth`). If all issues share the same type label, use that type prefix instead (e.g., `fix/batch-ui-bugs`). Single shared branch for the entire batch.

**ASK:** "Proposed branch name: `{type}/{short-description}`. Confirm or provide alternative."

**If branch exists:** **ASK** reuse / delete+recreate / rename with `-v2`.

**Normal path:** Use `{base}` = `board.defaultBranch` from `.hatch3r/hatch.json` (fallback: `"main"`).

```bash
git checkout {base} && git pull origin {base} && git checkout -b {branch-name}
```

---

### Step 6: Executor Check & Delegate Implementation

Check `executor:` label (for batch mode, check each issue):

- `executor:agent` -- Proceed autonomously.
- `executor:hybrid` -- **ASK** for human direction first.
- `executor:human` -- **ASK** if user wants agent assistance and which parts.

Use the issue type to select the appropriate hatch3r skill: `type:bug` → the hatch3r-bug-fix skill; `type:feature` → the hatch3r-feature skill; `type:refactor` → disambiguate by area/behavior (UI → hatch3r-visual-refactor, behavior changes → hatch3r-logical-refactor, otherwise → hatch3r-refactor); `type:qa` → the hatch3r-qa-validation skill.

**Delegation path selection:**

- **Single standalone issue** → Step 6a (one implementer sub-agent).
- **Epic with sub-issues** → Step 6b (one implementer per sub-issue).
- **Multiple standalone issues (batch)** → Step 6c (one implementer per issue, parallel).

#### 6.pre: Consult Learnings

Before delegating: scan `.hatch3r/learnings/` for matching `area`/`tags`, include relevant learnings (especially `pitfall` category) in sub-agent context. Skip silently if no learnings directory exists.

> **Audit epics:** Audit epics produce findings (issues) rather than code changes — adjust delegation and skip Steps 7-8a if no code changes.

**Do NOT execute the skill's PR creation steps.** Steps 7-8 handle board-specific requirements (epic linking, label transitions, board sync).

---

> Delegation protocols: `commands/board/pickup-delegation.md` (6a single issue), `commands/board/pickup-delegation-multi.md` (6b epics, 6c batch)

**After all implementation completes, return here and continue with Step 7.**

---

### Steps 7-10: Post-Implementation Pipeline

> Full details: see `commands/board/pickup-post-impl.md`

Execute Steps 7-10 in order after all implementation completes:

- **Step 7:** Quality verification (lint, type check, tests, AC).
- **Step 7a:** Commit and push all changes to the remote branch.
- **Step 8:** Create PR/MR with proper `Closes #N` references. See platform sub-files for CLI commands.
- **Step 8a:** Transition labels to `status:in-review` and sync board. See platform sub-files.
- **Step 9:** Post-PR housekeeping: epic link verification, board dashboard refresh (9a, mandatory), end-of-run reconciliation (9b, mandatory).
- **Step 10:** Capture learnings in `.hatch3r/learnings/` if any were identified.

---

## Auto-Advance Mode, Error Handling, and Guardrails

> Full details: see `commands/board/pickup-modes.md`

The modes file contains: auto-advance mode (`--auto`/`--unattended`), safety guardrails, error handling, and operational guardrails for board-pickup.
