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

Before modifying any governance file, check `wc -l` against these limits from `governance/CONSTITUTION.md` §2 P5:

| File | Limit |
|------|-------|
| `governance/CONSTITUTION.md` | <=225 lines |
| `governance/AUDIT.md` | <=600 lines |
| `governance/AUDIT-EXECUTE.md` | <=700 lines |
| Domain files (`governance/audit/domains/D*.md`) | 30-80 lines each |
| Cross-file duplication | <5% |
| Checklist items per sub-agent | 4-8 |
| Static-first prompt structure (P7) | required for `orchestrator: true` and `agents/*.md` |
| Parallel-tool-by-default (P7) | required when artifact uses ≥2 independent tool calls |
| Triage-first orchestrator (P7) | required when `orchestrator: true` (frontmatter `triage_tiers`) |
| Anti-cache patterns (P7) | 0 per artifact |
| Ambiguity-detection gate (P8 B1) | required on agents, skills, commands that mutate artifacts |
| Sub-agent count emission (P8 B2) | required on delegating artifacts (first-class output field) |

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.

Parallelism is not a lean-coverage trade-off. P4 (Lean Coverage) governs file-level bloat and duplication; P8 (Clarification & Fan-out Discipline) governs fan-out width. Do not serialize independent work to satisfy P4.
