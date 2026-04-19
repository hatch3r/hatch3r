# Domain 7: Agent Orchestration Optimization

> Last updated: 2026-04-19

**Pillars served:** P2 (primary), P4 (supporting).

**Scope:** The four-phase pipeline architecture and its optimization for maximum task success rate.
**Sub-agents:** 5

| SA | Focus |
|----|-------|
| 7.1 | Pipeline Design |
| 7.2 | Review Loop Calibration |
| 7.3 | Phase 4 Dispatch |
| 7.4 | Dynamic Adaptation |
| 7.5 | Multi-Task Orchestration |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Audit Checklists

### 7.1 Pipeline Design
- [ ] Is the four-phase pipeline optimally ordered? Should research and implementation be more tightly coupled?
- [ ] Pipeline linearity vs DAG assessment — are there phases that could run in parallel?
- [ ] Phase skipping heuristics — should the pipeline skip research for trivial tasks?
- [ ] Phase handoff contracts — are data formats between phases well-defined?
- [ ] Premise-challenging support — can the pipeline support an agent recommending to abort or fundamentally rethink a task it believes is misconceived? Is there a mechanism for an agent to escalate "I don't think we should build this" to the user, rather than being forced to implement regardless?
- [ ] Superficial fix detection — does the review loop catch fixes that address symptoms rather than root causes? If the fixer adds a try-catch without addressing the underlying error strategy, does the reviewer flag this and send it back?
- [ ] One-shot success analysis: estimate probability that a user's first task succeeds end-to-end without manual intervention, considering instruction clarity (from D5), orchestration design, and error recovery (from D8)

### 7.2 Review Loop Calibration
- [ ] Review loop convergence analysis — does the reviewer-fixer loop converge in practice?
- [ ] Max 3 iterations — is this calibrated from data or arbitrary?
- [ ] Typical convergence pattern — findings resolved per iteration
- [ ] Loop escape conditions — when to stop even with remaining findings

### 7.3 Phase 4 Dispatch
- [ ] Resource contention — how many Phase 4 agents run simultaneously?
- [ ] Dispatch logic for conditional specialists — when is a11y-auditor invoked vs skipped?
- [ ] Phase 4 completion criteria — what defines "done" for final quality?
- [ ] Specialist output integration — how are specialist findings consolidated?

### 7.4 Dynamic Adaptation
- [ ] Dynamic phase skipping heuristics — can the pipeline skip phases based on task type?
- [ ] Context degradation across phases — how much useful context is lost between research and final quality?
- [ ] Non-determinism handling — does the pipeline account for LLM sampling variance?
- [ ] Adaptive complexity — does the pipeline scale effort to task difficulty?

### 7.5 Multi-Task Orchestration
- [ ] Simultaneous task handling — how does the pipeline handle multiple concurrent tasks?
- [ ] Resource contention between concurrent pipelines
- [ ] Task priority and scheduling
- [ ] Cross-task context sharing — can insights from one task benefit another?
- [ ] Cross-command pipeline structure consistency — do all orchestration-heavy commands (workflow, board-pickup, revision, quick-change) implement the same structural pipeline pattern? Specifically: researcher phase (or explicit skip criteria), implementer delegation (never inline for nontrivial), review loop (reviewer then fixer), final quality (test-writer + security-auditor in parallel). Flag structural deviations that are not justified by the command's stated scope differences.
- [ ] Cross-command delegation protocol consistency — do all commands use the same Task tool invocation pattern (`subagent_type: "generalPurpose"`)? Do all commands include the same set of mandatory prompt components? Compare the "prompt MUST include" lists across workflow (Phase 3b, 4a, 4b), board-pickup delegation (6a.2, 6a.3, 6b.3, 6c.3), revision (Step 6b, 7c, 7d), and quick-change (Step 4b, 6a, 6b).
- [ ] Cross-command error handling consistency — do all commands handle sub-agent failure the same way (retry once, fall back)? Do all commands handle quality check failure the same way (max 2 retries, ASK)? Do all commands handle context degradation the same way (recommend fresh context after threshold)?
