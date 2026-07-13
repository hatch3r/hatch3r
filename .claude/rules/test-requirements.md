---
id: test-requirements
type: rule
description: Testing standards from vitest.config.ts — 78/65/80/80 global coverage, 90/80/90/90 for src/merge, 85/70/85/85 for src/content, 85/75/85/85 for adapters/customization, 85/75/85/85 for src/install and src/audit.
tags: [maintainer, testing, p2, p5]
scope: always
precedence: high
---

# Test Requirements

> Last updated: 2026-07-09

**Pillars:** P2 (Scientific Quality), P5 (Governance Self-Quality)

Testing standards from `vitest.config.ts`:

**Global thresholds:** 78% statements, 65% branches, 80% functions, 80% lines.

**Critical module thresholds:**
- `src/merge/`: 90/80/90/90 (stmt/branch/func/line)
- `src/content/`: 85/70/85/85 (stmt/branch/func/line)
- `src/adapters/customization.ts`: 85/75/85/85
- `src/install/` and `src/audit/`: 85/75/85/85

**Rules:**
- Every new source file in `src/` gets a corresponding test in `src/__tests__/`
- No `test.skip` or `test.todo` without a tracking issue reference
- Tests use vitest — do not introduce other test frameworks
- Run `npm test` before committing to verify no regressions
- Run `npx tsc --noEmit` and `npm run lint` alongside tests

**Coverage check after changes:**
```
npm test -- --coverage
```

## CQ5 self-application scope (framework-dev vs end-user) — D3-SA3.5-04

`rules/hatch3r-testing.md` ships CQ5 test-class mandates to end-user repos. The rows below bind each mandate to hatch3r's OWN suite (framework-dev) versus generated end-user product code, so a framework-dev PR knows which test classes bind it without inheriting end-user product thresholds.

| Shipped mandate (`rules/hatch3r-testing.md`) | Framework-dev binding |
|---|---|
| §Property-Based Testing (pure functions, parsers, serializers, state machines, invariant-bearing functions) | **Binds.** Cover named framework invariants with property tests. No new devDependency: seeded vitest-native generators (a per-file `mulberry32` PRNG over ≥200 cases) stand in for `fast-check` until that library is added to `package.json`. Live suites: manifest-migration round-trip idempotency (`src/__tests__/manifest/hatchJson.test.ts`), weighted-pillar-tally reproducibility + `filterByLanguages` idempotency (`src/__tests__/content/tags.test.ts`), deny-scan determinism + customize-tier monotonicity (`src/__tests__/adapters/customization.test.ts`). |
| §Mutation Testing (70% critical / 60% project-wide) | **End-user gate; framework-dev is report-only and deferred.** No per-commit mutation gate binds hatch3r's suite. Target posture: a nightly (not per-commit) scoped Stryker run over the critical tier only — `src/merge/`, `src/content/tags.ts`+`index.ts`, `src/adapters/customization.ts`, `src/manifest/hatchJson.ts` — reported, not gating, for the first cycle. Wiring it (add `@stryker-mutator/*` devDependency + `stryker.conf` + a nightly CI job) is a B1 infra decision — route through the clarification gate, not a silent edit. |
| §Determinism Contract (clock injection: "Production code never calls `new Date()` directly") | **End-user product-code contract, not a framework-dev refactor mandate.** hatch3r `src/` carries 106 direct `Date.now()`/`new Date()` call sites (non-test grep); these are grandfathered — framework-dev tests stay deterministic by not asserting exact wall-clock values, not by injecting a clock at all 106 sites. New framework-dev code injects a clock interface (the `src/pipeline/retryWithBackoff.ts` pattern) only where a test asserts on elapsed time. |
