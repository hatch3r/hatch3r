# Domain 18: PRD, Roadmap & Distribution

> Last updated: 2026-04-19

**Pillars served:** P5 (primary), P4 (supporting).

**Scope:** Strategic alignment between product vision, roadmap, and current implementation.
**Sub-agents:** 3

ALL sub-agents are **sequential** — they run only after D16 and D17 complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 18.1 | PRD Alignment | D16, D17 |
| 18.2 | Roadmap Reprioritization | D16, D17 |
| 18.3 | Distribution Verdict | D16, D17, 18.1, 18.2 |

**Files to check:**
- `governance/hatch3r-prd.md` (gitignored — ask user if available)
- `governance/COMPETITIVE-ANALYSIS.md` (gitignored — ask user if available)
- `todo.md` (gitignored — current roadmap)
- `governance/VISION.md` (committed — stable north-star vision document)
- `governance/RE-ENVISION.md` (committed — framework-owner vision capture prompt)

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Phase 0 Distribution Baseline (MUST run before 18.1)

Before any 18.x sub-agent drafts a finding, the D18 orchestrator MUST capture a live distribution baseline (date-stamped within the current cycle, not carried from a prior cycle):

- [ ] npm registry: `curl -s https://registry.npmjs.org/hatch3r | jq '{ name, "dist-tags": ."dist-tags", versions: (.versions | keys) }'` — record current published version, dist-tags, and version history
- [ ] GitHub API (repo): `gh api repos/<owner>/<repo>` — record stargazers_count, forks_count, open_issues_count, default_branch, pushed_at
- [ ] GitHub API (releases): `gh api repos/<owner>/<repo>/releases` — record latest release tag and date
- [ ] Write the snapshot to `.audit-workspace/D18-distribution-baseline.json` with `captured_at` ISO timestamp
- [ ] Any 18.3 distribution finding citing "zero npm presence" or "zero GitHub traction" MUST cite this snapshot, not a prior-cycle framing

## Audit Checklists

### 18.1 PRD Alignment
- [ ] PRD vs implementation gap — what is specified but not built? What is built but not specified?
- [ ] PRD relevance — does the PRD reflect the current competitive landscape from D17?
- [ ] Feature prioritization — are high-impact features prioritized correctly?
- [ ] Technical debt — are there architectural decisions that should be revisited?
- [ ] VISION.md alignment — does the current implementation serve the north-star vision? Are there features that have drifted from the vision?
- [ ] Vision-PRD consistency — does the PRD's Section 2 (Vision) align with VISION.md? Flag any divergence
- [ ] PRD scope validation — verify adapter count, content counts, and platform names match the codebase. Mismatches are Critical findings
- [ ] CL-1 lifecycle tracking — verify that CL-1 PRD evolution candidates from the previous audit cycle have a tracked disposition (accepted, deferred with rationale, or rejected with rationale). Untracked CL-1 items indicate a broken closed-loop

### 18.2 Roadmap Reprioritization
- [ ] Reprioritization based on compound system evaluation (D16)
- [ ] Reprioritization based on competitive landscape (D17)
- [ ] Priority reassignment for existing roadmap items — escalate items with audit-driven urgency
- [ ] Missing roadmap items revealed by the audit
- [ ] Long-term strategic items — still relevant? Priority shift needed?
- [ ] Closed-loop effectiveness — are audit findings reaching the PRD and roadmap? Compare previous audit's PRD Evolution Candidates against current PRD version

### 18.3 Distribution Verdict

Requires 18.1 and 18.2 results:
- [ ] Open-source vs private npm (or both) recommendation with rationale
- [ ] Marketplace strategy — Cursor marketplace, Claude Code marketplace, other distribution channels
- [ ] Timing recommendation — ready now, or what needs to happen first?
- [ ] Licensing considerations — MIT suitability, dual licensing options
- [ ] Community building strategy — how to grow adoption and contributions
- [ ] Vision alignment of distribution strategy — does the distribution approach serve the north-star vision or diverge from it?

## Strategic Decision Register

Items classified as human-decision (open-source, branding, investment, distribution strategy) are tracked here, not as findings. They:
- Do not generate findings or affect domain score
- Are listed in the Executive Dashboard under "Stalled Strategic Decisions" if unresolved for 3+ cycles
- Require `Owner: Human` classification and `disposition: "strategic_register"` in the finding registry if they do generate findings

Agent-verifiable items (competitor feature comparison, documentation currency, community metrics, platform update tracking) remain as standard checklist items and generate findings normally.
