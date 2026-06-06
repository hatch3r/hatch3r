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

The count derived above sets WHETHER to spawn each sub-agent. Past roughly 8 concurrent sub-agents, the count also sets the SHAPE: a single orchestrator that integrates 11–15 concurrent results in one context becomes the reviewability bottleneck. At that width, keep the full task-derived count but split it across a two-level tree (see Hierarchical delegation) rather than collapsing it to a narrower flat fan-out — collapsing the count to ease integration is the P8 violation the cost-dominance clause already forbids.

## Hierarchical delegation

The flat model — one orchestrator fans out to N workers and integrates all N results itself — is the default and is correct up to roughly 8 concurrent sub-agents (the empirical lead-agent ceiling cited in References, and the `max_phase4_parallel` default in `rules/hatch3r-agent-orchestration.md`). Beyond that width, prefer a two-level tree over a flat 11–15-wide fan-out:

- The root orchestrator decomposes the task into ≤8 disjoint groups and spawns one sub-orchestrator per group.
- Each sub-orchestrator fans out to its group's workers, integrates that group's results, and returns a single group-level summary.
- The root integrates ≤8 group summaries — not 11–15 raw worker results — so per-context integration load stays inside the reviewability ceiling at every level.

This preserves the task-derived total fan-out (no work is serialized): the same N workers still run concurrently, redistributed across sub-orchestrators. The grouping boundary MUST honor the three parallel-safety conditions both within a group and across groups, so a two-level tree carries no extra merge risk over the equivalent flat fan-out. High-fan-out commands are the trigger case — `commands/hatch3r-workflow.md` (`count: 15`) and the batch-mode `commands/hatch3r-board-fill.md` / `commands/hatch3r-board-pickup.md` (`count: 11` × issue count) otherwise concentrate every result on one orchestrator context.

Cost-dominance and reviewability govern different axes and never trade against each other: cost-dominance governs WHETHER to spawn a sub-agent (always spawn when work is independent; token cost never serializes it), reviewability governs the SHAPE of the resulting tree (flat ≤8, two-level beyond). Neither axis ever justifies dropping the task-derived count.

## Three parallel-safety conditions

Fan out only when ALL three hold (per `rules/hatch3r-agent-orchestration.md` → Three Conditions to Parallelize):

1. **Read-only or disjoint writes** — no two sub-agents write the same file or region.
2. **Deterministic aggregation** — outputs merge without orchestrator intervention (tests pass-if-all-pass; findings union).
3. **No shared mutable state** — agents that mutate shared state serialize; parallel agents only READ.

A fan-out that fails any condition is serialized or gated by a merge-conflict check — that is the only valid reason to drop below the task-derived count.

## Cost-dominance clause

Token cost of sub-agent invocation never justifies under-fan-out. Cost governs HOW MUCH context each sub-agent receives (the P7 static-first prompt frame); it does not govern WHETHER to spawn the sub-agent at all. P8 dominates P7: when an edit would compress fan-out to save tokens, reject it. When in doubt, fan out. Reviewability is a separate, non-cost axis: it governs the SHAPE of the fan-out tree (flat vs two-level per Hierarchical delegation), never WHETHER to spawn — so reviewability never serializes independent work either.

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

How each class emits the field differs because the count is known at a different time:

- **Commands** declare it as a static frontmatter key — a command's fan-out is fixed by its `agentPipeline`, so `sub_agents_spawned: {count, rationale}` is a config-time value. `scripts/validate-fanout-emission.ts` enforces the key on every `orchestrator: true` command (CI gate `npm run validate:efficiency`).
- **Skills** carry the runtime-emission directive in the body — a skill's count is task-derived (Tier 1 inline / Tier 2 per-concern / Tier 3 per-module), so a static integer would misstate it. A skill whose body holds a Tier-2/3 Task-tool delegation contract MUST state `` Emit `sub_agents_spawned: { count, rationale }` in your output. ``; the same validator flags `P8-FANOUT-SKILL-MISS` on a delegating, non-exempt skill that omits it.
- **Agents** are prose-bound: their delegation is inherited from `rules/hatch3r-agent-orchestration.md` and they carry no `orchestrator` frontmatter marker, so no separate validator trigger applies; the worker agents that mention the Task tool delegate on behalf of a parent orchestrator, not as a fan-out root.

## References

- Pillar P8 B2 (source directive; see `agents/shared/principles.md`).
- `rules/hatch3r-agent-orchestration.md` → Parallel Safety, Scaling Heuristic, Cost-Dominance Principle, End-of-Turn Delegation Attestation (mechanics this rule references).
- The orchestration audit domain audits the B2 contract per cycle.
- Anthropic, "Multi-agent orchestration" (Managed Agents) — `https://platform.claude.com/docs/en/managed-agents/multi-agent` (accessed 2026-05-26, official-docs): a lead agent decomposes a job and delegates pieces to specialist sub-agents working in parallel over a shared file system, up to ~10 simultaneous — the lead-agent ceiling that anchors the ~8 flat-vs-hierarchical threshold above; beyond it a lead agent itself acts as a sub-orchestrator over its own workers.
- Augment Code, "Multi-Agent Orchestration Architecture Guide" — `https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide` (accessed 2026-05-26, independent-analysis): structured context objects pass only relevant fields per worker; graph-based message passing structures communication along declared dependency edges.
