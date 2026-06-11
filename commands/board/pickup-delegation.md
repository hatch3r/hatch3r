---
id: hatch3r-board-pickup-delegation
type: command
description: Single-issue sub-agent delegation protocol for board-pickup Step 6a. Covers research, implementation, and quality pipeline for standalone issues.
tags: [board, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Board Pickup — Single-Issue Delegation (Step 6a)

Delegation details for Step 6a of `hatch3r-board-pickup`. Referenced from the core command file.

---

## 6a. Single Standalone Issue -- Subagent Delegation

For a single standalone issue (no sub-issues, not part of a batch), follow this three-phase approach: research, delegate to implementer, then specialist review.

### 6a.1. Context Gathering (Researcher Subagent)

**Skip this step only** for trivial single-line edits (typos, comment fixes, single-value config changes) that score Tier 1 per `hatch3r-deep-context`. The `risk:low` and `priority:p3` labels alone are not sufficient to skip research — always score complexity first.

**Score the issue's complexity** per the `hatch3r-deep-context` rule to determine the analysis tier (Light / Standard / Deep). This determines which additional researcher modes to include alongside the standard task-type modes.

Spawn a **hatch3r-researcher** sub-agent via the Task tool (`subagent_type: "generalPurpose"`) with:

- **Research brief:** The issue title, body, acceptance criteria, and area labels.
- **Modes by issue type:**
  - `type:bug` → `symptom-trace`, `root-cause`, `codebase-impact`
  - `type:feature` → `codebase-impact`, `feature-design`, `architecture`
  - `type:refactor` → `current-state`, `refactoring-strategy`, `migration-path`
  - `type:qa` → `codebase-impact`
  - `type:docs` → `codebase-impact`
  - `type:infra` → `codebase-impact`, `risk-assessment`
- **Tier-adjusted modes** (per `hatch3r-deep-context`):
  - Tier 2: add `requirements-elicitation` + `similar-implementation` at `quick` depth
  - Tier 3: add `requirements-elicitation` + `similar-implementation` at `deep` depth, plus `codebase-impact` at `deep` depth with transitive tracing
- **Depth:** `quick` for `risk:low`, `standard` for `risk:med`, `deep` for `risk:high`. The complexity tier may override depth upward.
- **Project context:** Pre-loaded documentation references from area labels.

Await the researcher result. Use its structured output to inform Steps 6a.2-6a.3.

**For Tier 2:** Present the `requirements-elicitation` questions to the user inline and await answers before proceeding to 6a.2.

**For Tier 3:** Present a full Pre-Implementation Summary per the `hatch3r-deep-context` rule. Do NOT proceed to 6a.2 until all unresolved questions are answered.

### 6a.2. Core Implementation (Implementer Subagent)

You MUST spawn a **hatch3r-implementer** sub-agent via the Task tool (`subagent_type: "generalPurpose"`). Do NOT implement inline — always delegate to a dedicated implementer to preserve orchestrator context for coordination, review, and integration.

The implementer sub-agent prompt MUST include:
- The issue number, title, full body, and acceptance criteria.
- The issue type (bug/feature/refactor/QA) and corresponding hatch3r skill name.
- The researcher output from Step 6a.1 (if that step was not skipped).
- **Reference conventions** from `similar-implementation` output (Tier 2/3) — triggers the implementer's Convention Lock step.
- **Resolved requirements** from `requirements-elicitation` answers (Tier 2/3) — explicit decisions on ambiguities.
- **Blast radius data** from enhanced `codebase-impact` (Tier 3) — transitive dependency trace and API consumer map.
- Documentation references relevant to this issue.
- Instruction to follow the **hatch3r-implementer agent protocol**.
- All `scope: always` rule directives from `rules/` — subagents do not inherit rules automatically.
- Relevant learnings from `.hatch3r/learnings/` (from Step 6.pre).
- Explicit instruction: do NOT create branches, commits, or PRs.
- `correlation_id` (UUID v4 generated per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID; epic sub-issues get individual ids, batch tasks share one id with a sub-task index).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Await the implementer sub-agent. Collect its structured result (files changed, tests written, issues encountered).

### 6a.3. Post-Implementation Quality Pipeline

After implementation completes, run the two-stage quality pipeline. Use the Task tool with `subagent_type: "generalPurpose"`.

**Stage 1 — Review Loop (sequential):**

1. Spawn **`hatch3r-reviewer`** — code review of all changes. Include the diff and acceptance criteria in the prompt. The reviewer sub-agent output MUST include a top-level `confidence: high | medium | low` field (not just per-finding) so the gate in step 4 can evaluate it deterministically.
2. If the reviewer reports Critical or Warning findings, spawn **`hatch3r-fixer`** with the reviewer output to apply fixes. When fixes touch shared or public interfaces, also include:
   - **Blast radius data** from Step 6a.1 (if available) — so the fixer knows which consumers and contracts must be preserved.
   - **Reference conventions** from Step 6a.1 (if available) — so the fixer maintains established patterns when applying fixes.
3. Re-spawn **`hatch3r-reviewer`** to verify fixes.
4. Repeat steps 2-3 for a maximum of **3 iterations** until the confidence-aware gate passes. Evaluate the gate per the canonical **Confidence-Aware Review Gate** in `agents/shared/confidence-gate.md`, passing in the resolved `--confidence-floor` (`any` | `medium` | `high`) routed here from `hatch3r-board-pickup` → Confidence Floor. At the default `any` floor: **0 Critical + 0 Warning AND reviewer confidence != low**; if reviewer confidence is low with no Critical/Warning findings, trigger a second reviewer pass before exiting and do not exit until the second pass returns non-low confidence OR the user explicitly accepts the low-confidence PASS. At floor `medium` the pass surface is unchanged; at floor `high` a `medium`-confidence clean verdict also forces a second pass (and any low-confidence finding triggers an ASK) — apply the floor-tier branches from the shared gate, do not collapse them to the `any` row.
   After each reviewer iteration, assess the reviewer's findings confidence: if the reviewer rates any finding as low-confidence, flag it separately in the ASK prompt so the user can prioritize human review of uncertain findings.
5. If still not clean after 3 iterations, **ASK** the user how to proceed.

**Stage 2 — Final Quality (parallel, after review loop is clean):**

Launch as many independent sub-agents in parallel as the platform supports.

**Always spawn (mandatory for every code change):**
- **hatch3r-testability** (CQ5) — verify tests for all code changes meet the mandate map / coverage floor. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
- **hatch3r-security** (CQ3) — security review of all code changes. Audit data flows, access control, input validation, and secret management.

**Always evaluate (spawn when applicable):**
- **hatch3r-docs-writer** — spawn when changes affect public APIs, architectural patterns, or user-facing behavior. Skip silently if no documentation impact.

**Conditional specialists (spawn when triggered):**
- **hatch3r-lint-fixer** — spawn when lint errors are present after implementation.
- **hatch3r-ui** (CQ1) — spawn when issue has `area:ui` or `area:a11y` labels.
- **hatch3r-performance** (CQ7) — spawn when issue has `area:performance` label or changes touch hot paths.

Each specialist sub-agent prompt MUST include:
- The agent protocol to follow (e.g., "Follow the hatch3r-reviewer agent protocol").
- All `scope: always` rule directives from `rules/` (subagents do not inherit rules automatically).
- The diff or file changes to review.
- The issue's acceptance criteria.
- `correlation_id` (UUID v4 per top-level task per `rules/hatch3r-agent-orchestration.md` → Correlation ID).
- Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.

Await all specialist sub-agents. Apply their feedback (fixes, additional tests, documentation updates) before proceeding to Step 7.
