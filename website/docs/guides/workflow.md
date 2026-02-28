---
sidebar_position: 1
title: Workflow
---

# Workflow

hatch3r provides a full project lifecycle, from setup to release. This guide walks through the typical flow.

## 1. Initialize

```bash
npx hatch3r init
```

Interactive setup detects your repository, asks which coding tools you use, and generates all agents, skills, rules, commands, and MCP configuration.

**Next steps after init:**

| Starting point | Command | What it does |
|----------------|---------|-------------|
| New project | `project-spec` | Generate specs, ADRs, and `todo.md` from your vision |
| Existing codebase | `codebase-map` | Reverse-engineer specs from what's already there |
| Single feature | `feature-plan` | Plan one feature with parallel researchers |
| Complex bug | `bug-plan` | Investigate with parallel sub-agents |
| Refactoring | `refactor-plan` | Design a phased execution plan |

### For new projects (greenfield)

1. Run `project-spec` with your project idea -- produces `docs/specs/`, `docs/adr/`, and `todo.md`
2. Run `roadmap` to refine the plan into dependency-ordered epics
3. Continue with board-fill (step 4 below)

### For existing projects (brownfield)

1. Run `codebase-map` -- spawns analyzers to discover modules, conventions, and tech debt
2. Run `roadmap` to plan improvements from the analysis
3. Continue with board-fill (step 4 below)

## 2. Set up the board

Run the `board-init` command to create or connect a GitHub Projects V2 board.

Board-init handles:
- Project creation via GraphQL
- Status field configuration (Backlog, Ready, In Progress, In Review, Done)
- Full label taxonomy creation
- Writing all IDs back to `hatch.json`

## 3. Define work

Create a `todo.md` file at the project root with your planned work -- epics, features, bugs, refactors, anything. One item per line.

## 4. Fill the board

Run `board-fill` to parse `todo.md` and turn items into GitHub issues.

Board-fill:
- Deduplicates against existing issues
- Classifies each item by type, priority, executor, area, and risk
- Groups items into epics
- Builds a dependency DAG
- Determines implementation order
- Identifies parallel work lanes
- Marks issues as `status:ready` when all readiness criteria are met

## 5. Pick up work

Run `board-pickup` to auto-select the next best issue based on dependency order, priority, and readiness.

Board-pickup:
- Performs collision detection against in-progress work and open PRs
- Creates a branch
- Delegates implementation to the appropriate skill (or spawns parallel sub-agents for epics)
- Runs quality checks
- Creates a pull request with full board status sync

## 6. Review cycle

The reviewer, test-writer, and security-auditor agents review the work. Address feedback, push fixes, and re-request review.

## 7. Release

Run the `release` command to cut a versioned release.

Release:
- Classifies merged PRs to determine the semantic version bump
- Generates a grouped changelog (features, fixes, refactors, docs, infra)
- Runs quality gates
- Creates a git tag
- Publishes a GitHub release
- Optionally triggers deployment
