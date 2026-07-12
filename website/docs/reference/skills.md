---
sidebar_position: 2
title: Skills
---

# Skills

On-demand instruction bundles for specific tasks. Skills are loaded by agents when needed and provide step-by-step workflows for common development activities.

## Skill Reference

Skills are grouped below by capability area. Each is invoked inside your coding tool (e.g. `/hatch3r-<id>` in Claude Code) or loaded by an agent when its workflow applies.

### Quality and verification

| Skill | Description |
|-------|-------------|
| **a11y-audit** | WCAG 2.2 AA audit across 7 scan categories (keyboard, contrast, ARIA, reduced motion, screen reader, high contrast, automated axe) with fixes. |
| **enhancability-verify** | Enhancability gate before commit/release -- feature-flag adoption, config externalization, semver-versioned APIs, forward-compat headers, extension points. |
| **maintainability-verify** | Maintainability gate -- jscpd duplication index, pattern-reuse ratio, cyclomatic complexity, expand-contract migrations, API breaking-change discipline. |
| **observability-verify** | Service-done gate -- OTel span coverage on the request path, log + trace-id correlation, SLO definition, error-tracking integration, GenAI semconv. |
| **perf-audit** | Profile and optimize against defined performance budgets with before/after measurements for every change. |
| **qa-validation** | E2E validation workflow producing a structured pass/fail report with evidence and ship/hold recommendations. |
| **reliability-verify** | Service-done gate -- SLO defined, kill switch, timeouts, retries, liveness/readiness probes, runbook, staged rollout. |
| **scalability-verify** | Scalability gate -- stateless-handler ratio, back-pressure, idempotency-key adoption, queue offloading, pool sizing, bulkheads, load-test pass at target scale. |
| **security-verify** | Security gate -- OAuth 2.1 + OIDC + DPoP + WebAuthn server-side, supply-chain floor (SBOM + provenance + SHA-pin + cosign), OWASP ASI01-10 coverage. |
| **testability-verify** | Testability gate -- per-feature test-class map, real-deal-first ratio, coverage thresholds, AI eval coverage, mutation kill-rate, contract + property tests. |
| **ui-ux-verify** | Feature-done gate -- axe-core, scripted keyboard trace, accessibility-tree snapshot, four-state coverage, visual-regression baseline, one screen-reader pass per release. |

### Implementation and refactoring

| Skill | Description |
|-------|-------------|
| **ai-feature** | Eval-driven workflow for shipping AI features -- write the eval before the prompt, measure, iterate, ship with caching + cost telemetry + model fallback. |
| **bug-fix** | Diagnose root cause, implement a minimal fix, and write a regression test that fails before the fix. Test-first workflow option. |
| **containerize** | Containerize an app -- multi-stage Dockerfile, non-root hardening, minimal base image, `.dockerignore`, healthcheck, compose, k8s basics, and an image-scan gate. |
| **feature** | End-to-end feature implementation as a vertical slice covering data model, domain logic, API, and UI. Test-first workflow option. |
| **logical-refactor** | Change business logic or data flows without adding features, with explicit invariant tracking and verification. |
| **migration** | Plan and execute database, framework, and dependency migrations -- breaking-change analysis, phased rollout, and rollback procedures. |
| **refactor** | Internal code quality improvement without changing external behavior, with behavioral-preservation tests. |
| **visual-refactor** | UI/UX change workflow matching design mockups with WCAG AA accessibility and responsiveness verification. |

### Architecture and specs

| Skill | Description |
|-------|-------------|
| **api-spec** | Generate and validate OpenAPI specifications from the codebase -- endpoint design, schema validation, and documentation generation. |
| **architecture-review** | Evaluate architectural decisions, compare options with pros/cons, and produce ADRs following the project template. |
| **design-system-detect** | Detect existing design tokens, component library, and theming convention before authoring new UI primitives; output a concise inventory. |
| **docs-writing** | Author technical documentation -- audience analysis, Diátaxis-mode selection, structure, draft, review, publish. Covers READMEs, ADRs, API docs, runbooks. |

### CI/CD, release, and DevOps

| Skill | Description |
|-------|-------------|
| **ci-pipeline** | Design and optimize CI/CD pipelines -- stage design, test parallelization, artifact management, and pipeline performance. |
| **dep-audit** | Audit npm dependencies for CVEs, freshness, and bundle impact; research migration paths; upgrade one at a time with testing. |
| **gh-agentic-workflows** | Set up CI/CD agentic workflows for continuous AI-powered repository automation (GitHub Actions, Azure Pipelines, GitLab CI). |
| **incident-response** | Structured triage, mitigation, root-cause analysis, and post-mortem for production incidents with follow-up issues. |
| **pr-creation** | Create a pull request or merge request following project conventions -- branch naming, PR/MR template, checklist, and rollout plan. |
| **release** | Cut a release with version bump, changelog, tagging, and deploy verification. |

### Board, workflow, and knowledge

| Skill | Description |
|-------|-------------|
| **board-groom** | Ongoing backlog refinement -- re-prioritize, reclassify, re-scope, archive stale items, decompose oversized issues, merge duplicates, refresh dependencies. |
| **board-init** | Initialize a project board (GitHub Projects V2, Azure Boards, or GitLab Issue Boards) with hatch3r's label taxonomy, status fields, and structure. |
| **board-refresh** | Regenerate the living board-overview dashboard from current board state -- scan open issues, compute health metrics, update the `meta:board-overview` issue. |
| **board-shared** | Shared, platform-agnostic context for all board commands -- board config, label taxonomy, branch conventions, sync enforcement, tooling directives. |
| **feedback** | Capture user feedback on an agent recommendation, classify and sanitize it, and route it to a local record, a GitHub issue, or a learning. |
| **handoff-prepare** | Capture mid-work session state into a canonical handoff document at `.hatch3r/handoffs/active/`. |
| **handoff-resume** | Load and resume a handoff document -- validates schema, integrity, expiry, and `git_ref` drift before surfacing content as user-tier context. |
| **issue-workflow** | 8-step agentic development workflow for issues/work items -- parse, load skill, read specs, plan, implement, test, open PR/MR, address review. |
| **learn** | Capture learnings from completed development sessions into reusable knowledge files for future consultation. |
| **recipe** | Author and validate composition specs that an orchestrating agent walks via the Task tool to run hatch3r commands and skills in a dependency-ordered sequence. |
| **team-convention-author** | Elicit, draft, align, and persist a team's coding conventions and working agreements as a versioned project rule or convention doc. |

### Session, context, and customization

| Skill | Description |
|-------|-------------|
| **adhoc-orchestrate** | Scaffold the ad-hoc Tier ≥ 2 orchestration protocol -- Pipeline-State Header, implementer delegation plan, End-of-Turn Delegation Attestation. |
| **browser-verify** | Opt-in browser verification -- Playwright visual checks, axe-core a11y audits, screenshot regression diffs, and E2E test scaffolds. |
| **context-health** | Monitor and maintain conversation context health during long sessions. |
| **cost-tracking** | Track token usage and estimate costs for agent sessions -- monitor spend, approach budget limits, and generate cost reports. |
| **customize** | Create and manage `.customize.yaml` files for any hatch3r artifact type (agents, commands, rules, skills) -- model, description, scope, enable/disable, and project instructions. |
| **hooks** | Define, edit, and manage event-driven hooks that activate agents on project events. Tool-agnostic -- adapters translate definitions into tool-native config during `hatch3r sync`. |
| **report** | Generate an in-chat session report from the active or named transcript with diagnostics for missed parallelism, redundant work, and over-serialization. |

### CLI tools

| Skill | Description |
|-------|-------------|
| **cli-fd** | User-friendly `find` replacement, gitignore-aware -- locate filenames or directories by glob with parallel walking; invoke `fd`. |
| **cli-fzf** | Interactive fuzzy finder for TTY pickers over piped stdin; invoke `fzf`. Degrades to non-interactive batch in CI. |
| **cli-gh** | GitHub CLI -- repos, issues, PRs, releases, gists, and workflow dispatches; invoke `gh`. |
| **cli-jq** | JSON processor and query language -- shape JSON streams via jq filters and select expressions; invoke `jq`. |
| **cli-ripgrep** | Fast recursive grep with gitignore awareness -- regex content searches across large source trees; invoke `rg`. |
| **cli-toolbox** | Category-indexed reference for 34 specialist CLI tools beyond the always-on five (ripgrep, jq, gh, fd, fzf). |

## Canonical Location

Skills live in the canonical `skills/hatch3r-{id}/SKILL.md` content (bundled npm package; user-tier overrides mirror this layout under `.hatch3r/overrides/skills/`). Each skill is a self-contained instruction document that agents read when performing a specific type of work.

## Customization

Override skill behavior per-project using `.hatch3r/skills/{id}.customize.yaml`. See [Customization](../guides/customization).
