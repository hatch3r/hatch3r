---
id: hatch3r-quick-change
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-lint-fixer, hatch3r-reviewer, hatch3r-fixer, hatch3r-ui, hatch3r-ux, hatch3r-security, hatch3r-reliability, hatch3r-testability, hatch3r-scalability, hatch3r-performance, hatch3r-maintainability, hatch3r-enhancability]
description: Lightweight command for small changes not worth tracking on the board. Adaptive ceremony with inline or sub-agent implementation, batch support, and soft scope guards.
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 13
  rationale: Four-stage core pipeline (implementer + lint-fixer + reviewer ↔ fixer) plus 9 CQ vector specialists (ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability) dispatched conditionally per their trigger conditions; the always-on testing + security gates collapse onto `hatch3r-testability` (CQ5) and `hatch3r-security` (CQ3) respectively. Tier 1 trivial edits skip CQ specialists per Phase Skip Criteria. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's change description for unresolved questions in scope, target files, irreversibility, or constraint conflicts (multiple matching files, missing acceptance criteria, unclear rename target, ambiguous "small" boundary). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when the change is single-file, single-concern, and the brief alone is testable (typo, constant tweak, single-line edit). The Step 2c "ASK" rule remains in force for residual ambiguity discovered mid-workflow.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Scale Assessment | Orchestrator (inline) | No | Yes |
| 2. Implementation | `hatch3r-implementer` (nontrivial items) | Per item | Nontrivial only |
| 3. Lint Fix | `hatch3r-lint-fixer` | No | When lint/type errors |
| 4a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | Nontrivial only |
| 4b. Final Quality | `hatch3r-testability` + `hatch3r-security` | Yes | Nontrivial code changes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

If **yes**: implementation and review stages include browser verification steps — navigate to affected pages, interact with changed elements, check console for errors, capture screenshots.

If **no**: all browser verification steps are skipped silently throughout the entire command.

# Quick Change -- Fast Path for Small, Board-Free Changes

Lightweight command for changes not worth tracking as board issues -- typo fixes, constant tweaks, small refactors, config updates, documentation edits. Adaptive ceremony: trivial changes are implemented inline; nontrivial changes delegate to the implementer agent with a light review. Supports batching multiple small changes into a single invocation and commit.

Sits alongside `hatch3r-workflow` as a lower-ceremony alternative. If a change grows beyond quick-change territory, the command recommends switching to `hatch3r-workflow`.

---

## Scope

This command intentionally skips:
- Board context (`hatch3r-board-shared`)
- GitHub issues and PRs
- Researcher sub-agent
- Full review pipeline (deep security audit, full test authoring, docs-writer)
- Learnings capture (consultation of existing learnings retained — see Step 2c)

It retains:
- Quality checks (lint, typecheck, test) -- always mandatory
- Adaptive sub-agent delegation (implementer for nontrivial items)
- Light code review (reviewer for nontrivial items only)
- `scope: always` rules from `rules/`
- Soft scope guards to prevent misuse
- Lightweight learnings consultation (file-path scan, 150-token budget)

---

## Global Rule Overrides

- **Git commands are fully permitted** during Step 7 (Git Action), including `git add`, `git commit`, and `git push`.

## Token-Saving Directives

1. **No shared context loading.** Do NOT read `hatch3r-board-shared`. Do NOT fetch GitHub issues or PRs.
2. **Minimal researcher usage.** No researcher for Tier 1 items. For Tier 2 items that proceed through quick-change, only `similar-implementation` at `quick` depth. Tier 3 items must be routed to `hatch3r-workflow`.
3. **Targeted file reads only.** Read only files directly relevant to the described change(s).
4. **No learnings capture.** Quick changes are too small to produce meaningful learnings. Existing learnings are consulted via a lightweight file-path scan (Step 2c) with a 150-token budget — no new learnings are written.
5. **Minimal rule loading.** Load `scope: always` rules only when spawning sub-agents in Steps 4b or 6.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces merge-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## Triage

Classify the change request before delegating. Detailed tier scoring runs in Step 2 (Tier Assessment); this section summarizes the routing:

- **Tier 1 (trivial)**: single-file edit, config tweak, typo, or constant rename; inline implementation in Step 4a, no researcher, no review loop.
- **Tier 2 (standard)**: multi-file change or new function with bounded scope; standard pipeline with `hatch3r-implementer` and lightweight researcher (`similar-implementation` at `quick` depth).
- **Tier 3 (deep)**: hard-blocked here — quick-change does not provide research depth for Tier 3 work. Step 2b routes Tier 3 to `hatch3r-workflow`.

If Tier 1, run inline. If Tier 2, run the implementer-only pipeline below. If Tier 3, exit and recommend `hatch3r-workflow`.

### Pre-Execution Cost Preview

Before any sub-agent dispatch (Step 4b implementer), surface the cost preview so a nontrivial change is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Triage tier. Tier 1 trivial inline edits skip the sub-agent path entirely, so `expected_sa_count: 0` is the correct value for them.

```yaml
cost_estimate:
  expected_sa_count: <Tier 1 inline ~0, Tier 2 ~3 (researcher + implementer + reviewer), up to 13 when CQ specialists trigger>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 8 summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a multi-file change scored as Tier 1, or a one-line edit scored as Tier 2. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=light|standard` forces the named tier, bypassing the Triage auto-classification. `--effort=deep` is rejected here — quick-change hard-blocks Tier 3 and routes to `hatch3r-workflow`.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Triage auto-classification stands.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK. For every ASK checkpoint, use the platform-native question tool per `agents/shared/user-question-protocol.md`.

### Step 1: Input and Batch Parsing

Parse the user's description into discrete change items.

1. Extract each distinct change from the user's message. A single description may contain multiple changes (e.g., "rename this constant, fix that typo, and update the config default").
2. For each change item, record:
   - **Description**: what needs to change
   - **Type**: fix / tweak / refactor / config / docs
   - **Affected area**: inferred file paths or directories
3. If the user describes a single change, treat it as a batch of one.

---

### Step 2: Tier Assessment (Soft Guard)

Evaluate whether the described changes fit the quick-change scope.

#### 2a. Estimate Scope

For each change item, estimate:
- Number of files affected
- Approximate lines changed
- Whether it touches security-sensitive areas (auth, payments, database schemas, access control)
- Whether it introduces new dependencies or modules

Aggregate across the batch for total estimated scope.

#### 2b. Apply Soft Guard and Complexity Scoring

**Score complexity** per the `hatch3r-deep-context` rule for the overall change (or each item individually if items are unrelated). Determine the analysis tier (Light / Standard / Deep).

**Hard block — Tier 3 (Deep):** If any item scores Tier 3, quick-change is not appropriate.

**ASK:** "This change scores Tier 3 (Deep complexity): {reason}. Quick-change does not provide the research depth needed. Options: (a) switch to `/h4tcher-workflow`, (b) narrow the scope."

Do NOT offer a "proceed anyway" option for Tier 3. The user must switch to `/h4tcher-workflow` or narrow scope.

**Soft guard — Tier 2 (Standard) or threshold triggers:** If any item scores Tier 2, or if any of these threshold triggers fire (any one is sufficient):
- Estimated total exceeds **5 files**
- Estimated total exceeds **~200 lines changed**
- Changes touch security-sensitive areas
- Changes require new dependencies or architectural decisions

**Threshold gate (P8 B2).** If any threshold trigger fires (>3 files, cross-module touch, schema change, or net new dependency), spawn the `hatch3r-researcher` with `requirements-elicitation:quick` mode IMMEDIATELY in Step 4b — do not defer research to discover scope creep mid-implementation. Tier-3 hard-block remains in effect.

**ASK:** "This looks larger than a quick change: {reason}. Options: (a) proceed with lightweight research, (b) switch to `hatch3r-workflow` for full ceremony, (c) narrow the scope."

If no threshold is triggered and all items are Tier 1, present the change list:

```
Quick Change Scope:
  Items: {N}
  1. {description} — {type} — {affected area}
  2. ...
  Estimated scope: {N} files, ~{N} lines
```

#### 2c. Lightweight Learnings Scan (Optional)

If `.hatch3r/learnings/` exists:

1. Collect the file paths from the affected areas identified in Step 1.
2. Scan learning file frontmatter for `area` or `tags` that match the affected file paths or directories.
3. If matches found (max 3 learnings, highest confidence first), surface them as a brief heads-up:

   ```
   Heads up — relevant learnings:
     - [{category}] {one-line learning summary} (from: {learning filename})
     - ...
   ```

4. If no matches found: continue silently. Do not mention learnings.

**Token budget:** Max 150 tokens for this entire step. Read frontmatter only — do not read learning bodies unless the frontmatter matches. Limit to 3 surfaced learnings. If more than 3 match, show the 3 with highest confidence.

If `.hatch3r/learnings/` does not exist, skip this step silently.

**ASK:** "Proceed with these changes? (yes / adjust)"

---

### Step 3: Classify Each Change Item

Classify each item to determine the implementation path.

#### Trivial Signals (inline implementation)

- Single-file change
- Config value update
- Typo or comment fix
- Import reordering or fix
- Constant rename or value change
- Single-line logic correction
- Documentation text edit
- Environment variable update

#### Nontrivial Signals (implementer sub-agent)

- Multiple files affected
- New function, method, or module
- Behavior change requiring test updates
- Cross-module refactor
- API signature change
- Logic branch addition or removal

Classify each item as **trivial** or **nontrivial**. If ambiguous, default to **nontrivial**.

---

### Step 4: Implementation (Adaptive)

Implement each change item using the path determined by its classification.

#### 4a. Trivial Items -- Inline Implementation

For each trivial item:

1. Read the target file.
2. Make the change directly.
3. Verify the file is syntactically valid (no broken imports, no parse errors).

No sub-agent delegation. No researcher. Implement and move on.

#### 4b. Nontrivial Items -- Implementer Sub-Agent

For each nontrivial item (or group of related nontrivial items):

1. Read `scope: always` rules from `rules/`.

2. **Lightweight research (Tier 2 items only):** If the item scored Tier 2 in Step 2b and the user chose to proceed with lightweight research, spawn a `hatch3r-researcher` sub-agent with:
   - **Modes:** `similar-implementation` at `quick` depth (1 reference implementation)
   - **Research brief:** The change description and affected files.
   - Await the result. Pass the output (reference conventions) to the implementer prompt in step 3.

3. Spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The implementer prompt MUST include:
- The change description and affected files.
- All `scope: always` rule directives.
- Explicit instruction: do NOT create branches, commits, or PRs.
- **Reference conventions** from `similar-implementation` output (if step 2 ran) — triggers the implementer's Convention Lock step.
- If no researcher ran: explicit instruction that no researcher context is available; work from the change description and codebase alone.
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

If multiple nontrivial items affect **independent areas** (no shared files), spawn one implementer per area and run them in parallel.

If multiple nontrivial items affect **overlapping files**, process them sequentially through a single implementer to avoid conflicts.

4. Await the implementer result. If the implementer reports BLOCKED, **ASK** the user for guidance.

---

### Step 5: Quality Checks

Run the project's quality gates. Refer to `package.json` scripts, `README.md`, or project conventions for the appropriate commands.

#### 5a. Run Checks

1. Lint (e.g., `npm run lint`)
2. Type check (e.g., `npm run typecheck`)
3. Test suite (e.g., `npm run test`)

#### 5b. Handle Failures

- **Simple failures** (unused import, formatting): fix inline.
- **Lint/type failures requiring structured fixes**: spawn `hatch3r-lint-fixer` sub-agent with the specific errors.
- **Test failures**: analyze the failure. If the change intentionally altered behavior and the test needs updating, update it. If the change broke something unintentionally, fix the change.

Max 2 retry loops on quality check failures. After 2 retries:

**ASK:** "Quality checks still failing after 2 fix attempts: {specific failures}. Fix confidence: {high/medium/low — based on whether root cause is identified}. Options: (a) I'll fix manually, commit what we have, (b) keep trying, (c) abort changes."

---

### Step 6: Review and Final Quality (Nontrivial Items Only)

Skip this step entirely if ALL items were classified as trivial in Step 3.

#### 6a. Review Loop

For nontrivial items, run an iterative review loop (max 3 iterations) until 0 Critical + 0 Warning findings remain:

1. Spawn `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The reviewer prompt MUST include:
- The diff of all changes made (use `git diff` on the working tree).
- Focus areas: **correctness and code quality only**. Skip security deep-dive, performance profiling, and documentation review.
- All `scope: always` rule directives from `rules/`.
- Iteration number and previous findings (if not the first iteration).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.
- Requirement that the reviewer output include a top-level `confidence: high | medium | low` field (not just per-finding) so the gate in step 2 can evaluate it deterministically.

2. Process reviewer output (confidence-aware gate):
   - If **0 Critical + 0 Warning AND reviewer confidence != low**: review loop is clean. Proceed to Step 6b.
   - If **0 Critical + 0 Warning AND reviewer confidence == low**: trigger a second reviewer pass before exiting. Do not proceed to 6b until the second pass returns non-low confidence OR the user explicitly accepts the low-confidence PASS.
   - If Critical or Warning findings remain: spawn `hatch3r-fixer` sub-agent to address them, then re-run the reviewer (next iteration).
     The fixer prompt MUST include: the reviewer findings, all `scope: always` rule directives, and the confidence expression requirement (high/medium/low per the quality charter).
   - **Suggestions**: skip. The point of quick-change is speed.

3. If 3 iterations complete and findings remain, **ASK** the user whether to proceed or fix manually.
   After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings.

4. After any fixes, re-run quality checks (Step 5a) to verify nothing broke.

#### 6b. Final Quality

After the review loop is clean, spawn both agents in parallel via the Task tool:

1. `hatch3r-testability` (CQ5) — confirm tests for nontrivial code changes meet the mandate map / coverage floor.
2. `hatch3r-security` (CQ3) — lightweight security review of nontrivial code changes (OAuth/OIDC, secrets, supply-chain).

Both prompts MUST include:
- The diff of all changes made.
- All `scope: always` rule directives from `rules/`.
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Apply any resulting changes (new tests, security fixes). Re-run quality checks (Step 5a) if changes were made.

---

### Step 7: Git Action

**ASK:** "All changes complete. Quality checks pass. How should I handle git? (a) commit only, (b) commit and push, (c) skip git — leave changes in working tree"

#### Option (a): Commit Only

```bash
git add -A
git commit -m "{commit message}"
```

#### Option (b): Commit and Push

```bash
git add -A
git commit -m "{commit message}"
git push
```

If `git push` fails (e.g., no upstream), use `git push -u origin {branch}`.

#### Option (c): Skip Git

Leave all changes in the working tree. Do not stage or commit.

#### Commit Message Format

- **Single item**: `quick: {short description}` (e.g., `quick: fix typo in error message`)
- **Batch**: `quick: {N} small changes` with a body listing each item:
  ```
  quick: 3 small changes

  - fix typo in auth error message
  - update default timeout to 30s
  - remove unused import in utils.ts
  ```

---

### Step 8: Summary

Present a concise completion summary:

```
Quick Change Complete:
  Items: {N} ({trivial_count} trivial, {nontrivial_count} nontrivial)
  Files changed: {file list}
  Quality: lint {pass/fail}, types {pass/fail}, tests {pass/fail}
  Review: {skipped / N findings applied}
  Git: {committed on {branch} / committed and pushed / skipped}
  Confidence: {high/medium/low — overall assessment of change correctness}
```

---

## Resumability (Decision 27/30)

quick-change runs adaptive ceremony — trivial items execute inline with no checkpoint surface, but a Tier 2/3 batch of multiple nontrivial items can grow to span per-item implementer delegation (Step 4), lint-fix (Step 5), the reviewer ↔ fixer review loop (Step 6), parallel CQ specialist Phase 4 batch (Step 6 final-quality), and the commit phase (Step 7). Per `governance/CONSTITUTION.md` §6 Decision 30 (Workspace-checkpointed resumability), checkpoint progress on nontrivial batches so an interrupted run re-enters at the last completed step rather than re-implementing items that already wrote code.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.quick-change-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the Step 1 → Step 8 progression), `wave` (per-item implementer-batch index when batch mode is active), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, batchItems, completedItemIds }` where `completedItemIds` is the set of batch items already implemented and reviewed (idempotency guard for resume).
2. **Write points:** Tier 1 trivial inline items skip checkpoint emission (the resume cost would exceed the re-run cost). For nontrivial items: after Step 1 input + batch parsing, after Step 2 tier assessment + soft-guard pass, after Step 3 per-item classification, after each Step 4 implementer batch returns per item (so completed implementations survive a crash and are not re-implemented on resume), after Step 5 lint-fix, after each Step 6 review-loop iteration, after the Step 6 final-quality batch, and after Step 7 git commit.
3. **`--resume` invocation:** `hatch3r-quick-change --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the repo / branch HEAD / `batchItems` source files changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage. A resume invocation against a Tier 1 trivial run with no checkpoint emits the cold-start message and re-runs the inline path.
4. **Snapshot rollback:** pre-mutation snapshots of per-item working-tree state land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's writes. Diff preview precedes every file write per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for quick-change: `1` = scope intake + complexity scoring, `2` = inline edit OR implementer dispatch (Tier 1 carve-out per `rules/hatch3r-agent-orchestration.md` Mandatory Delegation Directive applies only at Tier 1), `3` = lint + typecheck + test verification, `4` = Step 8 summary + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (target edit, test additions) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via hatch3r-implementer (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none | <carve-out: Tier-1 inline edit per quick-change scope>
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output (the Step 8 Summary above is the quick-change-specific rendering — both the Step 8 block and the 9-section canonical contract apply). The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

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

- **Pre-execution `cost_estimate`** — emitted in the Pre-Execution Cost Preview above before the first sub-agent dispatch.
- **Post-execution `cost_actuals` + `delta`** — appended to the Step 8 summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 13` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 trivial inline ≈ 0 (no sub-agent); Tier 2 ≈ 3 (researcher + implementer + reviewer, plus lint-fixer/fixer/testability/security when triggered); up to 13 when the conditional CQ vector specialists fire per their trigger conditions. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Quality check failure after 2 retries**: Present the specific failures and ASK the user whether to commit partial progress, keep trying, or abort.
- **Implementer sub-agent failure**: Retry once. If the retry fails, fall back to inline implementation for that item. If inline implementation also fails, report the item as unresolved and ASK.
- **Reviewer flags critical issues**: Present them and ASK whether to fix or proceed without fixing.
- **Scope creep during implementation**: If actual changes exceed the soft guard thresholds (5 files / 200 lines), warn the user and suggest deferring remaining items to a `hatch3r-workflow` session.
- **Push failure**: Present the error. Use `git push -u origin {branch}` for new branches. For diverged branches, suggest `git pull --rebase` and ASK before proceeding.
- **Context degradation (>15 turns)**: Quick changes should complete fast. If the session exceeds 15 turns, suggest starting fresh or switching to `hatch3r-workflow`.

## Guardrails

- **Never skip quality checks (Step 5)** -- even for trivial changes. Lint, typecheck, and test must pass.
- **Never auto-commit without ASK (Step 7).** The user always decides the git action.
- **Soft guard is advisory, not blocking.** The user can always override the scope warning.
- **Stay within the described changes.** Do not expand scope, refactor adjacent code, or add features beyond what was requested.
- **Recommend `hatch3r-workflow` if scope grows.** If implementation reveals the change is larger than expected, pause and recommend switching.
- **No board operations.** Never create issues, update project boards, or sync with GitHub Projects.
- **No PR creation.** Quick changes commit directly; PRs are the user's responsibility if needed.
- **Respect `scope: always` rules** when delegating to sub-agents. Sub-agents do not inherit rules automatically.
- **This command composes existing hatch3r agents** (implementer, reviewer, lint-fixer) -- it does not replace them.
