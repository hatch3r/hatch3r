---
id: hatch3r-board-init
type: command
description: Initialize a project board (GitHub Projects V2, Azure Boards, or GitLab Issue Boards) with hatch3r's label taxonomy, status fields, and board structure. Platform detected from hatch.json.
---

## Agent Pipeline

This command runs as a single orchestrator without sub-agent delegation.

All board operations MUST follow the Board Sync Enforcement rules defined in `hatch3r-board-shared`.

# Board Init -- Bootstrap a Project Board

Initialize a new or existing project board for **{owner}/{repo}** (read from `.agents/hatch.json` board config). The `platform` field in `hatch.json` determines whether to set up GitHub Projects V2, Azure Boards, or GitLab Issue Boards. Sets up status fields/states, creates the full hatch3r label/tag taxonomy, optionally migrates issues from another project, and writes all IDs back to `.agents/hatch.json` so subsequent board commands work out of the box. AI proposes configuration; user confirms before any mutation.

---

## Integration with Platform Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above platform agentic workflows. While platform-native agentic workflows (GitHub Agentic Workflows, Azure DevOps automations, GitLab Auto DevOps) handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-groom** refines existing work items as priorities, scope, and dependencies evolve over time
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide

Platform agentic workflows and hatch3r are complementary: use platform workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Quick / Defaults Mode

If the user requests quick mode, defaults mode, or passes a `--quick` or `--defaults` flag: use all auto-detected values without prompting and proceed directly to execution with a single confirmation. Specifically:

1. Auto-detect owner/repo from `.agents/hatch.json` (skip ASK in 1.1).
2. Default to "Create new project" if `board.projectNumber` is null (skip ASK in 1.2).
3. Use `{repo} Board` as the project name (skip ASK in 1.2a).
4. Auto-detect default branch via `git rev-parse --abbrev-ref origin/HEAD` (skip ASK in 1.2b).
5. Auto-suggest area labels from top-level source directories (skip ASK in 1.3).
6. Skip migration (skip ASK in 1.4).
7. Jump directly to Step 1.6 (Confirm Plan) with all auto-detected values. The user confirms or customizes in a single prompt.

---

## Workflow

This command runs in two phases: **Planning** (collect all answers) then **Execution** (perform all mutations). No mutations occur until the user confirms the full plan.

---

### Phase 1 — Planning

Collect all configuration choices upfront. No GitHub API calls or file writes in this phase (except reads needed to present options).

#### 1.1: Read Configuration

1. Read `.agents/hatch.json` and cache the `board` config.
2. Read `platform` from `.agents/hatch.json`. Default to `github` if missing. Cache for the run.
3. Resolve owner/repo per `hatch3r-board-shared`: **Use top-level `owner`/`repo` first.** Fall back to `board.owner`/`board.repo` if top-level values are empty.
4. If both are set (from either source), note: "Using owner=`{owner}`, repo=`{repo}`, platform=`{platform}`."
5. If either is missing:

**ASK:** "I need the owner/namespace and repository/project for this board. Please provide: (1) owner (org/namespace/username), (2) repo/project name."

Update the in-memory config with the provided values.

#### 1.2: Choose Mode

**If platform is `github`:**
1. If `board.projectNumber` is already set in `.agents/hatch.json`, default to **B** (Connect to existing project #{board.projectNumber}).
2. If `board.projectNumber` is null or missing, default to **A** (Create new).

**If platform is `azure-devops`:**
1. If `board.projectNumber` (repurposed as Azure DevOps project name) is set, default to **B** (Connect to existing Azure Boards project).
2. If null or missing, default to **A** (Configure new Azure Boards project).

**If platform is `gitlab`:**
1. If `board.projectNumber` (repurposed as GitLab Board ID) is set, default to **B** (Connect to existing board).
2. If null or missing, default to **A** (Create new GitLab Issue Board).

No separate prompt — the mode is included in the consolidated plan confirmation (Step 1.6) where the user can override it.

#### 1.2a: Project Name (when Mode A — Create new)

If mode is **A** (Create new), default the project name to `{repo} Board`.

**If platform is `azure-devops`:** Use the Azure DevOps project name. If the project already exists in the organization, skip creation and configure the board within the existing project.

No separate prompt — the project name is included in the consolidated plan confirmation (Step 1.6) where the user can override it.

#### 1.2b: Default Branch

1. Auto-detect the default branch: run `git rev-parse --abbrev-ref origin/HEAD` and strip the `origin/` prefix. If the command fails (e.g., no remote configured), fall back to `board.defaultBranch` from `.agents/hatch.json`, then to `"main"`.
2. Record the detected branch name. This value is written to `board.defaultBranch` and used by board-pickup (checkout, PR base) and other agents.

No separate prompt — the detected branch is included in the consolidated plan confirmation (Step 1.6).

#### 1.3: Area Labels

1. Auto-suggest area labels from the top-level source directories in the codebase. Scan the repository root and common source roots (`src/`, `packages/`, `apps/`) for top-level directories that represent distinct areas (e.g., `frontend`, `backend`, `api`, `infra`, `cli`, `docs`). Exclude non-area directories (`node_modules`, `.git`, `dist`, `build`, `.github`, `.agents`, `coverage`, `__tests__`).
2. If `board.areas` already has entries in `.agents/hatch.json`, use those as the default and note the source.
3. Present the auto-detected areas in the consolidated plan confirmation (Step 1.6) where the user can confirm, add, remove, or skip area labels.

No separate prompt — area labels are included in the consolidated plan confirmation (Step 1.6).

#### 1.4: Migration

Default to "no migration." If the user needs to migrate issues from an existing project, they can specify it when customizing the plan in Step 1.6.

No separate prompt — migration is included in the consolidated plan confirmation (Step 1.6).

#### 1.5: Board Overview

A board overview issue (labeled `meta:board-overview`) will be created by default. No user prompt needed.

#### 1.6: Confirm Plan (Consolidated)

This is the **single user-facing confirmation** for the entire Planning phase. All auto-detected and defaulted values are presented here for the user to confirm or customize in one prompt.

Present the full plan summary:

```
Board Init Plan:
  Platform:       {platform} (github / azure-devops / gitlab)
  Owner/Namespace:{owner}/{repo}
  Default branch: {defaultBranch} (auto-detected via git / from hatch.json / default)
  Mode:           {A: Create new / B: Connect to #{N}} (auto-detected: {reason})
  Project name:   {project name, or "N/A" when Mode B}
  Status options:  Backlog, Ready, In Progress, In Review, Done
  Label taxonomy:  {count} labels/tags (types, executors, statuses, priorities, risks, meta)
  Area labels:    {auto-detected list or "none"} (source: {codebase scan / hatch.json / none})
  Migration:      {from Project #X / "none" (default)}
  Board overview: yes (default)
```

**ASK:** "Here is the full board init plan with auto-detected values. Confirm to begin execution, or specify any settings to customize (e.g., 'change branch to master', 'add area: mobile', 'use existing project #5', 'migrate from project #3')."

---

### Phase 2 — Execution

Execute all planned mutations in sequence. No further questions unless a mutation fails.

#### 2.1: Create or Connect Project

**Platform-specific: Project creation/connection**

**If platform is `github`:**

##### Option A — Create New GitHub Projects V2 Board

1. Fetch the repository node ID:
   ```graphql
   query { repository(owner: "{owner}", name: "{repo}") { id } }
   ```
   Use the GitHub MCP `graphql` tool with `owner: {board.owner}`, `repo: {board.repo}`.
2. Create the project using the project name from Phase 1, step 1.2a (default: `{repo} Board`):
   ```graphql
   mutation { createProjectV2(input: { ownerId: "<repo_owner_node_id>", title: "{project_name}" }) { projectV2 { id number } } }
   ```
   The `ownerId` must be the **owner's** node ID (org or user), not the repository node ID. Fetch the owner node ID first if needed:
   ```graphql
   query { repositoryOwner(login: "{owner}") { id } }
   ```
3. Capture the project `id` (node ID) and `number` from the response.

##### Option B — Connect to Existing GitHub Project

1. Query the existing project:
   ```graphql
   query { user(login: "{owner}") { projectV2(number: {N}) { id number } } }
   ```
   Use `organization` instead of `user` if the owner is an org. Try `user` first; if it fails, retry with `organization`.
2. Capture the project `id` and `number`.

**If platform is `azure-devops`:**

##### Option A — Configure Azure Boards Project

1. Verify the Azure DevOps organization and project exist:
   ```bash
   az devops project show --org https://dev.azure.com/{namespace} --project {project}
   ```
2. If the project does not exist, create it:
   ```bash
   az devops project create --org https://dev.azure.com/{namespace} --name "{project_name}" --source-control git --process Agile
   ```
3. Configure defaults: `az devops configure --defaults organization=https://dev.azure.com/{namespace} project={project}`.
4. Capture the project name for `board.projectNumber`.

##### Option B — Connect to Existing Azure DevOps Project

1. Verify the project exists: `az devops project show --org https://dev.azure.com/{namespace} --project {project}`.
2. Capture the project name.

**If platform is `gitlab`:**

##### Option A — Create New GitLab Issue Board

1. Verify the GitLab project exists:
   ```bash
   glab repo view {namespace}/{project}
   ```
2. Create a new issue board:
   ```bash
   glab api projects/{project_id}/boards --method POST --field name="{project_name}"
   ```
   Where `{project_id}` is the numeric GitLab project ID (obtain via `glab api projects/{namespace}%2F{project} --jq '.id'`).
3. Capture the board ID for `board.projectNumber`.

##### Option B — Connect to Existing GitLab Board

1. List existing boards: `glab api projects/{project_id}/boards --jq '.[].id'`.
2. Capture the board ID.

#### 2.2: Configure Status Field / States

**Platform-specific: Status configuration**

**If platform is `github`:**

1. Query the project's fields to find the "Status" single-select field:
   ```graphql
   query {
     node(id: "<project_id>") {
       ... on ProjectV2 {
         fields(first: 50) {
           nodes {
             ... on ProjectV2SingleSelectField {
               id name options { id name }
             }
           }
         }
       }
     }
   }
   ```
2. Look for a field named "Status" (case-insensitive match).
3. If no Status field exists, create one via the `createProjectV2Field` mutation with type `SINGLE_SELECT`.
4. Ensure these status options exist on the field: **Backlog**, **Ready**, **In Progress**, **In Review**, **Done**.
   - For missing options, use the `updateProjectV2Field` mutation (or the appropriate mutation for adding options to a single-select field) to add them.
5. Capture the field ID and each option's ID.

**If platform is `azure-devops`:**

1. Azure Boards uses Work Item States (not a custom field). Verify the process template supports the required states by querying:
   ```bash
   az boards work-item type list --org https://dev.azure.com/{namespace} --project {project}
   ```
2. Map hatch3r statuses to Work Item States: **Backlog** → `New`, **Ready** → `Active`, **In Progress** → `Active`, **In Review** → `Resolved`, **Done** → `Closed`.
3. If using a custom process, verify these states exist. Azure DevOps built-in processes (Agile, Scrum, CMMI) include these states by default.
4. Store the state mapping in `board.statusOptions` for use by other board commands.

**If platform is `gitlab`:**

1. GitLab Boards use label-based lists. Create board lists for each status:
   ```bash
   glab api projects/{project_id}/boards/{board_id}/lists --method POST --field label_id={label_id}
   ```
2. Create scoped labels for each status first (see Step 2.3), then create board lists referencing those labels.
3. Required board lists: **Backlog** (`status::triage`), **Ready** (`status::ready`), **In Progress** (`status::in-progress`), **In Review** (`status::in-review`).
4. Store the board list IDs in `board.statusOptions`.

#### 2.3: Create Label Taxonomy

1. Read the label taxonomy from `board.labels` in `.agents/hatch.json`.
2. If labels are not defined or empty, use these defaults:

| Category  | Labels |
|-----------|--------|
| Type      | `type:bug`, `type:feature`, `type:refactor`, `type:qa`, `type:docs`, `type:infra` |
| Executor  | `executor:agent`, `executor:human`, `executor:hybrid` |
| Status    | `status:triage`, `status:ready`, `status:in-progress`, `status:in-review`, `status:blocked` |
| Priority  | `priority:p0`, `priority:p1`, `priority:p2`, `priority:p3` |
| Risk      | `risk:low`, `risk:med`, `risk:high` |
| Meta      | `meta:board-overview`, `has-dependencies` |

3. **Platform-specific: Label/tag creation**

   **If platform is `github`:**
   - For each label, check if it already exists using `gh label list -R {owner}/{repo}` (or `get_label` / `list_labels` MCP). Create only missing labels via `gh label create -R {owner}/{repo} --name "{label}" --color "{hex}"` (or `create_label` MCP).

   **If platform is `azure-devops`:**
   - Azure DevOps uses Tags on work items (no separate label creation step). Tags are created automatically when first applied to a work item. Note the intended tag taxonomy for use in subsequent commands.
   - For Area Paths, create them via: `az boards area project create --org https://dev.azure.com/{namespace} --project {project} --name "{area}"`.

   **If platform is `gitlab`:**
   - For each label, check if it already exists using `glab label list -R {namespace}/{project}`. Create only missing labels via `glab label create -R {namespace}/{project} --name "{label}" --color "{hex}"`.
   - Use GitLab scoped label format: `status::ready` instead of `status:ready`, `type::bug` instead of `type:bug`.
4. Use consistent colors per category:

| Category | Color scheme | Hex examples |
|----------|-------------|--------------|
| `type:*` | Blue shades | `#0052CC`, `#1D76DB`, `#5319E7`, `#0075CA`, `#006B75`, `#0E8A16` |
| `executor:*` | Green shades | `#0E8A16`, `#2EA44F`, `#7CFC00` |
| `status:*` | Yellow/Orange shades | `#FBCA04`, `#F9D0C4`, `#E4E669`, `#FFA500`, `#D93F0B` |
| `priority:*` | Red shades (p0 darkest) | `#B60205`, `#D93F0B`, `#E99695`, `#F9D0C4` |
| `risk:*` | Purple shades | `#5319E7`, `#7B68EE`, `#D4C5F9` |
| `meta:*` / `has-dependencies` | Gray | `#BFD4F2`, `#C5DEF5` |

5. If the user requested area labels (from Phase 1, step 1.3), create `area:{name}` labels for each (teal/cyan color, e.g., `#006B75`). Add area names to `board.areas` in the in-memory config.
   - **Azure DevOps:** Also create Area Paths via `az boards area project create`.

#### 2.4: Migrate from Existing Project

Skip if the user chose "no" in Phase 1, step 1.4.

**Platform-specific: Migration procedure**

**If platform is `github`:**

1. Query the source project to get all items:
   ```graphql
   query {
     node(id: "<source_project_id>") {
       ... on ProjectV2 {
         items(first: 100, after: <cursor>) {
           pageInfo { hasNextPage endCursor }
           nodes {
             id
             content { ... on Issue { id number title } ... on PullRequest { id number title } }
             fieldValues(first: 20) {
               nodes {
                 ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
               }
             }
           }
         }
       }
     }
   }
   ```
   Paginate until all items are retrieved. Resolve the source project node ID from the project number first (same approach as Step 2.1 Option B).
2. For each item with linked issue content, add it to the new project board via the `addProjectV2ItemById` mutation:
   ```graphql
   mutation { addProjectV2ItemById(input: { projectId: "<new_project_id>", contentId: "<issue_node_id>" }) { item { id } } }
   ```
3. Map the source project's status to the new project's status options (best-effort string matching: exact match first, then case-insensitive, then substring). Update each migrated item's status on the new board using the `updateProjectV2ItemFieldValue` mutation.
4. Report migration results in the execution log.

**If platform is `azure-devops`:**

1. Query work items from the source project: `az boards query --org https://dev.azure.com/{namespace} --project {source_project} --wiql "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems"`.
2. For each work item, create a copy in the target project: `az boards work-item create --org https://dev.azure.com/{namespace} --project {project} --type "User Story" --title "{title}" --description "{description}"`.
3. Map states from the source to the target project. Update each migrated item's state.
4. Report migration results.

**If platform is `gitlab`:**

1. List issues from the source project: `glab issue list -R {source_namespace}/{source_project} --all`.
2. For each issue, create a copy in the target project: `glab issue create -R {namespace}/{project} --title "{title}" --description "{description}" --label "{labels}"`.
3. Transfer labels and assignees. Update board labels to match the target board's lists.
4. Report migration results.

#### 2.5: Write Configuration Back

1. Prepare the updated config with all captured IDs:
   - **Top-level owner/repo:** Set if they were missing (per board-shared convention). Also set `board.owner`/`board.repo` for backward compatibility.
   - `board.defaultBranch` — from Phase 1 step 1.2b (default: `"main"`)
   - `board.projectNumber` — from the created/connected project
   - `board.statusFieldId` — from the Status field
   - `board.statusOptions.backlog` — option ID
   - `board.statusOptions.ready` — option ID
   - `board.statusOptions.inProgress` — option ID
   - `board.statusOptions.inReview` — option ID
   - `board.statusOptions.done` — option ID
   - `board.areas` — if area labels were created

2. Write the file. Preserve any keys outside the `board` section.

#### 2.6: Create Board Overview Issue

**Platform-specific: Search for existing overview issue**

**If platform is `github`:**
1. Search for an existing open issue labeled `meta:board-overview` via `gh search issues -R {owner}/{repo} "label:meta:board-overview state:open"` (fall back to `search_issues` MCP).

**If platform is `azure-devops`:**
1. Search for an existing work item tagged `meta:board-overview`: `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.Tags] CONTAINS 'meta:board-overview' AND [System.State] <> 'Closed'"`.

**If platform is `gitlab`:**
1. Search for an existing open issue labeled `meta:board-overview`: `glab issue list -R {namespace}/{project} --label "meta:board-overview" --state opened`.

2. **If found:** Skip creation. One board overview issue at a time. Proceed to Step 2.7.
3. **If not found:** Create a board overview issue:

   **If platform is `github`:** Use `gh issue create -R {owner}/{repo}` or `issue_write` MCP with `method: create`.
   **If platform is `azure-devops`:** Use `az boards work-item create --org https://dev.azure.com/{namespace} --project {project} --type "User Story" --title "..." --fields "System.Tags=meta:board-overview"`.
   **If platform is `gitlab`:** Use `glab issue create -R {namespace}/{project} --label "meta:board-overview"`.
   - **Title:** `[Board Overview] {repo} Project Board`
   - **Labels:** `meta:board-overview`
   - **Body:**

```markdown
## Board Overview

**Project:** {owner}/{repo}
**Last refreshed:** {current ISO date}

---

## Status Summary

| Status | Count |
|--------|-------|
| Backlog / Triage | 0 |
| Ready | 0 |
| In Progress | 0 |
| In Review | 0 |
| Externally Blocked | 0 |
| **Total Open** | **0** |

---

## Implementation Lanes

No ready issues yet. Run `board-fill` to populate the board.

---

*This issue is auto-maintained by hatch3r board commands. Do not close.*
```

4. If an issue was created in step 3, sync it to the board using the **Board Sync Procedure** from `hatch3r-board-shared` and set its status to **Backlog**.

#### 2.7: Summary

Print a complete summary:

```
Board Init Complete:
  Project: {owner}/{repo} (Project #{number})
  Status field: configured (5 options)
  Labels created: N new, M existing
  Areas: [list or "none"]
  Migration: N issues migrated from Project #X (or "skipped")
  Board overview: #{issueNumber}
  Config: .agents/hatch.json updated
```

---

## Error Handling

- **API/CLI failure:** Report the error and suggest checking authentication:
  - **GitHub:** Check GitHub PAT permissions (must include `project` scope for Projects V2). For gh CLI: run `gh auth refresh -s project`.
  - **Azure DevOps:** Check `az login` status or `AZURE_DEVOPS_PAT`. Verify organization/project access.
  - **GitLab:** Check `glab auth login` status or `GITLAB_TOKEN`. Verify project access.
- **Label/tag creation failure:** Report the failing label, continue with remaining labels. Summarize failures at end.
- **Migration failure:** Report per-item, continue with remaining items. Summarize at end.
- **Never create or mutate without user confirmation.**

## Guardrails

- **Never modify or delete existing labels/tags.** Only create missing ones.
- **Never remove issues/work items from existing projects.** Migration is additive only.
- **Collect all choices in Phase 1 before any mutations in Phase 2.**
- **Never skip Planning questions or the plan confirmation step.**
- **Require proper authentication** for the configured platform. If mutations fail with permission errors, surface platform-specific auth requirements.
- **Preserve existing `.agents/hatch.json` content** outside the `board` key when writing config back.
