---
id: hatch3r-revision-modes
type: command
description: Auto-advance mode, safety guardrails, error handling, and session report for revision. Covers --auto operation, never-skip rules, platform-aware error recovery, and end-of-session summary.
tags: [implementation, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Revision — Modes, Guardrails, and Error Handling

Supplementary protocols for `hatch3r-revision`. Referenced from the core command file.

---

## Auto-Advance Mode

When invoked with `--auto`, revision operates with reduced human checkpoints for sustained autonomous operation (e.g., CI integration, repeated revision cycles).

### Behavior Changes in Auto Mode

| Checkpoint | Normal Mode | Auto Mode |
|-----------|-------------|-----------|
| Step 2 context validation | ASK user | Auto-proceed when PR + linked issues found. If no PR found, fall back to normal mode for this step |
| Step 3 user interview | ASK user for feedback | Skip interview. Work from leftover scan (Step 4) only |
| Step 5b routing approval | ASK user to confirm routing | Auto-accept suggested routing heuristics |
| Step 7e quality failure | ASK user after 2 retries | Auto-defer remaining findings to todo.md after 2 retries |
| Step 9b merge readiness | ASK user for next action | Auto-select (a) ready to merge when READY; auto-select (c) done for now when NOT READY |

### Safety Guardrails (Never Skipped)

These checkpoints are NEVER skipped, even in auto mode:

- **Critical findings** default to FIX NOW. If a critical finding cannot be fixed after 2 retries, auto-mode records it as `Critical-deferred` with rationale "auto-deferred: fix attempts exhausted after 2 retries" and the `Critical-deferred` tag in todo.md
- **Quality gates** (lint, typecheck, tests) must pass before commit. Auto-mode does not bypass quality checks
- **Critical Deferral Protocol** still applies — auto-mode provides a structured rationale rather than skipping the protocol
- **No force-push.** Never rewrite history
- **Max 2 retry loops** on quality failures. Auto-mode does not retry indefinitely
- **Proactive leftover scan** (Step 4) always runs. This is the primary input in auto-mode since the user interview is skipped

### Activation

```
/hatch3r revision --auto
```

### Session Report

At the end of an auto session (or any session when `--auto` is active), generate a summary:

```
Revision Session Report:
  Findings: {N} total ({critical}/{important}/{cleanup}/{cosmetic})
  Fixed: {N}
  Deferred: {M} (written to todo.md)
  Quality agents spawned: {list}
  Quality gate status: {pass/fail}
  Commits: {N}
  Learnings captured: {count}
  Overall confidence: {high/medium/low}
```

---

## Error Handling

> Platform-specific CLI commands: see `commands/board/shared-{platform}.md` for fallback chains

- **Git diff failure**: If `git diff` fails (e.g., no commits on branch, detached HEAD), **ASK** the user for the correct branch or base ref.
- **No changes detected**: If the diff is empty, inform the user and exit. There is nothing to revise.
- **PR/issue fetch failure**: Retry once using the platform CLI. If retry fails, proceed without PR/issue context. Work from the diff alone. Warn the user that acceptance criteria are unavailable.
- **Sub-agent failure**: Retry once. If the retry fails, fall back to direct implementation for that finding.
- **Quality check failure after 2 retries**: Present the specific failures and **ASK** the user whether to proceed with a partial fix commit or continue debugging.
- **Push failure**: Present the error. Common fixes: `git push -u origin {branch}` for new branches, `git pull --rebase` for diverged branches.
- **Context degradation (>25 turns)**: Suggest starting a fresh chat with a progress summary. The revision command is designed for fresh contexts — it can be re-run.
- **Board sync failure** (when board context exists): Warn and continue. Board sync is advisory in revision — it does not block the fix pipeline.

---

## Guardrails

- **Never skip ASK checkpoints** (unless auto-advance mode is active for that specific checkpoint).
- **Never skip the proactive scan (Step 4)** — even if the user reports no issues. Agents leave leftovers.
- **Always run quality checks (Step 7)** before committing. Never commit code that fails lint, typecheck, or tests.
- **Stay within the revision scope.** Fix what was reported and what the scan found. Do not refactor unrelated code, add new features, or expand beyond the original implementation's intent.
- **Always commit and push** at the end of a revision cycle. The user invoked this command to get fixes merged — do not exit without committing (unless the user explicitly abandons).
- **Respect the original implementation's architecture.** Revision fixes issues within the existing patterns. If the architecture itself is flawed, note it as a finding but do not restructure — suggest a separate refactor instead.
- **One sub-agent per concern.** Delegate to specialist sub-agents based on finding type. Do not ask the implementer to also fix lint issues or write tests.
- **Git safety.** Never force-push. Never rewrite history. Always create new commits for revision changes.
- **This command composes existing hatch3r agents** — it does not replace them. The reviewer, implementer, lint-fixer, and test-writer agents handle the actual work.
- **Critical findings default to FIX NOW.** If the user overrides this, execute the Critical Deferral Protocol (Step 5b): structured warning with specific risk, require written rationale, record in todo.md with `Critical-deferred` tag, and flag for elevated triage in board-fill. The user is never blocked — rationale adds accountability, not a veto.
- **Deferred findings go to `todo.md`, not directly to GitHub/GitLab/Azure DevOps issues.** The board-fill pipeline handles triage, epic creation, dependency analysis, and readiness assessment. Revision does not shortcut this process.
- **Always format deferred items as a single epic block** in `todo.md`, regardless of count. This groups them together during the next board-fill run.
