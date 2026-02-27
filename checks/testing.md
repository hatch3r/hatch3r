---
id: testing
type: check
description: Test coverage review criteria covering test quality, regression testing, test isolation, and coverage requirements
---
# Testing Check

Review criteria for evaluating test coverage and quality in pull requests.

## Coverage Requirements

- `[CRITICAL]` Every new public function or method has at least one unit test.
- `[CRITICAL]` Code coverage does not decrease from the base branch. New code must be tested.
- `[CRITICAL]` Bug fix PRs include a regression test that fails without the fix and passes with it.
- `[RECOMMENDED]` Critical path functions (auth, payments, data mutations) have > 90% branch coverage.
- `[RECOMMENDED]` Edge cases are explicitly tested: empty inputs, boundary values, error conditions, null/undefined.

## Test Quality

- `[CRITICAL]` Tests are deterministic — no flaky tests. Tests must not depend on timing, network, or external services.
- `[CRITICAL]` Each test has a single clear assertion focus. Test names describe the expected behavior, not the implementation.
- `[CRITICAL]` Tests do not depend on execution order. Each test sets up and tears down its own state.
- `[RECOMMENDED]` Test names follow "should [expected behavior] when [condition]" or equivalent descriptive pattern.
- `[RECOMMENDED]` No logic duplication between test and implementation — tests should verify behavior, not re-implement it.

## Test Isolation

- `[CRITICAL]` Unit tests do not make real network calls, database queries, or file system writes.
- `[CRITICAL]` External dependencies are mocked, stubbed, or faked at module boundaries.
- `[CRITICAL]` Tests clean up after themselves — no leaked state, open handles, or modified globals.
- `[RECOMMENDED]` Test fixtures and factories are used for complex test data setup, not inline object literals.
- `[RECOMMENDED]` Shared test helpers live in a dedicated test utilities directory, not duplicated across test files.

## Integration Tests

- `[CRITICAL]` API endpoints have integration tests covering the happy path and primary error paths.
- `[CRITICAL]` Database operations are tested against a real (test) database, not mocks, for integration-level tests.
- `[RECOMMENDED]` Integration tests verify the complete request-response cycle including middleware (auth, validation, error handling).
- `[RECOMMENDED]` Integration tests use transactional rollback or isolated test databases to avoid cross-test contamination.

## Test Organization

- `[RECOMMENDED]` Test files are co-located with source files (`foo.ts` → `foo.test.ts`) or in a mirrored `__tests__/` directory.
- `[RECOMMENDED]` Test suites are grouped by feature or module, not by test type.
- `[RECOMMENDED]` Slow tests (integration, e2e) are tagged or separated so unit tests can run independently and fast.
- `[RECOMMENDED]` Test utility functions (factories, builders, custom matchers) are documented with usage examples.

## Regression Prevention

- `[CRITICAL]` Deleted tests must be justified — removing a test without replacing it requires explanation in the PR description.
- `[CRITICAL]` Modified tests still test the original intended behavior, not just the new implementation.
- `[RECOMMENDED]` Snapshot tests are reviewed for meaningful changes — auto-updated snapshots must be inspected.
- `[RECOMMENDED]` Performance-sensitive code has benchmark tests or assertions to catch regressions.
