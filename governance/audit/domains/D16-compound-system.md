# Domain 16: Cross-Domain Synthesis

> Last updated: 2026-04-19

**Pillars served:** P4 (primary), P5 (supporting).

**Scope:** Cross-domain insights that no single domain can produce. This domain synthesizes findings from all other domains to identify contradictions, systemic patterns, and closed-loop effectiveness. Explicitly NOT re-auditing scope covered by home domains.
**Sub-agents:** 2

ALL sub-agents are **sequential** — run only after all Tier A and B domains complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 16.1 | Cross-Domain Contradiction Detection | All Tier A+B |
| 16.2 | Closed-Loop Effectiveness | D18 (previous cycle) |

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
