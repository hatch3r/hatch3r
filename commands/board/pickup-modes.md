---
id: hatch3r-board-pickup-modes
type: command
description: Auto-advance mode, error handling, and guardrails for board-pickup. Covers --auto/--unattended operation, safety guardrails, and specification generation.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Pickup — Modes, Guardrails, and Error Handling

Supplementary protocols for `hatch3r-board-pickup`. Referenced from the core command file.

---

## Specification Generation (Step 3b — Optional)

When the picked issue lacks a detailed specification, generate one before implementation:

### When to Generate

- Issue body has acceptance criteria but no implementation spec
- Issue is type `feature` or `refactor` (bugs typically don't need specs)
- Issue has complexity label `complex` or `epic`

### Specification Generation Process

1. **Analyze the issue**: Parse title, body, labels, linked issues, and parent epic context.
2. **Research context**: Read relevant project documentation, existing code in the affected area, and related specs.
3. **Generate specification** with the following structure:

```
## Specification: #{issue_number} — {title}

### Problem Statement
{what needs to change and why}

### Proposed Solution
{high-level approach}

### Technical Design
- **Data model changes**: {new/modified schemas}
- **API changes**: {new/modified endpoints}
- **UI changes**: {new/modified components}
- **Dependencies**: {new libraries or services}

### Implementation Plan
1. {ordered steps}

### Test Strategy
- Unit: {what to unit test}
- Integration: {what to integration test}
- E2E: {what to E2E test}

### Risks & Mitigations
- {risk}: {mitigation}

### Out of Scope
- {explicitly excluded items}
```

4. **ASK:** Present the generated specification to the user for validation before proceeding to implementation.
5. **Store**: Save the validated spec as a comment on the issue for traceability.

### Skip Specification

Skip this step when:
- Issue already has a linked spec document
- Issue is a simple bug fix with clear reproduction steps
- Issue has `skip-spec` label
- Auto-advance mode is active (see below)

---

## Auto-Advance Mode

When invoked with `--auto` or `--unattended`, the board pickup operates with reduced human checkpoints for sustained autonomous operation.

### Behavior Changes in Auto Mode

| Checkpoint | Normal Mode | Auto Mode |
|-----------|-------------|-----------|
| Issue selection | ASK user to confirm | Auto-select highest priority ready issue(s); **auto-batch** independent issues up to `--max-batch` (default 4) |
| Specification generation | ASK user to validate | Auto-generate and attach, skip validation |
| Implementation plan | ASK user to review | Auto-proceed with plan |
| PR creation | ASK user to confirm | Auto-create PR |
| Review feedback | Wait for human review | Proceed to next issue/batch |

In auto mode, batch pickup is the default when multiple independent issues are available. The system auto-selects up to `--max-batch` independent issues and processes them in parallel via Step 6c.

### Safety Guardrails (Always Active)

These checkpoints are NEVER skipped, even in auto mode:
- **Destructive operations**: Database migrations, file deletions, security rule changes always require confirmation
- **Breaking changes**: API contract changes, public interface modifications always require confirmation
- **Cost thresholds**: Stop if estimated token cost exceeds configured limit (default: $10 per issue)
- **Error threshold**: Stop after 3 consecutive implementation failures
- **Scope limits**: Maximum 10 issues per auto session (configurable)

### Activation

```
/hatch3r board-pickup --auto
/hatch3r board-pickup --auto --max-issues=5 --cost-limit=20
/hatch3r board-pickup --auto --max-batch=4
```

### Session Report

At the end of an auto session, generate a summary:
- Issues completed: {count}
- Issues batched: {count per batch}
- PRs created: {list}
- Issues blocked: {list with reasons}
- Total estimated cost: {tokens/cost}
- Learnings captured: {count}

---

## Error Handling

> Platform-specific details: see `commands/board/pickup-github.md` (Error Handling)
> Platform-specific details: see `commands/board/pickup-azure-devops.md` (Error Handling)
> Platform-specific details: see `commands/board/pickup-gitlab.md` (Error Handling)

- **Implementer / sub-agent failure:** route through the shared sub-agent-failure clause (`rules/hatch3r-agent-orchestration.md` → Sub-agent-failure handling) — retry once; if the retry fails, re-spawn `hatch3r-fixer` with the failure reason + partial output as failure context; if the re-spawn also fails, emit `BLOCKED_OTHER` and ASK. Never fall back to inline implementation (issue #73 bypass mode).
- **Issue listing/search failure:** retry once, then ask user for issue number.
- **Issue update failure:** warn and continue (labels not blocking).
- **Quality verification failure:** max 2 fix attempts, then **ASK** the user for guidance: "Quality checks still failing after 2 fix attempts: {specific failures}. Fix confidence: {high/medium/low — based on whether root cause is identified}. Options: (a) commit the partial result and defer the issue, (b) keep trying, (c) abort." Do not loop unbounded before creating PR/MR.
- **PR/MR creation failure:** present error and manual instructions.
- **Context degradation:** per the canonical Context-Degradation Policy (`rules/hatch3r-agent-orchestration-detail.md` -> Context-Degradation Policy) — compress at `>50%` context window, restart at `>75%`; the coarse turn-count fallback (inherited from `hatch3r-workflow`) is ~25 turns, at which point suggest splitting the batch or starting a fresh context with a progress summary of completed and remaining issues. Per-sub-agent input budgets + distilled returns: `rules/hatch3r-context-budget.md`.

---

## Guardrails

- **Never skip collision check** (Step 3).
- **Never skip ASK checkpoints.**
- **Always work on a dedicated branch.** Never commit to the default branch.
- **Stay within scope.** Note related work but do not implement it.
- **One PR per pickup session.** A single issue, epic, or batch produces one PR. Split large epics into multiple PRs.
- **One sub-agent per issue.** Every issue MUST be delegated to its own `hatch3r-implementer` sub-agent -- never implement multiple issues inline. This applies to standalone issues (6a), epic sub-issues (6b), and batch issues (6c).
- **Maximize parallelism.** Launch as many independent sub-agents concurrently as the platform supports. Only serialize when dependency order or file conflicts require it.
- **Respect the issue-type skill** as source of truth for implementation.
- **Respect dependency and implementation order.** Warn and suggest blockers.
- **Prefer `status:ready` issues.** Warn if selecting non-ready.
- **Board Overview is auto-maintained.** Exclude from all analysis.
- **Always create a PR.** Every board-pickup session MUST end with a PR (Steps 7a-8) unless explicitly abandoned by the user or the epic is an audit that produces no code changes. If quality checks fail in Step 7, fix and re-run Step 7 within the 2-fix-attempt bound (Error Handling → Quality verification failure) -- do not exit without completing Steps 7a, 8, 8a, and 9, unless the user selects commit-partial-and-defer or abort at that ASK after 2 failed attempts.
