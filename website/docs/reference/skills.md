---
sidebar_position: 2
title: Skills
---

# Skills

On-demand instruction bundles for specific tasks. Skills are loaded by agents when needed and provide step-by-step workflows for common development activities.

## Skill Reference

| Skill | Description |
|-------|-------------|
| **a11y-audit** | Comprehensive WCAG AA audit with automated scanning, manual verification, and fix implementation. |
| **agent-customize** | Configure per-agent customization via `.customize.yaml` files. |
| **architecture-review** | Evaluate architectural decisions, compare options with pros/cons, and produce ADRs following the project template. |
| **bug-fix** | Diagnose root cause, implement minimal fix, and write a regression test that fails before the fix. TDD/test-first workflow option. |
| **command-customize** | Configure per-command customization via `.customize.yaml` files. |
| **context-health** | Monitor conversation context health and detect degradation during long sessions. |
| **cost-tracking** | Track token usage and estimated costs across agent workflows. |
| **dep-audit** | Audit npm dependencies for CVEs and freshness, research migration paths, upgrade one at a time with testing. |
| **feature** | End-to-end feature implementation as a vertical slice covering data model, domain logic, API, and UI. TDD/test-first workflow option. |
| **gh-agentic-workflows** | Set up GitHub Agentic Workflows for continuous AI-powered triage, testing, and documentation automation. |
| **incident-response** | Structured triage, mitigation, root cause analysis, and post-mortem for production incidents with follow-up issues. |
| **issue-workflow** | 8-step development workflow for GitHub issues: parse, load skill, read specs, plan, implement, test, PR, address review. |
| **logical-refactor** | Change business logic or data flows without adding features, with explicit invariant tracking and verification. |
| **perf-audit** | Profile and optimize against defined performance budgets with before/after measurements for every change. |
| **pr-creation** | Create pull requests following project conventions -- branch naming, PR template, self-review checklist, and size guidelines. |
| **qa-validation** | E2E validation workflow producing structured pass/fail reports with evidence and ship/hold recommendations. |
| **recipe** | Create and manage composable workflow recipes. |
| **refactor** | Internal code quality improvement without changing external behavior, with behavioral preservation tests. |
| **release** | Cut a release with semantic versioning, changelog generation, pre-release/RC support, git tagging, and deploy verification. |
| **rule-customize** | Configure per-rule customization via `.customize.yaml` files. |
| **skill-customize** | Configure per-skill customization via `.customize.yaml` files. |
| **visual-refactor** | UI/UX changes matching design mockups with WCAG AA accessibility and responsiveness verification. |

## Canonical Location

Skills live in `.agents/skills/hatch3r-{id}/SKILL.md`. Each skill is a self-contained instruction document that agents read when performing a specific type of work.

## Customization

Override skill behavior per-project using `.hatch3r/skills/{id}.customize.yaml`. See [Customization](../guides/customization).
