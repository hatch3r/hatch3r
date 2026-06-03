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

Before modifying any governance file, check `wc -l` against these limits from `governance/CONSTITUTION.md` §2 P5 (canonical source — this rule mirrors every row, and `scripts/validate-lean-threshold-currency.ts` (run via `npm run validate:efficiency`) enforces row-by-row parity against the Constitution):

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
| Static-first prompt structure | required for `orchestrator: true` and `agents/*.md` |
| Parallel-tool-by-default directive | required when artifact uses ≥2 independent tool calls |
| Triage-first orchestrator | required when `orchestrator: true` |
| Audit-execute SA-per-finding ratio (Critical/High/Medium/Low/Info) | 1:1 / ≤1:8 / ≤1:15 / ≤1:30 / ≤1:50 |
| Finding impact-gating (Decision 17) | required: impact_horizon ∈ {short, medium, long} + progress_toward_pillar = <pillar_id>+<delta> |
| Anti-cache patterns | 0 per artifact |
| Domain file (SA ≤5) | 30-80 lines |
| Domain file (SA >5) | SA × 15 lines |
| Template file | 80-200 lines |
| Cross-file duplication | <5% |
| Finding inflation | <2.0x pre-dedup/post-impact-gating/post-triage |
| Governance total | <=3000 lines |
| Generated UI a11y violations (axe-core, serious/critical) | 0 |
| Design-token adoption in generated code (color, spacing, typography) | >=95% |
| Four-state surface contract coverage on generated async views | 100% |
| Generated-service OTel instrumentation on request path | 100% |
| Migration expand-contract conformance | 100% |
| API breaking-change events on stable endpoints | 0 per release |
| AI feature eval coverage | 100% |
| Per-feature test-class mandate compliance | 100% |
| Edge-case enumeration coverage on changed surfaces (generated code) | >=90% |
| Illegal-state-prevention adoption on state machines / unions (generated code) | 100% |
| Supply-chain floor coverage | 100% |
| User-facing service SLO defined | 100% |
| Auth depth coverage | 100% |
| Anti-slop phrases | 0 per file |
| Checklist items/SA | 4-8 |
| Ambiguity-detection gate coverage (agents/skills/commands) | 100% |
| Sub-agent count emission on delegating artifacts | 100% |
| Universal floor invariant (security + UI/UX + protocol + content-quality) | structural invariant: every non-custom preset admits every item tagged `floor:security`, `floor:ui-ux`, `floor:protocol`, or `floor:content-quality` unconditionally; under Decision 16 (dial, not gate) every preset admits the full corpus, so this row guarantees `floor:*` items can never be disabled at any tier, anchoring the §2B universal floor |
| Tag-facet integrity on canonical artifacts | every canonical agent/skill/rule/command/hook carries ≥1 capability tag OR ≥1 floor tag in frontmatter; `customize` and `floor:*` items are exempt from capability-gate filtering |
| Rule-precedence assignment policy | security + secrets rules → `precedence: critical` (rank 100, prefix `10-`); rules implementing CONSTITUTION §2 P2 hard-mandate floors (supply-chain, observability, migrations, auth depth, AI evals, accessibility, etc.) and framework-dev gatekeepers → `precedence: high` (rank 300, prefix `30-`); cosmetic/style → `precedence: normal` (rank 500, prefix `50-`); deprecation hawks → `precedence: low` (rank 700, prefix `70-`) |
| Detail-rule frontmatter declaration (`rules/*-detail.{md,mdc}`) | required: `detail_rule: true` + `consumed_by: <parent-rule-id>` on both `.md` and `.mdc` |

If a modification pushes a file over its limit: compress elsewhere in the file to stay within bounds, or provide a pillar-backed rationale for the overage per the Pillar Compliance Test.

Parallelism is not a lean-coverage trade-off. P4 (Lean Coverage) governs file-level bloat and duplication; P8 (Clarification & Fan-out Discipline) governs fan-out width. Do not serialize independent work to satisfy P4.
