---
id: hatch3r-plan
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer, hatch3r-architect, hatch3r-reviewer, hatch3r-greenfield-spec, hatch3r-brownfield-spec]
description: Planning router — classifies a free-form planning request, confirms the match, and drives the matching planning flow(s) (feature-plan, bug-plan, migration-plan, refactor-plan, test-plan, api-spec, project-spec, roadmap, spec) with shared intake context, producing one consolidated outcome and a single plan-execution prompt.
argument-hint: "[request] [--flow=feature-plan|bug-plan|migration-plan|refactor-plan|test-plan|api-spec|project-spec|roadmap|spec] [--effort=light|standard|deep]"
tags: [planning, orchestration]
pillars:
  governance: [P1, P2, P8]
  content-quality: [CQ10]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
plan_handoff: true
sub_agents_spawned:
  count: 2
  rationale: "Conditional dispatch — the router itself spawns nothing in Phase 0-1 (classification and shared intake are orchestrator-inline reads); fan-out belongs to the routed flow(s), whose pipelines execute as written. The dominant single-flow pipeline is researcher + docs-writer (2); the spec-state agents, architect, and reviewer dispatch only when their flow routes."
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → §0 Detect Ambiguity (P8 B1). Triggers: desired outcome unclear (fix vs design vs sequence); scope slice unclear (whole product vs one module vs one feature); greenfield/brownfield state unknown when a spec-family row (R7/R8) fires.

# /hatch3r-plan

Planning router: one entry point for "help me plan X". It classifies the request against the nine planning flows, confirms the match with the user, then reads and executes the matched command file(s) in this conversation with shared intake context — so the user does not have to know which of nine planning commands fits. Non-goals: this command routes and plans; it never implements at the plan seam. After consolidation the Phase 3.5 Execute-or-Defer ASK may continue into execution in this session via the workflow plan-file contract; deferred execution belongs to `/hatch3r-workflow --plan-file=<path>` (or the board path), per the consolidated Execute This Plan block a deferred run closes with.

## Phase 0 — Classify

Score the request against the routing table. Match rule: a row fires on ≥1 strong signal or ≥2 weak signals. `--flow=<name>` overrides classification entirely — skip scoring and route to the named flow.

| Row | Signals | Flow | Primary artifact |
|-----|---------|------|------------------|
| R1 | observed defect — "broken", "fails", "error", "regression"; repro steps; a stack trace | `bug-plan` | `docs/investigations/` |
| R2 | net-new capability on existing code — "add", "build", "feature"; a user story | `feature-plan` | `docs/specs/` |
| R3 | technology/version move — "migrate", "upgrade", "switch X→Y"; an EOL notice | `migration-plan` | `docs/migrations/` |
| R4 | structure change, behavior preserved — "refactor", "extract", "decompose", "tech debt" | `refactor-plan` | `docs/specs/` |
| R5 | verification strategy — "test plan", "coverage" | `test-plan` | `docs/specs/` |
| R6 | HTTP/API surface — "endpoints", "OpenAPI", "contract" | `api-spec` | `docs/api/` |
| R7 | whole-product spec — "spec the project", "PRD", "requirements" | `spec` | `docs/specs/` manifest |
| R8 | business + technical design tree for a new product — "architecture", "domain model", "module specs", "ADRs" | `project-spec` | `docs/specs/business\|technical/` |
| R9 | sequencing — "roadmap", "milestones", "what order", "prioritize" | `roadmap` | `docs/roadmap/` + `todo.md` |

**Tie-breaker ASK** — fires on equal scores, on ≥2 matched outcomes, or on zero matches. Ask via the platform-native question tool per `agents/shared/user-question-protocol.md`, listing each matched flow with a one-line outcome:

> Request matches {flow-1} ({one-line outcome}) and {flow-2} ({one-line outcome}). (a) {flow-1} only (b) {flow-2} only (c) both, in dependency order (d) neither — describe the outcome you want.

Report the matched row(s), the matched signals, and the resolved flow(s) to the user before dispatching anything.

## Triage

- **Light** — one flow, single concern (e.g. one bug, one endpoint). The routed flow runs at its own light tier.
- **Standard** — one flow with multiple concerns, or two flows in dependency order.
- **Deep** — ≥2 flows or a whole-product request (R7/R8 chains).

`--effort=light|standard|deep` forces the tier per hatch3r's universal `--effort` override (CONSTITUTION §6 Decision 17) and is passed through to each routed flow; no override → a persisted `defaultEffort` (`.hatch3r/hatch.json`) stands next, else the auto-classification — precedence per `agents/shared/triage-vocabulary.md` → Auto-tiering inputs. Emit the `tier: <1|2|3> — <signal summary>` rationale line at classification; per-tier pipeline depth defers to `agents/shared/triage-vocabulary.md` → Pipeline pruning per tier.

## Phase 1 — Shared Intake

Run the read-only probes in parallel (single message, batched tool calls — they are independent reads):

1. Repo state: language/manifest signals, tracked-source volume, commit depth.
2. `docs/specs/` presence and contents (headers only).
3. `todo.md` presence and open items.
4. Board context: `.hatch3r/hatch.json` and board configuration if present.

Synthesize ONE intake summary (project state, existing planning artifacts, open work). Every routed flow receives it as pre-answered context, so shared questions (project state, existing specs, board presence) are answered once here rather than once per flow.

## Phase 1.5 — Emit Pre-Execution Cost Preview

Before the Phase 2 dispatch, surface the `cost_estimate` block (the pre-execution half of the Cost estimate section below) so a multi-flow run is never started blind — the explicit pre-execution emission point mandated by `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate. Cover every flow about to run, not only the first.

## Phase 2 — Dispatch (read-and-execute)

Resolve the matched flow's emitted command file for the current repository — `.claude/commands/hatch3r-{flow}.md`, `.cursor/commands/hatch3r-{flow}.md`, or `.github/prompts/hatch3r-{flow}.prompt.md`, whichever exists — Read it, and execute its steps in THIS conversation.

Execute every numbered step and every ASK checkpoint of the routed command file as written — the file is the contract. Do not summarize, reorder, or skip steps; the routed flow's own gates (triage, cost preview, plan-lint) run exactly as they would on direct invocation.

- **Shared-intake substitution:** where the routed flow gathers context this run already holds (project state, existing specs, board presence), pass the Phase 1 intake summary as pre-answered input instead of re-probing. The flow's ASK checkpoints still fire.
- **Multi-match dependency order:** `spec` → `project-spec` → `api-spec` → `{feature|bug|migration|refactor}-plan` → `test-plan` → `roadmap`. Routed flows run in this order, never in parallel — each downstream flow consumes the upstream flow's artifacts.
- **Two-flow inline cap:** execute at most TWO flows inline per run (the context-degradation compress threshold). A longer sequence hands the remainder off as chained fresh-session prompts inside the consolidated Execute This Plan block: `/hatch3r-plan --flow=<next> <carried intake summary>`.
- **Platform note:** on platforms exposing a SlashCommand tool, invoking the routed command directly is an acceptable equivalent; the file-read path is the portable default.
- **Suppression:** routed flows do not emit their own Execute This Plan block or their own Execute-or-Defer ASK — this router asks once in Phase 3.5 and emits one consolidated block covering every artifact produced (see Execute This Plan below).

## Phase 3 — Consolidate

Verify each routed flow's deliverables landed by checking against that flow's own deliverable manifest or output-paths section (cite it; do not restate it). Then emit the consolidated outcome: one list of every artifact path produced across all routed flows, each with the producing flow and a one-line content summary. A missing or empty deliverable halts with the gap named — never silently accept a partial plan set.

## Phase 3.5 — Execute or Defer

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Execute-Now Continuation. Consolidated form: ONE ASK covering every artifact produced this run, in the Phase 2 dependency order — routed flows suppressed their own ASK, so this is the run's only continuation checkpoint.

- **execute now** (default) — execute the artifacts sequentially in-session, each via the workflow plan-file contract: Read the emitted `hatch3r-workflow` command file and run it with `--plan-file=<artifact>` semantics, fresh `cost_estimate` at each execution start.
- **revise** — return to the routed flow that produced the artifact needing change (re-enter at that flow's synthesis step).
- **stop** (the recommended default on Deep multi-flow runs) — emit the consolidated Execute This Plan block below for the deferred remainder.

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for plan: `1` = classify + shared intake, `2` = routed-flow dispatch (the routed flow's own sub-agent fan-out), `3` = consolidation, `4` = summary + handoff block. Light runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: the artifacts the routed flow(s) wrote this turn — attribution cites the routed flow's spawned sub-agents.

## Confidence Propagation Contract

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Confidence Propagation Contract. Per-command slot: plan readiness — the Phase 0 classification confidence and each routed flow's own deliverable confidence propagate into the consolidated outcome and the Iteration Summary Confidence line.

## Resumability

The router holds no checkpoint state of its own. Resume = re-invoke the routed command with its own resume affordance (`/hatch3r-{flow} --resume` where the flow supports it — each flow's Resumability section is its contract). An interrupted multi-flow sequence resumes at the first incomplete flow: completed flows' artifacts are on disk, so re-running the router with `--flow=<next>` plus the carried intake summary continues the chain without re-executing finished flows.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate. The recap's outcome sentence names the routed flow(s) and the consolidated artifact count.

## Execute This Plan

Close a **deferred** run (Phase 3.5 stop, or the Deep multi-flow default) with the consolidated Plan-Execution Handoff block immediately after the Iteration Summary recap — a sanctioned post-recap trailer (when the Remaining Work terminal block also fires per `rules/hatch3r-iteration-summary.md`, it renders after this block as the run's very last output) (frontmatter `plan_handoff: true`; format + shapes: `commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block)).

Consolidated form: one numbered fenced prompt per plan artifact produced, in the Phase 2 dependency order — run them in order, each in a fresh session. Shape A (`/hatch3r-workflow --plan-file=<artifact-path>`) is the default row; use the Shape B chain row for artifacts whose next step is another command (roadmap → `/hatch3r-board-fill`; spec → `/hatch3r-project-spec` or `/hatch3r-roadmap`; project-spec → `/hatch3r-roadmap`). When the Two-flow inline cap deferred flows, append their chained prompts (`/hatch3r-plan --flow=<next> <carried intake summary>`) as the final numbered entries. Criteria source per artifact: that flow's acceptance-criteria section.

## Cost estimate (Decision 29)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 29:

- **Pre-execution `cost_estimate`** — emitted in Phase 1.5 before the first routed-flow dispatch, covering every flow about to run.
- **Post-execution `cost_actuals` + `delta`** — the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 2` × the routed flow's own fan-out): Light ≈ the routed flow's Tier-1 count (often 2 — researcher + docs-writer); Standard = the single routed flow's standard fan-out (2–6); Deep = the sum across the ≤2 inline flows (up to ~13, e.g. spec + project-spec). The router adds zero sub-agents of its own — Phase 0–1 are inline reads. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

## Error Handling

- **Routed command file missing on every platform path:** stop and report which paths were checked; recommend `hatch3r sync` to regenerate adapter outputs, or name the flow so the user can invoke it directly once restored.
- **Routed flow halts at its own gate (failed plan-lint, unanswered ASK):** the halt is the routed flow's contract — surface it verbatim and stop; do not paper over a failed gate to keep the chain moving.
- **Zero rows match after the tie-breaker ASK:** restate the nine flows with one-line outcomes and ask the user to pick or rephrase; never guess a flow on a zero-signal request.

## Guardrails

- **Never implement at the plan seam.** This command produces plans through the routed flows; execution runs only through the Phase 3.5 Execute-Now Continuation, or the deferred `/hatch3r-workflow` invocation (or board path) against the persisted artifact.
- **Never run routed flows in parallel.** The dependency order under Phase 2 is the only execution order.
- **Never skip the routed flow's ASK checkpoints.** Routing does not reduce the user's checkpoints.
- **Confirm classification before dispatch.** The user sees the matched row(s) and resolved flow(s) before any flow executes.

## References

- Anthropic. "Effective context engineering for AI agents." `https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents` (accessed 2026-07-14, Anthropic engineering blog, official-vendor). Grounds the fresh-session execution handoff and the two-flow inline cap: context degrades measurably as a session accumulates derivation history, so execution re-reads only the plan and long routing sequences chain into fresh sessions.
- Claude Code documentation. "Subagents." `https://code.claude.com/docs/en/sub-agents` (accessed 2026-07-14, official-vendor docs). Task-dispatch model the routed flows' pipelines run on.
- Claude Code documentation. "Slash commands." `https://code.claude.com/docs/en/slash-commands` (accessed 2026-07-14, official-vendor docs). SlashCommand availability is platform-specific, grounding the portable file-read dispatch default in Phase 2.
- `commands/hatch3r-spec.md` — the in-corpus dispatcher precedent (Phase 0 classify → dispatch → aggregate) this router generalizes from 2 spec agents to 9 planning flows.
- `rules/hatch3r-iteration-summary.md` — recap contract + Plan-Execution Handoff requirement.
- `commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block) — the handoff block's single format home.
