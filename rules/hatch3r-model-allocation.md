---
id: hatch3r-model-allocation
type: rule
description: "Model-class allocation per sub-agent spawn — the economy | default | strongest vocabulary, static per-agent class floors, the max(agent floor, effective-tier class) allocation matrix, an explicit per-spawn model pass, and floor pinning for verdict-class specialists."
tags: [orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Model Allocation

**Pillars:** P7 (Speed & Token Efficiency), P2 (Scientific & Practical Quality). Allocation tunes WHICH model class each sub-agent runs, never HOW MANY sub-agents spawn — P8 fan-out width is untouched by this rule (`rules/hatch3r-fan-out-discipline.md` governs width; the two axes never trade against each other).

## Model-class vocabulary

`economy | default | strongest` — the Model Class ladder from `rules/hatch3r-deep-context.md` → Tier Assignment. A class is a capability class, not a vendor model id:

- Each adapter maps a class to its platform-native model vocabulary at emission time (`src/models/tiers.ts`), and the per-spawn pass below maps it at dispatch time — canonical content never names vendor models.
- A `models.tiers.<class>` pin in `hatch.json` wins verbatim over every adapter map (`resolveTierModel`, `src/models/tiers.ts`), so an operator controls what each class resolves to in their repo.
- The legacy tier words `fast` / `standard` / `reasoning` are accepted as synonyms on user-authored overrides only (`normalizeModelClass`); on the canonical corpus a legacy word or a concrete model id in `model:` frontmatter is a validation error (MODEL-CLASS-VOCAB).

## Static class floor

Every canonical agent declares `model: <class>` frontmatter — its floor. Runtime allocation may RAISE the class above the floor, never lower it. Lowering is reachable only through explicit user config (`.hatch3r/agents/<id>.customize.yaml` `model:`, or `hatch.json` `models.agents[<id>]` / `models.tiers` — see Overrides). An orchestrator that dispatches an agent below its declared floor without such config is violating this rule: re-dispatch at the floor.

## Allocation matrix (every spawn)

On every Task-tool spawn, resolve:

```
allocated_class = max(agent static floor, task-tier class)
```

The task-tier class is Tier 1 → `economy`, Tier 2 → `default`, Tier 3 → `strongest`, read from the EFFECTIVE tier — baseline `deepContextTier` or a recorded mid-run upgrade via `resolveEffectiveTier` (`rules/hatch3r-agent-orchestration.md` → Tier-to-Phase-4 specialist depth mapping) — so a mid-run tier upgrade propagates into every subsequent spawn's class, exactly as it propagates into researcher and specialist depth.

| Lane | Agents | Floor | Tier 1 | Tier 2 | Tier 3 |
|------|--------|-------|--------|--------|--------|
| Verdict / sign-off (16) | the 10 CQ specialists (`hatch3r-ui`, `hatch3r-ux`, `hatch3r-security`, `hatch3r-reliability`, `hatch3r-testability`, `hatch3r-scalability`, `hatch3r-performance`, `hatch3r-maintainability`, `hatch3r-enhancability`, `hatch3r-product-spec`) + `hatch3r-reviewer`, `hatch3r-architect`, `hatch3r-edge-case-analyst`, `hatch3r-incident-responder`, `hatch3r-greenfield-spec`, `hatch3r-brownfield-spec` | `strongest` | strongest | strongest | strongest |
| Work (9) | `hatch3r-implementer`, `hatch3r-fixer`, `hatch3r-researcher`, `hatch3r-docs-writer`, `hatch3r-devops`, `hatch3r-creator`, `hatch3r-pack-installer`, `hatch3r-dependency-drafter`, `hatch3r-handoff-preparer` | `default` | default | default | strongest |
| Mechanical (5) | `hatch3r-lint-fixer`, `hatch3r-ci-watcher`, `hatch3r-context-rules`, `hatch3r-handoff-loader`, `hatch3r-learnings-loader` | `economy` | economy | economy | economy |

Two rows carry the load-bearing consequences:

- **Always-mode floor specialists run `strongest` at every tier, Tier 1 included.** `hatch3r-security` (CQ3) and `hatch3r-testability` (CQ5) dispatch on every code change per the Phase Skip Criteria — and they dispatch at `strongest` even when the change itself is Tier 1. A Tier-1 change gets a cheap work lane and a full-strength verdict lane; the verdict lane is never where allocation economizes.
- **The mechanical lane is the one lane the tier raise does not touch.** Its transformations are bounded regardless of the surrounding task's tier — lint pattern fixes, CI-log parsing, and rule/handoff/learnings loading do not grow with tier — and every output it produces is re-verified downstream by the Phase 4 validation pass and the review gate. `max()` therefore applies to the verdict and work lanes; the mechanical lane stays `economy` at every tier.

Worked examples: a Tier-1 typo fix spawns `hatch3r-implementer` at `default` (its floor, above the tier's `economy`) and `hatch3r-security` at `strongest` (floor). A Tier-3 migration spawns the same implementer at `strongest` (tier class above the `default` floor) — same agent, tier-scaled class.

## Explicit per-spawn pass

Pipeline sub-agents spawn as generic types (`subagent_type: "generalPurpose"`, the spawn convention in `rules/hatch3r-agent-orchestration.md`), which never load the emitted agent definition files — a frontmatter floor cannot reach a generic spawn on its own — and definition-level model preferences are additionally reported unreliable on at least one host (References). Therefore:

- On a platform whose spawn tool accepts a per-invocation model parameter, pass the allocated class's mapped model explicitly on EVERY Task invocation; never rely on the agent definition file to carry it.
- On a platform without a per-invocation parameter, record `model_class: <class>` in the spawn prompt so allocation intent stays auditable even where it is not mechanically applied.
- Emit the allocated class per spawn alongside the `sub_agents_spawned` output field (`rules/hatch3r-fan-out-discipline.md` → Required output field):

```
sub_agents_spawned:
  count: 3
  rationale: 2 disjoint modules + always-mode security floor
  task_structure: parallelizable
  model_classes: { hatch3r-implementer: default, hatch3r-implementer#2: default, hatch3r-security: strongest }
```

A spawn row whose class a reviewer cannot reproduce from the matrix above is an allocation defect — fix the allocation or the record.

## Floor pinning

`hatch3r-security`, `hatch3r-testability`, and any `floor:*`-tagged agent MUST NOT resolve below `default` from any override layer. An override that would (a class word below `default` on a floor agent) is a config error — surface it in the run output and proceed at `default` or above; never silently honor it. Static enforcement on the canonical corpus is the model-class validator mode (`scripts/validate-efficiency-invariants.ts --model-class`): class-word vocabulary on every agent (MODEL-CLASS-VOCAB) plus `model: strongest` pinning on every always-mode and CQ-roster specialist (MODEL-CLASS-FLOOR).

## Overrides

Three user layers, highest first (`src/models/resolve.ts::resolveArtifactModel`):

1. `.hatch3r/agents/<id>.customize.yaml` `model: <concrete id>` — bypasses class mapping entirely; the id ships as-is.
2. `.hatch3r/agents/<id>.customize.yaml` `model: <class>` or `hatch.json` `models.agents[<id>]` — a class word here is remapped per adapter exactly like a frontmatter class.
3. `hatch.json` `models.tiers.{economy|default|strongest}` — project-wide remap of what a class MEANS; the pinned value wins verbatim over every adapter map.

Floor pinning constrains all three layers.

## References

- Claude Code sub-agents — `model` + `effort` frontmatter fields and per-invocation model resolution: https://code.claude.com/docs/en/sub-agents (accessed 2026-07-14; official vendor docs).
- Claude Code issue tracker — definition-level model preference intermittently ignored; passing the model per invocation is the confirmed workaround: https://github.com/anthropics/claude-code/issues/44385 (accessed 2026-07-14; vendor issue tracker).
- Cursor docs, "Subagents" (Context section, https://cursor.com/docs) — the sub-agent `model` field accepts `inherit` or a concrete model id, so a class must be mapped before emission (accessed 2026-07-14; official vendor docs).
- GitHub Copilot custom-agents configuration — `model` property: https://docs.github.com/en/copilot/reference/custom-agents-configuration (accessed 2026-07-14; official vendor docs).
