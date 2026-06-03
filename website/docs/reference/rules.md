---
sidebar_position: 3
title: Rules
---

# Rules

Persistent instructions (coding standards, conventions, patterns) that are always available to agents. Rules are included in the agent's context automatically.

## Rule Reference

| Rule | Description |
|------|-------------|
| **accessibility-standards** | Accessibility standards covering WCAG 2.2 AA compliance, keyboard navigation, screen readers, and ARIA patterns. |
| **agent-orchestration** | Agent delegation patterns, sub-agent spawning conventions, result aggregation, and multi-agent coordination protocols. |
| **agent-orchestration-detail** | Extended orchestration reference -- PipelineContext schemas, resilience protocols, observability integration, and auto-mode guardrails. |
| **api-design** | Endpoint versioning, request validation, idempotency keys, structured error responses, auth, CORS, CSP, pagination, and webhook security. |
| **browser-verification** | When and how to verify UI changes in the browser via automation MCP -- dev server lifecycle, navigation, interaction, visual regression, screenshot evidence. |
| **ci-cd** | CI/CD pipeline standards covering stage gates, deployment strategies, and rollback procedures. |
| **code-standards** | TypeScript strict mode, naming conventions (`camelCase`/`PascalCase`/`SCREAMING_SNAKE`), and function/file length limits. |
| **component-conventions** | Component structure, typed props/emits, design tokens, WCAG AA accessibility, loading/error/empty states, form UX, and 60fps render targets. |
| **data-classification** | Data classification standards covering PII handling, encryption, retention policies, and regulatory compliance. |
| **deep-context** | Adaptive pre-implementation analysis -- complexity scoring, requirements elicitation, similar implementation discovery, and transitive dependency tracing before coding. |
| **dependency-management** | Lockfile hygiene, new-dependency justification, CVE patching timelines (48h for critical), and bundle size budgets. |
| **feature-flags** | Flag naming (`FF_AREA_FEATURE`), storage, evaluation, gradual rollout, dependencies, kill switches, 30-day cleanup deadlines, and audit. |
| **git-conventions** | Git workflow, branch naming, commit message conventions, and merge strategy. |
| **i18n** | Internationalization, RTL support, locale management, and ICU message format. |
| **iteration-summary** | Every user-facing iteration ends with the canonical Iteration Summary block -- a 5-field contract exposing status, gaps, and confidence at a glance. |
| **learning-consult** | When and how to consult project learnings during development. |
| **migrations** | Backward-compatible schema changes, idempotent scripts, rollback plans, and deploy-then-migrate ordering. |
| **observability** | Structured JSON logging, OpenTelemetry, SLO/SLI, distributed tracing, alerting, dashboards, and no PII in logs. |
| **observability-logging** | Structured logging and error reporting conventions for the project. |
| **observability-metrics** | Metrics, SLO/SLI definitions, alerting, and dashboard conventions for the project. |
| **observability-tracing** | Distributed tracing, OpenTelemetry semantic conventions, AI agent instrumentation, and correlation ID conventions. |
| **observability-tracing-detail** | Extended tracing reference -- AI agent instrumentation, tool call audit trails, LLM request tracing, and correlation ID patterns. |
| **performance-budgets** | Core Web Vitals, API latency, database query budgets, bundle size, and enforcement mechanisms. |
| **right-sizing** | Always-on maturity-calibration rule -- directs agents to invest only as deep as the project's tier (solo/team/scaleup/enterprise) needs, anchored by a universal floor (security, correctness, accessibility basics, baseline tests) that binds at every tier. |
| **secrets-management** | Secret management, rotation, and secure handling patterns for the project. |
| **security-patterns** | Input validation, output encoding, auth enforcement, AI/agentic security, and OWASP alignment. |
| **testing** | Deterministic, isolated, fast tests with clear naming, regression coverage, no network in unit tests, no `any`. |
| **theming** | Dark mode, `prefers-color-scheme`, CSS custom properties, and semantic color tokens. |
| **tooling-hierarchy** | Priority order for knowledge: project specs > codebase > library docs (Context7 MCP) > web research; GitHub CLI-first. |

## Rule Types

Rules have different application scopes:

- **Always-apply** -- active in every conversation (e.g., `code-standards`, `git-conventions`)
- **Glob-scoped** -- active only when files matching specific patterns are in context (e.g., `component-conventions` for `*.tsx`)
- **Agent-attached** -- referenced by specific agents

## Canonical Location

Rules live in the canonical `rules/hatch3r-{id}.md` content (bundled npm package; user-tier overrides mirror this layout under `.hatch3r/overrides/rules/`) with YAML frontmatter specifying `id`, `type`, `description`, and optional `globs` or `alwaysApply` flags.

## Customization

Override rule behavior per-project using `.hatch3r/rules/{id}.customize.yaml`. See [Customization](../guides/customization).

### Rule Precedence and Description Quality

Rule frontmatter accepts an optional `precedence` field used by static routing to order concatenated rule output and resolve conflicts when multiple rules match a context:

```yaml
precedence: critical  # values: critical | high | normal | low  (default: normal)
```

Per-file rule adapters (cursor, copilot) emit filenames prefixed with a two-digit rank (`10-`, `30-`, `50-`, `70-`) so load order follows precedence. The Claude adapter inlines always-apply rules into `CLAUDE.md` in precedence order. Precedence is parity-validated across `.md` and `.mdc` variants by `scripts/validate-rule-parity.ts`.

`npx hatch3r validate` runs a description-quality lint on every canonical `agents/`, `skills/`, `rules/`, and `commands/` artifact: descriptions must be **at least 60 characters** and must not cosine-collide (threshold `>= 0.55`) with another description in the same `(type, primary-tag)` cluster. Authoring guidance lives in [`.claude/rules/content-authoring.md`](https://github.com/hatch3r/hatch3r/blob/main/.claude/rules/content-authoring.md).
