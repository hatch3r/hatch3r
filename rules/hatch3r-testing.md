---
id: hatch3r-testing
type: rule
description: Test standards and conventions for the project
scope: always
---
# Testing Standards

## Core Principles

- Unit tests: project test runner. Integration: test runner + emulators/mocks. E2E: browser automation (Playwright or equivalent).
- **Deterministic.** Mock time where needed. No wall clock dependency.
- **Isolated.** Each test sets up and tears down its own state.
- **Fast.** Unit tests < 50ms. Integration tests < 2s.
- **Named clearly.** Describe behavior: `"should award 15 XP for 25-min focus block"`.
- **Regression.** Every bug fix includes a test that fails before the fix and passes after.
- **No network.** Unit tests must not make network calls. Use mocks.
- No type escape hatches in tests. No `.skip` without a linked issue.
- Write tests to `tests/unit/`, `tests/integration/`, `tests/e2e/`, or equivalent.
- Use test fixtures from `tests/fixtures/` or equivalent.
- **Browser verification.** For UI changes, verify visually in the browser via browser automation MCP after automated tests pass. Capture screenshots as evidence.

## Coverage Thresholds

- **Statement coverage:** 80% minimum across the project. New code must not decrease overall coverage.
- **Branch coverage:** 70% minimum. Uncovered branches must be justified (e.g., defensive error handling unlikely to trigger).
- **Function coverage:** 80% minimum. Every exported function must have at least one test.
- **Per-PR gate:** CI blocks merge if the PR decreases coverage by more than 1% in any metric.
- **Critical modules** (auth, payments, data persistence, security rules): 90% statement, 85% branch minimum.
- Generate coverage reports in CI and publish as PR comments or artifacts for visibility.
- Exclude generated code, type declarations, and config files from coverage metrics.

## Mocking Strategy

- **Prefer fakes over mocks** for stateful dependencies (databases, caches). Fakes implement the real interface with in-memory state, making tests more realistic.
- **Use stubs** for simple value returns where behavior is irrelevant to the test (e.g., config lookups, feature flags).
- **Use mocks** (with call verification) only when the interaction itself is the behavior under test (e.g., verifying an event was emitted, an API was called with specific arguments).
- **Mock boundaries, not internals.** Mock at module/service boundaries (HTTP clients, database drivers, external SDKs). Never mock private functions or internal implementation details.
- **Reset mocks between tests.** Use `beforeEach` / `afterEach` to restore original implementations. Leaked mock state is a top source of flaky tests.
- **Type-safe mocks.** Mock implementations must satisfy the same TypeScript interface as the real dependency. Avoid `as any` in mock setup.
- **No mocking the unit under test.** If you need to mock part of the module you are testing, the module has too many responsibilities — refactor first.

## Property-Based Testing

- Use a property-based testing library (fast-check or equivalent) for functions with wide input domains.
- **Priority targets:** parsers, serializers, validators, encoders/decoders, mathematical functions, and any pure function with complex input types.
- Define invariants as properties: round-trip (encode then decode equals original), idempotency (applying twice equals applying once), monotonicity, commutativity.
- Use `fc.assert` with at least 100 runs per property. Increase to 1000 for critical paths.
- When a property test finds a failure, add the minimal counterexample as a dedicated regression unit test.
- Shrinking must be enabled — it reduces failing inputs to the smallest reproduction case.
- Property tests belong alongside unit tests in `tests/unit/`. Name them clearly: `"property: round-trip serialization for UserProfile"`.

## Mutation Testing

- Use Stryker (or equivalent mutation testing framework) on critical modules to measure test effectiveness beyond line coverage.
- **Mutation score target:** 70% minimum on critical modules (auth, data layer, business rules). 60% minimum project-wide.
- Run mutation testing in CI on a weekly schedule (not per-PR — too slow). Report results as a CI artifact.
- **Surviving mutants** indicate tests that pass regardless of code changes — these are false-coverage tests. Fix them by adding assertions that detect the mutation.
- Focus mutation testing effort on modules where a bug would cause data loss, security vulnerability, or financial impact.
- Exclude test files, generated code, and UI presentation logic from mutation analysis.

## Flaky Test Handling

- **Zero tolerance policy.** A flaky test erodes trust in the entire suite. Fix or quarantine within 48 hours of detection.
- **Quarantine process:** Move the flaky test to a `tests/quarantine/` directory or tag with `.skip("FLAKY: #issue-number")`. Create a tracking issue immediately.
- **Retry strategy in CI:** Allow a maximum of 1 automatic retry for the full test suite. Never retry individual tests silently — that masks flakiness.
- **Root cause investigation:** Common causes are shared mutable state, timing dependencies (real clocks, `setTimeout`), port conflicts, uncontrolled randomness, and external service calls.
- **Fix patterns:** Replace `setTimeout` with fake timers, replace shared state with per-test setup, replace port binding with dynamic ports, seed random generators deterministically.
- **Flaky test metrics:** Track flaky test rate over time. Target < 0.5% flaky rate (flaky runs / total runs). Alert when rate exceeds 1%.
- **Quarantine review:** Review quarantined tests weekly. Tests quarantined for more than 30 days must be either fixed or deleted with justification.

## Test Data Management

- **Factories over fixtures.** Use factory functions (builder pattern) to generate test data with sensible defaults and per-test overrides. Factories produce valid objects by default; tests override only the fields relevant to the scenario.
- **Builder pattern example:** `buildUser({ role: "admin" })` returns a full valid User with admin role and random but valid defaults for all other fields.
- **No shared mutable fixtures.** If multiple tests read the same fixture data, each test must get its own copy. Use `structuredClone()` or factory functions.
- **Realistic data.** Use faker or equivalent for generating realistic names, emails, dates. Avoid magic strings like `"test"`, `"foo"`, `"abc123"`.
- **Deterministic seeding.** When using random data generators, seed them per test file so failures are reproducible.
- **Fixture files** (JSON, YAML) are acceptable for large, complex, or externally-sourced test inputs (API response snapshots, configuration samples). Store in `tests/fixtures/`.
- **Database state:** Integration tests that require database state must set up and tear down within the test using helpers. Never depend on database state from a previous test.

## Snapshot Testing

- **Use sparingly.** Snapshots are appropriate for serialized output (JSON API responses, CLI output, rendered HTML structure) where the exact output matters and is stable.
- **Not appropriate for:** UI component visual appearance (use visual regression tests), objects with timestamps or random IDs (unstable), large objects (unreadable diffs).
- **Review discipline.** Snapshot updates (`--update-snapshots`) must be reviewed as carefully as code changes. Reviewers must verify the new snapshot is intentionally correct, not just "different."
- **Keep snapshots small.** Snapshot files > 100 lines suggest the test is asserting too broadly. Narrow the assertion to the relevant subset.
- **Inline snapshots** (where supported) are preferred over external `.snap` files for short outputs (< 20 lines) because they keep the assertion co-located with the test.
- **Name snapshot files** to match their test file: `auth.test.ts` → `auth.test.ts.snap`.
