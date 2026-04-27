---
id: shared-efficiency-patterns
type: reference
description: Portable, model-agnostic patterns for token efficiency and runtime speed in end-user agentic flows. Referenced by agents and orchestrators via `efficiency_patterns:` frontmatter.
tags: [shared, efficiency, p7]
---

## Efficiency Patterns

> Last updated: 2026-04-27

### Purpose

This file lists the eight P7 efficiency patterns referenced by agents, orchestrator commands, and skills. The [quality charter](./quality-charter.md) dominates on conflict — efficiency must not weaken confidence calibration, root-cause reporting, or contract preservation.

### The 8 Patterns

| # | Pattern | Statement | Primary applies-to |
|---|---------|-----------|--------------------|
| P1 | Static-first prompt structure | Stable framing first, variable inputs last | agents, orchestrator commands, prompts |
| P2 | Parallel-tool-by-default | When >=2 tool calls are independent, dispatch in one turn | agents, orchestrator commands |
| P3 | Triage-first orchestration | Tier 1/2/3 classification before delegation | orchestrator: true commands |
| P4 | Plan/Act split | Plan output then act-confirm for non-trivial work | implementer/fixer/architect/creator agents |
| P5 | Structured outputs over prose | Tables for multi-attribute lists, JSON for handoff | all artifacts where applicable |
| P6 | Lazy loading / reference-by-pointer | Reference shared content; do not embed | all artifacts |
| P7 | Conditional skill/rule loading | Load only what the task requires | agents that delegate, orchestrator commands |
| P8 | Diff-only outputs | Unified diff for code edits, full content only for new files | code-producing agents and skills |

### Pattern detail

**P1. Static-first prompt structure.** Do this: place tool definitions, role, contracts, and examples at the top of every artifact; place variable inputs (issue body, diff, user message) at the bottom. Verification: `scripts/validate-efficiency-invariants.ts --static-first` scans the first 60 lines for volatile-token regex hits.

**P2. Parallel-tool-by-default.** Do this: when two or more tool calls have no data dependency, emit them in a single assistant turn rather than serial turns. Verification: `scripts/validate-efficiency-invariants.ts --parallel-tool` warns when an artifact has >=2 tool/sub-agent mentions without a parallel-dispatch directive nearby.

**P3. Triage-first orchestration.** Do this: every command with `orchestrator: true` classifies inputs into Tier 1 (trivial, single-agent), Tier 2 (standard pipeline), or Tier 3 (research-first) before delegating. Verification: `scripts/validate-efficiency-invariants.ts --triage-first` requires a `triage_tiers` array in frontmatter and a Triage/Tier/Scale Assessment heading in body.

**P4. Plan/Act split.** Do this: implementer, fixer, architect, and creator agents produce a plan artifact and pause for confirmation before mutating files when scope exceeds one file or 50 lines. Verification: convention-only — audited under D06 sub-agent 6.5 (no automated check).

**P5. Structured outputs over prose.** Do this: use markdown tables for any list with >=2 attributes per item; use JSON code blocks for inter-agent handoff payloads. Verification: convention-only — audited under D06 sub-agent 6.5 (no automated check).

**P6. Lazy loading / reference-by-pointer.** Do this: link to `agents/shared/*`, `rules/*`, `skills/*` rather than copying their content; embed only when the artifact is invoked without filesystem access. Verification: convention-only — audited under D06 sub-agent 6.5 (no automated check).

**P7. Conditional skill/rule loading.** Do this: agents and orchestrator commands load only the skills and rules required by the current invocation; `scope: always` rules apply globally, tagged rules load only when their tag matches the task. Verification: convention-only — audited under D06 sub-agent 6.5 (no automated check).

**P8. Diff-only outputs.** Do this: code-producing agents emit unified diffs for edits to existing files and full content only for new files. Verification: convention-only — audited under D06 sub-agent 6.5 (no automated check).

### Conservative bias clause

> Patterns must never override the quality charter. If applying a pattern would weaken confidence calibration, root-cause analysis, contract preservation, or any other charter directive, do not apply it. The quality charter is the dominant contract. When in doubt, do not optimize.

Error toward keeping content over removing it. Apply patterns through structural compliance only — section ordering, table form, frontmatter declarations.
Auto-rewrite of prose to fit a pattern is forbidden; structural moves are reversible, semantic edits are not. Sub-agents that detect a conflict between a pattern and the quality charter skip the pattern, log the skip in their structured output under `efficiency_skips`, and report the conflict rather than risk semantic loss.
A pattern skip is never a finding by itself — only a pattern conflict that the sub-agent fails to surface counts as a regression.

### Cross-platform notes

| Pattern | Auto-benefit on these adapters | Required everywhere? |
|---------|--------------------------------|----------------------|
| P1 Static-first | Anthropic prompt caching, OpenAI Responses caching, Google Gemini implicit caching | yes |
| P2 Parallel tools | All adapters where the host LLM supports parallel tool use | yes |
| P3-P7 | All adapters | yes |
| P8 Diff-only | All adapters except line-by-line autocomplete (e.g. github-agents/copilot) | conditional |

### References

- Anthropic Prompt Caching documentation (2025)
- OpenAI Prompt Caching guide (2025)
- Google Gemini Caching overview (2025)
- arXiv: SWE-Bench compression studies (2026) and Plan-and-Act (2025)
- Anthropic effective context engineering (2025)
