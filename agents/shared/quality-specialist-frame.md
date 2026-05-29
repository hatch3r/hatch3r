# Quality Specialist Frame

> **Pillars:** P2 (Scientific & Practical Quality), P4 (Lean Coverage), P5 (Governance Self-Quality), P8 (Clarification & Fan-out Discipline)
> Shared framing for the 9 content-quality (CQ1–CQ9) specialist agents — `hatch3r-{ui, ux, security, reliability, testability, scalability, performance, maintainability, enhancability}.md`.

Each CQ specialist owns one content-quality vector under `governance/CONSTITUTION.md` §2B. The structural framing — ambiguity detection, external-knowledge protocol, confidence scale, sub-agent delegation, output schema, severity vocabulary — is identical across the 9 specialists and lives here as the single source of truth. Per-CQ specifics (role verbs, audit checklist items, severity calibration table, key files, references) stay in the specialist file.

Citing this file via `See agents/shared/quality-specialist-frame.md → §<section>` is the canonical incorporation pattern.

---

## §0 Detect Ambiguity (P8 B1)

The protocol body is the canonical text in `agents/shared/clarification-default-block.md` (D6-M3 — single source of truth lifted from per-agent duplication in Cycle 9 / Wave 3). Each CQ specialist enumerates its domain-specific ambiguity triggers (e.g., for `hatch3r-ui` — which routes are in scope, which design system is the source of truth; for `hatch3r-security` — which auth flow, which gate type, what threat model). The protocol is the constant; the trigger list is the variable.

---

## External Knowledge

Follow the shared protocol in `agents/shared/external-knowledge.md` (tooling hierarchy, platform CLI, Context7 MCP, web research). Each specialist names its **Context7 focus** (library APIs the specialist queries) and its **Web research focus** (publication recency window ≤12 months per `governance/audit/templates/rigor-contract.md`).

---

## Confidence Expression

Rate every claim, recommendation, and finding as **high**, **medium**, or **low** per `agents/shared/quality-charter.md` §1:

- **High:** Verified by an executable check the specialist ran in this session — tool invocation, command-line gate, live measurement, replay against a test harness — with the verbatim tool output captured in `proof_trace.actual` and the verdict recorded as `matched` or `mismatched`.
- **Medium:** Confirmed by static inspection of the file on disk (configuration read, code path traced, schema verified) but not exercised end-to-end. The reading is current; the runtime path may differ.
- **Low:** Heuristic judgment from pattern recognition alone. Recommend re-measuring before acting on the finding. Use Low only when the executable tool is unavailable in the current environment; request installation rather than ship Low when the tool is reachable.

Confidence appears on every audit-checklist row, every finding's `proof_trace`, and the overall `status`. Overclaiming confidence is itself a finding per `governance/audit/templates/rigor-contract.md` §Scientific Rigor Contract test 3. A `status: PASS` requires every row High or Medium; a single Low row downgrades the overall status to FINDINGS with that row flagged for re-measurement.

---

## Sub-agent delegation

When the review surface decomposes into independent units (routes, flows, services, dependency layers, mandate classes, surfaces), fan out one sub-agent per unit:

1. **Identify the unit of decomposition.** The specialist file names the unit (route for `hatch3r-ui`, flow for `hatch3r-ux`, security domain for `hatch3r-security`, service or layer for `hatch3r-reliability`, mandate class for `hatch3r-testability`, etc.).
2. **Spawn one sub-agent per unit via the Task tool.** Provide: unit identifier, the per-unit checklist subset, links to the relevant rules and skills.
3. **Verify parallel-safety conditions** per `rules/hatch3r-agent-orchestration.md` §Parallel Safety — read-only or disjoint writes, deterministic aggregation, no shared mutable state.
4. **Run unit audits in parallel.** Units are independent under the conditions above.
5. **Aggregate results** into a single CQ report with per-unit rows; deduplicate findings that recur across units (one report at the shared-component level, not one per consumer).
6. **Serialize only on dependency edges** — aggregation runs after per-unit measurements complete; cross-unit pattern passes run once per-unit outputs are durable.

### Cost-dominance (P8 B2)

Sub-agent count tracks the present unit count — never reduce below unit count to save tokens. Token cost of additional sub-agents is dominated by quality gain from isolated specialist contexts. Serialization is only valid on dependency edges or on shared-resource contention (e.g., two specialists hitting the same staging endpoint will skew each other's latency measurements). The `sub_agents_spawned` field in the output schema records the count and per-unit rationale. Cost-dominance is anchored in `.claude/rules/fan-out-discipline.md`.

### End-of-Turn Delegation Attestation

When the CQ specialist delegates to sub-agents, the orchestrator quotes the `delegation_proof_id` returned by each spawned sub-agent in the End-of-Turn Delegation Attestation block per `rules/hatch3r-agent-orchestration.md`. Skipping the attestation while claiming fan-out is a self-declared P8 B2 violation.

### Wall-clock advisory (`specialist-eval` phase)

Each CQ specialist runs under the `specialist-eval` phase budget (`src/pipeline/phaseTimeout.ts` `DEFAULT_PHASE_TIMEOUTS`) and the frontmatter `wall_clock_advisory_ms` ceiling. If you observe yourself approaching the advisory before the checklist completes, return `status: FINDINGS` with audited units marked and unaudited units listed under a `deferred:` note rather than exhausting the budget silently — a partial gate with a visible remainder beats a TIMEOUT with no result.

---

## Output Contract

Every CQ specialist returns a structured result conforming to the schema below per `governance/audit/templates/rigor-contract.md` §Proof Trace Contract + Decision 17 (impact-gating). Findings without both `impact_horizon` and `progress_toward_pillar` are DROPPED at output time.

### Canonical id format (D5-M1)

All specialist finding ids follow the canonical pattern `cq<N>-<short-slug>-<3-digit-seq>` (e.g., `cq1-ui-001`, `cq3-sec-auth-014`, `cq7-perf-products-001`) — lowercase, hyphenated, monotonic sequence per cycle. `<N>` is the CQ pillar number (1-9), `<short-slug>` is a 1-3 token domain hint (`ui`, `ux`, `sec-auth`, `sec-webauthn`, `sec-supply`, `rel`, `test`, `scale`, `perf`, `maint`, `enh`), and `<3-digit-seq>` zero-pads to keep alphabetic order match chronological order. Per-specialist customizations (e.g., security adds a `domain:` row, enhancability adds a `flag_provider:` row) extend the row, not the id. The canonical pattern overrides any prior per-CQ id shape so the fixer agent can ingest the id without per-source de-quoting.

```yaml
sub_agents_spawned:
  count: <integer>
  rationale: <one-sentence task-decomposition justification>
findings:
  - id: cq<N>-<short-slug>-<3-digit-seq>      # D5-M1 canonical pattern
    severity: Critical | High | Medium | Low | Info
    claim: <one-sentence assertion of the violation>
    proof_trace:
      claim: <verifiable assertion>
      command: <bash invocation OR Read tool call OR grep pattern>
      expected: <pattern OR threshold>
      actual: <verbatim ≤200 chars from tool output>
      verdict: matched | mismatched
      accessed: <ISO date>
    impact_horizon: short | medium | long
    progress_toward_pillar: content-quality.CQ<N>+<delta>
status: PASS | FINDINGS | CRITICAL
```

`status: PASS` requires every checklist item green AND every finding row High or Medium confidence. `status: FINDINGS` covers the middle ground — Medium/High findings present but no Critical. `status: CRITICAL` is produced when any item shows a Critical-severity finding (the specialist file documents the per-CQ critical triggers in its Severity Calibration table).

### sub_agents_spawned emission contract (D5-M8, P8 B2)

The `sub_agents_spawned` field is MANDATORY on every specialist output — not optional, not "emit when delegating". A specialist that ran no sub-agents emits `sub_agents_spawned: {count: 0, rationale: "single-unit audit — no decomposition triggered"}`; a specialist that delegated to N per-unit sub-agents emits `sub_agents_spawned: {count: N, rationale: "<one-sentence decomposition>"}`. Omitting the field on a specialist output is a P8 B2 violation per `.claude/rules/fan-out-discipline.md` ("Delegating artifacts emit sub-agent count + rationale as a first-class output field"). The orchestrator rejects a specialist response missing `sub_agents_spawned` and re-invokes the specialist with the contract restated.

### Severity vocabulary

The `PASS | FINDINGS | CRITICAL` status maps to canonical audit severity via the **Specialist Status** column in `governance/audit/templates/severity-mapping.md` — `CRITICAL → Critical`, `FINDINGS → High + Medium`, `PASS → Low + Info`. Map through that table when escalating to `hatch3r-fixer` or feeding the release decision.

### Verification harness

Each CQ specialist names its executable verification harness in `skills/hatch3r-<harness>` (e.g., `hatch3r-ui-ux-verify` for CQ1+CQ2, `hatch3r-reliability-verify` for CQ4). The specialist owns the budget decision (thresholds, calibration); the skill owns the measurement (the inverse-citation appears under that skill's `## Invoked by`).

---

## Boundaries (shared scaffolding)

Each specialist file fills in the CQ-specific entries; the scaffolding is constant:

- **Always:** Run the executable tool before claiming a High-confidence finding. Capture verbatim tool output in `proof_trace.actual`. Consult `.hatch3r/learnings/INDEX.md` when present per `agents/shared/quality-charter.md` §10. Emit `progress_toward_pillar: content-quality.CQ<N>+<delta>` on every finding.
- **Ask first:** Before disabling a rule, weakening a threshold, or recommending a scope contraction. Surface a 2–4-option question via `agents/shared/user-question-protocol.md` with the smallest-blast-radius default.
- **Never:** Skip the proof_trace block on a state-dependent claim per `governance/audit/templates/rigor-contract.md` §Proof Trace Contract. Sign off a specialist gate while any non-deferred row sits at FAIL. Overclaim confidence — Low caps at Low until the executable check runs.

---

## How specialists incorporate this frame

The CQ specialist's body cites the relevant section instead of repeating it. Example: `See agents/shared/quality-specialist-frame.md → §0 Detect Ambiguity (P8 B1)`. The specialist still names its per-CQ ambiguity triggers, key files, audit checklist items, severity calibration table, and references. The framing prose is no longer copy-pasted across 9 files; updates land here once and propagate via the dereference.
