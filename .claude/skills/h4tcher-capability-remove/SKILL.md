---
name: h4tcher-capability-remove
description: Decommission a hatch3r artifact (agent, skill, rule, command, hook, adapter, pipeline module) after passing the D16.3 removal-threshold gate, drafting migration notes, and scrubbing every cross-reference.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit Task WebSearch WebFetch
triage_tiers: [1, 2, 3]
parallel_tool_default: true
cache_friendly: true
quality_charter: agents/shared/quality-charter.md
---

# Capability Remove (Maintainer)

Maintainer preset for phasing out a hatch3r artifact. Hardest preset to invoke: a D16.3 gate blocks removal unless three criteria all hold, and migration notes plus reference scrubbing run before the maintainer is allowed to commit.

## Step 0: Triage

Classify the removal target before any work runs.

| Tier | Criteria | Pipeline |
|------|----------|----------|
| T1 | Leaf artifact with 0 inbound references | Inline; skip Step 4; full Step 6 gates |
| T2 | Artifact with 1-3 references requiring migration notes | 1-3 parallel sub-agents; full gates |
| T3 | Artifact named in any `agentPipeline:` array, listed in `governance/inventory.json` registry, or referenced from `governance/CONSTITUTION.md` / `governance/VISION.md` | >=3 parallel sub-agents; full gates + CL-3 flag if D16/AUDIT touched |

Record tier + rationale at the top of the workspace summary.

## Step 1: Preflight

1. Confirm clean tree + branch: `git status --short` empty; `git branch --show-current` matches an open release/feature branch.
2. Cache lean-threshold limits from `governance/CONSTITUTION.md` §2 P5.
3. Identify the target artifact type (agent | skill | rule | command | hook | adapter | pipeline module) and its canonical path.
4. Capture baseline `wc -l` on `governance/inventory.json` and any governance file likely to be edited.

## Step 2: Removal-Qualification Gate (D16.3)

Run the D16.3 removal-threshold check inline (`governance/audit/domains/D16-compound-system.md:59`). Removal qualifies only when ALL three criteria hold:

- (a) Zero unique value beyond an existing artifact (run duplication scan; cite the artifact that subsumes the candidate).
- (b) <=1 cross-reference from other artifacts (run `grep -r "<artifact-id>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/ governance/ docs/ docs-site/ tests/ CLAUDE.md README.md CHANGELOG.md`; record the count).
- (c) No orchestrator dependency in any `commands/hatch3r-*.md` `agentPipeline:` array (`grep -l "<artifact-id>" commands/hatch3r-*.md`; inspect each match).

Cite which criterion is crossed for every failing check. **Block immediately on any failure** and recommend `/h4tcher-capability-refactor` (merge) per the D16.3 add-vs-remove bias check.

## Step 3: Web Research

Skipped by default. Run only when the removal cites an external "industry has deprecated this" claim. When triggered, follow the rigor contract (`governance/audit/templates/rigor-contract.md` §"Web Research Mandate"): >=2 independent sources, trust tier (official-docs > peer-reviewed > vendor-note > independent-analysis > blog-post), recency window (<=90d CVE, <=12mo vendor docs, <=36mo peer-reviewed). Sources land in the Step 7 summary.

## Step 4: Sub-Agent Dispatch (T2/T3)

T1 stays inline (single scrub + one CHANGELOG line). T2/T3 dispatch parallel `Task` agents writing to `.audit-workspace/capability-remove-{slot}.md`:

| Slot | Role |
|------|------|
| migration-notes | Drafts the `CHANGELOG.md` entry (under `### Removed`) plus an optional `docs-site/` deprecation page when an end-user-visible artifact is removed |
| refs-canonical | Scrubs references in `agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/` |
| refs-code-docs | Scrubs references in `src/`, `tests/`, `governance/`, `docs/`, `docs-site/`, `CLAUDE.md`, `README.md` |

Every sub-agent prompt MUST carry: (1) the Step 2 discovery slice (paths + ref counts), (2) the verbatim h4tcher-development context block from `.claude/skills/h4tcher-pr-resolve/SKILL.md` Step 2 (pillar test, lean thresholds, anti-slop wordlist reference, commit format), (3) the confidence-with-basis requirement from the rigor contract, (4) the "no branches, no commits, no PRs" guardrail, (5) the workspace write target above.

## Step 5: Cross-Skill Delegation

None for body authoring during removal. The migration-notes slot may call `/h4tcher-content-author` only when a brand-new replacement artifact must be authored — rare; document the rationale in the workspace summary when invoked.

## Step 6: Governance Gates

Run the full hatch3r gate battery PLUS removal-specific checks. Block commit on any failure.

| Gate | Command | Threshold |
|------|---------|-----------|
| Validate | `npm run validate` | 0 errors |
| Tests | `npm test` | 0 failed |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` | 0 errors |
| Build | `npm run build` | succeeds; `dist/` produced |
| Rule parity | `npm run validate:rule-parity` | 0 mismatches |
| Efficiency invariants | `npm run validate:efficiency` | 0 violations |
| Inventory regen | `npm run inventory` then `git diff governance/inventory.json` | diff matches the removal exactly; no unexpected drift |
| Inventory docs drift | `npm run inventory:check-docs` | 0 drift |
| Reference-orphan check | `grep -rn "<removed-name>" agents/ skills/ rules/ commands/ hooks/ checks/ prompts/ github-agents/ src/ governance/ docs/ docs-site/ tests/ CLAUDE.md README.md CHANGELOG.md` | 0 hits outside the CHANGELOG migration entry |
| CHANGELOG entry | `grep -n "<removed-name>" CHANGELOG.md` | >=1 line under the active release's `### Removed` section |
| Anti-slop | `grep -nE` against `.claude/rules/anti-slop-enforcement.md` wordlist on every modified `.md` / `.mdc` | 0 hits |
| Pillar compliance | Apply `.claude/rules/pillar-compliance.md` to the removal | Removal serves one or more of P1-P8 |
| Lean thresholds | `wc -l` on every modified governance file | Within CONSTITUTION §2 P5 limits |

## Step 7: Stop-Before-Commit Summary

Emit the slot-filled template below. Do not commit, branch, push, or merge.

```
Capability-Remove Summary
-------------------------
Artifact:           <id / path>
Type:               agent | skill | rule | command | hook | adapter | pipeline-module
Tier:               T1 | T2 | T3
D16.3 criteria:     (a) <pass + cite subsuming artifact> (b) <ref count <=1> (c) <no agentPipeline hit>

Removed paths:      <bullet list>
Migration notes:    CHANGELOG.md (line <n>, ### Removed) [+ docs-site/<page>.md if authored]
agentPipeline diffs: <command file: before -> after, or "none">
Inventory delta:    <line counts: before -> after in governance/inventory.json>

Gates:
  npm run validate                <PASS|FAIL>
  npm test                        <PASS|FAIL>
  npx tsc --noEmit                <PASS|FAIL>
  npm run lint                    <PASS|FAIL>
  npm run build                   <PASS|FAIL>
  npm run validate:rule-parity    <PASS|FAIL>
  npm run validate:efficiency     <PASS|FAIL>
  npm run inventory:check-docs    <PASS|FAIL>
  Reference-orphan grep           <PASS (0 hits) | FAIL>
  CHANGELOG entry present         <PASS | FAIL>
  Anti-slop hits                  <count — 0 required>

Pillars served:     P<n>, P<n>
Sources (web):      <list, or "none — no empirical claim">
Confidence:         high | medium | low

Next action (maintainer runs manually):
  git add <files>
  git commit -s -m "refactor(<scope>): remove <artifact-id>"
  git push
```

## Constraints

- Block on any D16.3 failure in Step 2; do not proceed without the maintainer's explicit override + recorded rationale.
- Never hand-edit `governance/inventory.json` — only via `npm run inventory`.
- Do not skip the reference-orphan grep; one orphan hit blocks commit.
- Do not commit, branch, push, or merge from inside this skill.
- DCO sign-off via `git commit -s` is required when the maintainer commits.

## References

- D16.3 removal-threshold + add-vs-remove bias check: `governance/audit/domains/D16-compound-system.md:59`
- Web research mandate: `governance/audit/templates/rigor-contract.md`
- Quality charter: `agents/shared/quality-charter.md`
- Sibling presets: `.claude/skills/h4tcher-capability-discover/SKILL.md`, `.claude/skills/h4tcher-capability-refactor/SKILL.md`
- Author skill (replacement artifact, rare): `.claude/skills/h4tcher-content-author/SKILL.md`
