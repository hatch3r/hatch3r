---
sidebar_position: 1
title: Agents
---

# Agents

Specialized agents that handle distinct responsibilities in your development workflow. Each agent is defined in `.agents/agents/` and adapted to your coding tool's native format.

## Agent Reference

| Agent | Description |
|-------|-------------|
| **a11y-auditor** | Accessibility specialist who audits WCAG AA compliance -- keyboard navigation, color contrast, ARIA attributes, and reduced motion support. |
| **ci-watcher** | CI/CD specialist who monitors GitHub Actions runs, reads failure logs to identify root causes, and suggests focused fixes with local verification commands. |
| **dependency-auditor** | Supply chain security analyst who scans for CVEs, evaluates upgrade paths, assesses bundle size impact, and verifies lockfile integrity. |
| **docs-writer** | Technical writer who maintains specs, ADRs, glossary, and process documentation, keeping them in sync with code changes. |
| **implementer** | Focused implementation agent for a single sub-issue. Receives issue context from a parent orchestrator, delivers code and tests, and reports structured results. Does not handle git or board operations. |
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

Agent definitions live in `.agents/agents/hatch3r-{id}.md` with YAML frontmatter:

```yaml
---
id: hatch3r-implementer
description: Focused implementation agent for a single issue.
model: opus
---
```

## Customization

Override agent behavior per-project using `.hatch3r/agents/{id}.customize.yaml`. See [Customization](../guides/customization).
