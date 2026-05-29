---
id: hatch3r-fan-out-discipline
type: rule
description: "P8 B2 floor: sub-agent fan-out scales with task size; serialization is valid only on dependency edges; token cost never justifies under-fan-out. Delegating artifacts emit sub-agent count + rationale as a first-class output field."
tags: [orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Fan-out Discipline

**Pillars:** P8 (Clarification & Fan-out Discipline)

Canonical reference for the *mechanics* of parallel dispatch: `rules/hatch3r-agent-orchestration.md` → Parallel Safety. This rule is the corpus-wide, always-on floor that every adapter ships to the end-user repo, so the B2 directive binds runtime agents directly and not only by inheritance through the orchestration rule.

## B2 directive (verbatim)

> Sub-agent fan-out scales with task size; serialization is only valid on dependency edges. Token cost is never a valid reason to serialize independent work. Delegating artifacts emit sub-agent count + rationale as a first-class output field.

## Scaling heuristic

Sub-agent count tracks task decomposition, not a fixed cap:

- N independent modules → N parallel Phase-2 implementers.
- M specialist gates → M parallel Phase-4 specialists.
- K independent research questions → K parallel researcher modes.

When work is independent under the three parallel-safety conditions below, fan out. Only a true dependency edge — where stage B consumes stage A's output — justifies serialization.

## Three parallel-safety conditions

Fan out only when ALL three hold (per `rules/hatch3r-agent-orchestration.md` → Three Conditions to Parallelize):

1. **Read-only or disjoint writes** — no two sub-agents write the same file or region.
2. **Deterministic aggregation** — outputs merge without orchestrator intervention (tests pass-if-all-pass; findings union).
3. **No shared mutable state** — agents that mutate shared state serialize; parallel agents only READ.

A fan-out that fails any condition is serialized or gated by a merge-conflict check — that is the only valid reason to drop below the task-derived count.

## Cost-dominance clause

Token cost of sub-agent invocation never justifies under-fan-out. Cost governs HOW MUCH context each sub-agent receives (the P7 static-first prompt frame); it does not govern WHETHER to spawn the sub-agent at all. P8 dominates P7: when an edit would compress fan-out to save tokens, reject it. When in doubt, fan out.

## Required output field

Delegating artifacts (orchestrator commands, fan-out skills, delegating agents) emit a first-class output field:

```
sub_agents_spawned:
  count: <integer>
  rationale: <one-sentence task-decomposition justification>
```

Omitting the field on a delegating artifact is a P8 B2 violation (D07 fan-out-discipline audit). The `rationale` states the decomposition basis (module count, specialist-gate count, research-question count) so a reviewer can check the count against the task without re-deriving it.

## Static intent vs runtime attestation

The `sub_agents_spawned` frontmatter field declares fan-out intent at config time; it does not prove the orchestrator delegated at run time. The pair is closed by the End-of-Turn Delegation Attestation (`rules/hatch3r-agent-orchestration.md` → End-of-Turn Delegation Attestation): the per-file `delegation_proof_id` returned by the implementer or fixer sub-agent is forgery-resistant, because an orchestrator that skipped delegation has no token to quote. Static frontmatter declares; the runtime block verifies.

## Scope

Binds every hatch3r-invoked workflow that delegates via the Task tool in the end-user repo — every `commands/hatch3r-*.md` with `orchestrator: true`, every delegating `agents/hatch3r-*.md`, and every fan-out `skills/hatch3r-*/SKILL.md`. Tier 1 reference-card skills that neither spawn sub-agents nor mutate files carry no fan-out obligation; they state `Tier 1 reference card — no fan-out` instead.

## References

- `governance/CONSTITUTION.md` §2 P8 B2 (source directive).
- `rules/hatch3r-agent-orchestration.md` → Parallel Safety, Scaling Heuristic, Cost-Dominance Principle, End-of-Turn Delegation Attestation (mechanics this rule references).
- `governance/audit/domains/D07-orchestration.md` (audits the B2 contract per cycle).
- Anthropic, "Multi-agent orchestration" (Managed Agents) — `https://platform.claude.com/docs/en/managed-agents/multi-agent` (accessed 2026-05-26, official-docs): a lead agent decomposes a job and delegates pieces to specialist sub-agents working in parallel over a shared file system, up to ~10 simultaneous.
- Augment Code, "Multi-Agent Orchestration Architecture Guide" — `https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide` (accessed 2026-05-26, independent-analysis): structured context objects pass only relevant fields per worker; graph-based message passing structures communication along declared dependency edges.
