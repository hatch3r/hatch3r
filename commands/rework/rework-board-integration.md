---
id: hatch3r-rework-board-integration
type: command
description: Board integration for rework. Covers run cache schema, the post-plan PR note (Step 8a), dashboard refresh (Step 8b), and lightweight reconciliation (Step 8c).
tags: [planning, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Rework — Board Integration

Board integration protocols for `hatch3r-rework`. Referenced from the core command file. All board integration steps are conditional — they execute only when board context exists (PR with linked issues found in Step 1b). When no board context exists, skip all steps in this file silently.

---

## Run Cache

Initialize at the start of the rework workflow (before Step 1). Maintain throughout the run:

| Key | Type | Description |
|-----|------|-------------|
| `diff_cache` | `string` | Cached diff from Step 1 (reused per token-saving directives) |
| `findings` | `Map<id, {description, severity, route, status}>` | All findings with triage routing and validation status |
| `validated_findings` | `id[]` | Finding IDs confirmed by the Step 6a validation pass |
| `deferred_findings` | `id[]` | Finding IDs written to todo.md |
| `quality_agents` | `{agent, status, findings_count}[]` | Validation agents spawned (researcher, reviewer) and their results |
| `plan_path` | `string \| null` | Path of the rework plan written in Step 7 (`docs/rework/{YYYY-MM-DD}-{branch-slug}.md`), or null before the write / in `--review-only` |
| `errors` | `{step, message, recoverable}[]` | All errors encountered during the run |

---

## Step 8a: Post the Plan Note

After the Step 7 plan write, when board context exists, post or update ONE PR note (comment, or an appended PR-body section when the platform lacks stable comments):

```markdown
Rework plan: {plan_path} ({N} findings, {M} deferred)
```

Optionally follow the line with the plan's Implementation Order list so reviewers see the intended sequence. On a re-run, update the existing note rather than stacking duplicates (match on the `Rework plan:` prefix).

1. Do NOT change issue status labels. Rework does not alter the issue lifecycle — the original PR's `Closes #N` references handle that on merge.

2. Do NOT modify `Closes #N` / `Relates to #N` references in the PR body. The original references from board-pickup are authoritative.

3. Do NOT commit or push anything. The plan document stays uncommitted in the working tree; the execution session commits it together with the fixes.

---

## Step 8b: Refresh Board Dashboard

**This step is mandatory when board context exists. Skip silently when no board context.**

If a `meta:board-overview` issue exists on the board, refresh it now using cached board data. Use the same procedure as `hatch3r-board-pickup` Step 9a: update with current board state reflecting any changes from this rework session (deferred findings queued for board-fill, plan note posted).

Do NOT re-fetch all issues. Use cached data from Step 1 combined with mutations from this run (plan note, todo.md deferrals). Skip silently if no `meta:board-overview` issue exists.

---

## Step 8c: Lightweight Reconciliation

**This step is mandatory when board context exists. Skip silently when no board context.**

Run a focused reconciliation (not the full board-shared reconciliation procedure, since rework does not create or update issues):

1. **PR body integrity:** Verify the PR body still contains correct `Closes #N` references for all linked issues after the plan note was posted. If any references were accidentally removed or corrupted, restore them.

2. **Deferred findings integrity:** If findings were deferred in Step 5c, verify they are written to `todo.md` with correct severity tags and epic grouping format. Report any write failures.

3. **Plan note integrity:** Verify the `Rework plan:` note names the path the run cache holds in `plan_path` and the counts match the findings table. Correct the note if it drifted.

4. **Orphaned status check:** For each issue linked to this PR, verify the issue still has `status:in-review` label. If any issue has drifted to a different status (e.g., manually changed during the rework session), warn the user.

Output a reconciliation report:

```
Reconciliation:
  PR body: {ok / {N} references restored}
  Deferred findings: {ok / {N} write failures}
  Plan note: {ok / corrected}
  Issue status: {ok / {N} status drift warnings}
```
