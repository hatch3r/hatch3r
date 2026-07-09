---
id: pillar-compliance
type: rule
description: Every change in governance/agents/skills/rules/commands/hooks must serve at least one pillar on at least one axis (P1-P8 governance / CQ1-CQ9 content-quality) per CONSTITUTION §2.
tags: [maintainer, governance, p5]
scope: always
precedence: high
---

# Pillar Compliance

> Last updated: 2026-07-09

**Pillars:** P5 (Governance Self-Quality)

Before modifying any file in `governance/`, `agents/`, `skills/`, `rules/`, `commands/`, or `hooks/`, run the Pillar Compliance Test (2.0.0, mirrors `CLAUDE.md` → Two-Axis Pillar Framework):

1. **Which pillar(s) does this change serve, on which axis** (governance and/or content-quality)? If none → reject.
2. **What measurable improvement does it produce?**
3. **Does it increase governance size?** If yes → justify net value exceeding size cost.
4. **Does it degrade end-user runtime efficiency?** If yes → reject or document offset.
5. **Impact horizon (Decision 24):** short | medium | long? If unanswerable → reject.
6. **P8 dominance over P7:** does this change under-fan-out for token-cost reasons? If yes → reject (P8 dominates).

Two axes, defined in `governance/CONSTITUTION.md` §2: the **governance axis** (§2A, P1-P8) covers how the framework operates; the **content-quality axis** (§2B, CQ1-CQ9) covers what the framework produces in end-user code (UI / UX / Security / Reliability / Testability / Scalability / Performance / Maintainability / Enhancability), each with a specialist agent under `agents/hatch3r-{ui,ux,security,reliability,testability,scalability,performance,maintainability,enhancability}.md`.

The 8 pillars: P1 CLI UX, P2 Scientific Quality, P3 Adapter Currency, P4 Lean Coverage, P5 Governance Self-Quality, P6 Security & Trust, P7 Speed & Token Efficiency, P8 Clarification & Fan-out Discipline.
