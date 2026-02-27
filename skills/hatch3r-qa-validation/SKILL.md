---
id: hatch3r-qa-validation
description: E2E validation workflow producing a structured pass/fail report with evidence. Use when running QA validation, acceptance testing, verifying releases, or working on QA E2E validation issues.
---
# QA E2E Validation Workflow

## Quick Start

```
Task Progress:
- [ ] Step 1: Read the issue and relevant specs
- [ ] Step 2: Produce a validation plan
- [ ] Step 3: Execute all test cases
- [ ] Step 4: Produce the validation report
- [ ] Step 5: File follow-up issues
```

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

1. Ensure the dev server is running. If not, start it in the background.
2. Navigate to the page or surface under test using browser automation MCP.
3. Execute the test steps exactly as described — click, type, navigate, trigger state changes.
4. Observe the actual result and compare to the expected result.
5. Capture a screenshot as evidence for each test case result.
6. Check the browser console for errors or warnings after each test case.
7. Mark as **PASS**, **FAIL**, or **BLOCKED** (with reason and screenshot).

For non-UI test cases (API, data integrity, background jobs), use appropriate non-browser verification methods.

Do NOT fix bugs during validation. Document and file issues.

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
- Post report as comment on the issue or linked PR.

## Definition of Done

- [ ] All test cases in the matrix executed
- [ ] Evidence collected for every result
- [ ] Regression checks completed
- [ ] Security and performance validation completed
- [ ] Validation report produced
- [ ] Issues filed for all failures
- [ ] Ship/hold recommendation provided
