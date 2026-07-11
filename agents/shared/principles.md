---
id: shared-principles
type: reference
description: Public reference for the 8 governance pillars (P1-P8), the 10 content-quality pillars (CQ1-CQ10), and the content-quality thresholds that public content cites.
tags: [reference]
---

## Purpose

Public anchor for the pillar labels and content-quality thresholds that shipped content references. This file carries the labels and the end-user-code quality targets only — not design rationale, audit methodology, internal lean budgets, the PRD, or competitive analysis.

## Governance Pillars (P1-P8)

How the framework operates.

| Pillar | Name |
|--------|------|
| P1 | Adoption Experience |
| P2 | Scientific & Practical Quality |
| P3 | Adapter & External Tool Currency |
| P4 | Comprehensive Lean Coverage |
| P5 | Governance Self-Quality |
| P6 | Security & Trust Governance |
| P7 | Speed & Token Efficiency |
| P8 | Clarification & Fan-out Discipline |

## Content-Quality Pillars (CQ1-CQ10)

What the framework produces in end-user code. CQ1-CQ9 each have a specialist agent under `agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md`; the CQ10 (Product & Spec) specialist is queued for the next audit cycle.

| Pillar | Name |
|--------|------|
| CQ1 | UI |
| CQ2 | UX |
| CQ3 | Security & Compliance |
| CQ4 | Reliability |
| CQ5 | Testability |
| CQ6 | Scalability |
| CQ7 | Performance |
| CQ8 | Maintainability |
| CQ9 | Enhancability |
| CQ10 | Product & Spec |

## Content-Quality Thresholds

Measurable targets the content-quality specialists enforce on generated end-user code.

| Metric | Limit |
|--------|-------|
| Generated UI a11y violations (axe-core, serious/critical) | 0 |
| Design-token adoption in generated code (color, spacing, typography) | >=95% |
| Four-state surface contract coverage on generated async views | 100% |
| Generated-service OTel instrumentation on request path | 100% |
| Migration expand-contract conformance | 100% |
| API breaking-change events on stable endpoints | 0 per release |
| AI feature eval coverage | 100% |
| Per-feature test-class mandate compliance | 100% |
| Supply-chain floor coverage | 100% |
| User-facing service SLO defined | 100% |
| Auth depth coverage | 100% |
| Acceptance-criteria testability on specs | 100% |
| Discovery claims evidence-cited | 100% |
| Spec-to-outcome traceability | 100% |
| Anti-slop phrases | 0 per file |
