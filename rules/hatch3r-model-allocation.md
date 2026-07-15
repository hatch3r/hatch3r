---
id: hatch3r-model-allocation
type: rule
description: "Model-class allocation per sub-agent spawn — the frontier | advanced | standard | economy vocabulary, the low | medium | high | xhigh | max effort axis, static per-agent class floors, the max(agent floor, effective-tier class) allocation matrix, an explicit per-spawn model pass, and floor pinning for verdict-class specialists."
tags: [orchestration, floor:protocol]
scope: always
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# hatch3r Model Allocation

**Pillars:** P7 (Speed & Token Efficiency), P2 (Scientific & Practical Quality). Allocation tunes WHICH model class each sub-agent runs, never HOW MANY sub-agents spawn — P8 fan-out width is untouched by this rule (`rules/hatch3r-fan-out-discipline.md` governs width; the two axes never trade against each other).

## Model-class vocabulary

`frontier | advanced | standard | economy` — the Model Class ladder, capability-descending; the Tier Assignment table in `rules/hatch3r-deep-context.md` maps task tiers onto its lower three rungs. A class is a capability class, not a vendor model id:

- Each adapter maps a class to its platform-native model vocabulary at emission time (`src/models/tiers.ts`), and the per-spawn pass below maps it at dispatch time — canonical content never names vendor models.
- A `models.tiers.<class>` pin in `hatch.json` wins verbatim over every adapter map (`resolveTierModel`, `src/models/tiers.ts`), so an operator controls what each class resolves to in their repo.
- Canonical-corpus authoring MUST use the four canonical words — a legacy word or a concrete model id in `model:` frontmatter is a validation error (MODEL-CLASS-VOCAB). The legacy words stay accepted as synonyms on user-authored overrides only (`normalizeModelClass`): `fast` → `economy`, `standard` → `standard`, `default` → `standard`, `reasoning` → `frontier`, `strongest` → `frontier`.

## Static class floor

Every canonical agent declares `model: <class>` frontmatter — its floor. Runtime allocation may RAISE the class above the floor, never lower it. Lowering is reachable only through explicit user config (`.hatch3r/agents/<id>.customize.yaml` `model:`, or `hatch.json` `models.agents[<id>]` / `models.tiers` — see Overrides). An orchestrator that dispatches an agent below its declared floor without such config is violating this rule: re-dispatch at the floor.

## Allocation matrix (every spawn)

On every Task-tool spawn, resolve:

```
allocated_class = max(agent static floor, task-tier class)
```

The task-tier class is Tier 1 → `economy`, Tier 2 → `standard`, Tier 3 → `advanced`, read from the EFFECTIVE tier — baseline `deepContextTier` or a recorded mid-run upgrade via `resolveEffectiveTier` (`rules/hatch3r-agent-orchestration.md` → Tier-to-Phase-4 specialist depth mapping) — so a mid-run tier upgrade propagates into every subsequent spawn's class, exactly as it propagates into researcher and specialist depth. The tier ladder tops out at `advanced` by design — `frontier` is floor-only: `max()` never mints `frontier` at runtime, so the top class enters a spawn only as an agent's authored static floor or an explicit operator override (Overrides), keeping frontier-class spend deliberate.

| Lane | Agents | Floor | Authored effort | Tier 1 | Tier 2 | Tier 3 |
|------|--------|-------|-----------------|--------|--------|--------|
| Verdict / sign-off (16) | the 10 CQ specialists (`hatch3r-ui`, `hatch3r-ux`, `hatch3r-security`, `hatch3r-reliability`, `hatch3r-testability`, `hatch3r-scalability`, `hatch3r-performance`, `hatch3r-maintainability`, `hatch3r-enhancability`, `hatch3r-product-spec`) + `hatch3r-reviewer`, `hatch3r-architect`, `hatch3r-edge-case-analyst`, `hatch3r-incident-responder`, `hatch3r-greenfield-spec`, `hatch3r-brownfield-spec` | `frontier` | `xhigh`; `max` on `hatch3r-security`, `hatch3r-reviewer`, `hatch3r-edge-case-analyst` | frontier | frontier | frontier |
| Work — mutating (3) | `hatch3r-implementer`, `hatch3r-fixer`, `hatch3r-creator` | `advanced` | `xhigh` | advanced | advanced | advanced |
| Work — supporting (6) | `hatch3r-researcher`, `hatch3r-docs-writer`, `hatch3r-devops`, `hatch3r-pack-installer`, `hatch3r-dependency-drafter`, `hatch3r-handoff-preparer` | `standard` | — (class default) | standard | standard | advanced |
| Mechanical (5) | `hatch3r-lint-fixer`, `hatch3r-ci-watcher`, `hatch3r-context-rules`, `hatch3r-handoff-loader`, `hatch3r-learnings-loader` | `economy` | `low` on the three loaders (`hatch3r-context-rules`, `hatch3r-handoff-loader`, `hatch3r-learnings-loader`); — (class default) on the rest | economy | economy | economy |

Two rows carry the load-bearing consequences:

- **Always-mode floor specialists run `frontier` at every tier, Tier 1 included.** `hatch3r-security` (CQ3) and `hatch3r-testability` (CQ5) dispatch on every code change per the Phase Skip Criteria — and they dispatch at `frontier` even when the change itself is Tier 1. A Tier-1 change gets a cheap work lane and a full-strength verdict lane; the verdict lane is never where allocation economizes.
- **The mechanical lane is the one lane the tier raise does not touch.** Its transformations are bounded regardless of the surrounding task's tier — lint pattern fixes, CI-log parsing, and rule/handoff/learnings loading do not grow with tier — and every output it produces is re-verified downstream by the Phase 4 validation pass and the review gate. `max()` therefore applies to the verdict and work lanes; the mechanical lane stays `economy` at every tier.

Worked examples: a Tier-1 typo fix spawns `hatch3r-implementer` at `advanced` (its floor, above the tier's `economy`) and `hatch3r-security` at `frontier` (floor). A Tier-3 migration spawns `hatch3r-researcher` at `advanced` (tier class above its `standard` floor) — same agent, tier-scaled class — while `hatch3r-implementer` sits at `advanced` from Tier 1 through Tier 3: no tier ever raises an agent to `frontier`.

## Effort ladder

`low | medium | high | xhigh | max` — the reasoning-effort axis, orthogonal to class: class selects which model serves an agent; effort sets how much reasoning that model spends. Effort resolves per agent through a two-stage chain, highest source first:

1. **Per-agent explicit** (`resolveAgentEffort`, `src/models/resolve.ts`): `.hatch3r/agents/<id>.customize.yaml` `effort:` beats the agent's authored `effort:` frontmatter.
2. **Class-level fallback** (`defaultEffortForClass`, `src/models/tiers.ts`) — applied only when stage 1 sets nothing AND the emitted model came from a class mapping (never for a user-set concrete model id): the `hatch.json` `models.tierEfforts.<class>` pin beats the built-in class default — `frontier: xhigh`, `advanced: high`, `economy: medium`; `standard` has no built-in default, so an unpinned `standard`-class agent resolves to no effort and inherits the platform default.

**Authored floors are un-degradable by class pins.** Authored `effort:` frontmatter sits above every class-level source in the chain, so a `models.tierEfforts` pin can never lower an agent below its authored level. Every `frontier`-floor agent authors `effort: xhigh` or above per the lane table (statically enforced by the `--model-class` validator mode: EFFORT-FLOOR requires authored effort at `xhigh`+ across the 16-id verdict roster; EFFORT-VOCAB holds every authored value to the 5-level enum), so an operator class pin cannot degrade the verdict lane — only a per-agent `.customize.yaml` `effort:`, a named per-agent decision, can lower one.

Per-adapter effort surfaces:

- **Claude Code** — the resolved level is emitted verbatim as the native `effort:` frontmatter key beside `model:`; when the chain resolves to nothing (unpinned `standard`-class agent with no authored effort), no `effort:` line is emitted.
- **Cursor** — `advanced`/`frontier` pins are concrete model ids; a bracket suffix is appended only when the resolved effort is `xhigh` or `max`, and its value is clamped to `high` — the bracket level Cursor documents (References) — so both levels emit `[effort=high]` and any resolved effort below `xhigh` emits no bracket.
- **Copilot** — no effort surface exists (the agent `model` field is a single display-name string), so the resolved effort is dropped at emission and degrades into the class→model pin alone; `standard`-class agents omit the field entirely and ride the platform default.

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
  model_classes: { hatch3r-implementer: advanced, hatch3r-implementer#2: advanced, hatch3r-security: frontier }
```

A spawn row whose class a reviewer cannot reproduce from the matrix above is an allocation defect — fix the allocation or the record.

## Floor pinning

`hatch3r-security`, `hatch3r-testability`, and any `floor:*`-tagged agent MUST NOT resolve below `standard` from any override layer. An override that would (a class word below `standard` on a floor agent) is a config error — surface it in the run output and proceed at `standard` or above; never silently honor it. Static enforcement on the canonical corpus is the model-class validator mode (`scripts/validate-efficiency-invariants.ts --model-class`): class-word vocabulary on every agent (MODEL-CLASS-VOCAB) plus `model: frontier` pinning on the 16-id verdict roster — always-mode ∪ CQ roster ∪ the six spec/architecture/review/incident ids (MODEL-CLASS-FLOOR).

## Overrides

Three user layers for class, highest first (`src/models/resolve.ts::resolveArtifactModel`):

1. `.hatch3r/agents/<id>.customize.yaml` `model: <concrete id>` — bypasses class mapping entirely; the id ships as-is.
2. `.hatch3r/agents/<id>.customize.yaml` `model: <class>` or `hatch.json` `models.agents[<id>]` — a class word here is remapped per adapter exactly like a frontmatter class.
3. `hatch.json` `models.tiers.{frontier|advanced|standard|economy}` — project-wide remap of what a class MEANS; the pinned value wins verbatim over every adapter map. Legacy keys still resolve through the synonym map (`strongest` → `frontier` and `default` → `standard` included); when a legacy key and its canonical key are both present, the canonical key wins (`resolveTierModel`). The sentinel `models.tiers.<class>: "inherit"` is the per-class off-switch: the adapter emits no native model field for that class.

Effort has its own two override points, mirroring the Effort ladder chain: `.hatch3r/agents/<id>.customize.yaml` `effort:` (per-agent, top of the chain) and `hatch.json` `models.tierEfforts.<class>` (class-level, canonical class keys only, below any authored frontmatter effort).

Floor pinning constrains all three class layers.

## References

- Claude Code sub-agents — `model` + `effort` frontmatter fields and per-invocation model resolution: https://code.claude.com/docs/en/sub-agents (accessed 2026-07-14; official vendor docs).
- Claude Code issue tracker — definition-level model preference intermittently ignored; passing the model per invocation is the confirmed workaround: https://github.com/anthropics/claude-code/issues/44385 (accessed 2026-07-14; vendor issue tracker).
- Cursor docs, "Subagents" (Context section, https://cursor.com/docs) — the sub-agent `model` field accepts `inherit` or a concrete model id, so a class must be mapped before emission (accessed 2026-07-14; official vendor docs).
- Cursor docs, "Subagents" — bracket effort options on concrete model pins, `claude-opus-4-8[effort=high]` example (the documented bracket level the Cursor emission clamps to): https://cursor.com/docs/subagents.md (accessed 2026-07-14; official vendor docs).
- Cursor docs, "Models" — Claude Fable 5 listed among selectable models: https://cursor.com/docs/models (accessed 2026-07-14; official vendor docs).
- GitHub Copilot custom-agents configuration — `model` property: https://docs.github.com/en/copilot/reference/custom-agents-configuration (accessed 2026-07-14; official vendor docs).
- GitHub Copilot supported AI models — display-name model strings, no per-agent effort parameter: https://docs.github.com/en/copilot/reference/ai-models/supported-models (accessed 2026-07-14; official vendor docs).
