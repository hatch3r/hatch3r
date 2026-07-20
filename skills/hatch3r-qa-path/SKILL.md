---
id: hatch3r-qa-path
name: hatch3r-qa-path
type: skill
description: Produces a human-run manual QA test path from a PR, branch diff, or uncommitted working tree — a risk-ordered table of steps, expected results, and automated-coverage references plus a shippability sign-off. Use when a human needs to know what to manually test to judge a change safe to merge or release.
tags: [review, testing]
pillars:
  governance: [P2, P8]
  content-quality: [CQ5]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# QA Path — Manual Test Walk-Through for a Human

Given an existing PR or in-progress change, produce a HUMAN-QA test path: a table of what a person should manually test, in what order, to judge the change shippable. This skill runs single-pass in the invoking conversation and spawns no sub-agents — the human executes the path; the agent only derives it.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Collect the diff, PR description, and linked issues
- [ ] Step 2: Classify changed surfaces
- [ ] Step 3: Derive test-path rows
- [ ] Step 4: Emit the table + sign-off block
```

## Not Covered Here

Automated test strategy (coverage targets, test-case outlines, CI gates) belongs to the `hatch3r-test-plan` command (`commands/hatch3r-test-plan.md`); agent-executed QA with browser automation and evidence capture belongs to `hatch3r-qa-validation` (`skills/hatch3r-qa-validation/SKILL.md`). This skill emits the manual walk-through FOR THE HUMAN — it writes no test code, drives no browser, and files no issues.

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions and resolve them via the platform-native question tool per `agents/shared/user-question-protocol.md` — default behavior, not exception-driven. Triggers for THIS skill: (a) multiple open PRs and none named; (b) diff range underspecified (base branch unclear, fork point ambiguous); (c) the change is environment-sensitive (migration, config) and the walk-through environment is unstated; (d) the diff is UI-heavy but the repo declares no breakpoints or themes — confirm which viewports matter before deriving per-viewport rows.

## Inputs

Accept exactly one input, resolved in this precedence order:

1. **PR number** — resolve via `gh pr view <n> --json title,body,files,baseRefName` plus `gh pr diff <n>`.
2. **Branch or diff range** — e.g. `main...feature/x`; resolve via `git diff <range> --stat` plus `git log <range> --oneline`.
3. **Fallback — uncommitted working tree**: when neither is given, use `git diff HEAD --stat` plus `git status --short`, and state in the output header that the path covers uncommitted work.

## Step 1 — Collect

1. Pull the full diff (file list + hunks), the PR description, and linked issues (`Closes #n` / `Fixes #n` refs in the body; read each via `gh issue view <n>`).
2. Read enough of each changed file to name the user-facing behavior the hunk alters — the table's "Area / flow" column names behaviors, never file paths.
3. Map automated coverage: for each changed source file, search the test tree (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`) for tests that reference it. Record the test file path, or `no` when none exists.

## Step 2 — Classify Changed Surfaces

Sort every changed file into one or more classes (one file can hit several):

| Class | Signal in the diff |
|---|---|
| User-visible UI | components, templates, styles, user-facing copy/strings, CLI output formatting |
| API / contract | route handlers, request/response shapes, exported signatures, schema files |
| Config / migration | env vars, config schema or defaults, DB/file-format migrations, install or upgrade paths |
| Security-adjacent | auth, permissions, input validation, secrets handling, path/URL handling, bumps of security-relevant dependencies |
| Docs-only | `*.md`, docstrings, comments — no executable change |

A diff that is 100% docs-only short-circuits: emit either a one-row table (render + link check of changed pages, when they publish somewhere) or the line "No manual QA path required — docs-only diff", followed by the sign-off block.

## Step 3 — Derive Test-Path Rows

Apply every trigger below; each fires once per instance, not once per diff:

| Trigger (measurable) | Rows derived |
|---|---|
| A user-visible surface is touched | >=1 row per surface, walking the primary flow through it |
| An error/failure path is changed (catch block, error message, fallback, retry, timeout) | 1 row that intentionally causes that failure and observes the handling |
| A config or migration change | 1 fresh-setup row (clean install / first run) + 1 upgrade row (existing state carried forward) |
| A security-adjacent change | 1 negative-test row: attempt exactly what the change should deny (wrong role, invalid token, traversal path, oversized input) and record the expected denial message/status |
| A UI change, when the repo declares breakpoints or themes (design tokens, `tailwind.config.*`, theme files) | 1 row per declared breakpoint/theme combination the change renders in |

Grade **Risk if broken** as likelihood x impact on three levels:

- **H** — plausible failure that loses user data, opens a security hole, or blocks a core flow with no workaround.
- **M** — degraded or confusing behavior in a primary flow that has a workaround, or a recoverable error.
- **L** — cosmetic, edge-case-only, or confined to a secondary flow.

Estimate **Est. minutes** per row as setup + steps + observation, executed by someone who has the app running but has not read the diff. When the column total exceeds 90 minutes, split the table into timeboxed sessions of <=30 minutes each and say so above the table (session-based practice — see References).

## Step 4 — Emit the Table + Sign-Off Block

Sort rows by Risk descending (H > M > L), then Est. minutes ascending — highest risk, cheapest first. The column set is fixed:

```markdown
## Human-QA Test Path — {PR #n | range | working tree} ({date})

| # | Area / flow | Steps to perform | Expected result | Risk if broken (H/M/L) | Automated coverage (yes/partial/no + test file ref) | Est. minutes |
|---|---|---|---|---|---|---|
| 1 | {behavior name} | {numbered, copy-pasteable steps} | {observable outcome — exact text, HTTP status, exit code where known} | H | partial — src/__tests__/{file}.test.ts | 5 |

**Sign-off**
- [ ] All H rows pass.
- [ ] No M row fails without a filed follow-up issue (link each).
- L-row failures: record them; they do not block the merge.
- Shippable: YES when both boxes above are checked; otherwise NO — list the blocking rows.
- Rollback check: {one-line revert path if a failure appears post-merge — e.g. `git revert <merge-sha>` + redeploy, or the feature flag to flip. Confirm the path exists before signing off.}

Not covered here: automated test strategy (`hatch3r-test-plan`), agent-executed QA (`hatch3r-qa-validation`).
```

Write "Steps to perform" for a human with no diff context: start state, exact clicks/commands, concrete input values. "Expected result" names observable outcomes (rendered text, HTTP status, file created, exit code) — never internal state.

## Error Handling

- **PR not found / `gh` unavailable:** fall back to the branch/diff-range input; when no range is derivable either, use the working-tree fallback and state which input was used.
- **Diff exceeds ~100 changed files:** derive rows for the highest-risk classes first (security-adjacent, config/migration, API/contract), then state which surfaces were excluded and why.
- **Repo has no automated tests:** fill the coverage column with `no` throughout and append one line recommending the `hatch3r-test-plan` command for strategy work.

## Definition of Done

- [ ] Every Step 3 trigger checked against the classified diff; each firing produced its row(s)
- [ ] Rows sorted by Risk desc, then Est. minutes asc
- [ ] Every row fills all 7 columns; coverage column cites a test file path or `no`
- [ ] Sign-off block present, rollback-check line filled with a concrete revert path
- [ ] "Not covered here" scope line present in the output

## References

- BrowserStack — "Risk Based Testing Approach for Agile Teams" (guide, last updated 2026-02-20). https://www.browserstack.com/guide/risk-based-testing-in-agile — accessed 2026-07-20. Trust tier: vendor-note. Taken: likelihood x severity risk matrix and execute-highest-risk-first ordering, encoded here as the H/M/L grading and the Risk-desc sort.
- TestRail (Sembi) — "How to Manage and Track Exploratory Testing" (Hannah Son, 2025-04-18). https://www.testrail.com/blog/track-exploratory-testing/ — accessed 2026-07-20. Trust tier: blog (named author on vendor domain). Taken: charters as focused timeboxed missions (30-90 min sessions) and coverage roll-up to release readiness, encoded as the 90-minute split threshold and <=30-minute sessions.
- Atlassian Community, App Central — "How to Write a Good Test Plan in 2025" (Ola Sokolowska, 2025-10-29). https://community.atlassian.com/forums/App-Central-articles/How-to-Write-a-Good-Test-Plan-in-2025/ba-p/3131998 — accessed 2026-07-20. Trust tier: independent-analysis (named Atlassian-partner practitioner; community-hosted, not official Atlassian docs). Taken: test-plan section anatomy (objectives, in/out scope, environment, risks and mitigation), encoded as the Inputs precedence, surface classification, and scope-delimiting "Not covered here" line.
