---
sidebar_position: 1
title: Agents
---

# Agents

Specialized agents that handle distinct responsibilities in your development workflow. Each agent is defined in the canonical `agents/` content (shipped in the bundled npm package) and adapted to your coding tool's native format.

## Agent Reference

| Agent | Description |
|-------|-------------|
| **architect** | System architect who designs architecture, creates ADRs, analyzes dependencies, designs APIs and database schemas, and evaluates architectural trade-offs. |
| **brownfield-spec** | Brownfield spec agent -- produces a codebase map, existing-pattern detection, integration-surface analysis, and a migration-aware plan with a non-destructive-adoption check. |
| **ci-watcher** | CI/CD specialist who monitors pipeline runs, reads failure logs to diagnose root causes, and suggests focused fixes with local verification commands. |
| **context-rules** | Context-aware rules engine that applies coding standards based on file type, location, and project conventions, on save or during review. |
| **creator** | User-content authoring agent invoked by `/hatch3r-create`. Authors one user-tier artifact under `.hatch3r/overrides/`, runs strict + gentle quality gates, and writes only when all strict gates pass. |
| **dependency-drafter** | Dependency-analysis specialist who drafts version-bump and dependency-change proposals with upgrade-impact, advisory, and breaking-change assessment. Drafts only; never installs or edits a manifest. |
| **devops** | DevOps engineer who manages CI/CD pipelines, infrastructure as code, deployment strategies, monitoring setup, container configuration, and environment management. |
| **docs-writer** | Technical writer who maintains specs, ADRs, and documentation, keeping them in sync with code changes. |
| **edge-case-analyst** | Domain edge-case + error-handling correctness specialist who enumerates functional edge cases (identity collisions, state transitions, null/boundary, concurrency, partial failure) and verifies none were dropped between Plan, Implement, and Review. |
| **enhancability** | Enhancability quality specialist who reviews generated code for feature-flag adoption, config externalization, versioned APIs, forward-compatibility, and extension-point definition. |
| **fixer** | Targeted fix agent that takes structured reviewer output and implements fixes for Critical and Warning findings. Does not handle git, branches, commits, or PRs. |
| **greenfield-spec** | Greenfield spec agent -- produces market research, competitive analysis, user personas, tech-stack picks, PRD, acceptance criteria, risk inventory, and test plan for new projects. |
| **handoff-loader** | Session-start agent that surfaces active handoff documents from `.hatch3r/handoffs/active/` to detect in-progress work for resumption. |
| **handoff-preparer** | Prepares a canonical handoff document capturing mid-work session state, invoked by the on-context-switch hook and by `/hatch3r-handoff prepare`. |
| **implementer** | Focused implementation agent for a single issue. Receives issue context, delivers code changes and tests. Does not handle git, branches, commits, PRs, or board operations. |
| **incident-responder** | Incident-response specialist who drives a live production incident through structured triage, bounded-autonomy mitigation, stakeholder communication, and a blameless post-mortem. |
| **learnings-loader** | Session-start agent that surfaces relevant project learnings, recent decisions, and context from previous sessions. |
| **lint-fixer** | Code quality enforcer who fixes style, formatting, and TypeScript strict mode violations without changing logic. |
| **maintainability** | Maintainability quality specialist who reviews generated code for duplication index, pattern reuse, cyclomatic complexity, expand-contract migrations, and API breaking-change discipline. |
| **pack-installer** | Installs a community pack into the consumer repo after the trust-model gate clears -- verifies trust tier + signing method, dry-runs the write set, applies atomically, and rolls back on any failure. |
| **performance** | Performance quality specialist who reviews generated code for Core Web Vitals budgets (LCP/INP/CLS), backend p95/p99 latency, bundle size, and N+1 query elimination. |
| **product-spec** | Product & Spec quality specialist who reviews spec artifacts (PRDs, feature specs, acceptance criteria) for testable acceptance criteria, evidence-cited discovery claims, and spec-to-implementation traceability. |
| **reliability** | Reliability quality specialist who reviews generated services for OpenTelemetry instrumentation, SLO definition, RED+USE metrics, RFC 9457 error responses, and circuit-breaker/retry patterns. |
| **researcher** | Composable context researcher. Receives a research brief with mode selections and depth level, gathers context following the tooling hierarchy, and returns structured findings. Does not create or modify files. |
| **reviewer** | Expert code reviewer who checks for quality, security, privacy invariants, performance, accessibility, and adherence to specs. Outputs structured feedback by priority (critical, warning, suggestion). |
| **scalability** | Scalability quality specialist who reviews generated services for stateless handlers, back-pressure patterns, idempotency-key adoption, queue-based offloading, and connection-pool sizing. |
| **security** | Security quality specialist who reviews generated code for OAuth 2.1 + OIDC + DPoP + WebAuthn server-side, supply-chain integrity (SBOM + provenance + SHA-pin + cosign), and OWASP ASI controls. |
| **testability** | Testability quality specialist who reviews generated code for the per-feature test-class mandate, real-deal-first testing, coverage thresholds, and AI feature eval coverage. |
| **ui** | UI quality specialist who reviews generated UI for WCAG 2.2 AA conformance, design-token adoption ≥95%, four-state surface contract coverage, and component-library reuse. |
| **ux** | UX quality specialist who reviews generated UX flows for error-recovery clarity, first-run success, decisions-per-flow discipline, focus management, and screen-reader announcement. |

## Default Model Assignments

Every one of the 30 canonical agents declares a model **class** in its frontmatter — the 4-class ladder `frontier | advanced | standard | economy` — and 22 also author a reasoning-effort level (`low | medium | high | xhigh | max`). Each adapter maps the class to its native model vocabulary at emission time; no concrete model id appears in the canonical corpus.

| Class | Agents | Authored effort | Rationale |
|-------|--------|-----------------|-----------|
| `frontier` (16) | the 10 CQ specialists (`ui`, `ux`, `security`, `reliability`, `testability`, `scalability`, `performance`, `maintainability`, `enhancability`, `product-spec`) + `reviewer`, `architect`, `edge-case-analyst`, `incident-responder`, `greenfield-spec`, `brownfield-spec` | `xhigh` (13); `max` on `security`, `reviewer`, `edge-case-analyst` | Verdict/sign-off agents — a quality gate evaluated on a cheaper class silently weakens every verdict |
| `advanced` (3) | `implementer`, `fixer`, `creator` | `xhigh` | Mutating work agents — multi-file code changes carry the highest rework cost per defect |
| `standard` (6) | `researcher`, `docs-writer`, `devops`, `pack-installer`, `dependency-drafter`, `handoff-preparer` | -- (platform default) | Supporting work agents; runtime allocation raises them to `advanced` on Tier-3 tasks |
| `economy` (5) | `lint-fixer`, `ci-watcher`, `context-rules`, `handoff-loader`, `learnings-loader` | `low` on the 3 loaders (`context-rules`, `handoff-loader`, `learnings-loader`); -- (class default `medium`) on the rest | Mechanical agents — bounded transformations, re-verified downstream by the review gate |

Override any agent's model or effort via [Model Selection](../guides/model-selection).

## Canonical Location

Agent definitions live in the canonical `agents/hatch3r-{id}.md` content (bundled npm package; user-tier overrides mirror this layout under `.hatch3r/overrides/agents/`) with YAML frontmatter:

```yaml
---
id: hatch3r-architect
description: System architect who designs architecture and evaluates trade-offs.
model: frontier
effort: xhigh
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
| `user-flows` | Decompose a user story into Happy Path, Alternative Paths, and Error-Recovery Path with four-state mapping and microcopy before implementation. | `hatch3r-researcher` (gates `hatch3r-feature-plan` and `hatch3r-implementer`) |
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
| `user-question-protocol.md` | Protocol for surfacing clarifying questions across the four supported platforms: when to ask, native-tool preference where documented, and the required plain-text fallback. |
