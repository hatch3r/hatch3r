---
id: hatch3r-board-pickup-post-impl
type: command
description: Post-implementation steps for board-pickup (Steps 7-10). Covers quality verification, commit/push, PR/MR creation, label transitions, board sync, dashboard refresh, reconciliation, and learnings capture.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Pickup — Post-Implementation Steps (7-10)

Post-implementation workflow for `hatch3r-board-pickup`. Referenced from the core command file.

---

## Step 7: Quality Verification

Run the project's quality checks (linting, type checking, tests). Refer to the project's `AGENTS.md`, `README.md`, or `package.json` scripts for the appropriate commands.

Verify: all AC met, tests passing, no lint errors, dead code removed, project-specific invariants respected.

Rate confidence in quality verification per the quality charter §1 verification-method framing (`agents/shared/quality-charter.md`): high (verified against code, tests, or browser), medium (based on established patterns, not independently verified), low (best judgment, recommend additional human review).

---

## Step 7a: Commit & Push

Stage, commit, and push all changes so the branch exists on the remote before PR creation.

**Single issue or epic:**

```bash
git add -A
git commit -m "{type}: {short description} (#{issue})"
git push -u origin {branch-name}
```

- Use the branch type prefix (`feat`, `fix`, `refactor`, `qa`) matching the branch name.
- Reference the issue number in the commit message.
- If `git push` fails (e.g., branch already exists on remote), use `git push` without `-u`.

**Batch mode:** Create one commit covering all issues in the batch.

```bash
git add -A
git commit -m "batch: {short description} (#N, #M, #K)"
git push -u origin {branch-name}
```

- List all issue numbers in the commit message.
- If all issues share a type, use that type prefix instead of `batch`.

---

## Step 8: Create Pull Request / Merge Request

> Platform-specific details: see `commands/board/pickup-github.md` (Step 8)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Step 8)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Step 8)

Follow the project's PR/MR creation skill or conventions:

1. **Title:** `{type}: {short description} (#issue)` — for batch mode: `batch: {short description} (#N, #M, #K)`.
2. **Determine epic link type:** If working on an epic's sub-issues, check whether ALL sub-issues of the parent epic are addressed by this PR/MR (listed as `Closes #N`) or are already closed. If yes → use `Closes #<epic-number>` so the epic auto-closes on merge. If some sub-issues remain open and unaddressed → use `Relates to #<epic-number>`.
3. **Body:** Use the repository's PR/MR template if available (see platform sub-file for template location). Fill: Summary, Type, Changes, Testing, Rollout plan. Include a **Related Issues** section listing:
   - `Closes #N` for each issue addressed by this PR/MR (including all batch issues).
   - `Closes #<epic>` (all sub-issues addressed) OR `Relates to #<epic>` (partial) for the parent epic.
   - Always list both the epic and all sub-issues in the Related Issues section regardless of partial/full completion.
   - **Batch mode:** List `Closes #N` for every issue in the batch. Include a per-issue summary of changes in the body.
4. **Create PR/MR** using the platform CLI (see platform sub-file for exact command).
5. **Link PR/MR to epic** using the platform-specific method (see platform sub-file).
6. **Verify PR body linkage** and auto-fix missing `Closes #N` references (see platform sub-file).

---

## Step 8a: Post-PR/MR Label Transition & Board Sync

> Platform-specific details: see `commands/board/pickup-github.md` (Step 8a)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Step 8a)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Step 8a)

1. **Transition labels to `status:in-review`:** For each `Closes #N` issue (including all batch issues), update status labels using the platform CLI (see platform sub-file). If ALL sub-issues addressed, also transition the parent epic.
2. **Sync Board:** Run the full **Board Sync Procedure** from `hatch3r-board-shared` for each item (see platform sub-file for specific targets).

---

## Step 8b: Merge Readiness (Consolidated Confidence)

**This step is mandatory. Do not skip.** It realizes the Confidence Propagation Contract's merge-readiness requirement (`commands/hatch3r-board-pickup.md` → Confidence Propagation Contract): the PR is the output block the user acts on, so it MUST carry a consolidated confidence verdict — dropping the signal before this surface is a gate failure.

Emit a final `Merge Readiness` block sourced from the LOWEST upstream confidence across the reviewer verdict, `hatch3r-testability`, `hatch3r-security`, and the Step 7 acceptance-criteria checks — parity with `commands/hatch3r-workflow.md` Review Results / Quick Mode Overall Confidence, so board-pickup's terminal surface carries the same signal as the other core orchestrators:

```
Merge Readiness:
  Overall Confidence: {high/medium/low}
  Lowest-confidence area: {description or "none"}
  Review independence: {different-family = provider-independent | same-family or not-declared = self-preference bias possible, clean PASS is not provider-independent}
```

Surface the `Overall Confidence` line into the PR body (append to the Testing or Rollout section from Step 8) so the merge-decision surface itself carries the signal, not only the run transcript.

---

## Step 9: Post-PR Housekeeping

1. If all sub-issues addressed, confirm the PR body uses `Closes #<epic-number>` so the epic will auto-close on merge and transition to Done.
2. Remind user `Closes #N` auto-closes on merge.
3. **Post-merge board state advisory:** After merge, `Closes #N` will auto-close the issue, but label and board status updates to `status:done` / "Done" depend on platform automation:
   - **GitHub:** Automatic IF the Projects V2 "Item closed" workflow is enabled (verify in Project > Workflows). Labels are NOT auto-updated — `status:in-review` remains on the closed issue.
   - **Azure DevOps:** Verify the "Complete linked work items after merging" checkbox is checked during PR completion. State transitions to "Closed" only when this option is selected.
   - **GitLab:** Labels are NOT updated on auto-close. `status::in-review` remains. Consider setting up a CI pipeline trigger on issue close events for automated cleanup.
   - If automation is not configured, `board-groom` with the `health-fix` action will detect and fix the drift during the next grooming session.
4. If partial — present the cumulative epic Completion Ledger line first (per `rules/hatch3r-iteration-summary.md` → Completion Ledger, cumulative form), then ask:

```
sub-issues: done <a> · deferred <b> · blocked <c> (<a>/<N>)
```

**ASK:** "PR created. Epic #X at {a}/{N} sub-issues complete ({b} deferred, {c} blocked). Continue with next sub-issue or stop?"

### 9a. Refresh Board Dashboard

**This step is mandatory. Do not skip.**

If a `meta:board-overview` issue exists on the board, refresh it now using cached board data updated with mutations from Steps 4, 8, and 8a. Include the `Recommended Model` column in all issue listings per the Board Overview section in `hatch3r-board-shared`. Do NOT re-fetch all issues; use cached data. Skip silently if no `meta:board-overview` issue exists.

### 9b. End-of-Run Reconciliation

**This step is mandatory. Do not skip.**

Run the **End-of-Run Reconciliation Procedure** from `hatch3r-board-shared`. This verifies board sync, sub-issue links, label consistency, and PR linkage for all issues modified during this pickup run. Output the reconciliation report before proceeding to Step 10.

### 9c. Terminal-State Verification (after PR merge)

After the PR merges and `Closes #N` auto-closes the referenced issue(s), confirm both sides of the status lifecycle reach their terminal state. Labels and V2 board state must agree.

1. **Label flip.** GitHub does not auto-update issue labels on close. For each auto-closed issue, run:
   ```
   gh issue edit N --remove-label "status:in-review" --add-label "status:done"
   ```
   Record the mutation in the run cache under `updated_issues`.

2. **Board state check.** Read `board.workflows.itemClosedEnabled` from `.hatch3r/hatch.json`:
   - **If true:** The V2 built-in "Item closed" workflow has already set the board status to Done. Skip to step 3.
   - **If false or absent:** The workflow is not enabled (board-init should have halted, but this is a defensive fallback). Apply the full **Board Sync Procedure** from `hatch3r-board-shared` for each issue, target status = Done.

3. **Verify terminal state.** For each issue:
   - `gh issue view N --json labels` returns a label set containing `status:done` and not containing `status:in-review`.
   - `gh project item-list {board.projectNumber} --owner {board.owner} --format json` returns status = Done for this item.
   If either check fails, apply rule 8 of Board Sync Enforcement (retry-then-halt fallback policy) in `hatch3r-board-shared`.

4. **Record outcome.** Append each issue's terminal-state result to the run cache `sync_results` with method = `terminal-verify`.

---

## Step 10: Capture Learnings

After PR creation, capture learnings from this development session.

1. Reflect on the implementation:
   - Were there any unexpected challenges or blockers?
   - Did any patterns or approaches work particularly well?
   - Were there decisions made that future developers should know about?
   - Were any pitfalls discovered that should be avoided next time?

2. If learnings are identified:
   - Create learning files in `.hatch3r/learnings/` following the learning file format (see `skills/hatch3r-learn/SKILL.md`).
   - Include the issue number as `source-issue`.
   - Tag with relevant area labels from the issue.
   - **ASK:** "Learnings captured: {list}. Anything else to note? (add more / done)"

3. If no significant learnings: skip silently. Not every task produces learnings. Do not prompt in this case.
