---
sidebar_position: 2
title: Command Reference
---

# Command Reference

hatch3r provides two categories of commands: **CLI commands** run directly in your terminal, and **agent commands** are invoked inside your coding tool (e.g., as Cursor slash commands or by asking the agent to run them).

## CLI Commands

```bash
npx hatch3r init          # Interactive setup -- detect repo, select tools, generate everything
npx hatch3r sync          # Re-generate tool outputs from canonical .agents/ source
npx hatch3r update        # Pull latest hatch3r templates with safe merge
npx hatch3r status        # Check sync status between canonical and generated files
npx hatch3r validate      # Validate .agents/ structure and frontmatter
npx hatch3r add <pack>    # Install a community pack (coming soon)
```

## Agent Commands

### Board Management

**`hatch3r-board-init`** -- Bootstrap a GitHub Projects V2 board for your repository. Creates a new project or connects to an existing one, configures status fields with five default columns (Backlog, Ready, In Progress, In Review, Done), creates the full hatch3r label taxonomy (type, executor, status, priority, risk, meta), prompts for default branch, optionally migrates issues from another project, and writes all project IDs back to `hatch.json`. All mutations require user confirmation.

**`hatch3r-board-fill`** -- Parse `todo.md` and create GitHub epics and issues with full board reorganization. Deduplicates against existing issues, classifies each item by type/executor/priority/area/risk, groups into epics, builds a dependency graph, determines implementation order, identifies parallel work lanes, and marks issues as `status:ready` when all readiness criteria are met.

**`hatch3r-board-groom`** -- Ongoing backlog refinement for existing board items. Scans all open issues, surfaces health-driven refinement suggestions (stale items, priority imbalances, missing metadata, decomposition candidates, duplicates), and lets you selectively apply grooming actions: re-prioritize, reclassify, re-scope, demote to triage, archive stale items, decompose oversized issues, merge duplicates, refresh dependencies, and remediate board health gaps.

**`hatch3r-board-pickup`** -- Pick up the next best issue from the board for development. Auto-selects based on dependency order and priority when no specific issue is referenced. Performs collision detection against in-progress work, creates a branch, marks the issue in-progress, runs adaptive deep context analysis, delegates to the appropriate implementation skill with convention lock, and creates a pull request with label transitions and Projects V2 status sync.

**`hatch3r-board-refresh`** -- Regenerate the living board overview dashboard. Scans all open and recently closed issues, computes board health metrics (missing metadata, stale issues, blocked dependency chains), assigns recommended models using the quality-first heuristic, and updates the `meta:board-overview` issue with current status tables, epic progress, and health diagnostics.

**`hatch3r-board-shared`** -- Shared context and procedures referenced by all board commands. Provides board configuration from `hatch.json`, GitHub context, Projects V2 sync procedure, label taxonomy, tooling directives, and token-saving guidelines. Not invoked directly.

### Planning

**`hatch3r-project-spec`** -- Generate complete project documentation from a project vision using parallel researcher sub-agents (stack, features, architecture, pitfalls, UX, business model & market, production & scale). Produces `docs/specs/`, `docs/adr/`, and `todo.md`. Works for any project type -- web apps, APIs, CLIs, libraries, or monorepos.

**`hatch3r-api-spec`** -- Generate API specifications from project requirements and existing code. Produces OpenAPI/Swagger specs with endpoint definitions, request/response schemas, authentication, and documentation. Integrates with `hatch3r-project-spec` for greenfield and `hatch3r-codebase-map` for brownfield.

**`hatch3r-codebase-map`** -- Analyze an existing codebase to reverse-engineer specifications. Spawns parallel analyzer sub-agents to discover modules, dependencies, conventions, and tech debt. Outputs structured documentation to `docs/specs/` and `docs/adr/`.

**`hatch3r-roadmap`** -- Generate a phased roadmap from specs or project vision. Breaks work into epics and features with dependency ordering and parallel work lane identification. Outputs to `todo.md` in `hatch3r-board-fill` format, ready for immediate board population.

**`hatch3r-feature-plan`** -- Plan a single feature in depth. Spawns parallel researcher sub-agents (codebase impact, feature design, architecture, risk & pitfalls) to break a feature idea into a detailed spec, ADR(s), and structured `todo.md` entries for `hatch3r-board-fill`. Optionally chains directly into `hatch3r-board-fill` to create GitHub issues.

**`hatch3r-bug-plan`** -- Plan a complex bug investigation. Spawns parallel researcher sub-agents (symptom tracer, root cause investigator, impact assessor, regression researcher) to diagnose ambiguous bugs. Produces an investigation report with ranked hypotheses, evidence, and reproduction strategy, plus scoped `todo.md` entries for `hatch3r-board-fill`.

**`hatch3r-refactor-plan`** -- Plan a refactoring or migration effort. Spawns parallel researcher sub-agents (current state analyzer, strategy designer, impact/risk assessor, migration path planner) to design a phased execution plan. Auto-detects the refactoring dimension (structural, logical, visual, migration, or mixed) and adapts researcher prompts accordingly.

**`hatch3r-migration-plan`** -- Plan a database or system migration with backward-compatible schema changes, idempotent migration scripts, rollback plans, data validation, and phased execution strategy. Produces migration specs and `todo.md` entries for `hatch3r-board-fill`.

### Quality & Auditing

**`hatch3r-healthcheck`** -- Create a full-product QA and testing audit epic. Discovers logical modules from the project's directory structure, creates a parent epic with one sub-issue per module plus cross-cutting audits for inter-module wiring and product vision alignment.

**`hatch3r-security-audit`** -- Create a full-product security audit epic. Discovers logical modules, creates a parent epic with one sub-issue per module plus cross-cutting audits for trust boundaries and OWASP Top 10 alignment. Audits 7 security domains per module.

**`hatch3r-dep-audit`** -- Scan, assess, and upgrade npm dependencies. Runs `npm audit` and `npm outdated` across root and workspace packages, categorizes findings by severity, researches migration paths via Context7 and web search, upgrades packages one at a time with testing after each.

**`hatch3r-benchmark`** -- Run and compare benchmark suites for code performance. Captures before/after metrics, detects regressions, and produces structured reports with statistical analysis.

### Development Workflow

**`hatch3r-workflow`** -- Guided development lifecycle with 4 phases: Analyze, Plan, Implement, and Review. Includes a quick mode for small tasks that skips unnecessary ceremony. Scale-adaptive -- adjusts depth based on issue complexity and scope.

**`hatch3r-quick-change`** -- Lightweight command for small, board-free changes (typo fixes, constant tweaks, config updates, small refactors). Parses batch input, applies soft scope guards (5 files / 200 lines threshold), classifies items as trivial (inline) or nontrivial (implementer sub-agent), runs quality checks, and optionally delegates a light review.

**`hatch3r-revision`** -- User-guided revision of agent-implemented code in a fresh context window. Reconstructs what was done from the git diff, interviews the user for structured feedback, proactively scans for agent leftovers (dead code, TODOs, type issues), delegates fixes to specialist sub-agents, and assesses merge readiness.

**`hatch3r-debug`** -- Standalone debug-and-fix command. Adds strategic debug logging (`[HATCH3R-DEBUG]` prefixed), pauses for the user to reproduce the issue and provide runtime logs, performs root cause analysis, implements the fix, removes all debug artifacts, and runs the full review-fix-test-security pipeline.

### Release & Ops

**`hatch3r-release`** -- Cut a versioned release with changelog. Determines the semantic version bump from merged PR classifications, generates a grouped changelog (features, fixes, refactors, docs, infra), runs quality verification, bumps `package.json`, creates a git tag, and publishes a GitHub release with notes.

**`hatch3r-onboard`** -- Interactive project onboarding for new team members and AI agents. Scans the repository to build a contextual overview of project structure, conventions, key modules, and development workflow. Produces a personalized onboarding guide.

**`hatch3r-hooks`** -- Interactive hook management for event-driven agent activation. View, add, remove, and test lifecycle hooks that trigger agents on specific events (e.g., post-commit, pre-push, issue assignment).

### Knowledge & Monitoring

**`hatch3r-learn`** -- Capture learnings from completed issues, code reviews, and architectural decisions into reusable knowledge files. Learnings are indexed by topic and auto-consulted when similar work is encountered in the future.

**`hatch3r-context-health`** -- Monitor conversation context health and detect degradation during long agent sessions. Provides metrics on token usage, context window utilization, and recommendations for when to start a fresh session.

**`hatch3r-cost-tracking`** -- Track token usage and estimated costs across agent workflows. Provides per-command and per-agent cost breakdowns with budget alerts.

**`hatch3r-recipe`** -- Create and manage composable workflow recipes. Recipes are reusable workflow templates that chain multiple commands and skills into repeatable sequences.

### Customization

**`hatch3r-agent-customize`** -- Configure per-agent customization via `.customize.yaml` files. Allows project-specific agent behavior overrides without modifying managed agent definitions.

**`hatch3r-command-customize`** -- Configure per-command customization via `.customize.yaml` files. Allows project-specific command behavior overrides without modifying managed command definitions.

**`hatch3r-skill-customize`** -- Configure per-skill customization via `.customize.yaml` files. Allows project-specific skill behavior overrides without modifying managed skill definitions.

**`hatch3r-rule-customize`** -- Configure per-rule customization via `.customize.yaml` files. Allows project-specific rule behavior overrides without modifying managed rule definitions.
