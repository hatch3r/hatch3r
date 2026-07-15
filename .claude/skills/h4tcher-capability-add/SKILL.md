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

> Last updated: 2026-06-06

# Capability Add (Maintainer)

Lifecycle preset for adding new framework artifacts. Owns the >70% overlap block, the inventory regen requirement, and cross-skill delegation to `h4tcher-content-author` / `h4tcher-adapter-author` / `h4tcher-domain-author`. Triage-first hybrid modeled on `.claude/skills/h4tcher-pr-resolve/SKILL.md`.

## §0.1: Ambiguity Gate (P8 B1)

Per CONSTITUTION §2 P8 B1: every framework-dev workflow mutating canonical artifacts detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven. Apply the protocol when any hold: (a) ambiguous scope (request maps to ≥2 reasonable artifact targets), (b) multiple valid interpretations with materially different cost/scope/risk, (c) irreversible action (id rename, frontmatter-field drop), or (d) missing acceptance criteria. Use the platform-native question tool; one question per turn; 2-4 numbered options with one-line trade-offs; declare the default-if-no-response.

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
   - pipeline module: under `src/merge/`, `src/content/`, or `src/pipeline/`
   - audit domain: `governance/audit/domains/D{NN}-{slug}.md`

## Step 2: Discover (block on overlap)

4. Recommend running `/h4tcher-capability-discover` first. If the maintainer has not run it, execute its Step 2 inline:
   ```bash
   cat governance/inventory.json
   grep -rE "<core-keyword>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/adapters/ src/content/
   ```
5. Score functional overlap against existing artifacts of the same type per the D16.3 cross-artifact overlap check (`governance/audit/domains/D16-compound-system.md` §16.3 "Artifact Inventory & Redundancy").
6. **Block on >70% overlap.** Surface as a refactor recommendation per the D16.3 add-vs-remove bias check (`governance/audit/domains/D16-compound-system.md` §16.3 "Removal candidate threshold") — recommend invoking `/h4tcher-capability-refactor` (merge path) instead. Do not proceed.

## Step 3: Web Research

7. Per `agents/shared/rigor-contract.md` §"Web Research Mandate": >=2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency (<=90d CVE, <=12mo vendor docs, <=36mo peer-reviewed).
8. Required when adding agents/skills/commands that cite external practice or empirical claims. Skip only for pure internal refactors with no external claim.
9. Record sources in the Step 7 summary with URL + access date + trust tier.

## Step 4: Sub-Agent Dispatch (T2/T3 only)

For T1: inline authoring — skip to Step 5. For T2/T3: dispatch parallel `Task` agents, one per artifact-type slot. Each sub-agent prompt MUST include:

1. Discovery slice from Step 2 (file paths, ref counts, overlap %).
2. Verbatim h4tcher-development context block (Pillar Compliance Test from `.claude/rules/pillar-compliance.md`; lean thresholds from `.claude/rules/governance-lean-thresholds.md`; anti-slop wordlist reference to `.claude/rules/anti-slop-enforcement.md`; commit format from `.claude/rules/commit-conventions.md`).
3. Confidence expression requirement per rigor contract §"Confidence with basis".
4. Explicit guardrail: "no branches, no commits, no PRs".
5. Workspace write target: `.audit-workspace/capability-add-{slot}.md`.

Fan-out is task-derived (P8 B2): 0 sub-agents on T1 (inline), 1-3 on T2, >=3 on T3 — one per artifact-type slot. Token cost never serializes independent work (`.claude/rules/fan-out-discipline.md` Cost-dominance clause). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output (the `Sub-agents` field of the Step 7 summary; `task_structure: parallelizable` — the T2/T3 artifact-type slots are disjoint).

## Step 5: Cross-Skill Delegation (load-bearing)

The orchestrator sets up context only. Body authoring delegates to the matching author skill via `Task`:

| Artifact type | Delegate to |
|---|---|
| agent / skill / rule / command / hook | `h4tcher-content-author` |
| adapter (`src/adapters/`) | `h4tcher-adapter-author` |
| audit domain (`governance/audit/domains/`) | `h4tcher-domain-author` |
| pipeline module (`src/merge/`, `src/content/`, `src/pipeline/`) | Inline — no canonical author skill exists; flag in Step 7 summary for a future skill |

Delegation prompts pass: target path, frontmatter shape, pillar(s) served, Step 2 overlap report, Step 3 sources.

**Author-skill delegation is the implementer-mandate equivalent for this lane** — see the "Orchestrator-Self-Discipline boundary" section below. The author skills above (`h4tcher-content-author`, `h4tcher-adapter-author`, `h4tcher-domain-author`) are the delegated authoring agents that write `src/` and canonical content; the pipeline-module row's `Inline` path is a carve-out scoped there, not a license for the orchestrator to author other artifact types inline.

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
| Pillar Compliance Test | `.claude/rules/pillar-compliance.md` on each new file | Each file serves >=1 of P1-P8 |

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
Sub-agents:          count=<0|1-3|>=3>, rationale=<one-line task-decomposition justification>

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

## Orchestrator-Self-Discipline boundary (implementer-mandate carve-out)

CLAUDE.md → "Orchestrator Self-Discipline (Bypass Protection)" requires every mutating orchestrator-style turn to spawn `hatch3r-implementer` for code mutation and emit an End-of-Turn Delegation Attestation citing each file's `delegation_proof_id`. That contract governs the **product pipeline** (research → implement → review → final-quality on end-user-facing code and `src/` features). The capability-lifecycle presets are a **separate framework-authoring lane** and carry an explicit carve-out from the `hatch3r-implementer` + attestation requirement, on these grounds:

1. **Author skills are the delegated authoring agents for this lane.** Step 5 already delegates body authoring away from the orchestrator to `h4tcher-content-author` (canonical artifacts), `h4tcher-adapter-author` (`src/adapters/*.ts`), and `h4tcher-domain-author` (audit domains). These author skills occupy the same no-inline-authoring role `hatch3r-implementer` occupies in the product pipeline. Routing `src/` writes through `hatch3r-implementer` *underneath* an author skill would add a redundant second delegation hop without new verification.
2. **The Step 6 gate table is this lane's verification surface**, not `delegation_proof_id` attestation: `npm run validate`, `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run inventory[:check-docs]`, anti-slop, and the Pillar Compliance Test all run before the stop-before-commit summary.
3. **`hatch3r-implementer` targets product code under a board/issue pipeline** (browser-verification gates, UI/UX gate vocabulary per `agents/hatch3r-implementer.md` → Return Structured Result) — its gate model does not map onto governance-doc or adapter-class authoring.

Scope of the carve-out: it covers the three author-skill delegations in Step 5 plus the pipeline-module `Inline` row (`src/merge/`, `src/content/`, `src/pipeline/` — flagged in Step 7 for future author-skill coverage). It does **not** authorize the orchestrator to author agents/skills/rules/commands/hooks/adapters/domains inline — those MUST go through the matching author skill per Step 5. This carve-out is named in CLAUDE.md → "Orchestrator Self-Discipline" by the same heading; keep the two in sync if either changes.

## Constraints

- Do not edit `governance/inventory.json` by hand — only via `npm run inventory`.
- Do not bypass the >70% overlap block; route to `/h4tcher-capability-refactor` instead.
- DCO sign-off required: `git commit -s`.
- For rules: `.md` + `.mdc` parity per `scripts/validate-rule-parity.ts` is mandatory.
