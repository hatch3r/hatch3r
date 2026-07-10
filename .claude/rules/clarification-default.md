---
id: clarification-default
type: rule
description: "P8 B1 directive: every framework-dev workflow asks all open clarifying questions via the platform-native question tool before executing."
tags: [maintainer, governance, p8]
scope: always
precedence: high
---

# Clarification Default

> Last updated: 2026-07-09

**Pillars:** P8 (Clarification & Fan-out Discipline)

Source: `governance/CONSTITUTION.md` §2 P8.

## B1 directive (verbatim)

> Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

## Triggers

Apply the protocol whenever any of these hold before write-tool invocation:

- Ambiguous scope — the request maps to two or more reasonable interpretations that produce different artifacts.
- Multiple valid interpretations — two or more viable approaches with materially different cost, scope, or risk.
- Irreversible action — deleting an artifact, renaming a public artifact id, dropping a frontmatter field, force-pushing a branch.
- Missing acceptance criteria — no testable definition of done for the requested change.
- Unattested product decision — a user-data-destroying or user-visible-behavior-changing choice (in canonical artifacts: a change to shipped agent/rule behavior end-user repos will inherit) with no maintainer statement authorizing it; an agent-authored comment or PR sentence is self-certification, not authorization.

## How to ask

Use the platform-native question tool per `agents/shared/user-question-protocol.md`. One question per turn; bundle related sub-questions into a single multiple-choice prompt; supply 2–4 numbered options with one-line trade-offs; declare the default-if-no-response option.

## Scope

This rule applies to every framework-dev workflow that mutates canonical artifacts, including:

- `/h4tcher-capability-add`
- `/h4tcher-capability-refactor`
- `/h4tcher-capability-remove`
- `/h4tcher-scoped-audit`
- `/h4tcher-domain-author`
- `/h4tcher-content-author`
- `/h4tcher-adapter-author`
- `/h4tcher-audit-execute`
- `/h4tcher-pr-resolve`

Read-only presets (`/h4tcher-capability-discover`, `/h4tcher-governance-check`) ask only when their report would be meaningless without scope clarification.
