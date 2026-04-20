---
id: hatch3r-revision-quality
type: command
description: Quality verification pipeline for revision Step 7. Covers review loop (Stage 1), final quality with conditional specialists (Stage 2), and failure handling.
tags: [implementation, team]
quality_charter: agents/shared/quality-charter.md
---
# Revision — Quality Verification (Step 7)

Quality pipeline for `hatch3r-revision`. Referenced from the core command file.

Run the project's quality checks after fix implementation. Refer to `package.json` scripts, `README.md`, or `AGENTS.md` for the appropriate commands.

---

## 7a. Run Quality Gates

1. Lint check (e.g., `npm run lint`)
2. Type check (e.g., `npm run typecheck`)
3. Test suite (e.g., `npm run test`)

---

## 7b. Verify User-Reported Issues

Walk through each critical and important finding from Step 5. Verify it is addressed by the changes made in Step 6. If acceptance criteria exist from linked issues, verify each criterion.

For each verified finding and acceptance criterion, rate verification confidence: high (fix confirmed via tests or direct observation), medium (code change addresses the issue but edge cases not independently tested), low (fix applied but uncertain of completeness).

---

## Stage 1: Review Loop (Sequential)

Run an iterative review loop (max 3 iterations) until 0 Critical + 0 Warning findings remain:

1. Spawn `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`).

The reviewer prompt MUST include:
- The diff of all changes made (use `git diff` on the working tree).
- All `scope: always` rule directives from `.agents/rules/`.
- Iteration number and previous findings (if not the first iteration).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

**When Tier 2/3 research was performed** (from Step 6.pre):
- Include blast radius data so the reviewer can verify fixes preserve dependent consumers and contracts.
- Include reference conventions so the reviewer can verify fixes follow established patterns.

2. Process reviewer output (confidence-aware gate):
   - If **0 Critical + 0 Warning AND reviewer confidence != low:** review loop is clean. Proceed to Stage 2.
   - If **0 Critical + 0 Warning AND reviewer confidence == low:** trigger a second reviewer pass before exiting. Do not proceed to Stage 2 until the second pass returns non-low confidence OR the user explicitly accepts the low-confidence PASS.
   - If Critical or Warning findings remain: spawn `hatch3r-fixer` sub-agent to address them. When fixes touch shared or public interfaces, include blast radius data and reference conventions in the fixer prompt. Then re-run the reviewer (next iteration).

3. If 3 iterations complete and findings remain, **ASK** the user whether to proceed or fix manually.

After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings. The reviewer sub-agent output MUST include a top-level `confidence: high | medium | low` field (not just per-finding) so the gate in step 2 can evaluate it deterministically.

4. After any fixes, re-run quality gates (7a) to verify nothing broke.

---

## Stage 2: Final Quality (Parallel)

After the review loop is clean, spawn specialist agents in parallel via the Task tool.

### Always Spawn (Mandatory for Code Changes)

- **`hatch3r-test-writer`** — write or update tests for code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
- **`hatch3r-security-auditor`** — security review of code changes. Audit data flows, access control, input validation, and secret management.

### Always Evaluate (Spawn When Applicable)

- **`hatch3r-docs-writer`** — spawn when revision fixes affect public APIs, architectural patterns, or user-facing behavior. Skip silently when no documentation impact is detected (no API signature changes, no UX behavioral changes, no new configuration options).

### Conditional Specialists (Spawn When Triggered)

- **`hatch3r-lint-fixer`** — spawn when lint errors are present after fix implementation (Step 6 lint-fixer may have missed errors introduced by other sub-agents).
- **`hatch3r-a11y-auditor`** — spawn when the diff includes UI component changes (`area:ui` or `area:a11y` label on linked issues, or component/style files in the diff).
- **`hatch3r-perf-profiler`** — spawn when the diff includes hot-path changes (`area:performance` label on linked issues, or changes to database queries, API handlers, rendering loops).

### Specialist Prompt Requirements

Each specialist sub-agent prompt MUST include:
- The agent protocol to follow (e.g., "Follow the hatch3r-test-writer agent protocol").
- All `scope: always` rule directives from `.agents/rules/` (sub-agents do not inherit rules automatically).
- The diff or file changes to review.
- The linked issue's acceptance criteria (if available).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Await all specialist sub-agents. Apply their feedback (fixes, additional tests, documentation updates). Re-run quality gates (7a) if changes were made.

---

## 7e. Handle Failures

- If quality checks fail: identify the specific failures, fix them directly (for simple issues) or loop back to Step 6 with specific failures.
- Max 2 retry loops on quality check failures. After 2 retries, **ASK** the user for guidance: "Quality checks still failing. Fix confidence: {high/medium/low — based on whether root cause is identified}."
- If a user-reported issue was not fully addressed: **ASK** the user whether to attempt another fix or defer.
