---
id: hatch3r-board-shared-gitlab
type: shared-context
description: GitLab-specific platform details for board shared context. Covers GitLab Issues, Issue Boards, glab CLI, and label-based sync.
tags: [board, team, gitlab]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Shared Reference — GitLab Platform Details

Platform-specific procedures for GitLab. Referenced from `hatch3r-board-shared`.

---

## Platform Detection — GitLab

Use `glab` CLI. Issues = GitLab Issues. PRs = Merge Requests (MRs). Board = GitLab Issue Boards. Requires `glab auth login` or `GITLAB_TOKEN`.

### CLI Command Reference

| Action | Command |
|--------|---------|
| Create issue | `glab issue create -R {namespace}/{project}` |
| List issues | `glab issue list -R {namespace}/{project}` |
| View issue | `glab issue view N -R {namespace}/{project}` |
| Update issue | `glab issue update N -R {namespace}/{project}` |
| Close issue | `glab issue close N -R {namespace}/{project}` |
| Create MR | `glab mr create -R {namespace}/{project}` |
| Add label | `glab issue update N --label "x"` |
| Add comment | `glab issue note N -R {namespace}/{project}` |
| Board sync | Board list = label-based |

### MCP Tool Reference

GitLab MCP tools are not currently available. All operations use the `glab` CLI.

### Terminology

| Concept | GitLab Term |
|---------|-------------|
| Work unit | Issue |
| Code review | Merge Request (MR) |
| Board | GitLab Issue Boards |
| Labels | Labels |
| Project identifier | project ID |
| Status tracking | Board lists/labels |

---

## GitLab Context

Derived from `.hatch3r/hatch.json` board config:

- **Namespace:** top-level `owner` (GitLab group or user namespace)
- **Project:** top-level `repo` (GitLab project name)
- **Default branch:** `board.defaultBranch` (fallback: `"main"`)
- **Type labels:** `board.labels.types`
- **Executor labels:** `board.labels.executors`
- **Status labels:** `board.labels.statuses`
- **Scoped labels:** GitLab supports scoped labels (`status::ready`, `type::bug`). Map hatch3r label format (`status:ready`) to GitLab scoped format (`status::ready`) when creating labels.
- **Issue templates:** Check `.gitlab/issue_templates/` if present.
- **MR template:** Check `.gitlab/merge_request_templates/` if present.

### GitLab Project Reference (cache for the full run)

- **Project path:** `{namespace}/{project}`
- **Board:** GitLab Issue Boards use label-based lists. Each status maps to a board list label.
- **Board ID:** `board.projectNumber` (repurposed as GitLab Board ID if configured)

---

## GitLab Board Label-Based Sync

> **Skip entirely if board is not configured.**

GitLab Boards use labels to organize issues into lists. Board sync is achieved by updating issue labels to match the target status.

**Status label → Board list mapping:**

GitLab board lists are label-based. Each status corresponds to a scoped label:

| Label                | GitLab Scoped Label |
| -------------------- | ------------------- |
| `status:triage`      | `status::triage`    |
| `status:ready`       | `status::ready`     |
| `status:in-progress` | `status::in-progress` |
| `status:in-review`   | `status::in-review` |
| `status:done`        | `status::done`      |
| `status:blocked`     | `status::blocked`   |

**Steps for each issue to sync:**

1. **Update labels:** `glab issue update {N} -R {namespace}/{project} --unlabel "status::*" --label "status::{new-status}"`. GitLab scoped labels auto-replace within the same scope, so setting `status::ready` automatically removes `status::triage`.
2. **Verify:** `glab issue view {N} -R {namespace}/{project}` and confirm labels match.

**For MRs:** `glab mr update {N} -R {namespace}/{project} --label "status::{new-status}"`.

**Resilience:** If any call fails, retry once. If it still fails, surface a warning and continue. If `glab` CLI is unavailable, warn: "GitLab Board sync skipped -- run `glab auth login` or set GITLAB_TOKEN."

---

## Sub-Issue Linking — GitLab

### Three-Tier Fallback Chain

1. **Primary — API link:**
   `glab api projects/{project_id}/issues/{parent_iid}/links --method POST --field target_project_id={project_id} --field target_issue_iid={child_iid}`.
   Record link status as `native`.

2. **Fallback 1 — Advisory body-reference:**
   If API linking fails, establish an advisory link via issue descriptions:
   - Read the parent epic body. Add a sub-issue checklist entry: `- [ ] #{child} {title}` to the epic's body via `glab issue update {epic} -R {namespace}/{project} --description "..."`.
   - Read the child issue body. Prepend `> Parent: #{epic}` to the child's body via `glab issue update {child} -R {namespace}/{project} --description "..."`.
   - Record link status as `advisory`.

3. **Fallback 2 — Comment trace:**
   If both primary and Fallback 1 fail:
   `glab issue note {epic} -R {namespace}/{project} --message "Sub-issue: #{child} — {title} (linking failed)"`.
   Record link status as `comment-only`.

### Verification

After linking, verify via `glab api projects/{project_id}/issues/{epic_iid}/links` and check linked issues.

---

## Board Sync Enforcement — GitLab

1. **Status updates:** Set via `glab issue update --label`.
2. **Fallback escalation:** `glab issue update` CLI → surface error to user. Silent skipping is prohibited.
3. **Board item tracking:** After updating an issue, store the issue ID in the run cache keyed by issue number.

---

## Cross-Cutting Tooling — GitLab CLI-First

**Prerequisites:** `glab auth login` must be completed, or `GITLAB_TOKEN` environment variable set.

| Operation            | Primary (`glab` CLI)                                          | Fallback (MCP) |
| -------------------- | ------------------------------------------------------------- | -------------- |
| List issues          | `glab issue list -R {namespace}/{project}`                    | N/A            |
| Read issue details   | `glab issue view N -R {namespace}/{project}`                  | N/A            |
| Create/update issues | `glab issue create` / `glab issue update N`                   | N/A            |
| Search issues        | `glab issue list --search "..."`                              | N/A            |
| Manage relations     | `glab issue note N --message "Related to #M"` (advisory only) | N/A            |
| Add comments         | `glab issue note N -R {namespace}/{project}`                  | N/A            |
| Create MRs           | `glab mr create -R {namespace}/{project}`                     | N/A            |
| Read MR details      | `glab mr view N -R {namespace}/{project}`                     | N/A            |
| Read MR discussions  | `glab api '/projects/{project_id}/merge_requests/{iid}/discussions?per_page=100' --paginate` | N/A |
| Read MR notes        | `glab api '/projects/{project_id}/merge_requests/{iid}/notes?per_page=100' --paginate`       | N/A |
| Reply to discussion  | `glab api '/projects/{project_id}/merge_requests/{iid}/discussions/{discussion_id}/notes' -X POST -f body=@{file}` | N/A |
| Add MR note          | `glab api '/projects/{project_id}/merge_requests/{iid}/notes' -X POST -f body=@{file}`       | N/A |
| Manage labels        | `glab label create` / `glab label list`                       | N/A            |
| Board sync           | Label updates (automatic board list placement)                | N/A            |
| CI/Pipelines         | `glab ci list` / `glab ci view`                               | N/A            |
