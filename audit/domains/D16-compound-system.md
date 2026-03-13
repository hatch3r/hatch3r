# Domain 16: Compound System Evaluation

**Scope:** Evaluating hatch3r as a complete compound system rather than individual components.
**Sub-agents:** 4

ALL sub-agents are **sequential** — they run only after their cross-domain dependencies complete.

| SA | Focus | Depends On |
|----|-------|-----------|
| 16.1 | One-Shot Success Analysis | D5, D7 |
| 16.2 | Content Coverage Gap Analysis | D5, D9 |
| 16.3 | Prompt Consistency Across System | D5, D7 |
| 16.4 | Regression & Maintenance Quality | D3, D4 |

## Audit Checklists

### 16.1 One-Shot Success Analysis
- [ ] SWE-bench style success rate analysis — estimate the probability that a user's first task (feature, bug fix, refactor) succeeds end-to-end without manual intervention
- [ ] Instruction clarity impact (from D5) — how does prompt quality affect success rate?
- [ ] Pipeline design impact (from D7) — how does orchestration design affect success rate?
- [ ] Error recovery impact (from D8) — how do failure modes reduce success rate?
- [ ] One-shot vs multi-shot success rates — how many iterations does a typical task require?

### 16.2 Content Coverage Gap Analysis
- [ ] Map content artifacts to user workflows — which workflows are fully covered, partially covered, or uncovered?
- [ ] Tech stack coverage — are there project types not served by any content artifact?
- [ ] Workflow type coverage — are there common development workflows (CI/CD, database migration, API design) with no supporting content?
- [ ] Gap prioritization — rank uncovered areas by user impact

### 16.3 Prompt Consistency Across System
- [ ] Consistent terminology — do all artifacts use the same terms for the same concepts?
- [ ] Consistent severity levels — are "Critical", "High", "Medium", "Low" used uniformly?
- [ ] Consistent output formats — do all artifacts produce structurally compatible output?
- [ ] Cross-artifact contradiction detection — do any artifacts give conflicting instructions?

### 16.4 Regression & Maintenance Quality
- [ ] Zero-regression rate — how well does the framework maintain quality across updates?
- [ ] Regression testing infrastructure — are there tests that catch content regressions?
- [ ] Maintenance burden analysis — effort required to keep the framework current
- [ ] Content freshness — are artifacts up-to-date with current platform capabilities?
