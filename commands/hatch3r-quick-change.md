---
id: hatch3r-quick-change
type: command
description: Lightweight command for small changes not worth tracking on the board. Adaptive ceremony with inline or sub-agent implementation, batch support, and soft scope guards.
---

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Scale Assessment | Orchestrator (inline) | No | Yes |
| 2. Implementation | `hatch3r-implementer` (nontrivial items) | Per item | Nontrivial only |
| 3. Lint Fix | `hatch3r-lint-fixer` | No | When lint/type errors |
| 4a. Review Loop | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | Nontrivial only |
| 4b. Final Quality | `hatch3r-test-writer` + `hatch3r-security-auditor` | Yes | Nontrivial code changes |

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
- Full review pipeline (security-auditor, test-writer, docs-writer)
- Learnings capture

It retains:
- Quality checks (lint, typecheck, test) -- always mandatory
- Adaptive sub-agent delegation (implementer for nontrivial items)
- Light code review (reviewer for nontrivial items only)
- `scope: always` rules from `.agents/rules/`
- Soft scope guards to prevent misuse

---

## Global Rule Overrides

- **Git commands are fully permitted** during Step 7 (Git Action), including `git add`, `git commit`, and `git push`.

## Token-Saving Directives

1. **No shared context loading.** Do NOT read `hatch3r-board-shared`. Do NOT fetch GitHub issues or PRs.
2. **No researcher sub-agent.** Context gathering is the user's responsibility for quick changes.
3. **Targeted file reads only.** Read only files directly relevant to the described change(s).
4. **No learnings capture.** Quick changes are too small to produce meaningful learnings.
5. **Minimal rule loading.** Load `scope: always` rules only when spawning sub-agents in Steps 4b or 6.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Input and Batch Parsing

Parse the user's description into discrete change items.

1. Extract each distinct change from the user's message. A single description may contain multiple changes (e.g., "rename this constant, fix that typo, and update the config default").
2. For each change item, record:
   - **Description**: what needs to change
   - **Type**: fix / tweak / refactor / config / docs
   - **Affected area**: inferred file paths or directories
3. If the user describes a single change, treat it as a batch of one.

---

### Step 2: Scale Assessment (Soft Guard)

Evaluate whether the described changes fit the quick-change scope.

#### 2a. Estimate Scope

For each change item, estimate:
- Number of files affected
- Approximate lines changed
- Whether it touches security-sensitive areas (auth, payments, database schemas, access control)
- Whether it introduces new dependencies or modules

Aggregate across the batch for total estimated scope.

#### 2b. Apply Soft Guard

**Threshold triggers** (any one is sufficient):
- Estimated total exceeds **5 files**
- Estimated total exceeds **~200 lines changed**
- Changes touch security-sensitive areas
- Changes require new dependencies or architectural decisions

If a threshold is triggered:

**ASK:** "This looks larger than a quick change: {reason}. Options: (a) proceed anyway, (b) switch to `hatch3r-workflow` for proper ceremony, (c) narrow the scope."

If no threshold is triggered, present the change list:

```
Quick Change Scope:
  Items: {N}
  1. {description} — {type} — {affected area}
  2. ...
  Estimated scope: {N} files, ~{N} lines
```

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

1. Read `scope: always` rules from `.agents/rules/`.
2. Spawn a `hatch3r-implementer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The implementer prompt MUST include:
- The change description and affected files.
- All `scope: always` rule directives.
- Explicit instruction: do NOT create branches, commits, or PRs.
- Explicit instruction: no researcher context is available; work from the change description and codebase alone.

If multiple nontrivial items affect **independent areas** (no shared files), spawn one implementer per area and run them in parallel.

If multiple nontrivial items affect **overlapping files**, process them sequentially through a single implementer to avoid conflicts.

3. Await the implementer result. If the implementer reports BLOCKED, **ASK** the user for guidance.

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

**ASK:** "Quality checks still failing after 2 fix attempts: {specific failures}. Options: (a) I'll fix manually, commit what we have, (b) keep trying, (c) abort changes."

---

### Step 6: Review and Final Quality (Nontrivial Items Only)

Skip this step entirely if ALL items were classified as trivial in Step 3.

#### 6a. Review Loop

For nontrivial items, run an iterative review loop (max 3 iterations) until 0 Critical + 0 Warning findings remain:

1. Spawn `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The reviewer prompt MUST include:
- The diff of all changes made (use `git diff` on the working tree).
- Focus areas: **correctness and code quality only**. Skip security deep-dive, performance profiling, and documentation review.
- All `scope: always` rule directives from `.agents/rules/`.
- Iteration number and previous findings (if not the first iteration).

2. Process reviewer output:
   - If **0 Critical and 0 Warning** findings: review loop is clean. Proceed to Step 6b.
   - If Critical or Warning findings remain: spawn `hatch3r-fixer` sub-agent to address them, then re-run the reviewer (next iteration).
   - **Suggestions**: skip. The point of quick-change is speed.

3. If 3 iterations complete and findings remain, **ASK** the user whether to proceed or fix manually.

4. After any fixes, re-run quality checks (Step 5a) to verify nothing broke.

#### 6b. Final Quality

After the review loop is clean, spawn both agents in parallel via the Task tool:

1. `hatch3r-test-writer` — write or update tests for nontrivial code changes.
2. `hatch3r-security-auditor` — lightweight security review of nontrivial code changes.

Both prompts MUST include:
- The diff of all changes made.
- All `scope: always` rule directives from `.agents/rules/`.

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
```

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
