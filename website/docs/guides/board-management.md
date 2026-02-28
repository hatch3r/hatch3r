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
