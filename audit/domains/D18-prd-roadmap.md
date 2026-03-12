# Domain 18: PRD, Roadmap & Distribution

**Scope:** Strategic alignment between product vision, roadmap, and current implementation.
**Sub-agents:** 3

ALL sub-agents are **sequential** — they run only after D16 and D17 complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 18.1 | PRD Alignment | D16, D17 |
| 18.2 | Roadmap Reprioritization | D16, D17 |
| 18.3 | Distribution Verdict | D16, D17, 18.1, 18.2 |

**Files to check:**
- `hatch3r-prd.md` (gitignored — ask user if available)
- `COMPETITIVE-ANALYSIS.md` (gitignored — ask user if available)
- `todo.md` (gitignored — current roadmap)

## Audit Checklists

### 18.1 PRD Alignment
- [ ] PRD vs implementation gap — what is specified but not built? What is built but not specified?
- [ ] PRD relevance — does the PRD reflect the current competitive landscape from D17?
- [ ] Feature prioritization — are high-impact features prioritized correctly?
- [ ] Technical debt — are there architectural decisions that should be revisited?

### 18.2 Roadmap Reprioritization
- [ ] Reprioritization based on compound system evaluation (D16)
- [ ] Reprioritization based on competitive landscape (D17)
- [ ] Priority reassignment for existing roadmap items
- [ ] Missing roadmap items revealed by the audit
- [ ] Long-term strategic items — still relevant? Priority shift needed?

### 18.3 Distribution Verdict

Requires 18.1 and 18.2 results:
- [ ] Open-source vs private npm (or both) recommendation with rationale
- [ ] Marketplace strategy — Cursor marketplace, Claude Code marketplace, other distribution channels
- [ ] Timing recommendation — ready now, or what needs to happen first?
- [ ] Licensing considerations — MIT suitability, dual licensing options
- [ ] Community building strategy — how to grow adoption and contributions
