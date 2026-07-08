---
id: shared-user-question-protocol
type: reference
description: Protocol for how hatch3r agents and commands ask the user clarifying questions — when to ask, native-tool preference, and a plain-text fallback shape.
tags: [shared, ux, p1, p4]
cache_friendly: true
---

## Purpose

> Last updated: 2026-06-09

This protocol defines how hatch3r agents and commands surface clarifying or triage questions to the user across the 3 supported AI coding tools (Claude Code, Cursor, GitHub Copilot per `governance/CONSTITUTION.md` §6 Decision 12). It is the single source of truth for the *how* of asking; the *whether* is governed by [quality-charter §3 "Question Unclear Requirements"](./quality-charter.md) and §8 "Escalate Ambiguity Early". Coverage is a 100% floor, not a fixed file list: every framework-dev workflow that can mutate canonical artifacts routes its ASK through this protocol — the requirements-elicitation mode (`agents/modes/requirements-elicitation.md`), the shared §0 gate block (`agents/shared/clarification-default-block.md`), and every `agents/hatch3r-*.md` agent and `commands/hatch3r-*.md` command that detects ambiguity (counts: `governance/inventory.json` `counts.agents`, `counts.commands`, `counts.skills`). The "3 supported AI coding tools" figure above is drift-guarded against `inventory.json` `counts.adapters` by `scripts/inventory.ts` (`npm run inventory:check-docs`).

## When To Ask

- **Ambiguous requirement** — the request maps to two or more reasonable interpretations that produce different code.
- **Irreversible decision** — deleting data, renaming a public API, dropping a column, force-pushing a branch.
- **Unattested product decision** — the change deletes or transforms user data, or changes user-visible behavior beyond the issue's acceptance criteria, and no user statement (this session, the issue body, or a linked acceptance criterion) authorizes the choice. An agent-authored code comment, PR description, or reviewer note is not attestation — it is self-certification. Surface the ASK; a sub-agent returns `BLOCKED_AMBIGUITY`; an unattended run records the finding as `escalated` in the findings ledger (`rules/hatch3r-findings-ledger.md`) and exits PARTIAL — fail-closed, mirroring `commands/hatch3r-release.md` → "hold — never auto-publish".
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

**Sub-agent caveat (Claude Code).** The native `AskUserQuestion` tool is a main-agent / orchestrator affordance only. Claude Code filters it out of every Task-tool sub-agent context (foreground and background) regardless of the agent's `tools` declaration, so a spawned `hatch3r-*` sub-agent cannot call it (upstream-confirmed via `anthropics/claude-code` issues #18721, #12890, #34592; verified 2026-06-06 @ https://code.claude.com/docs/en/sub-agents). A sub-agent that hits an ASK trigger therefore does NOT use the native tool: it RETURNS Status `BLOCKED_AMBIGUITY` (`agents/shared/quality-charter.md` §17) with the question rendered via the Plain-Text Fallback Template below, and the orchestrator owns the live ASK (`agents/shared/clarification-default-block.md` → Protocol). This exclusion is re-verified each audit cycle against the date stamp on `src/pipeline/adapterToolTranslator.ts::ASK_USER_TOOLS` (`claude` entry) — a date drift there is a D09 Medium finding.

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

### Optional preview attachment (orchestrator-scoped, platform-conditional)

For questions whose options differ along a **visual or layout dimension** — a color/spacing/typography choice, two candidate component arrangements, a copy-tone A/B, a before/after of an async-view state — a rendered preview alongside the numbered options lets the user decide from the artifact instead of from prose. This is most useful for the UI (CQ1) and UX (CQ2) ASK gates, where "which of these reads better" is the decision.

Attach a preview only when BOTH hold:

- **You are the orchestrator** (main-conversation `commands/hatch3r-*.md`), not a Task-tool sub-agent. Sub-agents cannot call the native question tool at all (see the Sub-agent caveat above); they render the question — and any preview snippet — in the `BLOCKED_AMBIGUITY` structured result, and the orchestrator owns the live ASK.
- **The runtime's native question tool supports rich/rendered option content.** Capability is per-platform; look up your runtime's row in the adapter map (`src/pipeline/adapterToolTranslator.ts::ASK_USER_TOOLS`) before relying on a preview, exactly as you would for the question tool itself. When the platform's native tool is text-only (or absent), embed the preview as a fenced code block inside the Plain-Text Fallback Template instead — never assume a rendering affordance the platform row does not document.

**Concrete affordance (Claude Code orchestrator).** On the `claude` platform, populate the per-option `markdown` field of the `AskUserQuestion` tool: when any option carries a `markdown` value, Claude Code switches to a side-by-side preview layout (numbered options on the left, the rendered markdown on the right), so a diagram, code/diff block, or token-swatch table renders inline with the choice. The field accepts markdown only (no HTML), and long content is truncated to a scrollable panel — keep each option's preview to about one screen of markup. One documented constraint: supplying a `markdown` field suppresses the free-text "Other / Type something" option on that question, so reserve the preview layout for closed-option visual decisions. Other platforms expose no documented preview field (their `ASK_USER_TOOLS` row is `null` — `cursor`, `copilot` as of 2026-06-09); on those, fall back to the fenced-code-block-in-plain-text shape above.

The preview is an enrichment, not a replacement: the numbered options and the mandatory `Default if no response:` line are still required. Keep the preview small (one screen of markup or a single mock) so it does not bury the decision.

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
3. **Log the default-taken decision.** Emit in the Iteration Summary the `Default applied:` exception line (a registered line of the recap contract), one per default: `Default applied: <question summary> → option <N> (<one-line reason>)`. This is the operational counterpart to the prose mandate — every agent / command ASK output that exercises the default MUST log the decision. The `Default applied:` line is a registered exception line of the recap-contract Iteration Summary (`rules/hatch3r-iteration-summary.md` → Exception Lines), and the catching-gate ownership is named in `rules/hatch3r-clarification-default.md` → How to ask — those two files are the enforcing surface for this step.
4. **Never silent-pick.** If no `Default if no response: <option>` line was emitted with the question (an authoring bug per the rules in this file), return `BLOCKED_AMBIGUITY` in the structured result rather than guessing.

The `Default applied:` line is the audit-visible evidence that the default-if-no-response contract was honored; absence of the line when a default was applied is a P8 B1 gate failure. Runtime emission of the `Default applied:` line is orchestrator-produced interpreted markdown, so no static gate can verify it fired — D05 (prompt-engineering) and D13 (human-AI collaboration) audit-cycle spot checks plus the per-run Iteration Summary validation gate are the enforcement, not a compiled check.

The contract has a single named owner so it is not re-declared per command: the always-on, `precedence: high` rule `rules/hatch3r-clarification-default.md` (`scope: always`) binds every `commands/hatch3r-*.md` orchestrator and mutating skill corpus-wide, and that rule's "How to ask" section is the catching gate. An individual command body therefore need not repeat the default-handling vocabulary to be bound by it — the rule + this protocol + the `Default applied:` exception line of the recap-contract Iteration Summary are the three-anchor owner set, and a command inherits the contract by being in scope. Treat a command that *does* restate it as a convenience, not the source of truth.

## Cross-Phase Aggregation

This protocol defines the *shape* of a single question (numbered options, mandatory default). It does not define where pending questions accumulate when several fire across one pipeline run. That cross-phase aggregation layer is the `PipelineContext.pendingUserInputs: PendingUserInput[]` field (`src/pipeline/pipelineContext.ts`, Finding D7-SA7.1-F-10): each phase pushes a `PendingUserInput` — whose `options` + `defaultIfNoResponse` mirror the Plain-Text Fallback Template above — instead of emitting a direct prompt mid-phase. The orchestrator drains the array between phases, paginating when more than three accumulate, so a Tier 3 run's multiple ASK checkpoints are batched rather than each rendered independently. Per-question UX (this file) and cross-phase batching (the field) are complementary: author each request to this template, enqueue it on the field.

## Anti-Patterns

- **Multi-question barrage** — asking five questions in one turn. Ask the highest-leverage one first; the answer often collapses the rest.
- **Options-free questions** — "What should I do?" forces the user to design the prompt. Always supply 2–4 candidate options with trade-offs.
- **Silent assumption** — proceeding when ambiguity is real. Apply quality-charter §8: log the ambiguity in structured output even if you decide to proceed under a default.
- **Echo-as-question** — restating the user's request back as a question ("So you want me to add caching?"). Confirm only when you have a specific decision point with options to offer.
- **Inflated default** — choosing the most disruptive option as the no-response default. Defaults must be the reversible, lowest-blast-radius choice.

## References

The `markdown`-field preview affordance documented in "Optional preview attachment" above is corroborated by:

- `anthropics/claude-code` issue #27348 — names the `markdown` field on `AskUserQuestion` options as the trigger for the preview layout and the "Other / Type something" suppression constraint (accessed 2026-06-09; trust tier: official-vendor issue tracker). https://github.com/anthropics/claude-code/issues/27348
- `anthropics/claude-code` issue #33062 — documents the side-by-side preview panel and its scroll/truncation behavior for long content (accessed 2026-06-09; trust tier: official-vendor issue tracker). https://github.com/anthropics/claude-code/issues/33062

Per-platform tool names and the `null`-means-no-native-tool convention are sourced in `src/pipeline/adapterToolTranslator.ts::ASK_USER_TOOLS` (each entry carries its own `// verified <date> @ <docs URL>` stamp, refreshed on the D09 per-cycle web-research pass).
