---
id: hatch3r-board-shared
type: shared-context
description: Shared context and procedures for all board commands. Provides platform-agnostic board config, label taxonomy, branch conventions, sync enforcement, and tooling directives. Platform-specific details are in commands/board/shared-{platform}.md.
tags: [board, team]
---
# Board Shared Reference

Shared context for `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`, and related board commands. Read once per run and cache.

## Agent Pipeline

This command provides shared context and procedures for board commands. It does not spawn sub-agents directly.

---

## Prerequisite Check (run at the start of every board command)

Before reading configuration, validate that prerequisites are met. If any check fails, stop immediately with an actionable error message.

1. **hatch.json exists:** If `.agents/hatch.json` is missing or unreadable, stop with:
   > "Board commands require a hatch3r project. Run `npx hatch3r init` to set up your project first."

2. **owner/repo configured:** If both top-level `owner`/`repo` and `board.owner`/`board.repo` are empty, stop with:
   > "Board commands require owner and repo. Run `npx hatch3r config` to set your repository identity, or provide them in `.agents/hatch.json` under the top-level `owner` and `repo` fields."

3. **Platform authentication:** Verify CLI authentication for the configured platform:
   - **GitHub:** Run `gh auth status`. If it fails, stop with: "GitHub CLI not authenticated. Run `gh auth login` and ensure your PAT has the `project` scope for Projects V2 access. See: https://docs.github.com/en/issues/planning-and-tracking-with-projects"
   - **Azure DevOps:** Run `az account show`. If it fails, stop with: "Azure CLI not authenticated. Run `az login` or set AZURE_DEVOPS_PAT. Ensure access to organization `{namespace}`."
   - **GitLab:** Run `glab auth status`. If it fails, stop with: "GitLab CLI not authenticated. Run `glab auth login` or set GITLAB_TOKEN. Ensure access to project `{namespace}/{project}`."

4. **projectNumber set (for commands other than board-init):** For `board-fill`, `board-groom`, `board-pickup`, and `board-refresh`, if `board.projectNumber` is null, stop with:
   > "No project board configured. Run the `board-init` command first to create or connect a project board. This sets up the board.projectNumber in `.agents/hatch.json`."

5. **GitHub PAT project scope (GitHub only, for board-init/fill/groom/pickup):** If GitHub mutations fail with permission errors, surface:
   > "GitHub Projects V2 requires the `project` scope on your PAT. Run `gh auth refresh -s project` to add it. Classic PATs need `admin:org` for org-owned projects."

Report each failed prerequisite with the specific fix command. Do not proceed past the first failure.

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

**`models`** — Optional. Preferred AI models for agents. `models.default` applies to all agents; `models.agents` overrides per agent. Use aliases (`opus`, `sonnet`, `codex`, `gemini-pro`) or full model IDs. Resolution order: `.hatch3r/agents/{id}.customize.yaml` > manifest per-agent > agent frontmatter > manifest default. See [Model Selection](https://docs.hatch3r.com/docs/guides/model-selection) and [Adapter Capability Matrix](https://docs.hatch3r.com/docs/reference/adapter-capability-matrix#agent-model-customization).

---

## Platform Detection

Read `platform` from `.agents/hatch.json`. This determines all CLI commands, API patterns, and terminology for this run. If `platform` is missing or empty, default to `github`.

> Platform-specific details: see `commands/board/shared-github.md`
> Platform-specific details: see `commands/board/shared-azure-devops.md`
> Platform-specific details: see `commands/board/shared-gitlab.md`

Each platform sub-file contains: CLI command reference, MCP tool reference, terminology mapping, platform context, board sync procedure, sub-issue linking, board sync enforcement details, and CLI-first tooling directives.

---

## Board Sync Procedure

> **Skip entirely if `board.projectNumber` is null (GitHub/GitLab) or project is not configured (Azure DevOps).**

Use this procedure whenever a status label is set or changes and the board needs to reflect it. Labels are the source of truth; board sync keeps the board view consistent. This includes newly created issues -- sync their initial status immediately after adding them to the board.

> Platform-specific details: see `commands/board/shared-github.md` (GitHub Projects V2 Sync)
> Platform-specific details: see `commands/board/shared-azure-devops.md` (Azure Boards Work Item State Sync)
> Platform-specific details: see `commands/board/shared-gitlab.md` (GitLab Board Label-Based Sync)

---

## Sub-Issue Linking Procedure

Use this procedure whenever a child issue must be linked to a parent epic. Board commands that create sub-issues MUST follow the platform-specific fallback chain and record the link status.

> Platform-specific details: see `commands/board/shared-github.md` (Sub-Issue Linking — GitHub)
> Platform-specific details: see `commands/board/shared-azure-devops.md` (Sub-Issue Linking — Azure DevOps)
> Platform-specific details: see `commands/board/shared-gitlab.md` (Sub-Issue Linking — GitLab)

Cache link status per child (`native` / `advisory` / `comment-only`) in the run cache under `link_results`.

---

## Board Sync Enforcement

Board sync is **MANDATORY**, not optional. The following rules override any "skip if null" or "skip silently" language elsewhere when the board is configured (GitHub: `board.projectNumber` set; Azure DevOps: project configured; GitLab: board configured).

1. **Every issue/work item created or updated by a board command MUST be synced to the board — no exceptions.** This includes newly created issues, status changes, label updates, and any mutation that affects board state. Skipping sync for any item is a violation of this policy.
2. **Status MUST be updated after every status-changing operation.** The four canonical statuses — Ready, In Progress, In Review, Done — must be reflected on the board immediately after the corresponding label change. Do not batch status updates to "later" or defer them. See the platform sub-files for platform-specific status update commands.
3. **All available board fields (priority, sprint, area, iteration) MUST be populated when the data is available.** Never leave a board field empty if the information exists in the issue's labels, body, or metadata.
4. **Board overview dashboard MUST be regenerated after any batch of issue operations.** This is in addition to the per-run regeneration rule — if a board command performs multiple batches of mutations, the dashboard must reflect the final state.
5. **Fallback: never silently skip sync.** See platform sub-files for escalation paths. Silent skipping is prohibited.
6. **Cross-reference: every epic/work item and sub-issue must have its board item ID tracked for subsequent updates.** After adding an item to the board, store the returned item ID in the run cache keyed by issue number.
7. **`has-dependencies` label consistency:** Every issue with a non-empty `## Dependencies` section (containing at least one `Blocked by` or `Recommended after` reference) MUST have the `has-dependencies` label. Issues whose `## Dependencies` section contains only `None` MUST NOT have the label. Board commands enforce this during creation and update.

---

## End-of-Run Reconciliation Procedure

Every mutating board command (`board-fill`, `board-groom`, `board-pickup`) runs this procedure as its final step before the summary output. It catches silent failures and drift accumulated during the run.

1. **Board sync verification:** Re-attempt sync for any issue where `sync_results` in the run cache shows a failure. Use the full **Board Sync Procedure** fallback chain. Record final status.
2. **Sub-issue link verification:** Review `link_results` in the run cache. For links recorded as `advisory`, retry the platform-specific primary link method once to upgrade to `native`. Report all non-native links (`advisory` / `comment-only`) in the reconciliation output.
3. **Label consistency:** Verify all created/updated issues have required labels (`type:*`, `priority:*`, `executor:*`) and correct `has-dependencies` state per rule 7 of Board Sync Enforcement. Fix any gaps.
4. **PR linkage:** For issues transitioned to `status:in-progress` or `status:in-review`, verify any associated open PR body contains `Closes #N` for the addressed issues. Auto-fix if missing by updating the PR body.

### Reconciliation Report

Output the reconciliation report immediately before the command summary:

```
Reconciliation:
  Board sync:   {N} synced, {M} failed (list failures)
  Sub-issue links: {N} native, {M} advisory, {K} comment-only
  Label gaps:   {N} fixed, {M} remaining (list)
  PR linkage:   {N} verified, {M} missing `Closes` (list)
  Errors:       {list or "None"}
```

---

## Board Overview

> Full details: see `commands/board/shared-board-overview.md` (model pool, model selection heuristic, dashboard template, dependency data model, lane computation algorithm)

If `meta:board-overview` is included in `board.labels.meta`, board commands will look for an open issue with that label to use as a live dashboard. This dashboard is auto-maintained and MUST be regenerated at the end of every board command run that mutates issues. For on-demand regeneration without running a full board command, use `hatch3r-board-refresh`.

---

## Cross-Cutting Tooling Directives

These directives apply to ALL board commands. They supplement the project's tooling hierarchy.

### Platform CLI-First

All board commands MUST use the platform CLI as the primary interface for operations. CLI tools have lower token cost and faster execution than MCP equivalents.

> Platform-specific details: see `commands/board/shared-github.md` (Cross-Cutting Tooling — GitHub CLI-First)
> Platform-specific details: see `commands/board/shared-azure-devops.md` (Cross-Cutting Tooling — Azure DevOps CLI-First)
> Platform-specific details: see `commands/board/shared-gitlab.md` (Cross-Cutting Tooling — GitLab CLI-First)

### Batch Operations

All board commands MUST minimize user approval prompts by batching related operations:

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

---

## Run Cache Requirements

All mutating board commands MUST maintain a run cache with the following entries. The cache persists for the duration of the run and feeds into the End-of-Run Reconciliation Procedure.

| Key | Type | Description |
|-----|------|-------------|
| `created_issues` | `Map<number, {title, type, labels}>` | All issues created during this run |
| `updated_issues` | `Map<number, {title, changes[]}>` | All issues updated during this run |
| `sync_results` | `Map<number, {status: success\|failure, method: cli\|mcp\|skipped}>` | Board sync outcome per issue |
| `link_results` | `Map<number, {parent: number, status: native\|advisory\|comment-only}>` | Sub-issue link outcome per child |
| `pr_created` | `{number, branch, issues_closed[]}` or `null` | PR created during this run (if any) |
| `pr_association_map` | `Map<number, number[]>` | PR number → issue numbers it references |
| `board_item_ids` | `Map<number, string>` | Issue number → board item ID for subsequent updates |
| `errors` | `{step, issue?, message, recoverable}[]` | All errors encountered during the run |

Initialize all entries at the start of the run. Populate incrementally as operations execute. The reconciliation procedure reads these entries to detect and fix drift.
