---
id: hatch3r-rework-modes
type: command
description: Auto-advance mode, safety guardrails, error handling, and session report for rework. Covers --auto unattended planning, never-skip rules, platform-aware error recovery, and end-of-session summary.
tags: [planning, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Rework — Modes, Guardrails, and Error Handling

Supplementary protocols for `hatch3r-rework`. Referenced from the core command file.

---

## Auto-Advance Mode

When invoked with `--auto`, rework produces an **unattended plan** — reduced human checkpoints for sustained autonomous operation (e.g., CI integration, scheduled post-implementation sweeps). The output contract is unchanged: a rework plan plus the execution prompt; auto mode never adds commit semantics.

### Behavior Changes in Auto Mode

| Checkpoint | Normal Mode | Auto Mode |
|-----------|-------------|-----------|
| Step 2 context validation | ASK user | Auto-proceed when PR + linked issues found. If no PR found, fall back to normal mode for this step |
| Step 3 user interview | ASK user for feedback | Skip interview. Work from the proactive leftover scan (Step 4) only — scan-only findings |
| Step 5b routing approval | ASK user to confirm routing | Auto-accept suggested routing heuristics |
| Step 6b below-floor ASK | ASK user (mark for review vs narrow the plan) | Auto-select "mark for review" — below-floor findings enter the plan flagged for human review |
| Step 7 plan-write confirm | ASK user before writing the plan document | Write the plan without the confirm ASK (plan-lint still gates the write) |
| Step 9 plan readiness | ASK user on NOT READY | Auto-close with the verdict recorded; remaining items listed in the session report |

### Safety Guardrails (Never Skipped)

These checkpoints are NEVER skipped, even in auto mode:

- **Critical findings** default to [REVISE]. Auto mode never auto-defers a Critical finding; when routing pressure would defer one, it stays in the plan and the session report flags it
- **Critical Deferral Protocol** still applies to any deferral of a Critical finding — auto mode cannot supply the required written rationale, so it never defers Criticals
- **Plan-lint** (every finding: expected behavior + testable criterion) gates the plan write in every mode
- **Proactive leftover scan** (Step 4) always runs. This is the primary input in auto mode since the user interview is skipped
- **No commit semantics.** Auto mode writes the plan document and todo.md deferrals only — no `git add`, no `git commit`, no `git push`

### Activation

```
/hatch3r rework --auto
```

### Session Report

At the end of an auto session (or any session when `--auto` is active), generate a summary:

```
Rework Session Report:
  Findings: {N} total ({critical}/{important}/{cleanup}/{cosmetic})
  Validated: {N} (reviewer confidence: {high/medium/low})
  Planned: {N} (docs/rework/{YYYY-MM-DD}-{branch-slug}.md)
  Deferred: {M} (written to todo.md)
  Flagged for human review: {K}
  Validation agents spawned: {list}
  Learnings captured: {count}
  Overall plan confidence: {high/medium/low}
```

---

## Review-Only Mode (D13-SA13.1-F2)

When invoked with `--review-only`, rework becomes a **read-only code-review surface**: it runs the reviewer against the change set and emits the structured review report in chat, but writes nothing — no plan document, no todo.md deferrals, no learnings write. This is the standalone "review this code, no changes" entry that fills development-workflow activity (3) Code review — the default rework flow writes planning artifacts (plan document, todo.md), and `hatch3r-pr-resolve` mutates code; `--review-only` is the surface that does neither.

### Behavior Changes in Review-Only Mode

| Step | Normal Mode | Review-Only Mode |
|------|-------------|------------------|
| Step 1 Context Reconstruction | Run | Run (diff scope is the review target) |
| Step 2 Context validation | ASK user | ASK user (confirm review target only) |
| Step 3 User feedback interview | ASK user for feedback | Skip — the agent is the reviewer, not the interviewer |
| Step 4 Proactive leftover scan | Run | Run (read-only; findings feed the report, not a plan) |
| Step 5 Findings consolidation + routing | Suggest REVISE / DEFER | Consolidate into the report; no routing (nothing is planned) |
| Step 6 Plan validation & enrichment | Researcher (Tier 2/3) + reviewer validation pass (+ below-floor second pass) | **Single `hatch3r-reviewer` pass only** — no researcher enrichment, no second pass |
| Step 7 Write the rework plan | Plan-lint + confirm ASK + plan write | **Skipped** — no plan document is written |
| Step 8 Board housekeeping | PR note + todo.md deferrals + dashboard refresh | **Skipped** — no PR note, no todo.md write, no board mutation |
| Step 9 Plan readiness | Readiness verdict + terminal block | Emit the review report (see below); no `## Execute This Plan` block |
| Step 10 Capture learnings | Write `.hatch3r/learnings/` | **Skipped** — no learnings file written |

The single reviewer pass still carries the Confidence Propagation Contract: the reviewer's high/medium/low confidence is surfaced verbatim in the report. The `--confidence-floor` knob is inert in review-only mode (it gates the second validation pass before a plan write, and no plan is written); state that in the report header rather than silently dropping it. `--review-only` and `--auto` are independent — `--auto` only relaxes ASK checkpoints, so `--review-only --auto` runs the read-only review with Step 2 auto-proceeding when a PR + linked issues are found.

### Activation

```
/hatch3r rework --review-only
```

### Review Report

In place of the Step 9 plan-readiness assessment, emit a read-only report:

```
Review-Only Report:
  Branch: {branch}
  Diff: {files_changed} files changed (+{additions} / -{deletions})
  Reviewer confidence: {high/medium/low}
  Confidence floor: inert (review-only — no plan write to gate)
  Critical ({n}): {finding} — {file:line}
  Warning ({n}):  {finding} — {file:line}
  Suggestion ({n}): {finding} — {file:line}
  No changes were made. Run /hatch3r rework (without --review-only) to produce a rework plan.
```

---

## Error Handling

> Platform-specific CLI commands: see `commands/board/shared-{platform}.md` for fallback chains

- **Git diff failure**: If `git diff` fails (e.g., no commits on branch, detached HEAD), **ASK** the user for the correct branch or base ref.
- **No changes detected**: If the diff is empty, inform the user and exit. There is nothing to plan rework for.
- **PR/issue fetch failure**: Retry once using the platform CLI. If retry fails, proceed without PR/issue context. Work from the diff alone. Warn the user that acceptance criteria are unavailable.
- **Researcher failure (Step 6.pre)**: Retry once. If it fails again, proceed without enrichment and warn the user that the plan's suggested-approach column lacks reference conventions.
- **Reviewer failure (Step 6a)**: Retry once. If it fails again, **ASK** the user: write the plan with every finding marked `unvalidated`, or abort. Never fall back to skipping validation silently.
- **Plan write failure**: Report the error and print the full plan document in chat so the user can save it manually.
- **Context degradation**: per the canonical Context-Degradation Policy (`rules/hatch3r-agent-orchestration-detail.md` -> Context-Degradation Policy) — compress at `>50%` context window, restart at `>75%` (the coarse turn-count fallback is ~25 turns). The rework command is designed for fresh contexts — at the restart threshold, suggest a fresh chat with a progress summary; it can be re-run.
- **Board sync failure** (when board context exists): Warn and continue. Board sync is advisory in rework — it does not block the plan write.

---

## Guardrails

- **Never skip ASK checkpoints** (unless auto-advance mode is active for that specific checkpoint).
- **Never skip the proactive scan (Step 4)** — even if the user reports no issues. Agents leave leftovers.
- **Never skip plan-lint (Step 7)** — a finding without an expected behavior and a testable criterion goes back to the user, never silently into the plan.
- **Never commit or push; the run ends at the rework plan + execution prompt.** The plan document stays uncommitted in the working tree — the execution session commits it together with the fixes. No `git add`, `git commit`, or `git push` in any mode.
- **Stay within the rework scope.** Plan what was reported and what the scan found. Do not expand the plan into unrelated refactors or new features.
- **Respect the original implementation's architecture.** If the architecture itself is flawed, record it as a finding with a suggested separate-refactor route — the plan does not prescribe a restructure.
- **Read-only sub-agents only.** This command composes `hatch3r-researcher` and `hatch3r-reviewer` — no implementer, lint-fixer, or fixer spawn. A spawn of any code-mutating agent is out of contract for this command.
- **Critical findings default to [REVISE].** If the user overrides this, execute the Critical Deferral Protocol (Step 5b): structured warning with specific risk, require written rationale, record in todo.md with `Critical-deferred` tag, and flag for elevated triage in board-fill. The user is never blocked — rationale adds accountability, not a veto.
- **Deferred findings go to `todo.md`, not directly to GitHub/GitLab/Azure DevOps issues.** The board-fill pipeline handles triage, epic creation, dependency analysis, and readiness assessment. Rework does not shortcut this process.
- **Always format deferred items as a single epic block** in `todo.md`, regardless of count. This groups them together during the next board-fill run.
