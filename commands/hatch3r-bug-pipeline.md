---
id: hatch3r-bug-pipeline
type: command
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer, hatch3r-reviewer, hatch3r-fixer]
description: Run a known-cause bug fix through a 3-phase test-first pipeline -- reproduce + root-cause, regression-test + fix together, then root-cause-depth review -- with full sub-agent delegation.
disable-model-invocation: true
tags: [implementation, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
efficiency_tier: standard
triage_tiers: [1, 2, 3]
supports_resume: true
plan_gate: true
sub_agents_spawned:
  count: 4
  rationale: One researcher (merged reproduce + root-cause), one implementer (regression test + fix authored together, TDD-style), then a reviewer ↔ fixer loop on root-cause depth; the canonical four-phase Final Quality specialists collapse onto the implementer's bundled regression test plus the reviewer's root-cause-depth gate. Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
  task_structure: sequential
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the bug report for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (no reproduction steps, expected-vs-actual behavior unstated, severity unclear, affected environment unknown, or a fix that touches a schema / public API with downstream consumers). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when the bug is single-module, reproduction is known, and the brief alone is testable. Residual ambiguity discovered mid-pipeline invokes the same protocol.

## Agent Pipeline

| Stage | Agent(s) | Parallel | Required |
|-------|----------|----------|----------|
| 1. Reproduce + Root-Cause | `hatch3r-researcher` (modes: `symptom-trace`, `root-cause`; `codebase-impact` for Tier 3) | Per mode | Yes |
| 2. Regression-Test + Fix | `hatch3r-implementer` (failing test first, then minimal fix) | Per independent module | Yes |
| 3. Root-Cause-Depth Review | `hatch3r-reviewer` -> `hatch3r-fixer` (max 3 iterations) | No (sequential) | Yes |

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): every parallel fan-out above holds all three — read-only or disjoint writes (file- and contract-level), deterministic aggregation, no shared mutable state.

# Bug Pipeline — Test-First 3-Phase Fix Delegation

A bug-shaped variant of the four-phase pipeline for the case where the symptom is known and the fix is in hand but the change still needs full delegation rigor. The default four-phase pipeline writes the regression test in Phase 4, *after* the fix already landed; for a bug the regression test should drive the fix. This command compresses the pipeline to the bug's natural shape: **reproduce + root-cause (Phase 1) → regression-test + fix authored together, TDD-style (Phase 2) → root-cause-depth review (Phase 3)**, with security as the primary review lens because regressions frequently sit on a validation or auth edge.

**When to use this command vs. the `hatch3r-bug-fix` skill vs. `hatch3r-bug-plan`:**

- Use `hatch3r-bug-pipeline` when: the root cause is known or strongly hypothesized, a fix is in hand, but the change is nontrivial (multi-file, behavior change, security-adjacent) and must go through delegated implementer + reviewer ↔ fixer rigor rather than inline edits.
- Use the `hatch3r-bug-fix` skill when: the fix is localized and trivial enough for single-pass inline work (single file, clear root cause, low risk).
- Use `hatch3r-bug-plan` when: the root cause is unknown, multiple modules might be involved, or the fix needs multi-PR phasing — that command produces an investigation report, not a fix.

---

## Token-Saving Directives

1. **Do not re-read cached files.** Once researcher output (symptom trace + ranked root cause) is collected, reference it in memory — do not re-invoke.
2. **Targeted reads only.** Read only files on the failure path identified by the researcher.
3. **Structured output only.** Every sub-agent prompt requires structured markdown output — no prose dumps.

---

## Confidence Propagation Contract

Every sub-agent delegation prompt in this command MUST include the confidence expression requirement below (verbatim). Sub-agents are invoked with the `quality_charter: agents/shared/quality-charter.md` reference in their frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per the charter §1 rule.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces fix-readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK, using the platform-native question tool per `agents/shared/user-question-protocol.md`.

## Step 0: Triage

Classify the bug before delegating:

- **Tier 1 (trivial)**: single-file, clear root cause, reproduction known. Route to the `hatch3r-bug-fix` skill and exit — this pipeline's delegation overhead is not warranted.
- **Tier 2 (standard)**: multi-file or behavior-changing fix with a known or strongly-hypothesized root cause. Run the full 3-phase pipeline below.
- **Tier 3 (deep)**: multi-module, security-adjacent, or high blast-radius fix. Run the full pipeline with researcher depth `deep`, the `codebase-impact` mode added in Phase 1, and a user scope confirmation before Phase 2.

If the root cause is genuinely unknown, recommend `hatch3r-bug-plan` (investigation-first) instead and exit.

### Step 0.5: Emit Pre-Execution Cost Preview

Before the first sub-agent dispatch (Step 2), surface the cost preview so a delegated bug fix is never started blind. Emit the `cost_estimate` block per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate, calibrated to the Step 0 triage tier:

```yaml
cost_estimate:
  expected_sa_count: <Tier 1 routes out (0), Tier 2 ~3, Tier 3 ~4>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>      # 0 when no research is needed
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

Post-execution, the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

### Effort Override (Decision 17)

Auto-tiering can misclassify — a single-module bug scored Deep, or a multi-module regression scored Light. The user override is the recovery path mandated by hatch3r's universal `--effort` override contract ("User overridable via `--effort` flag"):

- `--effort=light|standard|deep` forces the named tier, bypassing the Step 0 auto-classification. `--effort=light` routes to the `hatch3r-bug-fix` skill.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the cost estimate block reports the budget delta.
- No override passed → the Step 0 auto-classification stands.

---

### Step 1: Reproduce + Root-Cause (Phase 1)

Spawn `hatch3r-researcher` following the **hatch3r-researcher agent protocol** with the merged reproduce-and-diagnose modes. This single phase replaces the default pipeline's separate research and blast-radius passes — for a bug, "where does it diverge" and "why" are one investigation.

**Modes:** `symptom-trace` (execution path from user action to the divergence point) and `root-cause` (ranked hypotheses with code evidence). For Tier 3, add `codebase-impact` (blast radius across modules + data-integrity risk).

**Depth:** `quick` for Tier 1 (if it was not routed out), `standard` for Tier 2, `deep` for Tier 3.

The researcher prompt MUST include: the bug brief (symptoms, expected behavior, reproduction context, severity, prior attempts), the assigned modes + depth, the **hatch3r-researcher agent protocol** instruction, a `correlation_id` (UUID v4 per `rules/hatch3r-agent-orchestration.md` → Correlation ID), and the confidence expression requirement above.

Apply the **Research Completeness Checklist** (`rules/hatch3r-agent-orchestration.md`) before handing off to Phase 2: affected files identified, blast radius assessed (Tier 3), existing tests located (or absence noted), dependencies mapped. If any item is unconfirmed, re-run the researcher with additional modes or surface to the user.

**ASK:** "Top root-cause hypothesis: {hypothesis} (confidence {high/medium/low}). Reproduction path: {summary}. Proceed to author a failing regression test + fix? (yes / adjust hypothesis / re-run researcher)"

---

### Step 1.5: In-Session Plan Gate (Tier >= 2)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → In-Session Plan Gate. Per-command slots: artifact synthesized from the Step 1 root-cause findings (confirmed hypothesis, reproduction path, affected files, test-first fix order); slug from the bug brief (`docs/plans/{YYYY-MM-DD}-{bug-slug}.md`); gated dispatch = Step 2; revise returns to Step 1.5 synthesis; no unattended flag — non-interactive runs persist the artifact and continue per the frame.

---

### Step 2: Regression-Test + Fix Authored Together (Phase 2)

Spawn `hatch3r-implementer` via the Task tool (`subagent_type: "generalPurpose"`). Unlike the default pipeline — where hatch3r-testability runs in Phase 4 after the fix — this phase authors the failing regression test FIRST, then the minimal fix that makes it pass.

The implementer prompt MUST include the confirmed root cause + reproduction path from Step 1, all `scope: always` rule directives from `rules/`, the `correlation_id`, the confidence expression requirement, an explicit instruction NOT to create branches / commits / PRs, and the following test-first contract (verbatim):

> Test-first contract: (1) Write a regression test that reproduces the exact bug scenario and FAILS against current code with the reported symptom — not a setup error. (2) Confirm the test fails for the right reason. (3) Implement the minimal fix at the root cause; do not refactor unrelated code, do not suppress the symptom (no `eslint-disable`, no `as any`, no `test.skip`). (4) Confirm the regression test now passes and no existing test regressed. (5) Return the failing-then-passing evidence in your structured result.

The implementer also returns the **midpoint research-gap checkpoint** result per `rules/hatch3r-agent-orchestration.md` → Mid-Implementation Research Gap Checkpoint: if the fix touches a file outside the researcher's affected-files set, an undocumented dependency, or confidence drops below medium, log the gap and either request a targeted researcher re-run (blocking) or document the assumption for Phase 3 reviewer attention (non-blocking).

If the fix spans **independent modules** (no shared files), spawn one implementer per module and run them in parallel. **Overlapping files** run sequentially through a single implementer to avoid conflicts.

Await the implementer result. If it reports BLOCKED, **ASK** the user for guidance.

After the implementer returns, run the project quality gates (lint, typecheck, full test suite — see `package.json` scripts). The regression test must pass and the existing suite must stay green before Phase 3.

---

### Step 3: Root-Cause-Depth Review (Phase 3)

Run an iterative review loop — max 3 iterations (code-class cap per `REVIEW_LOOP_CLASS_CAPS` in `src/pipeline/reviewLoop.ts`: a bug-fix diff is a code diff, and code reviews diverge faster because a fix can spawn a regression the next iteration must catch) — until 0 Critical + 0 Warning findings remain. The review lens for a bug fix is **root-cause depth and regression-test validity**, not feature completeness.

1. Spawn `hatch3r-reviewer` via the Task tool. The prompt MUST include the working-tree diff (`git diff`), the confirmed root cause from Step 1, the failing-then-passing test evidence from Step 2, all `scope: always` rule directives, the iteration number + prior findings (if not the first pass), the `correlation_id`, the confidence expression requirement, and a top-level `confidence: high | medium | low` output requirement so the gate can evaluate it deterministically. Focus the reviewer on:
   - **Root-cause depth** — does the fix address the cause or only mask the symptom? Reject suppression patterns (`eslint-disable`, `as any`, `as unknown as`, `@ts-ignore`, `test.skip`, empty catch blocks) per `rules/hatch3r-agent-orchestration.md` → Root-Cause Depth Requirements.
   - **Regression-test validity** — does the test actually fail without the fix and assert the corrected behavior, not an incidental side effect?
   - **Security edge** — regressions frequently sit on a validation, auth, or input-handling boundary; verify the fix does not open one.

2. Process reviewer output:
   - **0 Critical + 0 Warning AND reviewer confidence != low** → review loop clean; proceed to Step 4.
   - **0 Critical + 0 Warning AND reviewer confidence == low** → trigger a second reviewer pass before exiting; do not proceed until it returns non-low confidence OR the user explicitly accepts the low-confidence PASS.
   - **Critical or Warning findings remain** → spawn `hatch3r-fixer` with the full reviewer output + all `scope: always` directives + the confidence expression requirement, then re-run the reviewer (next iteration). After fixes, re-run quality gates.

3. If the code-class cap of 3 iterations completes and findings remain, surface a structured summary (iteration count, remaining Critical findings with file:line, remaining Warnings, fix-manually-vs-accept-risk recommendation) and **ASK** the user whether to proceed or fix manually. Never present raw reviewer output unsummarized.

---

### Step 4: Summary + Git Action

1. Present a concise completion summary:

```
Bug Pipeline Complete:
  Root cause:        {one-line root cause}
  Regression test:   {test name/path — failed before, passes after}
  Files changed:     {file list}
  Quality:           lint {pass/fail}, types {pass/fail}, tests {pass/fail}
  Review:            {N iterations, clean}
  Confidence:        {high/medium/low — overall assessment of fix correctness}
```

2. **ASK:** "All changes complete. Quality gates pass. How should I handle git? (a) commit only, (b) commit and push, (c) skip git — leave changes in working tree"

Commit message format: `fix: {short root-cause-oriented description}`. For pushes, fall back to `git push -u origin {branch}` when no upstream exists.

---

## Resumability (Decision 27/30)

bug-pipeline is multi-phase — a Tier 2/3 run dispatches a researcher (Step 1), one or more implementers authoring regression test + fix (Step 2), and a reviewer ↔ fixer loop (Step 3). Per hatch3r's workspace-checkpointed resumability contract, checkpoint progress so an interrupted run re-enters at the last completed step rather than re-running the researcher or re-implementing a fix that already landed.

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Checkpoint Contract. Per-command slots: workspace `.bug-pipeline-workspace/`; step range the Step 0 → Step 4 progression; `wave` = review-loop iteration index in Step 3; snapshot/rollback paths the working-tree state. Write points: after Step 1 researcher returns and the root-cause ASK is confirmed, after each Step 2 implementer returns per module (so a landed fix + regression test survive a crash), after Step 2 quality gates pass, after each Step 3 review-loop iteration, and after the Step 4 git action.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Per-Turn Pipeline-State Header. Phase mapping for bug-pipeline: `1` = reproduce + root-cause (researcher), `2` = regression-test + fix (implementer), `3` = root-cause-depth review (reviewer ↔ fixer), `4` = summary + git + iteration-summary. Tier 1 runs route out to the `hatch3r-bug-fix` skill and are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → End-of-Turn Delegation Attestation. Per-command mutated-file slot: regression test, fix, fixer changes. This command has no Tier-1 inline carve-out: Tier 1 bugs route to the `hatch3r-bug-fix` skill, so every mutation here flows through a sub-agent.

## Iteration Summary (mandatory output)

Close the run with the recap-contract Iteration Summary per `rules/hatch3r-iteration-summary.md`: a 1–2 line recap (status, outcome, files · sub-agents · gates · cost delta) plus every exception line whose firing condition holds — silence asserts the default. Omitting the recap fails that rule's Validation Gate (CONSTITUTION §6 Decision 37; Replaces: 28).

### Cost Visibility (Decision 29)

> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → Cost Estimate for the 5-field `cost_estimate` schema and the post-execution `cost_actuals` + `delta` contract; the delta figure lands in the Iteration Summary recap (cost facet); full blocks surface on the `Cost:` exception line beyond ±25%, per `rules/hatch3r-cost-visibility.md`.

---

## Error Handling

- **Researcher cannot confirm a root cause:** if all hypotheses are low-confidence, do not author a speculative fix. State the verdict ("Root cause unconfirmed; top hypothesis confidence=low") and recommend switching to `hatch3r-bug-plan` for a full investigation. **ASK** how to proceed.
- **Regression test passes before the fix:** the test does not reproduce the bug. Halt Phase 2, return to Step 1, and re-derive the reproduction path with the researcher — a test that cannot fail proves nothing.
- **Implementer sub-agent failure:** retry once. If the retry fails, present the partial state and **ASK** (provide the missing context manually / route to `hatch3r-bug-plan` / abort).
- **Reviewer flags a superficial fix:** the fixer must address the root cause, not re-suppress the symptom. If the same suppression pattern reappears across two iterations, surface it to the user — do not let it ship.
- **Quality gate failure after fixer:** re-run gates after every fixer pass. After 2 unresolved retries within Step 3, surface the specific failures and **ASK** (fix manually / keep iterating / abort).
- **File write failure:** report the error and provide the full file content so the user can apply it manually.

## Guardrails

- **Never skip the regression test.** A bug fix without a failing-then-passing test is incomplete — the test is the proof the fix works and the guard against recurrence.
- **Never suppress the symptom.** Reject `eslint-disable`, `as any`, `test.skip`, and empty catch blocks as fixes per `rules/hatch3r-agent-orchestration.md` → Root-Cause Depth Requirements.
- **Always delegate code mutation.** All code changes flow through `hatch3r-implementer` (Phase 2) or `hatch3r-fixer` (Phase 3) via the Task tool — no inline edits from the orchestrator turn.
- **Never skip quality gates.** Lint, typecheck, and the full test suite run after Phase 2 and after every fixer pass.
- **Never auto-commit without ASK (Step 4).** The user always decides the git action.
- **Stay within the bug scope.** Do not expand the fix into adjacent refactors or feature work. Flag tangential findings but do not act on them without explicit approval.
- **This command composes existing hatch3r agents** (researcher, implementer, reviewer, fixer) — it does not replace them or the default four-phase pipeline; it is the bug-shaped variant for known-cause, fix-in-hand work.

---

## References

- `commands/hatch3r-bug-plan.md` — sibling investigation-first command (unknown root cause); accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `commands/hatch3r-quick-change.md` — orchestrator command structure + Per-Turn Header / Delegation Attestation / Iteration Summary block patterns mirrored here; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `rules/hatch3r-agent-orchestration.md` — four-phase pipeline definition, Mandatory Delegation Directives, Root-Cause Depth Requirements, Mid-Implementation Research Gap Checkpoint; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- `skills/hatch3r-bug-fix/SKILL.md` — Step 2c test-first (TDD) approach this pipeline promotes to a first-class phase; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
- hatch3r orchestration-domain analysis — source rationale for the bug-fix workflow's natural 3-phase shape; accessed 2026-05-31; trust tier: official-docs (in-repo canonical).
