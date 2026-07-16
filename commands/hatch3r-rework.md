---
id: hatch3r-rework
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-reviewer]
description: User-guided rework planning for agent-implemented code in a fresh context window. Reconstructs what was delivered from the git diff, interviews the user for feedback, triages findings, validates them read-only against the code, and ends at a rework plan (docs/rework/) plus an execute-now-or-defer choice (copy-paste fresh-session execution prompt on defer) — the planning pass never fixes inline, never commits, never pushes. Plan format, modes, and board integration details are in commands/rework/.
argument-hint: "[--review-only] [--auto] [--confidence-floor=any|medium|high]"
disable-model-invocation: true
tags: [planning]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
plan_handoff: true
supports_resume: true
sub_agents_spawned:
  count: 2
  rationale: Researcher enrichment (conditional, Tier 2/3 per the Step 6.pre complexity tiering) plus ONE hatch3r-reviewer validation pass over the branch diff and consolidated findings; zero mutation — implementation happens in the fresh execution session that runs the rework plan. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: wrong branch suspected, feedback that contradicts the diff, missing acceptance criteria on a Critical finding.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context Reconstruction | Orchestrator (inline) | No | Yes |
| 2. User Feedback | User interview (ASK checkpoints) | No | Yes |
| 3. Leftover Scan + Triage Routing | Orchestrator (inline) | No | Yes |
| 4. Plan Validation & Enrichment | `hatch3r-researcher` (Tier 2/3) -> `hatch3r-reviewer` (one read-only validation pass) | No (sequential dependency edge) | [REVISE] items only |
| 5. Plan Write + Handoff | Orchestrator (inline, single writer) | No | Yes |

**Parallelism note:** the researcher -> reviewer chain is sequential on a real dependency edge (the reviewer prompt embeds researcher output). Independent read-only tool calls inside a stage (diff computation, PR fetch, rules read) run in parallel per `rules/hatch3r-agent-orchestration.md` §Parallel Safety. No stage mutates code, so file-conflict handling does not apply.

## Browser Automation

At the start of this command, ask the user once:

> "Would you like to enable browser verification for this session? This uses Playwright to observe reported issues in the running application."

If **yes**: the Step 6 validation pass may reproduce user-reported findings in the running application — navigate to affected pages, observe the reported behavior, check the console — to rate finding confidence. Observation only; no fix is applied.

If **no**: all browser verification steps are skipped silently throughout the entire command.

# Rework -- From Implementation to a Validated Rework Plan

User-guided rework-planning command for a **fresh context window**. After an agent implements code (via `hatch3r-board-pickup`, `hatch3r-workflow`, or plain instruction), the user tests the result, opens a new context, and runs this command. The agent reconstructs what was done from the git diff, interviews the user for feedback, proactively scans for agent leftovers, validates the consolidated findings against the code read-only, and ends at a rework plan plus a fresh-session execution prompt.

The user is the tester. The agent is the interviewer, validator, and planner. This command never mutates code, never commits, never pushes — implementation happens in the fresh execution session that runs the plan.

---

## Shared Context

**If board context exists** (current branch has an associated PR linked to issues), **read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

If no board context exists (plain instruction, no PR, no linked issues), skip shared context loading and work from the git diff alone — a PR is optional for this flow.

## Global Rule Overrides

- **Read-only git commands are permitted** during this entire rework session (`git branch`, `git diff`, `git log`, platform-CLI PR/issue reads), regardless of global/user-level rules restricting git usage. Mutating git commands (`git add`, `git commit`, `git push`) are OUT of contract for this command — the run ends at the rework plan, and the execution session commits the plan document together with the fixes.

## Token-Saving Directives

1. **Single diff computation.** Compute the diff against the default branch ONCE in Step 1. Cache and reuse for all subsequent steps.
2. **Targeted file reads only.** When scanning for leftovers in Step 4, read only the files that appear in the diff -- not the full codebase.
3. **Do NOT re-read shared context files** -- their content is available via always-applied rules or inline in this command.
4. **Limit documentation reads.** Read project documentation selectively -- TOC/headers first, full content only for relevant sections.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command (including the validation-pass prompt defined in `commands/rework/rework-plan.md`) MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports validation quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces plan readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. The per-finding confidence column in the rework plan document is the terminal carrier of this signal. Dropping the signal between stages is a gate failure.

## Run Cache

Initialize the run cache at the start of the workflow. See `commands/rework/rework-board-integration.md` for the full schema. The cache tracks: diff, findings with triage routing and validation status, validation agents spawned, the plan path, errors encountered.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

## Step 0: Triage

Classify the rework request before delegating:

- **Tier 1 (trivial)**: cleanup-only feedback or 1–3 minor leftovers; reduced pipeline (Steps 1–2, 4–5, 7, 9) — skip the Step 6 validation pass; the terminal block may substitute `/hatch3r-quick-change` per the Tier-1 carve-out in `commands/shared/orchestration-frame.md` → Plan-Execution Handoff.
- **Tier 2 (standard)**: standard user feedback with a mix of critical/important/cleanup findings; standard pipeline with researcher enrichment at `quick` depth (Step 6.pre) and the reviewer validation pass (Step 6a).
- **Tier 3 (deep)**: critical findings, architectural concerns, or board-deferred follow-ups; full pipeline with `codebase-impact` research at `deep` depth (Step 6.pre) and the plan-readiness gate in Step 9 confirmed with the user before the plan write.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 6 validation pass), surface the cost preview so a multi-finding rework session is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier. A Tier 1 cleanup-only session skips Step 6, so `expected_sa_count: 0` is correct for it.

```yaml
cost_estimate:
  expected_sa_count: <triage tier → Tier 1 cleanup-only ~0, Tier 2 ~2, Tier 3 ~2 (+1 when a below-floor second reviewer pass fires)>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

The Step 3 user-feedback interview is user-driven and excluded from the duration estimate. Post-execution actuals + delta land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Effort Override (Decision 17). Misclassification example: a cleanup-only session scored as Deep, or feedback with critical findings scored as Light.

### Confidence Floor (Decision 16 / D13-SA13.3-F13.3.3)

`--effort` calibrates work-effort depth; `--confidence-floor` calibrates the confidence threshold at which the Step 6 validation pass demands a second look. They are orthogonal. This is the user's pre-flight assertiveness knob:

- `--confidence-floor=any|medium|high` (default `any`). Resolution order: explicit flag wins over the persisted `hatch3r config confidence_floor=...` default, which wins over the built-in `any`.
- The floor gates the **validation pass** (Step 6a): when the reviewer's top-level validation confidence falls below the resolved floor, run ONE second reviewer pass before the plan write. Floor branches (`any`/`medium`/`high` pass surfaces) follow the canonical **Confidence-Aware Review Gate** in `agents/shared/confidence-gate.md`, consumed here by `commands/rework/rework-plan.md` — with no fixer branch: findings feed the plan document, never a fixer spawn.
- At floor `high`, additionally ASK the user on every finding the reviewer rates low-confidence before it enters the plan.
- Per P1 maturity tier (Decision 16): solo defaults `any`, enterprise defaults `high`. Tier 1 cleanup-only sessions that skip Step 6 are unaffected; the floor never relaxes the plan-lint gate in Step 7.

### Review-Only Mode (D13-SA13.1-F2)

`--review-only` turns this command into a **read-only code-review surface** — the standalone "review this code, no changes" entry for development-workflow activity (3) Code review. It runs Steps 1–5 + a single `hatch3r-reviewer` pass and emits a review report in chat, then stops: Step 7 plan write, Step 8 board housekeeping (including todo.md deferrals), and Step 10 learnings write are all skipped, so the run writes nothing — not even the plan document. Full behavior table, report format, and `--auto` interaction: `commands/rework/rework-modes.md` -> Review-Only Mode.

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

Read all `scope: always` rules from `rules/`. These must be included in the Step 6 validation-pass prompt.

#### 1d. Consult Learnings

If `.hatch3r/learnings/` exists, scan for learnings whose `applies-to` glob matches the affected file paths from Step 1a.5 or whose `topic` matches the affected areas (canonical match keys per `rules/hatch3r-learning-system.md`; accept legacy `area`/`tags` only as a transitional fallback). Cache relevant learnings for Step 6 and the plan's suggested-approach column.

---

### Step 2: Present Context and Validate

Present a reconstruction summary to the user:

```
Rework Context:
  Branch: {branch}
  Platform: {GitHub / Azure DevOps / GitLab}
  PR: #{N} — {title} ({url}) | No PR found
  Linked issues: #{N} — {title} (×{count}) | None
  Diff: {files_changed} files changed (+{additions} / -{deletions})
  Areas: {area_list}
  Acceptance criteria: {found / not found}
```

**ASK:** "Is this the work you want to plan rework for? Any additional context I should know about? (yes / provide context / wrong branch)"

When asking, use the platform-native question tool per `agents/shared/user-question-protocol.md`. If the user provides additional context (e.g., a different issue number, clarifications, or scope adjustments), incorporate it before proceeding.

---

### Step 3: User Feedback Interview

Structured dialog to collect all user feedback. This is the core of the rework command -- the user tested the implementation and the agent extracts their findings through targeted questions.

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

For each finding, suggest whether it belongs in this session's rework plan or should be deferred to the board for later implementation via `board-fill`.

**Routing heuristics:**

| Severity | Condition | Default Route |
|----------|-----------|---------------|
| Critical | Any | REVISE (warn if user overrides) |
| Important | Affects files already in the diff + matches acceptance criteria | REVISE |
| Important | Outside PR scope / requires new files / architectural change | DEFER |
| Cleanup | Quick fix in diff files (single line, import cleanup, typo) | REVISE |
| Cleanup | Substantial scope / new files needed / cross-cutting | DEFER |
| Cosmetic | Any | DEFER |

`[REVISE]` routes the finding into the rework plan (Step 7); `[DEFER]` routes it to todo.md for board-fill triage (Step 5c). Present the consolidated findings with routing markers:

```
Rework Findings ({N} total):

Critical ({n}):
  1. {description} — {file:line} → [REVISE]
  2. ...

Important ({n}):
  1. {description} — {file:line} → [REVISE]
     (in diff files, matches acceptance criteria)
  2. {description} — {file:line} → [DEFER]
     (outside PR scope, requires new files)
  ...

Cleanup ({n}):
  1. {description} — {file:line} → [REVISE]
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
- Change routing by number (e.g., 'defer Important.2', 'revise Cosmetic.3')
- 'accept' to proceed with suggested routing
- 'revise all' to route everything into the rework plan (skip board deferral)
- Adjust priorities, remove, or add findings as before

(accept / revise all / adjust / add more)"

If the user attempts to defer a Critical finding, execute the Critical Deferral Protocol:

1. **Structured warning.** Present the specific risk:

   ```
   Critical Deferral Warning:
     Finding: {description}
     Risk: {specific consequence of deferral — e.g., "unvalidated auth tokens may allow unauthorized access"}
     Policy: Critical findings should resolve before merge (hatch3r quality philosophy).
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

"revise all" keeps zero additional friction for simple sessions where everything belongs in one plan.

#### 5c. File Deferred Findings to todo.md

If any findings are routed to [DEFER]:

1. **Append to `todo.md`** as a single epic context block. All deferred findings from this rework session are grouped together regardless of count -- board-fill will create one epic from them.

   **If a PR exists** (from Step 1b):

   ```markdown
   # Follow-ups from PR #{pr_number} rework ({date})
   # Epic: group all items below into one epic during board-fill
   - {finding description} (severity: {severity}, file: {file:line})
   - {finding description} (severity: {severity}, file: {file:line})
   - ...
   ```

   **If no PR exists** (working outside board pipeline):

   ```markdown
   # Follow-ups from {branch} rework ({date})
   # Epic: group all items below into one epic during board-fill
   - {finding description} (severity: {severity}, file: {file:line})
   - ...
   ```

2. Present summary:
   `"Deferred {N} findings to todo.md. Run /hatch3r-board-fill to triage them into an epic with full dependency analysis."`

3. Cache the deferred findings list for use in Steps 7–9. Update run cache `deferred_findings`.

If no findings are routed to [DEFER] (including the "revise all" shortcut), skip this sub-step entirely.

---

### Step 6: Plan Validation & Enrichment (Read-Only)

> Validation-pass prompt contract and plan-lint assertions: see `commands/rework/rework-plan.md`

Validate the [REVISE] findings against the code before they enter the plan. Zero mutation — no implementer, lint-fixer, or fixer spawn; the only sub-agents in this command are `hatch3r-researcher` (conditional) and `hatch3r-reviewer` (one validation pass, plus at most one below-floor second pass).

If all findings were deferred (no [REVISE] items), skip Steps 6–7 entirely — there is nothing to plan — and proceed to Step 8 board housekeeping.

#### 6.pre: Complexity Assessment (Tier 2/3 Research)

Score the aggregate [REVISE] batch using `hatch3r-deep-context` complexity signals. Score across the full set of findings, not per-finding:

| Signal | Weight | Detection |
|--------|--------|-----------|
| Findings span multiple modules/layers | +3 | Count distinct directories across all [REVISE] findings |
| Any finding involves behavioral contract changes (API, types, events) | +2 | Check finding descriptions for interface/signature changes |
| Findings touch security-sensitive areas (auth, payments, data access) | +2 | Match affected files against security-sensitive directories |
| Total affected files > 5 | +2 | Count distinct files across all findings |
| Any finding requires new dependencies or integrations | +2 | Check whether the expected behavior implies new imports or services |

| Total Weight | Tier | Action |
|-------------|------|--------|
| 0–2 | 1 (Light) | Proceed directly to 6a. No research needed |
| 3–5 | 2 (Standard) | Spawn `hatch3r-researcher` with `similar-implementation` at `quick` depth. Discovered reference patterns feed the plan's suggested-approach column |
| 6+ | 3 (Deep) | Spawn `hatch3r-researcher` with `codebase-impact` at `deep` depth. **Warn the user** that the rework scope may warrant a new board issue rather than a rework plan |

For Tier 2/3: cache researcher output (reference conventions, blast radius data) for the validation-pass prompt and the plan document.

#### 6a. Reviewer Validation Pass

Spawn ONE `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) over the branch diff + the consolidated [REVISE] findings, with the prompt contract from `commands/rework/rework-plan.md` → Validation-Pass Prompt Contract (diff, findings, `scope: always` rules, `correlation_id`, confidence requirement; researcher output when 6.pre ran). The reviewer:

1. **Verifies each finding against the code** — confirms the file:line, confirms the described behavior is real, and corrects stale locations.
2. **Rates per-finding confidence** (high/medium/low per the Confidence Propagation Contract) plus a top-level validation confidence.
3. **Surfaces misses** — defects visible in the diff that the consolidated findings list lacks. Surfaced misses are presented to the user and, on acceptance, join the plan as new findings.

#### 6b. Confidence-Floor Gate

Evaluate the reviewer's top-level validation confidence against the resolved `--confidence-floor` (floor branches per `agents/shared/confidence-gate.md`; no fixer branch exists in this command). Below-floor confidence → run ONE second reviewer pass before the plan write, routed to a different model class when one is available (`rules/hatch3r-reviewer-calibration.md` → Action). Still below floor after the second pass → **ASK** the user: write the plan with the low-confidence findings marked for human review, or narrow the plan to high-confidence findings only.

---

### Step 7: Write the Rework Plan

> Full document format spec + plan-lint assertions: see `commands/rework/rework-plan.md`

Write the validated plan to `docs/rework/{YYYY-MM-DD}-{branch-slug}.md`:

1. **Run context** — branch, PR number/URL, linked issues, acceptance criteria (from Step 1).
2. **Findings table** — one row per [REVISE] finding: id, severity, file:line (validated), expected behavior, suggested approach, confidence.
3. **Implementation order** — dependency-aware ordering of the findings with a one-line reason per position.
4. **Per-finding acceptance criteria** — at least one testable criterion per finding.
5. **Deferred-items pointer** — the todo.md epic block reference ({M} deferred items) so the executing session does not re-litigate them.

**Plan-lint gate (before the write):** every finding row carries an expected behavior AND at least one testable acceptance criterion; every file:line was validated in Step 6a (or is explicitly marked `unvalidated` for a Tier 1 run that skipped Step 6). Assertions in `commands/rework/rework-plan.md` → Plan-Lint. A finding that fails plan-lint goes back to the user (sharpen or defer), never silently into the plan.

**ASK:** "Plan ready: {N} findings, ordered, with acceptance criteria. Write to `docs/rework/{YYYY-MM-DD}-{branch-slug}.md`? (yes / show plan first / adjust)"

The plan document stays **uncommitted in the working tree** — the execution run commits it together with the fixes.

---

### Step 8: Board Housekeeping

> Full details: see `commands/rework/rework-board-integration.md`

When board context exists:

- **8a. Post the plan note** — post or update the PR note: `Rework plan: docs/rework/{YYYY-MM-DD}-{branch-slug}.md ({N} findings, {M} deferred)`.
- **8b. Refresh Board Dashboard** (mandatory when `meta:board-overview` exists).
- **8c. Lightweight Reconciliation** — verify PR body integrity, deferred findings in todo.md, and issue status consistency.

When no board context exists, only the todo.md deferrals from Step 5c apply; skip 8a–8c silently.

This step posts notes and writes todo.md only. No `git add`, no `git commit`, no `git push` — anywhere in this command.

---

### Step 9: Plan Readiness

Evaluate whether the plan is ready to hand off:

```
Plan Readiness:
  [x/·] Findings validated against code (Step 6a) — {N} validated, {K} marked unvalidated
  [x/·] Plan written to docs/rework/{YYYY-MM-DD}-{branch-slug}.md
  [x/·] Every finding has expected behavior + testable criteria (plan-lint)
  [x/·] Deferrals filed to todo.md ({M} items)
  [x/·] Board note posted (when board context exists)

  Overall Plan Confidence: {high/medium/low}
    Highest-risk finding: {description or "none"}

Verdict: READY / NOT READY ({remaining items})
```

A deferred finding counts as "tracked", not "unplanned" — it does not block plan readiness. On READY, close with the `## Iteration Summary` recap and the `## Execute This Plan` terminal block (see below). On NOT READY, **ASK** the user: resolve the remaining items now, or close with the verdict recorded.

---

### Step 10: Capture Learnings

Capture rework-specific learnings. Focus on patterns that inform future implementations.

1. Reflect on the session:
   - What types of issues did the original implementation miss?
   - Were there recurring leftover patterns (e.g., agents consistently leave TODO comments, miss error handling)?
   - Did the user's feedback reveal gaps in the acceptance criteria or specs?
   - Did the validation pass overturn or relocate findings (a signal the interview or scan misreads the code)?

2. If significant learnings are identified:
   - Create learning files in `.hatch3r/learnings/` following the `hatch3r-learn` skill format (`skills/hatch3r-learn/SKILL.md`).
   - Use category `pitfall` for issues agents commonly miss.
   - Use category `pattern` for rework-planning approaches that worked well.
   - Tag with relevant area labels.

3. If no significant learnings: skip silently. Not every session produces learnings.

---

## Resumability (Decision 27/30)

rework is long-running — a Tier 2/3 run walks 10 sequential steps (context reconstruction → user feedback → proactive scan → consolidated triage → read-only validation → plan write → board housekeeping → plan readiness → learnings) with a user-driven interview in the middle. Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-interviewing the user or re-running the proactive scan.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.rework-workspace/`; step range the Step 0 → Step 10 progression; `wave` = validation-pass index for Step 6 (first pass vs below-floor second pass); snapshot/rollback paths the plan document and todo.md. Write points: after Step 1 context reconstruction completes, after Step 2 user validation is confirmed, after Step 3 user feedback closes, after Step 4 proactive scan finishes, after Step 5 triage routing locks, after the Step 6.pre researcher returns, after each Step 6a reviewer pass returns, after the Step 7 plan write, and after Step 8 board housekeeping.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for rework: `1` = context reconstruction + feedback interview + leftover scan, `2` = validation dispatch (researcher, reviewer), `3` = validation synthesis + plan-lint, `4` = plan write + board housekeeping + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: rework plan document (`docs/rework/`), todo.md deferral block, PR-note update. These are orchestrator-written planning artifacts (single-writer synthesis); the researcher and reviewer sub-agents are read-only and mutate nothing.

## Execute or Defer

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Execute-Now Continuation. Per-command slots: artifact = `docs/rework/{YYYY-MM-DD}-{branch-slug}.md` (the Step 7 plan write); revise returns to Step 5 (Findings Consolidation and Triage Routing).

After the Step 9 READY verdict (and Step 10 learnings capture), ASK: execute now (default) / revise / stop. `execute now` Reads the emitted `hatch3r-workflow` command file and executes it in THIS conversation with `--plan-file=<artifact>` semantics, emitting a fresh `cost_estimate` at execution start; `stop` defers via the Execute This Plan block below. `--auto` and `--review-only` runs never auto-execute — zero-commit semantics preserved; both take the stop path (`--review-only` emits no block at all, unchanged). Skipped when this flow runs under `/hatch3r-plan` — the router asks once, consolidated.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 28, superseded in place 2026-07-06).

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the first sub-agent dispatch (Step 6 validation pass).
- **Post-execution `cost_actuals` + `delta`** — appended to the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 2` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): Tier 1 cleanup-only ≈ 0 (Step 6 skipped); Tier 2 ≈ 2 (researcher at `quick` depth + one reviewer validation pass); Tier 3 ≈ 2 (researcher at `deep` depth + one reviewer validation pass), +1 when the confidence floor forces a second reviewer pass. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Auto-Advance Mode, Error Handling, and Guardrails

> Full details: see `commands/rework/rework-modes.md`

The modes file contains: auto-advance mode (`--auto` — unattended plan: scan-only findings, auto-accepted routing, plan written without the confirm ASK, still zero commit semantics), review-only mode (`--review-only`), safety guardrails, error handling, and session report format for rework.

**Concurrent invocation guardrail:** before the Step 7 plan write, detect-then-warn on a conflicting active pipeline (same branch / open `.hatch3r/hatch.json` board transaction) per `rules/hatch3r-agent-orchestration.md` → Parallel Safety → Concurrent Invocation Handling — two concurrent runs would race on the same plan path and todo.md. Cross-task learnings consolidate at completion, never mid-pipeline.

---

## Execute This Plan

Close a **deferred** run (Execute-or-Defer stop, `--auto`, or a non-interactive run) with the Plan-Execution Handoff block immediately after the Iteration Summary recap — a sanctioned post-recap trailer (when the Remaining Work terminal block also fires per `rules/hatch3r-iteration-summary.md`, it renders after this block as the run's very last output) (frontmatter `plan_handoff: true`; format + shapes: `commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block)).

Fill Shape A (direct): first line `/hatch3r-workflow --plan-file=docs/rework/{YYYY-MM-DD}-{branch-slug}.md` (the plan this run wrote); `<one-line scope>` from the Step 2 run context; top-3 criteria from the plan's per-finding acceptance criteria, Critical findings first. When todo.md deferrals were written, append the board-alternative line. **Tier-1 carve-out:** a cleanup-only plan (≤3 single-line findings) MAY substitute `/hatch3r-quick-change` with the findings inlined as its batch input. Suppressed when this flow runs under `/hatch3r-plan` — the router emits one consolidated block. `--review-only` runs emit no block (nothing was produced to execute).
