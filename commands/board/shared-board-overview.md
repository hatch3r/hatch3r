---
id: hatch3r-board-shared-overview
type: shared-context
description: Board overview dashboard template, model pool, model selection heuristic, staleness detection criteria, and lane computation algorithm. Referenced from hatch3r-board-shared.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Overview Reference

If `meta:board-overview` is included in `board.labels.meta`, board commands will look for an open issue with that label to use as a live dashboard. This dashboard is auto-maintained and MUST be regenerated at the end of every board command run that mutates issues. For on-demand regeneration without running a full board command, use `hatch3r-board-refresh`.

Teams can extend the dashboard with project-specific sections, but the following structure and model recommendations are required.

## Model Pool

When populating the board overview, assign a recommended model class to each issue. The four class words are the primary vocabulary — each resolves to the concrete model the repo pins in `hatch.json` under `models.tiers`. Specific model IDs are intentionally omitted here to avoid staleness as model versions change. Two cross-vendor aliases (`codex`, `gemini-pro`) stay concrete by design: a class word cannot express vendor-specific strengths.

| Alias | Strength | Use When |
| ----- | -------- | -------- |
| `frontier` | Deep reasoning, security analysis, architectural judgment (concrete model per repo: `models.tiers.frontier`) | `risk:high`, security-sensitive, architectural issues |
| `advanced` | Multi-file implementation depth (concrete model per repo: `models.tiers.advanced`) | Complex multi-file implementation |
| `standard` | Balance of quality and speed (concrete model per repo: `models.tiers.standard`) | Routine features and bug fixes |
| `economy` | Fast turnaround at low cost (concrete model per repo: `models.tiers.economy`) | Documentation (`type:docs`), QA validation (`type:qa`), `risk:low` |
| `codex` | Agentic coding, long-running tasks, tool orchestration (cross-vendor override) | Multi-step implementations, polyglot codebases, complex tool integrations |
| `gemini-pro` | Very large context windows, multimodal, web development (cross-vendor override) | Massive context needs (large epics), web/frontend work |

## Model Selection Heuristic (Quality-First)

1. **Default:** `frontier` for `risk:high` issues; `standard` otherwise.
2. **Override to `codex`** if the issue involves heavy agentic coding, long-running multi-step tasks, or multi-language requirements.
3. **Override to `gemini-pro`** if the issue requires processing very large context (large epic with many sub-issues spanning many files) or is primarily web/frontend work.
4. **Upgrade to `advanced`** for complex multi-file implementation that stops short of the `frontier` criteria (`risk:high`, security-sensitive, architectural).
5. **Downgrade to `economy`** ONLY for straightforward issues: simple bugs (`risk:low`), documentation (`type:docs`), QA validation (`type:qa`), or issues with clear bounded scope and no architectural impact.

## Board Overview Issue Format

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

| # | Title | Type | Pri | Executor | Model | PR |
|---|-------|------|-----|----------|-------|----|
| #{N} | {title} | {type} | {pri} | {executor} | {model} | #{pr_number} or -- |

## In Review

| # | Title | Type | Pri | Executor | Model | PR |
|---|-------|------|-----|----------|-------|----|
| #{N} | {title} | {type} | {pri} | {executor} | {model} | #{pr_number} or -- |

## Implementation Lanes

Issues grouped into work streams with dependency-aware phasing.
Lanes in the same phase can be worked concurrently; within a lane, follow the listed order.
Lanes in later phases should start after their prerequisite lanes complete or reach a stable state.

### Lane Dependency Map

| Lane | Phase | Prerequisites | Relationship |
|------|-------|---------------|--------------|
| Lane 1: {name} | 1 | -- | Independent |
| Lane 2: {name} | 2 | Lane 1 (resolved-hard) | Depends on Lane 1 output |
| Lane 3: {name} | 2 | Lane 1 (soft) | Recommended after Lane 1 |

When 4+ lanes have inter-lane edges, also render a **Mermaid diagram**:
- Solid arrows (`-->`) for resolved-hard edges
- Dashed arrows (`-.->`) for soft edges
- Phase 1 nodes = green, Phase 2 = yellow, Phase 3+ = orange
- Omit diagram when all lanes are Phase 1 or fewer than 4 lanes exist

### Lane 1: {area/theme} [Phase 1]

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #{N} | {title} | {type} | {pri} | {executor} | {model} |
| 2 | #{M} | {title} | {type} | {pri} | {executor} | {model} |

### Lane 2: {area/theme} [Phase 2]
> After: Lane 1 (API creates endpoints this lane consumes)

| Order | # | Title | Type | Pri | Executor | Model |
|-------|---|-------|------|-----|----------|-------|
| 1 | #{N} | {title} | {type} | {pri} | {executor} | {model} |

## Cross-Epic Dependencies

Dependency relationships between epics. Omit if no cross-epic dependencies exist.

| Upstream Epic | Downstream Epic | Via |
|---------------|-----------------|-----|
| #{epicA} {title} | #{epicB} {title} | #{subX} blocks #{subY} |

## Cross-Lane Dependencies

Inter-lane dependency edges from the Lane Dependency Map. Omit if no cross-lane dependencies exist.

| From (Lane) | Issue | To (Lane) | Issue | Type | Reason |
|-------------|-------|-----------|-------|------|--------|
| Lane 1: API | #{N} | Lane 3: Integration | #{M} | resolved-hard | #{M} was blocked by #{N} (now closed) |
| Lane 1: API | #{N} | Lane 2: Auth | #{K} | soft | Shared area overlap, reduced merge conflict risk |

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

**Lane sequencing warnings:**
- {list or "None -- all lane phase assignments are clear."}

Flag: Phase 2+ lanes with 0 prerequisite work completed, lanes with bidirectional soft deps (review independence), lanes sharing 4+ soft deps (consider merging).

**Unlinked sub-issues:**
- {list or "None -- all sub-issues are natively linked."}

**Unlinked in-progress work:**
- {list or "None -- all active issues have PRs."}

**Board sync drift:**
- {list or "None -- all labels match board state."}

**Dependency format inconsistencies:**
- {list using `Depends on` instead of `Blocked by`, or "None -- all use canonical format."}

---

*This issue is auto-maintained by hatch3r board commands. Do not close.*
```

---

## Dependency Data Model

`## Dependencies` sections in individual issue bodies are the **single authoritative source** of dependency data. Every issue (epic, sub-issue, standalone) tracks its own blockers in its `## Dependencies` section using two reference types:

- **Hard:** `Blocked by #N` -- this issue cannot start until #N is closed. Used for true producer/consumer relationships (A creates what B consumes) and explicit sequencing requirements.
- **Soft:** `Recommended after #N` -- this issue can proceed in parallel with #N, but sequential execution is recommended (e.g., shared area overlap, reduced merge conflict risk). Soft dependencies are advisory; they do not block pickup or exclude issues from Implementation Lanes.

When no dependencies exist, the section contains `None`.

**Canonical format:** `Blocked by #N` is the only hard dependency format board commands generate. `Depends on #N` is accepted as a legacy alias when parsing but MUST NOT be written. `board-groom` normalizes `Depends on #N` → `Blocked by #N` during dependency refresh.

`## Implementation Order` sections in epic bodies are a **derived convenience view** -- they visualize the dependency DAG among an epic's sub-issues as numbered levels. Board commands that create or update epics MUST regenerate `## Implementation Order` from the sub-issues' `## Dependencies` sections, not the other way around. When the two diverge, `## Dependencies` wins.

## Lane Computation Algorithm

Used by `board-fill`, `board-groom`, and `board-refresh` when generating the Implementation Lanes and Waiting on Dependencies sections. Input: all `status:ready` issues and their dependency data (from `## Dependencies` sections).

1. **Collect** all `status:ready` issues.
2. **Partition by hard-blocker satisfaction** -- for each collected issue, check all **hard** dependency references (`Blocked by #N`) in its `## Dependencies` section against the full board. An issue is **dependency-waiting** if any hard blocker is still open (regardless of the blocker's status). Soft dependencies (`Recommended after #N`) do not affect this partition. Separate into two sets:
   - **Available** -- all hard blockers satisfied (closed) or no hard blockers. These proceed to lane computation (step 3+).
   - **Dependency-waiting** -- one or more hard blockers still open. These are excluded from Implementation Lanes and listed in the **Waiting on Dependencies** section of the overview instead.
3. **Build the available sub-graph** -- retain **both** hard and soft dependency edges among available issues (from parsed `## Dependencies` sections). Hard edges determine intra-lane ordering. Soft edges are tracked for inter-lane computation in steps 10-12.
4. **Group by dependency chains** -- issues with sequential dependencies go in the same lane, ordered topologically within the chain.
5. **Group by area overlap** -- independent issues (no inter-dependencies) that share `area:*` labels go in the same lane. This avoids merge conflicts on the same files when multiple agents work in parallel.
6. **General lane** -- issues with no dependencies and no area overlap form their own single-issue lanes. If three or more such issues exist, group them into a single "General" lane.
7. **Name lanes** by the dominant `area:*` label or shared theme of the issues in the lane. Use "General" for the catch-all lane.
8. **Sort lanes** by the highest-priority issue in each lane (`P0`-lane first, then `P1`, etc.). Break ties by lowest issue number.
9. **Sort within lanes** by dependency order (blockers before dependents), then by priority, then by issue number.
10. **Compute inter-lane dependency edges:** After lanes are formed, scan all soft dependencies (`Recommended after #N`) and resolved hard dependencies (`Blocked by #N` where #N is closed) where the blocker and dependent are in *different* lanes. Record: source lane, target lane, edge type (`soft` / `resolved-hard`), issue pair.
11. **Compute lane phases:** Build a lane-level DAG from step 10 edges. Assign phase numbers via topological ordering:
    - Phase 1: lanes with no incoming inter-lane edges (can start immediately).
    - Phase 2+: lanes whose predecessors are all in earlier phases.
    - Soft-only edges are annotated but do not enforce phasing (advisory).
    - If all lanes have no edges → all Phase 1 (truly parallel).
12. **Build Lane Dependency Map:** Produce summary: lane phase assignments, inter-lane edges with types, whether the board is fully parallel or phased. This summary populates the Lane Dependency Map and Cross-Lane Dependencies sections of the board overview.

## Staleness Detection Criteria

Single shared home for board staleness detection. `board-fill` applies these criteria automatically in its Step 1.6 Staleness Refresh; `board-groom` cites them in Steps 3c/3k/3l and remediates through its Step 4 actions. Every criterion is evaluated against data the full board scan already cached (issue bodies, labels, timestamps, links) plus local git and PR/MR state — no per-issue re-fetch.

| ID | Criterion | Detection | Refresh action |
|----|-----------|-----------|----------------|
| S1 | **Dead file references** — the issue body cites one or more file paths absent from the current tree | Extract path-like tokens from the body; a path is absent when `git ls-files -- {path}` returns nothing; recover rename targets via `git log --follow --diff-filter=R -- {path}` | Annotate: comment listing each missing path and its rename target when git history records one. If every cited path is absent and the described target no longer exists, flag-for-close |
| S2 | **Status contradicts git/PR state** — a linked PR/MR is merged or closed while the issue is still open, its `status:*` label is not `status:done`, or its board column is not Done; or the issue carries `status:in-review` with no open PR/MR referencing it | Cross-reference cached issue state, `status:*` label, and board column against PR/MR linkage (`Closes #N` references plus PR/MR state) | Merged PR with lagging label/column: set `status:done`, sync board column to Done (update status/column). `status:in-review` with no open PR/MR: propose `status:ready` (work abandoned) or `status:in-progress` (rework expected) — a status downgrade |
| S3 | **Body predates the code it describes** — the issue's `updatedAt` is older than the newest commit touching a file or area the body references | For each referenced path (and each `area:*` label's mapped directory), compare `git log -1 --format=%cI -- {path}` against `updatedAt` | Annotate: comment naming the newer commit(s) (hash + date) and the affected paths; nominate for re-scope (`board-groom` Step 4c) |
| S4 | **Duplicate of already-merged work** — the issue's title and acceptance criteria describe an outcome a closed-as-completed issue or merged PR already delivered | Search closed items by title keywords; classify semantically (Duplicate / Partial overlap / No match). Only a Duplicate verdict fires S4 — Partial overlap does not | Flag-for-close, citing the delivering issue/PR number |
| S5 | **Label/column drift** — the issue's `status:*` label and its board column diverge | Compare the cached label against the board column via `gh project item-list {board.projectNumber} --owner {board.owner} --format json` (GitHub) or the Azure DevOps / GitLab equivalent. Requires `board.projectNumber` | Update status/column: re-sync the board column to match the label (labels are the source of truth per Board Sync Enforcement). A closed issue still labeled `status:in-review` is the S2 merged-PR case |
| S6 | **Inactivity** — `status:triage` with no update in 14+ days, `status:in-progress` in 7+ days, or `status:ready` in 30+ days (all from `updatedAt`) | Compare each open issue's `updatedAt` against its per-status threshold | Nominate as archive candidate (`board-groom` Step 4e); list in the refresh/refinement summary. Inactivity alone mutates nothing — it is a signal, not proof of obsolescence |

### Disposition classes

Every refresh action above falls into one of two classes:

- **Automatic (non-destructive):** annotation comments and re-syncs that move recorded state forward or into alignment — board column matched to the status label (S5), `status:done` plus Done column when the linked PR merged (S2). Consumers apply these without prompting and record each mutation in the run cache so the end-of-run dashboard regeneration reflects it.
- **Confirm-first (destructive or downgrade):** closing an issue (S1 total-loss flag-for-close, S4 duplicate-close, S6 archive) and any `status:*` downgrade (S2 in-review with no open PR/MR). These require explicit user confirmation before mutation — the irreversible-action trigger per `rules/hatch3r-clarification-default.md`. `board-fill` bundles ALL confirm-first candidates from a run into ONE ASK (Step 1.6); `board-groom` routes them through its per-action ASK checkpoints (Step 4d demotion, 4e archive, 4g merge-close, 4j in-review remediation). A confirm-first disposition is never applied without a user answer naming it.
