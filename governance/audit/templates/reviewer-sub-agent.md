# Reviewer Sub-Agent Template

> Last updated: 2026-04-21

**Pillars served:** P2 (primary), P5 (supporting).

## Task

You are the final quality gate for a wave-based audit execution run. All
implementation waves have completed (or execution was halted). Your job is to
perform a comprehensive 5-pass review and produce a structured verdict.

## Pass 0: Completeness Verification

1. Obtain the Finding Registry from the orchestrator.
2. Count findings by disposition:
   - targeted: [N]
   - excluded: [N]
   - human_only: [N]
   - deferred: [N]
   - already_resolved: [N]

3. Verify ALL `targeted` findings have a terminal execution status
   (no `pending` or `in_progress` remaining):
   - done: [N]
   - partial: [N]
   - failed: [N]
   - rolled_back: [N]
   - never_attempted: [N]
   - ORPHANED (still pending): [N] — MUST be 0

4. Compute coverage rate:
   coverage = (done + partial) / targeted × 100

5. Verify every failed, rolled-back, or never-attempted finding has a
   documented reason in the registry.

Pass 0 Result: PASS if orphaned = 0 and all non-terminal findings have reasons.
               FAIL if any findings are unaccounted for.

## Pass 1: Functional Verification

Run the four verification commands and report results against baseline:

| Test | Command | Expected | Baseline behavior |
|------|---------|----------|-------------------|
| Unit + integration | `npm test` | 0 failures, coverage thresholds met | Re-run if any new test introduced; compare against Phase 0 baseline if available |
| Type-check | `npx tsc --noEmit` | 0 type errors | Compare error count against Phase 0 baseline; new errors → BLOCK |
| Lint | `npm run lint` | 0 errors, ≤Phase 0 warning count | New warnings allowed only if explicitly justified in commit |
| Build | `npm run build` | 0 build errors, dist/ size within ±5% of baseline | Bundle size increase >5% → flag |

Then review the full git diff (all changes from BASELINE_COMMIT to HEAD):
- Each change matches its finding's recommendation
- No unrelated code modified
- No dead code, debug logging, or TODO comments left behind
- Changes follow project conventions

## Pass 1.5: Fix-to-Finding Alignment

Verify that each implementation actually addresses its specific finding, not just a related area.

For each finding with execution_status = "done":

1. Read the finding's specific recommendation from the Enhanced Action Items table.
2. Read the actual change in the git diff for this finding's commit.
3. Verify the change addresses the **specific** recommendation — not just a related area of the same file or module.
4. Check that the **root cause** identified in the finding is addressed, not just the surface symptom. A finding about "missing error strategy" should not be resolved by adding a single try-catch.
5. If the change diverges from the recommendation but achieves the same goal through a demonstrably better approach, mark as **PASS** with a note explaining the alternative approach.
6. If the change addresses a related but different issue than what the finding specified, reclassify as **PARTIAL**.

7. **Confidence verification.** Compare the finding's `confidence` field (from the rigor schema header per [rigor-contract.md](rigor-contract.md)) against the strength of the implemented evidence. If the implementation surfaced new evidence that strengthens or weakens confidence, update the registry entry's `confidence` field accordingly. Mismatched confidence ≠ a fix-to-finding failure on its own, but it is logged for the next audit cycle's calibration check.

Add a `fix_alignment` column to the Per-Finding Verdict table: ALIGNED / DIVERGENT / BETTER-ALTERNATIVE.

## Pass 2: Security Verification

1. Review all changes for security implications:
   - No new attack surfaces introduced
   - Security fixes from Wave 1 are complete and correct
   - No credential-like strings in code or config
   - No path traversal vulnerabilities
   - Input validation present where needed

2. Cross-reference against Domain 15 findings:
   - Were all security findings addressed with a concrete diff that closes the cited attack surface?
   - Did any implementation introduce new security concerns?

## Pass 2.5: Adversarial Verification

Actively attempt to break each implementation. Do not just verify that changes compile and pass tests — verify they handle real-world failure conditions.

For each substantive code change (skip documentation-only and comment-only changes):

1. **Null/empty inputs** — What happens with empty strings, null values, undefined parameters, or zero-length arrays passed to modified functions?
2. **Boundary conditions** — Maximum length strings, deeply nested structures, very large or very small numeric values at the boundaries of modified logic.
3. **Missing prerequisites** — What if files, MCP servers, environment variables, network endpoints, or API keys referenced by the modified code are unavailable?
4. **Concurrent access** — Could two agents, processes, or users trigger this code path simultaneously? Are there race conditions in file writes or state mutations?
5. **Malformed data** — Invalid JSON, corrupt YAML frontmatter, missing required fields, unexpected data types in inputs to modified functions.

For content changes (agents, rules, skills, commands):

6. **Instruction conflict** — Does the modified content contradict other content artifacts that may be loaded simultaneously?
7. **Missing context** — Does the modified content assume information that may not be available in all execution contexts?

Flag any implementation that handles only the happy path as **PARTIAL** with specific failure scenarios documented.

## Pass 3: Cross-Wave Consistency

1. Verify Wave 1 changes not broken by later waves:
   - Critical fixes still intact after Medium/Low wave changes
   - No regression in security hardening from Wave 1

2. Verify wave commits are internally consistent:
   - Each wave's changes are coherent
   - No partial implementations spanning waves

3. Verify dependency ordering was respected:
   - Findings with `Depends On` were implemented in the correct order

## Pass 4: Domain Health Score Validation

1. Independently recalculate domain health scores:
   - For each domain, count resolved vs remaining findings
   - Apply the diminishing returns formula
   - Compare against the wave-by-wave re-scores from Phase 4

2. Verify overall weighted score calculation:
   - Apply domain weights (Critical 3x, Important 2x, Supporting 1x)
   - Calculate weighted overall score
   - Determine score band

## Output

### Test Results
- Total: X | Passed: X | Failed: X | Skipped: X
- Typecheck: PASS/FAIL (N errors, N new)
- Lint: PASS/FAIL (N errors, N new)
- Build: PASS/FAIL

### Per-Wave Summary

| Wave | Findings | Resolved | Partial | Failed | Rolled Back |
|------|----------|----------|---------|--------|-------------|
| 1    | N        | N        | N       | N      | N           |
| 2    | N        | N        | N       | N      | N           |
| 3    | N        | N        | N       | N      | N           |
| 4    | N        | N        | N       | N      | N           |

### Per-Finding Verdict

| Finding ID | Wave | Status      | Notes                          |
|------------|------|-------------|--------------------------------|
| [ID]       | 1    | PASS        | Implemented as recommended     |
| [ID]       | 1    | PARTIAL     | [What's missing]               |
| [ID]       | 2    | FAIL        | [What went wrong]              |
| [ID]       | 3    | REGRESSION  | [What broke]                   |
| [ID]       | 2    | ROLLED-BACK | [Why rolled back]              |

### Regressions
[List any new failures introduced by the implementation, grouped by wave]

### Security Assessment
[Summary of Pass 2 findings]

### Domain Health Score Re-Evaluation

| Domain | Baseline | Final  | Delta | Findings Resolved | Findings Remaining |
|--------|----------|--------|-------|-------------------|-------------------|
| D1     | X/100    | Y/100  | +/-N  | count             | count             |
| D2     | X/100    | Y/100  | +/-N  | count             | count             |
| ...    | ...      | ...    | ...   | ...               | ...               |
| D18    | X/100    | Y/100  | +/-N  | count             | count             |

### Overall Weighted Score
- Previous: X/100
- Current: Y/100
- Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]

### Recommendation
[SHIP / FIX-AND-SHIP / PARTIAL-SHIP / BLOCK]

See `governance/AUDIT-EXECUTE.md` §SHIP Gate for the 4-verdict criteria matrix.
- SHIP: Pass 0 = PASS; all targeted terminal-status `done`; all gates PASS; zero `failed`/`rolled_back`.
- FIX-AND-SHIP: Pass 0 = PASS; ≥1 `partial` but zero `failed`/`rolled_back`; Cycle N+1 rollover entries recorded; all gates PASS.
- PARTIAL-SHIP: Pass 0 = PASS; cycle is explicitly user-scoped partial (e.g., subset of rolled-over findings); remainder documented in rollover umbrella finding; all gates PASS.
- BLOCK: Pass 0 = FAIL OR undocumented `failed` OR any gate FAIL.

### Completeness Summary (Pass 0)
- Targeted findings: [N]
- Coverage rate: [X]%
- Orphaned findings: [N] (must be 0 for SHIP)
- Never-attempted: [N] (must be acknowledged in rationale)

[Detailed rationale for the recommendation]
