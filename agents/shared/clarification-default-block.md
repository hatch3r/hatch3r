---
id: shared-clarification-default-block
type: reference
description: Canonical §0 Detect Ambiguity block referenced by every hatch3r-* agent. Lifted from per-agent duplication per D6-M3 (Cycle 9 / Wave 3) to enforce the B1 directive in one place.
tags: [shared, p8, floor:protocol]
cache_friendly: true
---

## §0 Detect Ambiguity (P8 B1)

> Last updated: 2026-06-09

This is the canonical body of the §0 Detect Ambiguity block referenced by every `agents/hatch3r-*.md`. Each agent's body cites this file via a one-line pointer plus a one-line domain-specific trigger list. The shared protocol is the constant; the trigger list is the variable.

### Protocol (constant across all agents)

Before any action, scan the brief against the five-trigger set in `rules/hatch3r-clarification-default.md` (ambiguous scope, multiple valid interpretations, irreversible action, missing acceptance criteria, unattested product decision). If any trigger is live, surface the question per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-file, single-concern, and the brief alone is testable. The Boundaries "Ask first" rule remains in force for residual ambiguity discovered mid-execution. When an ASK goes unanswered, the gate never deadlocks: apply the declared `Default if no response:` option and log it (orchestrator path) OR, if no default line was emitted, return Status `BLOCKED_AMBIGUITY` (sub-agent path) — never silent-pick, per `agents/shared/user-question-protocol.md` → Operationalising Default-if-no-Response.

How you surface the question depends on your execution context — these agents run as Task-tool sub-agents, not in the main conversation:

- **Sub-agent (this file's consumers, spawned via the Task tool).** Do NOT attempt to call the platform-native question tool. On Claude Code the `AskUserQuestion` tool is filtered out of every sub-agent context (foreground and background) regardless of the agent's `tools` declaration — see `src/pipeline/adapterToolTranslator.ts::ASK_USER_TOOLS` (`claude` entry) for the upstream-confirmed exclusion. Instead RETURN the canonical Status `BLOCKED_AMBIGUITY` (`agents/shared/quality-charter.md` §17) with the question rendered in the structured result using the Plain-Text Fallback Template from `agents/shared/user-question-protocol.md` (numbered options + mandatory `Default if no response:` line). The orchestrator owns the live ASK — it reads the `BLOCKED_AMBIGUITY` status and routes the rendered question to the user (`quality-charter.md` §17 → "orchestrator routes to ASK checkpoint").
- **Orchestrator command (`commands/hatch3r-*.md`, running in the main conversation).** Invoke the platform-native question tool directly per `agents/shared/user-question-protocol.md`; the native ASK path is available only here.

CONSTITUTION §2 P8 establishes the B1 directive verbatim:

> Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

### Domain-specific trigger lists (variable per agent)

Each consuming agent enumerates its own ambiguity triggers in a single line at the citation site (for example, `hatch3r-implementer` names "contradictory criteria, missing API contract, unknown convention"). The inline trigger line in each `agents/hatch3r-*.md` is the single source of truth for that agent's triggers — this shared file deliberately keeps no parallel per-agent table (D5-23, Cycle 11 Wave 3): a shadow table drifted from 7+ agents' inline lines because nothing kept the two copies in sync, so the duplicate copy was deleted at root cause. To read an agent's triggers, read that agent's `§0` citation line, not this file.

### Authoring rules

1. Citing this file with the canonical pointer (`See agents/shared/clarification-default-block.md → §0 Detect Ambiguity (P8 B1)`) plus the agent's own one-line trigger list satisfies the B1 directive. Re-wording the protocol body inline is forbidden — duplication is the failure mode this file exists to eliminate.
2. The 9 CQ specialists continue to incorporate the protocol via `agents/shared/quality-specialist-frame.md` (which references this file transitively); they do not need a separate direct pointer. Like this file, that frame names two example triggers and declares the per-specialist list the variable — it keeps no parallel table either.
3. When a new agent is added, give it an inline trigger line at its `§0` citation site; do not register the line anywhere else. The CI gate `npm run validate` parses for the pointer phrase; a missing pointer in an agent body is a P8 B1 violation. The regression guard `src/__tests__/cli/validate.test.ts` ("no per-agent trigger table") asserts this file stays table-free so the drift cannot reappear.

### Related references

- `agents/shared/user-question-protocol.md` — how to ask (native tool table + plain-text fallback)
- `agents/shared/quality-charter.md` §3 — when to ask (Question Unclear Requirements)
- `agents/shared/quality-charter.md` §8 — escalate ambiguity early
- `rules/hatch3r-clarification-default.md` — repo-level mirror of the B1 directive
- `.claude/rules/clarification-default.md` — framework-dev mirror loaded each Claude Code session
