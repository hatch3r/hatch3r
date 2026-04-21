---
sidebar_position: 2
title: Board Management
---

# Board Management

hatch3r includes a complete board management system built on GitHub Projects V2.

## Commands

| Command | Purpose |
|---------|---------|
| **board-init** | Create or connect a GitHub Projects V2 board with status fields, label taxonomy, and optional migration |
| **board-fill** | Parse `todo.md`, create epics/issues, deduplicate, analyze dependencies, set implementation order |
| **board-pickup** | Auto-pick the next best issue, check collisions, delegate to sub-agents, create PRs |
| **board-refresh** | Regenerate the board overview dashboard with current state, health metrics, and model recommendations |
| **board-shared** | Configurable shared context (org, repo, project board IDs, label taxonomy) |

## Configuration

Configure your board in `hatch.json`:

```json
{
  "board": {
    "owner": "my-org",
    "repo": "my-repo",
    "projectNumber": 1,
    "areas": ["area:frontend", "area:backend", "area:infra"]
  }
}
```

### Required fields

- `board.owner` -- GitHub organization or user
- `board.repo` -- Repository name
- `board.projectNumber` -- GitHub Projects V2 number (created by `board-init`)

### Optional fields

- `board.areas` -- Area labels for issue classification

## Board Lifecycle

### 1. board-init

Creates a new GitHub Projects V2 board or connects to an existing one:

- Configures status fields with five default columns: Backlog, Ready, In Progress, In Review, Done
- Creates the full hatch3r label taxonomy:
  - **Type:** `type:feature`, `type:bug`, `type:refactor`, `type:docs`, `type:infra`, `type:epic`
  - **Executor:** `executor:human`, `executor:agent`, `executor:hybrid`
  - **Status:** `status:ready`, `status:blocked`, `status:needs-review`
  - **Priority:** `priority:critical`, `priority:high`, `priority:medium`, `priority:low`
  - **Risk:** `risk:high`, `risk:medium`, `risk:low`
  - **Meta:** `meta:board-overview`
- Prompts for default branch (main/master)
- Optionally migrates issues from another project
- Writes all project IDs back to `hatch.json`

### 2. board-fill

Parses `todo.md` and creates GitHub issues:

- Reads project documentation and codebase context
- Deduplicates against existing issues
- Classifies each item by type, executor, priority, area, and risk
- Groups related items into epics
- Builds a dependency graph (DAG)
- Determines implementation order
- Identifies parallel work lanes
- Marks issues as `status:ready` when all dependencies are met

### 3. board-pickup

Selects and implements the next issue:

- Auto-selects based on dependency order and priority (or targets a specific issue)
- Checks for collisions against in-progress work and open PRs
- Creates a branch from the default branch
- Marks the issue as in-progress
- Delegates to the appropriate skill
- For epics: spawns parallel sub-agents for independent sub-issues
- Runs quality checks
- Creates a pull request
- Updates labels and Projects V2 status

### 4. board-refresh

Regenerates the living board overview:

- Scans all open and recently closed issues
- Computes board health metrics (missing metadata, stale issues, blocked chains)
- Assigns recommended models using the quality-first heuristic
- Updates the `meta:board-overview` issue with status tables, epic progress, and diagnostics

## Sync Hardening (1.6.0)

### Workflow verification in `board-init`

`board-init --resume` performs programmatic verification of GitHub Project workflow settings via GraphQL and persists the result to `hatch.json` under `board.workflows.{itemClosedEnabled, pullRequestMergedEnabled}`. Re-run with `--resume` after adjusting workflow toggles in the GitHub Project UI to pick up the change.

### Reviewer/fixer loop in `board-fill` Step 7.9

Generated issue bodies are treated as specs and passed through a reviewer/fixer loop:

- 6-criteria checklist applied to every generated body
- Maximum 4 fix iterations per issue
- Oscillation detection halts the loop if the reviewer flip-flops between states

### Terminal-state verification in `pickup-post-impl` Step 9c

After a PR merges, `pickup-post-impl` confirms the board item has reached a terminal workflow state (label flip + GitHub Projects V2 state check). Mismatches surface as halt-worthy findings rather than silent successes.

### Board Sync Enforcement rules 8-10

`commands/hatch3r-board-shared.md` adds three enforcement rules:

- **Rule 8:** Retry-then-halt with rollback when an option mapping fails twice
- **Rule 9:** Null-option abort — refuse to proceed when a required status/priority option resolves to null
- **Rule 10:** 20% batch retry-budget ceiling — halt batch sync once retry count exceeds 20% of batch size
