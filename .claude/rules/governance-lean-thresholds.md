---
id: governance-lean-thresholds
type: rule
description: Lean-threshold limits from CONSTITUTION.md §2 P5 must hold for every governance file modification; pillar-backed rationale required for overages.
tags: [maintainer, governance, p4, p5]
scope: always
precedence: high
---

# Governance Lean Thresholds

> Last updated: 2026-07-09

**Pillars:** P5 (Governance Self-Quality), P4 (Lean Coverage)

Before modifying any governance file, check `wc -l` against these limits from `governance/CONSTITUTION.md` §2 P5 (canonical source — this rule reproduces the file-cap and authoring-band subset of its rows; `scripts/validate-lean-threshold-currency.ts` (run via `npm run validate:efficiency`) enforces that every row reproduced here carries the same Limit as the Constitution, not that every Constitution row appears here — see the validator's `diffAgainstConstitution` contract):

| File | Limit |
|------|-------|
| `CONSTITUTION.md` | <=550 lines |
| `VISION.md` | <=250 lines |
| `AUDIT.md` | <=600 lines |
| `AUDIT-EXECUTE.md` | <=720 lines |
| `EVOLVE.md` | <=550 lines |
| `pack-trust-model.md` | <=300 lines |
| `amendment-procedure.md` | <=200 lines |
| Governed appendix (D15-trust-reference.md) | <=200 lines |
| `agents/shared/quality-charter.md` | <=300 lines |
| `agents/shared/rigor-contract.md` | <=160 lines |
| `agents/shared/user-question-protocol.md` | <=150 lines |
| `SCALE.md` | <=80 lines |
| `rules/*.md` (precedence: critical or high) | <=250 lines |
| `rules/*.md` (precedence: normal or low) | <=120 lines |
| `CLAUDE.md` | <=300 lines |
| `README.md` | <=200 lines |
| `docs/*.md` per file | <=400 lines |
| Domain file (SA ≤5) | 30-80 lines |
| Domain file (SA >5) | SA × 15 lines |
| Template file | 80-200 lines |
| Checklist items/SA | 4-8 |
| Cross-file duplication | <5% |
| Anti-slop phrases | 0 per file |
| Finding inflation | <2.0x pre-dedup/post-impact-gating/post-triage |
| Governance total (sum of the 6 lean-tracked prompts: CONSTITUTION + VISION + AUDIT + AUDIT-EXECUTE + EVOLVE + pack-trust-model) | <=2970 lines |

Full table — including the generated-code CQ metric rows (a11y, design tokens, OTel, expand-contract, evals, SLO, auth depth, …) and the structural-invariant rows (universal floor, tag-facet integrity, rule-precedence policy, impact-gating, SA-per-finding ratios) — lives in `governance/CONSTITUTION.md` §2 P5. Those rows gate generated end-user code and audit execution, not framework-dev `wc -l` checks, so they are not reproduced here.

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.

Parallelism is not a lean-coverage trade-off. P4 (Lean Coverage) governs file-level bloat and duplication; P8 (Clarification & Fan-out Discipline) governs fan-out width. Do not serialize independent work to satisfy P4.
