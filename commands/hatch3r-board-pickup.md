---
id: hatch3r-board-pickup
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-reviewer, hatch3r-fixer, hatch3r-testability, hatch3r-security, hatch3r-docs-writer, hatch3r-lint-fixer, hatch3r-ui, hatch3r-ux, hatch3r-performance]
description: "Pick up epics/issues from the project board: dependency-aware selection, collision detection, branching, batch execution. Multi-platform."
argument-hint: "[--auto] [--max-batch=N] [--confidence-floor=any|medium|high]"
disable-model-invocation: true
tags: [board, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
plan_gate: true
sub_agents_spawned:
  count: 11
  rationale: Full delivery pipeline — researcher, implementer (one per independent issue in batch mode), reviewer ↔ fixer review loop, then a parallel final-quality batch (testability (CQ5), security (CQ3), docs-writer, lint-fixer, hatch3r-ui (CQ1), hatch3r-ux (CQ2), performance (CQ7)) bounded by max_phase4_parallel. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: contradictory inputs, missing target, unknown convention.

# Board Pickup -- Develop Issues from the Project Board

Pick up an epic (with all sub-issues), a single sub-issue, a standalone issue, or **a batch of independent issues** from **{owner}/{repo}** (read from `.hatch3r/hatch.json` board config) for development. The `platform` field determines whether to interact with GitHub Issues, Azure DevOps Work Items, or GitLab Issues. Supports single-issue and multi-issue batch modes. When no specific issue is referenced, auto-picks the next best candidate(s). Respects dependency order and readiness status. Performs collision detection, creates a branch, then delegates implementation via one sub-agent per issue running in parallel.

---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Research | `hatch3r-researcher` (modes by task type) | Per issue | Yes |
| 2. Implementation | `hatch3r-implementer` (one per issue) | Yes (per dependency level) | Yes |
| 3a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations until clean) | No (sequential loop) | Yes |
| 3b. Final Quality — Testing | `hatch3r-testability` | Yes | Yes (code changes; Tier-1 relaxation per `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria) |
| 3c. Final Quality — Security | `hatch3r-security` | Yes | Yes (code changes; Tier-1 relaxation per `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria) |
| 3d. Final Quality — Docs | `hatch3r-docs-writer` | Yes | When APIs/architecture/UX affected |
| 3e. Final Quality — Triggered | `hatch3r-lint-fixer`, `hatch3r-performance` (conditional); `hatch3r-ui`, `hatch3r-ux` (mandatory-on-match — each triggered one MUST spawn as its own dedicated instance at Tier 2/3) | Yes | When triggered |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

**Conditional-CQ scope (D7-SA7.5-02):** board-pickup delivery dispatches CQ1/CQ2/CQ3/CQ5/CQ7 (+ `hatch3r-docs-writer`, `hatch3r-lint-fixer`); the conditional backend/API specialists — CQ4 `hatch3r-reliability`, CQ6 `hatch3r-scalability`, CQ8 `hatch3r-maintainability`, CQ9 `hatch3r-enhancability` — are a stated deferral on this delivery path, not silent drift: they run when the same code passes through `hatch3r-workflow` (its Phase 4b dispatches every triggered CQ1-CQ9 specialist per `SPECIALIST_TRIGGER_TABLE`) or an audit cycle. Step 7's jscpd duplication scan covers the duplication half of CQ8 in-path.

**Review-loop convergence (stage 3a cap):** the code-class cap of 3 stays the operative number; iterations >=2 re-review only changed hunks plus findings marked verify-fix; Medium/Low findings carry forward, not re-litigated; cap-out is an UNRESOLVED escalation, never silent continuation (delta re-review policy, `rules/hatch3r-agent-orchestration.md`; loop mechanics: `commands/board/pickup-delegation.md`).

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

> Browser-verification contract (spec-first, tiered): see `commands/shared/orchestration-frame.md` → Browser Verification (opt-in); protocol home `rules/hatch3r-browser-verification.md`. Per-command slot: when enabled, the implementation and review stages run browser-verification steps on UI-affecting changes; if declined, skip every browser-verification step for the session and do not re-ask.

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

Classify the pickup request and emit the tier-rationale line `tier: <1|2|3> — <signal summary>` before the first delegation (absent signals select Tier 2, never Deep); per-tier pipeline depth defers to `agents/shared/triage-vocabulary.md` → Pipeline pruning per tier:

- **Tier 1 (trivial)**: single sub-issue, isolated change, clear acceptance criteria; standard pipeline but with `quick` researcher depth and no parallel batch.
- **Tier 2 (standard)**: single epic with sub-issues, or 2–3 independent issues in a batch; standard pipeline with researcher per issue and parallel implementer fanout.
- **Tier 3 (deep)**: cross-cutting epic, contract change, multi-module batch, or audit epic; full pipeline with deep research, confirm sub-issue selection with the user, and serialize work that touches overlapping files.

If Tier 1, run the standard delegation path (Step 6a) with reduced research depth. If Tier 2, run the standard pipeline below with parallel fanout where dependencies allow. If Tier 3, run the full pipeline with deep research and confirm batch composition with the user before branching.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 6 delegation), surface the cost preview so a multi-issue batch pickup is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier and the selected batch size:

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 ~2, Tier 2 ~6, Tier 3 up to 12 × batch-issue count>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Effort Override (Decision 17). Misclassification example: an isolated sub-issue scored as Deep, or a cross-cutting epic scored as Light.

### Confidence Floor (Decision 16 / D13-SA13.3-F13.3.3)

`--effort` calibrates work-effort depth; `--confidence-floor` calibrates the confidence threshold at which the Step 7 review gate (the canonical **Confidence-Aware Review Gate** in `agents/shared/confidence-gate.md`, run by `commands/board/pickup-delegation.md` / `pickup-delegation-multi.md`) blocks. They are orthogonal. This is the user's pre-flight assertiveness knob — the forced-second-pass on low confidence is post-hoc; the floor sets the bar before the run:

- `--confidence-floor=any|medium|high` (default `any`). Resolution order: explicit flag wins over the persisted `hatch3r config confidence_floor=...` default, which wins over the built-in `any`.
- **`any`** (current behavior): force a second reviewer pass only when reviewer confidence `== low` with 0 Critical + 0 Warning.
- **`medium`**: force a second pass on ANY finding rated `confidence == low`, even with 0 Critical + 0 Warning.
- **`high`**: force a second pass on any finding rated `confidence != high`, AND ASK the user on every low-confidence finding regardless of severity.
- Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`. Pass the resolved floor verbatim into the Step 7 review-gate evaluation (`agents/shared/confidence-gate.md`, which the delegation sub-files run) alongside the confidence value sourced from the upstream reviewer (Confidence Propagation Contract). The floor never relaxes a Safety Guardrail.

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
5. **Intra-batch contract overlap (batch mode):** scan each issue's body and linked spec (the brownfield spec's Integration-Surface table when present) for named contracts — endpoint paths, collection/table names, event names, exported symbols, shared constants/config keys. Two issues naming the same contract are a contract collision even when their predicted file sets are disjoint: move them to sequential levels, or mark the pair for seam-owner assignment at Step 6c.2 (`rules/hatch3r-contract-census.md` → Seam-Owner Protocol). This is a first-pass textual signal; the authoritative check is the researcher breaking-change cross-check in Step 6c.2.

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

### Step 5.5: In-Session Plan Gate (Tier >= 2)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: artifact covers the picked batch — issue set, dependency levels, per-issue scope/acceptance criteria/predicted files from Steps 1–3 (plus Step 3b spec links when generated); slug from the primary issue (`docs/plans/{YYYY-MM-DD}-issue-{N}-{slug}.md`); gated dispatch = Step 6; revise returns to Step 5.5 synthesis; unattended mode = auto-advance (`--auto`) — persist, attach as issue comment, continue per `commands/board/pickup-modes.md`.

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

Before delegating: scan `.hatch3r/learnings/` for matches — test the issue's target file paths against each learning's `applies-to` glob and the work area against its `topic` (canonical match keys per `rules/hatch3r-learning-system.md`; accept legacy `area`/`tags` only as a transitional fallback) — and include relevant learnings (prioritise pitfall-type learnings) in sub-agent context. Skip silently if no learnings directory exists.

**Cross-PR finding memory (D13-SA13.1-F08).** Also scan `.hatch3r/review-findings/` (skip silently if absent) for entries whose `applies-to` glob matches the issue's target files; carry the 5 most-recent matches (by `created` descending) forward into the Step 7a reviewer prompt as a `## Cross-PR Findings` block so the reviewer — which declares `consults_cross_pr_findings: true` — weighs prior same-file findings as organisational memory. After the Step 7a review loop terminates clean, append one `.hatch3r/review-findings/<id>.md` entry per Critical/Warning finding resolved (atomic write via `src/merge/safeWrite.ts`), mirroring the Step 10 learnings-capture pattern — derive the entry from the findings-ledger fold and cite its `finding_id` (`rules/hatch3r-findings-ledger.md` → Store Boundaries).

> **Audit epics:** Audit epics produce findings (issues) rather than code changes — adjust delegation and skip Steps 7-8a if no code changes.

**Do NOT execute the skill's PR creation steps.** Steps 7-8 handle board-specific requirements (epic linking, label transitions, board sync).

---

> Delegation protocols: `commands/board/pickup-delegation.md` (6a single issue), `commands/board/pickup-delegation-multi.md` (6b epics, 6c batch)

**After all implementation completes, return here and continue with Step 7.**

---

### Steps 7-10: Post-Implementation Pipeline

> Full details: see `commands/board/pickup-post-impl.md`

Execute Steps 7-10 in order after all implementation completes:

- **Step 7:** Quality verification (lint, type check, tests, AC). **Post-write duplication scan (Decision 21 / D13-SA13.2-F7):** when batch mode ran 2+ parallel implementers (Step 6c), run `npx jscpd --min-lines 40 --threshold 80 --reporters json --silent <changed-paths>` on the combined diff before the review gate clears — parallel implementers can each emit near-duplicate code that passes its own review independently. Any cross-file clone **≥40 lines OR ≥80% byte-similar** routes back to `hatch3r-fixer` for a DRY refactor (max 1 iteration), then re-runs the quality check. Skip when a single issue/implementer ran.
- **Step 7a:** Commit and push all changes to the remote branch.
- **Step 8:** Create PR/MR with proper `Closes #N` references. See platform sub-files for CLI commands.
- **Step 8a:** Transition labels to `status:in-review` and sync board. See platform sub-files.
- **Step 9:** Post-PR housekeeping: epic link verification, board dashboard refresh (9a, mandatory), end-of-run reconciliation (9b, mandatory).
- **Step 10:** Capture learnings in `.hatch3r/learnings/` if any were identified.

---

## Resumability (Decision 27/30)

board-pickup is long-running — a Tier 3 batch picks up multiple epics/sub-issues, branches, delegates parallel implementers per dependency level (Step 6), runs the reviewer ↔ fixer review loop (Step 7a), and fans out the Phase 4 specialist batch (Step 7b–7c) across 11 sub-agents in `agentPipeline`. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-claiming issues, re-creating branches, or repeating implementer work that already wrote code.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.board-pickup-workspace/`; step range the Step 0 → Step 10 progression; `wave` = dependency-level batch index when parallel implementers run; snapshot/rollback paths `.hatch3r/handoffs/` entries written by `hatch3r-handoff` and pre-commit working-tree state. Write points: after Step 1 work selection ASK, after Step 2 scope + dependency lock, after Step 3 collision detection, after Step 4 board-status update (issues moved to In Progress), after Step 5 branch creation (atomic with `branchName` persistence), after Step 5.5 plan-gate artifact write + approval, after each Step 6 implementer batch returns per dependency level (so completed implementations survive a crash and are not re-implemented on resume), after each Step 7a review-loop iteration, after each Step 7b/7c parallel-specialist batch completes, after Step 8 git commit, and after Step 9 PR-readiness gate.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for board-pickup: `1` = ready-queue selection + branch checkout, `2` = researcher + implementer dispatch, `3` = reviewer/fixer review-loop + Phase 4 specialists, `4` = PR creation + board sync + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: implementer code changes, test additions, fixer corrections; plus the Step 5.5 plan-gate artifact — an orchestrator-written planning artifact (single-writer synthesis per the frame's In-Session Plan Gate), attributed to the orchestrator, not to an implementer proof id.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 41; lineage 28 → 37 → 38). Epic (Step 6b) and batch (Step 6c) runs maintain the cumulative Completion Ledger across dependency levels — re-emit the updated `sub-issues: done <a> · deferred <b> · blocked <c> (<a>/<N>)` totals at each level boundary and at the Step 9 continuation ASK — and close with the run-level ledger + disposition gate per `rules/hatch3r-iteration-summary.md` → Completion Ledger.

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first sub-agent dispatch (Step 6 delegation).
- **Post-execution `cost_actuals` + `delta`** — the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 11` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 ≈ 2 (researcher + implementer, reviewer/fixer/testability/security when triggered); Tier 2 ≈ 6 (researcher + implementer + review loop + mandatory final-quality); Tier 3 up to 11 per issue (full pipeline including the Phase-4b CQ specialist batch bounded by `max_phase4_parallel`), scaling with batch-issue count. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Auto-Advance Mode, Error Handling, and Guardrails

> Full details: see `commands/board/pickup-modes.md`

The modes file contains: auto-advance mode (`--auto`/`--unattended`), safety guardrails, error handling, and operational guardrails for board-pickup.

**Concurrent invocation guardrail:** before Step 6 delegation, acquire `.hatch3r/.lock` and detect-then-warn on a conflicting active pipeline (same branch / open `.hatch3r/hatch.json` board transaction) per `rules/hatch3r-agent-orchestration.md` → Parallel Safety → Concurrent Invocation Handling. Batch-mode parallel implementers (Step 6c) are one pipeline by design; the guardrail governs a *second* concurrent top-level invocation against the same repo. Cross-task learnings consolidate at completion, never mid-pipeline.
