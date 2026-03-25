# Domain 16: Compound System Evaluation

**Scope:** Evaluating hatch3r as a complete compound system rather than individual components.
**Sub-agents:** 5

ALL sub-agents are **sequential** — they run only after their cross-domain dependencies complete. 16.5 additionally depends on the previous audit cycle's report being available.

| SA | Focus | Depends On |
|----|-------|-----------|
| 16.1 | One-Shot Success Analysis | D5, D7 |
| 16.2 | Content Coverage Gap Analysis | D5, D9 |
| 16.3 | Prompt Consistency Across System | D5, D7 |
| 16.4 | Regression & Maintenance Quality | D3, D4 |
| 16.5 | Closed-Loop Effectiveness | D18 (previous cycle) |

## Audit Checklists

### 16.1 One-Shot Success Analysis
- [ ] SWE-bench style success rate analysis — estimate the probability that a user's first task (feature, bug fix, refactor) succeeds end-to-end without manual intervention
- [ ] Instruction clarity impact (from D5) — how does prompt quality affect success rate?
- [ ] Pipeline design impact (from D7) — how does orchestration design affect success rate?
- [ ] Error recovery impact (from D8) — how do failure modes reduce success rate?
- [ ] One-shot vs multi-shot success rates — how many iterations does a typical task require?
- [ ] Content interaction testing — when an implementer agent loads 15+ always-apply rules, a skill workflow, shared context, and the agent's own instructions simultaneously, do the instructions conflict, contradict, or create ambiguity? Test with representative combinations, not just individual artifacts.
- [ ] MCP dependency graceful degradation — what happens when a command or skill references an MCP server (Context7, GitHub, Brave Search) that is not configured or is unreachable? Does the workflow fail gracefully with clear guidance, or does it silently produce degraded output?

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

### 16.5 Closed-Loop Effectiveness
- [ ] PRD evolution tracking — were previous audit cycle's PRD Evolution Candidates incorporated into the PRD? Compare `hatch3r-prd.md` version history against previous audit report's closed-loop sections.
- [ ] Content gap closure rate — were content artifacts identified in previous cycles' Content Gap Artifacts actually created? Count artifacts that match previous proposals.
- [ ] Audit evolution adoption rate — were previous cycle's accepted Audit Self-Evolution Proposals reflected in current AUDIT.md and domain files?
- [ ] Feedback loop latency — how many audit cycles does it take for a finding to reach the PRD? For content to be created? For audit prompts to evolve?
- [ ] Diminishing returns — are audit scores improving cycle over cycle? Is the rate of improvement slowing (healthy maturity) or stalling (broken loop)?
- [ ] Learning system integration — are audit findings being captured as learnings in `/.agents/learnings/`? Is the learning system consulted during audit execution?
