---
id: hatch3r-board-shared-github
type: shared-context
description: GitHub-specific platform details for board shared context. Covers GitHub Issues, Projects V2, gh CLI, and MCP tools.
tags: [board, team, github]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Shared Reference — GitHub Platform Details

Platform-specific procedures for GitHub. Referenced from `hatch3r-board-shared`.

---

## Platform Detection — GitHub

Use `gh` CLI and GitHub MCP tools. Issues = GitHub Issues. PRs = Pull Requests. Board = Projects V2.

### CLI Command Reference

| Action | Command |
|--------|---------|
| Create issue | `gh issue create -R {owner}/{repo}` |
| List issues | `gh issue list -R {owner}/{repo}` |
| View issue | `gh issue view N -R {owner}/{repo}` |
| Update issue | `gh issue edit N -R {owner}/{repo}` |
| Close issue | `gh issue close N -R {owner}/{repo}` |
| Create PR | `gh pr create -R {owner}/{repo}` |
| Add label | `gh issue edit N --add-label "x"` |
| Add comment | `gh issue comment N -R {owner}/{repo}` |
| Board sync | `gh project item-add`, GraphQL |

### MCP Tool Reference

| Action | MCP Tool |
|--------|----------|
| Create issue | `issue_write` |
| Read issue | `issue_read` |
| List issues | `list_issues` |
| Search issues | `search_issues` |
| Add sub-issue | `sub_issue_write` |
| Create PR | `create_pull_request` |

### Terminology

| Concept | GitHub Term |
|---------|------------|
| Work unit | Issue |
| Code review | Pull Request (PR) |
| Board | Projects V2 |
| Labels | Labels |
| Project identifier | `projectNumber` |
| Status tracking | Projects V2 Status field |

---

## GitHub Context

Derived from `.hatch3r/hatch.json` board config:

- **Owner:** top-level `owner` (fallback: `board.owner`)
- **Repository:** top-level `repo` (fallback: `board.repo`)
- **Default branch:** `board.defaultBranch` (fallback: `"main"`)
- **Type labels:** `board.labels.types`
- **Executor labels:** `board.labels.executors`
- **Status labels:** `board.labels.statuses`
- **Dependency label:** `has-dependencies`
- **Meta labels:** `board.labels.meta`
- **Branch convention:** `board.branchConvention`
- **Issue templates:** Check `.github/ISSUE_TEMPLATE/` if present in the repository.
- **PR template:** Check `.github/PULL_REQUEST_TEMPLATE.md` if present.

### GitHub Project Reference (cache for the full run)

If `board.projectNumber` is not null, verify via `gh project view {board.projectNumber} --owner {board.owner}` or `gh project field-list {board.projectNumber} --owner {board.owner}` on first use.

- **Owner:** `board.owner`, **owner type:** infer from context (`org` or `user`)
- **Project number:** `board.projectNumber`
- **Status field ID:** `board.statusFieldId`
- **Status option IDs:** Read from `board.statusOptions` (keys: `backlog`, `ready`, `inProgress`, `inReview`, `done`)

---

## GitHub Projects V2 Sync

> **Skip entirely if `board.projectNumber` is null.**

**Prerequisites:** `gh auth refresh -s project` (Projects v2 via gh requires the `project` scope). gh CLI 2.40+ recommended.

**Status label → Projects v2 option mapping:**

Read the mapping from `board.statusOptions` in `.hatch3r/hatch.json`:

| Label                | Option ID from hatch.json          |
| -------------------- | ---------------------------------- |
| `status:triage`      | `board.statusOptions.backlog`      |
| `status:ready`       | `board.statusOptions.ready`        |
| `status:in-progress` | `board.statusOptions.inProgress`   |
| `status:in-review`   | `board.statusOptions.inReview`     |
| `status:done`        | `board.statusOptions.done`         |
| `status:blocked`     | `board.statusOptions.backlog`      |

**Steps for each issue to sync (gh CLI primary):**

1. **Resolve project node ID** (once per run, cache for the run): `gh project view {board.projectNumber} --owner {board.owner} --format json -q '.id'`. Required for step 3.
2. **Add to board + capture item ID:** `gh project item-add {board.projectNumber} --owner {board.owner} --url https://github.com/{board.owner}/{board.repo}/issues/{N} --format json -q '.id'`. **Capture the item ID from the output.** This call is idempotent -- if the item already exists on the board it returns the existing item with its ID.
3. **Update status:** `gh project item-edit --id {item_id} --project-id {project_node_id} --field-id {board.statusFieldId} --single-select-option-id {option_id}` using the label→option mapping from the table above.
4. **Verify (mandatory, every sync):** After step 3, confirm via `gh project item-list {board.projectNumber} --owner {board.owner} --format json -q '.[] | select(.content.number == {N}) | .status'` that the item's status matches the intended option ID. On mismatch, retry step 3 once; if still mismatched, record the failure per rule 8 of Board Sync Enforcement in `hatch3r-board-shared` (retry-then-halt fallback policy).

**For PRs:** Use `--url https://github.com/{board.owner}/{board.repo}/pull/{N}` in step 2.

**Fallback (rare):** If item-add does not return an item ID, use `gh project item-list {board.projectNumber} --owner {board.owner} --format json` and match by issue/PR content to obtain the item ID. Then proceed with step 3.

**MCP fallback:** If gh CLI fails, `project` scope is unavailable, or gh version is too old, fall back to `projects_write` / `projects_get` / `projects_list` with `method: add_project_item`, `method: update_project_item`, `method: get_project_item`, `method: list_project_items` as in the legacy procedure.

**Resilience:** On any single-call failure, apply rule 8 of Board Sync Enforcement (retry-then-halt fallback policy): two retries with 2-second and 8-second backoffs. If gh CLI and MCP are both unavailable, halt the command with: "Board sync cannot proceed: neither gh CLI nor Projects v2 MCP are available. Run `gh auth refresh -s project` or enable the `projects` toolset in your MCP configuration, then re-run this command." Silent skipping is prohibited (rule 5 of Board Sync Enforcement).

**Option-mapping race rule:** The sync mutation (step 3) uses `option_id` from the local label-to-option mapping table (at the top of this section) computed at the moment the caller set the status label. Do not re-read the issue's current labels to derive `option_id` -- that introduces a race with GraphQL propagation where the label may not yet be visible. The mapping table is the source of truth for this call.

---

## Sub-Issue Linking — GitHub

### Three-Tier Fallback Chain

1. **Primary — MCP native link:**
   `sub_issue_write` MCP with `method: add` using the parent `issue_number` and child's internal numeric `id`.
   Record link status as `native`.

2. **Fallback 1 — CLI body-reference:**
   If MCP linking fails, establish an advisory link:
   - Prepend `> Parent: #{epic}` to the child issue body via `gh issue edit {child} --body "..."`.
   - Add `- [ ] #{child} {title}` to the epic's sub-issue checklist via `gh issue edit {epic} --body "..."`.
   - Record link status as `advisory`.

3. **Fallback 2 — Comment trace:**
   If both primary and Fallback 1 fail:
   `gh issue comment {epic} --body "Sub-issue: #{child} — {title} (linking failed)"`.
   Record link status as `comment-only`.

### Verification

After linking, verify via `issue_read` with `method: get_sub_issues` on the parent epic.

---

## Board Sync Enforcement — GitHub

1. **Status updates:** Set via Projects V2 GraphQL mutation or `gh project item-edit`.
2. **Fallback escalation:** GraphQL mutation → `gh project item-edit` CLI → MCP `projects_write` → surface error to user. Silent skipping is prohibited.
3. **Board item tracking:** After adding an item to the board, store the returned item ID in the run cache keyed by issue number.

---

## Cross-Cutting Tooling — GitHub CLI-First

**Prerequisites:** `gh auth login` must be completed, or `GITHUB_TOKEN` environment variable set. For Projects v2: `gh auth refresh -s project`.

| Operation            | Primary (`gh` CLI)                                                                                          | Fallback (MCP)                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| List issues          | `gh issue list`                                                                                             | `list_issues`                                       |
| Read issue details   | `gh issue view`                                                                                             | `issue_read`                                        |
| Create/update issues | `gh issue create` / `gh issue edit`                                                                         | `issue_write`                                       |
| Search issues        | `gh search issues`                                                                                          | `search_issues` / `semantic_issues_search`          |
| Manage sub-issues    | `sub_issue_write` (MCP only — no CLI equivalent)                                                             | `sub_issue_write`                                   |
| Add comments         | `gh issue comment`                                                                                          | `add_issue_comment`                                 |
| Create PRs           | `gh pr create`                                                                                              | `create_pull_request`                               |
| Read PR details      | `gh pr view`                                                                                                | `pull_request_read`                                 |
| Read PR inline comments | `gh api repos/{owner}/{repo}/pulls/{N}/comments --paginate`                                              | `pull_request_read`                                 |
| Read PR review summaries | `gh api repos/{owner}/{repo}/pulls/{N}/reviews --paginate`                                              | `pull_request_read`                                 |
| Read PR discussion   | `gh api repos/{owner}/{repo}/issues/{N}/comments --paginate`                                                | `pull_request_read`                                 |
| Read PR thread resolution | `gh api graphql -f query='{repository(owner:"o",name:"r"){pullRequest(number:N){reviewThreads(first:100){nodes{id,isResolved}}}}}'` | N/A                                |
| Reply to inline comment | `gh api repos/{owner}/{repo}/pulls/{N}/comments -X POST -F in_reply_to={comment_id} -f body=@{file}`     | N/A                                                 |
| Comment on PR thread | `gh api repos/{owner}/{repo}/issues/{N}/comments -X POST -f body=@{file}`                                   | `add_issue_comment`                                 |
| Manage labels        | `gh label create` / `gh label list`                                                                         | `issue_write` (with labels)                         |
| Projects v2          | `gh project item-add`, `gh project item-edit`, `gh project item-list`, `gh project field-list`, `gh project view` | `projects_write` / `projects_get` / `projects_list` |
| CI/Actions           | `gh run list` / `gh run view`                                                                               | N/A                                                 |
| Releases             | `gh release create`                                                                                         | N/A                                                 |

Fallback to MCP only for operations the `gh` CLI cannot handle: sub-issue management (`sub_issue_write`).

### GitHub CLI Field-Typing Notes

`gh api` field flags differ by type. Pass the wrong one and the GitHub REST API returns `HTTP 422: not of type {integer|boolean}`.

| Flag | Type sent | Use for |
|------|-----------|---------|
| `-f key=value` | string (URL-encoded form) | `body`, `title`, `commit_message`, `query`, `state`, `event` |
| `-F key=value` | integer / boolean (auto-typed) — also `@file` for file contents | numeric IDs: `sub_issue_id`, `in_reply_to`, `parent_issue_id`, `issue_number`, `pull_number`, `team_id`, `user_id`, `milestone_number`; booleans: `draft`, `merged`, `auto_merge` |

Sub-issue linking via `POST /repos/{owner}/{repo}/issues/{N}/sub_issues` requires `-F sub_issue_id={child_numeric_id}` — `-f` returns 422. When the `sub_issue_write` MCP is unavailable, write the hand-rolled `gh api` call with `-F`, never `-f`. The same rule applies to PR review-reply (`in_reply_to`), milestone assignment (`milestone_number`), and team membership (`team_id` / `user_id`).
