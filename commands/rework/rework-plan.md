---
id: hatch3r-rework-plan
type: command
description: Rework-plan companion for rework Steps 6-7. Covers the reviewer validation-pass prompt contract, the confidence-floor consumption, the rework plan document format, and the plan-lint assertions that gate the write.
tags: [planning, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Rework — Validation Pass and Plan Format (Steps 6–7)

Validation and plan-format details for `hatch3r-rework`. Referenced from the core command file. Everything in this file is read-only with respect to code: the reviewer verifies findings, and the orchestrator writes exactly one planning artifact (the plan document). No fixer, implementer, or lint-fixer is spawned on this path.

---

## Validation-Pass Prompt Contract (Step 6a)

Spawn ONE `hatch3r-reviewer` sub-agent via the Task tool (`subagent_type: "generalPurpose"`). The prompt MUST include:

1. **Diff** — the cached branch diff from Step 1 (single diff computation; do not recompute).
2. **Findings** — the consolidated [REVISE] findings list from Step 5, each with description, severity, and claimed file:line.
3. **`scope: always` rules** — all `scope: always` rule directives from `rules/` (sub-agents do not inherit rules automatically).
4. **`correlation_id`** — UUID v4 generated per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID; the sub-agent echoes it in logs, outputs, and status reports for cross-phase attribution.
5. **Confidence expression requirement** (verbatim from the core command's Confidence Propagation Contract): rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

**When Tier 2/3 research was performed (Step 6.pre):** also include the researcher output — reference conventions from `similar-implementation`, blast radius data from `codebase-impact` (Tier 3) — so the reviewer can judge whether each finding's suggested approach fits established patterns and which consumers a fix would touch.

**Validation instruction (verbatim in the prompt):** "You are validating findings for a rework plan, not fixing code. For each finding: (1) verify it against the current code and confirm or correct the file:line; (2) state the expected behavior a fix must produce; (3) rate your confidence high/medium/low; (4) list any defect visible in the diff that the findings list misses. Mutate nothing. Return a structured result with a top-level `confidence: high | medium | low` field."

The top-level `confidence` field is required — the Step 6b floor gate evaluates it deterministically, and an absent or unparseable value is treated as `low`, never as a pass (matching `agents/shared/confidence-gate.md` input 2).

## Confidence-Floor Consumption (Step 6b)

The resolved `--confidence-floor` (`any` | `medium` | `high`), routed here from `hatch3r-rework` → Confidence Floor, is evaluated against the reviewer's top-level validation confidence using the floor branches of the canonical **Confidence-Aware Review Gate** (`agents/shared/confidence-gate.md`) — with one structural difference: **this command has no fixer branch.** Critical/Warning-severity validation results do not spawn `hatch3r-fixer`; they become plan findings. The gate's only actions here are:

- **At/above floor** → proceed to plan-lint and the Step 7 write.
- **Below floor** → run ONE second reviewer pass (different model class when available, per `rules/hatch3r-reviewer-calibration.md` → Action) before the plan write.
- **Still below floor after the second pass** → **ASK** the user: write the plan with below-floor findings marked for human review, or narrow the plan to high-confidence findings only.
- **Floor `high` extra:** every finding the reviewer rates low-confidence is surfaced to the user via ASK before it enters the plan, regardless of the top-level verdict.

---

## Rework Plan Document Format (Step 7)

Path: `docs/rework/{YYYY-MM-DD}-{branch-slug}.md` — `{branch-slug}` is the current branch name lowercased with `/` and non-alphanumerics collapsed to `-`. One plan per rework session; a re-run on the same branch and date overwrites after an ASK.

```markdown
# Rework Plan — {branch} ({YYYY-MM-DD})

## Run Context
- Branch: {branch}
- PR: #{N} — {title} ({url}) | none
- Linked issues: #{N} {title}, ... | none
- Acceptance criteria: {inherited criteria from linked issues, or "none found"}
- Validation: {N} findings validated by hatch3r-reviewer on {YYYY-MM-DD}; top-level confidence {high/medium/low}

## Findings
| ID | Severity | Location | Expected behavior | Suggested approach | Confidence |
|----|----------|----------|-------------------|--------------------|------------|
| RW-1 | Critical | {file}:{line} | {what a correct implementation does} | {approach; reference conventions from research when available} | high/medium/low |
| RW-2 | ... | | | | |

## Implementation Order
1. RW-{n} — {one-line reason, e.g. "unblocks RW-3's contract change"}
2. ...

## Acceptance Criteria
### RW-1
- [ ] {testable criterion — command, observable behavior, or test name}
- [ ] ...

## Deferred Items
{M} findings deferred to todo.md ("# Follow-ups from ... rework ({date})" epic block) — triage via /hatch3r-board-fill; do not re-plan them in the execution session.
```

Severity vocabulary matches the Step 5 triage (Critical / Important / Cleanup / Cosmetic). The `Location` column carries the Step 6a-validated file:line; a Tier 1 run that skipped Step 6 marks each location `({file}:{line}, unvalidated)`.

## Plan-Lint (gate before the Step 7 write)

Assert every one of these on the assembled document; a failing finding goes back to the user (sharpen or defer) — it never enters the plan silently:

1. Every findings-table row has a non-empty **Expected behavior** cell (a "what correct looks like" statement, not a restatement of the defect).
2. Every finding has **at least one testable acceptance criterion** under `## Acceptance Criteria` (a command to run, an observable behavior, or a named test).
3. Every **Location** was confirmed or corrected by the Step 6a validation pass, or carries the explicit `unvalidated` marker (Tier 1 only).
4. Every finding carries a **Confidence** rating sourced from the reviewer (Confidence Propagation Contract — the orchestrator never invents one).
5. `## Implementation Order` covers every [REVISE] finding exactly once.
6. `## Deferred Items` states the deferred count and the todo.md pointer when Step 5c filed deferrals (or states "none" when it did not).
7. The document contains no instruction to commit, push, or open a PR — execution-session mechanics live in `hatch3r-workflow`, not in the plan.
