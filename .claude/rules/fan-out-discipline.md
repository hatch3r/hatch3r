---
id: fan-out-discipline
type: rule
description: "P8 B2 directive: sub-agent fan-out scales with task size; never serialize independent work to save cost."
tags: [maintainer, governance, p8]
scope: always
precedence: high
---

# Fan-out Discipline

**Pillars:** P8 (Clarification & Fan-out Discipline)

Source: `governance/CONSTITUTION.md` §2 P8.

## Canonical surface

This rule lives under `.claude/rules/` — framework-dev only; adapters do not ship it to end-user repos (they read from canonical `rules/` via `src/adapters/canonical.ts::readCanonicalFiles`). The end-user runtime surface ships the dedicated canonical twin `rules/hatch3r-fan-out-discipline.md` (+ `.mdc`, `scope: always`, `precedence: high`) — authored under D7-SA7.6-L-1 / C-1 — so runtime agents that delegate via the Task tool receive the identical P8 B2 directive directly, and not only by inheritance from `rules/hatch3r-agent-orchestration.md` → §Scaling Heuristic + §Cost-Dominance Principle. Keep this framework-dev rule and the canonical twin aligned on the B2 directive text when either changes.

## B2 directive (verbatim)

> Sub-agent fan-out scales with task size; serialization is only valid on dependency edges. Token cost is never a valid reason to serialize independent work. Delegating artifacts emit sub-agent count + rationale as a first-class output field.

## Scaling heuristic

Sub-agent count tracks task decomposition:

- N independent modules → N parallel Phase-2 implementers.
- M specialist gates → M parallel Phase-4 specialists.
- K independent research questions → K parallel researcher modes.

When work is independent under the three parallel-safety conditions (read-only or disjoint writes, deterministic aggregation, no shared mutable state per `rules/hatch3r-agent-orchestration.md`), fan out. Only true dependency edges justify serialization.

## Cost-dominance clause

Token cost of sub-agent invocation never justifies under-fan-out. Cost governs HOW MUCH context each sub-agent receives (P7 static-first prompt frame); it does not govern WHETHER to spawn the sub-agent at all. When in doubt, fan out.

## Required output field

Delegating artifacts (orchestrator commands, lifecycle presets, fan-out skills) emit a first-class output field:

```
sub_agents_spawned:
  count: <integer>
  rationale: <one-sentence task-decomposition justification>
```

Omitting the field on a delegating artifact is a P8 violation.

## End-of-Turn Delegation Attestation

The static `sub_agents_spawned` frontmatter field declares fan-out intent at config time. It does not verify that the orchestrator actually delegated at run time. Close the gap with a per-turn closing block:

When an assistant turn in this repo causes any file mutation AND is operating as an orchestrator-style flow (registered `/h4tcher-*` command OR ad-hoc multi-phase task at Tier >= 2), the orchestrator MUST emit an End-of-Turn Delegation Attestation immediately before the Iteration Summary. Format and rules per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation.

Why it is forgery-resistant: the per-file `delegation_proof_id` is returned by `hatch3r-implementer` or `hatch3r-fixer` in their structured results (`agents/hatch3r-implementer.md` -> Return Structured Result; `agents/hatch3r-fixer.md` -> Return Structured Result). The orchestrator quotes it verbatim. An orchestrator that skipped delegation has no `delegation_proof_id` to quote — its row is unattributable, which is a self-declared P8 B2 violation per the block's rules. Both Phase 2 (implementer) and Phase 3 (fixer) code-mutating agents emit the field; either one's token is valid attribution for files mutated by that agent.

This rule is loaded automatically each Claude Code session in this repo (via `.claude/rules/`), so it binds ad-hoc sessions as well as registered commands — closing the loophole where a multi-phase task without a registered `/h4tcher-*` command could otherwise escape the orchestration protocol (the CHANGELOG #73 failure mode).
