---
name: h4tcher-capability-discover
description: Pre-flight read-only scan for a planned capability change — maps what exists, what would collide, and which pillar gap a new artifact would close.
effort: medium
allowed-tools: Read Grep Glob Bash(wc *) Bash(grep *) Bash(ls *) Bash(cat *) Bash(git status *) Bash(git branch *) Bash(jq *) WebSearch WebFetch
triage_tiers: [1, 2, 3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
---

> Last updated: 2026-06-06

# Capability Discover (Maintainer, Read-Only)

Investigative preset. Run first when scoping any add / refactor / remove. Produces a structured report; writes no files in the repo. Workspace files under `.audit-workspace/` are allowed for T2/T3 sub-agent slices.

## Step 0: Triage

Classify the request before any scan:

- **T1** — single artifact type in scope (e.g., "is there already an agent for X?"). Inline scan; skip Step 4.
- **T2** — 2-3 artifact types or one cross-reference dimension. 3 parallel sub-agents per Step 4.
- **T3** — multi-pillar surface (e.g., touches agents + adapters + governance). 3 parallel sub-agents per Step 4 plus pillar-gap analysis.

Record the tier in the Step 7 report header.

## Step 1: Preflight

1. Confirm clean working tree: `git status --short` returns empty.
2. Cache governance lean limits from `governance/CONSTITUTION.md` §2 P5.
3. Resolve target artifact type(s) from the prompt: agent, skill, rule, command, hook, adapter, pipeline module, governance file.
4. Note current branch: `git branch --show-current`.

## Step 2: Discover / Duplication Scan

5. Read `governance/inventory.json` — extract counts and ids for each artifact directory.
6. Grep across the canonical content surface for the target intent's keywords:
   ```bash
   grep -RIn --include='*.md' '<keyword1>\|<keyword2>' \
     agents/ skills/ rules/ commands/ hooks/ \
     checks/ prompts/ github-agents/ \
     src/adapters/ src/content/
   ```
7. Cross-check candidates against the D16.3 overlap criteria in `governance/audit/domains/D16-compound-system.md` (definition + add-vs-remove bias check). Record each candidate's overlap dimension (purpose / scope / pillar / referenced files) and a rough percentage estimate.
8. Count inbound cross-references for each candidate via `grep -RIn "<candidate-id>"` across the same surface plus `governance/`, `docs/`, `docs-site/`, `tests/`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`.

## Step 3: Web Research

Per `agents/shared/rigor-contract.md` §"Web Research Mandate": ≥2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency window (≤90 days for CVE, ≤12 months for vendor docs, ≤36 months for peer-reviewed). Sources recorded in Step 7. **Skip when no empirical claim is being investigated** (most pure-overlap scans).

## Step 4: Sub-Agent Dispatch (T2 / T3 only)

Spawn 3 parallel `Task` sub-agents. Slice the surface so file scopes are disjoint:

| Slot | Scope | Output |
|------|-------|--------|
| A | `agents/`, `skills/` | `.audit-workspace/capability-discover-a.md` |
| B | `commands/`, `hooks/`, `rules/` | `.audit-workspace/capability-discover-b.md` |
| C | `src/adapters/`, `src/content/` | `.audit-workspace/capability-discover-c.md` |

Each sub-agent prompt MUST include: discovery slice from Step 2, the h4tcher-development context block (pillar test, lean thresholds, anti-slop wordlist ref, commit format) modeled on `.claude/skills/h4tcher-pr-resolve/SKILL.md`, the confidence-with-basis requirement from the rigor contract, and an explicit "no branches, no commits, no PRs, read-only" guardrail. T1 skips this step entirely.

Fan-out is task-derived (P8 B2): 0 sub-agents on T1, 3 on T2/T3. Token cost never serializes independent work (`.claude/rules/fan-out-discipline.md` Cost-dominance clause). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output (the `Sub-agents` field of the Step 7 report; `task_structure: parallelizable` — the T2/T3 scan slices are read-only and disjoint).

## Step 5: Cross-Skill Delegation

None. This preset is purely investigative — no delegation to `h4tcher-content-author`, `h4tcher-adapter-author`, or `h4tcher-domain-author`. The Step 7 report's "recommended next preset" field tells the maintainer which lifecycle preset to invoke next.

## Step 6: Governance Gates (light)

9. Re-read the report draft; remove any banned anti-slop phrase before emission (wordlist mirrored in `CLAUDE.md` and `.claude/rules/anti-slop-enforcement.md`).
10. `wc -l` the rendered report — hard ceiling 150 lines (target 80).
11. Verify every duplication candidate cites a concrete file path (with line number when relevant).
12. Skip `npm run validate` / `npm test` — this preset writes nothing to the repo.

## Step 7: Output (Capability Discovery Report)

Emit in chat using this exact template:

```
Capability Discovery Report
---------------------------
Tier: T1 | T2 | T3
Target intent: <one line — what the maintainer is scoping>
Candidate types: <agent | skill | rule | command | hook | adapter | pipeline | governance>
Pillar(s) served: P<n>[, P<n>, ...]

Duplication candidates (K):
  <file:line> — <overlap dimension> — <est. overlap %>
  ...

Cross-reference impact: <total inbound references across candidates>
Pillar coverage delta: <gap closed | gap unchanged | risk of redundant coverage>
Sub-agents: count=<0|3>, rationale=<one-line task-decomposition justification>

Recommended next preset: <h4tcher-capability-add | h4tcher-capability-refactor | h4tcher-capability-remove | no action | h4tcher-scoped-audit>

Sources (if Step 3 ran): <per-claim citations with trust tier + recency>
Confidence: high | medium | low — <basis: source count, overlap signal strength>
```

No files written to the repo; workspace slices remain under `.audit-workspace/`.
