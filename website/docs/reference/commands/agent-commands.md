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

### board-groom

Ongoing backlog refinement for existing board items.

Scans all open issues, surfaces health-driven refinement suggestions (stale items, priority imbalances, missing metadata, decomposition candidates, duplicates), and lets you selectively apply grooming actions: re-prioritize, reclassify, re-scope, demote to triage, archive stale items, decompose oversized issues, merge duplicates, refresh dependencies, and remediate board health gaps.

### board-pickup

Pick up the next best issue from the board for development.

Auto-selects based on dependency order and priority when no specific issue is referenced. Performs collision detection against in-progress work, creates a branch, marks the issue in-progress, runs adaptive deep context analysis, delegates to the appropriate implementation skill with convention lock, and creates a pull request with label transitions and Projects V2 status sync.

### board-refresh

Regenerate the living board overview dashboard on demand.

Scans all open and recently closed issues, computes board health metrics (missing metadata, stale issues, blocked dependency chains), assigns recommended models using the quality-first heuristic, and updates the `meta:board-overview` issue with current status tables, epic progress, and health diagnostics.

### board-shared

Shared context and procedures referenced by all board commands. Provides board configuration from `hatch.json`, GitHub context, Projects V2 sync procedure, label taxonomy, tooling directives, and token-saving guidelines. Not invoked directly.

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

### api-spec

Generate API specifications from project requirements and existing code. Produces OpenAPI/Swagger specs with endpoint definitions, request/response schemas, authentication, and documentation. Integrates with `project-spec` for greenfield and `codebase-map` for brownfield.

### migration-plan

Plan a database or system migration with backward-compatible schema changes, idempotent migration scripts, rollback plans, data validation, and phased execution strategy. Produces migration specs and `todo.md` entries for `board-fill`.

### test-plan

Plan a comprehensive test strategy for a feature, module, or codebase area. Spawns parallel researchers (coverage analysis, complexity & risk mapping, test pattern extraction, boundary analysis, risk-based prioritization). Produces a test plan spec with coverage targets, strategy matrix, prioritized test case outlines, and `todo.md` entries. Supports feature-scoped planning (often chained from `feature-plan`) and module/codebase-level coverage auditing. Optionally chains to `hatch3r-test-writer` for immediate implementation or `hatch3r-board-fill` for issue creation.

## Quality Commands

### healthcheck

Create a full-product QA and testing audit epic. Discovers logical modules, creates per-module audit sub-issues plus cross-cutting audits.

### security-audit

Create a full-product security audit epic. Per-module audits covering 7 security domains (authentication, input validation, data protection, access control, secret management, error handling, API security).

### dep-audit

Scan, assess, and upgrade npm dependencies. Runs `npm audit` and `npm outdated`, researches migration paths, upgrades one at a time with testing.

### benchmark

Run and compare benchmark suites for code performance. Captures before/after metrics, detects regressions, and produces structured reports with statistical analysis.

## Release Commands

### release

Cut a versioned release with changelog. Determines semantic version bump, generates grouped changelog, runs quality gates, creates git tag, publishes GitHub release.

### onboard

Interactive project onboarding for new team members and AI agents. Scans the repository to build a contextual overview of project structure, conventions, key modules, and development workflow. Produces a personalized onboarding guide.

## Workflow Commands

### workflow

Guided development lifecycle with 4 phases: Analyze, Plan, Implement, and Review. Includes a quick mode for small tasks that skips unnecessary ceremony. Scale-adaptive -- adjusts depth based on issue complexity and scope.

### quick-change

Lightweight command for small, board-free changes (typo fixes, constant tweaks, config updates, small refactors). Parses batch input, applies soft scope guards (5 files / 200 lines threshold), classifies items as trivial (inline) or nontrivial (implementer sub-agent), runs quality checks, and optionally delegates a light review.

### revision

User-guided revision of agent-implemented code in a fresh context window. Reconstructs what was done from the git diff, interviews the user for structured feedback, proactively scans for agent leftovers (dead code, TODOs, type issues), delegates fixes to specialist sub-agents, and assesses merge readiness.

### debug

Standalone debug-and-fix command. Adds strategic debug logging (`[HATCH3R-DEBUG]` prefixed), pauses for the user to reproduce the issue and provide runtime logs, performs root cause analysis, implements the fix, removes all debug artifacts, and runs the full review-fix-test-security pipeline.

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
