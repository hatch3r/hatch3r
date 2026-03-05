---
id: hatch3r-board-shared
type: shared-context
description: Shared context and procedures for all board commands. Provides GitHub context from hatch.json, Projects v2 sync, and tooling directives.
---
# Board Shared Reference

Shared context for `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`, and related board commands. Read once per run and cache.

## Agent Pipeline

This command provides shared context and procedures for board commands. It does not spawn sub-agents directly.

---

## Board Configuration

All board commands read project-specific configuration from `.agents/hatch.json`. The GitHub owner and repo are defined at the top level (`owner`, `repo`). Board-specific configuration (Projects v2 IDs, label taxonomy, branch conventions, area labels) lives under the `board` key. **Read `.agents/hatch.json` at the start of every run and cache both top-level and `board` config for the duration.**

**Owner/repo resolution:** Use top-level `owner`/`repo`. Fall back to `board.owner`/`board.repo` if top-level values are empty (backward compatibility).

```json
{
  "owner": "{github-org-or-user}",
  "repo": "{repository-name}",
  "board": {
    "owner": "{github-org-or-user}",
    "repo": "{repository-name}",
    "defaultBranch": "main",
    "projectNumber": null,
    "statusFieldId": null,
    "statusOptions": {
      "backlog": null,
      "ready": null,
      "inProgress": null,
      "inReview": null,
      "done": null
    },
    "labels": {
      "types": ["type:bug", "type:feature", "type:refactor", "type:qa", "type:docs", "type:infra"],
      "executors": ["executor:agent", "executor:human", "executor:hybrid"],
      "statuses": ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:blocked"],
      "meta": ["meta:board-overview"]
    },
    "branchConvention": "{type}/{short-description}",
    "areas": []
  },
  "models": {
    "default": "opus",
    "agents": {
      "hatch3r-lint-fixer": "sonnet"
    }
  }
}
```

**`board.defaultBranch`** — Branch used for checkout before creating feature branches, PR base branch, and release operations. Default: `"main"`. Set to `"master"` or another branch name for repositories that use a different default.

If any field is `null` or missing, the corresponding feature is disabled (e.g., null `projectNumber` → skip Projects v2 sync).

**`models`** — Optional. Preferred AI models for agents. `models.default` applies to all agents; `models.agents` overrides per agent. Use aliases (`opus`, `sonnet`, `codex`, `gemini-pro`) or full model IDs. Resolution order: `.hatch3r/agents/{id}.customize.yaml` > manifest per-agent > agent frontmatter > manifest default. See [docs/model-selection.md](../docs/model-selection.md) and [docs/adapter-capability-matrix.md](../docs/adapter-capability-matrix.md#agent-model-customization).

---

## Platform Detection

Read `platform` from `.agents/hatch.json`. This determines all CLI commands, API patterns, and terminology for this run. If `platform` is missing or empty, default to `github`.

- **If platform is `github`:** Use `gh` CLI and GitHub MCP tools. Issues = GitHub Issues. PRs = Pull Requests. Board = Projects V2.
- **If platform is `azure-devops`:** Use `az devops` / `az boards` / `az repos` CLI. Issues = Work Items. PRs = Pull Requests. Board = Azure Boards. Requires `az login` or `AZURE_DEVOPS_PAT`.
- **If platform is `gitlab`:** Use `glab` CLI. Issues = GitLab Issues. PRs = Merge Requests (MRs). Board = GitLab Issue Boards. Requires `glab auth login` or `GITLAB_TOKEN`.

### Platform CLI Command Reference

| Action | GitHub (`gh`) | Azure DevOps (`az`) | GitLab (`glab`) |
|--------|---------------|---------------------|-----------------|
| Create work item | `gh issue create -R {owner}/{repo}` | `az boards work-item create --org https://dev.azure.com/{namespace} --project {project} --type "User Story" --title "..."` | `glab issue create -R {namespace}/{project}` |
| List work items | `gh issue list -R {owner}/{repo}` | `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT..."` | `glab issue list -R {namespace}/{project}` |
| View work item | `gh issue view N -R {owner}/{repo}` | `az boards work-item show --org https://dev.azure.com/{namespace} --id N` | `glab issue view N -R {namespace}/{project}` |
| Update work item | `gh issue edit N -R {owner}/{repo}` | `az boards work-item update --org https://dev.azure.com/{namespace} --id N` | `glab issue update N -R {namespace}/{project}` |
| Close work item | `gh issue close N -R {owner}/{repo}` | `az boards work-item update --org https://dev.azure.com/{namespace} --id N --state Closed` | `glab issue close N -R {namespace}/{project}` |
| Create PR/MR | `gh pr create -R {owner}/{repo}` | `az repos pr create --org https://dev.azure.com/{namespace} --project {project}` | `glab mr create -R {namespace}/{project}` |
| Add label/tag | `gh issue edit N --add-label "x"` | `az boards work-item update --id N --fields "System.Tags=x"` | `glab issue update N --label "x"` |
| Add comment | `gh issue comment N -R {owner}/{repo}` | `az boards work-item update --id N --discussion "..."` | `glab issue note N -R {namespace}/{project}` |
| Board sync | `gh project item-add`, GraphQL | Board column = Work Item State | Board list = label-based |

### Platform MCP Tool Reference

| Action | GitHub MCP | Azure DevOps MCP | GitLab MCP |
|--------|-----------|-----------------|------------|
| Create issue/work item | `issue_write` | `create_work_item` | (use `glab` CLI) |
| Read issue/work item | `issue_read` | `get_work_item` | (use `glab` CLI) |
| List issues/work items | `list_issues` | `list_work_items` | (use `glab` CLI) |
| Search issues/work items | `search_issues` | `search_work_items` | (use `glab` CLI) |
| Add sub-issue/relation | `sub_issue_write` | Work Item parent-child relation | (use `glab` CLI) |
| Create PR/MR | `create_pull_request` | `create_pull_request` | (use `glab` CLI) |

### Platform Terminology

Throughout this document and all board commands, the following terms are platform-dependent:

| Concept | GitHub | Azure DevOps | GitLab |
|---------|--------|--------------|--------|
| Work unit | Issue | Work Item | Issue |
| Code review | Pull Request (PR) | Pull Request (PR) | Merge Request (MR) |
| Board | Projects V2 | Azure Boards | GitLab Issue Boards |
| Labels | Labels | Tags + Area Paths | Labels |
| Project identifier | `projectNumber` | `project` name | project ID |
| Status tracking | Projects V2 Status field | Work Item State | Board lists/labels |

---

## Platform Context

Derived from `.agents/hatch.json` board config. Field names refer to the GitHub terminology by default; platform detection maps them to the appropriate platform equivalents.

**If platform is `github`:**

### GitHub Context

Derived from `.agents/hatch.json` board config:

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

#### GitHub Project Reference (cache for the full run)

If `board.projectNumber` is not null, verify via `gh project view {board.projectNumber} --owner {board.owner}` or `gh project field-list {board.projectNumber} --owner {board.owner}` on first use.

- **Owner:** `board.owner`, **owner type:** infer from context (`org` or `user`)
- **Project number:** `board.projectNumber`
- **Status field ID:** `board.statusFieldId`
- **Status option IDs:** Read from `board.statusOptions` (keys: `backlog`, `ready`, `inProgress`, `inReview`, `done`)

**If platform is `azure-devops`:**

### Azure DevOps Context

- **Organization:** top-level `owner` (maps to Azure DevOps organization name)
- **Project:** top-level `repo` (maps to Azure DevOps project name)
- **Default branch:** `board.defaultBranch` (fallback: `"main"`)
- **Type labels → Work Item Tags:** `board.labels.types` (applied as Tags on work items)
- **Executor labels → Tags:** `board.labels.executors`
- **Status labels → Work Item State:** `board.labels.statuses` (mapped to Work Item State field)
- **Area Paths:** `board.areas` (mapped to Azure DevOps Area Paths)
- **PR template:** Check `.azuredevops/pull_request_template.md` if present.

#### Azure DevOps Project Reference (cache for the full run)

- **Organization URL:** `https://dev.azure.com/{namespace}`
- **Project name:** `board.projectNumber` (repurposed as Azure DevOps project name)
- **Work Item States:** `Backlog` → `New`, `Ready` → `Active`, `In Progress` → `Active`, `In Review` → `Resolved`, `Done` → `Closed`

**If platform is `gitlab`:**

### GitLab Context

- **Namespace:** top-level `owner` (GitLab group or user namespace)
- **Project:** top-level `repo` (GitLab project name)
- **Default branch:** `board.defaultBranch` (fallback: `"main"`)
- **Type labels:** `board.labels.types`
- **Executor labels:** `board.labels.executors`
- **Status labels:** `board.labels.statuses`
- **Scoped labels:** GitLab supports scoped labels (`status::ready`, `type::bug`). Map hatch3r label format (`status:ready`) to GitLab scoped format (`status::ready`) when creating labels.
- **Issue templates:** Check `.gitlab/issue_templates/` if present.
- **MR template:** Check `.gitlab/merge_request_templates/` if present.

#### GitLab Project Reference (cache for the full run)

- **Project path:** `{namespace}/{project}`
- **Board:** GitLab Issue Boards use label-based lists. Each status maps to a board list label.
- **Board ID:** `board.projectNumber` (repurposed as GitLab Board ID if configured)

---

## Board Sync Procedure

> **Skip entirely if `board.projectNumber` is null (GitHub/GitLab) or project is not configured (Azure DevOps).**

Use this procedure whenever a status label is set or changes and the board needs to reflect it. Labels are the source of truth; board sync keeps the board view consistent. This includes newly created issues -- sync their initial status immediately after adding them to the board.

**If platform is `github`:**

### GitHub Projects V2 Sync

**Prerequisites:** `gh auth refresh -s project` (Projects v2 via gh requires the `project` scope). gh CLI 2.40+ recommended.

**Status label → Projects v2 option mapping:**

Read the mapping from `board.statusOptions` in `.agents/hatch.json`:

| Label                | Option ID from hatch.json          |
| -------------------- | ---------------------------------- |
| `status:triage`      | `board.statusOptions.backlog`      |
| `status:ready`       | `board.statusOptions.ready`        |
| `status:in-progress` | `board.statusOptions.inProgress`   |
| `status:in-review`   | `board.statusOptions.inReview`     |
| `status:blocked`     | `board.statusOptions.backlog`      |

**Steps for each issue to sync (gh CLI primary):**

1. **Resolve project node ID** (once per run, cache for the run): `gh project view {board.projectNumber} --owner {board.owner} --format json -q '.id'`. Required for step 3.
2. **Add to board + capture item ID:** `gh project item-add {board.projectNumber} --owner {board.owner} --url https://github.com/{board.owner}/{board.repo}/issues/{N} --format json -q '.id'`. **Capture the item ID from the output.** This call is idempotent -- if the item already exists on the board it returns the existing item with its ID.
3. **Update status:** `gh project item-edit --id {item_id} --project-id {project_node_id} --field-id {board.statusFieldId} --single-select-option-id {option_id}` using the label→option mapping from the table above.
4. **Verify (first sync per run only):** After step 3, optionally confirm via `gh project item-list {board.projectNumber} --owner {board.owner} --format json` that the item's status matches. If it does not, retry step 3 once.

**For PRs:** Use `--url https://github.com/{board.owner}/{board.repo}/pull/{N}` in step 2.

**Fallback (rare):** If item-add does not return an item ID, use `gh project item-list {board.projectNumber} --owner {board.owner} --format json` and match by issue/PR content to obtain the item ID. Then proceed with step 3.

**MCP fallback:** If gh CLI fails, `project` scope is unavailable, or gh version is too old, fall back to `projects_write` / `projects_get` / `projects_list` with `method: add_project_item`, `method: update_project_item`, `method: get_project_item`, `method: list_project_items` as in the legacy procedure.

**Resilience:** If any call fails, retry once. If it still fails, surface a warning to the user and continue with the next item. If gh CLI and MCP are both unavailable, skip sync silently and warn: "Projects v2 sync skipped -- run `gh auth refresh -s project` or enable the `projects` toolset in your MCP configuration."

**If platform is `azure-devops`:**

### Azure Boards Work Item State Sync

Azure Boards syncs via Work Item State changes. There is no separate "add to board" step -- work items appear on the board automatically based on their State and Area Path.

**Status label → Work Item State mapping:**

| Label                | Work Item State |
| -------------------- | --------------- |
| `status:triage`      | `New`           |
| `status:ready`       | `Active`        |
| `status:in-progress` | `Active`        |
| `status:in-review`   | `Resolved`      |
| `status:blocked`     | `New`           |
| (done)               | `Closed`        |

**Steps for each work item to sync:**

1. **Update Work Item State:** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --state "{state}"` using the label→state mapping above.
2. **Update Area Path (if area labels changed):** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --area-path "{project}\\{area}"`.
3. **Update Tags:** `az boards work-item update --org https://dev.azure.com/{namespace} --id {N} --fields "System.Tags={comma-separated tags}"`.

**MCP fallback:** If `az` CLI fails, fall back to Azure DevOps MCP `update_work_item` with the corresponding state and field values.

**For PRs:** PRs are managed via `az repos pr update --id {N} --status active|completed`. Board sync for PRs is automatic in Azure DevOps when linked to work items.

**Resilience:** If any call fails, retry once. If it still fails, surface a warning and continue. If `az` CLI and MCP are both unavailable, warn: "Azure Boards sync skipped -- run `az login` or set AZURE_DEVOPS_PAT."

**If platform is `gitlab`:**

### GitLab Board Label-Based Sync

GitLab Boards use labels to organize issues into lists. Board sync is achieved by updating issue labels to match the target status.

**Status label → Board list mapping:**

GitLab board lists are label-based. Each status corresponds to a scoped label:

| Label                | GitLab Scoped Label |
| -------------------- | ------------------- |
| `status:triage`      | `status::triage`    |
| `status:ready`       | `status::ready`     |
| `status:in-progress` | `status::in-progress` |
| `status:in-review`   | `status::in-review` |
| `status:blocked`     | `status::blocked`   |

**Steps for each issue to sync:**

1. **Update labels:** `glab issue update {N} -R {namespace}/{project} --unlabel "status::*" --label "status::{new-status}"`. GitLab scoped labels auto-replace within the same scope, so setting `status::ready` automatically removes `status::triage`.
2. **Verify:** `glab issue view {N} -R {namespace}/{project}` and confirm labels match.

**For MRs:** `glab mr update {N} -R {namespace}/{project} --label "status::{new-status}"`.

**Resilience:** If any call fails, retry once. If it still fails, surface a warning and continue. If `glab` CLI is unavailable, warn: "GitLab Board sync skipped -- run `glab auth login` or set GITLAB_TOKEN."

---

## Board Sync Enforcement

Board sync is **MANDATORY**, not optional. The following rules override any "skip if null" or "skip silently" language elsewhere when the board is configured (GitHub: `board.projectNumber` set; Azure DevOps: project configured; GitLab: board configured).

1. **Every issue/work item created or updated by a board command MUST be synced to the board — no exceptions.** This includes newly created issues, status changes, label updates, and any mutation that affects board state. Skipping sync for any item is a violation of this policy.
2. **Status MUST be updated after every status-changing operation.** The four canonical statuses — Ready, In Progress, In Review, Done — must be reflected on the board immediately after the corresponding label change. Do not batch status updates to "later" or defer them.
   - **GitHub:** Set via Projects V2 GraphQL mutation or `gh project item-edit`.
   - **Azure DevOps:** Set via `az boards work-item update --state`.
   - **GitLab:** Set via `glab issue update --label`.
3. **All available board fields (priority, sprint, area, iteration) MUST be populated when the data is available.** Never leave a board field empty if the information exists in the issue's labels, body, or metadata.
4. **Board overview dashboard MUST be regenerated after any batch of issue operations.** This is in addition to the per-run regeneration rule — if a board command performs multiple batches of mutations, the dashboard must reflect the final state.
5. **Fallback: never silently skip sync.** The escalation path by platform:
   - **GitHub:** GraphQL mutation → `gh project item-edit` CLI → MCP `projects_write` → surface error to user.
   - **Azure DevOps:** `az boards work-item update` CLI → Azure DevOps MCP → surface error to user.
   - **GitLab:** `glab issue update` CLI → surface error to user.
   Silent skipping is prohibited.
6. **Cross-reference: every epic/work item and sub-issue must have its board item ID tracked for subsequent updates.** After adding an item to the board, store the returned item ID (GitHub) or work item ID (Azure DevOps) or issue ID (GitLab) in the run cache keyed by issue number.

---

## Board Overview

If `meta:board-overview` is included in `board.labels.meta`, board commands will look for an open issue with that label to use as a live dashboard. This dashboard is auto-maintained and MUST be regenerated at the end of every board command run that mutates issues. For on-demand regeneration without running a full board command, use `hatch3r-board-refresh`.

Teams can extend the dashboard with project-specific sections, but the following structure and model recommendations are required.

### Frontier Model Pool

When populating the board overview, assign a recommended model to each issue. The pool uses aliases that map to the project's configured model versions in `hatch.json`. Specific model IDs are intentionally omitted here to avoid staleness as model versions change — configure actual model IDs in `hatch.json` under `models`.

| Alias | Strength | Use When |
| ----- | -------- | -------- |
| `opus` | Code quality, multi-file refactoring, security, deep reasoning | Complex refactors, security-critical, architectural changes, `risk:high` |
| `codex` | Agentic coding, long-running tasks, tool orchestration | Multi-step implementations, polyglot codebases, complex tool integrations |
| `gemini-pro` | Large context windows, multimodal, web development | Massive context needs (large epics), web/frontend work |
| `sonnet` | Balance of quality and speed | Standard features, bugs, docs, QA — when the top-tier model is overkill |

### Model Selection Heuristic (Quality-First)

1. **Default:** `opus` — highest code quality baseline.
2. **Override to `codex`** if the issue involves heavy agentic coding, long-running multi-step tasks, or multi-language requirements.
3. **Override to `gemini-pro`** if the issue requires processing very large context (large epic with many sub-issues spanning many files) or is primarily web/frontend work.
4. **Downgrade to `sonnet`** ONLY for straightforward issues: simple bugs (`risk:low`), documentation (`type:docs`), QA validation (`type:qa`), or issues with clear bounded scope and no architectural impact.

### Board Overview Issue Format

Issue listings in the board overview MUST include a `Model` column. All board commands that regenerate the dashboard MUST use this canonical template. Omit any status section that has zero issues (except Status Summary, which always appears). Omit Board Health sub-sections that have no findings. Sort issues within each status group by priority (`P0` first), then by issue number.

```markdown
## Board Overview

**Project:** {owner}/{repo}
**Last refreshed:** {ISO date}

---

## Status Summary

| Status | Count |
|--------|-------|
| Backlog / Triage | {count} |
| Ready | {count} |
| In Progress | {count} |
| In Review | {count} |
| Externally Blocked | {count} |
| **Total Open** | **{count}** |

---

## In Progress

| # | Title | Type | Pri | Executor | Model |
|---|-------|------|-----|----------|-------|
| #{N} | {title} | {type} | {pri} | {executor} | {model} |

## In Review

| # | Title | Type | Pri | Executor | Model |
|---|-------|------|-----|----------|-------|
| #{N} | {title} | {type} | {pri} | {executor} | {model} |

## Implementation Lanes

Issues grouped into independent parallel work streams.
Different lanes can be worked concurrently; within a lane, follow the listed order.

### Lane 1: {area/theme}

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #{N} | {title} | {type} | {pri} | {executor} | {model} |
| 2 | #{M} | {title} | {type} | {pri} | {executor} | {model} |

### Lane 2: {area/theme}

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #{N} | {title} | {type} | {pri} | {executor} | {model} |

## Cross-Epic Dependencies

Dependency relationships between epics. Omit if no cross-epic dependencies exist.

| Upstream Epic | Downstream Epic | Via |
|---------------|-----------------|-----|
| #{epicA} {title} | #{epicB} {title} | #{subX} blocks #{subY} |

## Waiting on Dependencies

`status:ready` issues with one or more unsatisfied blockers. Not yet available for pickup.

| # | Title | Type | Waiting On | Model |
|---|-------|------|------------|-------|
| #{N} | {title} | {type} | #{blocker} ({blocker status}) | {model} |

## Externally Blocked

Issues with `status:blocked` -- waiting on external factors (approvals, environments, third-party services).

| # | Title | Type | Reason | Model |
|---|-------|------|--------|-------|
| #{N} | {title} | {type} | {blocker reason} | {model} |

## Backlog / Triage

| # | Title | Type | Pri | Executor | Model |
|---|-------|------|-----|----------|-------|
| #{N} | {title} | {type} | {pri} | {executor} | {model} |

---

## Board Health

**Missing metadata:**
- {list or "None -- all issues have required labels."}

**Stale issues:**
- {list or "None -- all issues are active."}

**Blocked chains:**
- {list or "None -- no blocked dependencies."}

**Epic ordering discrepancies:**
- {list or "None -- all epic Implementation Order sections match sub-issue Dependencies."}

---

*This issue is auto-maintained by hatch3r board commands. Do not close.*
```

### Dependency Data Model

`## Dependencies` sections in individual issue bodies are the **single authoritative source** of dependency data. Every issue (epic, sub-issue, standalone) tracks its own blockers in its `## Dependencies` section using two reference types:

- **Hard:** `Blocked by #N` -- this issue cannot start until #N is closed. Used for true producer/consumer relationships (A creates what B consumes) and explicit sequencing requirements.
- **Soft:** `Recommended after #N` -- this issue can proceed in parallel with #N, but sequential execution is recommended (e.g., shared area overlap, reduced merge conflict risk). Soft dependencies are advisory; they do not block pickup or exclude issues from Implementation Lanes.

When no dependencies exist, the section contains `None`.

`## Implementation Order` sections in epic bodies are a **derived convenience view** -- they visualize the dependency DAG among an epic's sub-issues as numbered levels. Board commands that create or update epics MUST regenerate `## Implementation Order` from the sub-issues' `## Dependencies` sections, not the other way around. When the two diverge, `## Dependencies` wins.

### Lane Computation Algorithm

Used by `board-fill`, `board-groom`, and `board-refresh` when generating the Implementation Lanes and Waiting on Dependencies sections. Input: all `status:ready` issues and their dependency data (from `## Dependencies` sections).

1. **Collect** all `status:ready` issues.
2. **Partition by hard-blocker satisfaction** -- for each collected issue, check all **hard** dependency references (`Blocked by #N`) in its `## Dependencies` section against the full board. An issue is **dependency-waiting** if any hard blocker is still open (regardless of the blocker's status). Soft dependencies (`Recommended after #N`) do not affect this partition. Separate into two sets:
   - **Available** -- all hard blockers satisfied (closed) or no hard blockers. These proceed to lane computation (step 3+).
   - **Dependency-waiting** -- one or more hard blockers still open. These are excluded from Implementation Lanes and listed in the **Waiting on Dependencies** section of the overview instead.
3. **Build the available sub-graph** -- extract only the inter-dependencies among available issues (from parsed `## Dependencies` sections).
4. **Group by dependency chains** -- issues with sequential dependencies go in the same lane, ordered topologically within the chain.
5. **Group by area overlap** -- independent issues (no inter-dependencies) that share `area:*` labels go in the same lane. This avoids merge conflicts on the same files when multiple agents work in parallel.
6. **General lane** -- issues with no dependencies and no area overlap form their own single-issue lanes. If three or more such issues exist, group them into a single "General" lane.
7. **Name lanes** by the dominant `area:*` label or shared theme of the issues in the lane. Use "General" for the catch-all lane.
8. **Sort lanes** by the highest-priority issue in each lane (`P0`-lane first, then `P1`, etc.). Break ties by lowest issue number.
9. **Sort within lanes** by dependency order (blockers before dependents), then by priority, then by issue number.

Example output:

```
## Implementation Lanes

Issues grouped into independent parallel work streams.
Different lanes can be worked concurrently; within a lane, follow the listed order.

### Lane 1: API

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #15 | Fix rate limiter | bug | P0 | agent | opus |

### Lane 2: Auth

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #12 | OAuth2 PKCE flow | feature | P1 | agent | opus |
| 2 | #14 | Token refresh edge cases | bug | P2 | agent | sonnet |

### Lane 3: General

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #18 | Migrate to ESM | refactor | P2 | agent | opus |
| 2 | #21 | Update CI matrix | infra | P3 | agent | sonnet |
```

---

## Cross-Cutting Tooling Directives

These directives apply to ALL board commands. They supplement the project's tooling hierarchy.

### Platform CLI-First

All board commands MUST use the platform CLI as the primary interface for operations. CLI tools have lower token cost and faster execution than MCP equivalents.

**If platform is `github`:**

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
| Manage labels        | `gh label create` / `gh label list`                                                                         | `issue_write` (with labels)                         |
| Projects v2          | `gh project item-add`, `gh project item-edit`, `gh project item-list`, `gh project field-list`, `gh project view` | `projects_write` / `projects_get` / `projects_list` |
| CI/Actions           | `gh run list` / `gh run view`                                                                               | N/A                                                 |
| Releases             | `gh release create`                                                                                         | N/A                                                 |

Fallback to MCP only for operations the `gh` CLI cannot handle: sub-issue management (`sub_issue_write`).

**If platform is `azure-devops`:**

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
| Manage tags          | `az boards work-item update --id N --fields "System.Tags=tag1; tag2"`                          | N/A                    |
| Board sync           | Work Item State updates (automatic board placement)                                             | N/A                    |
| CI/Pipelines         | `az pipelines run list` / `az pipelines run show`                                              | N/A                    |

**If platform is `gitlab`:**

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
| Manage labels        | `glab label create` / `glab label list`                       | N/A            |
| Board sync           | Label updates (automatic board list placement)                | N/A            |
| CI/Pipelines         | `glab ci list` / `glab ci view`                               | N/A            |

### Batch Operations

All board commands MUST minimize user approval prompts by batching related GitHub operations:

1. **Collect before executing.** Gather all planned mutations (issue creation, label changes, sub-issue linking, board sync) into a complete batch before making any API calls.
2. **Present batch summaries.** Before executing a batch, present the user with a summary table of all operations in the batch (e.g., issues to create, labels to apply, links to establish).
3. **Single approval per batch.** Request ONE user confirmation for the entire batch. Do not prompt per-item when a batch summary has already been approved.
4. **Sequential execution after approval.** Once approved, execute all operations in the batch sequentially without additional per-item prompts. Report progress inline (e.g., "Created issue #N... Linked sub-issue #M...") but do not pause for confirmation between operations.
5. **Batch error handling.** If an individual operation within an approved batch fails, log the failure, continue with remaining operations, and summarize all failures at the end of the batch. Do not re-prompt for each failure.

### Context7 MCP + Web Research

During **board-fill Step 4c** (external research) and **board-pickup Step 6** (implementation):

1. Use **Context7 MCP** (`resolve-library-id` then `query-docs`) whenever an issue references an external library, framework, or SDK. This retrieves current, version-specific documentation to inform issue scoping and implementation.
2. Use **web research** for novel technical challenges, current best practices, security advisories, or breaking changes not covered by Context7 or local docs.
3. Follow the project's tooling hierarchy for knowledge augmentation priority.

---

## Formatting Rules

- Task list: `- [ ] #{number} {short title} *({type tag, }{priority})*`
- Type tag: `Epic` for epics, omitted for standalone.
- Short title: max ~50 chars, strip `[Type]:` prefix.
- Priority: `P0`-`P3` or `--`.
- The board overview issue itself is never listed.

---

## Token-Saving Directives

These apply to all board commands. Follow them to minimize token consumption.

1. **Single board scan.** Perform ONE full board scan per run. Cache all issue data. Reuse for all subsequent steps. Only re-fetch an issue if you mutated it.
2. **Do NOT re-read shared context files** -- their content is available via always-applied rules, this shared context file, or inline in the command.
3. **Mandatory board dashboard regeneration.** If a `meta:board-overview` issue exists, board commands MUST regenerate it ONCE at the end of the run. Do not regenerate after intermediate status changes, and do not skip the final regeneration.
4. **Limit documentation reads.** Read project documentation selectively -- TOC/headers first, full content only for relevant sections.
5. **Do NOT read issue templates.** Required structure is provided inline in the command.
6. **Follow the project's tooling hierarchy** for knowledge augmentation (Context7 MCP, web research).
