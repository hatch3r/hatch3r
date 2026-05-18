---
id: hatch3r-handoff-prepare
description: Capture mid-work session state into a canonical handoff document at .agents/handoffs/active/. Use when ending a session mid-work, switching tools, or after context-health Orange/Red.
tags: [core, maintenance]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
parallel_tool_default: true
---
# Handoff Preparation

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Gather session state (git_ref, files, tests, work_item)
- [ ] Step 2: Compose body (8 required sections + user-tier markers)
- [ ] Step 3: Validate against readiness rule
- [ ] Step 4: Write atomically to .agents/handoffs/active/<id>.md
- [ ] Step 5: Confirm with path, summary, and Iteration Summary
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: target_agent (named vs `any`), status (`in-progress` vs `open` vs `handed-off`), overwrite policy when a same-`work_item` handoff exists (<24h vs supersede), expected resumer scope, and whether secret-redaction is needed in the body.

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

## Step 1: Gather State

Collect the inputs required by the handoff schema (see `.agents/handoffs/README.md` for the canonical schema):

1. **git_ref** — run `git branch --show-current` and `git rev-parse --short HEAD`. Compose as `branch@sha7` (e.g., `feat/cache-refactor@a3f2c1d`).
2. **branch** — same value as the branch component above.
3. **Modified files** — run `git status --porcelain`; pair each path with its change type for the `File Manifest` table.
4. **Build & Test Status** — from session memory, recover the most recent results of `npm test`, `npm run lint`, and `npx tsc --noEmit`. If none ran this session, re-run them.
5. **work_item (optional)** — read `platform` from `.agents/hatch.json` (`github | azure-devops | gitlab`) plus active issue from the current branch name or recent board state. Compose as `gh:owner/repo#42`, `ado:org/project:work-item/123`, or `gl:owner/repo!42`.
6. **compaction_count (optional)** — increment from a parent handoff's value if resuming; else omit.
7. **target_agent** — explicit named agent (`hatch3r-implementer`, `hatch3r-reviewer`, etc.) or `any` only when the user opts in.

## Step 2: Compose Body

Populate the 8 required sections in the order defined by the README schema:

```
--- BEGIN USER-TIER CONTENT: handoff ---

## Problem
{1-3 paragraphs naming the work and why it is in flight}

## Decisions
- {decision with one-line rationale}

## Work Done
- {bullet from the most recent Iteration Summary block's Done section}

## Work Remaining
- {bullet from the Iteration Summary block's Not Done / Deferred / Unverified section}

## Blockers
- {bullet from the Iteration Summary block's Open Questions / Blockers section, or "None"}

## Next Steps
1. {ordered, actionable}

## Build & Test Status
| Check | Status | Notes |
| ----- | ------ | ----- |
| npm test | pass/fail/skipped | {one line} |
| npm run lint | pass/fail/skipped | {one line} |
| npx tsc --noEmit | pass/fail/skipped | {one line} |

## File Manifest
| Path | Status | Last action |
| ---- | ------ | ----------- |
| src/foo.ts | modified | added rate-limit guard |

--- END USER-TIER CONTENT: handoff ---
```

**Provenance constraint:** `Work Done`, `Work Remaining`, and `Blockers` are copied **verbatim** from the session's most recent Iteration Summary block (per `rules/hatch3r-iteration-summary.md`). Do not paraphrase — the contract is exact reuse so loaders can correlate handoff state with prior turn output.

**Hard cap:** body ≤ 51,200 bytes (50 KB). If exceeded:

1. Compute byte counts per section.
2. List the over-budget sections to the user.
3. Refuse the write per Step 3 (criterion 1 of `rules/hatch3r-handoff-readiness.md`).

## Step 3: Validate

Apply `rules/hatch3r-handoff-readiness.md` in this order:

1. **Required criteria 1-7** — body ≤ 50 KB, no full transcript, all 8 sections present, git_ref matches HEAD, frontmatter schema valid, injection-pattern scan clean against `agents/shared/injection-patterns.md` Section B (`P-LEARN-01..05`), integrity hash computed.
2. **Recommended criteria 8-10** — `summary` ≤ 200 chars, `target_agent` not `any`, `Build & Test Status` table has at least one row.
3. **Integrity hash** — compute SHA-256 of the body content (everything between the closing `---` of frontmatter and end of file, trimmed). Write as `integrity: sha256:{hex-digest}` in frontmatter.

A failed Required criterion is `errors[]` — refuse the write. A failed Recommended criterion is `warnings[]` — proceed and surface in Step 5.

## Step 4: Write

1. Generate the id: `<YYYY-MM-DD>_T<HHmm>_<5hex>_<kebab-slug>` (e.g., `2026-05-17_T1430_a3f2c_issue-42-cache-refactor`). The 5-char hex segment is a random suffix that prevents accidental same-id overwrites within the same minute.
2. Call `writeHandoff(agentsDir, handoff)` from `src/content/handoffs/index.ts`. The function performs an atomic temp+rename per the `safeWrite.ts` pattern under `HATCH3R_LOCK=1`.
3. The handoff lands at `.agents/handoffs/active/<id>.md`.

**Status default:** `in-progress`. Use `open` if the work has not been started, or `handed-off` if explicitly transferring to another developer or agent.

**ASK:** "Set status to `in-progress` (default), `open` (work not started), or `handed-off` (explicit transfer)?"

## Step 5: Confirm

Report:

```
Handoff written: .agents/handoffs/active/<id>.md
Summary: {summary}
Warnings: {list or "none"}
```

Then emit the canonical Iteration Summary block per `rules/hatch3r-iteration-summary.md`.

## Boundaries

- **Always:** validate before write (readiness rule criteria 1-7), compute integrity hash, wrap body in user-tier markers, default `target_agent` to an explicit value, preserve `git_ref` accuracy at write time.
- **Ask first:** before overwriting an existing active handoff for the same `work_item` (only allowed when existing is older than 24 hours), before setting `target_agent: any`.
- **Never:** include full conversation transcripts, include secrets/credentials/tokens, write directly to `.agents/handoffs/archived/`, paraphrase content from the Iteration Summary block.

## Error Handling

| Condition | Action |
|-----------|--------|
| Body exceeds 50 KB | List section byte counts; refuse write; suggest compressing `Work Done` history |
| Required frontmatter field missing | Name the missing field; refuse write |
| Duplicate active handoff for same `work_item` | If existing < 24h: surface path, refuse with hint; if ≥ 24h: **ASK** whether to supersede (writes `superseded_by` link in old) |
| Injection pattern detected (P-LEARN-01..05) | List the matching pattern id; refuse write; instruct user to rephrase |
| `git_ref` does not match HEAD | Refuse write; advise running `git status` to confirm the working tree is in the expected state |
| Schema validation failure | Surface the schema path and value; refuse write |

## Definition of Done

- [ ] Step 1 state gathered (git_ref, files, tests, optional work_item)
- [ ] Step 2 body composed with 8 sections and user-tier markers
- [ ] Step 3 readiness rule passed (criteria 1-7) with warnings surfaced
- [ ] Step 4 file written to `.agents/handoffs/active/<id>.md`
- [ ] Step 5 confirmation reported + Iteration Summary block emitted

## Related Skills & Agents

- **Skill:** `hatch3r-handoff-resume` — load and resume a previously written handoff
- **Agent:** `hatch3r-handoff-loader` — session-start agent that surfaces active handoffs
- **Agent:** `hatch3r-handoff-preparer` — orchestrates this skill; invoked by `on-context-switch` hook and `/hatch3r-handoff prepare`
- **Rule:** `hatch3r-handoff-readiness` — the pre-write checklist applied in Step 3
- **Rule:** `hatch3r-iteration-summary` — source of the `Work Done` / `Work Remaining` / `Blockers` content
