---
name: h4tcher-capability-refactor
description: Rename, split, merge, or restructure an existing canonical artifact with cross-reference scrubbing and an explicit rename-map deliverable.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit Task WebSearch WebFetch
triage_tiers: [1, 2, 3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
---

> Last updated: 2026-06-06

# Capability Refactor (Maintainer)

Lifecycle preset for renaming, splitting, merging, or restructuring an existing artifact (agent, skill, rule, command, hook, adapter, pipeline module, governance file). Owns the cross-reference scrubber. Stops before commit so the maintainer reviews the rename map and diff.

## §0.1: Ambiguity Gate (P8 B1)

Per CONSTITUTION §2 P8 B1: every framework-dev workflow mutating canonical artifacts detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven. Apply the protocol when any hold: (a) ambiguous scope (rename vs split vs merge unclear, or which artifact is the target), (b) multiple valid interpretations with materially different cross-reference blast radius, (c) irreversible action (public artifact id rename, frontmatter-field drop, `agentPipeline:` member rename), or (d) missing acceptance criteria (no rename map, no definition of done). Use the platform-native question tool; one question per turn; 2-4 numbered options with one-line trade-offs; declare the default-if-no-response. Do NOT proceed to Step 0 until resolved or the default is confirmed.

## Step 0: Triage

Classify the refactor scope first:

- **T1** — body restructure only; no rename; no cross-reference impact. Inline; skip Step 4.
- **T2** — rename of one artifact with ≤10 cross-references. 3 parallel sub-agents per Step 4.
- **T3** — split / merge, `agentPipeline:` impact, or rename touching `governance/inventory.json` registry plus `governance/CONSTITUTION.md` references. ≥3 parallel sub-agents per Step 4; CL-3 flag if D16 or AUDIT files touched.

Record the tier in the Step 7 summary header.

## Step 1: Preflight

1. Confirm clean working tree: `git status --short` returns empty.
2. Confirm branch: `git branch --show-current`.
3. Cache governance lean limits from `governance/CONSTITUTION.md` §2 P5 for any governance file the refactor will touch.
4. Resolve the target artifact: file path, id, type (agent | skill | rule | command | hook | adapter | pipeline | governance).
5. Capture baseline `wc -l` for the target plus every governance file near the lean threshold.

## Step 2: Discover (Cross-Reference Scan)

6. Run the canonical cross-reference scan against the old name or id. Substitute `<old-name>` with the artifact id (e.g., `hatch3r-fixer`):
   ```bash
   grep -r "<old-name>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/ governance/ docs/ docs-site/ tests/ CLAUDE.md README.md CHANGELOG.md
   ```
7. Read `governance/inventory.json` to enumerate every registry citation of `<old-name>` (ids field, managedFiles paths, counts).
8. For agent renames, list every `commands/hatch3r-*.md` whose frontmatter `agentPipeline:` array contains `<old-name>` — these orchestrator commands resolve the agent by id, so any miss leaves a broken pipeline.
9. Bucket every hit into one of three surfaces: code/tests (`src/`, `tests/`, `scripts/`), governance/docs (`governance/`, `docs/`, `docs-site/`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`), canonical artifacts (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/`).

## Step 3: Web Research

Skip for pure rename or in-file restructure with no empirical claim. Required when the refactor adopts a new industry pattern (e.g., restructuring an adapter around a vendor's new feature surface). Per `agents/shared/rigor-contract.md` §"Web Research Mandate": ≥2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency (≤90d CVE, ≤12mo vendor docs, ≤36mo peer-reviewed). Sources recorded in Step 7.

## Step 4: Sub-Agent Dispatch (T2 / T3 only)

Spawn 3 parallel `Task` sub-agents. Each updates references on its disjoint surface slice and writes a diff manifest:

| Slot | Scope | Manifest |
|------|-------|----------|
| 1 | code/tests — `src/`, `tests/`, `scripts/` | `.audit-workspace/capability-refactor-1.md` |
| 2 | governance/docs — `governance/`, `docs/`, `docs-site/`, `CLAUDE.md`, `README.md`, `CHANGELOG.md` | `.audit-workspace/capability-refactor-2.md` |
| 3 | canonical artifacts — `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `checks/`, `prompts/`, `github-agents/` | `.audit-workspace/capability-refactor-3.md` |

Each sub-agent prompt MUST include: the slot's bucket from Step 2, the h4tcher-development context block (pillar test, lean thresholds, anti-slop wordlist ref, commit format) modeled on `.claude/skills/h4tcher-pr-resolve/SKILL.md`, confidence-with-basis per the rigor contract, the workspace target path, and an explicit "no branches, no commits, no PRs" guardrail.

Fan-out is task-derived (P8 B2): 0 sub-agents on T1 (inline), 3 on T2/T3 across the disjoint reference-surface slices above. Token cost never serializes independent work (`.claude/rules/fan-out-discipline.md` Cost-dominance clause). Emit `sub_agents_spawned: { count, rationale }` in your output (the `Sub-agents` field of the Step 7 summary).

## Step 5: Cross-Skill Delegation

Body-content rewrites delegate to the matching author skill — set up context only, do not author inline:

| Refactor target | Delegate to |
|-----------------|-------------|
| `agents/*.md`, `skills/*/SKILL.md`, `rules/*.md`, `commands/*.md`, `hooks/*.md` body | `h4tcher-content-author` |
| Audit domain file (`governance/audit/domains/D*.md`) | `h4tcher-domain-author` |
| Adapter under `src/adapters/` | `h4tcher-adapter-author` |
| Mechanical cross-reference rewrites (id replacement, path bumps) | Inline — no delegation |

The orchestrator retains: rename-map authorship, Step 4 sub-agent coordination, Step 6 gates, Step 7 summary.

## Step 6: Governance Gates

10. Run the full gate battery, blocking on any failure:
    ```bash
    npm run validate && npm test && npx tsc --noEmit && npm run lint && \
      npm run build && npm run validate:rule-parity && npm run validate:efficiency
    ```
11. **Reference-orphan check.** Re-run the Step 2 grep command against the post-refactor tree. Hit count MUST be zero for the old name:
    ```bash
    grep -r "<old-name>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/ governance/ docs/ docs-site/ tests/ CLAUDE.md README.md CHANGELOG.md | wc -l
    ```
12. Regenerate the registry and inspect the diff:
    ```bash
    npm run inventory
    git diff governance/inventory.json
    ```
    The diff must reflect every renamed id; investigate any unexpected drift before proceeding.
13. Anti-slop scan on every modified `.md` / `.mdc` file using the wordlist regex from `.claude/rules/anti-slop-enforcement.md`; any hit blocks commit and is fixed via that file's replacement column.
14. Pillar Compliance Test (`.claude/rules/pillar-compliance.md`) on every modified file; lean threshold check against the Step 1 baselines.

## Step 7: Stop-Before-Commit Summary

15. Emit the summary below to the conversation. Do not commit, push, or merge.

```
Capability Refactor Summary
---------------------------
Tier:      T1 | T2 | T3
Branch:    <branch>
Target:    <old id / path>  ->  <new id / path>
Refactor:  rename | split | merge | restructure

Rename map: <old-id> -> <new-id> (one row per artifact)

Reference updates: code/tests <n> | governance/docs <n> | canonical <n> | total <n>
Inventory delta: <managedFiles +/-, ids +/-, manifest checksum changed yes/no>
Reference-orphan grep hits on old name: <count> (must be 0)

Gates:
  npm run validate               <PASS|FAIL>
  npm test                       <PASS|FAIL>
  npx tsc --noEmit               <PASS|FAIL>
  npm run lint                   <PASS|FAIL>
  npm run build                  <PASS|FAIL>
  npm run validate:rule-parity   <PASS|FAIL>
  npm run validate:efficiency    <PASS|FAIL>
  Anti-slop hits                 <count> (must be 0)

Pillars served: P<n>[, P<n>, ...]
Lean threshold deltas: <file: before -> after / limit>
Sub-agents: count=<0|3>, rationale=<one-line task-decomposition justification>
Sources (if Step 3 ran): <per-claim citations with trust tier + recency>

Suggested commit message:
  refactor(<scope>): <old-id> -> <new-id>

  <body line 1>
  <body line 2>

  Pillars: P<n>, P<n>

Status:     SUCCESS | PARTIAL | BLOCKED
Confidence: high | medium | low

Next action (run manually):
  git add <files>
  git commit -s -m "<suggested message>"
```

## References

- Cross-skill: `.claude/skills/h4tcher-content-author/SKILL.md`, `.claude/skills/h4tcher-adapter-author/SKILL.md`, `.claude/skills/h4tcher-domain-author/SKILL.md`
- Triage skeleton: `.claude/skills/h4tcher-pr-resolve/SKILL.md`
- Web research mandate: `agents/shared/rigor-contract.md`
- Anti-slop wordlist: `.claude/rules/anti-slop-enforcement.md`
- Pillar Compliance Test: `.claude/rules/pillar-compliance.md`
