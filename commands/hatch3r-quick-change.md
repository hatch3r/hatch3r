---
id: hatch3r-quick-change
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-lint-fixer, hatch3r-reviewer, hatch3r-fixer, hatch3r-testability, hatch3r-security]
description: "Lightweight workflow for small changes not tracked on the board: adaptive ceremony, inline or sub-agent implementation, batch support."
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 7
  rationale: Nontrivial-path fan-out, every agent conditional per Phase Skip Criteria — `hatch3r-researcher` (`similar-implementation` quick depth, Step 4b), `hatch3r-implementer` (Step 4b), `hatch3r-lint-fixer` (Step 5 on lint/type errors), the `hatch3r-reviewer` ↔ `hatch3r-fixer` review loop (Step 6a), and the two final-quality gates `hatch3r-testability` (CQ5) + `hatch3r-security` (CQ3) (Step 6b). quick-change's lightweight scope dispatches no other CQ vector specialist (ui/ux/reliability/scalability/performance/maintainability/enhancability); Tier 1 trivial edits skip all sub-agents. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: mixed
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

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

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
  expected_sa_count: <Tier 1 inline ~0, Tier 2 ~3 (researcher + implementer + reviewer), up to 7 on the full nontrivial path (adds lint-fixer, fixer, testability, security)>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a multi-file change scored as Tier 1, or a one-line edit scored as Tier 2. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard` forces the named tier, bypassing the Triage auto-classification. `--effort=deep` is rejected here — quick-change hard-blocks Tier 3 and routes to `hatch3r-workflow`.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Triage auto-classification stands.

### Confidence Floor (Decision 16 / D13-SA13.3-F13.3.3)

`--effort` calibrates work-effort depth; `--confidence-floor` calibrates the confidence threshold at which the Step 6a review gate blocks. They are orthogonal. This is the user's pre-flight assertiveness knob (the forced-second-pass on low confidence in Step 6a is post-hoc; the floor sets the bar before the run):

- `--confidence-floor=any|medium|high` (default `any`). Resolution order: explicit flag wins over the persisted `hatch3r config confidence_floor=...` default, which wins over the built-in `any`.
- **`any`** (current behavior): Step 6a forces a second reviewer pass only when reviewer confidence `== low` with 0 Critical + 0 Warning.
- **`medium`**: force a second pass on ANY finding rated `confidence == low`, even with 0 Critical + 0 Warning.
- **`high`**: force a second pass on any finding rated `confidence != high`, AND ASK the user on every low-confidence finding regardless of severity.
- Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`. Tier 1 trivial inline edits skip the review loop entirely, so the floor applies only to nontrivial items that reach Step 6a. The floor never relaxes a quality gate.

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

**ASK:** "This change scores Tier 3 (Deep complexity): {reason}. Quick-change does not provide the research depth needed. Options: (a) switch to `/hatch3r-workflow`, (b) narrow the scope."

Do NOT offer a "proceed anyway" option for Tier 3. The user must switch to `/hatch3r-workflow` or narrow scope.

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
2. Match each learning by testing those file paths against its `applies-to` glob and the work area against its `topic` (canonical match keys per `rules/hatch3r-learning-system.md`); accept legacy `area`/`tags` frontmatter only as a transitional fallback.
3. If matches found (max 3 learnings, highest confidence first), surface them as a brief heads-up:

   ```
   Heads up — relevant learnings:
     - [{topic}] {one-line learning summary} (from: {learning filename})
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
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID; batch items share one id with a sub-task index).
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
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.
- Requirement that the reviewer output include a top-level `confidence: high | medium | low` field (not just per-finding) so the gate in step 2 can evaluate it deterministically.

2. Process reviewer output (confidence-aware gate — the second-pass trigger tightens with the `--confidence-floor` set in the Effort Override section above; `any` = default below, `medium`/`high` raise the bar):
   - If **0 Critical + 0 Warning AND reviewer confidence != low**: review loop is clean. Proceed to Step 6b. (Floor `medium`: also force a second pass if any individual finding is `confidence == low`. Floor `high`: force a second pass if reviewer confidence `!= high` OR any finding is `!= high`, AND ASK on every low-confidence finding.)
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
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Apply any resulting changes (new tests, security fixes). Re-run quality checks (Step 5a) if changes were made.

#### 6c. Post-Write Duplication Scan (Decision 21)

When the batch ran **2+ parallel implementers** (independent areas, per Step 4b), run a duplication scan before finishing — parallel implementers can each emit near-duplicate helpers that pass their own path independently (D13-SA13.2-F7). Skip when only one implementer ran or all items were trivial (no cross-file clone possible).

1. Run `npx jscpd --min-lines 40 --threshold 80 --reporters json --silent <changed-paths>`. The gate fires on any cross-file clone block **≥40 lines OR ≥80% byte-similar**.
2. **If detected:** route the report to `hatch3r-fixer` for a DRY refactor, then re-run quality checks (Step 5a). Max 1 iteration; if it persists, surface the clone locations to the user.
3. **If not detected:** proceed to Step 7.

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

quick-change runs adaptive ceremony — trivial items execute inline with no checkpoint surface, but a Tier 2/3 batch of multiple nontrivial items can grow to span per-item implementer delegation (Step 4), lint-fix (Step 5), the reviewer ↔ fixer review loop (Step 6), parallel CQ specialist Phase 4 batch (Step 6 final-quality), and the commit phase (Step 7). Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress on nontrivial batches so an interrupted run re-enters at the last completed step rather than re-implementing items that already wrote code.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.quick-change-workspace/`; step range the Step 1 → Step 8 progression; `wave` = per-item implementer-batch index when batch mode is active; snapshot/rollback paths per-item working-tree state. Write points: Tier 1 trivial inline items skip checkpoint emission (the resume cost would exceed the re-run cost). For nontrivial items: after Step 1 input + batch parsing, after Step 2 tier assessment + soft-guard pass, after Step 3 per-item classification, after each Step 4 implementer batch returns per item (so completed implementations survive a crash and are not re-implemented on resume), after Step 5 lint-fix, after each Step 6 review-loop iteration, after the Step 6 final-quality batch, and after Step 7 git commit.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for quick-change: `1` = scope intake + complexity scoring, `2` = inline edit OR implementer dispatch (Tier 1 carve-out per `rules/hatch3r-agent-orchestration.md` Mandatory Delegation Directive applies only at Tier 1), `3` = lint + typecheck + test verification, `4` = Step 8 summary + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: target edit, test additions. quick-change is the one command with a Tier-1 inline-edit carve-out (per `rules/hatch3r-agent-orchestration.md` Mandatory Delegation Directive): a Tier-1 inline edit by the orchestrator sets `inline_edits_by_orchestrator: <carve-out: Tier-1 inline edit per quick-change scope>` instead of `none`.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 28, superseded in place 2026-07-06). (The Step 8 block above is the domain rendering; the recap closes the run.)

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in the Pre-Execution Cost Preview above before the first sub-agent dispatch.
- **Post-execution `cost_actuals` + `delta`** — appended to the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 7` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 trivial inline ≈ 0 (no sub-agent); Tier 2 ≈ 3 (researcher + implementer + reviewer, plus lint-fixer/fixer/testability/security when triggered); up to 7 when the full nontrivial path fires — the two mandatory final-quality gates (testability, security) plus lint-fixer and fixer. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- **Quality check failure after 2 retries**: Present the specific failures and ASK the user whether to commit partial progress, keep trying, or abort.
- **Implementer sub-agent failure** (nontrivial Step-4b items): route through the shared sub-agent-failure clause (`rules/hatch3r-agent-orchestration.md` → Sub-agent-failure handling) — retry once; if the retry fails, re-spawn `hatch3r-fixer` with the failure reason + partial output as failure context; if the re-spawn also fails, emit `BLOCKED_OTHER` with a one-sentence reason and ASK. Never fall back to inline implementation for a nontrivial item — that is the issue #73 bypass mode. Inline implementation stays sanctioned only for Step-4a trivial (Tier-1) items per this command's declared scope.
- **Reviewer flags critical issues**: Present them and ASK whether to fix or proceed without fixing.
- **Scope creep during implementation**: If actual changes exceed the soft guard thresholds (5 files / 200 lines), warn the user and suggest deferring remaining items to a `hatch3r-workflow` session.
- **Push failure**: Present the error. Use `git push -u origin {branch}` for new branches. For diverged branches, suggest `git pull --rebase` and ASK before proceeding.
- **Context degradation**: per the canonical Context-Degradation Policy (`rules/hatch3r-agent-orchestration-detail.md` -> Context-Degradation Policy) — compress at `>50%` context window, restart at `>75%`; the coarse turn-count fallback for this fast-completion command is ~15 turns, at which point suggest starting fresh or switching to `hatch3r-workflow`.

## Guardrails

- **Never skip quality checks (Step 5)** -- even for trivial changes. Lint, typecheck, and test must pass.
- **Never auto-commit without ASK (Step 7).** The user always decides the git action.
- **Soft guard is advisory, not blocking.** The user can always override the scope warning.
- **Stay within the described changes.** Do not expand scope, refactor adjacent code, or add features beyond what was requested.
- **Recommend `hatch3r-workflow` if scope grows.** If implementation reveals the change is larger than expected, pause and recommend switching.
- **No board operations.** Never create issues, update project boards, or sync with GitHub Projects.
- **No PR creation.** Quick changes commit directly; PRs are the user's responsibility if needed.
- **Respect `scope: always` rules** when delegating to sub-agents. Sub-agents do not inherit rules automatically.
- **Concurrent invocation:** for Tier 2/3 batches, acquire `.hatch3r/.lock` and detect-then-warn on a conflicting active pipeline (same branch / open `.hatch3r/hatch.json` transaction) per `rules/hatch3r-agent-orchestration.md` → Parallel Safety → Concurrent Invocation Handling. Tier 1 inline edits with no checkpoint surface are exempt.
- **This command composes existing hatch3r agents** (implementer, reviewer, lint-fixer) -- it does not replace them.
