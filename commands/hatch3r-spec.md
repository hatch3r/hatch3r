---
id: hatch3r-spec
type: command
orchestrator: true
agentPipeline: [hatch3r-greenfield-spec, hatch3r-brownfield-spec]
description: Spec orchestrator — detects greenfield vs brownfield project state and runs the corresponding spec agent to produce requirements, acceptance criteria, risk inventory, and test plan (greenfield adds market/competitive/persona/tech-stack; brownfield adds codebase-map/pattern-detection/integration/migration/non-destructive-check).
argument-hint: "[--state=greenfield|brownfield] [--effort=light|standard|deep] [--resume]"
tags: [spec, planning, orchestration]
pillars:
  governance: [P1, P2, P8]
  content-quality: [CQ10, CQ8, CQ9]
triage_tiers: [1, 2, 3]
plan_handoff: true
supports_resume: true
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
parallel_tool_default: true
sub_agents_spawned:
  count: 1
  rationale: "one spec sub-agent per invocation — chosen between greenfield/brownfield by project-state detection (not parallel; mutually exclusive)"
  task_structure: sequential
---

# /hatch3r-spec

Spec orchestrator that detects project state, picks the matching spec agent (`hatch3r-greenfield-spec` or `hatch3r-brownfield-spec`), and aggregates the per-state deliverable manifest — 8 deliverables greenfield, 9 brownfield: shared core (requirements, acceptance criteria, risk inventory, test plan) plus state-specific deliverables (greenfield: market/competitive/persona/tech-stack; brownfield: codebase-map/pattern-detection/integration/migration/non-destructive-check). The Deliverable Manifest below is the single source of truth for filenames and output location; both agents mirror it. Routing is mutually exclusive — exactly one spec agent runs per invocation.

## Relationship to /hatch3r-project-spec

`/hatch3r-spec` and `/hatch3r-project-spec` are both greenfield entry points and overlap on business research (market, competitive analysis, personas). They are meant to run in sequence, not in parallel:

- **This command** produces the **PRD** (`docs/specs/prd.md`) plus market/competitive/persona/tech-stack research — the product-requirements layer.
- **`/hatch3r-project-spec`** produces the **technical-design tree** (ADRs, domain model, per-module specs, `todo.md`, `AGENTS.md`) plus business-doc specs — the layer that consumes the PRD.

Sequence: run `/hatch3r-spec` first, then hand its `docs/specs/` output to `/hatch3r-project-spec`. project-spec's Step 1 extracts vision, personas, and market context from the PRD instead of re-interviewing, and skips regenerating the market/competitive research this command already wrote. Running both from scratch re-executes the overlapping business-research fan-out and yields two unreconciled spec trees — sequence them to avoid it.

## Deliverable Manifest (single source of truth)

This table is the one authoritative contract for what a spec run writes — filename, output location, and count. Both spec agents (`hatch3r-greenfield-spec`, `hatch3r-brownfield-spec`) mirror these filenames and write to the passed `output_root`; where an agent and this table disagree, this table wins. Agents cite this manifest rather than restating a divergent contract.

**Output root:** `docs/specs/` — the project-spec location every downstream reader consumes (`hatch3r-roadmap`, `hatch3r-reviewer`, `hatch3r-researcher`, `hatch3r-implementer`, and `agents/shared/quality-charter.md` §Source Hierarchy read `docs/specs/`). Passed to the spec agent as the `output_root` input.

**Shared core** — the requirements deliverable is a PRD on greenfield and a requirements doc on brownfield; the other three filenames are identical across states:

| Deliverable | Greenfield file | Brownfield file |
|-------------|-----------------|-----------------|
| Requirements | `prd.md` | `requirements.md` |
| Acceptance criteria | `acceptance-criteria.md` | `acceptance-criteria.md` |
| Risk inventory | `risk-inventory.md` | `risk-inventory.md` |
| Test plan | `test-plan.md` | `test-plan.md` |

**Greenfield-specific** (`hatch3r-greenfield-spec` — 8 deliverables total): `market-research.md`, `competitive-analysis.md`, `personas.md`, `tech-stack.md`.

**Brownfield-specific** (`hatch3r-brownfield-spec` — 9 deliverables total): `codebase-map.md`, `pattern-detection.md`, `integration-plan.md`, `migration-notes.md`, `non-destructive-check.md`.

Deliverable totals are state-dependent — **greenfield = 8, brownfield = 9** (brownfield carries the extra non-destructive-adoption check). These two numbers are the only valid totals; every count reference in this command and both agents cites them.

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request for unresolved questions per `agents/shared/user-question-protocol.md`. Ask via the platform-native question tool — do not proceed under silent assumption. Orchestrator-level ambiguities to resolve up front:

1. **Subsystem scope** — does the spec cover the whole project, a named module, or a single feature? If the request says "spec the project" without a scope marker, ask which slice and offer three options (full / named-subsystem / feature-only).
2. **MVP vs full vision** — for greenfield, ask whether the spec targets a shippable MVP (CQ8 surface area minimized) or the full envisioned product. Default `MVP` if no response.
3. **Triage tier** — Light (single-feature), Standard (subsystem), Deep (full-project). Auto-classify from scope answer; ask only if the request explicitly overrides.

Acceptable to proceed without asking ONLY when the brief alone is single-target, single-concern, and produces a testable acceptance criterion.

## Phase 0 — Project state detection

Detect greenfield vs brownfield from the working directory. Run these read-only probes in parallel:

| Signal | Source | Brownfield score |
|--------|--------|------------------|
| Tracked source files | `git ls-files` count under `src/`, `lib/`, `app/`, language-default dirs | +1 per ≥10 files |
| Manifest present | `package.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `pyproject.toml`, `Gemfile`, `composer.json` | +1 per manifest found |
| Commit count | `git rev-list --count HEAD` | +1 if ≥5 |
| Test suite | `tests/`, `__tests__/`, `spec/`, `*_test.go`, `*.test.ts` | +1 if present |
| Existing README with body | README.md ≥30 lines and not the npm/cargo init template | +1 |
| Adapter outputs already present | `.cursor/`, `CLAUDE.md`, `.github/copilot-instructions.md` | +1 |

**Classification:** brownfield score ≥3 → brownfield. Otherwise → greenfield. Threshold configurable via `--state=greenfield|brownfield` to override the heuristic.

Cache the score, the matched signals, and the resolved state in the run context. Report to the user before delegating.

## Triage

Resolve the triage tier from scope answer (or auto-detect):

- **Light** — single-feature spec. Skip optional deliverables (market sizing for greenfield, migration plan for brownfield) unless the user opts in. Default sub-agent input budget ~6,000 tokens.
- **Standard** — subsystem-level spec covering a coherent module. All manifest deliverables produced (8 greenfield / 9 brownfield). Default budget ~12,000 tokens.
- **Deep** — full-project spec, multi-domain. All manifest deliverables plus depth on risk inventory (≥5 named risks with mitigation owners) and test plan (per-layer coverage matrix). Default budget ~24,000 tokens.

## Effort Override (Decision 17)

Auto-tiering can misclassify — a trivial brief scored as Deep, or a multi-domain brief scored as Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Triage auto-classification above.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- When `--effort=deep` lands on a Light-classified scope (or `--effort=light` on a Deep-classified scope), accept the override and emit the resized `estimated_input_tokens_static_frame` in the Cost estimate block.
- No override passed → the Triage auto-classification stands.

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: the Phase 0 project-state classification (already scored against the brownfield-signal table), each of the 8 deliverables' risk and acceptance-criteria confidence, and the Phase 6 iteration-summary Confidence field MUST carry a high/medium/low rating sourced from the spec agent. Market-research figures (greenfield) are medium at best unless tied to a cited source per Decision 14. Every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces merge-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

## Phase 1.5 — Emit Pre-Execution Cost Preview

Before the Phase 2 dispatch, surface the `cost_estimate` block (the pre-execution half of the Cost estimate section below) so the spec run is never started blind. The Phase 0 detection + §0 ASK gate are user-driven and excluded from the duration estimate. This is the explicit pre-execution emission point mandated by `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate.

## Phase 2 — Delegate to chosen spec agent

Spawn exactly one spec agent via the Task tool. Routing is mutually exclusive:

- `brownfield` → `hatch3r-brownfield-spec`
- `greenfield` → `hatch3r-greenfield-spec`

**Inputs passed to the sub-agent:**

| Field | Source |
|-------|--------|
| `project_state` | Phase 0 result (greenfield or brownfield + matched signals) |
| `triage_tier` | Phase 1 result (light, standard, deep) |
| `scope` | §0 answer (full project / named subsystem / single feature) |
| `output_root` | `docs/specs/` (canonical project-spec location; see Deliverable Manifest) |
| `mvp_or_full` | §0 answer (greenfield only); brownfield ignores |
| `maturity_tier` | Read from `.hatch3r/hatch.json::maturity` (defaults to `solo` per Decision 16) |

No inline mutations from this orchestrator turn — the spec agent owns all file writes.

## Phase 3 — Aggregate deliverables

Wait for the spec agent's structured result, then verify every deliverable in the Deliverable Manifest for the resolved state landed under `output_root` (`docs/specs/`) and is non-empty:

- **Greenfield (8):** `market-research.md`, `competitive-analysis.md`, `personas.md`, `tech-stack.md`, `prd.md`, `acceptance-criteria.md`, `risk-inventory.md`, `test-plan.md`.
- **Brownfield (9):** `codebase-map.md`, `pattern-detection.md`, `integration-plan.md`, `migration-notes.md`, `non-destructive-check.md`, `requirements.md`, `acceptance-criteria.md`, `risk-inventory.md`, `test-plan.md`.

Per-deliverable content specs live in the spec agents (`agents/hatch3r-greenfield-spec.md`, `agents/hatch3r-brownfield-spec.md`) — this gate checks presence + non-emptiness against the manifest, not content shape. If any manifest deliverable for the resolved state is missing or empty, halt and surface the gap to the user — do not silently accept a partial spec. Resume via `--resume` per the resumability contract (Decision 27).

## Phase 4 — Per-Turn Pipeline-State Header

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping: `1` = detection + triage, `2` = spec-agent delegation, `3` = aggregation + verification, `4` = summary. Light runs are exempt from the header per the Tier 1 exemption.

## Phase 5 — End-of-Turn Delegation Attestation

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: the artifacts this command writes.

## Phase 6 — Iteration Summary

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md` — a 1–2 line recap plus every exception line whose firing condition holds. Worked example:

```markdown
## Iteration Summary
**SUCCESS** — Spec deliverables written to `docs/specs/`; all 8 greenfield deliverables present, presence checks passed.
files 8 (+412/−0) · sa 1/1 · gates 8/8 · cost Δ+6% tok / Δ−3% min · tier 2
Not done: none — full scope completed
Next: /hatch3r-roadmap to sequence the specs into a dependency-ordered todo.md, then /hatch3r-board-fill.
```

## Output paths

All deliverables land under `docs/specs/` per the Deliverable Manifest — the version-controlled project-spec location every downstream reader (`hatch3r-roadmap`, `hatch3r-reviewer`, `hatch3r-researcher`, `hatch3r-implementer`) consumes:

```
docs/specs/
├── acceptance-criteria.md      # shared core
├── risk-inventory.md           # shared core
├── test-plan.md                # shared core
├── prd.md | requirements.md    # requirements slot: prd.md greenfield / requirements.md brownfield
└── {state-specific files per the Deliverable Manifest}
```

`docs/specs/` is the versioning unit under git — re-running `/hatch3r-spec` refreshes deliverables in place, with prior runs recoverable from git history. When spec files already exist, ASK before overwriting (supplement / replace / abort) per the §0 ambiguity gate — an overwrite is an irreversible action.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28). (The Phase 6 block above is the domain rendering; the recap closes the run.)

### Cost Visibility (Decision 24)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`.

## Cost estimate (Decision 24)

Field names match the canonical contract in `rules/hatch3r-cost-visibility.md` (Pre-Execution Estimate + Post-Execution Actuals). Emit the pre-execution block before Phase 2 dispatch:

```yaml
cost_estimate:
  expected_sa_count: 1
  estimated_input_tokens_static_frame: 12000  # standard tier; light ~6000, deep ~24000
  estimated_web_research_queries: 4            # greenfield 2-6; brownfield is local-only (0)
  triage_tier: light | standard | deep
  estimated_duration_min: 8                    # standard tier; light ~4, deep ~12
```

Post-execution: emit the actuals + delta block per `rules/hatch3r-cost-visibility.md` before declaring iteration-summary status. Token telemetry sources from `src/pipeline/observability.ts`:

```yaml
cost_actuals:
  actual_sa_count: <int>
  actual_input_tokens: <int>
  actual_output_tokens: <int>
  actual_web_research_queries: <int>
  actual_duration_min: <float>
delta:
  sa_count_delta: <int>
  input_tokens_delta_percent: <float>
  duration_delta_percent: <float>
```

Both blocks land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`. Deltas beyond 25% absolute value carry `flagged_for_review: true`.

## References

- hatch3r design decisions: reputable-source mandate (Decision #14) and the 2-spec-agents-with-shared-core split (Decision #23)
- hatch3r design decisions: C8-D5-M1 orchestrator-marker contract (`orchestrator: true` + `agentPipeline`) and the Command-vs-Skill authoring criterion (Decision #13)
- `agents/shared/user-question-protocol.md` (B1 gate)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
- `rules/hatch3r-iteration-summary.md` (canonical end-of-turn block)
- `rules/hatch3r-cost-visibility.md` (Decision 24 cost_estimate / cost_actuals / delta field contract)
- hatch3r design decision: `--effort` universal override + triage_tiers (Decision 17)
- `commands/hatch3r-roadmap.md` (next step — reads `docs/specs/`, emits the board-fill-format `todo.md`)
- `commands/hatch3r-board-fill.md` (orchestrator pattern reference; consumes roadmap's `todo.md`)
---

## Execute This Plan

Close the run with the Plan-Execution Handoff block immediately after the Iteration Summary recap — a sanctioned post-recap trailer (when the Remaining Work terminal block also fires per `rules/hatch3r-iteration-summary.md`, it renders after this block as the run's very last output) (frontmatter `plan_handoff: true`; format + shapes: `commands/shared/orchestration-frame.md` → Plan-Execution Handoff (terminal block)).

Fill Shape B (chain) — the spec manifest is not directly executable, so the first line is the canonical next command: `/hatch3r-project-spec` (greenfield — the PRD feeds the technical-design layer) or `/hatch3r-roadmap` (either state — sequence the specs into a board-ready todo.md); still a fenced copy-paste prompt with `<one-line scope>` from the requirements deliverable and top-3 criteria from `docs/specs/acceptance-criteria.md`. Suppressed when this flow runs under `/hatch3r-plan` — the router emits one consolidated block.
