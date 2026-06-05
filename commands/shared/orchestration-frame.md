---
id: hatch3r-orchestration-frame
type: shared-context
description: Single source of truth for cross-cutting orchestrator-command boilerplate — checkpoint contract, cost-estimate block, and Per-Turn Pipeline-State Header. Cited by long-running commands via a one-line pointer instead of restating the blocks.
tags: [orchestration, reference]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---

# Orchestration Frame (shared command boilerplate)

> Last updated: 2026-06-05
> Pillars: P4 (Lean Coverage, primary — kills the ~30-file restatement of these three blocks), P7 (Speed & Token Efficiency, supporting — static cacheable frame).

Three cross-cutting blocks recur near-verbatim across the long-running `commands/hatch3r-*.md` orchestrators (checkpoint contract ×28, Per-Turn Pipeline-State Header ×29, `cost_estimate` block ×30 at Cycle-11 measurement). This file is their single source of truth. A command cites the block it needs with a one-line pointer and supplies only its per-command slots (workspace directory, step range, doc directories, phase mapping). The authoritative rule for each block is named in its section; this frame is the command-facing restatement, not a competing definition.

Citation template (drop into the command where the block used to live):

```
> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → {Checkpoint Contract | Cost Estimate | Per-Turn Pipeline-State Header}. Per-command slots: <workspace-dir>, <step-range>, <doc-dirs>, <phase-mapping>.
```

`<…>` slots below are the only text a command varies; everything outside them is invariant and lives here.

---

## Checkpoint Contract

Authoritative module: `src/pipeline/checkpoint.ts`. Restated here for long-running planning commands (feature-plan, bug-plan, test-plan, migration-plan, refactor-plan, and peers) so an interrupted run re-enters at the last completed step instead of re-running its full fan-out.

1. **Workspace + file:** write `<workspace-dir>/checkpoint.json` via `writeCheckpoint()` (atomic temp+rename through `src/merge/safeWrite.ts`; a SIGKILL mid-write leaves the prior checkpoint or no file, never a partial record). Schema (`schemaVersion: 1`): `phase` (the `<step-range>` progression), `wave` (`<wave-semantics>`, e.g. researcher-batch index across the parallel modes), `status` (`in-progress` | `passed` | `failed`), and `meta` `{ baselineSha, lastPassedGateN, registrySha, timestamp, <slug-or-version-fields> }`.
2. **Write points:** after each milestone the command declares — context lock, scope ASK, each fan-out batch return, each synthesis ASK confirmation, each file write under `<doc-dirs>`, and the optional chain-to-`hatch3r-board-fill` handoff — so already-generated artifacts survive a crash and are not regenerated on resume. Commands list their own ordered write points.
3. **`--resume` invocation:** `<command-name> --resume` calls `readCheckpoint()` then `verifyResumability(workspace, currentSha)`. Baseline drift fails closed (the repo or any path under `<doc-dirs>` / `todo.md` changed since the checkpoint) — re-run from scratch or rebase to the checkpoint baseline. A `failed` status halts for operator triage before resuming.
4. **Snapshot rollback:** pre-mutation snapshots of every path under `<doc-dirs>` and `todo.md` land in `.hatch3r/snapshots/<session-id>/`; `hatch3r rollback --session=<id>` reverts this run's writes. Diff preview precedes every file write per Decision 30.

If `--resume` is passed with no checkpoint, `verifyResumability` returns `drift: "no checkpoint found"` — treat as a cold start.

---

## Cost Estimate

Authoritative rule: `rules/hatch3r-cost-visibility.md`; primitives: `src/pipeline/observability.ts::buildCostBlock` (actuals) and `src/pipeline/costEstimator.ts` (estimate). CONSTITUTION §6 Decision 24/29.

**Pre-execution `cost_estimate`** — emit before the first sub-agent dispatch (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: <int>      # 0 when no research is needed
  triage_tier: light | standard | deep
  estimated_duration_min: <int>
```

`expected_sa_count` is calibrated from the command's frontmatter `sub_agents_spawned.count` × the tier heuristic in `rules/hatch3r-cost-visibility.md` → Pre-Execution Estimate. Each command supplies its own per-tier numbers (e.g. `<tier1-count>` / `<tier2-count>` / `<tier3-count>`).

**Post-execution `cost_actuals` + `delta`** — call `buildCostBlock` again with actuals; both land in the iteration summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`.

---

## Per-Turn Pipeline-State Header

Authoritative rule: `rules/hatch3r-agent-orchestration.md` → Per-Turn Pipeline-State Header. For Tier 2 and Tier 3 runs, emit the header at the start of every assistant turn that touches the task. Tier 1, read-only, and chat-only turns are exempt.

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping is per-command — each command maps phases `1`–`4` onto its own steps (e.g. `<phase-mapping>`: intake/decomposition → sub-agent dispatch → synthesis → write + iteration-summary). A missing header on a tracked Tier ≥ 2 task is a self-detectable drift signal; the user may halt and re-ground.

---

## End-of-Turn Delegation Attestation

Authoritative rule: `rules/hatch3r-agent-orchestration.md` → End-of-Turn Delegation Attestation. Every turn that mutated files at Tier 2 or Tier 3 emits this block immediately before the Iteration Summary, quoting verbatim each spawned sub-agent's `delegation_proof_id`:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - <relative path>: via <hatch3r-agent-name> (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation next turn. The block sits beside the Iteration Summary, not inside it, preserving the iteration-summary contract verbatim.
