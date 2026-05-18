---
name: h4tcher-capability-add
description: Create a new agent, skill, rule, command, hook, adapter, or pipeline module — runs duplication block, dispatches parallel sub-agents (T2/T3), delegates body authoring to the matching author skill, runs full gates, stops before commit.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit Task WebSearch WebFetch
triage_tiers: [1, 2, 3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
---

# Capability Add (Maintainer)

Lifecycle preset for adding new framework artifacts. Owns the >70% overlap block, the inventory regen requirement, and cross-skill delegation to `h4tcher-content-author` / `h4tcher-adapter-author` / `h4tcher-domain-author`. Triage-first hybrid modeled on `.claude/skills/h4tcher-pr-resolve/SKILL.md`.

## Step 0: Triage

Classify the addition before any work:

| Tier | Criteria | Pipeline |
|------|----------|----------|
| T1 | One artifact; no `agentPipeline` change; registry delta = +1 | Inline; skip Step 4; full Step 6 gates |
| T2 | 2-5 artifacts; cross-references introduced; one pillar surface | 1-3 parallel sub-agents via Task |
| T3 | Pipeline-affecting OR multi-`agentPipeline` insertion OR governance file near lean threshold | >=3 parallel sub-agents; CL-3 flag if D16/AUDIT touched |

Record tier in the Step 7 summary.

## Step 1: Preflight

1. `git branch --show-current` and `git status --short` (working tree must be clean).
2. Cache lean thresholds from `governance/CONSTITUTION.md` §2 P5 for files this change will create or modify.
3. Identify the target artifact type and destination path:
   - agent: `agents/hatch3r-{name}.md`
   - skill: `skills/hatch3r-{name}/SKILL.md`
   - rule: `rules/hatch3r-{name}.md` + `rules/hatch3r-{name}.mdc`
   - command: `commands/hatch3r-{name}.md`
   - hook: `hooks/hatch3r-{name}.md`
   - adapter: `src/adapters/{name}.ts` + `src/__tests__/adapters/{name}.test.ts`
   - pipeline module: under `src/merge/`, `src/integrity/`, or `src/content/`
   - audit domain: `governance/audit/domains/D{NN}-{slug}.md`

## Step 2: Discover (block on overlap)

4. Recommend running `/h4tcher-capability-discover` first. If the maintainer has not run it, execute its Step 2 inline:
   ```bash
   cat governance/inventory.json
   grep -rE "<core-keyword>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/adapters/ src/content/
   ```
5. Score functional overlap against existing artifacts of the same type per the D16.3 cross-artifact overlap check (`governance/audit/domains/D16-compound-system.md:56`).
6. **Block on >70% overlap.** Surface as a refactor recommendation per the D16.3 add-vs-remove bias check (`governance/audit/domains/D16-compound-system.md:60`) — recommend invoking `/h4tcher-capability-refactor` (merge path) instead. Do not proceed.

## Step 3: Web Research

7. Per `governance/audit/templates/rigor-contract.md` §"Web Research Mandate": >=2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency (<=90d CVE, <=12mo vendor docs, <=36mo peer-reviewed).
8. Required when adding agents/skills/commands that cite external practice or empirical claims. Skip only for pure internal refactors with no external claim.
9. Record sources in the Step 7 summary with URL + access date + trust tier.

## Step 4: Sub-Agent Dispatch (T2/T3 only)

For T1: inline authoring — skip to Step 5. For T2/T3: dispatch parallel `Task` agents, one per artifact-type slot. Each sub-agent prompt MUST include:

1. Discovery slice from Step 2 (file paths, ref counts, overlap %).
2. Verbatim h4tcher-development context block (Pillar Compliance Test from `.claude/rules/pillar-compliance.md`; lean thresholds from `.claude/rules/governance-lean-thresholds.md`; anti-slop wordlist reference to `.claude/rules/anti-slop-enforcement.md`; commit format from `.claude/rules/commit-conventions.md`).
3. Confidence expression requirement per rigor contract §"Confidence with basis".
4. Explicit guardrail: "no branches, no commits, no PRs".
5. Workspace write target: `.audit-workspace/capability-add-{slot}.md`.

## Step 5: Cross-Skill Delegation (load-bearing)

The orchestrator sets up context only. Body authoring delegates to the matching author skill via `Task`:

| Artifact type | Delegate to |
|---|---|
| agent / skill / rule / command / hook | `h4tcher-content-author` |
| adapter (`src/adapters/`) | `h4tcher-adapter-author` |
| audit domain (`governance/audit/domains/`) | `h4tcher-domain-author` |
| pipeline module (`src/merge/`, `src/integrity/`, `src/content/`) | Inline — no canonical author skill exists; flag in Step 7 summary for a future skill |

Delegation prompts pass: target path, frontmatter shape, pillar(s) served, Step 2 overlap report, Step 3 sources.

## Step 6: Governance Gates

Run after authoring completes. Block commit on any failure.

| Gate | Command | Threshold |
|------|---------|-----------|
| Validation | `npm run validate` | 0 errors |
| Tests | `npm test` | 0 failed |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 errors |
| Build | `npm run build` | succeeds; `dist/` produced |
| Inventory regen | `npm run inventory` | diff matches new artifact set |
| Inventory drift | `npm run inventory:check-docs` | 0 drift |
| Anti-slop | `grep -nE "<wordlist>" <new-files>` | 0 hits |
| Pillar Compliance Test | `.claude/rules/pillar-compliance.md` on each new file | Each file serves >=1 of P1-P7 |

10. If canonical content was added under `agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/`, `git diff governance/inventory.json` must show the new artifact entry. Investigate any unexpected drift.

## Step 7: Stop-Before-Commit Summary

Emit to the conversation. Do not commit, push, or merge.

```
Capability-Add Summary
----------------------
Tier:                T1 | T2 | T3
New file(s):         <absolute path(s)>
Artifact type(s):    <agent|skill|rule|command|hook|adapter|pipeline|domain>
Sub-author skill:    h4tcher-content-author | h4tcher-adapter-author | h4tcher-domain-author | inline
Overlap %:           <n>% (against <closest-artifact>)
Sources:             <url> (<access-date>, <org>, <trust-tier>) x N
Inventory delta:     +<n> artifacts (<types>)
Pillar(s) served:    P<n>, P<n>
Lean deltas:         <file: before -> after / limit>

Gates:
  npm run validate              <PASS|FAIL>
  npm test                      <PASS|FAIL>
  npx tsc --noEmit              <PASS|FAIL>
  npm run lint                  <PASS|FAIL>
  npm run build                 <PASS|FAIL>
  npm run inventory             <PASS|FAIL>
  npm run inventory:check-docs  <PASS|FAIL>
  Anti-slop hits                0 (must be 0)
  Pillar Compliance Test        <PASS|FAIL>

Suggested commit message (per .claude/rules/commit-conventions.md):
  feat(<scope>): add <artifact-name>

  <body>

  Pillars: P<n>, P<n>
  Signed-off-by: <name> <email>

Status:     SUCCESS | PARTIAL | BLOCKED
Confidence: high | medium | low

Next action (run manually):
  git add <files>
  git commit -s -m "<suggested message>"
```

## Constraints

- Do not edit `governance/inventory.json` by hand — only via `npm run inventory`.
- Do not bypass the >70% overlap block; route to `/h4tcher-capability-refactor` instead.
- DCO sign-off required: `git commit -s`.
- For rules: `.md` + `.mdc` parity per `scripts/validate-rule-parity.ts` is mandatory.
