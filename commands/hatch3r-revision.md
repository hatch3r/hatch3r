---
id: hatch3r-revision
type: command
description: User-guided revision of agent-implemented code in a fresh context window. Reconstructs what was done, interviews the user for feedback, fixes issues, cleans up leftovers, and drives toward merge readiness.
tags: [implementation, team]
quality_charter: agents/shared/quality-charter.md
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context Reconstruction | Orchestrator (inline) | No | Yes |
| 2. User Feedback | User interview (ASK checkpoints) | No | Yes |
| 3. Leftover Scan + Triage Routing | Orchestrator (inline) | No | Yes |
| 4. Fix Implementation | `hatch3r-implementer`, `hatch3r-lint-fixer`, `hatch3r-test-writer` | Per finding type | [FIX NOW] items only |
| 5a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | Yes |
| 5b. Final Quality | `hatch3r-test-writer` + `hatch3r-security-auditor` | Yes | Yes (code changes) |

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

**If board context exists** (current branch has an associated PR linked to GitHub issues), **read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, and tooling directives. Cache all values for the duration of this run.

If no board context exists (plain instruction, no PR, no linked issues), skip shared context loading and work from the git diff alone.

## Global Rule Overrides

- **Git commands are fully permitted** during this entire revision session, regardless of global/user-level rules restricting git usage. This override applies to ALL steps, including delegated sub-agents. You MUST run `git add`, `git commit`, and `git push` when instructed in Step 8.

## Token-Saving Directives

1. **Single diff computation.** Compute the diff against the default branch ONCE in Step 1. Cache and reuse for all subsequent steps.
2. **Targeted file reads only.** When scanning for leftovers in Step 4, read only the files that appear in the diff -- not the full codebase.
3. **Do NOT re-read shared context files** -- their content is available via always-applied rules or inline in this command.
4. **Limit documentation reads.** Read project documentation selectively -- TOC/headers first, full content only for relevant sections.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Context Reconstruction

Rebuild full context in the fresh window. No prior implementation context is assumed.

#### 1a. Detect Scope of Changes

1. Identify the current branch: `git branch --show-current`.
2. Determine the default branch from `.agents/hatch.json` (`board.defaultBranch`). Fall back to `main` if unavailable.
3. Compute the diff: `git diff {defaultBranch}...HEAD --stat` for a summary, then `git diff {defaultBranch}...HEAD` for the full diff.
4. Parse the diff summary: files changed, lines added/removed, file types affected.
5. Identify affected areas from the file paths (e.g., `src/routes/` → API, `src/components/` → UI, `tests/` → testing).

#### 1b. Find Associated PR and Issues

1. Search for an open PR on this branch: `gh pr list --head {branch} --state open --json number,title,body,url --limit 1`.
2. If a PR exists:
   - Read the PR body.
   - Extract linked issues from `Closes #N`, `Fixes #N`, `Relates to #N` references.
   - For each linked issue: `gh issue view {N} --json title,body,labels` to read acceptance criteria and labels.
3. If no PR exists: note this and work from the branch diff alone.

#### 1c. Load Project Rules

Read all `scope: always` rules from `.agents/rules/`. These must be included in every sub-agent prompt in Step 6.

#### 1d. Consult Learnings

If `.agents/learnings/` exists, scan for learnings with matching areas or tags that overlap with the affected areas from Step 1a.5. Cache relevant learnings for Step 6.

---

### Step 2: Present Context and Validate

Present a reconstruction summary to the user:

```
Revision Context:
  Branch: {branch}
  PR: #{N} — {title} ({url}) | No PR found
  Linked issues: #{N} — {title} (×{count}) | None
  Diff: {files_changed} files changed (+{additions} / -{deletions})
  Areas: {area_list}
  Acceptance criteria: {found / not found}
```

**ASK:** "Is this the work you want to revise? Any additional context I should know about? (yes / provide context / wrong branch)"

If the user provides additional context (e.g., a different issue number, clarifications, or scope adjustments), incorporate it before proceeding.

---

### Step 3: User Feedback Interview

Structured dialog to collect all user feedback. This is the core of the revision command -- the user tested the implementation and the agent extracts their findings through targeted questions.

#### 3a. General Feedback

**ASK:** "What did you test and what did you find? Tell me everything -- bugs, missing features, visual issues, rough edges, or anything that needs attention. If the implementation is clean and you just want a general cleanup, say 'cleanup only'."

#### 3b. Follow-Up Questions (Adaptive)

Based on the user's initial response and the diff scope, ask targeted follow-up questions. Select from the relevant categories:

**If UI changes detected** (components, styles, templates in diff):
- "Any visual mismatches -- spacing, alignment, colors, typography?"
- "Does it behave correctly at different viewport sizes?"
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

4. **Flag for triage.** The `Critical-deferred` tag ensures board-fill surfaces this item with elevated visibility during the next triage cycle. Board-fill should treat `Critical-deferred` items as priority:p0 candidates regardless of other signals.

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

3. Cache the deferred findings list for use in Steps 8 and 9.

If no findings are routed to [DEFER] (including the "fix all" shortcut), skip this sub-step entirely.

---

### Step 6: Fix Implementation (Sub-Agent Delegation)

Delegate [FIX NOW] findings to specialist sub-agents via the Task tool. Group findings by specialist and parallelize where possible. [DEFER] findings have been appended to `todo.md` in Step 5c and are excluded from this step.

If all findings were deferred (no [FIX NOW] items), skip Step 6 entirely and proceed to Step 7.

#### 6a. Group Findings by Specialist

| Finding Category | Sub-Agent | Protocol |
|-----------------|-----------|----------|
| Bugs, missing features, error handling, logic fixes | `hatch3r-implementer` | hatch3r-implementer agent protocol |
| Dead code, unused imports, type fixes, lint errors | `hatch3r-lint-fixer` | hatch3r-lint-fixer agent protocol |
| Missing tests, insufficient coverage | `hatch3r-test-writer` | hatch3r-test-writer agent protocol |

If findings span multiple independent areas, spawn one `hatch3r-implementer` per area to parallelize.

#### 6b. Spawn Sub-Agents

Use the Task tool with `subagent_type: "generalPurpose"`. Launch as many independent sub-agents in parallel as the platform supports.

Each sub-agent prompt MUST include:
- The specific findings to address (file paths, line numbers, descriptions, expected behavior).
- Instruction to follow the corresponding agent protocol (e.g., "Follow the hatch3r-implementer agent protocol").
- All `scope: always` rule directives from `.agents/rules/` -- sub-agents do not inherit rules automatically.
- Acceptance criteria from linked issues (if available from Step 1b).
- Relevant learnings from `.agents/learnings/` (if found in Step 1d).
- Explicit instruction: do NOT create branches, commits, or PRs.
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

#### 6c. Await and Integrate Results

1. Await all sub-agents. Collect their structured results (files changed, tests written, issues encountered).
2. If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, provide guidance, fix manually).
3. If sub-agents modified overlapping files, review for conflicts and resolve.
4. Apply all changes to the working tree.

---

### Step 7: Quality Verification

Run the project's quality checks. Refer to `package.json` scripts, `README.md`, or `AGENTS.md` for the appropriate commands.

#### 7a. Run Quality Gates

1. Lint check (e.g., `npm run lint`)
2. Type check (e.g., `npm run typecheck`)
3. Test suite (e.g., `npm run test`)

#### 7b. Verify User-Reported Issues

Walk through each critical and important finding from Step 5. Verify it is addressed by the changes made in Step 6. If acceptance criteria exist from linked issues, verify each criterion.

For each verified finding and acceptance criterion, rate verification confidence: high (fix confirmed via tests or direct observation), medium (code change addresses the issue but edge cases not independently tested), low (fix applied but uncertain of completeness).

#### 7c. Review Loop

Run an iterative review loop (max 3 iterations) until 0 Critical + 0 Warning findings remain:

1. Spawn `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The reviewer prompt MUST include:
- The diff of all changes made (use `git diff` on the working tree).
- All `scope: always` rule directives from `.agents/rules/`.
- Iteration number and previous findings (if not the first iteration).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

2. Process reviewer output:
   - If **0 Critical and 0 Warning** findings: review loop is clean. Proceed to Step 7d.
   - If Critical or Warning findings remain: spawn `hatch3r-fixer` sub-agent to address them, then re-run the reviewer (next iteration).

3. If 3 iterations complete and findings remain, **ASK** the user whether to proceed or fix manually.

After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings.

4. After any fixes, re-run quality gates (Step 7a) to verify nothing broke.

#### 7d. Final Quality

After the review loop is clean, spawn both agents in parallel via the Task tool:

1. `hatch3r-test-writer` — write or update tests for code changes.
2. `hatch3r-security-auditor` — security review of code changes.

Both prompts MUST include:
- The diff of all changes made.
- All `scope: always` rule directives from `.agents/rules/`.
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Apply any resulting changes (new tests, security fixes). Re-run quality gates (Step 7a) if changes were made.

#### 7e. Handle Failures

- If quality checks fail: identify the specific failures, fix them directly (for simple issues) or loop back to Step 6 with specific failures.
- Max 2 retry loops on quality check failures. After 2 retries, **ASK** the user for guidance: "Quality checks still failing. Fix confidence: {high/medium/low — based on whether root cause is identified}."
- If a user-reported issue was not fully addressed: **ASK** the user whether to attempt another fix or defer.

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

#### 9b. Present Assessment

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
   - Create learning files in `.agents/learnings/` following the `hatch3r-learn` command format.
   - Use category `pitfall` for issues agents commonly miss.
   - Use category `pattern` for revision approaches that worked well.
   - Tag with relevant area labels.

3. If no significant learnings: skip silently. Not every revision produces learnings.

---

## Error Handling

- **Git diff failure**: If `git diff` fails (e.g., no commits on branch, detached HEAD), **ASK** the user for the correct branch or base ref.
- **No changes detected**: If the diff is empty, inform the user and exit. There is nothing to revise.
- **PR/issue fetch failure**: Proceed without PR/issue context. Work from the diff alone. Warn the user that acceptance criteria are unavailable.
- **Sub-agent failure**: Retry once. If the retry fails, fall back to direct implementation for that finding.
- **Quality check failure after 2 retries**: Present the specific failures and **ASK** the user whether to proceed with a partial fix commit or continue debugging.
- **Push failure**: Present the error. Common fixes: `git push -u origin {branch}` for new branches, `git pull --rebase` for diverged branches.
- **Context degradation (>25 turns)**: Suggest starting a fresh chat with a progress summary. The revision command is designed for fresh contexts -- it can be re-run.

## Guardrails

- **Never skip ASK checkpoints.** Every significant decision requires user confirmation.
- **Never skip the proactive scan (Step 4)** -- even if the user reports no issues. Agents leave leftovers.
- **Always run quality checks (Step 7)** before committing. Never commit code that fails lint, typecheck, or tests.
- **Stay within the revision scope.** Fix what was reported and what the scan found. Do not refactor unrelated code, add new features, or expand beyond the original implementation's intent.
- **Always commit and push** at the end of a revision cycle. The user invoked this command to get fixes merged -- do not exit without committing (unless the user explicitly abandons).
- **Respect the original implementation's architecture.** Revision fixes issues within the existing patterns. If the architecture itself is flawed, note it as a finding but do not restructure -- suggest a separate refactor instead.
- **One sub-agent per concern.** Delegate to specialist sub-agents based on finding type. Do not ask the implementer to also fix lint issues or write tests.
- **Git safety.** Never force-push. Never rewrite history. Always create new commits for revision changes.
- **This command composes existing hatch3r agents** -- it does not replace them. The reviewer, implementer, lint-fixer, and test-writer agents handle the actual work.
- **Critical findings default to FIX NOW.** If the user overrides this, execute the Critical Deferral Protocol (Step 5b): structured warning with specific risk, require written rationale, record in todo.md with `Critical-deferred` tag, and flag for elevated triage in board-fill. The user is never blocked — rationale adds accountability, not a veto.
- **Deferred findings go to `todo.md`, not directly to GitHub issues.** The board-fill pipeline handles triage, epic creation, dependency analysis, and readiness assessment. Revision does not shortcut this process.
- **Always format deferred items as a single epic block** in `todo.md`, regardless of count. This ensures board-fill groups them together during the next run.
