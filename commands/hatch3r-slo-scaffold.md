---
id: hatch3r-slo-scaffold
type: command
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-reliability]
description: "Generate baseline SLI/SLO scaffolding for a user-facing service — availability + latency p95/p99 objectives, 28-day error budget, and Google-SRE multi-window multi-burn-rate alert rules in OpenSLO openslo/v1. Implementer writes the files; hatch3r-reliability gates them against the CQ4 floor."
argument-hint: "[service-name]"
disable-model-invocation: true
tags: [devops, reliability, floor:content-quality]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
plan_gate: true
sub_agents_spawned:
  count: 2
  rationale: One hatch3r-implementer writes the SLI/SLO/alert scaffold files (code mutation flows through the implementer per the Mandatory Delegation Directive); one hatch3r-reliability gates the result against the CQ4 floor (SLO completeness, multi-burn-rate alert correctness). N services fan out to N parallel implementers; the implement -> gate edge is the only serialization. Cost-dominance per CONSTITUTION §2 P8.
  task_structure: mixed
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the request for unresolved questions in service scope, SLI source, and objective targets. If the request names two or more services, or omits the availability/latency targets, or does not name the metric source (Prometheus, OTel-derived, or platform-native), ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — the burn-rate alert math depends on the target and window, so a guessed target produces an alert rule that fires wrong. Proceed without asking ONLY when one service, one metric source, and explicit availability + latency targets are all given. Source: `rules/hatch3r-clarification-default.md`.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Parse service spec + targets | Orchestrator (inline) | No | Yes |
| 2. Confirm targets + ASK gate | Orchestrator (inline) | No | Yes |
| 3. Generate scaffold | `hatch3r-implementer` | Per service | Yes |
| 4. Gate against CQ4 floor | `hatch3r-reliability` | Per service | Yes |
| 5. Verify + Iteration Summary | Orchestrator (inline) | No | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): when the spec covers two or more services, fan out one `hatch3r-implementer` per service — each writes a disjoint SLO file set, aggregation is deterministic (union of generated paths), no shared mutable state. The `hatch3r-reliability` gate runs once per generated service after its implementer returns.

---

# SLO Scaffold -- Baseline SLI/SLO + Burn-Rate Alerts for a Service

Generates a versioned baseline reliability scaffold for one or more user-facing services: an availability SLI/SLO, a latency p95 and p99 SLI/SLO, a 28-day rolling error budget, and the Google-SRE multi-window multi-burn-rate alert rules that consume them. Output is OpenSLO `openslo/v1` (vendor-neutral, Git-reviewable) plus the matching Prometheus alert-rule expressions.

Use `/hatch3r-slo-scaffold` when a service has no SLO definition and you want the CQ4 baseline (one of the CONSTITUTION §2B reliability floors: "User-facing service SLO defined: 100%"). Use the `hatch3r-reliability-verify` skill to re-verify an existing SLO config without regenerating it; use `/hatch3r-benchmark` for performance measurement rather than SLO authoring.

---

## Argument Parsing

Optional positional argument: `<service-name>`.

- If supplied: seed Step 1 with that service.
- If omitted: ASK for the service name(s), metric source, and targets before delegating — generating an SLO without a target is meaningless.

---

## Step 0: Triage

Classify the scaffold before delegating, using the Light / Standard / Deep vocabulary in `agents/shared/triage-vocabulary.md` (the `triage_tiers: [1, 2, 3]` array maps `1 = Light`, `2 = Standard`, `3 = Deep`). The chosen tier sets the Step 2 `Tier {1|2|3}` label and the Step 0.5 cost preview.

- **Tier 1 (Light)** — one user-facing service with explicit availability + p95 + p99 targets and one named metric source (e.g. Prometheus). Fan-out: one `hatch3r-implementer` + one `hatch3r-reliability` gate.
- **Tier 2 (Standard)** — one service with a non-obvious SLI definition (a composite or multi-route service) where the good-event query must be derived rather than read off the RED defaults. Fan-out: one `hatch3r-implementer` at standard depth + one `hatch3r-reliability` gate.
- **Tier 3 (Deep)** — two or more services, OR a mixed metric-source fleet (some Prometheus, some OTel-derived). Fan-out: one `hatch3r-implementer` per service in parallel + one `hatch3r-reliability` gate per generated service.

A missing availability/latency target or an unnamed metric source fires the §0 B1 gate (`agents/shared/user-question-protocol.md`) before tiering — the burn-rate math derives from the target + window, so a guessed target produces an alert rule that fires wrong. Classify upward on uncertainty (a signal that could read as Tier 2 or Tier 3 takes Tier 3, per the highest-tier rule in `agents/shared/triage-vocabulary.md`).

---

## Step 1: Parse Service Spec + Targets

Collect the inputs that determine the objective values and the alert-rule constants. Cache them for the Step 3 implementer prompt.

| Input | Default if unspecified | Notes |
|-------|------------------------|-------|
| Service name | (required — ASK) | becomes OpenSLO `spec.service` |
| Availability target | (required — ASK) | e.g. `99.9` → `target: 0.999`; drives the budget |
| Latency p95 target | (required — ASK) | e.g. p95 ≤ 300 ms |
| Latency p99 target | (required — ASK) | e.g. p99 ≤ 800 ms |
| Metric source | Prometheus | OpenSLO `metricSource.type`: Prometheus, OpenTelemetry-derived, or platform-native |
| SLI definition | ratioMetric (good/total) | RED-derived: good = non-5xx requests, total = all requests |
| Time window | 28d rolling | OpenSLO `timeWindow.duration: 28d`, `isRolling: true` |
| Output directory | `slo/` | one `<service>.slo.yaml` per service |

The availability target sets the error budget: budget = (1 − target) × window. The burn-rate alert thresholds are derived from the budget per the Google SRE Workbook recipe (Step 3) — they are NOT free parameters.

---

## Step 2: Confirm Targets + ASK Checkpoint (only mutation gate)

Present the resolved spec and the derived budget so the maintainer confirms before files are written.

```
hatch3r-slo-scaffold — service: {name} (Tier {1|2|3})

Resolved spec:
  availability target: 99.9%   → 28-day error budget: 0.1% (≈ 40m19s downtime / 28d)
  latency p95: ≤ 300 ms
  latency p99: ≤ 800 ms
  metric source: Prometheus (ratioMetric good/total)
  window: 28d rolling
  output: slo/{name}.slo.yaml + slo/{name}.alerts.yaml

Burn-rate alert tiers (Google SRE Workbook ch. 5):
  page  — 2% budget / 1h  → 14.4x burn  (1h long + 5m short windows both breach)
  page  — 5% budget / 6h  → 6x burn     (6h long + 30m short)
  ticket — 10% budget / 3d → 1x burn     (3d long + 6h short)

Tier: 1
```

**In-Session Plan Gate (Tier >= 2).** The resolved spec + derived-budget block above IS the run's plan artifact — persist it to `docs/plans/{YYYY-MM-DD}-slo-{service}-scaffold.md` before the ASK, per `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: slug from the service name; gated dispatch = Step 3 implementer fan-out; revise = `edit` (re-persist after changes); no unattended flag — this ASK is the interactive seam.

ASK (only gate), per `agents/shared/user-question-protocol.md`:

> Generate the SLO scaffold for {name} with the targets above?
> - `accept` — generate the scaffold and run the CQ4 gate
> - `edit` — change a target, window, or metric source first
> - `skip` — cancel; write nothing
>
> (accept / edit / skip)

At Tier >= 2 the gate maps onto this ASK: `accept` = execute now (default), `edit` = revise + re-persist, `skip` = stop — the persisted plan artifact remains for the Execute This Plan handoff. After the user accepts, the run is autonomous through Step 5.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the Step 2 ASK gate, emit the cost preview per `rules/hatch3r-cost-visibility.md`:

```yaml
cost_estimate:
  expected_sa_count: <N services × 1 implementer + N × 1 reliability gate>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>   # 0 — the burn-rate recipe is fixed by the references below
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Step 5 Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`. `--effort=light|standard|deep` (Decision 17) forces the tier; record both auto and override.

---

> Gated dispatch (Tier >= 2): Step 3 fires only after the Step 2 In-Session Plan Gate approval — no implementer is spawned before the plan artifact is persisted and accepted.

## Step 3: Generate Scaffold (sub-agent delegation)

Delegate to `hatch3r-implementer` via the Task tool, one per service. Code mutation flows through the implementer per the Mandatory Delegation Directive — the orchestrator does not write files inline.

Each implementer prompt MUST include the resolved spec, the target file paths, and this scaffold contract:

**SLI/SLO (`slo/<service>.slo.yaml`, OpenSLO `openslo/v1`):**

1. One `kind: SLO` per objective: availability, latency-p95, latency-p99. Each carries `spec.service`, `spec.timeWindow` (`duration: 28d`, `isRolling: true`), `spec.budgetingMethod: Occurrences`, and `spec.objectives[].target`.
2. Availability SLI is a `ratioMetric` (`good`/`total` counters: good = non-5xx responses, total = all responses) per the RED method. Latency SLIs are `ratioMetric` where good = requests faster than the threshold (e.g. `histogram_quantile`-backed good-event count) — never an averaged latency, because an average hides the tail the p95/p99 objective targets.
3. `metricSource.type` set from Step 1; the metric query left as a `# TODO: project metric name` placeholder so the implementer does not invent a metric that does not exist (a low-confidence guess flagged in Notes per the implementer's confidence contract).

**Alert rules (`slo/<service>.alerts.yaml`, Prometheus):** the Google SRE Workbook multi-window multi-burn-rate recipe — three tiers, each requiring BOTH a long-window and a short-window burn-rate breach so a transient spike does not page:

| Tier | Budget consumed | Long window | Short window | Burn rate | Severity |
|------|-----------------|-------------|--------------|-----------|----------|
| Fast | 2% / 1h | 1h | 5m | 14.4× | page |
| Mid | 5% / 6h | 6h | 30m | 6× | page |
| Slow | 10% / 3d | 3d | 6h | 1× | ticket |

The burn-rate constants (14.4×, 6×, 1×) are fixed by the recipe for a 28-day window — they are not tunable per service; the per-service input is only the SLO target that scales the budget. Every alert rule annotation carries a `runbook_url` placeholder (a rule without a runbook is a CQ4 finding per `agents/hatch3r-reliability.md` Boundaries).

Also include in the prompt: all `scope: always` rule directives; the confidence expression requirement (verbatim, high/medium/low per `agents/shared/quality-charter.md` §1); and the explicit boundary "do NOT create branches, commits, or PRs". Await the implementer's structured result; capture `Files changed` and the `Delegation proof ID` per file.

---

## Step 4: Gate Against CQ4 Floor (sub-agent delegation)

After each service's implementer returns, delegate to `hatch3r-reliability` via the Task tool to gate the generated scaffold against the CQ4 reliability floor — the SLO-definition-review invocation in that agent's "When to invoke".

The reliability prompt MUST include the generated file paths and require these checklist items (from `agents/hatch3r-reliability.md` Audit checklist):

1. **SLO completeness** — availability + latency p95 + latency p99 all declared in the versioned file (checklist item 2).
2. **Multi-burn-rate alert correctness** — exactly 3 tiers, each with a long + short window pair, constants 14.4×/6×/1× for the 28-day window per Google SRE Workbook ch. 5 (checklist item 2); naked single-threshold alerts are rejected.
3. **Latency SLI is a histogram-backed ratio, not an average** (checklist item 3).
4. **Every alert carries a `runbook_url` annotation** (Boundaries: "Never deploy an alert rule without a runbook URL").

The reliability gate validates syntax where tooling is available (`promtool check rules` on the alert file, `sloth validate`/OpenSLO validation on the SLO file) and returns its `proof_trace` + verdict. If the gate returns Critical or High findings, surface them and route the fix back through `hatch3r-implementer` (max 1 regeneration pass), then re-gate. A persistent High finding ends the run at `PARTIAL`.

---

## Step 5: Verify + Iteration Summary

Run the available validation commands and record exit codes: `promtool check rules slo/<service>.alerts.yaml`, and OpenSLO/`sloth validate` on the SLO file when the tool is present (note "tool absent" otherwise — do not claim a pass you did not run).

### End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: `slo/<service>.slo.yaml`, `slo/<service>.alerts.yaml` — both `via hatch3r-implementer`.

### Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

Worked example for this domain:

```markdown
## Iteration Summary

**SUCCESS** — Scaffolded availability + p95/p99 SLOs and 3-tier burn-rate alerts for checkout-service; reliability gate PASS.
files 2 (+118/−0) · sa 2/2 · gates 2/2 · cost Δ+4% tok / Δ−10% min · tier 1
Not done: metric-name placeholders (`# TODO`) — deferred: fill with the project's real metric names before deploy
Next: wire slo/checkout-service.alerts.yaml into the Prometheus rule_files.

## Remaining Work

Not done: metric-name placeholders (`# TODO`) — deferred: fill with the project's real metric names before deploy
```

Status decision rules:
- **SUCCESS** — scaffold generated, reliability gate PASS, validation commands (where tooling exists) exit 0.
- **PARTIAL** — generated but the reliability gate left a residual High finding, or validation tooling reported a syntax issue not yet resolved.
- **FAILED** — the implementer returned BLOCKED on every service; nothing written.
- **BLOCKED** — targets contradictory or a metric source the maintainer must decide on.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping: `1` = spec parse + confirm, `2` = implementer scaffold generation, `3` = reliability gate + verify + summary. Tier 1 single-service runs are exempt per the Tier 1 exemption.

---

## Guardrails

1. **One ASK gate.** Step 2 is the only user-facing checkpoint; after `accept`, the run proceeds through Step 5.
2. **No commit or push.** Generated files are left staged for human review; git operations are out of scope.
3. **Burn-rate constants are fixed by the recipe.** Do not invent per-service burn rates — the 28-day-window 14.4×/6×/1× tiers come from the Google SRE Workbook; only the SLO target (which scales the budget) is a per-service input.
4. **No averaged latency SLIs.** Latency objectives are histogram-backed ratios (good = under-threshold request count); an average hides the tail the p95/p99 objective exists to bound.
5. **Runbook URL required on every alert.** A scaffold whose alert rules lack a `runbook_url` annotation fails the Step 4 CQ4 gate.

## Resumability (Decision 27/30)

slo-scaffold fans out one implementer per service, so checkpoint at the per-service boundary — an interrupted multi-service run re-enters at the first un-scaffolded service rather than regenerating the SLO/alert file sets it already wrote.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.slo-scaffold-workspace/`; step range the Step 1 → Step 5 progression; `wave` = the per-service index in Step 3/4; snapshot/rollback paths every `slo/<service>.slo.yaml` / `slo/<service>.alerts.yaml` a Step 3 implementer touches. Write points: after the Step 1 spec parse, after the Step 2 accept gate (Tier >= 2: the plan-gate artifact path + approval persist with it), after each Step 3 implementer return (per service), and after each Step 4 reliability gate.

## References

- [Google SRE — "Alerting on SLOs" (Site Reliability Workbook ch. 5)](https://sre.google/workbook/alerting-on-slos/) (accessed 2026-06-02, Google SRE, official-docs) — the multi-window multi-burn-rate recipe: 2%/1h @ 14.4×, 5%/6h @ 6×, 10%/3d @ 1× for a 30-day budget, each tier requiring a long + short window breach; source for the Step 3 alert table and the "no naked single-threshold alert" guardrail.
- [OpenSLO — specification README (`openslo/v1`)](https://github.com/OpenSLO/OpenSLO/blob/main/README.md) (accessed 2026-06-02, OpenSLO project, established-library) — the `apiVersion: openslo/v1`, `kind: SLO`, `spec.service`, `timeWindow` (`duration` + `isRolling`), `budgetingMethod`, `objectives[].target`, and `ratioMetric` (good/total) vs `thresholdMetric` field shapes used by the Step 3 SLI/SLO scaffold contract.
- [Grafana Labs — "How to implement multi-window, multi-burn-rate alerts"](https://grafana.com/blog/how-to-implement-multi-window-multi-burn-rate-alerts-with-grafana-cloud/) (accessed 2026-06-02, Grafana Labs, vendor-note) — cross-vendor confirmation of the Google SRE long+short window pairing and burn-rate constants applied to Prometheus-style rules; corroborates the second source per Decision 14's ≥2-independent-source requirement.
- `agents/hatch3r-reliability.md` -> Audit checklist items 2-3, Boundaries (accessed 2026-06-02, in-repo canonical, official-docs) — the CQ4 floor the Step 4 gate enforces.
