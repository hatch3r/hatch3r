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
