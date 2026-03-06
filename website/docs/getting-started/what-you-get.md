---
sidebar_position: 3
title: What You Get
---

# What You Get

hatch3r ships a comprehensive agentic setup out of the box. Here's everything included.

| Category | Count | Highlights |
|----------|-------|-----------|
| **Agents** | 15 | Code reviewer, test writer, security auditor, implementer (sub-agentic), researcher, and more |
| **Skills** | 25 | Bug fix, feature implementation, issue workflow, release, incident response, context health, cost tracking, recipes, customization, and more |
| **Rules** | 43 | Code standards, error handling, testing, API design, observability, theming, i18n, security patterns, agent orchestration, and more |
| **Commands** | 29 | Board init, board fill, board pickup, board refresh, planning (feature, bug, refactor), healthcheck, security-audit, context-health, cost-tracking, customization, and more |
| **MCP Servers** | 5 | GitHub, Context7, Filesystem, Playwright, Brave Search |

## Agents

Specialized agents that handle distinct responsibilities in your development workflow.

| Agent | Description |
|-------|-------------|
| **a11y-auditor** | Accessibility specialist -- WCAG AA compliance, keyboard nav, color contrast, ARIA, reduced motion |
| **ci-watcher** | CI/CD specialist -- monitors GitHub Actions, reads failure logs, suggests fixes |
| **dependency-auditor** | Supply chain analyst -- CVE scanning, upgrade paths, bundle impact, lockfile integrity |
| **docs-writer** | Technical writer -- specs, ADRs, glossary, process docs, kept in sync with code |
| **implementer** | Focused implementation agent for single sub-issues, receives context from orchestrator |
| **lint-fixer** | Code quality enforcer -- ESLint, Prettier, TypeScript strict, dead code removal |
| **perf-profiler** | Performance engineer -- runtime profiling, bundle size, memory leaks, benchmarks |
| **researcher** | Deep investigation sub-agent used by planning commands |
| **reviewer** | Senior reviewer -- correctness, security, privacy, performance, accessibility |
| **security-auditor** | Security analyst -- DB rules, cloud functions, data flows, privacy, entitlements |
| **test-writer** | QA engineer -- unit, integration, E2E, security rules, contract tests |

See the full [Agents reference](../reference/agents).

## Skills

On-demand instruction bundles for specific tasks. Skills are loaded when agents need them.

| Skill | Description |
|-------|-------------|
| **feature** | End-to-end feature implementation as a vertical slice |
| **bug-fix** | Root cause diagnosis, minimal fix, regression test |
| **refactor** | Internal quality improvement without behavior change |
| **release** | Semantic versioning, changelog, tagging, deploy verification |
| **issue-workflow** | 8-step GitHub issue workflow with sub-agent delegation |
| **pr-creation** | PR conventions, branch naming, self-review checklist |
| **incident-response** | Triage, mitigation, root cause analysis, post-mortem |

...and 18 more. See the full [Skills reference](../reference/skills).

## Rules

Persistent coding standards and conventions always available to agents.

| Rule | Description |
|------|-------------|
| **code-standards** | TypeScript strict, naming conventions, function/file limits |
| **testing** | Deterministic, isolated, fast tests with clear naming |
| **api-design** | Versioning, validation, error responses, auth, CORS, pagination |
| **security-patterns** | Input validation, output encoding, auth, OWASP alignment |
| **error-handling** | Structured errors, typed codes, exponential backoff, correlation IDs |
| **git-conventions** | Branch naming, commit messages, merge strategy |

...and 37 more. See the full [Rules reference](../reference/rules).

## Commands

Workflows invoked inside your coding tool or via CLI.

| Command | Description |
|---------|-------------|
| **board-init** | Create/connect a GitHub Projects V2 board |
| **board-fill** | Parse `todo.md` into GitHub issues with dependency analysis |
| **board-pickup** | Auto-pick next issue, delegate to sub-agents, create PR |
| **project-spec** | Generate project documentation from a vision |
| **feature-plan** | Plan a single feature with parallel researchers |
| **release** | Cut a versioned release with changelog |

...and 23 more. See the full [Commands reference](../reference/commands/agent-commands).
