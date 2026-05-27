---
id: hatch3r-clarification-default
type: rule
description: "P8 B1 floor: every hatch3r-invoked agentic workflow detects and resolves ambiguity via the platform-native question tool BEFORE executing — default behavior, not exception-driven. Names the 4-trigger set and mandates a §0 ambiguity gate on every mutating agent, command, and skill."
tags: [orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Clarification Default

**Pillars:** P8 (Clarification & Fan-out Discipline)

Canonical reference for the *how* of asking: `agents/shared/user-question-protocol.md`. This rule governs the *whether* — it is the corpus-wide, always-on floor that every adapter ships to the end-user repo, so B1 enforcement does not depend on per-artifact body inheritance alone.

## B1 directive (verbatim)

> Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

Default-path, not exception: a workflow that proceeds without resolving a live trigger below has violated B1, even if it later succeeds. Asking is the baseline; silent assumption is the deviation that must be justified.

## Four-trigger set

Apply the protocol before any write-tool invocation when ANY of these hold:

1. **Ambiguous scope** — the request maps to two or more reasonable interpretations that produce different artifacts.
2. **Multiple valid interpretations** — two or more viable approaches with materially different cost, scope, or risk.
3. **Irreversible action** — deleting an artifact, renaming a public artifact id, dropping a frontmatter field, force-pushing a branch.
4. **Missing acceptance criteria** — no testable definition of done for the requested change.

If none of the four hold and the safer default is obvious and reversible, proceed and note the default — do not manufacture a question (anti-pattern per `agents/shared/user-question-protocol.md` "Echo-as-question").

## §0 ambiguity gate (every mutating artifact)

Every artifact under `agents/`, `commands/`, and `skills/` that can mutate files MUST carry a §0 (or "Step 0 — Ambiguity gate") block as its first procedural step. The block:

- scans the request against the four-trigger set above before any write;
- on a live trigger, asks via the platform-native question tool per `agents/shared/user-question-protocol.md` and awaits the answer before proceeding;
- declares the default-if-no-response option so the workflow never deadlocks.

A mutating artifact with no §0 ambiguity gate, or one whose gate does not reference `agents/shared/user-question-protocol.md`, is a P8 B1 finding (D05 prompt-engineering audit, D13 human-AI collaboration audit).

## How to ask

Use the platform-native question tool per `agents/shared/user-question-protocol.md`. One question per turn; bundle related sub-questions into a single multiple-choice prompt; supply 2–4 numbered options with one-line trade-offs; declare the default-if-no-response option. When no native tool exists on the runtime platform, use the Plain-Text Fallback Template from the same protocol.

## Scope

Binds every hatch3r-invoked workflow that mutates artifacts in the end-user repo — every `agents/hatch3r-*.md`, every `commands/hatch3r-*.md` with `orchestrator: true`, and every mutating `skills/hatch3r-*/SKILL.md`. Read-only or report-only workflows ask only when the report would be meaningless without scope clarification.

## References

- `governance/CONSTITUTION.md` §2 P8 B1 (source directive).
- `agents/shared/user-question-protocol.md` (how to ask: triggers, native-tool preference, fallback template, anti-patterns).
- `agents/shared/quality-charter.md` §3 "Question Unclear Requirements", §8 "Escalate Ambiguity Early".
- `governance/audit/domains/D05-prompt-engineering.md`, `governance/audit/domains/D13-human-ai-collaboration.md` (audit the §0 gate per cycle).
