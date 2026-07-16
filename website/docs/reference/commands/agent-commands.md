---
sidebar_position: 2
title: Agent Commands
---

# Agent Commands

Commands invoked inside your coding tool (e.g. as Cursor commands or Claude Code slash commands). A command is an **orchestrator**: it delegates to one or more hatch3r agents via the Task tool. Single-pass procedures, dispatchers, and inline workflows ship as [Skills](../skills) instead, so board grooming, customization, cost tracking, learning capture, and the other non-orchestrating flows live on the Skills page, not here.

There are 32 agent commands.

## Spec and Planning Commands

### plan

Planning router. Classifies a free-form planning request against the nine planning flows (feature-plan, bug-plan, migration-plan, refactor-plan, test-plan, api-spec, project-spec, roadmap, spec), confirms the match, and drives the matched flow(s) with shared intake context. Produces one consolidated outcome and ends with an execute-now (same session, default) or defer choice — the single copy-paste plan-execution prompt for a fresh session remains as the deferral path.

### spec

Spec orchestrator. Detects greenfield vs brownfield project state and runs the matching spec agent to produce requirements, acceptance criteria, a risk inventory, and a test plan. Greenfield adds market/competitive/persona/tech-stack research; brownfield adds codebase-map, existing-pattern detection, integration-surface analysis, and a migration-aware plan.

### project-spec

Translate a greenfield vision into future-state design artifacts using parallel researcher sub-agents (stack, features, architecture, pitfalls, UX, business model & market, production & scale). Produces `docs/specs/`, `docs/adr/`, and `todo.md`.

### codebase-map

Reverse-engineer a brownfield codebase into current-state module boundaries and specifications. Spawns parallel analyzers to discover modules, dependencies, conventions, and tech debt. Outputs to `docs/specs/` and `docs/adr/`.

### roadmap

Sequence delivery phases over time into a dependency-ordered milestone plan. Breaks work into epics and features with parallel work-lane identification. Outputs to `todo.md` in `board-fill` format.

### feature-plan

Plan a single feature in depth. Spawns parallel researchers (codebase impact, feature design, architecture, risk & pitfalls). Produces a spec, ADR(s), and `todo.md` entries. Optionally chains into `board-fill`. Ends with an execute-now (same session, default) or defer (fresh-session prompt) choice.

### bug-plan

Diagnose a complex incident. Spawns parallel researchers (symptom tracer, root-cause investigator, impact assessor, regression researcher). Produces an investigation report with ranked hypotheses and `todo.md` entries. Ends with an execute-now (same session, default) or defer (fresh-session prompt) choice.

### refactor-plan

Plan a refactoring or migration effort. Auto-detects the refactoring dimension (structural, logical, visual, migration, or mixed). Produces a refactoring spec, ADR(s), and phased `todo.md` entries. Ends with an execute-now (same session, default) or defer (fresh-session prompt) choice.

### api-spec

Generate or validate an OpenAPI specification from project requirements and existing code. Produces endpoint definitions, request/response schemas, authentication, and documentation. Integrates with `project-spec` for greenfield and `codebase-map` for brownfield.

### migration-plan

Plan a database or system migration with backward-compatible schema changes, idempotent migration scripts, rollback plans, data validation, and a phased execution strategy. Produces migration specs and `todo.md` entries for `board-fill`. Ends with an execute-now (same session, default) or defer (fresh-session prompt) choice.

### test-plan

Plan a test strategy for a feature, module, or codebase area across coverage, risk, and boundary dimensions. Spawns parallel researchers (coverage analysis, complexity & risk mapping, test-pattern extraction, boundary analysis, risk-based prioritization). Produces a test-plan spec with coverage targets, a strategy matrix, prioritized test-case outlines, and `todo.md` entries. Optionally chains to `hatch3r-testability` for implementation or `board-fill` for issue creation. Ends with an execute-now (same session, default) or defer (fresh-session prompt) choice.

## Board Commands

### board-fill

Create epics and issues/work items from `todo.md`, then reorganize the board with dependency analysis, readiness assessment, and implementation ordering. Deduplicates against existing issues, classifies each item by type/executor/priority/area/risk, groups into epics, builds a dependency graph, identifies parallel work lanes, and marks issues `status:ready` when all readiness criteria are met. Supports GitHub Projects V2, Azure DevOps, and GitLab.

### board-pickup

Pick up the next best epic/issue from the board for development. Auto-selects by dependency order and priority when no issue is referenced, performs collision detection against in-progress work, creates a branch, runs adaptive deep-context analysis, delegates to the appropriate implementation skill with convention lock, and opens a pull request with label transitions and board-status sync. Multi-platform.

Board setup, grooming, and dashboard refresh are skills (`/hatch3r-board-init`, `/hatch3r-board-groom`, `/hatch3r-board-refresh`) — see the [Skills reference](../skills).

## Quality Commands

### healthcheck

Open a QA and reliability epic surveying coverage gaps, flaky tests, and missing audits. Discovers logical modules and creates per-module audit sub-issues plus cross-cutting audits.

### security-audit

Open an OWASP ASI security epic. Per-module audits cover authentication, input validation, data protection, access control, secret management, error handling, and API security.

### benchmark

Run and compare benchmark suites for code performance. Captures before/after metrics, detects regressions, and produces structured reports with statistical analysis.

## Pipeline and Fix Commands

### bug-pipeline

Run a known-cause bug fix through a 3-phase test-first pipeline -- reproduce + root-cause, regression-test + fix together, then root-cause-depth review -- with full sub-agent delegation.

### debug

Standalone debug-and-fix workflow. Adds strategic debug logging (`[HATCH3R-DEBUG]` prefixed), pauses for the user to reproduce the issue and provide runtime logs, performs root-cause analysis, implements the fix, removes all debug artifacts, and runs the full review-fix-test-security pipeline.

### rework

User-guided rework planning for agent-implemented code in a fresh context window. Reconstructs what was delivered from the git diff, interviews the user for feedback, scans for agent leftovers (dead code, TODOs, type issues), validates the findings read-only against the code, and ends at a rework plan (`docs/rework/`) with an execute-now (same session, default) or defer (fresh-session prompt) choice — the planning pass never fixes inline, never commits, never pushes, and `--auto`/`--review-only` never auto-execute.

### quick-change

Lightweight workflow for small, board-free changes (typo fixes, constant tweaks, config updates, small refactors). Parses batch input, applies soft scope guards (5 files / 200 lines), classifies items as trivial (inline) or nontrivial (implementer sub-agent), runs quality checks, and optionally delegates a light review.

### pr-resolve

Read all open PR comments (inline + review summary + general discussion) across GitHub, Azure DevOps, and GitLab; evaluate each against current code via the rigor contract; implement accepted findings through the standard agent pipeline; and reply per comment with rationale. Auto-detects the PR from the current branch or accepts an explicit PR number.

## Scaffold Commands

### auth-scaffold

Scaffold authentication boilerplate for a greenfield API service -- OAuth 2.1 authorization-code-with-PKCE flow, OIDC ID-token validation, and hashed personal-access-token (PAT) issuance/verification. The implementer writes the code; `hatch3r-security` gates it against the CQ3 auth-depth floor.

### design-system-create

Create a project design system from brand assets or an elicitation dialog -- DTCG 2025.10 token emission with a 3-tier taxonomy (primitive -> semantic -> component), OKLCH color ramps, and dual output `design-tokens.json` + `docs/design.md`. Runs the `hatch3r-design-system-detect` skill first (a `reuse` verdict halts the run instead of overwriting an existing system); the implementer writes the files; `hatch3r-ui` and `hatch3r-ux` gate the result in parallel on WCAG 2.2 AA contrast, 100% theme parity, and 0 dangling aliases.

### slo-scaffold

Generate baseline SLI/SLO scaffolding for a user-facing service -- availability + latency p95/p99 objectives, a 28-day error budget, and Google-SRE multi-window multi-burn-rate alert rules in OpenSLO `openslo/v1`. The implementer writes the files; `hatch3r-reliability` gates them against the CQ4 floor.

## Incident Commands

### incident-response

Drive a live production incident through a structured lifecycle -- triage + topology, bounded-autonomy mitigation, stakeholder communication, then a blameless post-mortem with runbook -- via delegated sub-agents.

## Release and Onboarding Commands

### release

Cut a versioned release with changelog. Determines the semantic-version bump, generates a grouped changelog, runs quality gates, creates the git tag, and publishes the GitHub release.

### onboard

Generate an onboarding guide for a new developer joining the project. Spawns parallel researchers to analyze codebase structure, architecture, and conventions, then produces a tailored document with setup instructions, an architecture walkthrough, coding conventions, key workflows, tribal knowledge, and a quick-reference cheat sheet.

## Workflow Commands

### workflow

Guided development lifecycle with 4 phases: Analyze, Plan, Implement, and Review. Includes a quick mode for small tasks that skips unnecessary ceremony. Scale-adaptive -- adjusts depth based on issue complexity and scope.

### handoff

Capture mid-work session state into a tool-agnostic handoff artifact under `.hatch3r/handoffs/active/<id>.md` so any of the 3 supported coding tools (Claude Code, Cursor, Copilot) can resume the work cleanly later -- same tool or different tool, same developer or different developer.

```
/hatch3r-handoff prepare           # capture current session state into a new handoff
/hatch3r-handoff resume [id]       # load + validate a prior handoff; transitions to "resumed"
/hatch3r-handoff list [--archived] # show active (and optionally archived) handoffs
/hatch3r-handoff complete <id>     # transition handoff to "completed" and archive atomically
/hatch3r-handoff prune [--dry-run] # auto-archive expired actives; delete archives older than 90 days
```

`prepare` delegates to `hatch3r-handoff-preparer` to capture state via the 10-criterion readiness gate (`rules/hatch3r-handoff-readiness.md`) -- body ≤ 50 KB, all 8 required sections present (Problem, Decisions, Work Done, Work Remaining, Blockers, Next Steps, Build & Test Status, File Manifest), `git_ref` matches HEAD, integrity hash computed, injection-pattern scan clean. `resume` validates schema + integrity + `git_ref` drift + expiry before surfacing content under user-tier instruction-hierarchy markers. The frontmatter shape maps 1:1 to the 2026 cross-framework consensus payload (OpenAI Agents SDK, Microsoft Agent Framework, softaworks/agent-toolkit) so non-hatch3r tools can consume hatch3r handoffs via the bi-directional `payloadAdapter` (`src/content/handoffs/payloadAdapter.ts`).

A session-start sibling agent `hatch3r-handoff-loader` surfaces active handoffs ranked by work-item match, recency, and status priority. Manifest gate: `features.handoffs: boolean` (default `true`).

## Pack Commands

### pack-install

Walk the user through the pack trust-model gate (tier + signature + body-scan + capability declaration), confirm the trust posture, then delegate the verified install to `hatch3r-pack-installer`.

## Framework Commands

### create

Author a new user-tier artifact (agent, skill, rule, command, or hook) for this project. Collects type, name, description, tags, adapter scope, and type-specific fields, then delegates to `hatch3r-creator` to compose frontmatter + body skeleton, run the strict + gentle gate funnel, and atomic-write the file under `.hatch3r/overrides/{type}/`.

When to use: you need a project-specific artifact that does not exist in the canonical hatch3r corpus, and you want it preserved across `hatch3r update` and `hatch3r clean`.

Outputs: one new file under `.hatch3r/overrides/{type}/{name}.md` (rules also write a paired `.mdc`; skills create a `{name}/SKILL.md` subdirectory). Run `hatch3r sync` afterward to propagate the artifact to all enabled adapter outputs.

### diagnose

Troubleshoot a hatch3r framework issue (setup, config, adapter wiring, drift). Gathers state, delegates root-cause analysis to `hatch3r-researcher`, proposes a fix, and applies it via `hatch3r-fixer` after one confirmation gate.

## Related Skills

The following user-invocable flows are **skills**, not commands, because they run a single-pass procedure rather than orchestrating sub-agents. They are documented on the [Skills reference](../skills): `board-init`, `board-groom`, `board-refresh`, `board-shared`, `context-health`, `cost-tracking`, `customize`, `dep-audit`, `hooks`, `learn`, `recipe`, and `report`.
