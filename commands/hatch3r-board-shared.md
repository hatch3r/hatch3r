---
id: hatch3r-board-shared
type: command
description: Shared context and procedures for all board commands. Provides GitHub context from hatch.json, Projects v2 sync, and tooling directives.
---
# Board Shared Reference

Shared context for `hatch3r-board-fill`, `hatch3r-board-pickup`, `hatch3r-board-refresh`, and related board commands. Read once per run and cache.

---

## Board Configuration

All board commands read project-specific configuration from `/.agents/hatch.json`. The GitHub owner and repo are defined at the top level (`owner`, `repo`). Board-specific configuration (Projects v2 IDs, label taxonomy, branch conventions, area labels) lives under the `board` key. **Read `/.agents/hatch.json` at the start of every run and cache both top-level and `board` config for the duration.**

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

## GitHub Context

Derived from `/.agents/hatch.json` board config:

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

### Project Reference (cache for the full run)

If `board.projectNumber` is not null, verify via `gh project view {board.projectNumber} --owner {board.owner}` or `gh project field-list {board.projectNumber} --owner {board.owner}` on first use.

- **Owner:** `board.owner`, **owner type:** infer from context (`org` or `user`)
- **Project number:** `board.projectNumber`
- **Status field ID:** `board.statusFieldId`
- **Status option IDs:** Read from `board.statusOptions` (keys: `backlog`, `ready`, `inProgress`, `inReview`, `done`)

---

## Projects v2 Sync Procedure

> **Skip entirely if `board.projectNumber` is null.**

Use this procedure whenever a status label is set or changes and the board needs to reflect it. Labels are the source of truth; Projects v2 sync keeps the board view consistent. This includes newly created issues -- sync their initial status immediately after adding them to the board.

**Prerequisites:** `gh auth refresh -s project` (Projects v2 via gh requires the `project` scope). gh CLI 2.40+ recommended.

**Status label → Projects v2 option mapping:**

Read the mapping from `board.statusOptions` in `/.agents/hatch.json`:

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

Used by both `board-refresh` and `board-fill` when generating the Implementation Lanes and Waiting on Dependencies sections. Input: all `status:ready` issues and their dependency data (from `## Dependencies` sections).

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

### GitHub CLI-First

All board commands MUST use `gh` CLI as the primary interface for GitHub operations. CLI tools have lower token cost and faster execution than MCP equivalents.

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
