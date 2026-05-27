---
sidebar_position: 1
title: Agents
---

# Agents

Specialized agents that handle distinct responsibilities in your development workflow. Each agent is defined in the canonical `agents/` content (shipped in the bundled npm package) and adapted to your coding tool's native format.

## Agent Reference

| Agent | Description |
|-------|-------------|
| **a11y-auditor** | Accessibility specialist who audits WCAG AA compliance -- keyboard navigation, color contrast, ARIA attributes, and reduced motion support. |
| **architect** | Architecture design and ADR production. Evaluates system structure, proposes changes, and produces architecture decision records. |
| **ci-watcher** | CI/CD specialist who monitors GitHub Actions runs, reads failure logs to identify root causes, and suggests focused fixes with local verification commands. |
| **context-rules** | Dynamic context rule generation agent. Analyzes project patterns and automatically creates context-aware rules for improved agent performance. |
| **creator** | User-content authoring agent invoked by `/hatch3r-create`. Authors one user-tier artifact (agent, skill, rule, command, or hook) under `.hatch3r/overrides/`, runs strict and gentle quality gates via `saveUserContent`, and writes only when strict gates pass. |
| **dependency-auditor** | Supply chain security analyst who scans for CVEs, evaluates upgrade paths, assesses bundle size impact, and verifies lockfile integrity. |
| **devops** | CI/CD and deployment operations agent. Manages pipeline configuration, deployment scripts, infrastructure-as-code, and environment provisioning. |
| **docs-writer** | Technical writer who maintains specs, ADRs, glossary, and process documentation, keeping them in sync with code changes. |
| **fixer** | Targeted fix agent for reviewer findings. Receives specific critical or warning findings from `hatch3r-reviewer` and implements precise fixes without scope creep. |
| **implementer** | Focused implementation agent for a single sub-issue. Receives issue context from a parent orchestrator, delivers code and tests, and reports structured results. Does not handle git or board operations. |
| **learnings-loader** | Knowledge base consultation agent. Loads and indexes learnings from past issues, code reviews, and architectural decisions to inform current work. |
| **lint-fixer** | Code quality enforcer who fixes ESLint, Prettier, and TypeScript strict mode violations without changing logic. Removes dead code and unused imports. |
| **perf-profiler** | Performance engineer who profiles runtime performance, analyzes bundle size, identifies memory leaks, and benchmarks against defined performance budgets. |
| **researcher** | Research specialist who performs deep investigation on assigned topics using parallel analysis. Used as a sub-agent by planning commands (`project-spec`, `feature-plan`, `bug-plan`, `refactor-plan`). |
| **reviewer** | Senior code reviewer who checks for correctness, security, privacy invariants, performance regressions, and accessibility. Outputs structured feedback by priority (critical, warning, suggestion). |
| **security-auditor** | Security analyst who audits database rules, cloud functions, and data flows. Verifies privacy invariants, writes security rules tests, and validates entitlement enforcement. |
| **test-writer** | QA engineer who writes deterministic, isolated tests -- unit, integration, E2E, security rules, and contract tests. Focuses on edge cases and regression coverage. |

## Default Model Assignments

Some agents ship with a default model in their canonical frontmatter, tuned for their cognitive profile.

| Agent | Default Model | Rationale |
|-------|:-------------:|-----------|
| `hatch3r-lint-fixer` | `haiku` | Mechanical pattern fixes; speed and low cost matter most |
| `hatch3r-ci-watcher` | `haiku` | Log parsing and pattern recognition; fast feedback loops |
| `hatch3r-docs-writer` | `sonnet` | Writing quality and technical accuracy need a capable model |
| `hatch3r-dependency-auditor` | `sonnet` | Structured CVE/freshness analysis with clear SLAs |
| `hatch3r-a11y-auditor` | `sonnet` | WCAG standard interpretation requires solid reasoning |
| `hatch3r-test-writer` | `sonnet` | Edge-case identification and test design need reasoning depth |

Agents without a default use the platform's own default. Override any agent's model via [Model Selection](../guides/model-selection).

## Canonical Location

Agent definitions live in the canonical `agents/hatch3r-{id}.md` content (bundled npm package; user-tier overrides mirror this layout under `.hatch3r/overrides/agents/`) with YAML frontmatter:

```yaml
---
id: hatch3r-implementer
description: Focused implementation agent for a single issue.
model: opus
---
```

## Customization

Override agent behavior per-project using `.hatch3r/agents/{id}.customize.yaml`. See [Customization](../guides/customization).

## Agent Modes

Modes are orchestration-depth profiles that `hatch3r-researcher` selects per task. Each mode constrains the researcher's output structure and tool usage to a single research dimension. Files live in the canonical `agents/modes/{mode}.md` content (bundled npm package).

| Mode | Purpose | Used by |
|------|---------|---------|
| `root-cause` | Rank candidate root causes by likelihood using static analysis patterns (race conditions, null checks, anti-patterns). | `hatch3r-researcher` (bug-plan flows) |
| `feature-design` | Break a subject into implementable sub-tasks with user stories, acceptance criteria, edge cases, and effort estimates. | `hatch3r-researcher` (feature-plan flows) |
| `complexity-risk` | Identify complexity hotspots and mutation-prone areas to prioritize testing effort. | `hatch3r-researcher` (`hatch3r-test-plan` flows) |
| `requirements-elicitation` | Detect ambiguities and generate structured user questions across 10 dimensions before implementation. | `hatch3r-researcher` (triggered by `hatch3r-deep-context` rule) |
| `risk-assessment` | Identify technical risks, security implications, performance concerns, and breaking changes. | `hatch3r-researcher` (planning and review flows) |
| `coverage-analysis` | Map existing test coverage, identify gaps, and surface critical untested paths. | `hatch3r-researcher` (`hatch3r-test-plan` flows) |
| `boundary-analysis` | Map integration boundaries, external dependencies, and data-flow seams for integration and contract test targeting. | `hatch3r-researcher` (`hatch3r-test-plan` flows) |
| `architecture` | Design the architectural approach: data model, API contracts, component design, and ADR-worthy decisions. | `hatch3r-researcher` (planning and refactor flows) |
| `migration-path` | Design a phased execution plan with safe ordering, rollback points, and parallel lanes mapped to execution skills. | `hatch3r-researcher` (planning and refactor flows) |
| `regression` | Investigate when an issue was introduced by analyzing git history, dependency updates, and configuration changes. | `hatch3r-researcher` (bug-plan flows) |
| `impact-analysis` | Map the blast radius of an issue across flows, modules, data, and downstream consumers. | `hatch3r-researcher` (bug-plan and review flows) |
| `codebase-impact` | Analyze the current codebase to map what exists in the areas a subject touches (files, modules, coupling). | `hatch3r-researcher` (planning flows) |
| `current-state` | Map the current state of code under analysis — complexity, coupling, cohesion, coverage — across structural, logical, visual, and migration dimensions. | `hatch3r-researcher` (refactor-plan flows) |
| `library-docs` | Look up current API documentation for a named library via Context7 MCP (`resolve-library-id` plus `query-docs`). | `hatch3r-researcher` (any flow needing external library facts) |
| `prior-art` | Research best practices, known issues, and ecosystem trends via web search for novel problems or security advisories. | `hatch3r-researcher` (any flow without local docs coverage) |
| `refactoring-strategy` | Design the refactoring approach: transformations (extract/inline/rename/restructure), invariants, and patterns. | `hatch3r-researcher` (refactor-plan flows) |
| `risk-prioritization` | Produce a risk-ranked prioritization of testing effort by business impact, security exposure, change frequency, and coverage. | `hatch3r-researcher` (`hatch3r-test-plan` flows) |
| `similar-implementation` | Search the codebase for analogous features and extract implementation conventions for the implementer to follow. | `hatch3r-researcher` (feature-plan and implementation flows) |
| `symptom-trace` | Trace reported symptoms through the codebase to find where expected behavior diverges from observed behavior. | `hatch3r-researcher` (bug-plan flows) |
| `test-pattern` | Extract existing test conventions, framework usage, mock patterns, and helper libraries so new tests align with project infrastructure. | `hatch3r-researcher` (`hatch3r-test-plan` flows) |

## Shared Agent Resources

Reference documents under the canonical `agents/shared/` content (bundled npm package) provide cross-agent canonical authority. Agents include them via frontmatter fields such as `quality_charter:` and `efficiency_patterns:` rather than copying content.

| File | Purpose |
|------|---------|
| `quality-charter.md` | Canonical quality authority referenced by every agent: confidence levels, current-information tooling hierarchy, root-cause orientation, measurable criteria. The single source of truth for agent conduct. |
| `prompt-structure.md` | XML-tag structuring pattern (`<task>`, `<context>`, `<rules>`) for agent prompts per Anthropic Claude 4.x guidance. Applied to agents over 200 lines or with mixed content types. |
| `efficiency-patterns.md` | The 8 P7 efficiency patterns referenced via `efficiency_patterns:` frontmatter (static-first prompts, parallel-tool-by-default, triage-first orchestration, plan/act split, structured outputs, lazy loading, conditional loading, diff-only outputs). |
| `external-knowledge.md` | Tooling hierarchy for external lookups: specs first, then codebase, Context7 MCP, web research, and the platform CLI (`gh` / `az` / `glab`) for issue and PR operations. |
| `injection-patterns.md` | Canonical catalog of prompt-injection patterns kept in lockstep with `src/pipeline/promptGuard.ts` and `src/content/learningsValidation.ts`. OWASP ASI01/ASI06/ASI07 coverage. |
| `user-content-templates.md` | Body and frontmatter skeletons for the 5 user-authored content types (agent, skill, rule, command, hook). Consumed by `hatch3r-creator`. |
| `user-question-protocol.md` | Protocol for surfacing clarifying questions across the 3 supported platforms (Cursor, Claude Code, Copilot): when to ask, native-tool preference, and plain-text fallback shape. |

