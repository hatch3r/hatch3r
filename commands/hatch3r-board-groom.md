---
id: hatch3r-board-groom
type: command
description: Ongoing backlog refinement for existing board items. Re-prioritize, reclassify, re-scope, archive stale items, decompose oversized issues, merge duplicates, refresh dependencies, and remediate board health findings.
---

## Agent Pipeline

This command runs as a single orchestrator without sub-agent delegation.

All board operations MUST follow the Board Sync Enforcement rules defined in `hatch3r-board-shared`.

# Board Groom -- Backlog Refinement for Existing Issues

Perform ongoing backlog grooming on **{owner}/{repo}** (read from `.agents/hatch.json` board config). Scans all open issues, surfaces health-driven refinement suggestions, and lets the user selectively apply grooming actions: re-prioritize, reclassify, re-scope, demote, archive, decompose, merge duplicates, refresh dependencies, and remediate board health gaps. Unlike `board-fill` (which ingests new work from `todo.md`), board-groom operates exclusively on existing board items. Unlike `board-refresh` (which is read-only), board-groom mutates issues based on user-confirmed decisions.

---

## Integration with GitHub Agentic Workflows

hatch3r's board commands operate as the **implementation orchestration layer** above GitHub Agentic Workflows. While GitHub's agentic workflows handle continuous automation (triage, testing, documentation), hatch3r's board commands orchestrate the full delivery pipeline:

- **board-init** sets up the project management structure that agentic workflows operate within
- **board-fill** creates the work items that agentic workflows can triage and label
- **board-groom** refines existing work items as priorities, scope, and dependencies evolve over time
- **board-pickup** orchestrates the implementation -> review -> merge pipeline that goes beyond what generic agentic workflows provide
- **board-refresh** regenerates the living dashboard on demand without running a full board command

GitHub Agentic Workflows and hatch3r are complementary: use agentic workflows for continuous background automation, use hatch3r board commands for structured delivery orchestration.

---

## Shared Context

**Read the `hatch3r-board-shared` command at the start of the run.** It contains Board Configuration, Platform Detection, Platform Context, Board Sync Procedure, and tooling directives. Cache all values for the duration of this run.

## Token-Saving Directives

Follow the **Token-Saving Directives** in `hatch3r-board-shared`.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Read Configuration

1. Read `.agents/hatch.json` and cache the full config (top-level `owner`/`repo`, `platform`, and `board` section).
2. Read `platform` from `.agents/hatch.json`. Default to `github` if missing.
3. Resolve owner/repo per `hatch3r-board-shared`: use top-level `owner`/`repo` first, fall back to `board.owner`/`board.repo` if top-level values are empty.
4. If both are missing, abort with: "Cannot groom board -- owner and repo are not configured in `.agents/hatch.json`. Run `board-init` first."
5. Note `board.projectNumber` -- if null, board sync will be skipped later.

---

### Step 2: Full Board Scan

Perform ONE comprehensive scan and cache everything for subsequent steps.

#### 2a. Fetch Open Issues / Work Items

**Platform-specific: Fetch all open items**

**If platform is `github`:**
1. Fetch ALL open issues: `gh issue list -R {owner}/{repo} --state open --limit 500 --json number,title,labels,state,createdAt,updatedAt,body`. Paginate if necessary. Fall back to `list_issues` MCP if gh CLI fails.

**If platform is `azure-devops`:**
1. Fetch ALL active work items: `az boards query --org https://dev.azure.com/{namespace} --project {project} --wiql "SELECT [System.Id], [System.Title], [System.State], [System.Tags], [System.CreatedDate], [System.ChangedDate], [System.Description] FROM WorkItems WHERE [System.State] <> 'Closed' AND [System.State] <> 'Removed'"`. Fall back to `list_work_items` MCP.

**If platform is `gitlab`:**
1. Fetch ALL open issues: `glab issue list -R {namespace}/{project} --state opened --per-page 100`. Paginate if necessary.

2. For each issue/work item, extract labels/tags from the response.
3. Check for sub-issues/child work items:
   - **GitHub:** `issue_read` with `method: get_sub_issues`.
   - **Azure DevOps:** `az boards work-item relation list --id N` to find parent-child relations.
   - **GitLab:** `glab api projects/{project_id}/issues/{N}/links` for related issues.
   Cache parent-child relationships.
4. Parse `## Dependencies` sections from issue bodies for dependency references. Recognize both hard (`Blocked by #N`, `Depends on #N`) and soft (`Recommended after #N`) dependency types. Track the type for each edge in the dependency graph -- only hard dependencies block pickup.
5. **Exclude** any issue labeled `meta:board-overview` from all analysis and listings.

#### 2b. Categorize Issues

Classify every open issue (excluding `meta:board-overview`):

- **Epic** -- has sub-issues
- **Sub-issue** -- is a child of an epic
- **Standalone** -- neither parent nor child

---

### Step 3: Compute Board Health & Surface Refinement Opportunities

Analyze cached data to produce actionable refinement suggestions. This step combines diagnostic detection (same as `board-refresh`) with grooming-specific analysis.

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

#### 3c. Stale Issue Detection

Flag open issues that are potentially stale:

- `status:triage` with no update in 14+ days (based on `updatedAt`).
- `status:in-progress` with no update in 7+ days (may be abandoned).
- `status:ready` with no update in 30+ days (may be deprioritized or obsolete).

#### 3d. Dependency Health

1. Build a dependency graph from parsed `## Dependencies` sections.
2. Identify **stale dependency references**: issues referencing closed blockers in `## Dependencies` that should be cleaned up (the `Blocked by #N` is satisfied but the text remains).
3. Identify **orphaned blockers**: issues with `has-dependencies` label but no `## Dependencies` section, or an empty section.
4. Identify **blocked chains**: open issues with unsatisfied blockers where the blocker is also blocked, creating a chain.
5. **Epic ordering consistency**: For each epic, compare its `## Implementation Order` levels against the DAG derived from its sub-issues' `## Dependencies` sections. Flag epics where the two diverge.
6. **Cross-epic dependencies**: Scan hard dependencies where the blocking issue and the dependent issue belong to different epics.

#### 3e. Priority Imbalance Detection

Analyze the distribution of priority labels across the board:

- Flag if >50% of issues are `priority:p0` or `priority:p1` (priority inflation).
- Flag if all issues share the same priority (undifferentiated backlog).
- Flag issues where priority does not align with risk (e.g., `priority:p3` + `risk:high`).

#### 3f. Grouping Opportunities

Scan existing standalone issues for potential epic grouping:

- 2+ standalone issues sharing the same `area:*` labels.
- 2+ standalone issues with semantically similar titles or overlapping scope.

#### 3g. Decomposition Candidates

Flag issues that may be oversized:

- Issues with 5+ acceptance criteria.
- Issues touching 3+ distinct `area:*` labels.
- Issues whose body exceeds ~2000 characters (heuristic for scope sprawl).

#### 3h. Duplicate Detection

Compare existing open issues pairwise for semantic overlap:

- Same `area:*` + similar title keywords.
- Overlapping acceptance criteria.
- Cross-reference `## Scope` sections for boundary collisions.

#### 3i. Present Refinement Summary

Present findings grouped by category:

```
Board Groom — Refinement Summary:

Board Health:
  Total open issues: N (X epics, Y sub-issues, Z standalone)
  Missing metadata: M issues (details below)
  Stale issues: S issues
  Stale dependency refs: D issues
  Priority imbalance: {description or "None"}
  Epic ordering discrepancies: E epics

Grooming Opportunities:
  Re-prioritize candidates: R issues (priority/risk misalignment, priority inflation)
  Archive candidates: A issues (stale, likely obsolete)
  Decomposition candidates: C issues (oversized)
  Grouping candidates: G standalone issues → potential epics
  Duplicate/overlap candidates: O issue pairs
  Dependency cleanup: K issues (stale refs, orphaned labels)

Available actions: [reprioritize | reclassify | re-scope | demote | archive | decompose | merge | dep-refresh | health-fix | all]
```

**ASK:** "Here is the board refinement summary. Which grooming actions do you want to perform? Select one or more: reprioritize / reclassify / re-scope / demote / archive / decompose / merge / dep-refresh / health-fix / all. You can also specify issue numbers to target specific items (e.g., 'reprioritize #5, #12')."

---

### Step 4: Execute Selected Grooming Actions

Execute only the actions the user selected. Each action is a self-contained sub-step with its own ASK checkpoint. If the user selected "all", execute every action in the order listed below.

---

#### 4a. Re-prioritize

Change `priority:*` labels on existing issues based on current context.

1. Present re-prioritize candidates from Step 3e (priority/risk misalignment, priority inflation) plus any user-specified issues.
2. For each candidate, show current priority, risk, type, and a one-line rationale for the suggested change.

```
Re-prioritize Candidates:

| # | Title | Current | Suggested | Rationale |
|---|-------|---------|-----------|-----------|
| #N | {title} | P3 | P1 | risk:high but lowest priority; security-adjacent |
| #M | {title} | P0 | P2 | no longer critical after #K shipped |
```

**ASK:** "Confirm or adjust priority changes. Enter issue numbers with new priorities (e.g., '#5 → P1, #12 → P3'), or 'confirm all' / 'skip'."

3. Apply confirmed changes using platform CLI:
   - **GitHub:** `gh issue edit N --remove-label "priority:pN" --add-label "priority:pM"` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id N --fields "System.Tags=..."` (update tag string).
   - **GitLab:** `glab issue update N --unlabel "priority::pN" --label "priority::pM"`.

---

#### 4b. Reclassify

Update `type:*`, `executor:*`, `risk:*`, or `area:*` labels on existing issues.

1. Present reclassification candidates:
   - Issues where executor may have shifted (e.g., originally `executor:agent` but issue body reveals human decisions needed → suggest `executor:hybrid`).
   - Issues where risk assessment has changed (e.g., a dependency was removed, reducing risk).
   - Issues where type may be wrong (e.g., labeled `type:feature` but reads as a refactor).
2. For each candidate, show current labels and suggested changes with rationale.

**ASK:** "Confirm or adjust reclassifications. Enter changes per issue (e.g., '#5 executor:hybrid, #12 risk:low'), or 'confirm all' / 'skip'."

3. Apply confirmed changes using platform CLI:
   - **GitHub:** `gh issue edit N --remove-label "..." --add-label "..."` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id N --fields "System.Tags=..."`.
   - **GitLab:** `glab issue update N --unlabel "..." --label "..."`.

---

#### 4c. Re-scope

Update acceptance criteria, `## Scope` sections, and issue body content for existing issues. This uses the same triage questioning framework as `board-fill` Step 2.5 but applied to existing issues.

1. Present re-scope candidates: user-specified issues, or issues flagged in Step 3g (decomposition candidates whose scope needs tightening rather than splitting).
2. For each candidate, display the current acceptance criteria and scope section.

**ASK:** "Which issues need re-scoping? For each, I'll ask targeted questions to refine scope and acceptance criteria."

3. For each confirmed issue, run triage questioning across the six dimensions (Scope/Definition, Value/Why, Unknowns/Spikes, External Blockers, Size/Decomposition, User/Stakeholder). Ask only about dimensions that appear unclear or outdated. Batch issues by theme.

4. Update the issue/work item body with refined acceptance criteria and scope. Preserve all other body sections.
   - **GitHub:** `gh issue edit N --body "..."` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id N --description "..."`.
   - **GitLab:** `glab issue update N --description "..."`.

---

#### 4d. Demote to Triage

Send `status:ready` issues back to `status:triage` when they need rework. This is the one grooming action that deliberately relaxes the "never downgrade status" guardrail from `board-fill`.

1. Present demotion candidates: issues the user specified, or issues where the readiness assessment from `board-fill` Step 5.6 criteria would now fail (e.g., acceptance criteria are stale, scope has shifted, unresolved unknowns emerged).
2. For each candidate, explain why demotion is recommended.

```
Demotion Candidates:

| # | Title | Current Status | Reason |
|---|-------|----------------|--------|
| #N | {title} | status:ready | AC reference API that was redesigned in #K |
| #M | {title} | status:ready | scope expanded beyond original estimate |
```

**ASK:** "Confirm demotion for these issues. They will return to `status:triage` and need re-filling via `board-fill` before pickup. Confirm / adjust / skip."

3. Apply confirmed demotions using platform CLI. Sync board status to Backlog.
   - **GitHub:** `gh issue edit N --remove-label "status:ready" --add-label "status:triage"`. Sync Projects V2 status.
   - **Azure DevOps:** `az boards work-item update --id N --state "New"` and update tags.
   - **GitLab:** `glab issue update N --unlabel "status::ready" --label "status::triage"`.

---

#### 4e. Archive Stale Items

Close issues that are no longer relevant or have been superseded.

1. Present archive candidates from Step 3c (stale issues) plus any user-specified issues.
2. For each candidate, show last update date, current status, and staleness reason.

```
Archive Candidates:

| # | Title | Status | Last Updated | Staleness |
|---|-------|--------|--------------|-----------|
| #N | {title} | triage | 45 days ago | No activity since creation |
| #M | {title} | in-progress | 21 days ago | Possibly abandoned |
```

**ASK:** "Which issues should be archived (closed)? I'll add a 'Closed as stale during board grooming' comment before closing. Enter issue numbers, 'all', or 'skip'. Issues marked in-progress will require explicit confirmation."

3. For each confirmed archive:
   - Add a comment: `Closed during board grooming — {reason}. Reopen if still relevant.`
   - Close the issue/work item using platform CLI:
     - **GitHub:** `gh issue close N` (fall back to `issue_write` MCP with `state: CLOSED`).
     - **Azure DevOps:** `az boards work-item update --id N --state "Closed"`.
     - **GitLab:** `glab issue close N -R {namespace}/{project}`.
   - If the issue was a sub-issue of an epic, note the change on the parent epic.

---

#### 4f. Decompose

Break down oversized issues into smaller sub-issues.

1. Present decomposition candidates from Step 3g plus any user-specified issues.
2. For each candidate, analyze the issue body and propose specific sub-issues with one-line descriptions. Follow the same decomposition logic as `board-fill` Step 5c:
   - Split along area boundaries when multiple areas are touched.
   - Split along acceptance criteria clusters when criteria fall into distinct shippable groups.
   - Respect user-stated MVP slices from original triage context if available in the issue body.

3. Present decomposition proposals:

```
Decomposition — #N: {title}

Proposed sub-issues:
  1. {sub-issue title} — {one-line scope}
  2. {sub-issue title} — {one-line scope}
  3. {sub-issue title} — {one-line scope}

The original issue becomes the parent epic.
```

**ASK:** "Confirm decomposition for each issue, or adjust sub-issue breakdown. Confirm / modify / skip per issue."

4. For confirmed decompositions:
   - If the original is standalone, convert it to an epic by updating its body with `## Implementation Order` and adding sub-issue links.
   - Create sub-issues and link to parent using platform CLI:
     - **GitHub:** Create via `gh issue create` or `issue_write` MCP. Link via `sub_issue_write` MCP.
     - **Azure DevOps:** Create via `az boards work-item create`. Link via `az boards work-item relation add --relation-type "System.LinkTypes.Hierarchy-Forward"`.
     - **GitLab:** Create via `glab issue create`. Link via `glab api` issue links endpoint.
   - Inherit labels/tags from the parent. Add `## Dependencies` sections.
   - Sync new sub-issues to the board via the **Board Sync Procedure** from `hatch3r-board-shared`.

---

#### 4g. Merge Duplicates

Combine overlapping issues discovered after initial dedup.

1. Present duplicate/overlap candidates from Step 3h.
2. For each pair, show both issues side by side: title, labels, acceptance criteria overlap, scope overlap.

**ASK:** "For each pair: (a) merge into one (specify which survives), (b) keep both, (c) convert one to sub-issue of the other. Enter decisions per pair."

3. For confirmed merges:
   - Transfer unique acceptance criteria from the closing issue to the surviving issue.
   - Transfer any labels the surviving issue lacks.
   - Add a comment on the closing issue: `Merged into #N during board grooming.`
   - Close the duplicate using platform CLI:
     - **GitHub:** `gh issue close N`.
     - **Azure DevOps:** `az boards work-item update --id N --state "Closed"`.
     - **GitLab:** `glab issue close N -R {namespace}/{project}`.
   - If any other issue references the closed duplicate in `## Dependencies`, update those references to point to the surviving issue.

---

#### 4h. Dependency Refresh

Re-analyze and clean up dependency data based on current board state.

1. **Clean stale references:** For issues referencing closed blockers, remove the satisfied `Blocked by #N` lines from `## Dependencies` (the blocker is done, the reference is noise). Replace with `None` if no other dependencies remain.
2. **Fix orphaned labels:** For issues with `has-dependencies` label but empty or missing `## Dependencies`, either add the section or remove the label.
3. **Discover new dependencies:** Analyze the current board for producer/consumer relationships that weren't captured in the original fill. Propose new dependency edges.
4. **Recompute epic ordering:** For epics with stale `## Implementation Order` sections (flagged in Step 3d), regenerate the section from sub-issues' `## Dependencies` DAG.
5. **Unblock newly available items:** After cleaning stale refs, identify issues that were previously dependency-waiting but are now available (all blockers closed). Note these for the user.

Present all proposed changes:

```
Dependency Refresh:

Stale references to remove:
  #N — remove "Blocked by #K" (K is closed)
  #M — remove "Blocked by #J" (J is closed) → section becomes "None"

Orphaned labels to fix:
  #P — has "has-dependencies" but no ## Dependencies section → remove label

New dependencies discovered:
  #Q should be "Blocked by #R" (Q consumes API that R creates)

Epic ordering to regenerate:
  Epic #S — sub-issue deps diverge from ## Implementation Order

Newly unblocked:
  #T — was waiting on #K (now closed) → available for pickup
```

**ASK:** "Confirm dependency changes. Adjust / confirm all / skip."

6. Apply confirmed changes using platform CLI:
   - **GitHub:** `gh issue edit N --body "..."`, add/remove labels via `gh issue edit N --add-label / --remove-label`.
   - **Azure DevOps:** `az boards work-item update --id N --description "..."`, update tags.
   - **GitLab:** `glab issue update N --description "..."`, update labels.
   Regenerate `## Implementation Order` for affected epics.

---

#### 4i. Health Fix (Board Health Remediation)

Fix structural gaps detected in Step 3b (missing metadata).

1. For each issue with missing required labels, infer the missing labels from issue content using the same classification tables as `board-fill` Step 3:
   - Missing `type:*` → infer from title/body keywords.
   - Missing `priority:*` → default `priority:p2` unless urgency signals suggest otherwise.
   - Missing `executor:*` → infer from scope complexity.
   - Missing `area:*` → infer from file paths, modules, or subsystems mentioned.
   - Missing `risk:*` → infer from scope, dependencies, and architectural impact.

2. Present inferred labels:

```
Health Fix — Missing Metadata:

| # | Title | Missing | Inferred |
|---|-------|---------|----------|
| #N | {title} | priority | priority:p2 (no urgency signals) |
| #M | {title} | type, executor | type:feature, executor:agent (clear scope) |
```

**ASK:** "Confirm or adjust inferred labels. Enter corrections per issue, or 'confirm all' / 'skip'."

3. Apply confirmed labels/tags using platform CLI:
   - **GitHub:** `gh issue edit N --add-label "..."` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id N --fields "System.Tags=..."`.
   - **GitLab:** `glab issue update N --label "..."`.

---

### Step 5: Readiness Re-evaluation

After all grooming actions are applied, re-evaluate readiness for all affected issues.

1. Collect all issues modified during Step 4.
2. For each modified issue currently at `status:triage`, check all readiness criteria from `board-fill` Step 5.6 (structural + substantive). If all criteria are met, propose promoting to `status:ready`.
3. For each modified issue currently at `status:ready`, verify readiness criteria still hold after the changes. If criteria no longer hold (e.g., scope was expanded but acceptance criteria weren't updated), flag but do **not** auto-demote -- demotion requires explicit user action via Step 4d.

Present readiness changes:

```
Readiness Re-evaluation:

Promote to ready:
  #N — all structural + substantive criteria met after health fix

Readiness warnings (still ready, but verify):
  #M — priority changed from P3 to P1; confirm AC still reflect the higher urgency
```

**ASK:** "Confirm readiness promotions and acknowledge warnings. Confirm / adjust / skip."

4. Apply confirmed promotions: remove `status:triage`, add `status:ready`. Sync Projects v2 status.

---

### Step 6: Apply Changes & Sync Board

For every issue/work item whose labels or status changed during Steps 4-5:

1. **Sync board status:** Run the full **Board Sync Procedure** from `hatch3r-board-shared` for each issue with a status label change. Map the new status label to the corresponding board status.
2. **Sync other board fields:** If priority, area, or other mapped fields changed, update those fields on the board as well (per the enforcement rules in `hatch3r-board-shared`).
3. **Track item IDs:** Cache board item IDs for all synced issues to avoid re-resolution within this run.

---

### Step 7: Refresh Board Dashboard

**This step is mandatory. Do not skip.**

1. Search the cached board inventory for an open issue labeled `meta:board-overview`.
2. Compute Implementation Lanes using the **Lane Computation Algorithm** from `hatch3r-board-shared`. Use the dependency graph from Step 3d, updated with mutations from Step 4, as input.
3. Assign models to all open issues using the **Model Selection Heuristic (Quality-First)** from `hatch3r-board-shared`.
4. **If found:** Regenerate the dashboard body using the **Board Overview Issue Format** template from `hatch3r-board-shared`, populated with cached board data updated with all mutations from Steps 4-6. Update using platform CLI:
   - **GitHub:** `gh issue edit {N} --body "..."` (fall back to `issue_write` MCP).
   - **Azure DevOps:** `az boards work-item update --id {N} --description "..."`.
   - **GitLab:** `glab issue update {N} --description "..."`.
5. **If not found:** Create a new board overview issue using the **Board Overview Issue Format** template, populated with current board data. Label/tag it `meta:board-overview` and sync to the board.

Do NOT re-fetch all issues; use cached data updated with this run's mutations.

---

### Step 8: Groom Summary

Present a summary of all changes made during this grooming session:

```
Board Groom Complete:
  Project:            {owner}/{repo}
  Overview issue:     #{number} (updated / created)

  Actions performed:
    Re-prioritized:     {count} issues
    Reclassified:       {count} issues
    Re-scoped:          {count} issues
    Demoted to triage:  {count} issues
    Archived (closed):  {count} issues
    Decomposed:         {count} issues → {count} new sub-issues
    Merged:             {count} duplicate pairs
    Dependencies:       {count} refs cleaned, {count} new deps added, {count} epics reordered
    Health fixed:       {count} issues (missing metadata resolved)
    Readiness promoted: {count} issues (triage → ready)

  Board State:
    Total open:   {count} ({epics} epics, {sub} sub-issues, {standalone} standalone)
    Ready:        {count} ({available} available, {depWaiting} waiting on deps)
    In Progress:  {count}
    In Review:    {count}
    Triage:       {count}
    Blocked:      {count}
    Lanes:        {laneCount} parallel lanes
```

---

## Error Handling

- **Issue listing failure:** Retry once, then fall back to MCP. If both fail, abort with platform-specific auth guidance:
  - **GitHub:** "Cannot scan board -- check `gh auth login` status and repository access."
  - **Azure DevOps:** "Cannot scan board -- check `az login` status and project access."
  - **GitLab:** "Cannot scan board -- check `glab auth login` status and project access."
- **Issue edit/close failure:** Retry once, then fall back to MCP. If both fail, warn and skip that specific mutation. Summarize failures at end.
- **Sub-issue/relation read failure:** Warn and continue. Epic/sub-issue relationships will be incomplete; note in the summary.
- **Sub-issue linking failure (decomposition):** Report but do not delete the created sub-issue. Note the failed link in the summary.
- **Board sync failure:** Follow the resilience rules from `hatch3r-board-shared`. Warn and continue.

## Guardrails

- **Never modify the `meta:board-overview` issue outside of Step 7.** Steps 4-6 operate on work items only.
- **Never skip ASK checkpoints.** Every grooming action requires explicit user confirmation before mutation.
- **Demotion requires double confirmation.** Step 4d is the only place where status downgrade is permitted, and it requires the user to explicitly confirm each demotion.
- **Never auto-close issues.** Archiving (Step 4e) always requires user selection. Issues marked `status:in-progress` require individual explicit confirmation even when the user selects "all".
- **Preserve issue body structure.** When updating `## Dependencies`, `## Scope`, or acceptance criteria, preserve all other sections of the issue body. Read the full body before editing, apply targeted replacements.
- **No dependency cycles.** When adding new dependencies in Step 4h, validate that the addition does not create a cycle. Flag and reject any cycle-forming edge.
- **Follow the Platform CLI-first approach** from `hatch3r-board-shared`. Use platform CLI as primary; MCP as fallback.
- **Board Overview is auto-maintained.** Exclude from all analysis. One board overview issue at a time.
- **Single board scan.** Perform ONE full board scan per run. Cache all issue data. Reuse for all subsequent steps. Only re-fetch an issue if you mutated it and need the updated body for a subsequent step.
