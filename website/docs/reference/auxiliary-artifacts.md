---
sidebar_position: 6
title: Auxiliary Artifacts
---

# Auxiliary Artifacts

Two smaller artifact families complement the main set (agents, skills, rules, hooks, commands). Checks supply pass/fail criteria that agents load during review. GitHub Agents are simplified agent definitions tailored for GitHub Copilot. A third class, Prompts, ships no canonical content today — it is reserved for distributed packs (see below).

Each family is small enough to share one reference page. Use the tables below to locate an entry, then open the canonical file under the listed path.

## Checks

Review criteria definitions that agents (primarily `hatch3r-reviewer`) load to evaluate diffs against pass/fail criteria. Each check focuses on one concern and tags criteria as `[CRITICAL]` (blocking) or `[RECOMMENDED]` (advisory).

| Check | Purpose | Invoked by |
|-------|---------|------------|
| **accessibility** | WCAG 2.1 AA criteria across semantic HTML, ARIA, keyboard navigation, contrast, screen reader support, and media. | Reviewer agents on UI/template diffs |
| **code-quality** | Standards compliance, complexity limits (50-line functions, 400-line files, cyclomatic <=10), maintainability, and error handling. | Reviewer agents on any source diff |
| **performance** | Bundle size, render path (LCP/CLS), memory cleanup, network/DB query patterns, runtime hot paths, and code splitting. | Reviewer agents on perf-sensitive diffs |
| **security** | Input validation, authn/authz, secrets handling, dependency safety, data exposure, cryptography, and error responses. | Reviewer agents on security-sensitive diffs |
| **testing** | Coverage requirements, determinism, isolation, integration tests, and regression-prevention rules. | Reviewer agents on any diff with code changes |

**Canonical location:** `checks/{id}.md` in the bundled npm package. Authoring guide: `checks/README.md` in the framework repo.

## Prompts

Standalone prompt templates that produce a structured output without agent state — suitable for one-shot invocations from any tool that accepts a prompt (Claude Code, Cursor chat, Copilot Chat, or a CLI/API call).

The canonical hatch3r corpus ships **no prompt artifacts**. The class is reserved for distributed content packs, which may supply prompts under the pack trust model (see [`governance/pack-trust-model.md`](https://github.com/hatch3r/hatch3r/blob/main/governance/pack-trust-model.md)). When a pack ships a prompt, its canonical location is `prompts/{id}.md` in the pack content root.

## GitHub Agents

Simplified agent definitions designed for GitHub Copilot, which does not load the full hatch3r agent runtime. They omit pipeline integration and constrain themselves to a single role with explicit boundaries.

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| **hatch3r-docs-agent** | Technical writer that reads source and updates specs, ADRs, and process docs under `docs/` while preserving stable IDs. | Copilot when assigned a documentation task |
| **hatch3r-lint-agent** | Code-quality engineer that fixes ESLint, Prettier, TypeScript strict-mode, and naming issues without changing logic; verifies via lint then typecheck then test. | Copilot on a lint-fix or formatting task |
| **hatch3r-security-agent** | Security analyst that audits database rules, API endpoints, and data flows; writes rules tests for both allow and deny cases. | Copilot on a security audit or rules-test task |
| **hatch3r-test-agent** | QA engineer that writes deterministic unit, integration, and E2E tests with explicit edge cases and regression coverage. | Copilot on a test-authoring task |

**Canonical location:** `github-agents/{id}.md` in the bundled npm package. Each agent declares its file-structure assumptions, allowed commands, and "Always / Ask first / Never" boundary list.

## Customization

Customization for these families follows the same pattern as the main artifacts: override behavior per-project via `.hatch3r/checks/{id}.customize.yaml`, `.hatch3r/prompts/{id}.customize.yaml`, or `.hatch3r/github-agents/{id}.customize.yaml`. See [Customization](../guides/customization).
