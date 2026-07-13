---
id: shared-efficiency-patterns
type: reference
description: Portable, model-agnostic patterns for token efficiency and runtime speed in end-user agentic flows. Referenced by agents and orchestrators via `efficiency_patterns:` frontmatter.
tags: [shared, efficiency, p7]
cache_friendly: true
---

## Efficiency Patterns

> Last updated: 2026-07-12

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

**P1. Static-first prompt structure.** Do this: place tool definitions, role, contracts, and examples at the top of every artifact; place variable inputs (issue body, diff, user message) at the bottom. Verification: `scripts/validate-efficiency-invariants.ts --static-first` scans the first 80 body lines in two bands — a bare volatile-token match in the preamble before the first `##` heading, and a template-substitution form (e.g. `{{timestamp}}`, `${run_id}`) after it (Cycle 11 D6-10 widened the scan from 60 lines to this whole-body-to-80 model).

**P2. Parallel-tool-by-default.** Do this: when two or more tool calls have no data dependency, emit them in a single assistant turn rather than serial turns. Verification: `scripts/validate-efficiency-invariants.ts --parallel-tool` **errors** (promoted from warning at Cycle 9 D6-M9) when an artifact has >=2 tool/sub-agent mentions with no parallel-dispatch directive within 3 lines of a mention and no `parallel_tool_default: true` frontmatter flag.

**P3. Triage-first orchestration.** Do this: every command with `orchestrator: true` classifies inputs into Tier 1 (trivial, single-agent), Tier 2 (standard pipeline), or Tier 3 (research-first) before delegating. Verification: `scripts/validate-efficiency-invariants.ts --triage-first` requires a `triage_tiers` array in frontmatter and a Triage/Tier/Scale Assessment heading in body.

**P4. Plan/Act split.** Do this: implementer, fixer, architect, and creator agents produce a plan artifact and pause for confirmation before mutating files when scope exceeds one file OR 50 lines (D6-M10 trigger). Specifically, on entering the Implementation Protocol (or equivalent in fixer/architect/creator):

  1. Compute the planned-scope vector: count of distinct files to be written/edited, AND total LOC delta across all planned changes (sum of inserts + deletes).
  2. If `files > 1` OR `loc_delta > 50`, the agent MUST emit a `## Plan` block (file list + change shape per file) and pause for the orchestrator's confirmation BEFORE issuing any Edit/Write/MultiEdit tool call.
  3. Single-file changes ≤ 50 LOC may skip the Plan block and act directly (the Tier-1 carve-out for `hatch3r-quick-change`).
  4. `plan_act_split: triggered` is recorded via the Pattern Rationale block of the recap-contract Iteration Summary (`rules/hatch3r-iteration-summary.md`); a skipped split stays silent — silence asserts the skip — so reviewer / audit can verify the taken path.

Verification: this trigger is enforced by the agent body's "Scope Trigger" section — audited under D06 sub-agent 6.5; the audit checks the four code-mutating agents (`implementer`, `fixer`, `architect`, `creator`) for the trigger declaration.

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

### Cost-scaling heuristic by repo size (D6-M5)

Researcher and impact-analysis modes apply a repo-size budget before issuing breadth scans (`grep`, `find`, codebase enumeration). Repo size is measured by tracked-file count from `git ls-files | wc -l`; pick the row matching the current repo:

| Repo size | Tracked files | Default research depth | Per-mode scan budget |
|-----------|--------------:|------------------------|----------------------|
| Small | <100 | `deep` permitted | Unbounded — whole-repo scans acceptable |
| Medium | 100–500 | `standard` default | Cap at 50 files per mode; deep-read up to 10 |
| Large | 500–2000 | `standard` capped | Cap at 25 files per mode; deep-read up to 5; targeted globs required |
| Very large | >2000 | `quick` default | Cap at 10 files per mode; deep-read up to 3; refuse breadth scans without a glob |

When a researcher mode would exceed its row's cap on the current repo, the mode must (a) narrow to a glob covering the smallest set of files plausibly relevant to the brief, or (b) escalate via the `requirements-elicitation` mode (`agents/modes/requirements-elicitation.md`) to confirm scope with the user before scanning further. Cost-budget breaches without escalation are a P7 (B2) finding.

Override path: the orchestrator may pass an explicit token budget in the research brief that supersedes the row's cap. Document the override in the result's Notes section so the budget decision is auditable.

### Managed-block markers and caching (D6-M13)

The `HATCH3R:BEGIN` / `HATCH3R:END` markers used by adapter outputs (see `src/merge/managedBlocks.ts`) are positionally inert for prompt-caching purposes. They are HTML/YAML comments invisible to the LLM. Every supported provider's cache (Anthropic `cache_control`, OpenAI Responses prefix cache, Google Gemini implicit cache) hashes the raw byte stream of the prompt, not its logical structure — so two outcomes follow:

1. Editing user content above or below the managed block does NOT invalidate the provider cache as long as the hatch3r-owned content inside the block remains byte-stable.
2. Reordering hatch3r-owned content inside the markers DOES invalidate the cache even when the markers stay in place — the cache hash sees the raw bytes, not the section labels.

Cache-friendly ordering is achieved at the adapter layer by keeping static frame content (role, tools, contracts) above variable inputs across the full adapter output. The markers themselves are scope delimiters for the merge layer, not cache hints.

### References

- Anthropic Prompt Caching documentation (2025)
- OpenAI Prompt Caching guide (2025)
- Google Gemini Caching overview (2025)
- arXiv: SWE-Bench compression studies (2026) and Plan-and-Act (2025)
- Anthropic effective context engineering (2025)
