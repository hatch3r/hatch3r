---
id: shared-confidence-gate
type: reference
description: Canonical confidence-aware review-loop gate, including the three --confidence-floor branches (any/medium/high). Referenced by every command whose Stage-1 review loop evaluates reviewer confidence, so the floor the core orchestrators pass in is honored at the gate that runs it.
tags: [shared, p2, floor:protocol]
cache_friendly: true
---

## Confidence-Aware Review Gate

> Last updated: 2026-06-09

This is the canonical body of the Stage-1 review-loop gate that closes the reviewer ↔ fixer loop. It is the runtime twin of `evaluateReviewGate` in `src/pipeline/reviewLoop.ts` (the same decision matrix tested at `src/__tests__/pipeline/reviewLoop.test.ts` → "D13-3: confidence floor"). Consuming command sub-files (`commands/board/pickup-delegation.md`, `commands/board/pickup-delegation-multi.md`, `commands/revision/revision-quality.md`) cite this file via a one-line pointer so the floor logic lives in one place rather than re-stated per sub-file (D13-SA13.3-F3, single-source-of-truth per CONSTITUTION §2 P4).

### Inputs the gate evaluates

1. **Severity counts** — Critical / Warning / Suggestion from the latest `hatch3r-reviewer` pass.
2. **Reviewer confidence** — the top-level `confidence: high | medium | low` field the reviewer emits (per the Confidence Propagation Contract; an absent or unparseable value is treated as `low`, never as a pass).
3. **Confidence floor** — the resolved `--confidence-floor` value (`any` | `medium` | `high`), passed in verbatim by the core orchestrator (`commands/hatch3r-board-pickup.md` → Confidence Floor; `commands/hatch3r-revision.md` → Confidence Floor). Default `any`.
4. **Iteration budget** — iterations remaining against the code-class cap (`DEFAULT_MAX_REVIEW_ITERATIONS` floor of 3).

### Decision (apply in order)

1. **Critical or Warning present →** spawn `hatch3r-fixer`, re-review (next iteration). The floor never relaxes this fail gate.
2. **0 Critical + 0 Warning →** evaluate the confidence floor:
   - **`any`** (default): pass when reviewer confidence is `high` or `medium`. Force a second reviewer pass when confidence is `low` (or absent/unparseable).
   - **`medium`**: same pass surface as `any` — `high`/`medium` pass, `low` forces a second pass — but the gate records that it evaluated under floor `medium`.
   - **`high`**: `medium` no longer passes. Force a second pass when confidence is anything other than `high` (i.e. `medium`, `low`, or absent), AND surface every `low`-confidence finding to the user via the platform-native ASK regardless of severity.
3. **Below-floor with iteration budget remaining →** run the forced second pass; do not exit the loop. The second pass should route to a different model class when one is available (`rules/hatch3r-reviewer-calibration.md` → Action).
4. **Below-floor with no iteration budget remaining →** escalate: **ASK** the user. Do not exit clean. The user may explicitly accept the below-floor PASS, or direct another fix.

After each reviewer iteration, if the reviewer rates any individual finding as `low`-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings — independent of the floor decision above.

### Floor-tier summary

| Floor | `high` | `medium` | `low` / absent |
|-------|--------|----------|----------------|
| `any` (default) | pass | pass | second pass |
| `medium` | pass | pass | second pass |
| `high` | pass | second pass | second pass + ASK |

The `medium` and `high` columns are the floor-tightening branches the core orchestrators document; the gate that runs the loop honors them here rather than collapsing every floor to the `any` row.
