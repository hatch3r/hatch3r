# Domain 7: Agent Orchestration Optimization

**Scope:** The four-phase pipeline architecture and its optimization for maximum task success rate.
**Sub-agents:** 5

| SA | Focus |
|----|-------|
| 7.1 | Pipeline Design |
| 7.2 | Review Loop Calibration |
| 7.3 | Phase 4 Dispatch |
| 7.4 | Dynamic Adaptation |
| 7.5 | Multi-Task Orchestration |

## Audit Checklists

### 7.1 Pipeline Design
- [ ] Is the four-phase pipeline optimally ordered? Should research and implementation be more tightly coupled?
- [ ] Pipeline linearity vs DAG assessment — are there phases that could run in parallel?
- [ ] Phase skipping heuristics — should the pipeline skip research for trivial tasks?
- [ ] Phase handoff contracts — are data formats between phases well-defined?

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
