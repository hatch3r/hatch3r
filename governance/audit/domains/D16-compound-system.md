# Domain 16: Cross-Domain Synthesis

> Last updated: 2026-04-27

**Pillars served:** P4 (primary), P5 (supporting).

**Scope:** Cross-domain insights that no single domain can produce. This domain synthesizes findings from all other domains to identify contradictions, systemic patterns, and closed-loop effectiveness. Explicitly NOT re-auditing scope covered by home domains.
**Sub-agents:** 3

ALL sub-agents are **sequential** — run only after all Tier A and B domains complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 16.1 | Cross-Domain Contradiction Detection | All Tier A+B |
| 16.2 | Closed-Loop Effectiveness | D18 (previous cycle) |
| 16.3 | Artifact Inventory & Redundancy | All Tier A+B |

## Synthesis Methodology

Before producing any 16.1 finding, sub-agent MUST read all 18 prior-tier synthesis files end-to-end (`.audit-workspace/D{1..15,17}-synthesis.md` plus any D19 synthesis). Reject any candidate pattern that cites fewer than 3 distinct domain syntheses — single-domain confirmations belong in their home domain, not D16.

## Deduplication Gate

Before creating any finding, verify:
1. Does an equivalent finding exist in a home domain from this cycle?
2. Does the root cause match an existing finding from any domain?

If yes to either: log as "cross-domain confirmation of D{N} #{ID}" without creating a new finding. Only findings that span 3+ domains or reveal contradictions between domains qualify as D16 findings.

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Audit Checklists

### 16.1 Cross-Domain Contradiction Detection
- [ ] Read all 18 prior-tier synthesis files end-to-end before drafting findings; record which files were read in the sub-agent header
- [ ] Identify findings spanning 3+ domains with shared root cause that no single domain reported
- [ ] Flag domains that contradict each other (e.g., D01 says error handling is adequate, D08 says patterns are missing)
- [ ] Cross-command consistency: do all commands implementing review loops use identical termination conditions, ASK behavior on exhaustion, and fixer dispatch logic?
- [ ] Cross-command quality gates: do all commands running quality checks use the same retry limits, failure escalation, and pass criteria?
- [ ] Cross-command sub-agent prompts: do all commands specifying sub-agent prompt requirements include the same mandatory items?
- [ ] Cross-command confidence expression: do all commands use the same three-level scale at the same structural points?
- [ ] Cross-artifact contradiction detection: do any content artifacts give conflicting instructions?
- [ ] Library-CLI divergence: do library modules (`src/merge/`, `src/integrity/`, `src/content/`) expose APIs that CLI commands (`src/cli/commands/`) do not exercise or exercise differently?
- [ ] Consistency drift: are naming conventions, error patterns, and return types uniform across all `src/` modules?

### 16.2 Closed-Loop Effectiveness
- [ ] PRD evolution tracking: were previous cycle's CL-1 candidates incorporated into the PRD?
- [ ] Content gap closure rate: were CL-2 artifacts created from previous cycle proposals?
- [ ] Audit evolution adoption rate: were CL-3 proposals reflected in current AUDIT.md and domain files?
- [ ] Feedback loop latency: how many cycles from finding identification to resolution?
- [ ] Diminishing returns: are scores improving? Is improvement rate slowing (healthy maturity) or stalling (broken loop)?
- [ ] Learning system integration: are findings captured as learnings in `/.agents/learnings/`?
- [ ] Two-speed detection: are tactical fixes (wave 1-2) progressing while strategic items (CL phases 5-7) remain stalled? Flag if CL phases have 0 executions for 2+ cycles

### 16.3 Artifact Inventory & Redundancy
- [ ] Cross-artifact functional overlap: for each pair of artifacts within the same type (agent×agent under `agents/`, skill×skill under `skills/`, rule×rule under `rules/`, command×command under `commands/`, hook×hook under `hooks/`), compare frontmatter `description` plus body purpose. Flag pairs with substantially overlapping scope as merge candidates with a 3-sentence rationale (what each uniquely contributes, what is duplicated, proposed consolidation path)
- [ ] Skill↔command redundancy: for each command in `commands/hatch3r-*.md` with `orchestrator: false`, check whether the same workflow is also packaged as a skill in `skills/hatch3r-*/SKILL.md`. Flag matching trigger conditions where users must choose between artifacts with no clear distinction
- [ ] Pillar coverage tally: count artifacts citing each pillar (P1–P6) in `tags` or body. Flag pillars over-served (>30 artifacts) or under-served (<3 artifacts) as scope imbalance signals
- [ ] Removal candidate threshold: an artifact qualifies as removal candidate only when ALL hold — (a) zero unique value beyond an existing artifact, (b) ≤1 cross-reference from other artifacts, (c) no orchestrator dependency in any `commands/hatch3r-*.md` `agentPipeline:`. Anything failing this bar is at most a merge candidate
- [ ] Add-vs-remove bias check: when overlap is detected, default recommendation is consolidation (merge two artifacts into one), not removal. Removal requires the threshold above; document the rejected merge alternative when proposing removal
- [ ] Companion content scope drift: scan `agents/modes/*`, `agents/shared/*`, `commands/board/*`, `commands/revision/*`, `checks/*` for files whose stated purpose has drifted from "support material referenced by parent" to "standalone artifact in disguise". Flag any companion file with no inbound reference from its parent as a removal candidate
- [ ] Severity discipline: merge-candidate findings are at most Medium; removal-candidate findings are at most High. Functional overlap with unclear consolidation path is Low or Info. Per-finding severity must cite which threshold it crosses
- [ ] Capability lifecycle integrity: for each artifact added/renamed/removed since the previous baseline, verify (a) `governance/inventory.json` was regenerated and committed in the same change, (b) cross-references in `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `governance/`, `docs/`, `docs-site/`, `tests/`, `CLAUDE.md` were updated, (c) any `agentPipeline:` arrays still resolve, (d) the artifact was authored via a `content-author` / `adapter-author` / `domain-author` invocation OR has a documented exception in the commit body, (e) post-change line counts respect CONSTITUTION §2 P5 lean thresholds, (f) removals cite which D16.3 removal-threshold criterion they crossed. Severity per existing severity-discipline rules
