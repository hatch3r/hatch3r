---
id: hatch3r-testability-verify
name: hatch3r-testability-verify
type: skill
description: Testability verification gate before commit/release — per-feature test-class mandate map, real-deal-first ratio, coverage thresholds, AI eval coverage, mutation kill-rate, contract tests, property tests, determinism contract
tags: [review, testing, floor:content-quality]
scope: conditional
globs: "src/__tests__/**,tests/**,test/**,spec/**,e2e/**,evals/**,**/stryker.conf.json,**/pom.xml,**/pacts/**"
precedence: normal
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Testability Verification Gate

## Quick Start

This skill defines what "done" means for any feature shipping test code or a feature in a mandate-map class (parser, payment, RPC, state machine, UI, AI feature). Run before declaring a feature complete. The 8 gates below mix automated checks (machine-checkable on every PR) with one release-cadence gate (mutation kill rate at release-cut). Skipping any gate = the feature is not done. Passing unit tests and reviewer approval alone do not satisfy this bar — a feature in a mandate class without its mandated test shape ships untested risk.

Inputs the skill expects:

- A test directory under one of: `src/__tests__/`, `tests/`, `__tests__/`, `e2e/`, `test/`, `spec/`.
- A coverage configuration in `vitest.config.ts`, `jest.config.js`, `pyproject.toml`, `pom.xml`, or `.coveragerc`.
- A mutation-test config in `stryker.conf.json` or `pom.xml` (when payment/auth/critical paths exist).
- A contract-test artifact path (`pacts/`, Schemathesis report) when service boundaries exist.
- An AI eval harness manifest (`evals/manifest.yaml`, `prompts/manifest.yaml`) when LLM features ship.

Outputs the skill produces: an 8-line verdict block written to the PR conversation, plus a JSON artifact at `.audit-workspace/testability-verify-<sha>.json` for downstream consumption by `hatch3r-release`.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Default path, not exception. Triggers for THIS skill: feature-surface class (parser vs payment vs RPC vs state machine vs UI vs AI), gate selection (coverage-threshold vs mandate-map vs AI-eval vs full), mock-justification budget (review all vs review new mocks only), mutation-test floor changes mid-cycle, and whether to block on Low-confidence findings.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Invoked by

This skill is the verification HARNESS — it declares HOW each testability gate is checked. The DISPATCHER that decides WHEN to run it is the CQ specialist agent:

- `agents/hatch3r-testability.md` — invokes this skill as the closing testability gate (CQ5) on PRs modifying test code or features in a mandate-map class. The agent contributes the review trigger and Phase-4 dispatch; this skill contributes the 8-gate procedure.

No duplication: the agent decides WHEN, this skill defines HOW.

## Gate 1: Per-feature test-class mandate map compliance

- For every changed feature, the mandated test class from `rules/hatch3r-testing.md` is present:
  - parser → fuzz harness with documented corpus under `testdata/fuzz/`;
  - payment → mutation test with documented kill-rate floor in `stryker.conf.json` or `pom.xml`;
  - RPC → consumer + provider contract test under `pacts/` plus broker can-i-deploy gate;
  - state machine → property test (fast-check or Hypothesis) with the invariant stated in a one-line comment;
  - UI → visual regression suite with baselines under `__snapshots__/`.
- Detection: read changed-file globs vs the mandate map; any miss → CRITICAL.

## Gate 2: Real-deal test ratio ≥80%

- Count: `(integration-tests-without-mocks) / (total-integration-tests) ≥ 0.80`.
- Mocks detected by `grep -rn "// MOCK:" <test-dir>` plus framework-level helpers (`vi.mock`, `jest.mock`, `unittest.mock.patch`, `mockito.when`).
- Every remaining mock carries `// MOCK: <reason>` comment + reviewer-acknowledged justification linked to a tracking issue.
- Mock without the marker → FINDINGS row per mock. Ratio <80% → FINDINGS at suite level.

## Gate 3: Coverage thresholds met per file class

- Global floor 78% statements / 65% branches / 80% functions / 80% lines from `vitest.config.ts` (or equivalent).
- Critical modules in this repo: `src/merge/` 90/80/90/90; `src/content/` and `src/adapters/customization.ts` 85/75/85/85.
- Read coverage from `coverage/coverage-summary.json` (Istanbul/v8) or `coverage.xml` (Cobertura).
- Below floor → FINDINGS with the specific module + metric named.

## Gate 4: AI feature eval coverage 100%

- Every AI feature ships golden examples + adversarial cases + regression suite running in CI on prompt or model changes.
- Hallucination rate measured per release on a labelled sample and tracked as an SLI per Anthropic engineering guidance; threshold breach blocks rollout.
- Detection: read the eval manifest, confirm CI workflow triggers on prompt/model file changes, read the SLI dashboard URL.
- Eval coverage <100% on a release-bound prompt or model change → CRITICAL.

## Gate 5: Mutation-test kill rate on critical paths

- Stryker for JS/TS (`stryker run --incremental`, read `reports/mutation/mutation.json` → `metrics.mutationScore`).
- Pitest for JVM (`mvn org.pitest:pitest-maven:mutationCoverage`, read `target/pit-reports/mutations.xml` → `mutationCoverage`).
- Common 2026 floor: mutation score ≥80% on payment + auth + `critical`-labelled paths per qaskills.sh 2026.
- Below floor → FINDINGS with the surviving-mutant count and file list.

## Gate 6: Property-based tests on pure functions with stated invariants

- Each pure function with a stated invariant carries a fast-check (`fc.property(fc.<arb>, fn => { /* invariant */ })`) or Hypothesis (`@given(...)`) test.
- The invariant is documented in a one-line `// invariant:` comment above the test.
- Missing invariant comment or missing test → FINDINGS row per function.
- Pattern reference: MarkTechPost 2026 stateful / differential / metamorphic patterns.

## Gate 7: Contract tests on every service-to-service boundary

- Consumer-driven Pact pacts published to a broker (`pact-broker can-i-deploy --pacticipant <svc> --version <sha> --to production`).
- Spec-driven Schemathesis (`schemathesis run --checks all <openapi.yaml>`) executed against staging.
- Missing or failing → CRITICAL on auth/payment paths, FINDINGS elsewhere.
- Cross-reference: `rules/hatch3r-contract-testing.md`.

## Gate 8: Determinism contract — 0 flaky tests over 30 days

- Read CI flake history: `gh run list --status failure --created >=$(date -d '30 days ago' +%Y-%m-%d) --json conclusion,name,startedAt | jq '[.[] | select(.conclusion=="failure")] | length'`.
- Quarantined tests carry a tracking issue assignee and a re-enable date, not `test.skip` / `test.todo` / `@pytest.mark.skip` in perpetuity.
- Flake count >0 with no owner → FINDINGS. Silenced flake without tracking issue → FINDINGS per occurrence.

## Pass criteria

All 8 gates pass = the feature is "done". Anything less = not done.

- Mandate-map class compliance: 100% on changed features.
- Real-deal ratio: ≥80% per cycle.
- Coverage floors: met per file class (global 78/65/80/80; critical modules per `.claude/rules/test-requirements.md`).
- AI eval coverage: 100% on release-bound prompt or model changes.
- Mutation kill rate: ≥80% on payment + auth + critical paths.
- Property-test coverage: 100% of pure functions with stated invariants.
- Contract-test parity: 100% of service boundaries; broker `can-i-deploy` exit 0.
- Flake count over 30 days: 0 (or quarantined with owner + re-enable date).

## On fail

The orchestrator running this skill emits a single-line verdict per gate (`GATE_N: PASS|FAIL <evidence-path>`) and aggregates them. One FAIL on a required gate blocks the merge regardless of reviewer approval status.

Failure escalation per `agents/hatch3r-testability.md` status mapping: Gate 1 fail (mandate-map class missing) → CRITICAL; Gate 4 fail (AI eval coverage <100%) → CRITICAL; Gate 7 fail on auth/payment → CRITICAL; Gates 2/3/5/6/8 → FINDINGS at High or Medium.

## When this skill runs

- Reviewer on any PR that modifies test code, removes tests, or introduces a feature in a mandate-map class.
- Implementer pre-write check when authoring new feature tests.
- Verifier pre-merge gate immediately before `gh pr merge` on protected branches.
- AI feature release gate before a prompt/model bump ships to production traffic.
- Quarterly audit on real-deal ratio drift.

## Cross-References

- `rules/hatch3r-testing.md` — per-feature test-class mandate map.
- `rules/hatch3r-ai-evals.md` — AI feature eval coverage.
- `rules/hatch3r-contract-testing.md` — Pact + Schemathesis boundaries.
- `.claude/rules/test-requirements.md` — coverage thresholds per file class.
- `agents/shared/quality-charter.md` §Testing depth — mock-justification budget.

## References

- Stryker Mutator — `stryker-mutator.io/docs/`
- Stryker 2026 floor guidance — `qaskills.sh/blog/mutation-testing-stryker-guide`
- Hypothesis property-based testing 2026 patterns — `marktechpost.com/2026/04/18/a-coding-guide-for-property-based-testing-using-hypothesis-with-stateful-differential-and-metamorphic-test-design/`
- Pact contract testing — `docs.pact.io/`
- Schemathesis — `schemathesis.readthedocs.io/`
- Anthropic engineering evals — `www.anthropic.com/engineering/demystifying-evals-for-ai-agents`
- AI hallucination benchmarks 2026 — `suprmind.ai/hub/ai-hallucination-rates-and-benchmarks/`
