---
id: hatch3r-handoff-readiness
type: rule
description: Handoff readiness checklist — pre-write validation before persisting a canonical handoff document.
scope: conditional
globs: .hatch3r/handoffs/active/**/*.md
precedence: high
tags: [orchestration, maintenance]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Handoff Readiness Checklist

Before writing a handoff to `.hatch3r/handoffs/active/`, verify each criterion. Refuse the write if any **Required** criterion fails; warn on **Recommended** failures.

## Required (fail = refuse write)

| # | Criterion | Rationale |
|---|-----------|-----------|
| 1 | Body ≤ 51,200 bytes (50 KB) | Token bloat — full transcripts and unbounded sessions degrade resume reliability |
| 2 | Body contains no full message transcript | Token bloat — structured fields only |
| 3 | All 8 required sections present (Problem, Decisions, Work Done, Work Remaining, Blockers, Next Steps, Build & Test Status, File Manifest) | Resume needs structured state |
| 4 | git_ref matches current HEAD (branch@sha7) | Staleness signal integrity |
| 5 | Frontmatter validates against schema | Loader interop |
| 6 | Injection-pattern scan clean (P-LEARN-01..05) | ASI06 memory poisoning prevention |
| 7 | Integrity hash computed (sha256:<hex>) | Tamper detection |

## Recommended (fail = warn)

| # | Criterion | Rationale |
|---|-----------|-----------|
| 8 | `summary` populated, ≤ 200 chars | Loader briefing budget |
| 9 | `target_agent` is explicit (not `any`) | Avoids handoff loops (industry anti-pattern) |
| 10 | `Build & Test Status` table populated with at least one row | Resume reliability — knowing whether tests passed at handoff time |

## Enforcement

The `hatch3r-handoff-preparer` agent applies this checklist before invoking `writeHandoff` in `src/content/handoffs/index.ts`. The `validateHandoffContent` function in `src/content/handoffs/validation.ts` runs criteria 1-7 as `errors[]` and 8-10 as `warnings[]`.

## Cross-references

- Body sections schema: `.hatch3r/handoffs/README.md`
- Iteration Summary contract (populates Work Done / Work Remaining / Blockers): `rules/hatch3r-iteration-summary.md`
- Injection-pattern catalog: `agents/shared/injection-patterns.md` Section B
- Quality charter (confidence levels): `agents/shared/quality-charter.md`
