---
id: hatch3r-orchestration-frame
type: shared-context
description: Single source of truth for cross-cutting orchestrator-command boilerplate — checkpoint contract, cost-estimate block, and Per-Turn Pipeline-State Header. Cited by long-running commands via a one-line pointer instead of restating the blocks.
tags: [orchestration, reference]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---

# Orchestration Frame (shared command boilerplate)

> Last updated: 2026-06-09
> Pillars: P4 (Lean Coverage, primary — kills the ~30-file restatement of these six blocks), P7 (Speed & Token Efficiency, supporting — static cacheable frame).

Six cross-cutting blocks recur near-verbatim across the `commands/hatch3r-*.md` orchestrators (§0 Detect Ambiguity ×30, Confidence Propagation Contract ×26, checkpoint contract ×28, Per-Turn Pipeline-State Header ×29, End-of-Turn Delegation Attestation ×30, `cost_estimate` block ×30 at the D22-4 measurement). This file is their single source of truth. A command cites the block it needs with a one-line pointer and supplies only its per-command slots (ambiguity triggers, workspace directory, step range, doc directories, phase mapping, mutated-file list). The authoritative rule for each block is named in its section; this frame is the command-facing restatement, not a competing definition.

Citation template (drop into the command where the block used to live):

```
> Orchestration boilerplate: see `commands/shared/orchestration-frame.md` → {§0 Detect Ambiguity | Confidence Propagation Contract | Delegation Brief | Checkpoint Contract | Cost Estimate | Per-Turn Pipeline-State Header | End-of-Turn Delegation Attestation}. Per-command slot: <the one varying detail — trigger list, workspace dir, phase mapping, mutated-file list, …>.
```

`<…>` slots below are the only text a command varies; everything outside them is invariant and lives here.

---

## §0 Detect Ambiguity (P8 B1)

Authoritative rule: `rules/hatch3r-clarification-default.md` (B1 directive); framework-dev mirror `.claude/rules/clarification-default.md`. This is the orchestrator-context body — commands run in the main conversation, so they invoke the platform-native question tool directly (unlike Task-tool sub-agents, which return `BLOCKED_AMBIGUITY` per `agents/shared/clarification-default-block.md`).

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

Per-command slot: an optional one-line trigger list naming the command's domain-specific ambiguities (e.g. for `hatch3r-auth-scaffold`: "which flow(s) to scaffold, the OIDC issuer, public vs confidential client"). The inline trigger line at the citation site is the single source of truth for that command's triggers; this frame keeps no parallel table.

---

## Confidence Propagation Contract

Authoritative rule: `agents/shared/quality-charter.md` §1 (confidence expression). Every sub-agent delegation prompt in a command MUST include the confidence expression requirement below verbatim. Sub-agents carry the `quality_charter` reference in frontmatter, but the orchestrator repeats the directive to override runtime prompt defaults per charter §1.

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Downstream propagation: every ASK checkpoint that reports verification quality, every gate that evaluates a sub-agent verdict, and every output block that surfaces `<readiness-kind>` readiness MUST carry a high/medium/low confidence rating sourced from the upstream sub-agent. Dropping the signal between stages is a gate failure.

Per-command slot: `<readiness-kind>` (e.g. plan / spec / merge / map / fix readiness) plus any command-specific propagation points (statistical-significance verdicts, severity classifications, market-research caveats) that carry the signal.

---

## Delegation Brief (implementer / specialist)

Authoritative sources: the spawned agent's Return Structured Result protocol (`agents/hatch3r-implementer.md`, `agents/hatch3r-fixer.md`) for output format + completion; this frame's Cost Estimate (`triage_tier`) and Effort Override for the effort tier (canonical Light/Standard/Deep vocabulary in `agents/shared/triage-vocabulary.md`). Every implementer/specialist delegation prompt a command spawns MUST carry the six fields below; the first four resolve per-command or by the referenced protocol, and the last two are the invariant lines the frame single-sources so no command restates them:

- **Objective** — the command's issue id / task + acceptance criteria + change-type slot.
- **Output format + completion** — the spawned agent's Return Structured Result protocol (files changed, tests written, issues encountered).
- **Tool guidance** — the `scope: always` rule set plus any command-specific MCP note.
- **Boundary** — do NOT create branches, commits, or PRs; stay within the existing architecture.
- **Effort budget** — `work-effort tier: {light|standard|deep} from Step-0 triage — right-size test depth and edge-case exploration to it`. The tier is the same one Step 0 fed the Cost Estimate and Effort Override blocks; pass it to the implementer instead of leaving effort unbounded.
- **Stop criterion** — `stop and return your structured result when all acceptance criteria are met OR emit BLOCKED_* with a reason if you cannot proceed — do not expand scope`.

Per-command slot: `<change-type>` (feature / bug / refactor / spec) and the command's acceptance-criteria source (issue body, spec section, or plan step).

---

## Effort Override (Decision 17)

Authoritative contract: hatch3r's universal `--effort` override ("User overridable via `--effort` flag", CONSTITUTION §6 Decision 17). Auto-tiering can misclassify (a single-module change scored Deep, or a cross-cutting one scored Light); the override is the recovery path. The invariant body:

- `--effort=light|standard|deep` forces the named tier, bypassing the command's Step 0 auto-classification.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost Estimate block reports the budget delta.
- No override passed → the auto-classification stands.

Per-command slot: a one-line misclassification example in the command's own domain (e.g. "a single-endpoint doc tweak scored as Deep").

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

**Post-execution `cost_actuals` + `delta`** — call `buildCostBlock` again with actuals; both land in the Iteration Summary recap (cost facet; full blocks on the `Cost:` exception line beyond ±25%) per `rules/hatch3r-cost-visibility.md`. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`.

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

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation next turn. The block sits beside the Iteration Summary, not inside it, preserving the recap contract verbatim.
