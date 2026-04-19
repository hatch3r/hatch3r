---
id: hatch3r-revision-board-integration
type: command
description: Board integration for revision. Covers run cache schema, post-commit PR updates, dashboard refresh (Step 9a), and lightweight reconciliation (Step 9b).
tags: [implementation, team]
quality_charter: agents/shared/quality-charter.md
---
# Revision — Board Integration

Board integration protocols for `hatch3r-revision`. Referenced from the core command file. All board integration steps are conditional — they execute only when board context exists (PR with linked issues found in Step 1b). When no board context exists, skip all steps in this file silently.

---

## Run Cache

Initialize at the start of the revision workflow (before Step 1). Maintain throughout the run:

| Key | Type | Description |
|-----|------|-------------|
| `diff_cache` | `string` | Cached diff from Step 1 (reused per token-saving directives) |
| `findings` | `Map<id, {description, severity, route, status}>` | All findings with triage routing and fix status |
| `fixed_findings` | `id[]` | Finding IDs resolved in this run |
| `deferred_findings` | `id[]` | Finding IDs written to todo.md |
| `quality_agents` | `{agent, status, findings_count}[]` | Specialist agents spawned and their results |
| `pr_updated` | `boolean` | Whether PR description was updated with revision summary |
| `errors` | `{step, message, recoverable}[]` | All errors encountered during the run |

---

## Post-Commit Board Integration (After Step 8)

After committing and pushing revision changes, update the PR if board context exists:

1. **Update PR description** with a revision summary appended to the existing body:

   ```markdown
   ---
   ## Revision Summary ({date})
   
   **Fixed ({N}):**
   - {finding description} ({severity})
   - ...
   
   **Deferred to todo.md ({M}):**
   - {finding description} ({severity})
   - ...
   
   **Quality agents:** {list of agents spawned}
   **Overall confidence:** {high/medium/low}
   ```

2. Do NOT change issue status labels. Revision does not alter the issue lifecycle — the original PR's `Closes #N` references handle that on merge.

3. Do NOT modify `Closes #N` / `Relates to #N` references in the PR body. The original references from board-pickup are authoritative.

---

## Step 9a: Refresh Board Dashboard

**This step is mandatory when board context exists. Skip silently when no board context.**

If a `meta:board-overview` issue exists on the board, refresh it now using cached board data. Use the same procedure as `hatch3r-board-pickup` Step 9a: update with current board state reflecting any changes from this revision session.

Do NOT re-fetch all issues. Use cached data from Step 1 combined with mutations from this run (findings fixed, PR updated). Skip silently if no `meta:board-overview` issue exists.

---

## Step 9b: Lightweight Reconciliation

**This step is mandatory when board context exists. Skip silently when no board context.**

Run a focused reconciliation (not the full board-shared reconciliation procedure, since revision does not create or update issues):

1. **PR body integrity:** Verify the PR body still contains correct `Closes #N` references for all linked issues after the revision summary was appended. If any references were accidentally removed or corrupted, restore them.

2. **Deferred findings integrity:** If findings were deferred in Step 5c, verify they are written to `todo.md` with correct severity tags and epic grouping format. Report any write failures.

3. **Orphaned status check:** For each issue linked to this PR, verify the issue still has `status:in-review` label. If any issue has drifted to a different status (e.g., manually changed during the revision session), warn the user.

Output a reconciliation report:

```
Reconciliation:
  PR body: {ok / {N} references restored}
  Deferred findings: {ok / {N} write failures}
  Issue status: {ok / {N} status drift warnings}
```
