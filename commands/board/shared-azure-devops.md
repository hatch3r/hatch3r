---
id: hatch3r-board-shared-azure-devops
type: shared-context
description: Azure DevOps-specific platform details for board shared context. Covers Work Items, Azure Boards, az CLI, and MCP tools.
tags: [board, team, azure-devops]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Shared Reference — Azure DevOps Platform Details

Platform-specific procedures for Azure DevOps. Referenced from `hatch3r-board-shared`.

---

## Platform Detection — Azure DevOps

Use `az devops` / `az boards` / `az repos` CLI. Issues = Work Items. PRs = Pull Requests. Board = Azure Boards. Requires `az login` or `AZURE_DEVOPS_PAT`.

### CLI Command Reference

| Action | Command |
|--------|---------|
| Create work item | `az boards work-item create --org https://dev.azure.com/{namespace} --project {project} --type "User Story" --title "..."` |
| List work items | `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT..."` |
| View work item | `az boards work-item show --org https://dev.azure.com/{namespace} --id N` |
| Update work item | `az boards work-item update --org https://dev.azure.com/{namespace} --id N` |
| Close work item | `az boards work-item update --org https://dev.azure.com/{namespace} --id N --state Closed` |
| Create PR | `az repos pr create --org https://dev.azure.com/{namespace} --project {project}` |
| Add tag | `az boards work-item update --id N --fields "System.Tags=x"` |
| Add comment | `az boards work-item update --id N --discussion "..."` |
| Board sync | Board column = Work Item State |

### MCP Tool Reference

| Action | MCP Tool |
|--------|----------|
| Create work item | `create_work_item` |
| Read work item | `get_work_item` |
| List work items | `list_work_items` |
| Search work items | `search_work_items` |
| Add relation | Work Item parent-child relation |
| Create PR | `create_pull_request` |

### Terminology

| Concept | Azure DevOps Term |
|---------|-------------------|
| Work unit | Work Item |
| Code review | Pull Request (PR) |
| Board | Azure Boards |
| Labels | Tags + Area Paths |
| Project identifier | `project` name |
| Status tracking | Work Item State |

---

## Azure DevOps Context

Derived from `.hatch3r/hatch.json` board config:

- **Organization:** top-level `owner` (maps to Azure DevOps organization name)
- **Project:** top-level `repo` (maps to Azure DevOps project name)
- **Default branch:** `board.defaultBranch` (fallback: `"main"`)
- **Type labels → Work Item Tags:** `board.labels.types` (applied as Tags on work items)
- **Executor labels → Tags:** `board.labels.executors`
- **Status labels → Work Item State:** `board.labels.statuses` (mapped to Work Item State field)
- **Area Paths:** `board.areas` (mapped to Azure DevOps Area Paths)
- **PR template:** Check `.azuredevops/pull_request_template.md` if present.

### Azure DevOps Project Reference (cache for the full run)

- **Organization URL:** `https://dev.azure.com/{namespace}`
- **Project name:** `board.projectNumber` (repurposed as Azure DevOps project name)
- **Work Item States:** `Backlog` → `New`, `Ready` → `Active`, `In Progress` → `Active`, `In Review` → `Resolved`, `Done` → `Closed`

---

## Azure Boards Work Item State Sync

Azure Boards syncs via Work Item State changes. There is no separate "add to board" step -- work items appear on the board automatically based on their State and Area Path.

**Status label → Work Item State mapping:**

| Label                | Work Item State |
| -------------------- | --------------- |
| `status:triage`      | `New`           |
| `status:ready`       | `Active`        |
| `status:in-progress` | `Active`        |
| `status:in-review`   | `Resolved`      |
| `status:blocked`     | `New`           |
| `status:done`        | `Closed`        |

**Known limitation — Ready vs. In Progress granularity:** Both `status:ready` and `status:in-progress` map to the `Active` Work Item State because Azure DevOps built-in process templates (Agile, Scrum, CMMI) do not include a "Ready" state. The distinction is preserved in Work Item Tags (e.g., tag `status:ready` vs. `status:in-progress`), which hatch3r board commands always set alongside the State update. For projects that need board-level distinction:
- **Custom process template:** Add a "Ready" state to the work item type in your Azure DevOps process template. Update the mapping above accordingly.
- **Board column mapping:** Configure Azure Boards to use tag-based swim lanes or column splits to distinguish "Ready" from "In Progress" within the "Active" column.

**Steps for each work item to sync:**

1. **Update Work Item State:** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --state "{state}"` using the label→state mapping above.
2. **Update Area Path (if area labels changed):** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --area-path "{project}\\{area}"`.
3. **Update Tags:** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --fields "System.Tags={comma-separated tags}"`.

**MCP fallback:** If `az` CLI fails, fall back to Azure DevOps MCP `update_work_item` with the corresponding state and field values.

**For PRs:** PRs are managed via `az repos pr update --id {N} --status active|completed`. Board sync for PRs is automatic in Azure DevOps when linked to work items.

**Resilience:** If any call fails, retry once. If it still fails, surface a warning and continue. If `az` CLI and MCP are both unavailable, warn: "Azure Boards sync skipped -- run `az login` or set AZURE_DEVOPS_PAT."

---

## Sub-Issue Linking — Azure DevOps

### Three-Tier Fallback Chain

1. **Primary — CLI relation:**
   `az boards work-item relation add --id {child_id} --relation-type "System.LinkTypes.Hierarchy-Reverse" --target-id {parent_id}`.
   Record link status as `native`.

2. **Fallback 1 — Advisory body-reference:**
   If relation add fails, establish an advisory link via work item descriptions:
   - Read the parent work item description. Append a sub-issue checklist entry: `- [ ] #{child} {title}` to the parent's description via `az boards work-item update --id {epic} --description "..."`.
   - Read the child work item description. Prepend `> Parent: #{epic}` to the child's description via `az boards work-item update --id {child} --description "..."`.
   - Record link status as `advisory`.

3. **Fallback 2 — Comment trace:**
   If both primary and Fallback 1 fail:
   `az boards work-item update --id {epic} --discussion "Sub-issue: #{child} — {title} (linking failed)"`.
   Record link status as `comment-only`.

### Verification

After linking, verify via `az boards work-item relation list --id {epic}` and check parent-child relations.

---

## Board Sync Enforcement — Azure DevOps

1. **Status updates:** Set via `az boards work-item update --state`.
2. **Fallback escalation:** `az boards work-item update` CLI → Azure DevOps MCP → surface error to user. Silent skipping is prohibited.
3. **Board item tracking:** After updating a work item, store the work item ID in the run cache keyed by issue number.

---

## Cross-Cutting Tooling — Azure DevOps CLI-First

**Prerequisites:** `az login` must be completed, or `AZURE_DEVOPS_PAT` environment variable set. Run `az devops configure --defaults organization=https://dev.azure.com/{namespace} project={project}` to set defaults.

| Operation            | Primary (`az` CLI)                                                                             | Fallback (MCP)         |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| List work items      | `az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.State] <> 'Closed'"` | `list_work_items`      |
| Read work item       | `az boards work-item show --id N`                                                              | `get_work_item`        |
| Create work items    | `az boards work-item create --type "User Story" --title "..." --description "..."`             | `create_work_item`     |
| Update work items    | `az boards work-item update --id N --fields "field=value"`                                     | `update_work_item`     |
| Search work items    | `az boards query --wiql "SELECT ... WHERE [System.Title] CONTAINS '...'"` | `search_work_items`    |
| Manage relations     | `az boards work-item relation add --id N --relation-type "System.LinkTypes.Hierarchy-Forward" --target-id M` | Work Item relation API |
| Add comments         | `az boards work-item update --id N --discussion "..."`                                         | N/A                    |
| Create PRs           | `az repos pr create --title "..." --source-branch "..." --target-branch "..."`                 | `create_pull_request`  |
| Read PR details      | `az repos pr show --id N`                                                                      | N/A                    |
| Read PR comment threads | `az rest -m GET --url 'https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{N}/threads?api-version=7.1-preview.1'` | N/A |
| Reply to PR thread   | `az rest -m POST --url '.../pullRequests/{N}/threads/{threadId}/comments?api-version=7.1-preview.1' --body '{"parentCommentId":1,"content":"...","commentType":"text"}'` | N/A |
| Manage tags          | `az boards work-item update --id N --fields "System.Tags=tag1; tag2"`                          | N/A                    |
| Board sync           | Work Item State updates (automatic board placement)                                             | N/A                    |
| CI/Pipelines         | `az pipelines run list` / `az pipelines run show`                                              | N/A                    |
