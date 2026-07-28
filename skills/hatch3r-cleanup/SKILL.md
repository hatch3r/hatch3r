---
id: hatch3r-cleanup
name: hatch3r-cleanup
type: skill
description: Repo-state cleanup pass — inventories accumulated hatch3r working state (plan files, workspace dirs, review telemetry, findings ledgers, learnings, handoffs, board staleness), asks once with per-category counts and estimated reclaim, dispatches each owned surface to its owning skill or CLI path, and prunes only the unowned remainder itself.
tags: [maintenance, orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
---

# Cleanup — Accumulated Working-State Pass

## Quick Start

Dispatch-first: each surface's cleanup lives in the artifact that created the state. This skill inventories everything in one read-only scan, asks ONCE, dispatches confirmed categories to their owning procedures, and directly prunes only the surfaces no other artifact owns (plan files, workspace dirs, telemetry rotation). It spawns no sub-agents — dispatch means running the owning skill's documented procedure or CLI command inline.

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Inventory scan (read-only)
- [ ] Step 2: One consolidated ASK
- [ ] Step 3: Dispatch owned surfaces
- [ ] Step 4: Prune unowned surfaces
- [ ] Step 5: Report
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any scan, resolve open questions via the platform-native question tool per `agents/shared/user-question-protocol.md` — default behavior, not exception-driven. Triggers for THIS skill: (a) the invocation names a scope narrower than the full inventory ("clean up the plans") — confirm whether the other categories should be scanned too or skipped; (b) the repo is mid-flight (open PR branch checked out, active handoff present) — confirm cleanup should run now rather than after landing; (c) a category's owner is customized (e.g. `.hatch3r/overrides/` carries a modified learn or board-groom skill) — confirm the override's procedure is the one to dispatch. Additionally, classify as **in-use-until-confirmed** any plan file whose branch still exists, any workspace dir modified within the last 24h, and any telemetry file a currently-running loop may be appending to — these are listed in the Step 2 ASK as keep-by-default, never silently included in prune candidates.

## Step 1 — Inventory Scan (read-only)

No mutation in this step. Collect per-category counts and estimated reclaim (bytes via `du -sh`, counts via Glob or `ls`):

| Category | What to scan | Cleaned in |
|----------|--------------|------------|
| Plan files | `docs/rework/*.md` rework plans + `docs/specs/*.md` orphans — plan/spec files whose branch is merged or deleted (`git branch --list <branch>`; PR state via `gh pr list --search <branch>`) | Step 4 |
| Workspace dirs | `.audit-workspace/`, `.create-workspace/`, `.rework-workspace/` — completed-run leftovers | Step 4 |
| Review state + telemetry | `.hatch3r/review-loop/` checkpoints and its `audit.log`, `.hatch3r/review-findings/`, `.hatch3r/review-loop-metrics.jsonl`, `.hatch3r/calibration-log.jsonl` | Step 4 |
| Findings ledgers | `.hatch3r/findings/*.jsonl` — closed files beyond the >20-count / >30-day Hygiene bounds | Step 3 → ledger Hygiene prune |
| Learnings | active `.hatch3r/learnings/*.md` count vs cap (default 150; `learnings.maxCount` in `.hatch3r/hatch.json`) | Step 3 → `hatch3r-learn` Consolidation Pass |
| Handoffs | `.hatch3r/handoffs/active/` entries past expiry | Step 3 → `hatch3r sync` prune |
| Board | stale open issues per the board staleness criteria (`hatch3r-board-shared` S6 inactivity) | Step 3 → `hatch3r-board-groom` Step 4e |

## Step 2 — One Consolidated ASK

Present ONE multiple-choice prompt — never one prompt per category — with per-category counts + estimated reclaim:

```
Cleanup inventory ({date}):
  1. Plan files: {n} merged-branch candidates ({size}) — archive | delete | keep
  2. Workspace dirs: {n} completed-run dirs ({size}) — prune | keep
  3. Review telemetry: {n} files ({size}) — rotate (keep newest 500 lines / 90 days) | keep
  4. Findings ledgers: {n} closed files past Hygiene bounds — prune | keep
  5. Learnings: {n}/{cap} active — run Consolidation Pass | skip
  6. Handoffs: {n} past-expiry — run `hatch3r sync` prune | skip
  7. Board: {n} stale candidates — dispatch board-groom archive | skip
  In use (kept regardless): {list or none}
  Default if no answer: keep everything — no mutation.
```

Per-category answers are honored independently. Nothing is deleted, archived, or rotated before this ASK is answered — the no-answer default is keep.

## Step 3 — Dispatch Owned Surfaces

Cleanup lives in the artifact that created the state — dispatch to the owning procedure, never re-implement it:

- **Learnings** → run the Consolidation Pass in `skills/hatch3r-learn/SKILL.md` (merge clusters, archive originals, regenerate INDEX). Consolidate/archive only — the learn skill's never-delete-learnings guardrail binds here unchanged; this skill adds no learning-deletion path.
- **Board** → run `skills/hatch3r-board-groom/SKILL.md` Step 4e (Archive Stale Items), scoped to the Step 1 candidates; board-groom's own per-issue ASK still applies.
- **Handoffs** → run `hatch3r sync` — its `pruneHandoffs` path quarantines past-expiry handoffs (active → archived) behind the CLI's validation gates. Never hand-move handoff files.
- **Findings ledgers** → apply the Hygiene bounds from `rules/hatch3r-findings-ledger.md` (§Hygiene): delete oldest CLOSED files down to ≤20 files and ≤30 days. Open ledger files are never touched — a dead run's open ledger is surfaced by the session-start loader, not closed here.

## Step 4 — Prune Unowned Surfaces (this skill's own writes)

- **Plan files:** per the user's Step 2 answer — archive (move to `docs/rework/archive/` or `docs/specs/archive/`, creating the dir on first use) or delete plan files whose branch is merged/deleted. When the answer is ambiguous between the two, archive: archival is reversible, deletion is not.
- **Workspace dirs:** remove contents of `.audit-workspace/`, `.create-workspace/`, `.rework-workspace/` for completed runs — a dir qualifies when untouched >7 days AND no open branch or active handoff references it. Keep any dir named by an in-flight handoff or open findings ledger.
- **Telemetry rotation:** when a file exceeds 1 MB or holds entries older than 90 days, truncate `.hatch3r/review-loop-metrics.jsonl` and `.hatch3r/calibration-log.jsonl` to the newest 500 lines (the tail carries the calibration state consumers read); rotate `.hatch3r/review-loop/audit.log` under the same bounds; delete `.hatch3r/review-loop/<issue>.review-loop.json` checkpoints whose issue is closed.

## Step 5 — Report

```
Cleanup report ({date}):
  dispatched: learn (merged {x}, archived {y}) · board-groom (archived {z} issues) · sync (pruned {h} handoffs) · ledger prune (deleted {w} closed files)
  pruned directly: {n} plan files ({archived|deleted}) · {n} workspace dirs · {n} telemetry files rotated
  kept (user choice or in-use): {list or none}
  bytes reclaimed: {total}
```

## Safety

- **Never touch `.hatch3r/overrides/`** — user canonical overrides are configuration, not accumulated state; they are outside every category above.
- **Never mutate before the Step 2 ASK is answered** — the no-answer default is keep everything.
- **Never delete learnings** — consolidate/archive only, per the learn skill's guardrail.
- **Never close or delete an OPEN findings ledger** — only closed files within the Hygiene bounds are prunable.
- **Single-writer:** dispatched procedures own their own writes; this skill writes only to the Step 4 surfaces.

## Not Covered Here

Generated adapter-output removal is the `hatch3r clean` CLI command (a different surface: managed adapter files, not accumulated working state). Worktree teardown is `hatch3r worktree-cleanup`. Automated test strategy and board filling are out of scope entirely.

## Invoked by

Run manually when working state accumulates, or as a pre-release hygiene pass alongside `skills/hatch3r-release/SKILL.md`. The delegated surfaces cross-reference this skill from their own lifecycle sections (`hatch3r-learn` Consolidation Pass, `hatch3r-board-groom`, `rules/hatch3r-findings-ledger.md` §Hygiene, `agents/hatch3r-handoff-loader.md`).

## References

Reconnaissance skip (trivial-composition rationale): this skill asserts no external practice — it composes four in-repo procedures (learn Consolidation Pass, board-groom Step 4e, `hatch3r sync` handoff pruning, findings-ledger Hygiene bounds) behind one inventory scan and one consolidated ASK, and every threshold it applies (150-learning cap, 20-file/30-day ledger bounds, handoff expiry) is defined by the cited in-repo owner, not by outside sources.
