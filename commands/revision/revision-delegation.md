---
id: hatch3r-revision-delegation
type: command
description: Fix delegation protocol for revision Step 6. Covers complexity-aware grouping, blast radius context, sub-agent prompt templates, and cross-agent conflict resolution.
tags: [implementation, team]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Revision — Fix Delegation (Step 6)

Delegation details for Step 6 of `hatch3r-revision`. Referenced from the core command file.

---

## 6.pre: Complexity Assessment

Before delegating [FIX NOW] findings, score the aggregate fix batch using `hatch3r-deep-context` complexity signals. Score across the full set of findings, not per-finding:

| Signal | Weight | Detection |
|--------|--------|-----------|
| Findings span multiple modules/layers | +3 | Count distinct directories across all [FIX NOW] findings |
| Any finding involves behavioral contract changes (API, types, events) | +2 | Check finding descriptions for interface/signature changes |
| Findings touch security-sensitive areas (auth, payments, data access) | +2 | Match affected files against security-sensitive directories |
| Total affected files > 5 | +2 | Count distinct files across all findings |
| Any finding requires new dependencies or integrations | +2 | Check whether fixes introduce new imports or services |

### Tier Assignment

| Total Weight | Tier | Action |
|-------------|------|--------|
| 0–2 | 1 (Light) | Proceed directly to 6a. No research needed |
| 3–5 | 2 (Standard) | Spawn `hatch3r-researcher` with `similar-implementation` at `quick` depth before delegating. Use discovered reference patterns to inform fix conventions |
| 6+ | 3 (Deep) | Spawn `hatch3r-researcher` with `codebase-impact` at `deep` depth. **Warn the user** that fix scope may warrant a new board issue rather than a revision fix |

For Tier 2/3: cache researcher output (reference conventions, blast radius data) for inclusion in sub-agent prompts below.

---

## 6a. Group Findings by Specialist

| Finding Category | Sub-Agent | Protocol |
|-----------------|-----------|----------|
| Bugs, missing features, error handling, logic fixes | `hatch3r-implementer` | hatch3r-implementer agent protocol |
| Dead code, unused imports, type fixes, lint errors | `hatch3r-lint-fixer` | hatch3r-lint-fixer agent protocol |
| Missing tests, insufficient coverage | `hatch3r-test-writer` | hatch3r-test-writer agent protocol |

### Blast-Radius-Aware Grouping

When multiple findings affect the same file or module, batch them to a single sub-agent to avoid cross-agent file conflicts:

1. Build a file-to-findings map from all [FIX NOW] items.
2. Findings in the same file go to the same sub-agent instance, even if they span categories (use the highest-priority specialist: implementer > lint-fixer > test-writer).
3. Findings in disjoint files can run in parallel sub-agents.
4. If findings span independent areas within the same specialist type, spawn one sub-agent per area to parallelize.

---

## 6b. Spawn Sub-Agents

Use the Task tool with `subagent_type: "generalPurpose"`. Launch independent sub-agents in parallel.

Each sub-agent prompt MUST include:

1. The specific findings to address (file paths, line numbers, descriptions, expected behavior).
2. Instruction to follow the corresponding agent protocol (e.g., "Follow the hatch3r-implementer agent protocol").
3. All `scope: always` rule directives from `.agents/rules/` — sub-agents do not inherit rules automatically.
4. Acceptance criteria from linked issues (if available from Step 1b).
5. Relevant learnings from `.agents/learnings/` (if found in Step 1d).
6. Explicit instruction: do NOT create branches, commits, or PRs.
7. Confidence expression requirement: rate every recommendation and finding as high/medium/low confidence per the quality charter (`agents/shared/quality-charter.md`). High = verified against current code. Medium = pattern-based, not fully verified. Low = best judgment, recommend human review.
8. Revision-specific constraint: "You are fixing existing code, not implementing new features. Stay within the architecture established by the original implementation."

**When Tier 2/3 research was performed (6.pre):**

9. Reference conventions from `similar-implementation` output — triggers the implementer's Convention Lock step.
10. Blast radius data from `codebase-impact` output (Tier 3) — transitive dependency trace informing which consumers and contracts the fix must preserve.

---

## 6c. Await and Integrate Results

1. Await all sub-agents. Collect their structured results (files changed, tests written, issues encountered).
2. If any sub-agent reports BLOCKED or PARTIAL, **ASK** the user how to proceed (skip, provide guidance, fix manually).

### Cross-Agent Conflict Resolution

When sub-agents modified overlapping files:

- **Disjoint regions** (different functions, different sections): accept both sets of changes.
- **Overlapping regions** (same function or block): merge using the larger-scope change as the base, applying the smaller change on top. If merging is ambiguous, present both versions to the user.
- **Semantic conflicts** (contradictory logic): surface to the user with both sub-agents' rationale. Do not auto-resolve semantic conflicts.

3. Apply all resolved changes to the working tree.
4. Update the run cache with fix results (files changed, findings addressed).
