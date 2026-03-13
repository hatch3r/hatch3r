---
sidebar_position: 3
title: What You Get
---

# What You Get

hatch3r ships a comprehensive agentic setup out of the box. During `hatch3r init`, you choose a content profile (Minimal, Standard, Full, or Custom) that determines which items are installed. Here's everything available in the **Full** profile.

| Category | Count | Highlights |
|----------|-------|-----------|
| **Agents** | 16 | Code reviewer, test writer, security auditor, implementer (sub-agentic), fixer, researcher, architect, DevOps, and more |
| **Skills** | 25 | Bug fix, feature implementation, issue workflow, release, incident response, context health, cost tracking, recipes, customization, and more |
| **Rules** | 22 | Code standards, testing, API design, observability, theming, i18n, security patterns, agent orchestration, deep context, and more |
| **Commands** | 34 | Board init, board fill, board groom, board pickup, board refresh, planning (feature, bug, refactor, test), healthcheck, security-audit, context-health, cost-tracking, customization, and more |
| **MCP Servers** | 10 (3 default + 7 opt-in) | Playwright, Context7, Filesystem (default); GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab (opt-in) |

:::tip Content profiles
The **Standard** profile (recommended) includes core, planning, implementation, review, devops, and maintenance content — everything most projects need. The **Minimal** profile installs only `core`-tagged items for a lean setup. Use `hatch3r config` to add or remove items after init.
:::

## Agents

Specialized agents that handle distinct responsibilities in your development workflow.

| Agent | Tags | Description |
|-------|------|-------------|
| **implementer** | `core`, `implementation` | Focused implementation agent for single sub-issues, receives context from orchestrator |
| **reviewer** | `core`, `review` | Senior reviewer -- correctness, security, privacy, performance, accessibility |
| **researcher** | `core`, `planning` | Deep investigation sub-agent used by planning commands |
| **fixer** | `core`, `implementation` | Targeted fixes for reviewer findings in the review loop |
| **test-writer** | `core`, `review` | QA engineer -- unit, integration, E2E, security rules, contract tests |
| **lint-fixer** | `core`, `implementation` | Code quality enforcer -- ESLint, Prettier, TypeScript strict, dead code removal |
| **learnings-loader** | `core`, `maintenance` | Load and apply project learnings from the knowledge base |
| **context-rules** | `core`, `maintenance` | Dynamic context rule generation from project patterns |
| **architect** | `planning` | Architecture design, trade-off analysis, ADR production |
| **docs-writer** | `maintenance` | Technical writer -- specs, ADRs, glossary, process docs |
| **dependency-auditor** | `maintenance`, `security` | Supply chain analyst -- CVE scanning, upgrade paths, lockfile integrity |
| **security-auditor** | `review`, `security` | Security analyst -- DB rules, cloud functions, data flows, privacy |
| **ci-watcher** | `devops` | CI/CD specialist -- monitors GitHub Actions, reads failure logs |
| **devops** | `devops` | CI/CD and deployment operations specialist |
| **a11y-auditor** | `review`, `a11y` | Accessibility specialist -- WCAG AA compliance, ARIA, color contrast |
| **perf-profiler** | `review`, `performance` | Performance engineer -- runtime profiling, bundle size, benchmarks |

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
| **git-conventions** | Branch naming, commit messages, merge strategy |
| **deep-context** | Deep context retrieval and codebase understanding for AI agents |
| **agent-orchestration** | Agent delegation patterns and multi-agent coordination protocols |

...and 15 more. See the full [Rules reference](../reference/rules).

## Commands

Workflows invoked inside your coding tool or via CLI.

| Command | Description |
|---------|-------------|
| **board-init** | Create/connect a GitHub Projects V2 board |
| **board-fill** | Parse `todo.md` into GitHub issues with dependency analysis |
| **board-pickup** | Auto-pick next issue, delegate to sub-agents, create PR |
| **project-spec** | Generate project documentation from a vision |
| **feature-plan** | Plan a single feature with parallel researchers |
| **test-plan** | Plan a comprehensive test strategy with parallel researchers |
| **release** | Cut a versioned release with changelog |

...and 27 more. See the full [Commands reference](../reference/commands/agent-commands).
