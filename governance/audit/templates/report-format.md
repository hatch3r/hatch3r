# Audit Report Format Templates

> Last updated: 2026-04-19

**Pillars served:** P5 (primary), P1 (supporting).

> Extracted from AUDIT.md for lean governance. Referenced by AUDIT.md §Output Format.
> These templates define the structure of audit report sections.

---

## Executive Dashboard

```
Audit Date: YYYY-MM-DD
Framework Version: (from package.json)
Previous Audit: (date or "N/A")
Auditor: (model name and version)
Domains Covered: 17/17
Sub-Agents Deployed: (from verified inventory)

Overall Score: XX/100 (Weighted)
Score Band: [Ship Ready / Minor Issues / Needs Work / Significant Risk / Not Ready]
Severity Ceiling Applied: [Yes/No — if any domain has unresolved Critical]

Top 3 Strengths:
1. ...
2. ...
3. ...

Top 3 Critical Issues:
1. ...
2. ...
3. ...

Competitive Positioning: (1 sentence)
Distribution Recommendation: (1 sentence)
```

### Holistic Assessment

In 3-5 sentences, provide the orchestrator's subjective quality impression of the framework — independent of the formula score. What feels strong? What feels fragile? What is the overall craft quality and design coherence? Note specifically where the holistic impression diverges from the formula score and explain why. This section serves as a calibration signal for the scoring methodology.

### Domain Heatmap

```
| Domain | Score | Critical | High | Medium | Low | Info | Rigor Provenance |
|--------|-------|----------|------|--------|-----|------|------------------|
| D1: Core Source Implementation | XX | N | N | N | N | N | H/M/L median confidence |
| D2: Adapter Infrastructure | XX | N | N | N | N | N | H/M/L median confidence |
| D3: Test Infrastructure | XX | N | N | N | N | N | H/M/L median confidence |
| D4: Build, CI/CD & Dependencies | XX | N | N | N | N | N | H/M/L median confidence |
| D5: Prompt Engineering Quality | XX | N | N | N | N | N | H/M/L median confidence |
| D6: Context Engineering | XX | N | N | N | N | N | H/M/L median confidence |
| D7: Orchestration Optimization | XX | N | N | N | N | N | H/M/L median confidence |
| D8: Error Recovery & Resilience | XX | N | N | N | N | N | H/M/L median confidence |
| D9: Platform Adapters | XX | N | N | N | N | N | H/M/L median confidence |
| D10: User Experience & Documentation | XX | N | N | N | N | N | H/M/L median confidence |
| D11: End-to-End Data Flow | XX | N | N | N | N | N | H/M/L median confidence |
| D12: CLI Diagnostics & Traceability | XX | N | N | N | N | N | H/M/L median confidence |
| D13: Human-AI Collaboration | XX | N | N | N | N | N | H/M/L median confidence |
| D14: Adaptability & Scalability | XX | N | N | N | N | N | H/M/L median confidence |
| D15: Agentic Security | XX | N | N | N | N | N | H/M/L median confidence |
| D16: Cross-Domain Synthesis | XX | N | N | N | N | N | H/M/L median confidence |
| D17: Competition & Market | XX | N | N | N | N | N | H/M/L median confidence |
| D18: PRD, Roadmap & Distribution | XX | N | N | N | N | N | H/M/L median confidence |
```

---

## Enhanced Action Items

**This table MUST include every unique finding post-deduplication.** Do not curate, truncate, or limit to a "top N" subset. The execution prompt (`AUDIT-EXECUTE.md`) reads this table as the complete universe of findings.

Ordered by: Critical first, then High, Medium, Low. Within severity, order by impact-to-effort ratio (highest first).

Columns: `#`, `Domain`, `Action Item`, `Severity`, `Effort`, `Risk Score` (Impact x Likelihood x Reversibility, each 1-5), `Owner`, `Depends On`, `Status`.

**Status values:** `Open` (agent-actionable), `Open (human-only)`, `**Done**`, `Deferred (reason)`.

**Completeness check:** Total row count must equal the post-dedup finding count in the Executive Dashboard.

**Sections:** Blockers (Critical), Should-Have (High), Deferred (Medium/Low). Include: Estimated Total Effort, Recommended Sequence, Risk Assessment.

---

## Delta Since Previous Audit

(If previous audit exists) New findings, resolved findings, regressed findings, score changes per domain.

---

## Web Research Citations

Consolidated table of every external source cited in this audit cycle's findings. Per [rigor-contract.md](rigor-contract.md) Web Research Mandate.

| Source | URL | Accessed | Author / Org | Trust Tier | Topic / Domain | Recency Verdict |
|--------|-----|----------|--------------|------------|----------------|-----------------|
| (example) | https://genai.owasp.org/llm-top-10/ | 2026-04-19 | OWASP | official-docs | D15 (security) | within window |

Rows are aggregated from the `sources` field of every finding. Sources cited by ≥3 findings appear once with all citing finding IDs in a footnote.
