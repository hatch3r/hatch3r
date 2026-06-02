---
id: shared-severity-mapping
type: reference
description: Canonical severity-vocabulary mapping across reviewer, fixer, security-auditor, check criteria, and the 9 content-quality specialists.
tags: [reference]
---

# Severity Vocabulary Canonical Mapping

> Last updated: 2026-05-28
> Pillars: P2 (primary), P4 (supporting).
> Canonical for: agents/hatch3r-reviewer.md, agents/hatch3r-fixer.md, the 9 CQ quality-vector specialists (agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md), checks/*.md.

## Purpose

Single source of truth for severity vocabulary alignment across all hatch3r content artifacts. Audit findings (the canonical audit severity taxonomy) use 5 buckets: Critical, High, Medium, Low, Info. Other artifacts (reviewer agent, security auditor, check criteria) use their own vocabularies. This file maps them so the fixer agent can consume any source's output and map to the canonical bucket.

## 6-Column Canonical Map

| Audit Severity (canonical) | Reviewer Verdict | Reviewer Level | Security-Auditor Severity | Check Criteria Tag | Specialist Status |
|----------------------------|------------------|----------------|---------------------------|--------------------|-------------------|
| Critical                   | DESIGN_OBJECTION | Critical       | Critical                  | [CRITICAL]         | CRITICAL          |
| High                       | REQUEST CHANGES  | Critical       | High                      | [CRITICAL]         | FINDINGS          |
| Medium                     | REQUEST CHANGES  | Warning        | Medium                    | [RECOMMENDED]      | FINDINGS          |
| Low                        | APPROVE          | Suggestion     | Low                       | [RECOMMENDED]      | PASS              |
| Info                       | APPROVE          | Suggestion     | (n/a)                     | (n/a)              | PASS              |

## Mapping Rationale

- **Critical (canonical)** maps to `DESIGN_OBJECTION` because both express a fundamental, unfixable-by-iteration problem requiring architectural intervention. Reviewer Level `Critical` also maps when paired with `REQUEST CHANGES` and the issue is a security or correctness blocker.
- **High (canonical)** maps to `REQUEST CHANGES` + Reviewer Level `Critical`. The reviewer's `Critical` level covers both canonical Critical and High; disambiguation uses verdict (`DESIGN_OBJECTION` → Critical, `REQUEST CHANGES` → High) and finding nature (architectural vs. quality gap).
- **Medium (canonical)** maps to `REQUEST CHANGES` + Reviewer Level `Warning` and Security-Auditor `Medium`. These are quality gaps that block the current cycle but not the release.
- **Low (canonical)** maps to `APPROVE` + Reviewer Level `Suggestion`. The reviewer approves but flags improvements. Security-Auditor `Low` is the equivalent severity for security-domain findings.
- **Info (canonical)** has no Security-Auditor or Check-Criteria equivalent because those vocabularies do not enumerate a no-action observation tier.
- **Specialist Status (PASS | FINDINGS | CRITICAL)** is the 3-value vocabulary emitted by the 9 CQ quality-vector specialists (`agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md`). `CRITICAL` maps to canonical Critical (any item shows a Critical-severity finding → DESIGN_OBJECTION-equivalent block). `FINDINGS` covers the canonical High + Medium band (Medium/High findings present, no Critical → REQUEST CHANGES). `PASS` maps to canonical Low + Info (every checklist item green or advisory-only → APPROVE). The collapse of two canonical buckets into one specialist value is intentional: specialists gate merge readiness, not finding-by-finding triage, so they emit a coarser status that the fixer re-expands via this row.

## Consumer Contract

- **hatch3r-fixer**: When ingesting findings from any source, MUST map source vocabulary to the canonical Audit Severity column before applying its action policy. Critical → blocking fix; High → blocking fix; Medium → fix in current cycle; Low → fix or defer per scope; Info → log, no action.
- **hatch3r-reviewer**: Output uses Reviewer Verdict + Reviewer Level columns. Map to canonical via this table when escalating to fixer or audit.
- **hatch3r-security** (CQ3 specialist): Output uses Security-Auditor Severity column. Map to canonical via this table when emitting findings.
- **check criteria authors** (checks/*.md): Use Check Criteria Tag column. Map to canonical for severity-rollup reports.
- **CQ quality-vector specialists** (`agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md`): Output uses the Specialist Status column (PASS | FINDINGS | CRITICAL). Map to canonical via this table when escalating to fixer or feeding the release decision.
- **canonical audit severity taxonomy**: Defines the canonical Audit Severity column. This mapping table is the cross-vocabulary reference.
- **audit-execute regression gate**: The "Severity Vocab" gate enforces that every modified `.md` content file either uses canonical buckets or references this file.

## Edge Cases

- **Reviewer `Critical` overlaps two canonical buckets.** Disambiguation rule: use `DESIGN_OBJECTION` verdict for canonical Critical, `REQUEST CHANGES` + Critical level for canonical High. When unclear, default to Critical (conservative for fixer blocking-action policy).
- **Check Criteria has only two tags.** `[CRITICAL]` covers canonical Critical + High; `[RECOMMENDED]` covers canonical Medium + Low. Severity-rollup reports must use the worst-case canonical mapping for `[CRITICAL]` tags (treat as canonical Critical until disambiguated by file/line context).
- **Security-Auditor has no Info tier.** Security findings of observation-only nature must be either omitted from audit output or flagged as Low with a `confidence: low` qualifier per the Confidence Expression section of `agents/hatch3r-security.md`.
- **A11y-Auditor WCAG vocabulary.** `Critical/Major/Minor` maps to canonical `Critical/Medium/Low` (WCAG A blockers → Critical; AA violations → Medium; advisory AA/AAA → Low). No direct High equivalent — escalate Major to High when the violation blocks a critical user journey.
- **Dependency-Auditor CVSS vocabulary.** CVSS-derived Critical (≥9.0) / High (7.0–8.9) / Medium (4.0–6.9) / Low (<4.0) aligns 1:1 with canonical audit severity. No mapping translation required.

## 2.0.0 Domain Vocabulary Extensions (Decision 19)

D22 / D23 / D24 admission (per the canonical audit domain map) adds three domain-specific severity vocabularies. Each row maps to the canonical Audit Severity column above.

| Domain | Source vocabulary | Bucket meaning | Canonical map |
|--------|-------------------|----------------|---------------|
| **D22** Content Architecture | `obsolete` | Artifact serves no current pillar AND has zero cross-references | Critical (remove via D16-SA16.3 threshold) |
| **D22** Content Architecture | `merge_candidate` | ≥80% conceptual overlap with another artifact AND removal threshold not met | High (merge the overlapping artifacts) |
| **D22** Content Architecture | `drift` | Artifact frontmatter or body diverges from current pillar definitions | Medium |
| **D22** Content Architecture | `gap` | Pillar is under-represented in the content corpus (per web-comparison findings) | Medium (CL-2 candidate) |
| **D22** Content Architecture | `coverage_low` | Pillar served by <2 artifacts but pillar surface area expects ≥2 | Low |
| **D23** Agentic Engineering Trends | `lagging` | hatch3r lacks a pattern adopted by ≥2 reputable comparables in ≤6 months | High |
| **D23** Agentic Engineering Trends | `trailing` | hatch3r implements a pattern but ≥1 sub-element behind comparable | Medium |
| **D23** Agentic Engineering Trends | `leading` | hatch3r ahead of all comparables on a pattern | Info (record as Strength) |
| **D24** Governance Self-Audit | `invariant_violation` | A constitution invariant (e.g., lean threshold, anti-slop, pillar coverage) is broken | Critical |
| **D24** Governance Self-Audit | `process_drift` | Audit cycle deviated from the audit-execute Phase contract | High |
| **D24** Governance Self-Audit | `traceability_gap` | A change landed without a finding-registry entry or §8 amendment trail | Medium |
| **D24** Governance Self-Audit | `cadence_miss` | Required cadence (re-envision ≥14 days, audit cycle, evolve) overdue | Low |

The Specialist Status column from the 6-Column Canonical Map applies to D22/D23/D24 SAs (PASS | FINDINGS | CRITICAL coarse status) — the bucket-level mapping above is the per-finding-row resolution within each SA's output. Consumers (fixer, reviewer) map the source bucket to canonical Audit Severity before applying action policy, identical to the Consumer Contract for existing domains.

## Cross-Domain Severity Escalation Rules

A finding's source bucket maps to canonical Audit Severity per the table above. Two escalation rules then re-evaluate the row before it ships to the finding registry:

1. **Multi-domain compound rule.** A finding cited by ≥2 domain SAs (cross-domain dependency per the compound-system audit domain) escalates one canonical band (Medium → High, High → Critical). Rationale: cross-domain surface area indicates systemic driver, not symptom. The escalation is recorded in the finding's `cross_domain_citations` registry field; bands cap at Critical.
2. **CQ pillar regression rule.** A finding that introduces a measurable regression on a CQ1-CQ9 pillar threshold (per the content-quality (CQ) pillars and their specialist agents) escalates one canonical band regardless of source bucket. The CQ specialist's `Specialist Status` column already collapses to PASS | FINDINGS | CRITICAL — the escalation re-expands to the canonical band the regression actually represents per the regression evidence file path + line cited in the finding body.

Escalations chain: a CQ regression cited by ≥2 domain SAs receives two single-band escalations (capped at Critical). De-escalation is not permitted via these rules — a Critical never falls to High through this protocol; only the bias-check downgrade in the rigor contract (`agents/shared/rigor-contract.md` §Scientific Rigor Contract item 5) can reduce a severity band.

## Verification

This file now lives at `agents/shared/severity-mapping.md`. `grep -rl "severity-mapping.md" agents/ checks/` MUST return ≥19 public files (fixer, reviewer, security-auditor, a11y-auditor, dependency-auditor, the 9 CQ specialists ui/ux/security/reliability/testability/scalability/performance/maintainability/enhancability, code-quality.md, security.md, testing.md, accessibility.md, performance.md). Note: hatch3r-security.md is both a CQ specialist and counted once.

## Pillar Service

- **P2 Scientific Quality (primary):** Canonical mapping eliminates ambiguity in fixer bucketing — finder output is round-trippable through the fix pipeline without information loss.
- **P4 Lean Coverage (supporting):** Single source of truth replaces 5 partial vocabularies (reviewer, security-auditor, check-criteria, CVSS/WCAG auditors, CQ-specialist status); consumers reference instead of restating.
