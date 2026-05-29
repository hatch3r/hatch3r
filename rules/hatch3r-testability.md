---
id: hatch3r-testability-rule
type: rule
description: CQ5 Testability Quality measurement rule — per-feature test-class mandate map, real-deal ratio floor, AI eval coverage, mutation kill rate, specialist routing to hatch3r-testability
scope: conditional
globs: "src/**,**/__tests__/**,**/tests/**,**/test/**,**/*.test.*,**/*.spec.*,**/vitest.config.*,**/jest.config.*,**/cypress.config.*"
tags: [review, testing, floor:content-quality]
precedence: high
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Testability Quality (CQ5)

**Pillars:** P2 (Scientific & Practical Quality), CQ5 (Testability Quality)

## Scope

This rule binds the CQ5 measurement set across end-user code that hatch3r generates AND the framework's own test tree. It complements (does not duplicate) `rules/hatch3r-testing.md` (broad coverage + determinism + flaky-test policy). This rule owns:

- The per-feature test-class mandate map.
- The real-deal-first ratio floor.
- The AI feature eval coverage gate.
- The mutation-kill-rate gate on critical paths.
- Specialist routing to `agents/hatch3r-testability.md` (CQ5 reviewer / gate + test authoring).

## Per-Feature Test-Class Mandate Map

Source: `governance/CONSTITUTION.md` §2B CQ5 + `rules/hatch3r-testing.md` mandate table. Every changed feature is classified, and the mandated test class MUST be present. Missing the mandated class is a CRITICAL finding from the specialist.

| Feature class | Mandated test class | Tooling per ecosystem |
|---------------|---------------------|-----------------------|
| Parser (input deserialization, file format, protocol) | Fuzz | jazzer.js (JS), libfuzzer (Rust), atheris (Python), Jazzer (JVM) |
| Payment (settlement, refund, ledger) | Mutation | Stryker (JS/TS), Pitest (JVM), mutmut (Python), mutpy (Python) |
| RPC boundary (gRPC, GraphQL, REST consumer/provider) | Contract | Pact (cross-language), Schemathesis (OpenAPI), buf curl (protobuf) |
| State machine (workflow, transition graph) | Property | fast-check (JS/TS), Hypothesis (Python), ScalaCheck (JVM) |
| UI (component, page render) | Visual regression | Playwright with toHaveScreenshot, Percy, Chromatic, Loki |
| AI feature (prompt-driven, model-driven) | Golden + adversarial + regression eval | Inspect AI, promptfoo, Anthropic Workbench evals, Braintrust |

## Real-Deal-First Ratio

The floor: ≥80% of integration tests use real services (test database, in-process emulator, sandboxed external API) rather than mocks. Mocks are admitted only with a `// MOCK: <reason>` comment naming a specific reason from this allowlist:

- `// MOCK: External service has no sandbox (vendor confirmed)`
- `// MOCK: Network unreachable in CI (offline build)`
- `// MOCK: Time-source isolation (controlled clock)`
- `// MOCK: Side-effect quarantine (irreversible operation)`
- `// MOCK: Performance budget (test pack must run <5min)`

Reasons outside the allowlist fail the audit-checklist item 2. Framework-level mock helpers (`vi.mock`, `jest.mock`, `unittest.mock.patch`, `mockito.when`) are detected by import-statement grep against the per-language pattern map.

## AI Feature Eval Coverage

Every AI feature surface (prompt-driven, model-driven, agent-driven) MUST carry three eval sets per `rules/hatch3r-ai-evals.md`, at 100% coverage:

- **Golden set** — known-good inputs with expected outputs; regression marker on every model/prompt change.
- **Adversarial set** — prompt injections, boundary inputs, malformed payloads; verifies refusal + safe-failure behavior.
- **Regression set** — historical bug reproductions; ensures fixed bugs stay fixed.

CI wires the evals on prompt/model changes; the CI gate exits non-zero on regression. Hallucination is tracked as an SLI per Anthropic engineering guidance (cited under References on the source rule).

## Mutation Kill Rate

On critical paths (payment, auth, anything labelled `critical` per maturity tier), the mutation kill-rate floor is read from repo config (not from this rule's defaults). Default per-tier floors per CONSTITUTION §6 Decision 4:

| Tier | Mutation kill-rate floor on critical paths |
|------|--------------------------------------------|
| solo | Not required |
| team | ≥60% |
| scaleup | ≥75% |
| enterprise | ≥85% |

Tier escalation raises the floor; the previous baseline does not survive without re-measurement. Out-of-cycle floor changes require a documented baseline reset to keep wave-to-wave comparison valid.

## Specialist Agent Routing

| Trigger | Route to |
|---------|----------|
| Test code added, modified, or removed | `agents/hatch3r-testability.md` (CQ5 reviewer / gate) |
| New feature in a mandate-map class needs test authoring | `agents/hatch3r-testability.md` (author + gate) |
| Coverage threshold or test-runner config modified | `agents/hatch3r-testability.md` |
| AI feature surface added or model/prompt change | `agents/hatch3r-testability.md` + `rules/hatch3r-ai-evals.md` |
| Mutation kill-rate floor change proposed | `agents/hatch3r-testability.md` with baseline-reset documentation |

The CQ5 specialist authors mandated tests, reviews coverage, and gates releases; `agents/hatch3r-testability.md` writes tests AND measures mandate compliance, blocking releases that miss the floor.

## Per-Finding Output Format

Every finding emitted under this rule MUST include the rigor-contract fields per `governance/audit/templates/rigor-contract.md`:

- `proof_trace`: test-file:line citation + runner-output excerpt.
- `impact_horizon`: short | medium | long per CONSTITUTION Decision 17.
- `progress_toward_pillar: content-quality.CQ5+<delta>`: numeric delta against the threshold (e.g. `+0.05` for a 5% step toward mandate-map compliance).
- `confidence`: high | medium | low with explicit basis.
- `causal_chain`: ≥3-step linkage from observation → root cause → impact.

## Severity Mapping

Source: `governance/audit/templates/severity-mapping.md`.

| Specialist Status | Canonical Severity | Action |
|-------------------|--------------------|--------|
| `CRITICAL` | Critical | Block release on mandate-map miss OR AI-eval-coverage <100% |
| `FINDINGS` | High + Medium | Block merge on real-deal-ratio drop, coverage threshold miss, mutation kill-rate floor breach, or unowned flaky test |
| `PASS` | Low + Info | Surface in iteration summary |

## When to Invoke

- Every PR that modifies test code, removes tests, or introduces a feature in a mandate-map class.
- Every Implementer pre-write check — confirms the mandated test class before writing so `agents/hatch3r-testability.md` produces the right shape on first pass.
- Every Verifier pre-merge gate immediately before `gh pr merge` on protected branches; status must be PASS to allow merge on auth/payment paths.
- D03 or D22 audit cycles, and any maturity-tier escalation per `hatch3r config maturity`.
- AI feature release gate before a prompt/model bump ships to production traffic.
- Quarterly audit on real-deal ratio drift — even with no PRs to test code, mock accretion over time silently degrades the ratio against the 80% floor.

## References

- `governance/CONSTITUTION.md` §2B CQ5 (measurement set + specialist owner).
- `governance/audit/domains/D03-test-coverage-quality.md` (D03 testability domain).
- `agents/hatch3r-testability.md` (CQ5 reviewer / gate).
- `agents/hatch3r-testability.md` (CQ5 test-authoring + gate agent — single owner).
- `rules/hatch3r-testing.md` (broad coverage + determinism + flaky policy).
- `rules/hatch3r-ai-evals.md` (golden + adversarial + regression eval requirements).
- `rules/hatch3r-contract-testing.md` (Pact + Schemathesis pattern).
