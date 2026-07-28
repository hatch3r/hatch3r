---
id: hatch3r-qa-validation
name: hatch3r-qa-validation
type: skill
description: E2E validation workflow producing a structured pass/fail report with evidence. Use when running QA validation, acceptance testing, verifying releases, or working on QA E2E validation issues.
tags: [review, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# QA E2E Validation Workflow

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Read the issue and relevant specs
- [ ] Step 2: Produce a validation plan
- [ ] Step 3: Execute all test cases
- [ ] Step 4: Produce the validation report
- [ ] Step 5: File follow-up issues
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. This upgrades validation from exception-driven to default-driven. Triggers for THIS skill: validation scope (single feature vs release), target environment (staging vs prod), pass/fail thresholds, flaky-test policy (retry vs quarantine), and ship/hold authority (auto-block vs surface for review).

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output.

## Invoked by

This skill is a standalone generic E2E validation harness — it has NO 1:1 CQ specialist agent dispatcher (unlike `hatch3r-ui-ux-verify`, `hatch3r-reliability-verify`, `hatch3r-observability-verify`, and `hatch3r-browser-verify`, which each map to a CQ specialist). It is invoked directly by release-prep and acceptance-testing flows, and it delegates the UI/UX sub-gate to `hatch3r-ui-ux-verify` (Step 3c). Kept standalone per the cross-artifact overlap review (F16.3-H4): its pass/fail report spans API, data-integrity, and background-job test cases that no single CQ specialist covers.

Scope boundary: here the AGENT plans and executes the validation itself; for a manual test path a HUMAN walks through to judge a PR or diff shippable, use `hatch3r-qa-path` (`skills/hatch3r-qa-path/SKILL.md`). That skill also spawns THIS skill in its Step 3.5 to prove functional/API/config/migration rows before its human table is emitted — one row's steps + expected result in, `Proven (auto)` + `proof_trace` out (UI rows route to `hatch3r-browser-verify` instead).

## Step 1: Read Inputs

- Parse the issue body: validation scope, test matrix, environments, preconditions, pass/fail criteria, evidence requirements.
- Read project user flows documentation for expected behavior.
- Read project quality documentation for DoD, testing pyramid, performance budgets.
- Read project permissions/privacy and security threat model for security test cases.
- Confirm the correct version is deployed to the test environment.
- For external library docs and current best practices, follow the project's tooling hierarchy.

## Step 2: Validation Plan

Before executing, output:

- **Scope:** feature/release being validated
- **Environment:** where tests will run
- **Version:** build/commit being tested
- **Preconditions verified:** checklist
- **Test execution order:** sequence with dependencies
- **Estimated duration:** time estimate

## Step 3: Execute Tests

### 3a. Automated Test Execution

Run the project's automated test suites (unit, integration, E2E) and record results.

### 3b. Browser-Based Validation

For each user-facing test case in the matrix:

1. Confirm the dev server is running by checking the expected port. If not running, start it in the background.
2. Navigate to the page or surface under test using browser automation MCP.
3. Execute the test steps exactly as described — click, type, navigate, trigger state changes.
4. Observe the actual result and compare to the expected result.
5. Capture a screenshot as evidence for each test case result.
6. Check the browser console for errors or warnings after each test case.
7. Mark as **PASS**, **FAIL**, or **BLOCKED** (with reason and screenshot).

For non-UI test cases (API, data integrity, background jobs), use appropriate non-browser verification methods.

Do NOT fix bugs during validation. Document and file issues.

### 3c. UI/UX Verification Gate

For any feature that ships UI, the UI/UX verification gate is **`hatch3r-ui-ux-verify`** (`skills/hatch3r-ui-ux-verify/SKILL.md`). All 9 gates in that skill must pass before declaring the feature done. QA validation alone (browser tests, screenshot evidence) does not constitute UI/UX done. Run `hatch3r-ui-ux-verify` before this report's SHIP recommendation and include its verdict in the report.

## Step 4: Validation Report

Produce a structured report with:

- **Summary:** total/passed/failed/blocked counts, overall result
- **Results table:** test case, priority, result, evidence, notes
- **Regression results:** checks for unaffected flows
- **Security validation:** invariant checks
- **Performance validation:** metric vs budget vs actual
- **Issues found:** severity, description, issue link
- **Recommendation:** SHIP or HOLD with reasons

## Step 5: Follow-Up

- File new issues for bugs discovered during validation.
- If validation fails, state what must be fixed before re-validation.
- Post report as comment on the issue/work item or linked PR/MR (check `platform` in `.hatch3r/hatch.json`).

## Error Handling

- **Test environment unavailable or misconfigured**: Document which tests could not be executed, note the environment gap, and recommend a fix. Do not mark untested scenarios as passing.
- **Validation discovers a blocking defect**: File an issue immediately, mark the validation as HOLD, and include the defect details in the validation report with reproduction steps.
- **Flaky test results (pass on retry)**: Run the test 3 times. If it passes inconsistently, mark it as flaky in the report, file a tracking issue, and exclude it from the pass/fail determination.

## Definition of Done

- [ ] All test cases in the matrix executed
- [ ] Evidence collected for every result
- [ ] Regression checks completed
- [ ] Security and performance validation completed
- [ ] Validation report produced
- [ ] Issues filed for all failures
- [ ] Ship/hold recommendation provided
