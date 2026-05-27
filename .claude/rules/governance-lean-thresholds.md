---
id: governance-lean-thresholds
type: rule
description: Lean-threshold limits from CONSTITUTION.md §2 P5 must hold for every governance file modification; pillar-backed rationale required for overages.
tags: [maintainer, governance, p4, p5]
scope: always
precedence: high
---

# Governance Lean Thresholds

**Pillars:** P5 (Governance Self-Quality), P4 (Lean Coverage)

Before modifying any governance file, check `wc -l` against these limits from `governance/CONSTITUTION.md` §2 P5 (canonical source — this rule mirrors the table, and `scripts/validate-lean-threshold-currency.ts` (run via `npm run validate:efficiency`) enforces row-by-row parity against the Constitution):

| File | Limit |
|------|-------|
| `CONSTITUTION.md` | <=550 lines |
| `VISION.md` | <=250 lines |
| `AUDIT.md` | <=600 lines |
| `AUDIT-EXECUTE.md` | <=720 lines |
| `RE-ENVISION.md` | <=550 lines |
| `EVOLVE.md` | <=400 lines |
| `pack-trust-model.md` | <=300 lines |
| `rules/*.md` (precedence: critical or high) | <=250 lines |
| `rules/*.md` (precedence: normal or low) | <=120 lines |
| `CLAUDE.md` | <=300 lines |
| `README.md` | <=200 lines |
| `docs/*.md` per file | <=400 lines |
| Domain file (SA ≤5) | 30-80 lines each |
| Domain file (SA >5) | SA × 15 lines |
| Template file | 80-200 lines |
| Cross-file duplication | <5% |
| Governance total | <=3000 lines |
| Checklist items per sub-agent | 4-8 |
| Static-first prompt structure (P7) | required for `orchestrator: true` and `agents/*.md` |
| Parallel-tool-by-default (P7) | required when artifact uses ≥2 independent tool calls |
| Triage-first orchestrator (P7) | required when `orchestrator: true` (frontmatter `triage_tiers`) |
| Anti-cache patterns (P7) | 0 per artifact |
| Ambiguity-detection gate (P8 B1) | required on agents, skills, commands that mutate artifacts |
| Sub-agent count emission (P8 B2) | required on delegating artifacts (first-class output field) |

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.

Parallelism is not a lean-coverage trade-off. P4 (Lean Coverage) governs file-level bloat and duplication; P8 (Clarification & Fan-out Discipline) governs fan-out width. Do not serialize independent work to satisfy P4.
