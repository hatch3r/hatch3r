---
id: hatch3r-board-init
name: hatch3r-board-init
type: skill
description: Initialize a project board (GitHub Projects V2, Azure Boards, or GitLab Issue Boards) with hatch3r's label taxonomy, status fields, and board structure. Platform detected from hatch.json.
tags: [board, ctx:team-only]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.


## Integration with Platform Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above platform agentic workflows. While platform-native agentic workflows (GitHub Agentic Workflows, Azure DevOps automations, GitLab Auto DevOps) handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-groom** refines existing work items as priorities, scope, and dependencies evolve over time
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide

Platform agentic workflows and hatch3r are complementary: use platform workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` skill at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Quick / Defaults Mode

If the user requests quick mode, defaults mode, or passes a `--quick` or `--defaults` flag: use all auto-detected values without prompting and proceed directly to execution with a single confirmation. Specifically:

1. Auto-detect owner/repo from `.hatch3r/hatch.json` (skip ASK in 1.1).
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

### Step 0: Prerequisites

Run BEFORE Phase 1. Halt on the first failure with an actionable fix command. Do not prompt for board configuration choices until every prerequisite below succeeds.

1. **Run the shared Prerequisite Check.** Execute the `Prerequisite Check` block in `hatch3r-board-shared` §"Prerequisite Check (run at the start of every board command)" — verifies `.hatch3r/hatch.json` exists, owner/repo configured, and platform CLI authenticated (`gh auth status` / `az account show` / `glab auth status`).

2. **Verify platform credentials at the env-var layer.** The shared prereq check confirms the CLI is authenticated; this step additionally verifies the underlying credential is present for non-interactive runs:

   **If platform is `github`:**
   - Run `gh auth status` first. If the CLI is already authenticated with the `project` scope, the env var fallback is not required and this step passes.
   - If `gh auth status` fails or the `project` scope is missing, check for `GITHUB_TOKEN` (preferred for CI) or `GH_TOKEN`. If neither is set, ASK the user using the `agents/shared/user-question-protocol.md` plain-text fallback shape:

     ```
     **Question:** GitHub CLI is not authenticated and no GITHUB_TOKEN is set. How should I obtain credentials?

     1. Run `gh auth login` interactively now — opens the GitHub OAuth flow in your browser.
     2. Provide a Personal Access Token here — paste a PAT with the `project` scope; I will set GITHUB_TOKEN for this session only.
     3. Abort — exit and configure credentials externally; re-run `hatch3r-board-init` afterward.

     Default if no response: 1
     ```

   **If platform is `azure-devops`:**
   - Run `az account show`. If it fails, check for `AZURE_DEVOPS_PAT`. If neither is configured, ASK using the same plain-text fallback shape with options: (1) `az login` interactively, (2) provide AZURE_DEVOPS_PAT, (3) abort. Default: 1.

   **If platform is `gitlab`:**
   - Run `glab auth status`. If it fails, check for `GITLAB_TOKEN`. If neither is configured, ASK using the same plain-text fallback shape with options: (1) `glab auth login` interactively, (2) provide GITLAB_TOKEN, (3) abort. Default: 1.

3. **Verify owner/repo identity.** Read `.hatch3r/hatch.json` and confirm both top-level `owner`/`repo` (or `board.owner`/`board.repo` as fallback) are set and non-empty. If either is empty, ASK using the user-question-protocol plain-text fallback shape:

   ```
   **Question:** Owner/repo are not configured in `.hatch3r/hatch.json`. How should I capture them?

   1. Provide owner and repo now — paste in this turn; I will write them to `.hatch3r/hatch.json` after Phase 1 confirmation.
   2. Run `npx hatch3r config` first — abort, configure repo identity, then re-run `hatch3r-board-init`.

   Default if no response: 1
   ```

4. **Set pager-bypass env vars.** Before the first CLI invocation, export `GH_PAGER=cat` and `PAGER=cat` per `hatch3r-board-shared` §"Pager-Bypass Directive". Required for reliable `gh api --jq` output capture.

5. **Record prerequisite outcomes.** Write each check's outcome (passed / failed-then-resolved / aborted) to the run cache `errors` entry so the end-of-run summary can surface auth-related warnings.

This step is mandatory and non-skippable. Quick / Defaults Mode (§"Quick / Defaults Mode" above) skips Phase 1 ASKs but does NOT skip Step 0 — credential and identity verification run unconditionally before any board mutation.

---

### Phase 1 — Planning

Collect all configuration choices upfront. No GitHub API calls or file writes in this phase (except reads needed to present options).

#### 1.1: Read Configuration

1. Read `.hatch3r/hatch.json` and cache the `board` config.
2. Read `platform` from `.hatch3r/hatch.json`. Default to `github` if missing. Cache for the run.
3. Resolve owner/repo per `hatch3r-board-shared`: **Use top-level `owner`/`repo` first.** Fall back to `board.owner`/`board.repo` if top-level values are empty.
4. If both are set (from either source), note: "Using owner=`{owner}`, repo=`{repo}`, platform=`{platform}`."
5. If either is missing:

**ASK:** "I need the owner/namespace and repository/project for this board. Please provide: (1) owner (org/namespace/username), (2) repo/project name."

Update the in-memory config with the provided values.

#### 1.2: Choose Mode

**If platform is `github`:**
1. If `board.projectNumber` is already set in `.hatch3r/hatch.json`, default to **B** (Connect to existing project #{board.projectNumber}).
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

1. Auto-detect the default branch: run `git rev-parse --abbrev-ref origin/HEAD` and strip the `origin/` prefix. If the command fails (e.g., no remote configured), fall back to `board.defaultBranch` from `.hatch3r/hatch.json`, then to `"main"`.
2. Record the detected branch name. This value is written to `board.defaultBranch` and used by board-pickup (checkout, PR base) and other agents.

No separate prompt — the detected branch is included in the consolidated plan confirmation (Step 1.6).

#### 1.3: Area Labels

1. Auto-suggest area labels from the top-level source directories in the codebase. Scan the repository root and common source roots (`src/`, `packages/`, `apps/`) for top-level directories that represent distinct areas (e.g., `frontend`, `backend`, `api`, `infra`, `cli`, `docs`). Exclude non-area directories (`node_modules`, `.git`, `dist`, `build`, `.github`, `.hatch3r`, `coverage`, `__tests__`).
2. If `board.areas` already has entries in `.hatch3r/hatch.json`, use those as the default and note the source.
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

**--resume flag.** When invoked with `--resume`, board-init checks `board.workflows.itemClosedEnabled` in `.hatch3r/hatch.json`. If true, Phase 2.1 through 2.5 are skipped (project, status field, labels, migration, config write-back have already succeeded) and execution jumps directly to the workflow verification gate (§2.2 step 6 above) for the GitHub platform, then proceeds to §2.6 (Create Board Overview Issue) on success. If the gate still fails, the command re-halts with the same actionable message. Non-GitHub platforms ignore `--resume` and run Phase 2 normally.

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
4. Verify these status options exist on the field: **Backlog**, **Ready**, **In Progress**, **In Review**, **Done**.
   - For missing options, use the `updateProjectV2Field` mutation (or the appropriate mutation for adding options to a single-select field) to add them.
5. Capture the field ID and each option's ID.
6. **Programmatic workflow verification (GitHub only):** GitHub's GraphQL API does not expose a mutation to enable Projects V2 workflows (only `deleteProjectV2Workflow` is public), so this step verifies the required workflows exist and are enabled. If missing or disabled, the command halts with an actionable error and supports `--resume`.

   a. Query active workflows:
      ```graphql
      query {
        node(id: "<project_id>") {
          ... on ProjectV2 {
            workflows(first: 20) {
              nodes { id name enabled }
            }
          }
        }
      }
      ```
   b. Required workflows:
      - `name == "Item closed"` with `enabled == true`
      - `name == "Pull request merged"` with `enabled == true`
   c. If either is missing or disabled, halt with:
      > "GitHub Projects V2 requires these built-in workflows to keep board status in sync with issue/PR state, but the GraphQL API does not expose a mutation to enable them. Manual step required:
      >   1. Open https://github.com/<owner>/projects/<number>/workflows (use `orgs/<owner>` path for org-owned projects).
      >   2. Enable 'Item closed' -- map to Status = Done.
      >   3. Enable 'Pull request merged' -- map to Status = Done.
      >   4. Re-run: `hatch3r-board-init --resume`."
   d. On success, record in memory for the Phase 2.5 config write-back:
      - `board.workflows.itemClosedEnabled = true`
      - `board.workflows.pullRequestMergedEnabled = true`

**If platform is `azure-devops`:**

1. Azure Boards uses Work Item States (not a custom field). Verify the process template supports the required states by querying:
   ```bash
   az boards work-item type list --org https://dev.azure.com/{namespace} --project {project}
   ```
2. Map hatch3r statuses to Work Item States: **Backlog** → `New`, **Ready** → `Active`, **In Progress** → `Active`, **In Review** → `Resolved`, **Done** → `Closed`.
3. If using a custom process, verify these states exist. Azure DevOps built-in processes (Agile, Scrum, CMMI) include these states by default.
4. Store the state mapping in `board.statusOptions` for use by other board commands.
5. **Note — Ready vs. In Progress:** Azure DevOps built-in processes map both "Ready" and "In Progress" to the `Active` state. The distinction is maintained via hatch3r tags on work items. For board-level visibility, consider configuring Azure Boards column splits: in the Board Settings, split the "Active" column into "Active - Ready" and "Active - In Progress" using tag-based rules. Projects with custom Azure DevOps process templates can alternatively add a "Ready" state to the work item type.

**If platform is `gitlab`:**

1. GitLab Boards use label-based lists. Create board lists for each status:
   ```bash
   glab api projects/{project_id}/boards/{board_id}/lists --method POST --field label_id={label_id}
   ```
2. Create scoped labels for each status first (see Step 2.3), then create board lists referencing those labels.
3. Required board lists: **Backlog** (`status::triage`), **Ready** (`status::ready`), **In Progress** (`status::in-progress`), **In Review** (`status::in-review`), **Done** (`status::done`).
4. Store the board list IDs in `board.statusOptions`.
5. **Note — Labels not auto-updated on close:** GitLab does not update labels when an issue is auto-closed via `Closes #N`. The `status::in-review` scoped label will remain on closed issues. This drift is detected and fixed by `board-groom` during the `health-fix` action. For automated cleanup, consider setting up a GitLab CI pipeline trigger on issue close events to apply `status::done`. Note: scoped labels require GitLab **Premium or Ultimate** tier.

#### 2.3: Create Label Taxonomy

1. Read the label taxonomy from `board.labels` in `.hatch3r/hatch.json`.
2. If labels are not defined or empty, use these defaults:

| Category  | Labels |
|-----------|--------|
| Type      | `type:bug`, `type:feature`, `type:refactor`, `type:qa`, `type:docs`, `type:infra` |
| Executor  | `executor:agent`, `executor:human`, `executor:hybrid` |
| Status    | `status:triage`, `status:ready`, `status:in-progress`, `status:in-review`, `status:done`, `status:blocked` |
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
   - `board.workflows.itemClosedEnabled` -- from §2.2 step 6 (GitHub only; omit or set false on other platforms)
   - `board.workflows.pullRequestMergedEnabled` -- from §2.2 step 6 (GitHub only; omit or set false on other platforms)
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
  Config: .hatch3r/hatch.json updated
```

---

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (single-board scaffold with defaults): inline execution acceptable.
- Tier 2 (board + multiple lanes + seed issues): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-board or migration-from-existing init): one fresh sub-agent per board or lane; orchestrator integrates only.

Source: `.claude/rules/fan-out-discipline.md` (P8 B2); `agents/shared/efficiency-patterns.md`.

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
- **Preserve existing `.hatch3r/hatch.json` content** outside the `board` key when writing config back.
