# Severity Vocabulary Canonical Mapping

> Last updated: 2026-04-19
> Pillars: P2 (primary), P4 (supporting).
> Canonical for: agents/hatch3r-reviewer.md, agents/hatch3r-fixer.md, agents/hatch3r-security-auditor.md, checks/*.md, governance/AUDIT.md, governance/AUDIT-EXECUTE.md.

## Purpose

Single source of truth for severity vocabulary alignment across all hatch3r content artifacts. Audit findings (governance/AUDIT.md) use 5 buckets: Critical, High, Medium, Low, Info. Other artifacts (reviewer agent, security auditor, check criteria) use their own vocabularies. This file maps them so the fixer agent can consume any source's output and map to the canonical bucket.

## 5-Column Canonical Map

| Audit Severity (canonical) | Reviewer Verdict | Reviewer Level | Security-Auditor Severity | Check Criteria Tag |
|----------------------------|------------------|----------------|---------------------------|--------------------|
| Critical                   | DESIGN_OBJECTION | Critical       | Critical                  | [CRITICAL]         |
| High                       | REQUEST CHANGES  | Critical       | High                      | [CRITICAL]         |
| Medium                     | REQUEST CHANGES  | Warning        | Medium                    | [RECOMMENDED]      |
| Low                        | APPROVE          | Suggestion     | Low                       | [RECOMMENDED]      |
| Info                       | APPROVE          | Suggestion     | (n/a)                     | (n/a)              |

## Mapping Rationale

- **Critical (canonical)** maps to `DESIGN_OBJECTION` because both express a fundamental, unfixable-by-iteration problem requiring architectural intervention. Reviewer Level `Critical` also maps when paired with `REQUEST CHANGES` and the issue is a security or correctness blocker.
- **High (canonical)** maps to `REQUEST CHANGES` + Reviewer Level `Critical`. The reviewer's `Critical` level covers both canonical Critical and High; disambiguation uses verdict (`DESIGN_OBJECTION` → Critical, `REQUEST CHANGES` → High) and finding nature (architectural vs. quality gap).
- **Medium (canonical)** maps to `REQUEST CHANGES` + Reviewer Level `Warning` and Security-Auditor `Medium`. These are quality gaps that block the current cycle but not the release.
- **Low (canonical)** maps to `APPROVE` + Reviewer Level `Suggestion`. The reviewer approves but flags improvements. Security-Auditor `Low` is the equivalent severity for security-domain findings.
- **Info (canonical)** has no Security-Auditor or Check-Criteria equivalent because those vocabularies do not enumerate a no-action observation tier.

## Consumer Contract

- **hatch3r-fixer**: When ingesting findings from any source, MUST map source vocabulary to the canonical Audit Severity column before applying its action policy. Critical → blocking fix; High → blocking fix; Medium → fix in current cycle; Low → fix or defer per scope; Info → log, no action.
- **hatch3r-reviewer**: Output uses Reviewer Verdict + Reviewer Level columns. Map to canonical via this table when escalating to fixer or audit.
- **hatch3r-security-auditor**: Output uses Security-Auditor Severity column. Map to canonical via this table when emitting findings.
- **check criteria authors** (checks/*.md): Use Check Criteria Tag column. Map to canonical for severity-rollup reports.
- **governance/AUDIT.md**: Defines the canonical Audit Severity column in §Severity Taxonomy. This mapping table is the cross-vocabulary reference.
- **governance/AUDIT-EXECUTE.md**: Regression gate "Severity Vocab" enforces that every modified `.md` file under `agents/`, `checks/`, `governance/` either uses canonical buckets or references this file.

## Edge Cases

- **Reviewer `Critical` overlaps two canonical buckets.** Disambiguation rule: use `DESIGN_OBJECTION` verdict for canonical Critical, `REQUEST CHANGES` + Critical level for canonical High. When unclear, default to Critical (conservative for fixer blocking-action policy).
- **Check Criteria has only two tags.** `[CRITICAL]` covers canonical Critical + High; `[RECOMMENDED]` covers canonical Medium + Low. Severity-rollup reports must use the worst-case canonical mapping for `[CRITICAL]` tags (treat as canonical Critical until disambiguated by file/line context).
- **Security-Auditor has no Info tier.** Security findings of observation-only nature must be either omitted from audit output or flagged as Low with a `confidence: low` qualifier per the Confidence Expression section of `agents/hatch3r-security-auditor.md`.

## Verification

`grep -r "severity-mapping.md" agents/ checks/ governance/` MUST return ≥6 references (fixer, reviewer, security-auditor, code-quality.md, AUDIT.md, AUDIT-EXECUTE.md).

## Pillar Service

- **P2 Scientific Quality (primary):** Canonical mapping eliminates ambiguity in fixer bucketing — finder output is round-trippable through the fix pipeline without information loss.
- **P4 Lean Coverage (supporting):** Single source of truth replaces 4 partial vocabularies; consumers reference instead of restating.
