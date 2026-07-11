---
id: hatch3r-review-loop-cap
type: hook
event: review-loop-cap
agent: reviewer
description: Block fixer-spawn past the configured review-loop iteration ceiling via a `.review-loop.json` checkpoint
tags: [orchestration, floor:security]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: review-loop-cap → review-loop-cap-enforcer

Activate the review-loop-cap-enforcer when the orchestrator attempts to spawn `hatch3r-fixer` after `hatch3r-reviewer` returned non-clean. The hook reads, increments, and gates a per-issue iteration counter so the Phase 3 review-fix loop cannot run unbounded.

This hook specifies the target contract for the F15.2-H1 gap surfaced in cycle 10: the runtime `src/pipeline/reviewLoop.ts` carries `DEFAULT_MAX_REVIEW_ITERATIONS = 4` and `HARD_MAX_REVIEW_ITERATIONS = 10`, but that bound is enforced only inside the reviewer/fixer agent prompts, not at the adapter-emitted hook layer.

> **F15.2-H1 status — re-opened (Cycle-12, D15-SA15.2-01): NOT closed.** The Claude adapter currently maps this hook to the `Stop` event and emits a prompt-level activation announcement (an `echo` of the reviewer-spawn instruction). It does NOT read/increment `.review-loop.json`, count iterations, or emit a non-zero exit, so no infrastructure-level gate exists on any adapter — the iteration cap is prompt-enforced everywhere. The counting circuit breaker described below is the contract this hook MUST drive once `src/adapters/claude.ts` special-cases `review-loop-cap` command construction (mapped to `PostToolUse` + `matcher: "Task"`, per Event Mapping). Until that adapter change lands, this spec states the intended gate, not a shipped runtime guarantee.

## Event Mapping

The neutral event name `review-loop-cap` is the canonical surface. Per-adapter mappings:

- **Claude Code:** `PostToolUse` with `matcher: "Task"` filtered to fixer-spawn invocations — the REQUIRED binding. The `Stop` event is NOT valid for a spawn-blocking gate: per the Claude Code hook docs (https://code.claude.com/docs/en/hooks, accessed 2026-07-10), a `Stop`-hook exit code 2 "prevents Claude from stopping, effectively forcing Claude to continue" — the opposite of halting the spawn — and Claude Code processes stdout JSON only on exit 0, so the structured `{ "outcome": "block", ... }` payload this hook emits is discarded on the exit 2 it prescribes. `Stop` also fires at turn-completion, not at the fixer-spawn boundary, so it cannot gate the mid-turn spawn it targets. The current `Stop` mapping in `src/adapters/claude.ts` is the defect tracked under D15-SA15.2-01 (F15.2-H1 re-opened).
- **Cursor:** no native runtime gate — advisory rule only (parity with GitHub Copilot below). The iteration-count gate needs the orchestrator's per-issue `.review-loop.json` counter context, which no Cursor hook payload carries; Cursor's real pre-tool event is `preToolUse` (NOT `pre-tool-call`), and its payload exposes no agent-identity field (cursor.com/docs/agent/hooks, accessed 2026-06-09), so it cannot bind to a fixer-spawn. Materialized as the `.cursor/rules/hatch3r-hook-hatch3r-review-loop-cap.mdc` advisory rule the Cursor adapter emits for every canonical hook.
- **GitHub Copilot:** no native equivalent — emitted as an advisory rule comment instead of a runtime gate.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Identify the active issue or task ID from orchestrator context. If absent, derive a stable key from the current branch + first changed file path (deterministic hash).
2. Read the per-issue checkpoint at `.hatch3r/review-loop/<issue-key>.review-loop.json`. If the file is absent, create it with `{ "iteration": 0, "createdAt": "<ISO 8601 UTC>", "maxIterations": <configured> }`.
3. Increment `iteration` by 1. Persist via the safe-write temp+rename pattern (`src/merge/safeWrite.ts` semantics) so a crash mid-write leaves the prior counter intact.
4. Compare incremented `iteration` against `maxIterations`:
   - If `iteration <= maxIterations`: emit a structured pass-through with the new counter value and exit 0. Orchestrator proceeds with fixer-spawn.
   - If `iteration > maxIterations`: emit a structured block. Exit 2 (non-zero halts the spawn). Include the issue key, the value of `maxIterations`, the iteration counter that triggered the block, and the next-step recommendation: "Reviewer findings remain after N iterations — escalate to maintainer review or accept current state. Reset via `rm .hatch3r/review-loop/<issue-key>.review-loop.json`."
5. On block, write a one-line audit entry to `.hatch3r/review-loop/audit.log` with timestamp, issue key, hook outcome, and the reviewer's last non-clean verdict if available in context.

## Expected Output

- **Pass-through:** `{ "outcome": "pass", "iteration": <N>, "maxIterations": <M>, "remaining": <M-N> }` written to stdout. Exit 0.
- **Block:** `{ "outcome": "block", "iteration": <N>, "maxIterations": <M>, "reason": "max_iterations_exceeded", "actionable_next_step": "<one sentence>" }` written to stdout. Exit 2.

## Configuration

- **maxIterations:** Default 4 — held in lockstep with `src/pipeline/reviewLoop.ts::DEFAULT_MAX_REVIEW_ITERATIONS`. Override via `maxIterations` in hook config. Clamped to `[MIN_MAX_REVIEW_ITERATIONS, HARD_MAX_REVIEW_ITERATIONS]` = `[1, 10]` per the same module.
- **checkpointDir:** Default `.hatch3r/review-loop/`. Override via `checkpointDir` for projects that namespace `.hatch3r/` differently.
- **resetOnCleanVerdict:** Default `true`. When the reviewer returns a clean verdict, the orchestrator deletes the checkpoint so the next regression-fix run starts fresh. Set `false` to retain historical counters across reviewer passes.

## Failure-Boundary Semantics

The hook itself is a circuit breaker scoped to the fixer-spawn boundary. It does not classify reviewer findings, terminate the review loop on its own authority, or invoke remediation. Its single contract: `iteration > maxIterations` MUST block fixer-spawn, no exception. That contract is the target the `PostToolUse` gate must satisfy; as of Cycle-12 (F15.2-H1 re-opened, D15-SA15.2-01) the Claude adapter has not yet materialized it — it emits a prompt-level activation instead of the counting gate — so on every current adapter the cap is prompt-enforced until the adapter special-case lands. Adapters that cannot emit a non-zero exit at the spawn site (Cursor and GitHub Copilot — see Event Mapping) render this hook as an advisory rule instead of a runtime gate; the README surface for those adapters declares the downgrade.

Cross-reference: `src/pipeline/reviewLoop.ts` (canonical state machine), `agents/hatch3r-implementer.md` → Review Loop Awareness (Phase 3 contract), `rules/hatch3r-agent-orchestration.md` (orchestrator delegation protocol).
