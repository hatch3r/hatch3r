---
sidebar_position: 2
title: Agent Commands
---

# Agent Commands

Commands invoked inside your coding tool (e.g., as Cursor commands or Claude Code slash commands). These orchestrate agent workflows.

## Board Commands

### board-init

Bootstrap a GitHub Projects V2 board for your repository.

Creates a new project or connects to an existing one, configures status fields with five default columns, creates the full hatch3r label taxonomy, prompts for default branch, optionally migrates issues from another project, and writes all project IDs back to `hatch.json`. All mutations require user confirmation.

### board-fill

Parse `todo.md` and create GitHub epics and issues with full board reorganization.

Deduplicates against existing issues, classifies each item by type/executor/priority/area/risk, groups into epics, builds a dependency graph, determines implementation order, identifies parallel work lanes, and marks issues as `status:ready` when all readiness criteria are met.

### board-pickup

Pick up the next best issue from the board for development.

Auto-selects based on dependency order and priority when no specific issue is referenced. Performs collision detection, creates a branch, marks the issue in-progress, delegates to the appropriate skill (or spawns parallel sub-agents for epics), runs quality checks, and creates a pull request.

### board-refresh

Regenerate the living board overview dashboard on demand.

Scans all open and recently closed issues, computes board health metrics, assigns recommended models, and updates the `meta:board-overview` issue.

## Planning Commands

### project-spec

Generate complete project documentation from a project vision using parallel researcher sub-agents (stack, features, architecture, pitfalls, UX, business model & market, production & scale). Produces `docs/specs/`, `docs/adr/`, and `todo.md`.

### codebase-map

Analyze an existing codebase to reverse-engineer specifications. Spawns parallel analyzers to discover modules, dependencies, conventions, and tech debt. Outputs to `docs/specs/` and `docs/adr/`.

### roadmap

Generate a phased roadmap from specs or project vision. Breaks work into epics and features with dependency ordering and parallel work lane identification. Outputs to `todo.md` in `board-fill` format.

### feature-plan

Plan a single feature in depth. Spawns parallel researchers (codebase impact, feature design, architecture, risk & pitfalls). Produces a spec, ADR(s), and `todo.md` entries. Optionally chains into `board-fill`.

### bug-plan

Plan a complex bug investigation. Spawns parallel researchers (symptom tracer, root cause investigator, impact assessor, regression researcher). Produces an investigation report with ranked hypotheses and `todo.md` entries.

### refactor-plan

Plan a refactoring or migration effort. Auto-detects the refactoring dimension (structural, logical, visual, migration, or mixed). Produces a refactoring spec, ADR(s), and phased `todo.md` entries.

## Quality Commands

### healthcheck

Create a full-product QA and testing audit epic. Discovers logical modules, creates per-module audit sub-issues plus cross-cutting audits.

### security-audit

Create a full-product security audit epic. Per-module audits covering 7 security domains (authentication, input validation, data protection, access control, secret management, error handling, API security).

### dep-audit

Scan, assess, and upgrade npm dependencies. Runs `npm audit` and `npm outdated`, researches migration paths, upgrades one at a time with testing.

## Release Commands

### release

Cut a versioned release with changelog. Determines semantic version bump, generates grouped changelog, runs quality gates, creates git tag, publishes GitHub release.

## Workflow Commands

### workflow

Guided development lifecycle with 4 phases: Analyze, Plan, Implement, and Review. Includes quick mode for small tasks.

### hooks

Interactive hook management for event-driven agent activation. View, add, remove, and test lifecycle hooks.

### learn

Capture learnings from completed issues, code reviews, and architectural decisions into reusable knowledge files.

## Monitoring Commands

### context-health

Monitor conversation context health and detect degradation during long sessions. Provides token usage metrics and recommendations.

### cost-tracking

Track token usage and estimated costs across agent workflows. Per-command and per-agent cost breakdowns with budget alerts.

## Customization Commands

### recipe

Create and manage composable workflow recipes that chain commands and skills.

### agent-customize

Configure per-agent customization via `.customize.yaml` files.

### command-customize

Configure per-command customization via `.customize.yaml` files.

### skill-customize

Configure per-skill customization via `.customize.yaml` files.

### rule-customize

Configure per-rule customization via `.customize.yaml` files.
