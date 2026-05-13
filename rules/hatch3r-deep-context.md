---
id: hatch3r-deep-context
type: rule
description: Adaptive pre-implementation analysis — complexity scoring, requirements elicitation, similar implementation discovery, and transitive dependency tracing before coding
scope: always
tags: [core]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Deep Context Analysis

Before implementing any non-trivial task, assess its complexity and run proportional pre-implementation analysis. This rule ensures the agent asks the right questions, discovers existing patterns to follow, and maps the full blast radius before writing code.

## Complexity Scoring

Score every task against these signals before implementation. Each signal adds weight:

| Signal | Weight | Detection |
|--------|--------|-----------|
| Multiple modules/layers touched (data + API + UI, etc.) | +3 | Count distinct architectural layers in the task description and affected files |
| Vague or underspecified terms ("improve", "better", "proper", "handle", "support", "clean up") | +2 | Scan task description for ambiguous language |
| Cross-cutting concerns triggered (auth, i18n, a11y, payments, migrations, observability) | +2 | Match task against known cross-cutting domains |
| Epic or multi-issue scope | +3 | Task references multiple issues, contains numbered sub-tasks, or spans multiple features |
| New dependency or integration introduction | +2 | Task mentions new libraries, services, or external APIs |
| Estimated file count > 5 | +2 | Infer from task scope and codebase exploration |
| Security-sensitive area (auth, payments, data access, secrets) | +2 | Match task against security-sensitive directories or keywords |
| Behavioral contract change (API signature, event schema, type interface) | +2 | Task implies changes to shared interfaces or public APIs |

### Tier Assignment

| Total Weight | Tier | Label |
|-------------|------|-------|
| 0–2 | 1 | Light |
| 3–5 | 2 | Standard |
| 6+ | 3 | Deep |

## Tier Actions

### Tier 1 — Light

Single-file changes, config tweaks, typo fixes, comment edits, constant value changes. No additional analysis required beyond existing researcher modes.

Skip deep context analysis entirely. Proceed with the standard pipeline.

### Tier 2 — Standard

Multi-file changes with clear scope. Run these researcher modes at `quick` depth before implementation:

1. **`requirements-elicitation`** at `quick` — scan for top ambiguities and ask 3–5 clarifying questions.
2. **`similar-implementation`** at `quick` — find 1 reference implementation and extract top-level patterns.

Present findings to the user inline. Proceed after answers are received — no separate confirmation checkpoint required.

### Tier 3 — Deep

Cross-module features, architectural changes, multi-layer implementations, or tasks with high ambiguity. Run these researcher modes at `deep` depth:

1. **`requirements-elicitation`** at `deep` — full 10-dimension ambiguity scan, dependency-derived questions, cross-cutting concern checklist.
2. **`similar-implementation`** at `deep` — find 2–3 reference implementations, full convention extraction, divergence analysis.
3. **`codebase-impact`** at `deep` — full transitive dependency tracing, API consumer map, blast radius summary.

**Mandatory checkpoint:** Present a consolidated "Pre-Implementation Summary" to the user and ASK for confirmation before proceeding to implementation:

```
Pre-Implementation Summary:
  Complexity: Tier 3 (Deep) — score {N}
  Resolved requirements: {N}/{M} dimensions addressed
  Unresolved questions: {list — these MUST be answered before proceeding}
  Reference implementation: {name} — conventions locked
  Blast radius: {N} files directly affected, {M} transitively at risk
  Cross-cutting concerns: {list with status}
```

**Hard gate, not advisory.** Do NOT proceed to implementation until all unresolved questions are answered by the user AND the user has explicitly confirmed the Pre-Implementation Summary (a reply matching "proceed", "confirmed", "yes — implement", or an equivalent affirmation in context). Until that confirmation arrives, the orchestrator MUST NOT call `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`, `str_replace_based_edit_tool`, `apply_patch`, or any platform-equivalent code-writing tool, AND MUST NOT spawn `hatch3r-implementer` or `hatch3r-fixer`. Read-only and reasoning tools (`Read`, `Grep`, `Glob`, `Bash` for read-only commands, `WebFetch`, `WebSearch`, `Task` with researcher-only sub-agents) remain available so the orchestrator can answer follow-up clarifying questions without breaching the gate.

## Passing Context to Implementer

When the `similar-implementation` mode produces reference implementations, include them in the implementer sub-agent prompt as **"Reference Conventions"**. The implementer's Convention Lock step (Step 1b) uses these to align its architectural decisions with established codebase patterns.

When the `requirements-elicitation` mode produces resolved requirements, include the user's answers in the implementer sub-agent prompt as **"Resolved Requirements"** so the implementer has explicit answers to all ambiguities rather than guessing.

When the enhanced `codebase-impact` mode produces a blast radius summary, include it in the implementer sub-agent prompt so the implementer knows which consumers and contracts must be preserved.

## Integration with Existing Pipeline

This rule augments — not replaces — the existing Universal Sub-Agent Pipeline from `hatch3r-agent-orchestration`. The complexity scoring happens at the start of Phase 1 (Research), and the additional researcher modes run alongside the existing task-type modes:

- **`type:feature`**: existing modes `codebase-impact`, `feature-design`, `architecture` + new modes per tier
- **`type:bug`**: existing modes `symptom-trace`, `root-cause`, `codebase-impact` + `requirements-elicitation` per tier (bugs often have underspecified reproduction steps)
- **`type:refactor`**: existing modes `current-state`, `refactoring-strategy`, `migration-path` + `similar-implementation` per tier (refactors benefit most from convention alignment)

## Scoring Examples

To reduce ambiguity in tier assignment, here are worked examples:

**Example 1: "Fix typo in error message" -- Tier 1 (score 0)**
No signals triggered. Single file, no cross-module impact, no ambiguity.

**Example 2: "Add email validation to signup form" -- Tier 2 (score 4)**
- Multiple layers touched (API + UI): +3
- Estimated 2-3 files: +0
- Input validation is security-adjacent but not in a security-sensitive area: +0
- Clear requirements ("validate email format"): +0
- May trigger cross-cutting i18n for error messages: +1 (partial cross-cutting)

**Example 3: "Migrate auth from session-based to JWT" -- Tier 3 (score 12)**
- Multiple layers (auth middleware + API + UI + storage): +3
- Vague term "migrate" (scope unclear): +2
- Cross-cutting auth concern: +2
- Security-sensitive area: +2
- Behavioral contract change (session API to JWT API): +2
- Estimated >5 files: +1 (partial -- easily >5)

When a signal partially applies (e.g., "maybe 5 files, maybe 4"), round down. Tier upgrades from adaptation (see `hatch3r-agent-orchestration-detail`) compensate for underestimates.

## Exceptions

- **`hatch3r-quick-change` command**: Tier 1 items proceed without research. Tier 2 items get lightweight `similar-implementation` at `quick` depth. Tier 3 items must be routed to `hatch3r-workflow` (hard block).
- **Trivial single-line edits**: Always Tier 1 regardless of scoring signals. This is the only valid basis for skipping research -- label-based shortcuts (e.g., `risk:low AND priority:p3`) are not sufficient alone.
- **`hatch3r-revision` command**: Operates on already-implemented code. Deep context analysis applies to the original implementation, not the revision pass.
