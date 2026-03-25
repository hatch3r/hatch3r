# Domain 6: Context Engineering & Token Economics

**Scope:** How the framework manages context windows, instruction density, and token costs across the agent pipeline.
**Sub-agents:** 4

## Sub-Agent Decomposition

| SA | Focus |
|----|-------|
| 6.1 | Context Window Utilization |
| 6.2 | Instruction Density & Redundancy |
| 6.3 | Cost Modeling |
| 6.4 | Memory Safety & Context Poisoning |

## Audit Checklists

### 6.1 Context Window Utilization
- [ ] BRIDGE_ORCHESTRATION content token measurement — how many tokens does the full bridge content consume?
- [ ] Inline rules token cost per adapter — measure token overhead of inlined rules
- [ ] Per-phase context window consumption analysis — how much of the context window does each pipeline phase consume?
- [ ] Context window overflow scenarios — what happens when content exceeds the window?
- [ ] Caching opportunities — which content is static vs dynamic, and can static content be cached?

### 6.2 Instruction Density & Redundancy
- [ ] Instruction redundancy across agents — are the same instructions repeated in multiple agents?
- [ ] Information density scoring — ratio of actionable instructions to boilerplate
- [ ] Compression opportunities — can instructions be shortened without losing effectiveness?
- [ ] Rule consolidation potential — can overlapping rules be merged?

### 6.3 Cost Modeling
- [ ] Per-task estimated token cost — research + implement + review + final quality total
- [ ] Cost scaling with project size — how does token cost grow with repository size?
- [ ] Cost comparison with competitors — how does hatch3r's token overhead compare?
- [ ] Optimization opportunities — identify the highest-cost areas with room for reduction

### 6.4 Memory Safety & Context Poisoning
- [ ] Learnings poisoning prevention — can `/.agents/learnings/` be weaponized to manipulate future agent behavior?
- [ ] Context injection via user-controlled files — can project files inject instructions into agent context?
- [ ] Session isolation — does corrupted context from one session persist and affect subsequent sessions?
- [ ] Memory safety boundaries — are there limits on what learnings can contain?
