---
id: hatch3r-handoff
type: command
orchestrator: true
agentPipeline: [hatch3r-handoff-preparer]
description: Prepare, resume, list, complete, and prune cross-session handoff documents.
tags: [orchestration, maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
triage_tiers: [1, 2]
sub_agents_spawned:
  count: 1
  rationale: Single hatch3r-handoff-preparer delegation for the `prepare` Tier-2 subcommand; `resume`, `list`, `complete`, `prune` run inline with no sub-agent fan-out (filesystem-read or single-file rename per the Triage table). Cost-dominance per CONSTITUTION §2 P8 — token cost never serializes independent work.
---

## §0 Detect Ambiguity (P8 B1)

Before any action, scan the user's request and provided context for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts (contradictory inputs, missing target, unknown convention). If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-target, single-concern, and the brief alone is testable. Any residual ambiguity discovered mid-workflow invokes the same protocol.

## Agent Pipeline

The `prepare` subcommand delegates to `hatch3r-handoff-preparer` via the Task tool. The other four subcommands (`resume`, `list`, `complete`, `prune`) run inline within this command — they read, list, transition status, or archive files and do not require a sub-agent.

**Parallel-safety conditions** (per `rules/hatch3r-agent-orchestration.md` §Parallel Safety): any parallel fan-out holds all three — read-only or disjoint writes, deterministic aggregation, no shared mutable state.

## Learnings Consultation

Before starting, scan `.hatch3r/learnings/` for entries tagged `handoff`, `context-switch`, `resume`, or `session-state`. Apply the protocol in `rules/hatch3r-learning-consult.md` (frontmatter-first scan; surface top 5 by confidence). Skip if the directory has fewer than 3 files.

# Handoff Management — Cross-Session Work Continuity

Manage canonical handoff documents at `.hatch3r/handoffs/active/` for mid-work state capture and resumption across sessions, tools, or developers.

---

## Step 0: Triage

Classify the handoff request by subcommand and operation size before routing:

- **Tier 1 (trivial)**: `list`, `complete`, `prune --dry-run`. Filesystem-read or single-file rename; no body composition, no validation gate, no sub-agent. Run inline.
- **Tier 2 (standard)**: `prepare`, `resume`, `prune` (non-dry-run). Body composition with readiness gate (`prepare`), drift check + status transition (`resume`), or batch archival (`prune`). `prepare` delegates to `hatch3r-handoff-preparer` via the Task tool; the others run inline.

There is no Tier 3 for this command — multi-issue or epic-scale handoffs are out of scope; the caller decomposes into per-work-item handoffs upstream.

### Step 0.5: Emit Pre-Execution Cost Preview

The `prepare` subcommand is the only one that dispatches a sub-agent. Before invoking `hatch3r-handoff-preparer`, surface the cost preview per `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate. The Tier-1 read/list/rename subcommands (`list`, `complete`, `prune --dry-run`) run inline with `expected_sa_count: 0` and may emit a one-line cost note instead of the full block:

```yaml
cost_estimate:
  expected_sa_count: <prepare ~1; list/complete/prune-dry-run = 0>
  estimated_input_tokens_static_frame: <int>
  estimated_web_research_queries: 0                # handoff is local-only — no web research
  triage_tier: light | standard
  estimated_duration_min: <int>
```

Post-execution actuals + delta land in the Iteration Summary's Fan-out + Cost section per `rules/hatch3r-cost-visibility.md` Post-Execution Actuals. Token telemetry sources from `src/pipeline/observability.ts`.

### Effort Override (Decision 17)

This command has no Tier 3, so `--effort` maps only `light` ↔ `standard`. The override is the recovery path mandated by `governance/CONSTITUTION.md` §6 Decision 17 ("User overridable via `--effort` flag"):

- `--effort=light|standard` forces the named tier, bypassing the subcommand-derived auto-classification (Step 0). `--effort=deep` is rejected — Tier 3 is out of scope for this command.
- The override wins over the auto-detected tier; record both the auto-detected tier and the override in the run context so the Cost estimate block reports the budget delta.
- No override passed → the subcommand-derived classification stands.

## Confidence Propagation Contract

The `prepare` subcommand's `hatch3r-handoff-preparer` delegation prompt MUST include the confidence expression requirement below (verbatim), per the quality charter §1 rule (the inline subcommands produce no graded findings and are exempt).

> Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

The preparer's readiness assessment and the `resume` drift-check verdict carry a high/medium/low confidence rating; dropping the signal into the Iteration Summary is a gate failure.

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with **ASK**.

### Step 1: Detect Subcommand

Read the first positional argument and route to the matching subcommand. If absent or unrecognized:

**ASK:** "Which handoff action? `prepare | resume | list | complete | prune`."

### Step 2: Route

| Subcommand | Semantics |
|------------|-----------|
| `prepare` | Capture current session state into a new handoff document |
| `resume`  | Load and surface a previously-prepared handoff for continuation |
| `list`    | Show active (and optionally archived) handoffs in a table |
| `complete`| Transition a handoff to `completed` and move to `archived/` |
| `prune`   | Archive expired actives and prune archives older than 90 days |

---

## Subcommand: prepare

1. Parse optional flags: `--work-item <ref>` (e.g. `gh:owner/repo#42`, `ado:org/project:work-item/123`, `gl:owner/repo!42`), `--summary "<text>"`.
2. Invoke `hatch3r-handoff-preparer` via the Task tool. Pass `work_item` and `summary` if provided.
3. The preparer returns the written path plus an Iteration Summary block. Surface both to the user.

**ASK** (before invocation): "Capturing handoff for {current branch}. Confirm or specify `--work-item` / `--summary`."

## Subcommand: resume

1. Parse optional `<id>` positional. If provided, route directly to `skills/hatch3r-handoff-resume` with that id.
2. If `<id>` absent, call `listHandoffs({ status: ["open","in-progress","blocked","handed-off"] })` from `src/content/handoffs/index.ts` and present a numbered table (id, status, branch, summary, updated).

**ASK:** "Which handoff to resume? (number, or `cancel`)"

3. Invoke `skills/hatch3r-handoff-resume` with the chosen id. The skill performs validation, drift check, and status transition.

## Subcommand: list

1. Parse flags: `--status <status>`, `--work-item <ref>`, `--include-archived`.
2. Call `listHandoffs(filter)` and render:

```
ID                                              STATUS         BRANCH                SUMMARY                                  UPDATED
2026-05-17_T1430_a3f2c_issue-42-cache-refactor  in-progress    feat/cache-refactor   Token caching for board-fill researcher  2026-05-17 14:30
```

3. If empty, display: `No active handoffs. Run 'hatch3r-handoff prepare' to capture one.`

## Subcommand: complete

1. Parse positional `<id>` (required). If absent, **ASK** the user to pick from `list`.
2. Read the handoff via `readHandoff(id)`. Display the `summary` and `Work Remaining` section.
3. Parse optional `--reason "<text>"` for the archival notice.

**ASK:** "Mark `{id}` completed and archive? (y/N). Reason will be recorded: `{reason or 'no reason given'}`."

4. On confirm: transition `status` to `completed`, stamp `updated` to now, prepend the archival notice (mirrors learnings archival format), then atomic-rename to `.hatch3r/handoffs/archived/<id>.md`.

## Subcommand: prune

1. Parse `--dry-run` flag.
2. Scan `.hatch3r/handoffs/active/`: collect entries whose `expires_after` ISO-8601 timestamp is at-or-before now (preparer default stamps `created + 30 days`).
3. Scan `.hatch3r/handoffs/archived/`: collect entries where `updated` is older than 90 days.
4. Present a two-section preview (Active expirations to archive, Archives to delete).
5. If `--dry-run`: print the preview and exit.

**ASK:** "Proceed with prune? Will archive {n} active and delete {m} archived. (y/N)"

6. On confirm: archive each expired active (prepend `Expired on {date}` notice, move to `archived/`); delete each over-90-day archive.

---

## Per-Turn Pipeline-State Header (Bypass Protection)

For Tier 2 runs (handoff declares `triage_tiers: [1, 2]`), emit the header at the start of every assistant turn that touches this task, per `rules/hatch3r-agent-orchestration.md` -> Per-Turn Pipeline-State Header. Format:

```
[hatch3r-pipeline: phase {1|2|3|4} | last: {agent} → {SUCCESS|PARTIAL|FAILED|BLOCKED|n/a} | next: {agent or "user-confirmation" or "complete"}]
```

Phase mapping for handoff: `1` = action detection (prepare / load / resume / complete / prune), `2` = handoff-preparer / handoff-loader sub-agent dispatch, `3` = validation + integrity verification, `4` = report + iteration-summary. Tier 1 runs are exempt per the Tier 1 exemption.

## End-of-Turn Delegation Attestation (Bypass Protection)

Every turn that mutated files (handoff document written under `.hatch3r/handoffs/active/`) at Tier 2 emits the attestation block immediately before the Iteration Summary, per `rules/hatch3r-agent-orchestration.md` -> End-of-Turn Delegation Attestation. Quote the per-file `delegation_proof_id` returned by the spawning sub-agent verbatim:

```
[hatch3r-delegation-attestation]
files_mutated_this_turn:
  - .hatch3r/handoffs/active/<id>.md: via hatch3r-handoff-preparer (proof: <delegation_proof_id>)
mutating_subagent_invocations: <integer>
inline_edits_by_orchestrator: none
```

Unattributable rows are a self-declared P8 B2 violation — halt and queue re-delegation.

## Iteration Summary (mandatory output)

Emit the canonical 9-section iteration summary per `rules/hatch3r-iteration-summary.md` as the final user-facing output. The validation gate at `.claude/rules/capability-lifecycle.md` blocks SUCCESS declarations without this block (CONSTITUTION §6 Decision 23).

The 9 sections:

1. **Request** — verbatim restatement of the user's ask in one sentence.
2. **Fan-out + Cost** — `sub_agents_spawned: { count, rationale }` plus the `cost_estimate` / `cost_actuals` / `delta` blocks (see Cost Visibility below).
3. **Web Research** — every URL fetched with access date + trust tier per `governance/audit/templates/rigor-contract.md` (0 acceptable when no research was needed).
4. **Files Mutated** — list with diff summary (lines added / removed / files created).
5. **Gates Passed / Failed** — explicit list per `.claude/rules/capability-lifecycle.md` Gate Checklist.
6. **Pillar Impact Attribution** — `progress_toward_pillar: <axis>.<pillar_id>+<delta>` per CONSTITUTION §6 Decision 17.
7. **Verification Commands** — exact commands run with exit codes plus key output lines (≤200 chars).
8. **Open Questions / Blockers** — explicit `None` if fully closed.
9. **Learnings Captured** — IDs of any learnings written to `.hatch3r/learnings/` this run per `rules/hatch3r-learning-system.md`.

### Cost Visibility (Decision 24)

Pre-execution: emit `cost_estimate` before the first sub-agent dispatch via `src/pipeline/observability.ts::buildCostBlock` (5-field schema):

```yaml
cost_estimate:
  expected_sa_count: <int>
  estimated_input_tokens_static_frame: <int>
  triage_tier: light | standard | deep
  estimated_web_research_queries: <int>      # 0 when no research is needed
  estimated_duration_min: <int>
```

Post-execution: call `buildCostBlock` again with actuals to emit `cost_actuals` + `delta`; both land in Section 2 above. Field contract + delta semantics: `rules/hatch3r-cost-visibility.md`. Deltas >25% absolute value carry `flagged_for_review: true`.

## Cost estimate (Decision 24)

This command emits cost transparency per `rules/hatch3r-cost-visibility.md` and CONSTITUTION §6 Decision 24/29:

- **Pre-execution `cost_estimate`** — emitted in Step 0.5 before the `prepare` subcommand invokes `hatch3r-handoff-preparer`. Inline subcommands emit a one-line `expected_sa_count: 0` cost note.
- **Post-execution `cost_actuals` + `delta`** — appended to the Iteration Summary's Fan-out + Cost section per `rules/hatch3r-iteration-summary.md` §2.

Per-tier `expected_sa_count` calibration (from frontmatter `sub_agents_spawned.count: 1` × tier heuristic in `rules/hatch3r-cost-visibility.md` Pre-Execution Estimate): `prepare` ≈ 1 (one preparer delegation); `resume` ≈ 0 (inline drift check + status transition); `list`/`complete`/`prune` ≈ 0 (filesystem read or single-file rename). This command is local-only — `estimated_web_research_queries` is always 0. Deltas beyond 25% absolute value carry `flagged_for_review: true`. Token telemetry sources from `src/pipeline/observability.ts`; estimation primitives from `src/pipeline/costEstimator.ts`.

---

## Error Handling

- `.hatch3r/handoffs/active/` missing or empty: emit `No active handoffs. Run 'hatch3r-handoff prepare' to capture one.` and exit 0.
- Ambiguous `<id>` (multiple partial matches): list the matches and **ASK** the user to pick one.
- Write conflict (concurrent prepare for same `work_item`): surface the existing handoff path and **ASK** whether to overwrite (only if existing handoff is older than 24 hours per `writeHandoff` policy).
- `complete` or `prune` requested on a missing id: report the path that was looked up and suggest `hatch3r-handoff list`.

## Guardrails

- **Never delete** a handoff without explicit user confirmation. Prune deletes only archives older than 90 days, and only after the confirm prompt.
- **Never modify** a file already in `.hatch3r/handoffs/archived/`. Archived entries are immutable history.
- **Never include secrets** (API keys, tokens, credentials) in any handoff body. The preparer scans for credential-shaped strings; reject the write if any are detected.
- **Never write** outside `.hatch3r/handoffs/active/` for new handoffs. Archival is the only path into `archived/`.
- **Always emit the Iteration Summary block** at the end of the iteration per `rules/hatch3r-iteration-summary.md`.

## References

- `agents/shared/user-question-protocol.md` (B1 gate — applies at §0 Detect Ambiguity above plus every mid-workflow ASK checkpoint per Finding D7-M14)
- `agents/shared/quality-charter.md` §1, §3, §7, §8 (confidence, ambiguity, measurable criteria)
- `rules/hatch3r-agent-orchestration.md` (Per-Turn Pipeline-State Header, End-of-Turn Delegation Attestation, Mandatory Delegation Directive)
