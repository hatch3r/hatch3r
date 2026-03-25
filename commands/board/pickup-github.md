---
id: hatch3r-board-pickup-github
type: command
description: GitHub-specific platform procedures for board-pickup. Covers gh CLI commands for issue listing, status updates, collision detection, PR creation, and label transitions.
tags: [board, team, github]
---
# Board Pickup — GitHub Platform Details

Platform-specific procedures for GitHub. Referenced from `hatch3r-board-pickup`.

---

## Step 1a: Fetch and Parse Board State — GitHub

**Fetch all open issues:**
1. `gh issue list -R {owner}/{repo} --state open --limit 500 --json number,title,labels,state,createdAt,updatedAt,body` (fall back to `list_issues` MCP). Paginate to get all.

**Check sub-issues per issue:**
- `issue_read` with `method: get_sub_issues`.

**Fetch labels:**
- `issue_read` with `method: get_labels`.

---

## Step 3: Collision Detection — GitHub

**In-progress issues:**
- `gh issue list -R {owner}/{repo} --label "status:in-progress" --state open` (fall back to `search_issues` MCP).

**Open PRs:**
- `gh pr list -R {owner}/{repo} --state open` (fall back to `search_pull_requests` MCP).

**Closed PRs for selected issue (abandoned work detection):**
- `gh pr list -R {owner}/{repo} --state closed --search "closes #{N}"` — check if any recently closed (not merged) PRs reference this issue.
- If found: Surface to the user: "Note: PR #{M} was closed without merge for issue #{N}. The previous work may be partially relevant. Options: (a) review the closed PR branch, (b) start fresh, (c) pick a different issue."

---

## Step 4: Update Issue Status — GitHub

**Update status labels:**
- `gh issue edit N --remove-label "status:ready" --add-label "status:in-progress"` (fall back to `issue_write` MCP).

**Sync board status:**
Follow the **GitHub Projects V2 Sync** from `commands/board/shared-github.md` for each issue marked `status:in-progress` (including parent epic). Set status to "In Progress".

---

## Step 8: Create Pull Request — GitHub

**PR template:** Check `.github/PULL_REQUEST_TEMPLATE.md`.

**Create PR:**
`gh pr create -R {owner}/{repo} --head {branch} --base {base} --title "..." --body "..."` (fall back to `create_pull_request` MCP).

`{base}` = `board.defaultBranch` from `.agents/hatch.json` (fallback: `"main"`).

**Link PR to epic:**
`gh issue comment {epic} -R {owner}/{repo} --body "PR: #{pr_number}"` (fall back to `add_issue_comment` MCP).

**Verify PR body linkage:**
Read back the created PR body and verify it contains `Closes #N` for every issue addressed. If any `Closes #N` reference is missing:
`gh pr edit {pr_number} -R {owner}/{repo} --body "..."`.

---

## Step 8a: Post-PR Label Transition — GitHub

**Transition labels to `status:in-review`:**
`gh issue edit N --remove-label "status:in-progress" --add-label "status:in-review"`.

**Sync Board:**
Follow the full **GitHub Projects V2 Sync** from `commands/board/shared-github.md` for:
- The PR: Set to "In Review" on the board.
- Each `Closes #N` issue: Set to "In Review".
- Parent epic (all sub-issues addressed): Set to "In Review".
- Parent epic (partial): Verify status is "In Progress"; set it if not.

---

## Error Handling — GitHub

- **Issue listing failure** (`list_issues`): retry once, then ask user for issue number.
- **Issue update failure** (`issue_write`): warn and continue (labels not blocking).
- **PR creation failure** (`create_pull_request`): present error and manual instructions.
