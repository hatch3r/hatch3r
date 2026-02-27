---
id: hatch3r-board-init
type: command
description: Initialize a GitHub Projects V2 board with hatch3r's label taxonomy, status fields, and board structure. Optionally migrate issues from an existing project.
---
# Board Init -- Bootstrap a GitHub Projects V2 Board

Initialize a new or existing GitHub Projects V2 board for **{owner}/{repo}** (read from `/.agents/hatch.json` board config). Sets up status fields, creates the full hatch3r label taxonomy, optionally migrates issues from another project, and writes all IDs back to `/.agents/hatch.json` so subsequent board commands work out of the box. AI proposes configuration; user confirms before any mutation.

---

## Integration with GitHub Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above GitHub Agentic Workflows. While GitHub's agentic workflows handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide

GitHub Agentic Workflows and hatch3r are complementary: use agentic workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

This command runs in two phases: **Planning** (collect all answers) then **Execution** (perform all mutations). No mutations occur until the user confirms the full plan.

---

### Phase 1 — Planning

Collect all configuration choices upfront. No GitHub API calls or file writes in this phase (except reads needed to present options).

#### 1.1: Read Configuration

1. Read `/.agents/hatch.json` and cache the `board` config.
2. Resolve owner/repo per `hatch3r-board-shared`: **Use top-level `owner`/`repo` first.** Fall back to `board.owner`/`board.repo` if top-level values are empty.
3. If both are set (from either source), note: "Using owner=`{owner}`, repo=`{repo}`."
4. If either is missing:

**ASK:** "I need the GitHub owner and repository for this board. Please provide: (1) owner (org or username), (2) repo name."

Update the in-memory config with the provided values.

#### 1.2: Choose Mode

**ASK:** "How would you like to set up the Projects V2 board?
- **A** — Create a new GitHub Projects V2 board
- **B** — Connect to an existing project (provide the project number)"

Record the user's choice and, for option B, the project number.

#### 1.2a: Project Name (when Mode A — Create new)

If the user chose **A** (Create new):

**ASK:** "What should the GitHub Project be named? (default: {repo} Board)"

Record the project name. If the user accepts the default or leaves it blank, use `{repo} Board`.

#### 1.2b: Default Branch

**ASK:** "What is your repository's default branch? (default: main, or current: {board.defaultBranch} if set in hatch.json)"

Record the branch name. If the user accepts the default or leaves it blank, use `main` (or existing `board.defaultBranch` from `/.agents/hatch.json` if present). This value is written to `board.defaultBranch` and used by board-pickup (checkout, PR base) and other agents.

#### 1.3: Area Labels

**ASK:** "Would you like to create area labels? If yes, list area names (e.g., frontend, backend, infra). If no, I'll skip area labels."

#### 1.4: Migration

**ASK:** "Do you have an existing GitHub project to migrate issues from? (yes + project number / no)"

#### 1.5: Board Overview

A board overview issue (labeled `meta:board-overview`) will be created by default. No user prompt needed.

#### 1.6: Confirm Plan

Present the full plan summary:

```
Board Init Plan:
  Owner/Repo:     {owner}/{repo}
  Default branch: {defaultBranch}
  Mode:           {A: Create new / B: Connect to #{N}}
  Project name:   {project name, or "N/A" when Mode B}
  Status options:  Backlog, Ready, In Progress, In Review, Done
  Label taxonomy:  {count} labels (types, executors, statuses, priorities, risks, meta)
  Area labels:    {list or "none"}
  Migration:      {from Project #X / "none"}
  Board overview: yes (default)
```

**ASK:** "Here is the full board init plan. Confirm to begin execution, or adjust any setting."

---

### Phase 2 — Execution

Execute all planned mutations in sequence. No further questions unless a mutation fails.

#### 2.1: Create or Connect Project

##### Option A — Create New Project

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

##### Option B — Connect to Existing Project

1. Query the existing project:
   ```graphql
   query { user(login: "{owner}") { projectV2(number: {N}) { id number } } }
   ```
   Use `organization` instead of `user` if the owner is an org. Try `user` first; if it fails, retry with `organization`.
2. Capture the project `id` and `number`.

#### 2.2: Configure Status Field

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

#### 2.3: Create Label Taxonomy

1. Read the label taxonomy from `board.labels` in `/.agents/hatch.json`.
2. If labels are not defined or empty, use these defaults:

| Category  | Labels |
|-----------|--------|
| Type      | `type:bug`, `type:feature`, `type:refactor`, `type:qa`, `type:docs`, `type:infra` |
| Executor  | `executor:agent`, `executor:human`, `executor:hybrid` |
| Status    | `status:triage`, `status:ready`, `status:in-progress`, `status:in-review`, `status:blocked` |
| Priority  | `priority:p0`, `priority:p1`, `priority:p2`, `priority:p3` |
| Risk      | `risk:low`, `risk:med`, `risk:high` |
| Meta      | `meta:board-overview`, `has-dependencies` |

3. For each label, check if it already exists on the repository using `get_label` (or `list_labels` to fetch all at once). Create only missing labels via `create_label`.
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

#### 2.4: Migrate from Existing Project

Skip if the user chose "no" in Phase 1, step 1.4.

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

1. Search for an existing open issue labeled `meta:board-overview` via `search_issues` with `owner: {board.owner}`, `repo: {board.repo}`, query `label:meta:board-overview state:open`.
2. **If found:** Skip creation. One board overview issue at a time. Proceed to Step 2.7.
3. **If not found:** Create an issue via `issue_write` with `method: create`, `owner: {board.owner}`, `repo: {board.repo}`:
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

4. If an issue was created in step 3, add it to the project board and set its status to **Backlog** using the Projects v2 Sync Procedure from `hatch3r-board-shared`.

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
  Config: /.agents/hatch.json updated
```

---

## Error Handling

- **GraphQL mutation failure:** Report the error and suggest checking GitHub PAT permissions (must include `project` scope for Projects V2 operations). For gh CLI: run `gh auth refresh -s project`.
- **Label creation failure:** Report the failing label, continue with remaining labels. Summarize failures at end.
- **Migration failure:** Report per-item, continue with remaining items. Summarize at end.
- **Never create or mutate without user confirmation.**

## Guardrails

- **Never modify or delete existing labels.** Only create missing ones.
- **Never remove issues from existing projects.** Migration is additive only.
- **Collect all choices in Phase 1 before any mutations in Phase 2.**
- **Never skip Planning questions or the plan confirmation step.**
- **Require `project` scope** on the GitHub token for Projects V2 operations. If mutations fail with permission errors, surface this requirement. For gh CLI (used by board-fill, board-pickup, etc.): run `gh auth refresh -s project`.
- **Preserve existing `/.agents/hatch.json` content** outside the `board` key when writing config back.
