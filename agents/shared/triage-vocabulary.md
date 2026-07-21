---
id: shared-triage-vocabulary
type: reference
description: Canonical Light/Standard/Deep triage-tier vocabulary — maps the three effort tiers to complexity, effort, sub-agent count, research depth, and per-tier pipeline pruning, and binds the tier-selection contract (mandatory auto-tier emission + --effort/defaultEffort precedence) so every triage-first workflow shares one calibration.
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

## Pipeline pruning per tier

The tier is a pipeline-shaping input, not a label: each tier prunes the four-phase pipeline (`rules/hatch3r-agent-orchestration.md`) to the shape below. Pruning is tier-derived — it follows from task decomposition (module span, decision class), never from token cost; skipping or serializing independent work to save tokens remains a P8 violation.

| Tier | Phase 1 Research | Phase 2 Implement | Phase 3 Review Loop | Phase 4 Final Quality |
|------|------------------|-------------------|---------------------|-----------------------|
| **Light** (`1`) | Research + plan collapse into one pass: single `hatch3r-researcher` at `quick` depth; no separate plan artifact; no ADR. | Single `hatch3r-implementer`. | Max 1 reviewer→fixer iteration; findings remaining after it re-tier the task to Standard instead of extending the loop. | Always-mode floor only (CQ5 testability + CQ3 security at `quick` depth); the floor itself is skippable solely under the four-criteria Tier-1 relaxation in `rules/hatch3r-agent-orchestration.md` → Phase Skip Criteria. |
| **Standard** (`2`) | All task-type researcher modes in parallel; ADR on demand. | One implementer per independent module. | Full review-loop cap per the invoking command. | Always-mode floor at `standard` depth + each triggered conditional specialist at `quick` depth; a triggered mandatory-on-match specialist spawns as its own dedicated instance. |
| **Deep** (`3`) | Deep research, all researcher modes, mandatory ADR, scope confirmation before writes. | One implementer per independent module, dependency-ordered. | Full review-loop cap per the invoking command. | Every applicable specialist at `deep` depth. |

Pruning collapses phase depth; the Tier-1 row above is the default delegated shape, not a spawn mandate. A command body MAY declare a further-collapsed inline Tier-1 lane ("inline execution, no sub-agent fan-out") as sanctioned further pruning — the declared-carve-out class that `rules/hatch3r-agent-orchestration.md` → Mandatory Delegation Directives already models for `hatch3r-quick-change`. Outside a declared inline lane, a Tier-1 run spawns its single implementer per that directive, and fan-out within any phase still tracks the true count of independent units (P8).

---

## Auto-tiering inputs

A triage-first orchestrator classifies a task by reading these three signals before delegating, then picks the highest tier any signal selects:

1. **Module span** — count of distinct modules the change touches: 1 → Light, 2–5 → Standard, >5 → Deep.
2. **Decision class** — additive/reversible → Light or Standard; introduces an architectural decision, a new integration, or a breaking change → Deep.
3. **Acceptance-criteria clarity** — a single clear AC keeps a task Light or Standard; missing/ambiguous AC fires the P8 B1 clarification gate (`rules/hatch3r-clarification-default.md`) before tiering, since an unclassifiable task cannot be tiered.

Tier selection is mandatory at task start: run this classification before the first delegation and emit a one-line rationale — `tier: <1|2|3> — <signal summary>` (e.g. `tier: 1 — 1 module, additive, clear AC`). When the signals are absent (no modules identifiable yet, no decision class inferable), select Tier 2 (Standard) — absent signals never default to Deep; Deep is entered only when a signal affirmatively selects it.

**Tier-source precedence:** explicit `--effort` flag > persisted default effort (`defaultEffort` scalar in `.hatch3r/hatch.json`) > auto-tier classification. A higher-precedence source sets the tier; the emitted rationale line still records the auto-derived tier when the two differ (e.g. `tier: 2 (defaultEffort) — auto: 1`), so overrides and escalations stay visible.

Auto-tiering can misclassify (a single-module task scored Deep, or a cross-cutting task scored Light). The `--effort` flag is the documented recovery path; record the chosen tier in the Iteration Summary recap's tier facet (`rules/hatch3r-iteration-summary.md`).

---

## Cross-references

- **Severity vs tier are orthogonal.** Tier is task *effort* (how much pipeline to run); severity is finding *blast radius* (how bad a defect is). A Light task can surface a Critical finding, and a Deep task can close only Low findings. Map findings on the Critical / High / Medium / Low / Info taxonomy per `agents/shared/quality-charter.md` §14 (Severity Discipline), which delegates the canonical taxonomy to `agents/shared/severity-mapping.md`. Do not collapse the two axes — a Critical finding does not promote a Light task to Deep; it triggers the severity action policy on its own track.
- **Triage-first contract** — `agents/shared/efficiency-patterns.md` → P3 (the `orchestrator: true` requirement for a `triage_tiers` array + a Triage/Tier/Scale Assessment heading).
- **Fan-out width** — `rules/hatch3r-fan-out-discipline.md` (P8 B2): sub-agent count tracks unit count, not tier label.
- **Decision 17** — the `triage_tiers` frontmatter array + `--effort` override contract (governance PRD §Key Design Decisions, Decision 17).
