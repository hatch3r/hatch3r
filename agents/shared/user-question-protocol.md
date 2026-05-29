---
id: shared-user-question-protocol
type: reference
description: Protocol for how hatch3r agents and commands ask the user clarifying questions — when to ask, native-tool preference, and a plain-text fallback shape.
tags: [shared, ux, p1, p4]
cache_friendly: true
---

> Last updated: 2026-05-26

## Purpose

This protocol defines how hatch3r agents and commands surface clarifying or triage questions to the user across the 15 supported AI coding platforms. It is the single source of truth for the *how* of asking; the *whether* is governed by [quality-charter §3 "Question Unclear Requirements"](./quality-charter.md) and §8 "Escalate Ambiguity Early". Files that reference this protocol: the requirements-elicitation mode (`agents/modes/requirements-elicitation.md`), the five ASK-checkpoint commands, and the four ask-prone agents — researcher, fixer, architect, implementer.

## When To Ask

- **Ambiguous requirement** — the request maps to two or more reasonable interpretations that produce different code.
- **Irreversible decision** — deleting data, renaming a public API, dropping a column, force-pushing a branch.
- **Branching path** — two or more viable approaches with materially different cost, scope, or risk.
- **Conflicting constraints** — requirements that cannot all hold (e.g., "no new dependencies" and "use library X").
- **Missing acceptance criteria** — no testable definition of done for the requested change.
- **Architectural premise concern** — request is well-specified and single-interpretation, but the chosen approach is architecturally misguided (wrong pattern for the constraint, mis-applied abstraction, foreseeable scaling failure). Surface the concern as a §0.5 Challenge the Premise question per quality-charter §3 — phrase it constructively ("Before I implement this, I want to confirm the approach because [specific concern]"), then offer 2-4 options (proceed as requested / proposed alternative / hybrid). Default-if-no-response: proceed as requested (lowest-blast-radius assumption is that the user has context the agent lacks).

## When NOT To Ask

- The user already decided scope in this turn or an earlier turn of the same session.
- You are in free-text discussion, planning, or a status update — questions belong inside actionable workflows.
- The answer is verifiable by reading code, running a test, or grepping the repo — verify first, ask only if verification fails.
- The choice is reversible, low-stakes, and the safer default is obvious — pick the default and note it.

## How To Ask

1. Check whether your target platform exposes a native question or triage tool (see Platform-Native Tool below).
2. If yes, use the native tool — it produces better UX than free-text replies and is structured for the host runtime.
3. If no native tool exists on this platform, use the Plain-Text Fallback Template.
4. Ask at most one question per turn. Bundle related sub-questions into a single multiple-choice prompt rather than firing multiple turns.

## Platform-Native Tool

The marker below is replaced at canonical-write time with the enumeration table generated from `src/pipeline/adapterToolTranslator.ts::ASK_USER_TOOLS`. Look up your runtime platform and follow its row. If your platform's row reads "No documented native tool", use the Plain-Text Fallback Template defined in the next section.

<!-- HATCH3R:PLATFORM-TOOL -->

When viewing this file in the source repo (pre-generation), the marker is unsubstituted — refer to the adapter map in `src/pipeline/adapterToolTranslator.ts` for the same mappings.

## Plain-Text Fallback Template

Use this exact shape when no native tool is available:

```
**Question:** <one-sentence question stating the choice>

1. <Option A> — <one-line rationale or trade-off>
2. <Option B> — <one-line rationale or trade-off>
3. <Option C> — <one-line rationale or trade-off>

Default if no response: <option number, e.g., 2>
```

Rules for the template:

- Two to four numbered options. One option is too few; five or more signals you have not narrowed the design.
- Each option carries a one-line trade-off so the user can pick without re-deriving the problem.
- The default-if-no-response line is mandatory — it removes the deadlock when the user is away or replies "you decide".
- The default option is the safest reversible choice, not the most ambitious one.

## Examples

**Example 1 — Ambiguous requirement.** Request: "Add caching to the user profile endpoint."

```
**Question:** Which cache scope matches your needs for the profile endpoint?

1. Per-user, 60s TTL — fastest response, stale data tolerated up to 60s.
2. Per-user, write-through invalidation — fresh data, +1 cache write per profile update.
3. Edge cache only — no app changes, but TTL is fixed by the CDN config.

Default if no response: 2
```

**Example 2 — Branching path.** Request: "Migrate the build to Vite."

```
**Question:** Should the Vite migration land in one PR or staged behind a feature flag?

1. Single PR — shorter total time, larger blast radius if a regression ships.
2. Staged with VITE_BUILD flag — two PRs, lets you A/B locally before flipping.

Default if no response: 2
```

## Operationalising Default-if-no-Response

The "Default if no response" line is mandatory in every plain-text fallback question (per the rules above) and is the canonical deadlock-breaker for every ASK gate across the framework. To operationalise the default at runtime rather than leaving it as documented prose:

1. **Detect non-response.** If a question goes unanswered within the host runtime's question window (Claude Code: idle session timeout; Cursor: AskUserQuestion timeout; Copilot Workspace: prompt-cycle gap), or if the user replies "you decide" / "default" / empty, treat as non-response.
2. **Apply the safe default.** Pick the option declared on the `Default if no response: <option number>` line — the lowest-blast-radius reversible choice the question's author named.
3. **Log the default-taken decision.** Emit in the Iteration Summary §8 (Open Questions / Blockers) a single line: `Default applied: <question summary> → option <N> (<one-line reason>)`. This is the operational counterpart to the prose mandate — every agent / command ASK output that exercises the default MUST log the decision.
4. **Never silent-pick.** If no `Default if no response: <option>` line was emitted with the question (an authoring bug per the rules in this file), return `BLOCKED_AMBIGUITY` in the structured result rather than guessing.

The §8 log is the audit-visible evidence that the default-if-no-response contract was honored; absence of the log when a default was applied is a P8 B1 gate failure.

## Cross-Phase Aggregation

This protocol defines the *shape* of a single question (numbered options, mandatory default). It does not define where pending questions accumulate when several fire across one pipeline run. That cross-phase aggregation layer is the `PipelineContext.pendingUserInputs: PendingUserInput[]` field (`src/pipeline/pipelineContext.ts`, Finding D7-SA7.1-F-10): each phase pushes a `PendingUserInput` — whose `options` + `defaultIfNoResponse` mirror the Plain-Text Fallback Template above — instead of emitting a direct prompt mid-phase. The orchestrator drains the array between phases, paginating when more than three accumulate, so a Tier 3 run's multiple ASK checkpoints are batched rather than each rendered independently. Per-question UX (this file) and cross-phase batching (the field) are complementary: author each request to this template, enqueue it on the field.

## Anti-Patterns

- **Multi-question barrage** — asking five questions in one turn. Ask the highest-leverage one first; the answer often collapses the rest.
- **Options-free questions** — "What should I do?" forces the user to design the prompt. Always supply 2–4 candidate options with trade-offs.
- **Silent assumption** — proceeding when ambiguity is real. Apply quality-charter §8: log the ambiguity in structured output even if you decide to proceed under a default.
- **Echo-as-question** — restating the user's request back as a question ("So you want me to add caching?"). Confirm only when you have a specific decision point with options to offer.
- **Inflated default** — choosing the most disruptive option as the no-response default. Defaults must be the reversible, lowest-blast-radius choice.
