---
id: hatch3r-board-pickup-delegation-multi
type: command
description: Multi-issue sub-agent delegation protocols for board-pickup Steps 6b (epics) and 6c (batch). Covers level-by-level parallel execution, shared context, and quality pipelines.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Pickup — Multi-Issue Delegation (Steps 6b, 6c)

Delegation details for Steps 6b and 6c of `hatch3r-board-pickup`. Referenced from the core command file.

---

## 6b. Epics -- Sub-Agent Delegation (One Implementer Per Sub-Issue)

For epics with sub-issues, delegate each sub-issue to a dedicated implementer sub-agent. The parent orchestrator (this agent) coordinates dependency order, parallelism, and git operations.

### 6b.1. Parse Sub-Issues Into Dependency Levels

1. Fetch the epic's `## Implementation Order` section.
2. Group sub-issues by dependency level:
   - **Level 1:** Sub-issues with no unsatisfied blockers (can start immediately).
   - **Level N:** Sub-issues whose blockers are all in levels < N.
3. Within each level, identify parallelizable sub-issues (no mutual dependencies).

### 6b.2. Prepare Shared Context

Before spawning implementer sub-agents, delegate context gathering to the **hatch3r-researcher agent protocol**.

1. Read the epic body (goal, scope, constraints).
2. Spawn a researcher sub-agent following the **hatch3r-researcher agent protocol** with:
   - **Research brief:** The epic title, goal, scope, constraints, and area labels.
   - **Modes:** `codebase-impact`, `risk-assessment`
   - **Depth:** `standard` for most epics. Use `quick` if the epic has fewer than 3 sub-issues or is well-specified with linked specs. Use `deep` if the epic spans multiple modules or introduces new patterns.
   - **Project context:** Pre-loaded documentation references from area labels.
3. Await the researcher result. Include the structured output as shared context in all implementer sub-agent prompts in Step 6b.3.

### 6b.2b. Per-Sub-Issue Complexity Scoring and Tier-Adjusted Research

After the shared epic-level research, score each sub-issue individually and run additional research for sub-issues that warrant it.

1. **Score each sub-issue** per the `hatch3r-deep-context` rule to determine the analysis tier (Light / Standard / Deep).

2. **For Tier 2+ sub-issues**, spawn per-sub-issue **hatch3r-researcher** sub-agents via the Task tool (`subagent_type: "generalPurpose"`). Launch as many concurrently as the platform supports.

   Each per-sub-issue researcher prompt must include:
   - The sub-issue title, body, acceptance criteria, and area labels.
   - Research modes by issue type (same as Step 6a.1).
   - **Tier-adjusted modes** (per `hatch3r-deep-context`):
     - Tier 2: add `requirements-elicitation` + `similar-implementation` at `quick` depth
     - Tier 3: add `requirements-elicitation` + `similar-implementation` at `deep` depth, plus `codebase-impact` at `deep` depth with transitive tracing
   - Depth by risk level, with complexity tier overriding upward.
   - The shared epic-level researcher output from Step 6b.2 (to avoid redundant analysis).

3. **Await all per-sub-issue researchers.** Collect structured outputs. Each researcher's output feeds exclusively into its corresponding implementer in Step 6b.3.

4. **For Tier 2 sub-issues:** Present the `requirements-elicitation` questions to the user inline and await answers before proceeding.

5. **For Tier 3 sub-issues:** Present a full Pre-Implementation Summary per the `hatch3r-deep-context` rule. Do NOT proceed to 6b.3 until all unresolved questions are answered.

6. **Tier 1 sub-issues** skip this step — they use only the shared epic-level context from Step 6b.2.

### 6b.3. Execute Level-by-Level With Parallel Sub-Agents

Worktree isolation applies here identically to the batch path: when ≥2 implementers run concurrently in a level on a Tier 2/3 run and the platform writes into the orchestrator's tree, isolate each implementer per **Step 6c.3-iso** (`--isolate=auto|on|off`, default `auto`) and integrate via the merge protocol in Step 6b.4. Sub-issues in an epic share file overlap more often than standalone batch issues, so the missed-overlap risk that isolation removes is higher here. Seam constraints apply identically to the epic path when sub-issues share a contract — assign per Step 6c.2 item 4.

For each dependency level, starting at Level 1:

1. **Spawn one implementer sub-agent per sub-issue in the current level.** Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many sub-agents concurrently as the platform supports. When worktree isolation is active (per the note above), create one scratch worktree per implementer first and pin each sub-agent to its `.worktrees/pickup-iso-<sub-issue-number>/` path.

2. **Each sub-agent prompt must include:**
   - The sub-issue number, title, full body, and acceptance criteria.
   - The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
   - Parent epic context (title, goal, related sub-issues at the same level).
   - The shared researcher output from Step 6b.2 (codebase impact and risk assessment as shared context).
   - The per-sub-issue researcher output from Step 6b.2b (if this sub-issue scored Tier 2+).
   - **Reference conventions** from `similar-implementation` output (Tier 2/3) — triggers the implementer's Convention Lock step.
   - **Resolved requirements** from `requirements-elicitation` answers (Tier 2/3) — explicit decisions on ambiguities.
   - **Blast radius data** from enhanced `codebase-impact` (Tier 3) — transitive dependency trace and API consumer map.
   - Documentation references relevant to this sub-issue.
   - Instruction to follow the hatch3r-implementer agent protocol.
   - All `scope: always` rule directives from `rules/` — subagents do not inherit rules automatically.
   - Relevant learnings from `.hatch3r/learnings/` (from Step 6.pre).
   - Instruction to use GitHub MCP for issue reads, and follow the project's tooling hierarchy for external knowledge augmentation.
   - Explicit instruction: do NOT create branches, commits, or PRs.
   - `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID; each epic sub-issue gets its own id).
   - Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

3. **Await all sub-agents in the current level.** Collect their structured results (files changed, tests written, issues encountered).

4. **Review sub-agent results:**
   - If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, fix manually, retry).
   - **When worktree isolation was active for this level** (Step 6c.3-iso, applied per the 6b.3 note): integrate each scratch worktree's file diff back onto the branch via the Step 6b.4 conflict-resolution step, then run `npx hatch3r worktree-cleanup --yes` before advancing.
   - If sub-agents modified overlapping files (or the isolated integration above surfaced an overlap Step 3 missed), review for conflicts and resolve before proceeding.

5. **Advance to the next dependency level.** Repeat steps 1-4 until all levels are complete.

### 6b.4. Post-Delegation Verification

After all sub-agents complete:

1. Run a combined quality check across all changes.
2. Resolve any cross-sub-issue integration issues — when isolation ran, this is where each worktree's diff lands on the branch; physically disjoint writes apply cleanly and only Step-3-missed overlaps need manual resolution.
3. Verify no file conflicts between parallel sub-agent outputs.

---

## 6c. Multi-Issue Batch -- Parallel Subagent Delegation (One Implementer Per Issue)

For batches of multiple standalone issues (selected via batch mode in Step 1d or by referencing multiple issue numbers), delegate each issue to a dedicated implementer sub-agent. The parent orchestrator (this agent) coordinates dependency levels, parallelism, collision avoidance, and git operations.

### 6c.1. Group Issues Into Dependency Levels

1. Use the updated cross-issue dependency graph (from Step 2e, adjusted by Step 3.4).
2. Group issues by dependency level:
   - **Level 1:** Issues with no dependencies on other issues in the batch (can start immediately). Most standalone issues will be Level 1.
   - **Level N:** Issues that depend on other issues in levels < N.
3. Within each level, all issues are parallelizable (no mutual dependencies — conflicts were moved to separate levels in Step 3); levels may be adjusted by the contract-overlap cross-check in Step 6c.2 item 4.

### 6c.2. Context Gathering (Parallel Researchers)

**Skip this step only** if ALL issues in the batch are trivial single-line edits (typos, comment fixes, single-value config changes) that score Tier 1 per `hatch3r-deep-context`. The `risk:low` and `priority:p3` labels alone are not sufficient to skip research — always score complexity first.

Unlike epics (which share a single researcher), standalone issues in a batch are unrelated and each need individual context gathering.

1. **Spawn one hatch3r-researcher sub-agent per issue** via the Task tool (`subagent_type: "generalPurpose"`). Launch as many concurrently as the platform supports.

2. **Each researcher prompt must include:**
   - The issue title, body, acceptance criteria, and area labels.
   - Research modes by issue type (same as Step 6a.1).
   - Tier-adjusted modes per `hatch3r-deep-context` (same as Step 6a.1).
   - Depth by risk level (`quick` / `standard` / `deep`), with complexity tier overriding upward.
   - Project context and documentation references.

3. **Await all researchers.** Collect structured outputs. Each researcher's output feeds exclusively into its corresponding implementer in Step 6c.3. For Tier 2/3 issues, present elicitation questions to the user and await answers before proceeding.

4. **Contract-overlap cross-check + seam-owner assignment:** union the per-issue Breaking Change Candidates tables; any contract (matching location/symbol/name) appearing in ≥2 issues of the same level is a contract collision that Step 3 item 5 either predicted or missed. Resolve before dispatch:
   - (a) exactly one issue — the one whose acceptance criteria REQUIRE the contract mutation — becomes the seam owner and lands emitter + all consumer reconciliation in one diff;
   - (b) every peer issue's Step 6c.3 prompt gains the line `Seam constraint: contract <X> is owned by issue #<N> this batch — consume the current shape; do not mutate it`;
   - (c) when two issues both require mutating the same contract, move the later one to the next dependency level so it consumes the owner's landed shape (`rules/hatch3r-contract-census.md` → Seam-Owner Protocol).

   Record owner assignments; they are re-checked in Step 6c.4.

### 6c.3-iso. Optional Worktree Isolation (Parallel Implementers, Filesystem Platforms)

Step 3 collision detection predicts file overlap and moves overlapping issues to sequential levels. That prediction is fallible: a missed overlap (Step 3.4) puts two implementers into the orchestrator's single working tree, where concurrent writes to the same file silently clobber each other before the Step 6c.4 post-hoc merge can run. Worktree isolation converts the *predicted* disjointness into *physical* disjointness — each implementer writes into its own `git worktree`, so two implementers cannot touch the same on-disk file even when Step 3 missed the overlap. The existing Step 6c.4 merge protocol becomes the integration step plus the residual-conflict handler for whatever Step 3 missed.

**Isolation gate — `--isolate=auto|on|off` (default `auto`).** Under `auto`, isolate this level when ALL three hold:

1. **Concurrency:** ≥2 implementer sub-agents are dispatched into this level (a single implementer has no peer to collide with — skip isolation).
2. **Tier:** the run is Tier 2 or Tier 3 batch mode (Step 0 auto-tier or the `--effort` override per `hatch3r-board-pickup` → Effort Override). Tier 1 batches skip isolation — their trivial edits carry low overlap risk and the worktree setup/cleanup cost is not justified.
3. **Platform writes to the orchestrator's filesystem:** the platform applies sub-agent file edits into the orchestrator's working tree (CLI platforms — e.g. Claude Code Task sub-agents share the orchestrator's tree). Set this condition false for hosted platforms that sandbox each sub-agent in a separate per-agent workspace and merge results outside the orchestrator tree — those platforms already provide disjoint writes, so a second worktree layer adds no isolation.

`--isolate=on` forces isolation whenever ≥2 implementers run (overrides the tier/platform conditions); `--isolate=off` keeps the legacy single-tree path (Step 6c.3 dispatches directly into the orchestrator's tree, relying solely on Step 3 prediction + the Step 6c.4 post-hoc merge). Resolution order: explicit `--isolate` flag wins over the `auto` default.

**When isolation is active for a level, wrap Step 6c.3 dispatch as follows:**

1. **Create one scratch worktree per implementer.** For each issue in the level, run `npx hatch3r worktree-setup pickup-iso-<issue-number> --yes` (the `--yes` flag suppresses the interactive secret-propagation confirmation for the non-interactive orchestrator; review `.worktree-include` first if `.env.*` files are in scope per the command's CWE-552 blast-radius warning). Each worktree lands on a throwaway branch under `.worktrees/pickup-iso-<issue-number>/` and is populated + `hatch3r sync`-ed by the command. These are scratch isolation directories, not per-issue PR branches — the batch keeps its single shared branch (per `hatch3r-board-pickup` Step 5), and changes are integrated back onto it in Step 6c.4.
2. **Pin each implementer to its worktree.** In the Step 6c.3 per-agent prompt, set the sub-agent's working directory to its `.worktrees/pickup-iso-<issue-number>/` path and instruct it to read, edit, and run tests only within that path. The "do NOT create branches, commits, or PRs" instruction is unchanged — the orchestrator still owns all git operations; the throwaway worktree branch exists only to give `git worktree add` a ref and is never pushed.
3. **Integrate and clean up after the level returns.** After all implementers in the level return (Step 6c.3 step 3), integrate each worktree's file diff back onto the batch branch in the orchestrator's main tree via the **Step 6c.4 file-conflict resolution protocol** — physically disjoint writes apply cleanly; any genuinely overlapping or semantically conflicting edits Step 3 missed surface there for resolution exactly as in the non-isolated path. Then run `npx hatch3r worktree-cleanup --yes` to remove the scratch worktrees and prune their throwaway branches. On a non-zero `worktree-setup`/`worktree-cleanup` exit, surface the error and **ASK** the user (retry, fall back to `--isolate=off` for the remaining levels, or abort) — never silently drop isolation mid-run.

### 6c.3. Execute Level-by-Level With Parallel Implementers

For each dependency level, starting at Level 1:

0. **Resolve worktree isolation for this level** per Step 6c.3-iso. When isolation is active, create the per-implementer scratch worktrees (6c.3-iso step 1) before dispatching, and pin each sub-agent to its worktree path (6c.3-iso step 2). When inactive, dispatch directly into the orchestrator's tree as below.

1. **Sort the level by priority, then spawn one hatch3r-implementer sub-agent per issue.** Within each level, sort issues by priority (`p0` > `p1` > `p2` > `p3`) before dispatching. When the platform concurrency limit caps the level, fill the in-flight pool with the highest-priority issues first and queue the rest for the next dispatch slot as in-flight sub-agents return. Issues within a level are independent for correctness; this ordering only governs which independent issues land first when concurrency is the binding constraint. Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many sub-agents concurrently as the platform supports.

2. **Each sub-agent prompt must include:**
   - The issue number, title, full body, and acceptance criteria.
   - The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
   - Batch context: sibling issues in the batch at the same level (for awareness, not implementation).
   - The researcher output from Step 6c.2 for this specific issue (if that step was not skipped).
   - **Reference conventions** from `similar-implementation` output (Tier 2/3) — triggers the implementer's Convention Lock step.
   - **Resolved requirements** from `requirements-elicitation` answers (Tier 2/3).
   - **Blast radius data** from enhanced `codebase-impact` (Tier 3).
   - **Seam constraints** from Step 6c.2 item 4 (when assigned).
   - Documentation references relevant to this issue.
   - Instruction to follow the **hatch3r-implementer agent protocol**.
   - All `scope: always` rule directives from `rules/` — subagents do not inherit rules automatically.
   - Relevant learnings from `.hatch3r/learnings/` (from Step 6.pre).
   - Explicit instruction: do NOT create branches, commits, or PRs.
   - **When worktree isolation is active for this level** (Step 6c.3-iso): the sub-agent's working directory set to its `.worktrees/pickup-iso-<issue-number>/` path, with the instruction to read, edit, and run tests only within that path.
   - `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID; batch tasks share one id with a per-issue sub-task index).
   - Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

3. **Await all sub-agents in the current level.** Collect their structured results (files changed, tests written, issues encountered).

4. **Review sub-agent results:**
   - If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, fix manually, retry).
   - **When worktree isolation was active for this level** (Step 6c.3-iso): integrate each scratch worktree's file diff back onto the batch branch via the Step 6c.4 file-conflict resolution protocol, then run `npx hatch3r worktree-cleanup --yes` to remove the worktrees and prune their throwaway branches before advancing (6c.3-iso step 3).
   - If sub-agents modified overlapping files (or the isolated integration above surfaced an overlap Step 3 missed), review for conflicts and resolve before proceeding.

5. **Advance to the next dependency level.** Repeat steps 1-4 until all levels are complete.

### 6c.4. Post-Batch Verification

After all implementer sub-agents complete across all levels:

1. Run a combined quality check across all changes from all issues.
2. **File conflict resolution:** When parallel sub-agents modify the same file, apply this resolution protocol:
   - **Disjoint regions:** Accept both changes (non-overlapping edits to different functions/sections).
   - **Overlapping regions:** If changes touch the same lines or function, merge manually using the sub-agent that modified the larger scope as the base, then apply the smaller-scope change on top. Run tests after merge.
   - **Semantic conflicts:** If two sub-agents make contradictory changes to the same interface, type, or contract, halt and surface both changes to the user with the conflict description. Do not auto-resolve semantic conflicts. A semantic conflict on a contract with an assigned seam owner (Step 6c.2 item 4) means a peer violated its seam constraint — name the violating lane when surfacing.
   - **Prevention:** Step 3 (collision detection) should move file-overlapping issues to sequential dependency levels. Conflicts at this stage indicate a missed overlap in Step 3.4.
3. **Consumer-census verification per lane:** read each implementer's `Consumer census` field. Any `unreconciled` without a named justification → spawn `hatch3r-fixer` for that lane before the Stage-1 review. Then run the cross-lane check: for every contract a seam owner changed, grep the OTHER lanes' diffs for the old identifier — a peer still emitting or reading the old shape violated its seam constraint; route the reconciliation to the seam owner (one diff owns the contract), never patch it in the merge.
4. Verify no regressions between parallel sub-agent outputs.

### 6c.5. Post-Implementation Quality Pipeline

After all implementations complete, run the two-stage quality pipeline across the entire batch. Use the Task tool with `subagent_type: "generalPurpose"`.

**Stage 1 — Review Loop (sequential):**

1. Spawn **`hatch3r-reviewer`** — code review of ALL changes across the batch. Include the full diff and acceptance criteria for each issue. The reviewer sub-agent output MUST include a top-level `confidence: high | medium | low` field (not just per-finding) so the gate in step 4 can evaluate it deterministically.
2. If the reviewer reports Critical or Warning findings, spawn **`hatch3r-fixer`** with the reviewer output to apply fixes — append the W1 write-ahead rows before the fixer dispatch (`rules/hatch3r-findings-ledger.md` → Write Points). When fixes touch shared or public interfaces, also include:
   - **Blast radius data** from Step 6c.2 (if available) — so the fixer knows which consumers and contracts must be preserved.
   - **Reference conventions** from Step 6c.2 (if available) — so the fixer maintains established patterns when applying fixes.
3. Re-spawn **`hatch3r-reviewer`** to verify fixes.
4. Repeat steps 2-3 for a maximum of **3 iterations** until the confidence-aware gate passes. Evaluate the gate per the canonical **Confidence-Aware Review Gate** in `agents/shared/confidence-gate.md`, passing in the resolved `--confidence-floor` (`any` | `medium` | `high`) routed here from `hatch3r-board-pickup` → Confidence Floor. At the default `any` floor: **0 Critical + 0 Warning AND reviewer confidence != low**; if reviewer confidence is low with no Critical/Warning findings, trigger a second reviewer pass before exiting and do not exit until the second pass returns non-low confidence OR the user explicitly accepts the low-confidence PASS. At floor `medium` the pass surface is unchanged; at floor `high` a `medium`-confidence clean verdict also forces a second pass (and any low-confidence finding triggers an ASK) — apply the floor-tier branches from the shared gate, do not collapse them to the `any` row.
   After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings.
5. If still not clean after 3 iterations, **ASK** the user how to proceed — the ASK lists the open `finding_id`s with legal closures; reconcile the ledger to the run-exit invariant (W3) on exit (`rules/hatch3r-findings-ledger.md` → W3 loop-exit reconciliation); unattended runs record open findings as `escalated` and exit PARTIAL.

**Stage 2 — Final Quality (parallel, after review loop is clean):**

Launch as many independent sub-agents in parallel as the platform supports.

**Always spawn (mandatory for every code change):**
- **hatch3r-testability** (CQ5) — verify tests for all code changes across the batch meet the mandate map / coverage floor.
- **hatch3r-security** (CQ3) — security review of all code changes across the batch.

**Always evaluate (spawn when applicable):**
- **hatch3r-docs-writer** — spawn when any changes affect public APIs, architectural patterns, or user-facing behavior.

**Triggered specialists (spawn when triggered by any issue in the batch):**
- **hatch3r-lint-fixer** — spawn when lint errors are present after implementation.
- **hatch3r-ui** (CQ1, mandatory-on-match) — spawn when any issue has `area:ui` or `area:a11y` labels. When triggered at Tier 2/3, a dedicated `hatch3r-ui` instance is a hard mandate — skipping it is a gate failure.
- **hatch3r-ux** (CQ2, mandatory-on-match) — spawn when any issue in the batch touches flow / route-transition / modal / error-state files or microcopy/i18n strings. When triggered at Tier 2/3, a dedicated `hatch3r-ux` instance is a hard mandate (never merged into the `hatch3r-ui` spawn).
- **hatch3r-performance** (CQ7) — spawn when any issue has `area:performance` label.

Await all specialist sub-agents. Apply their feedback before proceeding to Step 7.
