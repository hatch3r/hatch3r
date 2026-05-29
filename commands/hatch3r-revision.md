---
id: hatch3r-revision
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-lint-fixer, hatch3r-testability, hatch3r-reviewer, hatch3r-fixer, hatch3r-security, hatch3r-docs-writer, hatch3r-ui, hatch3r-performance]
description: User-guided revision of agent-implemented code in a fresh context window. Reconstructs what was done, interviews the user for feedback, fixes issues, cleans up leftovers, and drives toward merge readiness. Delegation, quality pipeline, modes, and board integration details are in commands/revision/.
tags: [implementation, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: deep
triage_tiers: [1, 2, 3]
supports_resume: true
sub_agents_spawned:
  count: 10
  rationale: Per-revision fanout — researcher (conditional, Tier 2/3 pre-implementation context per commands/revision/revision-delegation.md Step 6.pre), implementer, lint-fixer, testability (Stage 1 fix group), reviewer ↔ fixer review loop, then parallel Stage 2 final-quality CQ specialists (security, docs-writer, ui, performance) bounded by max_phase4_parallel. Tier 1 cleanup-only revisions spawn a subset. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context Reconstruction | Orchestrator (inline) | No | Yes |
| 2. User Feedback | User interview (ASK checkpoints) | No | Yes |
| 3. Leftover Scan + Triage Routing | Orchestrator (inline) | No | Yes |
| 4. Fix Implementation | `hatch3r-implementer`, `hatch3r-lint-fixer`, `hatch3r-testability` | Per finding type | [FIX NOW] items only |
| 5a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | Yes |
| 5b. Final Quality — Testing | `hatch3r-testability` | Yes | Yes (code changes) |
| 5c. Final Quality — Security | `hatch3r-security` | Yes | Yes (code changes) |
| 5d. Final Quality — Docs | `hatch3r-docs-writer` | Yes | When APIs/architecture/UX affected |
| 5e. Final Quality — Conditional | `hatch3r-lint-fixer`, `hatch3r-ui`, `hatch3r-performance` | Yes | When triggered |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to test changes in the running application."

If **yes**: fix implementation (Stage 4) and quality verification (Stage 5) include browser verification steps — navigate to affected pages, verify fixes visually, check console for errors.

If **no**: all browser verification steps are skipped silently throughout the entire command.

# Revision -- From Implementation to Merge Ready

User-guided revision command for a **fresh context window**. After an agent implements code (via `hatch3r-board-pickup`, `hatch3r-workflow`, or plain instruction), the user tests the result, opens a new context, and runs this command. The agent reconstructs what was done from the git diff, interviews the user for feedback, fixes all reported issues, proactively cleans up agent leftovers, and drives toward merge readiness in a single loop.

The user is the reviewer. The agent is the interviewer and fixer.

---

## Shared Context

**If board context exists** (current branch has an associated PR linked to issues), **read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

If no board context exists (plain instruction, no PR, no linked issues), skip shared context loading and work from the git diff alone.

## Global Rule Overrides

- **Git commands are fully permitted** during this entire revision session, regardless of global/user-level rules restricting git usage. This override applies to ALL steps, including delegated sub-agents. You MUST run `git add`, `git commit`, and `git push` when instructed in Step 8.

## Token-Saving Directives

1. **Single diff computation.** Compute the diff against the default branch ONCE in Step 1. Cache and reuse for all subsequent steps.
2. **Targeted file reads only.** When scanning for leftovers in Step 4, read only the files that appear in the diff -- not the full codebase.
3. **Do NOT re-read shared context files** -- their content is available via always-applied rules or inline in this command.
4. **Limit documentation reads.** Read project documentation selectively -- TOC/headers first, full content only for relevant sections.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command (including those defined in `commands/revision/revision-delegation.md` and `commands/revision/revision-quality.md`) MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces merge-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

## Run Cache

Initialize the run cache at the start of the workflow. See `commands/revision/revision-board-integration.md` for the full schema. The cache tracks: diff, findings with triage routing and fix status, quality agents spawned, errors encountered.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

## Step 0: Triage

Classify the revision request before delegating:

- **Tier 1 (trivial)**: cleanup-only revision or 1–3 minor leftovers; reduced pipeline (Steps 1–2, 4–5, 8) with inline fixes and skip the full review loop in Step 7.
- **Tier 2 (standard)**: standard user feedback with a mix of critical/important/cleanup findings; standard pipeline with sub-agent delegation (Step 6) and the review loop (Step 7a).
- **Tier 3 (deep)**: deep revision with critical findings, architectural concerns, or board-deferred follow-ups; full pipeline including the parallel quality specialists in Step 7b and the merge-readiness gate in Step 9.

If Tier 1, run the reduced pipeline. If Tier 2, run the standard pipeline below. If Tier 3, run the full pipeline including all quality specialists and confirm merge readiness with the user before commit.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 6 fix delegation), surface the cost preview so a multi-finding revision is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier. A cleanup-only revision with no [FIX NOW] items spawns no sub-agents, so `expected_sa_count: 0` is correct for it.

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 cleanup-only ~0, Tier 2 ~5, Tier 3 up to 10>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

The Step 3 user-feedback interview is user-driven and excluded from the duration estimate. Post-execution actuals + delta land in the Step 9 merge-readiness assessment's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a cleanup-only revision scored as Deep, or a revision with critical findings scored as Light. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the Step 0 auto-classification stands.

### Confidence Floor (Decision 16 / D13-SA13.3-F13.3.3)

`--effort` calibrates work-effort depth; `--confidence-floor` calibrates the confidence threshold at which the Step 7 review gate (`commands/revision/revision-quality.md` Stage 1 confidence-aware gate) blocks. They are orthogonal. This is the user's pre-flight assertiveness knob — the forced-second-pass on low confidence is post-hoc; the floor sets the bar before the run:

- `--confidence-floor=any|medium|high` (default `any`). Resolution order: explicit flag wins over the persisted `hatch3r config confidence_floor=...` default, which wins over the built-in `any`.
- **`any`** (current behavior): force a second reviewer pass only when reviewer confidence `== low` with 0 Critical + 0 Warning.
- **`medium`**: force a second pass on ANY finding rated `confidence == low`, even with 0 Critical + 0 Warning.
- **`high`**: force a second pass on any finding rated `confidence != high`, AND ASK the user on every low-confidence finding regardless of severity.
- Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`. Pass the resolved floor verbatim into the Step 7 Stage 1 review-gate evaluation alongside the confidence value sourced from the upstream reviewer (Confidence Propagation Contract). Tier 1 cleanup-only revisions that skip the review loop are unaffected; the floor never relaxes the merge-readiness gate.

---

### Step 1: Context Reconstruction

Rebuild full context in the fresh window. No prior implementation context is assumed.

#### 1a. Detect Scope of Changes

1. Identify the current branch: `git branch --show-current`.
2. Determine the default branch from `.hatch3r/hatch.json` (`board.defaultBranch`). Fall back to `main` if unavailable.
3. Compute the diff: `git diff {defaultBranch}...HEAD --stat` for a summary, then `git diff {defaultBranch}...HEAD` for the full diff.
4. Parse the diff summary: files changed, lines added/removed, file types affected.
5. Identify affected areas from the file paths (e.g., `src/routes/` -> API, `src/components/` -> UI, `tests/` -> testing).

#### 1b. Find Associated PR and Issues

> Platform-specific CLI commands: see `commands/board/shared-{platform}.md` for PR/issue lookup

1. Detect the platform from `.hatch3r/hatch.json` (`board.platform`). Fall back to GitHub if unavailable.
2. Search for an open PR on this branch using the platform CLI:
   - **GitHub:** `gh pr list --head {branch} --state open --json number,title,body,url --limit 1`
   - **Azure DevOps:** `az repos pr list --source-branch {branch} --status active --top 1`
   - **GitLab:** `glab mr list --source-branch {branch} --state opened --per-page 1`
3. If a PR exists:
   - Read the PR body.
   - Extract linked issues from `Closes #N`, `Fixes #N`, `Relates to #N` references.
   - For each linked issue: fetch title, body, labels, and acceptance criteria using the platform CLI.
4. If no PR exists: note this and work from the branch diff alone.

#### 1c. Load Project Rules

Read all `scope: always` rules from `rules/`. These must be included in every sub-agent prompt in Step 6.

#### 1d. Consult Learnings

If `.hatch3r/learnings/` exists, scan for learnings with matching areas or tags that overlap with the affected areas from Step 1a.5. Cache relevant learnings for Step 6.

---

### Step 2: Present Context and Validate

Present a reconstruction summary to the user:

```
Revision Context:
  Branch: {branch}
  Platform: {GitHub / Azure DevOps / GitLab}
  PR: #{N} — {title} ({url}) | No PR found
  Linked issues: #{N} — {title} (×{count}) | None
  Diff: {files_changed} files changed (+{additions} / -{deletions})
  Areas: {area_list}
  Acceptance criteria: {found / not found}
```

**ASK:** "Is this the work you want to revise? Any additional context I should know about? (yes / provide context / wrong branch)"

When asking, use the platform-native question tool per `agents/shared/user-question-protocol.md`. If the user provides additional context (e.g., a different issue number, clarifications, or scope adjustments), incorporate it before proceeding.

---

### Step 3: User Feedback Interview

Structured dialog to collect all user feedback. This is the core of the revision command -- the user tested the implementation and the agent extracts their findings through targeted questions.

#### 3a. General Feedback

**ASK:** "What did you test and what did you find? Tell me everything -- bugs, missing features, visual issues, rough edges, or anything that needs attention. If the implementation is clean and you just want a general cleanup, say 'cleanup only'."

#### 3b. Follow-Up Questions (Adaptive)

Based on the user's initial response and the diff scope, ask targeted follow-up questions. Select from the relevant categories:

**If UI changes detected** (components, styles, templates in diff):
- "Any visual mismatches -- spacing, alignment, colors, typography?"
- "Does it render and respond as expected at different viewport sizes?"
- "Any interaction issues -- hover states, focus, transitions, animations?"

**If API/backend changes detected** (routes, services, middleware in diff):
- "Did you test error cases and edge inputs?"
- "Any issues with response format, status codes, or timing?"

**If data model changes detected** (schemas, migrations, types in diff):
- "Any data integrity or validation issues you noticed?"

**If test changes detected** (test files in diff):
- "Do the tests cover the scenarios you care about?"

**If the user said 'cleanup only':** Skip follow-ups and proceed directly to Step 4.

#### 3c. Consolidate User Feedback

Parse all user responses into a structured findings list. Each finding should include:
- A short description
- Severity as reported by the user (critical / important / minor)
- Affected area (file paths if mentioned, or inferred from context)

---

### Step 4: Proactive Leftover Scan

Scan the changed files for common agent-generated leftovers. This runs regardless of user feedback -- agents frequently leave behind artifacts that the user may not have noticed.

#### 4a. Code Quality Leftovers

Scan each file in the diff for:
- Dead code / unused imports introduced by the implementation
- `TODO`/`FIXME`/`HACK` comments without issue references
- `any` types or `@ts-ignore`/`@ts-expect-error` directives without justification
- Incomplete error handling (empty catch blocks, swallowed errors, generic error messages)
- Narrating or redundant comments that explain the obvious
- Hardcoded values that should be constants or configuration
- Console.log / debug statements left in production code
- Duplicated logic that could be extracted

#### 4b. Structural Leftovers

Check for:
- Lint errors in changed files (run lint on changed files only)
- Type errors in changed files (run typecheck if available)
- Missing or insufficient test coverage for new logic paths
- Missing exports or broken import chains
- Inconsistent naming conventions compared to surrounding code

#### 4c. Compile Scan Results

For each leftover found, record:
- File path and line number(s)
- Category (dead-code, todo, type-safety, error-handling, style, test-gap, lint)
- Severity (cleanup / cosmetic)

---

### Step 5: Findings Consolidation and Triage Routing

Merge user feedback (Step 3) and proactive scan results (Step 4) into a single prioritized list:

- **Critical**: User-reported bugs, broken functionality, security issues, data corruption risks
- **Important**: User-reported UX issues, missing features, incomplete behavior, test gaps for critical paths
- **Cleanup**: Leftovers detected by scan -- dead code, TODOs, type issues, error handling gaps
- **Cosmetic**: Style improvements, naming, comment cleanup, minor readability enhancements

#### 5a. Suggest Routing

For each finding, suggest whether it should be fixed in this revision session or deferred to the board for later implementation via `board-fill`.

**Routing heuristics:**

| Severity | Condition | Default Route |
|----------|-----------|---------------|
| Critical | Any | FIX NOW (warn if user overrides) |
| Important | Affects files already in the diff + matches acceptance criteria | FIX NOW |
| Important | Outside PR scope / requires new files / architectural change | DEFER |
| Cleanup | Quick fix in diff files (single line, import cleanup, typo) | FIX NOW |
| Cleanup | Substantial scope / new files needed / cross-cutting | DEFER |
| Cosmetic | Any | DEFER |

Present the consolidated findings with routing markers:

```
Revision Findings ({N} total):

Critical ({n}):
  1. {description} — {file:line} → [FIX NOW]
  2. ...

Important ({n}):
  1. {description} — {file:line} → [FIX NOW]
     (in diff files, matches acceptance criteria)
  2. {description} — {file:line} → [DEFER]
     (outside PR scope, requires new files)
  ...

Cleanup ({n}):
  1. {description} — {file:line} → [FIX NOW]
     (quick fix, file already in diff)
  2. {description} — {file:line} → [DEFER]
     (substantial scope, cross-cutting)
  ...

Cosmetic ({n}):
  1. {description} — {file:line} → [DEFER]
  ...
```

#### 5b. Routing ASK

**ASK:** "Here are all findings with suggested routing. Review:
- Change routing by number (e.g., 'defer Important.2', 'fix Cosmetic.3')
- 'accept' to proceed with suggested routing
- 'fix all' to implement everything now (skip board deferral)
- Adjust priorities, remove, or add findings as before

(accept / fix all / adjust / add more)"

If the user attempts to defer a Critical finding, execute the Critical Deferral Protocol:

1. **Structured warning.** Present the specific risk:

   ```
   Critical Deferral Warning:
     Finding: {description}
     Risk: {specific consequence of deferral — e.g., "unvalidated auth tokens may allow unauthorized access"}
     Policy: Critical findings should resolve before merge (CONSTITUTION.md, quality philosophy).
   ```

2. **Require rationale.** Do not accept a bare "yes" or "defer" — the user must provide a written reason explaining why deferral is acceptable in this context.

   **ASK:** "To defer this Critical finding, please provide a written rationale explaining why it is safe to merge without resolving it. This will be recorded in todo.md for board-fill triage."

3. **Record rationale.** When recording the deferred Critical finding in todo.md (Step 5c), include the user's rationale and a `Critical-deferred` tag:

   ```markdown
   - {finding description} (severity: Critical, file: {file:line}) [Critical-deferred]
     Deferral rationale: {user's stated rationale}
   ```

4. **Flag for triage.** The `Critical-deferred` tag signals board-fill to surface this item with elevated visibility during the next triage cycle. Board-fill should treat `Critical-deferred` items as priority:p0 candidates regardless of other signals.

The user is never blocked — this protocol adds accountability, not a veto.

"fix all" preserves backward compatibility -- zero additional friction for simple revisions where everything should just be fixed.

#### 5c. File Deferred Findings to todo.md

If any findings are routed to [DEFER]:

1. **Append to `todo.md`** as a single epic context block. All deferred findings from this revision session are grouped together regardless of count -- board-fill will create one epic from them.

   **If a PR exists** (from Step 1b):

   ```markdown
   # Follow-ups from PR #{pr_number} revision ({date})
   # Epic: group all items below into one epic during board-fill
   - {finding description} (severity: {severity}, file: {file:line})
   - {finding description} (severity: {severity}, file: {file:line})
   - ...
   ```

   **If no PR exists** (working outside board pipeline):

   ```markdown
   # Follow-ups from {branch} revision ({date})
   # Epic: group all items below into one epic during board-fill
   - {finding description} (severity: {severity}, file: {file:line})
   - ...
   ```

2. Present summary:
   `"Deferred {N} findings to todo.md. Run /hatch3r-board-fill to triage them into an epic with full dependency analysis."`

3. Cache the deferred findings list for use in Steps 8 and 9. Update run cache `deferred_findings`.

If no findings are routed to [DEFER] (including the "fix all" shortcut), skip this sub-step entirely.

---

### Step 6: Fix Implementation (Sub-Agent Delegation)

> Full details: see `commands/revision/revision-delegation.md`

Delegate [FIX NOW] findings to specialist sub-agents. The delegation protocol covers complexity assessment (using `hatch3r-deep-context` scoring), blast-radius-aware finding grouping, expanded sub-agent prompt templates, and cross-agent conflict resolution.

If all findings were deferred (no [FIX NOW] items), skip Step 6 entirely and proceed to Step 7.

---

### Step 7: Quality Verification

> Full details: see `commands/revision/revision-quality.md`

Two-stage quality pipeline: Stage 1 runs a sequential review loop (`hatch3r-reviewer` -> `hatch3r-fixer`, max 3 iterations). Stage 2 spawns final quality CQ specialists in parallel — mandatory (`hatch3r-testability`, `hatch3r-security`), evaluated (`hatch3r-docs-writer`), and conditional (`hatch3r-ui`, `hatch3r-performance`, `hatch3r-lint-fixer`).

---

### Step 8: Commit and Push

Stage, commit, and push all revision changes.

```bash
git add -A
git commit -m "revision: {short summary of fixes}"
git push
```

**Commit message format:**
- Single category: `revision: fix {description}` (e.g., `revision: fix auth token refresh and clean up dead code`)
- Multiple categories: `revision: address {N} issues from user testing` with a body listing the categories
- Reference linked issue numbers when available: `revision: fix validation edge cases (#42)`
- When deferred findings exist, include them in the commit message body:
  ```
  revision: address {N} findings, defer {M} to board

  Fixed:
  - {fixed finding summaries}

  Deferred to todo.md for board-fill:
  - {deferred finding summaries}
  ```

If `git push` fails (e.g., remote branch does not exist yet), use `git push -u origin {branch}`.

**Post-commit board integration:** If board context exists, update the PR description with a revision summary. See `commands/revision/revision-board-integration.md` for the full procedure.

---

### Step 9: Merge Readiness Assessment

Evaluate whether the branch is ready to merge.

#### 9a. Readiness Checklist

```
Merge Readiness:
  [x/·] Quality checks passing (lint, types, tests)
  [x/·] All critical findings addressed
  [x/·] All important findings addressed or tracked ({N} fixed, {M} deferred)
  [x/·] Cleanup findings addressed or tracked ({N} fixed, {M} deferred)
  [x/·] Acceptance criteria met (if available)
  [x/·] No unresolved TODOs in changed files
  [x/·] No remaining lint/type errors in changed files

Deferred to Board ({M} items — in todo.md, pending board-fill):
  - {description} (severity: {severity})
  - ...

  Overall Revision Confidence: {high/medium/low}
    Highest-risk remaining area: {description or "none"}

Verdict: READY / NOT READY ({remaining items})
```

A deferred finding counts as "tracked" not "unaddressed" -- it does not block merge readiness.

#### 9b. Board Housekeeping

> Full details: see `commands/revision/revision-board-integration.md`

When board context exists, run the board housekeeping steps:
- **9b.i. Refresh Board Dashboard** (mandatory when `meta:board-overview` exists).
- **9b.ii. Lightweight Reconciliation** — verify PR body integrity, deferred findings in todo.md, and issue status consistency.

When no board context exists, skip 9b entirely.

#### 9c. Present Assessment

**ASK:** "Revision complete. {verdict}. Options: (a) ready to merge, (b) run another revision cycle with new feedback, (c) done for now."

- **(a) Ready to merge**: Proceed to Step 10.
- **(b) Another cycle**: Loop back to Step 3 for a fresh feedback interview. The user may have tested the fixes and found additional issues.
- **(c) Done for now**: Proceed to Step 10. The user will return later.

---

### Step 10: Capture Learnings

Capture revision-specific learnings. Focus on patterns that inform future implementations.

1. Reflect on the revision:
   - What types of issues did the original implementation miss?
   - Were there recurring leftover patterns (e.g., agents consistently leave TODO comments, miss error handling)?
   - Did the user's feedback reveal gaps in the acceptance criteria or specs?
   - Were there any integration issues between sub-agent outputs?

2. If significant learnings are identified:
   - Create learning files in `.hatch3r/learnings/` following the `hatch3r-learn` skill format (`skills/hatch3r-learn/SKILL.md`).
   - Use category `pitfall` for issues agents commonly miss.
   - Use category `pattern` for revision approaches that worked well.
   - Tag with relevant area labels.

3. If no significant learnings: skip silently. Not every revision produces learnings.

---

## Resumability (Decision 27/30)

revision is long-running — a Tier 2/3 run walks 10 sequential steps (context reconstruction → user feedback → proactive scan → consolidated triage → multi-agent fix loops → quality verification → commit & push → merge-readiness → learnings) and delegates to multiple sub-agents per finding. Per `governance/CONSTITUTION.md` §6 Decision 30 (Workspace-checkpointed resumability), checkpoint progress so an interrupted run re-enters at the last completed step rather than re-interviewing the user or re-running the proactive scan.

**Checkpoint contract** (`src/pipeline/checkpoint.ts`):

1. **Workspace + file:** write `.revision-workspace/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the Step 0 → Step 10 progression), `wave` (fix-loop iteration index for Step 6), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, runCacheRef }`. The full Run Cache (diff, findings with triage routing and fix status, quality agents spawned, errors) lives alongside in `.revision-workspace/run-cache.json` per `commands/revision/revision-board-integration.md`.
2. **Write points:** after Step 1 context reconstruction completes, after Step 2 user validation is confirmed, after Step 3 user feedback closes, after Step 4 proactive scan finishes, after Step 5 triage routing locks, and after every Step 6 fixer sub-agent returns so per-finding fix results survive a crash and are not re-applied on resume. Also after Step 7 quality gate result, after Step 8 commit, and after Step 9 merge-readiness assessment.
3. **`--resume` invocation:** `hatch3r-revision --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the working tree / branch state changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage before resuming.
4. **Snapshot rollback:** pre-mutation snapshots of every file touched by Step 6 fixers land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's mutations. Diff preview precedes every fix-loop mutation per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for revision: `1` = revision target detection + scope, `2` = sub-agent dispatch (review modes, mode-specific revision tasks), `3` = revision synthesis + acceptance check, `4` = revised artifact write + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (revised artifact, revision log, retained-version copy) at Tier 2 or Tier 3 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by each spawned sub-agent verbatim:

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

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first sub-agent dispatch (Step 6 fix delegation).
- **Post-execution `cost_actuals` + `delta`** — appended to the Step 9 merge-readiness assessment's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 10` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 cleanup-only ≈ 0 (inline fixes, no sub-agent); Tier 2 ≈ 5 (conditional researcher + implementer/lint-fixer/test-writer fix group + reviewer); Tier 3 up to 10 (conditional researcher + full pipeline including the parallel Stage 2 final-quality specialists bounded by `max_phase4_parallel`). Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Auto-Advance Mode, Error Handling, and Guardrails

> Full details: see `commands/revision/revision-modes.md`

The modes file contains: auto-advance mode (`--auto`), safety guardrails, error handling, and session report format for revision.

**Concurrent invocation guardrail:** before Step 6 fix delegation, acquire `.hatch3r/.lock` and detect-then-warn on a conflicting active pipeline (same branch / open `.hatch3r/hatch.json` board transaction) per `rules/hatch3r-agent-orchestration.md` → Parallel Safety → Concurrent Invocation Handling. Cross-task learnings consolidate at completion, never mid-pipeline.
