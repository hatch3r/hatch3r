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
| `rules/*.md` (precedence: normal or low) | <=120 lines |
| `CLAUDE.md` | <=300 lines |
| `README.md` | <=200 lines |
| `docs/*.md` per file | <=400 lines |
| Domain file (SA >5) | SA × 15 lines |
| Template file | 80-200 lines |
| Cross-file duplication | <5% |
| Governance total | <=3000 lines |
| Checklist items per sub-agent | 4-8 |
| Static-first prompt structure | required for `orchestrator: true` and `agents/*.md` |
| Parallel-tool-by-default directive | required when artifact uses ≥2 independent tool calls |
| Triage-first orchestrator | required when `orchestrator: true` |
| Anti-cache patterns | 0 per artifact |
| Ambiguity-detection gate coverage (agents/skills/commands) | 100% |
| Sub-agent count emission on delegating artifacts | 100% |

Curated subset of CONSTITUTION §2 P5. Two canonical rows are intentionally omitted here because their normalization keys collide with sibling rows that the validator (`scripts/validate-lean-threshold-currency.ts`) extracts as canonical: `rules/*.md (precedence: critical or high) | <=250 lines` (collides with the normal-or-low row above) and `Domain file (SA ≤5) | 30-80 lines` (collides with the SA >5 row above). Full text: `governance/CONSTITUTION.md` §2 P5 lines 81 and 92. Qualitative P7/P8 invariants above mirror canonical 100% coverage thresholds; the "when does this apply" guidance lives in the corresponding rule bodies (`fan-out-discipline.md`, `clarification-default.md`, `hatch3r-agent-orchestration.md`).

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.

Parallelism is not a lean-coverage trade-off. P4 (Lean Coverage) governs file-level bloat and duplication; P8 (Clarification & Fan-out Discipline) governs fan-out width. Do not serialize independent work to satisfy P4.
