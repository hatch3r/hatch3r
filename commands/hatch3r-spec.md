---
id: hatch3r-spec
type: command
description: Spec orchestrator — detects greenfield vs brownfield project state and runs the corresponding spec agent to produce requirements, acceptance criteria, risk inventory, and test plan (greenfield adds market/competitive/persona/tech-stack; brownfield adds codebase-map/pattern-detection/integration/migration).
orchestrator: true
agentPipeline: [hatch3r-greenfield-spec, hatch3r-brownfield-spec]
tags: [spec, planning, orchestrator]
pillars:
  governance: [P1, P2, P8]
  content-quality: [CQ8, CQ9]
triage_tiers: [1, 2, 3]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
parallel_tool_default: true
sub_agents_spawned:
  count: 1
  rationale: "one spec sub-agent per invocation — chosen between greenfield/brownfield by project-state detection (not parallel; mutually exclusive)"
---

# /hatch3r-spec

Spec orchestrator that detects project state, picks the matching spec agent (`hatch3r-greenfield-spec` or `hatch3r-brownfield-spec`), and aggregates the 8-deliverable contract — shared core (requirements, acceptance criteria, risk inventory, test plan) plus state-specific deliverables (greenfield: market/competitive/persona/tech-stack; brownfield: codebase-map/pattern-detection/integration/migration). Routing is mutually exclusive — exactly one spec agent runs per invocation.

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
| Test suite | tests/`, `__tests__/`, `spec/`, `*_test.go`, `*.test.ts` | +1 if present |
| Existing README with body | README.md ≥30 lines and not the npm/cargo init template | +1 |
| Adapter outputs already present | `.cursor/`, `CLAUDE.md`, `.github/copilot-instructions.md` | +1 |

**Classification:** brownfield score ≥3 → brownfield. Otherwise → greenfield. Threshold configurable via `--state=greenfield|brownfield` to override the heuristic.

Cache the score, the matched signals, and the resolved state in the run context. Report to the user before delegating.

## Triage

Resolve the triage tier from scope answer (or auto-detect):

- **Light** — single-feature spec. Skip optional deliverables (market sizing for greenfield, migration plan for brownfield) unless the user opts in. Default sub-agent input budget ~6,000 tokens.
- **Standard** — subsystem-level spec covering a coherent module. All 8 deliverables produced. Default budget ~12,000 tokens.
- **Deep** — full-project spec, multi-domain. All 8 deliverables plus depth on risk inventory (≥5 named risks with mitigation owners) and test plan (per-layer coverage matrix). Default budget ~24,000 tokens.

User overrides via `--effort=light|standard|deep`. When the user passes `--effort=deep` on a Light-classified scope, accept the override and note the budget delta in the Cost Estimate block.

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
| `output_root` | `.hatch3r/spec/<ISO-8601-timestamp>/` |
| `mvp_or_full` | §0 answer (greenfield only); brownfield ignores |
| `maturity_tier` | Read from `.hatch3r/hatch.json::maturity` (defaults to `solo` per Decision 16) |

No inline mutations from this orchestrator turn — the spec agent owns all file writes.

## Phase 3 — Aggregate deliverables

Wait for the spec agent's structured result. Verify all 8 deliverables landed:

**Shared core (both states):**
1. `requirements.md` — functional + non-functional requirements with priority labels.
2. `acceptance-criteria.md` — testable acceptance criteria, one block per requirement.
3. `risk-inventory.md` — named risks with likelihood × impact, mitigation owner, residual risk.
4. `test-plan.md` — coverage by layer (unit / integration / E2E / contract / mutation per `rules/hatch3r-testing.md` mandate-map).

**Greenfield-specific (`hatch3r-greenfield-spec`):**

5. `market-research.md` — addressable market, growth signals, ≥2 reputable sources ≤12 months old per `.claude/rules/content-authoring.md` §10.
6. `competitive-analysis.md` — named competitors, capability matrix, differentiation hypothesis.
7. `personas.md` — ≥2 personas with jobs-to-be-done, current workaround, acceptance signal.
8. `tech-stack.md` — chosen stack with rationale citing CQ7 (performance budgets) and CQ6 (scalability) impact.

**Brownfield-specific (`hatch3r-brownfield-spec`):**

5. `codebase-map.md` — directory tree summary, top 10 modules by LOC + churn, public interface inventory.
6. `pattern-detection.md` — recurring patterns (naming, error handling, test style) the new work must follow per CQ8.
7. `integration-plan.md` — touchpoint inventory (which existing files extend or wrap), expand-contract migration shape per CQ8.
8. `migration-notes.md` — pre/post snapshot diff plan, rollback path, observability touchpoints per CQ4.

If any deliverable is missing or empty, halt and surface the gap to the user — do not silently accept a partial spec. Resume via `--resume` per the resumability contract (Decision 27).

## Phase 4 — Per-Turn Pipeline-State Header

For Tier ≥ Standard runs, emit the header at the start of every assistant turn touching this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping: `1` = detection + triage, `2` = spec-agent delegation, `3` = aggregation + verification, `4` = summary. Light runs are exempt from the header per the Tier 1 exemption.

## Phase 5 — End-of-Turn Delegation Attestation

Every turn that mutated files at Tier ≥ Standard emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by the spec agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - .hatch3r/spec/<timestamp>/<deliverable>.md: via hatch3r-{greenfield|brownfield}-spec (proof: <delegation_proof_id>)
mutating_subagent_invocations: 1
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Phase 6 — Iteration Summary

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md`. Sections required: Status, Outcome, Done, Not Done / Deferred / Unverified, Open Questions / Blockers, Confidence, Artifacts Touched (the 8 deliverable paths), Verifications Run (deliverable-presence checks), Suggested Next Action (typically `/hatch3r-board-fill` to convert acceptance criteria into a board).

## Output paths

All deliverables land in a single timestamped directory:

```
.hatch3r/spec/<ISO-8601-timestamp>/
├── requirements.md
├── acceptance-criteria.md
├── risk-inventory.md
├── test-plan.md
└── {state-specific 4 files per Phase 3}
```

The directory is the unit of versioning — re-running `/hatch3r-spec` produces a new timestamped tree, never overwriting prior runs.

## Cost estimate (Decision 24)

Emit pre-execution estimate before Phase 2 dispatch:

```yaml
cost_estimate:
  expected_sa_count: 1
  estimated_input_tokens: 12000  # standard tier; light ~6000, deep ~24000
  triage_tier: light | standard | deep
  estimated_duration_min: 4-12   # standard tier
  web_research_budget: 2-6 sources  # greenfield only; brownfield is local-only
```

Post-execution: append actuals (input/output tokens emitted, sub-agent wall time, deliverable count) and the delta. Token telemetry sources from `src/pipeline/observability.ts`.

## References

- `governance/CONSTITUTION.md` §6 Decision #14 (reputable-source mandate) and Decision #23 (2 spec agents with shared core)
- `.claude/rules/content-authoring.md` §8 (C8-D5-M1 orchestrator marker) and §9 (Command vs Skill criterion, Decision #13)
- `agents/shared/user-question-protocol.md` (B1 gate)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
- `rules/hatch3r-iteration-summary.md` (canonical end-of-turn block)
- `commands/hatch3r-board-fill.md` (orchestrator pattern reference)
