---
sidebar_position: 3
title: Rules
---

# Rules

Persistent instructions (coding standards, conventions, patterns) that are always available to agents. Rules are included in the agent's context automatically.

## Rule Reference

| Rule | Description |
|------|-------------|
| **agent-orchestration** | Agent delegation patterns, sub-agent spawning conventions, result aggregation, and multi-agent coordination protocols. |
| **api-design** | Endpoint versioning, request validation, idempotency keys, structured error responses, auth, CORS, CSP, pagination, and webhook security. |
| **browser-verification** | When and how to verify UI changes in the browser via automation MCP -- dev server lifecycle, navigation, interaction, visual regression, screenshot evidence. |
| **code-standards** | TypeScript strict mode, naming conventions (`camelCase`/`PascalCase`/`SCREAMING_SNAKE`), and function/file length limits. |
| **component-conventions** | Component structure, typed props/emits, design tokens, WCAG AA accessibility, loading/error/empty states, form UX, and 60fps render targets. |
| **dependency-management** | Lockfile hygiene, new-dependency justification, CVE patching timelines (48h for critical), and bundle size budgets. |
| **error-handling** | Structured error hierarchy, typed error codes, exponential backoff for retries, and correlation IDs for tracing. |
| **feature-flags** | Flag naming (`FF_AREA_FEATURE`), storage, evaluation, gradual rollout, dependencies, kill switches, 30-day cleanup deadlines, and audit. |
| **git-conventions** | Git workflow, branch naming, commit message conventions, and merge strategy. |
| **i18n** | Internationalization, RTL support, locale management, and ICU message format. |
| **learning-consult** | When and how to consult project learnings during development. |
| **migrations** | Backward-compatible schema changes, idempotent scripts, rollback plans, and deploy-then-migrate ordering. |
| **observability** | Structured JSON logging, OpenTelemetry, SLO/SLI, distributed tracing, alerting, dashboards, and no PII in logs. |
| **performance-budgets** | Core Web Vitals, API latency, database query budgets, bundle size, and enforcement mechanisms. |
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

Rules live in `.agents/rules/hatch3r-{id}.md` with YAML frontmatter specifying `id`, `type`, `description`, and optional `globs` or `alwaysApply` flags.

## Customization

Override rule behavior per-project using `.hatch3r/rules/{id}.customize.yaml`. See [Customization](../guides/customization).
