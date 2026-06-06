---
id: shared-triage-vocabulary
type: reference
description: Canonical Light/Standard/Deep triage-tier vocabulary — maps the three effort tiers to severity, complexity, effort, sub-agent count, and research depth so every triage-first workflow shares one calibration.
tags: [reference]
---

# Triage Vocabulary

> **Pillars:** P7 (Speed & Token Efficiency), P8 (Clarification & Fan-out Discipline), P2 (Scientific & Practical Quality)
> Single source of truth for the Light / Standard / Deep triage tiers. Triage-first orchestrators (`orchestrator: true` commands per `agents/shared/efficiency-patterns.md` → P3) classify each task into one tier before delegating; this file is the shared mapping they calibrate against.

The tier names (Light / Standard / Deep) and the numeric `triage_tiers: [1, 2, 3]` frontmatter array are two spellings of the same three tiers: `1 = Light`, `2 = Standard`, `3 = Deep`. The user `--effort=light|standard|deep` flag (PRD Decision 17) forces a named tier and bypasses auto-classification. This file binds the named spelling, the numeric spelling, and the `--effort` flag values to one calibration so a tier classified in one workflow means the same depth in another.

---

## Tier mapping

| Tier | When to use | Complexity | Effort | Depth | Sub-agent count | Examples |
|------|-------------|------------|--------|-------|-----------------|----------|
| **Light** (`1`, `--effort=light`) | Single-module change with a clear, testable acceptance criterion; no architectural decision; reversible. | 1 module touched. | S — minutes to ~1 hour. | Reduced fan-out: 1–2 researchers; skip ADR generation; single standalone todo entry, not an epic. | ~2 (reduced researcher set + writer). | Typo fix, single-function edit, frontmatter-only change, copy tweak. |
| **Standard** (`2`, `--effort=standard`) | Feature touching 2–5 modules with sub-tasks; ADR generated only if an architectural decision arises mid-flow. | 2–5 modules touched. | M — hours to ~1 day. | Standard pipeline: all parallel researcher modes; ADR-on-demand. | ~6 (researcher modes + writer + on-demand specialist gates). | Add an endpoint to an existing service, extend an existing schema additively, wire a new component into an existing flow. |
| **Deep** (`3`, `--effort=deep`) | Cross-cutting work: new architecture, multiple integrations, or a breaking change; confirm scope with the user before writing files. | New architecture or breaking change spanning >5 modules / multiple subsystems. | L — multi-day. | Full pipeline: deep research, all researcher modes, full specialist fan-out, mandatory ADR. Confirm scope via `agents/shared/user-question-protocol.md` before writing. | Up to 13 (4–5 parallel researcher modes + writer + the 9 CQ vector specialists advising pre-write). | New subsystem, breaking API/schema migration, cross-service integration, framework-wide refactor. |

The sub-agent counts are calibration anchors, not caps. P8 (`rules/hatch3r-fan-out-discipline.md`) governs the actual width: fan out to the true count of independent units even when it exceeds the tier anchor, and never serialize independent work to hit a lower count. The `expected_sa_count` field that orchestrators emit (per `rules/hatch3r-cost-visibility.md`) derives its preview from this column; a post-run delta beyond 25% absolute carries `flagged_for_review: true`.

---

## Auto-tiering inputs

A triage-first orchestrator classifies a task by reading these three signals before delegating, then picks the highest tier any signal selects:

1. **Module span** — count of distinct modules the change touches: 1 → Light, 2–5 → Standard, >5 → Deep.
2. **Decision class** — additive/reversible → Light or Standard; introduces an architectural decision, a new integration, or a breaking change → Deep.
3. **Acceptance-criteria clarity** — a single clear AC keeps a task Light or Standard; missing/ambiguous AC fires the P8 B1 clarification gate (`.claude/rules/clarification-default.md`) before tiering, since an unclassifiable task cannot be tiered.

Auto-tiering can misclassify (a single-module task scored Deep, or a cross-cutting task scored Light). The `--effort` flag is the documented recovery path; record the chosen tier in the iteration summary `triage_tier` field (`rules/hatch3r-iteration-summary.md`).

---

## Cross-references

- **Severity vs tier are orthogonal.** Tier is task *effort* (how much pipeline to run); severity is finding *blast radius* (how bad a defect is). A Light task can surface a Critical finding, and a Deep task can close only Low findings. Map findings on the Critical / High / Medium / Low / Info taxonomy per `agents/shared/quality-charter.md` §14 (Severity Discipline), which delegates the canonical taxonomy to `agents/shared/severity-mapping.md`. Do not collapse the two axes — a Critical finding does not promote a Light task to Deep; it triggers the severity action policy on its own track.
- **Triage-first contract** — `agents/shared/efficiency-patterns.md` → P3 (the `orchestrator: true` requirement for a `triage_tiers` array + a Triage/Tier/Scale Assessment heading).
- **Fan-out width** — `rules/hatch3r-fan-out-discipline.md` (P8 B2): sub-agent count tracks unit count, not tier label.
- **Decision 17** — the `triage_tiers` frontmatter array + `--effort` override contract (governance PRD §Key Design Decisions, Decision 17).
