---
id: hatch3r-debug
type: command
description: Standalone debug-and-fix workflow — add strategic debug logging, collect runtime logs from the user, perform root cause analysis, implement the fix, and clean up all debug artifacts.
---
# Debug — Instrument, Diagnose, and Fix from Runtime Evidence

Standalone debug-and-fix command that instruments the codebase with strategic debug logging, pauses for the user to reproduce the issue and provide runtime logs, performs root cause analysis from the collected evidence, implements the fix, and removes all debug artifacts. Five-stage workflow: Gather Context → Add Debug Logging → Collect Logs (user checkpoint) → Root Cause Analysis → Implement Fix. Works independently — no board integration, no GitHub issue required.

**When to use this command vs. other bug-related commands:**

- Use `hatch3r-debug` when: the bug is reproducible but the root cause is unclear, you need runtime evidence (log output) to diagnose, or static analysis alone is insufficient.
- Use `hatch3r-bug-plan` when: the bug is complex/ambiguous and needs a structured investigation plan with multiple researchers, phased fix items, and board integration.
- Use `hatch3r-bug-fix` skill directly when: the root cause is already known and the fix is localized.

---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Context | User input | No | Yes |
| 2. Debug Logging | `hatch3r-researcher` → `hatch3r-implementer` | Sequential | Yes |
| 3. Log Collection | User provides logs (ASK checkpoint) | No | Yes |
| 4. Root Cause Analysis | `hatch3r-researcher` (mode: `root-cause`) | No | Yes |
| 5a. Fix | `hatch3r-implementer` | No | Yes |
| 5b. Review Loop | `hatch3r-reviewer` → `hatch3r-fixer` (max 3) | No | Yes |
| 5c. Final Quality | `hatch3r-test-writer` + `hatch3r-security-auditor` | Yes | Yes |

---

## Scope

This command intentionally skips:
- Board context (`hatch3r-board-shared`)
- GitHub issues, PRs, and Projects v2 sync
- Learnings capture
- ADR or investigation report generation
- Documentation updates

It retains:
- Quality checks (lint, typecheck, test) — always mandatory
- Sub-agent delegation for all non-trivial work
- Full review pipeline in Stage 5 (reviewer, test-writer, security-auditor)
- `scope: always` rules from `.agents/rules/`
- Debug artifact cleanup guarantee

---

## Browser Automation

At the start of the command (before Stage 1), ask the user once whether to enable browser verification for this session.

**ASK:** "Enable browser verification for this debug session? If yes, I'll use the browser to verify debug logs appear in Stage 2 and verify the fix works in Stage 5. (yes / no)"

If the user enables browser verification:
- **Stage 2** — after adding debug logging, launch the application in the browser, reproduce the issue, and verify that `[HATCH3R-DEBUG]` log lines appear in the browser console or application output.
- **Stage 5** — after implementing the fix, launch the application in the browser, attempt to reproduce the original issue, and verify it no longer occurs.

If the user declines, skip all browser steps. Do not ask again during the session.

---

## Global Rule Overrides

- **Git commands are fully permitted** during Stage 5 (Implement Fix), including `git add`, `git commit`, and `git push`. This override applies to delegated sub-agents invoked during fix implementation.

## Token-Saving Directives

1. **Do not re-read files already cached.** Once researcher or implementer outputs are collected, reference them in memory — do not re-invoke sub-agents for the same information.
2. **Limit documentation reads.** When reading project files for context, read TOC/headers first (~30 lines), expand only relevant sections.
3. **Structured output only.** All sub-agent prompts require structured markdown output — no prose dumps.
4. **No shared context loading.** Do NOT read `hatch3r-board-shared`. This is a standalone command.
5. **Targeted file reads only.** Read only files in the affected area identified in Stage 1.

---

## Workflow

Execute these stages in order. **Do not skip any stage.** Ask the user at every checkpoint marked with ASK.

### Stage 1: Gather Bug Context

**Goal:** Understand the bug, its symptoms, affected area, and reproduction path before instrumenting anything.

#### 1a. Collect Bug Description

**ASK:** "Tell me about the bug you want to debug. I need:
- **What goes wrong** (symptoms, error messages, unexpected behavior)
- **What should happen** (expected behavior)
- **Affected area** (which feature, module, or page is impacted)
- **Reproduction steps** (how to trigger the bug — actions, inputs, sequence)
- **Environment** (browser, OS, environment, version — if relevant)
- **Frequency** (always reproducible, intermittent, environment-specific)

You can also paste an error log, stack trace, or screenshot description and I'll extract what I need."

#### 1b. Load Project Context

1. Check for existing documentation:
   - `docs/specs/` — project specifications (read TOC/headers first, expand relevant sections only)
   - `README.md` — project overview and setup instructions
   - `AGENTS.md` or `.agents/rules/` — agent rules and project conventions
2. If `.agents/learnings/` exists, scan for learnings relevant to the affected area. Match by area and tags against the bug description.
3. Scan the affected code area — read the primary files involved, trace imports and dependencies one level deep.

**Knowledge hierarchy:** project specs → codebase exploration → Context7 MCP (`resolve-library-id` then `query-docs`) → web research. Exhaust each level before escalating to the next.

#### 1c. Classify Scope and Severity

Evaluate the bug and present a structured summary:

```
Bug Context:
  Summary:          {one-line description}
  Symptoms:         {what goes wrong, from the user's perspective}
  Expected:         {what should happen}
  Affected area:    {modules, files, or features impacted}
  Reproduction:     {steps, frequency, environment}
  Severity:         {Critical/High/Med/Low — with reasoning}
  Scope estimate:   {number of files likely involved}
  Context loaded:   {specs, learnings, rules found}
```

**ASK:** "Does this capture the bug correctly? Adjust anything before I proceed to add debug logging."

---

### Stage 2: Add Debug Logging

**Goal:** Instrument the affected code with strategic debug logging to capture runtime evidence for diagnosis.

#### 2a. Analyze Code for Instrumentation Points (Researcher)

Spawn a `hatch3r-researcher` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The researcher prompt MUST include:
- The confirmed bug context from Stage 1c.
- The affected files and modules identified in Stage 1b.
- Instruction to follow the **hatch3r-researcher agent protocol** with mode `symptom-trace`.
- Instruction to identify specific instrumentation points: decision branches, data flow boundaries, error handlers, state transitions, and external call sites in the affected area.
- All `scope: always` rule directives from `.agents/rules/`.

The researcher must produce a structured list of recommended instrumentation points:

```
Instrumentation Points:
  1. {file}:{line range} — {why: decision branch / data boundary / error path / state transition}
  2. {file}:{line range} — {why}
  ...
```

Await the researcher result before proceeding.

#### 2b. Add Debug Logging (Implementer)

Spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The implementer prompt MUST include:
- The researcher's instrumentation points from Stage 2a.
- The confirmed bug context from Stage 1c.
- All `scope: always` rule directives from `.agents/rules/`.
- Explicit instruction: do NOT create branches, commits, or PRs.

**Debug logging rules** (include these verbatim in the implementer prompt):
- Every debug log line MUST be prefixed with `[HATCH3R-DEBUG]` for easy identification and removal.
- Log the relevant variable values, function arguments, return values, or state at each instrumentation point.
- Use the project's existing logging mechanism (e.g., `console.log`, `logger.debug`, `print`) — do not introduce new logging dependencies.
- Keep debug logs minimal but informative — include the file name and a short description in each log line (e.g., `[HATCH3R-DEBUG] auth/login.ts:validateToken — token payload: {...}`).
- Do NOT modify application logic. Debug logging is observation-only.
- Do NOT add debug logging outside the affected area identified by the researcher.

Await the implementer result.

#### 2c. Verify Instrumentation

1. Collect the list of all files modified and the exact log statements added.
2. Verify no application logic was altered — only log statements were added.
3. Run quality checks (lint, typecheck) to ensure the debug logging does not break the build. Fix any issues.

If browser verification is enabled: launch the application in the browser, reproduce the issue, and verify that `[HATCH3R-DEBUG]` log lines appear in the console or application output.

#### 2d. Present Debug Logging Summary

```
Debug Logging Added:
  Files instrumented: {N}
  Log statements added: {N}
  Locations:
    1. {file}:{line} — {description of what is logged}
    2. {file}:{line} — {description}
    ...
  Build status: {passing / issues fixed}
```

**ASK:** "Debug logging is in place. Here are the instrumented locations. Please:
1. Run the application
2. Reproduce the bug
3. Provide the log output (paste it here, provide a file path, or paste terminal output)

I'll wait for the logs before proceeding."

---

### Stage 3: Collect Logs (ASK Checkpoint)

**Goal:** Receive runtime log output from the user after they reproduce the issue with debug logging active.

This stage is entirely user-driven. **STOP and WAIT** for the user to provide log data.

#### 3a. Accept Log Input

Accept logs in any of these formats:
- **Pasted text**: log output pasted directly into the chat
- **File path**: path to a log file on disk (read the file)
- **Terminal output**: raw terminal output with the debug log lines

#### 3b. Parse and Structure Log Data

1. Extract all lines containing `[HATCH3R-DEBUG]` from the provided log output.
2. Preserve surrounding context lines (non-debug lines immediately before and after each debug line) for flow understanding.
3. Order the debug lines chronologically if timestamps are present.
4. Identify patterns: unexpected values, missing log lines (instrumentation points that should have fired but didn't), error traces, and anomalous state transitions.

Present the structured log analysis:

```
Log Analysis:
  Total log lines received:    {N}
  Debug lines extracted:       {N} (of {M} instrumentation points)
  Missing instrumentation:     {list of expected log points that did not fire}
  Anomalies detected:
    1. {file}:{line} — expected {X}, got {Y}
    2. {file}:{line} — {description of anomaly}
    ...
  Error traces:                {any error stack traces found}
  Execution flow:              {brief narrative of what the logs reveal about the execution path}
```

**ASK:** "Here is the structured log analysis. Does this match what you observed? Provide additional logs or context if needed, or confirm to proceed to root cause analysis."

---

### Stage 4: Root Cause Analysis

**Goal:** Diagnose the root cause from the structured log evidence.

#### 4a. Spawn Root Cause Researcher

Spawn a `hatch3r-researcher` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The researcher prompt MUST include:
- The confirmed bug context from Stage 1c.
- The structured log analysis from Stage 3b (full parsed output).
- The instrumentation point list from Stage 2a (to correlate expected vs. actual behavior).
- Instruction to follow the **hatch3r-researcher agent protocol** with mode `root-cause` and depth `deep`.
- All `scope: always` rule directives from `.agents/rules/`.
- Instruction to produce ranked hypotheses with evidence from the log data.

**Knowledge hierarchy for the researcher:** project specs → codebase → Context7 MCP → web research. Use `gh` CLI (e.g., `gh issue list`, `gh pr list`) for reading GitHub data; prefer `gh` over GitHub MCP tools.

Await the researcher result.

#### 4b. Present Diagnosis

Present the root cause diagnosis from the researcher:

```
Diagnosis Report:
  Root cause:         {description of the identified root cause}
  Confidence:         {High/Med/Low — with reasoning}
  Evidence:
    1. {log line or code reference supporting the diagnosis}
    2. {log line or code reference}
    ...
  Affected components: {list of files/modules involved in the root cause}
  Secondary findings:  {any additional issues discovered during analysis}

  Recommended fix:
    Approach:          {description of the fix}
    Files to modify:   {list}
    Risk:              {Low/Med/High}
```

**ASK:** "Here is the diagnosis. Root cause: {summary}, confidence: {level}. Confirm to proceed with the fix, or adjust the diagnosis."

---

### Stage 5: Implement Fix

**Goal:** Fix the root cause, remove all debug logging, verify quality, and ensure no debug artifacts remain.

#### 5a. Core Fix (Implementer)

Spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The implementer prompt MUST include:
- The confirmed diagnosis from Stage 4b (root cause, evidence, recommended fix approach).
- The full list of files modified in Stage 2b (debug logging locations) for cleanup reference.
- All `scope: always` rule directives from `.agents/rules/`.
- Explicit instruction: do NOT create branches, commits, or PRs.

**Fix implementation rules** (include these verbatim in the implementer prompt):
1. **Fix the root cause** as described in the diagnosis. Follow the recommended approach unless a better alternative is found during implementation — document any deviation.
2. **Remove ALL debug logging** added in Stage 2. Search for every `[HATCH3R-DEBUG]` occurrence across the entire codebase and remove each log statement. Verify zero `[HATCH3R-DEBUG]` occurrences remain after cleanup.
3. **Do not leave debug artifacts.** No commented-out debug lines, no disabled log statements, no leftover imports added solely for debug logging.
4. **Preserve existing logging.** Only remove log statements that contain `[HATCH3R-DEBUG]`. Do not modify or remove pre-existing application logs.

Await the implementer result.

#### 5b. Debug Cleanup Verification

After the implementer completes, independently verify that all debug artifacts are removed:

1. Search the entire codebase for `[HATCH3R-DEBUG]`. If any occurrences remain, remove them.
2. Search for any imports, variables, or utility functions that were added solely to support debug logging. Remove them.
3. Confirm the file count matches expectations — every file instrumented in Stage 2 should either be restored to its pre-debug state (if no fix was needed there) or contain only the fix changes.

#### 5c. Review Loop (Reviewer → Fixer)

Run a review-fix loop, maximum 3 iterations, until the reviewer reports a clean result.

**Each iteration:**

1. Spawn `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

   The reviewer prompt MUST include:
   - The diff of all changes (use `git diff` on the working tree).
   - The original bug context from Stage 1c.
   - The diagnosis from Stage 4b.
   - All `scope: always` rule directives from `.agents/rules/`.
   - Instruction to verify: correctness of the fix, no remaining debug artifacts, code quality, no regressions introduced.

2. If the reviewer reports findings (critical or warning level):
   - Spawn `hatch3r-fixer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`) with the reviewer's findings.
   - The fixer prompt MUST include all `scope: always` rule directives and the specific findings to address.
   - Await the fixer result, then loop back to the reviewer.

3. If the reviewer reports clean (no critical or warning findings), exit the loop.

4. If 3 iterations complete without a clean result:

   **ASK:** "Review loop completed 3 iterations with remaining findings: {summary}. Options: (a) proceed with current state, (b) I'll fix the remaining issues manually, (c) keep iterating."

#### 5d. Final Quality (Parallel)

After the review loop completes clean (or the user proceeds), spawn these two sub-agents **in parallel** via the Task tool (`subagent_type: "generalPurpose"`):

1. **`hatch3r-test-writer`** — write regression tests for the fix. The prompt MUST include:
   - The bug context from Stage 1c (what was broken).
   - The fix diff (what was changed).
   - The root cause from Stage 4b.
   - Instruction to write tests that would have caught this bug — regression tests targeting the specific failure mode.
   - All `scope: always` rule directives from `.agents/rules/`.

2. **`hatch3r-security-auditor`** — security review of the fix. The prompt MUST include:
   - The fix diff.
   - The affected files and data flows.
   - All `scope: always` rule directives from `.agents/rules/`.

Await both sub-agents. Apply any findings (additional tests, security fixes).

#### 5e. Final Quality Checks

Run the project's quality gates:

```bash
npm run lint && npm run typecheck && npm run test
```

Adapt commands to project conventions (check `package.json`, `Makefile`, `README.md`). Fix any failures before proceeding. Max 2 retry loops on quality check failures. After 2 retries:

**ASK:** "Quality checks still failing after 2 fix attempts: {specific failures}. Options: (a) I'll fix manually, (b) keep trying, (c) abort."

If browser verification is enabled: launch the application in the browser, attempt to reproduce the original bug, and verify it no longer occurs.

#### 5f. Present Fix Summary

```
Debug & Fix Complete:
  Root cause:           {one-line summary}
  Confidence:           {level}
  Files modified:       {list — fix changes only, no debug artifacts}
  Debug cleanup:        {N} log statements removed, 0 [HATCH3R-DEBUG] remaining
  Review:               {clean after {N} iterations / user-approved}
  Tests:                {N} regression tests added
  Security:             {clean / findings addressed}
  Quality:              lint {pass/fail}, types {pass/fail}, tests {pass/fail}
```

**ASK:** "Fix complete. All debug logging removed. Quality checks pass. How should I handle git? (a) commit only, (b) commit and push, (c) skip git — leave changes in working tree"

If the user chooses to commit:
- Use commit message format: `fix: {short description of the bug fix}`
- Include a commit body with: root cause summary, affected files, and a note that debug instrumentation was added and removed during diagnosis.

---

## Error Handling

- **Researcher sub-agent failure (Stage 2a or 4a):** Retry the failed sub-agent once. If it fails again, present partial results and ASK the user whether to proceed with manual analysis or abort.
- **Implementer sub-agent failure (Stage 2b or 5a):** Retry once. If the retry fails, fall back to direct implementation and warn the user that the change may be less thorough.
- **Quality check failure after 2 retries:** Present specific failures and ASK the user whether to commit partial progress, keep trying, or abort.
- **User provides insufficient logs (Stage 3):** If the log output contains zero `[HATCH3R-DEBUG]` lines, warn the user that the debug logging may not have been reached during reproduction. Suggest verifying that the correct code path was exercised, then ASK for new logs.
- **No clear root cause (Stage 4):** If all hypotheses are low-confidence, state this clearly. Recommend adding more targeted debug logging (loop back to Stage 2 with refined instrumentation points) or switching to `hatch3r-bug-plan` for a broader investigation. ASK the user how to proceed.
- **Debug artifacts remain after cleanup (Stage 5b):** If `[HATCH3R-DEBUG]` occurrences are found after the implementer's cleanup pass, remove them directly. Do not proceed until zero occurrences remain.
- **Review loop exhaustion (Stage 5c):** After 3 iterations without a clean review, present remaining findings and ASK the user for direction.
- **Context degradation (>20 turns):** Suggest starting a fresh chat with a progress summary capturing the current stage, diagnosis, and remaining work.

## Guardrails

- **Never skip ASK checkpoints.** Every stage with an ASK must pause for user confirmation.
- **All debug logs MUST use the `[HATCH3R-DEBUG]` prefix.** No exceptions. This enables reliable cleanup.
- **All debug logs MUST be removed in Stage 5.** The fix must not ship with any `[HATCH3R-DEBUG]` artifacts. Verify zero occurrences before presenting the fix summary.
- **Debug logging is observation-only.** Stage 2 must not alter application logic, control flow, or state. Only log statements are added.
- **Never auto-commit without ASK.** The user always decides the git action.
- **Stay within the bug scope.** Do not fix unrelated issues discovered during debugging. Note them but do not act without explicit user approval.
- **Use `subagent_type: "generalPurpose"` for all Task tool delegations.** Every sub-agent spawn in this command uses this type.
- **Respect the knowledge hierarchy** for external information: project specs → codebase exploration → Context7 MCP → web research. Exhaust each level before escalating.
- **Prefer `gh` CLI for GitHub reads** (e.g., `gh issue view`, `gh pr list`). Fall back to GitHub MCP tools only if `gh` is unavailable.
- **No board operations.** Never create issues, update project boards, or sync with GitHub Projects. This is a standalone command.
- **Respect `scope: always` rules** when delegating to sub-agents. Sub-agents do not inherit rules automatically — include them in every prompt.
- **This command composes existing hatch3r agents** (researcher, implementer, reviewer, fixer, test-writer, security-auditor) — it does not replace them.
- **Browser verification is opt-in.** Ask once at command start. Never enable browser steps without user consent.
- **Never force a diagnosis.** If the logs are inconclusive, say so. Do not fabricate a root cause to proceed.
