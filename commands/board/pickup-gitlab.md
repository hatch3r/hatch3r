---
id: hatch3r-board-pickup-gitlab
type: command
description: GitLab-specific platform procedures for board-pickup. Covers glab CLI commands for issue listing, status updates, collision detection, MR creation, and label transitions.
tags: [board, team, gitlab]
---
# Board Pickup — GitLab Platform Details

Platform-specific procedures for GitLab. Referenced from `hatch3r-board-pickup`.

---

## Step 1a: Fetch and Parse Board State — GitLab

**Fetch all open issues:**
1. `glab issue list -R {namespace}/{project} --state opened --per-page 100`. Paginate to get all.

**Check sub-issues per issue:**
- `glab api projects/{project_id}/issues/{N}/links`.

**Fetch labels:**
- Extract from issue data.

---

## Step 3: Collision Detection — GitLab

**In-progress issues:**
- `glab issue list -R {namespace}/{project} --label "status::in-progress" --state opened`.

**Open MRs:**
- `glab mr list -R {namespace}/{project} --state opened`.

---

## Step 4: Update Issue Status — GitLab

**Update status labels:**
- `glab issue update N --unlabel "status::ready" --label "status::in-progress"`.

**Sync board status:**
Follow the **GitLab Board Label-Based Sync** from `commands/board/shared-gitlab.md` for each issue marked `status:in-progress` (including parent epic). Set label to `status::in-progress`.

---

## Step 8: Create Merge Request — GitLab

**MR template:** Check `.gitlab/merge_request_templates/`.

**Create MR:**
`glab mr create -R {namespace}/{project} --source-branch {branch} --target-branch {base} --title "..." --description "..."`. Use `Closes #N` syntax in the description for auto-close on merge.

`{base}` = `board.defaultBranch` from `.agents/hatch.json` (fallback: `"main"`).

**Link MR to epic:**
Reference the epic issue number in the MR description. GitLab auto-links MRs to issues mentioned with `Closes #N`.

**Verify MR body linkage:**
Read back the created MR description and verify it contains `Closes #N` for every issue addressed. If any reference is missing:
`glab mr update {mr_number} -R {namespace}/{project} --description "..."`.

---

## Step 8a: Post-MR Label Transition — GitLab

**Transition labels to `status:in-review`:**
`glab issue update N --unlabel "status::in-progress" --label "status::in-review"`.

**Sync Board:**
Follow the full **GitLab Board Label-Based Sync** from `commands/board/shared-gitlab.md` for:
- Each `Closes #N` issue: Set label to `status::in-review`.
- Parent epic (all sub-issues addressed): Set label to `status::in-review`.
- Parent epic (partial): Verify label is `status::in-progress`; set it if not.

---

## Error Handling — GitLab

- **Issue listing failure** (`glab issue list`): retry once, then ask user for issue number.
- **Issue update failure** (`glab issue update`): warn and continue (labels not blocking).
- **MR creation failure** (`glab mr create`): present error and manual instructions.
