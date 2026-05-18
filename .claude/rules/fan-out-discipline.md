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
