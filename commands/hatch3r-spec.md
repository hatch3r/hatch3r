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
supports_resume: true
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

## Effort Override (Decision 17)

Auto-tiering can misclassify — a trivial brief scored as Deep, or a multi-domain brief scored as Light. The user override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

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

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output (the Phase 6 Iteration Summary above is the spec-specific rendering — both the Phase 6 block and the 9-section canonical contract apply). The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `governance/audit/templates/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

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

Both blocks land in the iteration summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2. Deltas beyond 25% absolute value carry `flagged_for_review: true`.

## References

- `governance/CONSTITUTION.md` §6 Decision #14 (reputable-source mandate) and Decision #23 (2 spec agents with shared core)
- `.claude/rules/content-authoring.md` §8 (C8-D5-M1 orchestrator marker) and §9 (Command vs Skill criterion, Decision #13)
- `agents/shared/user-question-protocol.md` (B1 gate)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
- `rules/hatch3r-iteration-summary.md` (canonical end-of-turn block)
- `rules/hatch3r-cost-visibility.md` (Decision 24 cost_estimate / cost_actuals / delta field contract)
- `governance/CONSTITUTION.md` §6 Decision 17 (`--effort` universal override + triage_tiers)
- `commands/hatch3r-board-fill.md` (orchestrator pattern reference)
