---
id: hatch3r-board-shared
type: shared-context
orchestrator: false
description: Shared context and procedures for all board commands. Provides platform-agnostic board config, label taxonomy, branch conventions, sync enforcement, and tooling directives. Platform-specific details are in commands/board/shared-{platform}.md.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
---
# Board Shared Reference

Shared context for `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`, and related board commands. Read once per run and cache.

## Agent Pipeline

This command provides shared context and procedures for board commands. It does not spawn sub-agents directly.

---

## Prerequisite Check (run at the start of every board command)

Before reading configuration, validate that prerequisites are met. If any check fails, stop immediately with an actionable error message. For interactive sessions where credentials are missing, use the `agents/shared/user-question-protocol.md` plain-text fallback shape to offer the user a numbered choice (interactive login / paste-token / abort) instead of a bare stop message.

1. **hatch.json exists:** If `.agents/hatch.json` is missing or unreadable, stop with:
   > "Board commands require a hatch3r project. Run `npx hatch3r init` to set up your project first."

2. **owner/repo configured:** If both top-level `owner`/`repo` and `board.owner`/`board.repo` are empty, stop with:
   > "Board commands require owner and repo. Run `npx hatch3r config` to set your repository identity, or provide them in `.agents/hatch.json` under the top-level `owner` and `repo` fields."

3. **Platform authentication:** Verify CLI authentication for the configured platform. On failure, ASK via user-question-protocol with three numbered options (interactive login / paste-token / abort) and default to option 1 if no response.
   - **GitHub:** Run `gh auth status`. If it fails or the `project` scope is missing, check `GITHUB_TOKEN`/`GH_TOKEN` env vars first; if absent, ASK: (1) `gh auth login` interactively, (2) paste a PAT with `project` scope (set GITHUB_TOKEN for this session only), (3) abort. Reference: https://docs.github.com/en/issues/planning-and-tracking-with-projects
   - **Azure DevOps:** Run `az account show`. If it fails, check `AZURE_DEVOPS_PAT`; if absent, ASK: (1) `az login` interactively, (2) provide AZURE_DEVOPS_PAT, (3) abort. Confirm access to organization `{namespace}`.
   - **GitLab:** Run `glab auth status`. If it fails, check `GITLAB_TOKEN`; if absent, ASK: (1) `glab auth login` interactively, (2) provide GITLAB_TOKEN, (3) abort. Confirm access to project `{namespace}/{project}`.

4. **projectNumber set (for commands other than board-init):** For `board-fill`, `board-groom`, `board-pickup`, and `board-refresh`, if `board.projectNumber` is null, stop with:
   > "No project board configured. Run the `board-init` command first to create or connect a project board. This sets up the board.projectNumber in `.agents/hatch.json`."

5. **GitHub PAT project scope (GitHub only, for board-init/fill/groom/pickup):** If GitHub mutations fail with permission errors, surface:
   > "GitHub Projects V2 requires the `project` scope on your PAT. Run `gh auth refresh -s project` to add it. Classic PATs need `admin:org` for org-owned projects."

Report each failed prerequisite with the specific fix command. Do not proceed past the first failure. Record each check's outcome (passed / failed-then-resolved / aborted) in the run cache `errors` entry for the end-of-run summary.

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
      "statuses": ["status:triage", "status:ready", "status:in-progress", "status:in-review", "status:done", "status:blocked"],
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
2. **Status MUST be updated after every status-changing operation.** The five canonical statuses — Ready, In Progress, In Review, Done, Blocked — must be reflected on the board immediately after the corresponding label change. Do not batch status updates to "later" or defer them. See the platform sub-files for platform-specific status update commands.
3. **All available board fields (priority, sprint, area, iteration) MUST be populated when the data is available.** Never leave a board field empty if the information exists in the issue's labels, body, or metadata.
4. **Board overview dashboard MUST be regenerated after any batch of issue operations.** This is in addition to the per-run regeneration rule — if a board command performs multiple batches of mutations, the dashboard must reflect the final state.
5. **Fallback: never silently skip sync.** See platform sub-files for escalation paths. Silent skipping is prohibited.
6. **Cross-reference: every epic/work item and sub-issue must have its board item ID tracked for subsequent updates.** After adding an item to the board, store the returned item ID in the run cache keyed by issue number.
7. **`has-dependencies` label consistency:** Every issue with a non-empty `## Dependencies` section (containing at least one `Blocked by` or `Recommended after` reference) MUST have the `has-dependencies` label. Issues whose `## Dependencies` section contains only `None` MUST NOT have the label. Board commands enforce this during creation and update.
8. **Retry-then-halt fallback policy.** When the Board Sync Procedure's full fallback chain (platform CLI -> MCP) fails for a single item, retry the full chain exactly twice with 2-second then 8-second backoffs. If the third attempt fails, halt that item (not the whole run), roll back only the specific status label this run added (snapshot the item's label set at start-of-sync; do not revert labels that pre-existed or were set concurrently by a human), surface the item to the user as a blocker, and record all three attempts with timestamps under `sync_results` in the run cache.
9. **Null-option abort.** If any `board.statusOptions.*` key required by a planned sync mutation is null in `.agents/hatch.json`, halt the mutation before it fires with: "Cannot sync {status:label}: board.statusOptions.{key} is null in .agents/hatch.json. Run `hatch3r-board-init` to populate status option IDs." Do not proceed with remaining items in the batch.
10. **Retry budget ceiling.** No more than 20% of items in a batch may enter retry (rule 8). If the ceiling is exceeded, halt the batch -- this pattern indicates systemic failure (auth expired, project moved, rate limit exceeded), not per-item noise. Record a single batch-level error in the run cache `errors` entry in addition to the per-item `sync_results`.

---

## Epic Grouping Policy

All board commands that create or reorganize issues MUST follow this grouping policy. Epic grouping maximizes parallelization during pickup — agents can tackle multiple sub-issues of an epic concurrently, whereas standalone issues require serial pickup.

### Standalone Threshold

**Target: zero standalone issues. Hard limit: no more than 10% of non-sub-issue items on the board should be standalone.**

Calculate: `standalone_count / (epic_count + standalone_count)`. Sub-issues are excluded from both numerator and denominator.

When the threshold is exceeded, board commands must apply progressively looser grouping strategies (area match → domain match → type match → catch-all epic) until the ratio is at or below 10%.

### Grouping Priority Order

Apply these rules in strict priority order. Each rule reduces the remaining ungrouped pool before the next rule fires:

1. **Absorb into existing epics** — item shares area, subsystem, or theme with an existing epic.
2. **Form new epics** — 2+ ungrouped items share any connection (area, subsystem, type, domain, semantic similarity).
3. **Singleton promotion** — a single item becomes a 1-item epic with a thematic name (e.g., "Performance Optimization", "Security Hardening"), positioned to absorb future related work. Prefer existing theme names from epics already on the board.
4. **Catch-all epic** — truly isolated items go into a "General Improvements" epic (create one if it doesn't exist, absorb into it if it does).
5. **Standalone (exception only)** — requires explicit user rejection of ALL grouping proposals AND a stated justification. The AI should never propose standalone status on its own.

### When to Apply

- **board-fill Step 5:** Full grouping pass on new items + regrouping pass on existing standalones + post-grouping standalone audit.
- **board-groom Step 3f + Step 4j:** Detection of grouping opportunities + `regroup` action for execution.
- Both commands surface the standalone ratio in their health summaries and final reports.

---

## Post-Merge Terminal State

When a PR/MR merges and `Closes #N` auto-closes the referenced issues, the board item lifecycle must reach its terminal state. The `status:in-review` label should be replaced with `status:done`, and the board status should be set to "Done" using `board.statusOptions.done`.

**Platform-specific behavior and recommendations:**

- **GitHub:** The built-in Projects V2 "Item closed" workflow sets the Status field to "Done" when an issue is closed. This workflow is enabled by default for projects created via the GitHub UI, but projects created via API (as `board-init` does) may not have it enabled. **Verify** the workflow is active: Project settings > Workflows > "Item closed" > confirm Status maps to "Done". If disabled, enable it. Without this workflow, the board status will remain "In Review" until `board-groom` detects and fixes the drift. GitHub does NOT auto-update labels on close — the `status:in-review` label remains on the closed issue.
- **Azure DevOps:** Work item auto-transition to "Closed" requires the **"Complete linked work items after merging"** checkbox during PR completion. This is opt-in per PR (not automatic by default). ADO also supports `Fixes #N` / `Resolves #N` syntax in PR descriptions for state transitions. **Recommend** checking this option consistently, or configuring it as the user's default.
- **GitLab:** Labels are NOT updated on auto-close. The `status::in-review` scoped label remains on the closed issue. GitLab does not have a built-in "set label on close" automation. The `status::done` label must be applied manually, via a CI pipeline trigger on issue close events, or will be caught and fixed during `board-groom` drift remediation. Note: scoped labels (`status::done`) require GitLab **Premium or Ultimate** tier.

Board commands that detect closed issues with `status:in-review` (or any non-`status:done` status label) should treat this as drift and remediate per the platform-specific sync procedure.

---

## PR Closed Without Merge

When a PR/MR is closed without merging, the referenced issues remain open with `status:in-review`. This is drift that must be resolved:

1. **Expected behavior:** Issues should revert to:
   - `status:in-progress` — if the developer intends to continue work on a different branch or rework the changes.
   - `status:ready` — if the work is abandoned and the issue should return to the backlog for future pickup.
2. **Board sync:** The board status should be updated to match the new label ("In Progress" or "Ready").
3. **Detection:** `board-groom` Step 3l detects orphaned `status:in-review` issues (those with no open PR/MR referencing them). The user decides the target state during grooming.
4. **Collision detection:** During `board-pickup` Step 3, if collision detection finds a closed-without-merge PR for the selected issue, surface this context to the user so they can decide whether to reuse the branch, start fresh, or pick a different issue.

This situation is NOT automatically remediated because the correct target state depends on developer intent. Board commands surface it as a diagnostic for user decision.

---

## End-of-Run Reconciliation Procedure

Every mutating board command (`board-fill`, `board-groom`, `board-pickup`) runs this procedure as its final step before the summary output. It catches silent failures and drift accumulated during the run.

1. **Board sync verification.** Re-attempt sync for any issue where `sync_results` shows a failure, using the full fallback chain with rule 8 retry semantics. If any item still fails after all retries, the command exits with non-zero status and emits the failing items as a list in the reconciliation report under `Errors:`. Do not suppress unresolved failures.
2. **Sub-issue link verification:** Review `link_results` in the run cache. For links recorded as `advisory`, retry the platform-specific primary link method once to upgrade to `native`. Report all non-native links (`advisory` / `comment-only`) in the reconciliation output.
3. **Label consistency:** Verify all created/updated issues have required labels (`type:*`, `priority:*`, `executor:*`) and correct `has-dependencies` state per rule 7 of Board Sync Enforcement. Fix any gaps.
4. **PR linkage:** For issues transitioned to `status:in-progress` or `status:in-review`, verify any associated open PR body contains `Closes #N` for the addressed issues. Auto-fix if missing by updating the PR body.
5. **Orphaned in-review detection:** For all cached issues with `status:in-review` (not just those transitioned during this run), verify an open PR/MR exists that references `Closes #N`:
   - **GitHub:** `gh pr list -R {owner}/{repo} --state open --json number,body` — parse for `Closes #{N}`.
   - **Azure DevOps:** `az repos pr list --status active` — check work item links.
   - **GitLab:** `glab mr list -R {namespace}/{project} --state opened` — parse descriptions for `Closes #{N}`.
   Flag orphaned in-review issues (those with no associated open PR/MR) in the reconciliation report. This catches issues that drifted to `status:in-review` in previous runs but lost their PR (closed without merge, PR deleted, etc.). Also flag closed issues still labeled `status:in-review` that should be `status:done`.

### Reconciliation Report

Output the reconciliation report immediately before the command summary:

```
Reconciliation:
  Board sync:   {N} synced, {M} failed (list failures)
  Sub-issue links: {N} native, {M} advisory, {K} comment-only
  Label gaps:   {N} fixed, {M} remaining (list)
  PR linkage:   {N} verified, {M} missing `Closes` (list)
  Orphaned in-review: {N} open issues with no PR/MR, {M} closed issues not status:done (list)
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

### Agent-Synthesized Wrapper Scripts

Board commands instruct the agent to invoke individual CLI / MCP calls; the agent harness already batches them. If the agent synthesises a wrapper shell script anyway, the script MUST be portable across the user's installed shells. macOS ships `bash 3.2` as `/bin/bash` and many users default to `zsh` — bash-4-only features fail loudly on both.

1. **Default to individual tool calls.** Do not wrap `gh issue create`, `gh issue edit`, `gh project item-add`, `az boards work-item create`, or `glab issue create` loops in a synthesised bash script unless the user explicitly asks for a script artifact. The harness's parallel tool dispatch is cheaper than spawning a sub-shell and avoids the portability problem entirely.
2. **If a wrapper is required, target `bash 3.2` (macOS system default).** Banned constructs: `declare -A` (associative arrays), `${!ARR[@]}` (associative-array key expansion), `mapfile`, `readarray`. Use parallel indexed arrays (`KEYS=()`, `VALUES=()`) with integer indices, or rewrite the batching logic in Python / Node. `zsh` is not a drop-in substitute — `${!ARR[@]}` semantics differ; `bad substitution` is the symptom.
3. **Pin the shell explicitly.** Start every synthesised script with `#!/usr/bin/env bash` and guard any bash-4+ feature behind `[[ ${BASH_VERSINFO[0]} -ge 4 ]] || { echo "bash 4+ required, found ${BASH_VERSION}"; exit 64; }` so the failure mode is loud, not silent.

### Pager-Bypass Directive

Every `gh api`, `gh pr view`, `gh issue view`, `gh project item-list`, `az pipelines run`, and `glab api` invocation from an agent-driven terminal MUST run with `GH_PAGER=cat` and `PAGER=cat` set. The default GitHub CLI pager (`less`) opens the alternate screen buffer, which returns empty captured output in non-TTY contexts — the call appears to succeed but its `--jq` output is lost. Piping to `| cat` does not bypass the alternate-buffer behaviour; the environment variables are the only reliable workaround.

Set once at the start of every board / PR command run, before the first CLI invocation:

```bash
export GH_PAGER=cat
export PAGER=cat
```

The export is idempotent and safe to re-set. `GH_PAGER` is scoped to `gh`; `PAGER` covers downstream `git`, `az`, or `glab` invocations. This directive applies to every command in this directory tree.

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
