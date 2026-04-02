---
id: hatch3r-board-pickup-azure-devops
type: command
description: Azure DevOps-specific platform procedures for board-pickup. Covers az CLI commands for work item listing, status updates, collision detection, PR creation, and state transitions.
tags: [board, team, azure-devops]
quality_charter: agents/shared/quality-charter.md
---
# Board Pickup — Azure DevOps Platform Details

Platform-specific procedures for Azure DevOps. Referenced from `hatch3r-board-pickup`.

---

## Step 1a: Fetch and Parse Board State — Azure DevOps

**Fetch all open work items:**
1. `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT [System.Id], [System.Title], [System.State], [System.Tags] FROM WorkItems WHERE [System.State] <> 'Closed' AND [System.State] <> 'Removed'"` (fall back to `list_work_items` MCP).

**Check sub-issues per work item:**
- `az boards work-item relation list --id N`.

**Fetch tags:**
- Extract from `System.Tags` field.

---

## Step 3: Collision Detection — Azure DevOps

**In-progress work items:**
- `az boards query --wiql "SELECT ... WHERE [System.State] = 'Active' AND [System.Tags] CONTAINS 'status:in-progress'"`.

**Open PRs:**
- `az repos pr list --org https://dev.azure.com/{namespace} --project {project} --status active`.

**Abandoned PRs for selected work item (abandoned work detection):**
- `az repos pr list --org https://dev.azure.com/{namespace} --project {project} --status abandoned` — check if any abandoned PRs are linked to this work item.
- If found: Surface to the user: "Note: PR #{M} was abandoned for work item #{N}. The previous work may be partially relevant. Options: (a) review the abandoned PR branch, (b) start fresh, (c) pick a different work item."

---

## Step 4: Update Issue Status — Azure DevOps

**Update work item state and tags:**
- `az boards work-item update --id N --state "Active"` and update tags to include `status:in-progress`.

**Sync board status:**
Follow the **Azure Boards Work Item State Sync** from `commands/board/shared-azure-devops.md` for each work item marked `status:in-progress` (including parent epic). Set state to "Active".

---

## Step 8: Create Pull Request — Azure DevOps

**PR template:** Check `.azuredevops/pull_request_template.md`.

**Create PR:**
`az repos pr create --org https://dev.azure.com/{namespace} --project {project} --source-branch {branch} --target-branch {base} --title "..." --description "..."` (fall back to `create_pull_request` MCP).

`{base}` = `board.defaultBranch` from `.agents/hatch.json` (fallback: `"main"`).

**Link PR to epic:**
`az boards work-item relation add --id {epic_id} --relation-type "ArtifactLink" --target-id {pr_id}` or link via PR description.

**Verify PR body linkage:**
Read back the created PR description and verify it contains `Closes #N` for every work item addressed. If any reference is missing:
`az repos pr update --id {pr_number} --description "..."`.

---

## Step 8a: Post-PR Label Transition — Azure DevOps

**Transition to `status:in-review`:**
`az boards work-item update --id N --state "Resolved"` and update tags to include `status:in-review`.

**Sync Board:**
Follow the full **Azure Boards Work Item State Sync** from `commands/board/shared-azure-devops.md` for:
- Each `Closes #N` work item: Set state to "Resolved".
- Parent epic (all sub-issues addressed): Set state to "Resolved".
- Parent epic (partial): Verify state is "Active"; set it if not.

---

## Error Handling — Azure DevOps

- **Work item listing failure** (`az boards query`): retry once, then ask user for work item ID.
- **Work item update failure** (`az boards work-item update`): warn and continue (tags not blocking).
- **PR creation failure** (`az repos pr create`): present error and manual instructions.
