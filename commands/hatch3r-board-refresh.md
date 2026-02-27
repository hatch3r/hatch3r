---
id: hatch3r-board-refresh
type: command
description: Regenerate the living board overview dashboard from current board state. Scans all open issues, computes health metrics, and updates the meta:board-overview issue.
---
# Board Refresh -- Regenerate the Board Overview Dashboard

Scan all open issues on **{owner}/{repo}** (read from `/.agents/hatch.json` board config), compute board health metrics, build implementation lanes from dependency analysis, and regenerate the `meta:board-overview` dashboard issue with current data, model recommendations, and health diagnostics. This is a lightweight, read-heavy command -- the only mutation is updating (or creating) the single board overview issue.

---

## Integration with GitHub Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above GitHub Agentic Workflows. While GitHub's agentic workflows handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide
- **board-refresh** regenerates the living dashboard on demand without running a full board command

GitHub Agentic Workflows and hatch3r are complementary: use agentic workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, GitHub Context, Project Reference, Projects v2 sync procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

Execute these steps in order. **Do not skip any step.**

### Step 1: Read Configuration

1. Read `/.agents/hatch.json` and cache the full config (top-level `owner`/`repo` and `board` section).
2. Resolve owner/repo per `hatch3r-board-shared`: use top-level `owner`/`repo` first, fall back to `board.owner`/`board.repo` if top-level values are empty.
3. If both are missing, abort with: "Cannot refresh board -- owner and repo are not configured in `/.agents/hatch.json`. Run `board-init` first."
4. Note `board.projectNumber` -- if null, Projects v2 sync will be skipped later.

---

### Step 2: Full Board Scan

Perform ONE comprehensive scan and cache everything for subsequent steps.

#### 2a. Fetch Open Issues

1. Fetch ALL open issues: `gh issue list -R {owner}/{repo} --state open --limit 500 --json number,title,labels,state,createdAt,updatedAt,body`. Paginate if necessary. Fall back to `list_issues` MCP if gh CLI fails.
2. For each issue, extract labels from the JSON response.
3. Check for sub-issues: `issue_read` with `method: get_sub_issues` for any issue that appears to be an epic (has sub-issues or is referenced as a parent). Cache parent-child relationships.
4. Parse `## Dependencies` sections from issue bodies for dependency references. Recognize both hard (`Blocked by #N`, `Depends on #N`) and soft (`Recommended after #N`) dependency types. Track the type for each edge in the dependency graph -- only hard dependencies block pickup and exclude issues from Implementation Lanes.
5. **Exclude** any issue labeled `meta:board-overview` from all analysis and listings.

#### 2b. Categorize Issues

Classify every open issue (excluding `meta:board-overview`):

- **Epic** -- has sub-issues
- **Sub-issue** -- is a child of an epic
- **Standalone** -- neither parent nor child

---

### Step 3: Compute Board Health & Metrics

Analyze cached data to produce board health diagnostics.

#### 3a. Status Distribution

Count issues per status label:

| Status | Source |
| --- | --- |
| Backlog / Triage | Issues with `status:triage` |
| Ready | Issues with `status:ready` |
| In Progress | Issues with `status:in-progress` |
| In Review | Issues with `status:in-review` |
| Externally Blocked | Issues with `status:blocked` |

#### 3b. Missing Metadata Detection

For each open issue, check for required labels. Flag issues missing any of:

- `type:*` (at least one type label)
- `priority:*` (at least one priority label)
- `executor:*` (at least one executor label)

Optional but noted: missing `area:*`, missing `risk:*`.

#### 3c. Dependency Health

1. Build a dependency graph from parsed `## Dependencies` sections.
2. Identify **blocked chains**: issues with unsatisfied blockers (blocker is still open).
3. Count issues with `has-dependencies` label.
4. **Epic ordering consistency**: For each epic, compare its `## Implementation Order` levels against the DAG derived from its sub-issues' `## Dependencies` sections. Flag epics where the two diverge (e.g., a sub-issue's `## Dependencies` lists a blocker not reflected in the epic's level ordering, or the epic lists a level order that contradicts the dependency DAG). Report discrepancies in Board Health.
5. **Cross-epic dependencies**: Scan hard dependencies (`Blocked by #N`) where the blocking issue and the dependent issue belong to different epics. Aggregate these into epic-level relationships: "Epic A blocks Epic B via sub-issue #X blocking sub-issue #Y." Collect for the Cross-Epic Dependencies section of the overview.

#### 3d. Stale Issue Detection

Flag open issues that are potentially stale:

- `status:triage` with no update in 14+ days (based on `updatedAt`).
- `status:in-progress` with no update in 7+ days (may be abandoned).

#### 3e. Lane Computation & Dependency-Waiting Partition

Compute Implementation Lanes and the Waiting on Dependencies list for all `status:ready` issues using the **Lane Computation Algorithm** from `hatch3r-board-shared`. Use the dependency graph built in Step 3c as input. The algorithm partitions ready issues into available (all blockers satisfied) and dependency-waiting (unsatisfied blockers), then computes lanes only from available issues.

---

### Step 4: Regenerate Board Overview

Build the dashboard body following the **Board Overview Issue Format** and **Model Selection Heuristic** from `hatch3r-board-shared`.

#### 4a. Model Assignment

For each open issue, assign a recommended model using the **Model Selection Heuristic (Quality-First)** from `hatch3r-board-shared`. Apply that heuristic as the single source of truth; do not duplicate it here.

#### 4b. Compose Dashboard Body

Assemble the dashboard using the **Board Overview Issue Format** template from `hatch3r-board-shared`. Populate it with:

1. **Status Summary** from Step 3a counts.
2. **In Progress** and **In Review** from cached issues with the corresponding status labels.
3. **Implementation Lanes** from Step 3e lane computation results (available issues only).
4. **Cross-Epic Dependencies** from Step 3c cross-epic dependency scan (omit if none).
5. **Waiting on Dependencies** from Step 3e partition results (dependency-waiting issues: `status:ready` with unsatisfied hard blockers).
6. **Externally Blocked** from cached issues with `status:blocked`.
7. **Backlog / Triage** from cached issues with `status:triage`.
8. **Board Health** from Steps 3b (missing metadata), 3d (stale issues), 3c (blocked chains, epic ordering discrepancies).

---

### Step 5: Update Overview Issue

#### 5a. Find Existing Overview Issue

Search the cached board inventory for an open issue labeled `meta:board-overview`.

**If multiple found:** Use the one with the lowest issue number (oldest). Warn: "Multiple board overview issues found (#{N}, #{M}). Updating #{lowest}. Consider closing duplicates."

#### 5b. Update or Create

**If found:** Update the issue body:

```bash
gh issue edit {number} -R {owner}/{repo} --body "{generated dashboard body}"
```

Fall back to `issue_write` MCP with `method: update` if gh CLI fails.

**If not found:** Create a new board overview issue:

```bash
gh issue create -R {owner}/{repo} --title "[Board Overview] {repo} Project Board" --label "meta:board-overview" --body "{generated dashboard body}"
```

Fall back to `issue_write` MCP with `method: create` if gh CLI fails.

Then add the new issue to the project board and set its status to **Backlog** using the **Projects v2 Sync Procedure** from `hatch3r-board-shared`.

#### 5c. Summary

Present a confirmation:

```
Board Refresh Complete:
  Project:        {owner}/{repo}
  Overview issue: #{number} (updated / created)
  Open issues:    {total} ({epics} epics, {sub} sub-issues, {standalone} standalone)
  Status:         {ready} ready ({available} available, {depWaiting} waiting on deps), {inProgress} in progress, {inReview} in review, {blocked} ext. blocked, {triage} triage
  Lanes:          {laneCount} parallel lanes ({available} available issues)
  Health:         {N} issues missing metadata, {M} stale, {K} blocked chains
```

---

## Error Handling

- **`gh issue list` failure:** Retry once, then fall back to `list_issues` MCP. If both fail, abort with: "Cannot scan board -- check `gh auth login` status and repository access."
- **`gh issue edit` / `gh issue create` failure:** Retry once, then fall back to `issue_write` MCP. If both fail, present the generated dashboard body to the user so they can update the issue manually.
- **`issue_read` (sub-issues) failure:** Warn and continue. Epic/sub-issue relationships will be incomplete; note in the summary.
- **Projects v2 sync failure (new overview issue only):** Warn and continue. The issue is created but not added to the project board.

## Guardrails

- **Never modify any issue other than the `meta:board-overview` issue.** This command is read-only for all other issues.
- **Exclude the board overview issue from its own listings.** It must never appear in any status table.
- **One board overview issue at a time.** If multiple are found, update the oldest and warn about duplicates.
- **Follow the GitHub CLI-first approach** from `hatch3r-board-shared`. Use `gh` CLI as primary; MCP as fallback.
- **No ASK checkpoints.** This command performs a single, non-destructive mutation (updating the dashboard). It runs to completion without user prompts.
- **Respect the Model Selection Heuristic.** Always include the `Model` column using the quality-first heuristic from `hatch3r-board-shared`.
