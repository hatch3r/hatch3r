# Domain 6: Context Engineering & Token Economics

> Last updated: 2026-04-27

**Pillars served:** P4 (primary), P7 (primary), P2 (supporting).

**Scope:** How the framework manages context windows, instruction density, token costs, and end-user runtime efficiency across the agent pipeline.
**Sub-agents:** 6

## Sub-Agent Decomposition

| SA | Focus |
|----|-------|
| 6.1 | Context Window Utilization |
| 6.2 | Instruction Density & Redundancy |
| 6.3 | Cost Modeling |
| 6.4 | Context Integrity & Isolation |
| 6.5 | End-User Runtime Efficiency |
| 6.6 | Cross-Adapter Efficiency Consistency |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

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

### 6.4 Context Integrity & Isolation
- [ ] Learnings poisoning prevention — can `/.agents/learnings/` be weaponized to manipulate future agent behavior?
- [ ] Context injection via user-controlled files — can project files inject instructions into agent context?
- [ ] Session isolation — does corrupted context from one session persist and affect subsequent sessions?
- [ ] Memory safety boundaries — are there limits on what learnings can contain?

### 6.5 End-User Runtime Efficiency
- [ ] Static-first ordering — every `commands/*.md` with `orchestrator: true` and every `agents/*.md` places stable system/role content above volatile turn data; no run-ID, timestamp, or session counter precedes the static prompt frame
- [ ] Parallel-tool-by-default — agents performing >=2 independent tool calls (read multiple files, run lint+tests, fetch separate URLs) explicitly instruct parallel invocation; serialized-by-default patterns are findings
- [ ] Triage-first orchestrator — every `orchestrator: true` command has a triage step before delegation (Tier 1/2/3 model from `commands/hatch3r-quick-change.md`)
- [ ] Plan/act split — non-trivial commands separate planning sub-agent from execution sub-agent; bundled plan+act in one prompt is a Medium finding
- [ ] Structured outputs over prose — multi-step pipelines emit machine-parseable handoff (YAML/JSON tables) between phases; free-form prose handoff is a finding
- [ ] Lazy loading / reference-by-pointer — bulky context (board state, learnings corpus, AGENTS.md) is loaded conditionally with a token budget rather than eagerly inlined
- [ ] Conditional sub-agent invocation (dispatch-gating, NOT fan-out narrowing) — Phase 4 specialists are dispatch-gated on task relevance signals (e.g., a11y-auditor skipped when no UI changes); a finding requires the gate to be wrong, not narrow. Under-fan-out of independent work for cost reasons is a P8 violation, not a P7 win (see Pillar note below).

### 6.6 Cross-Adapter Efficiency Consistency
- [ ] All 15 adapter outputs preserve static-first ordering after canonical-to-adapter transformation; no adapter rewrites the prompt frame to inject volatile metadata at the top
- [ ] Provider-specific cache hints (Anthropic prompt caching, OpenAI Responses caching) are surfaced where supported but graceful when absent — model-agnostic claim
- [ ] Governance-only: `triage_tiers`, `efficiency_tier`, `cache_friendly`, `parallel_tool_default`, and `efficiency_patterns` frontmatter fields remain declared on canonical artifacts (verified by `scripts/validate-efficiency-invariants.ts`). Adapter outputs are NOT required to echo these signals — they are advisory metadata for the audit layer, not adapter contract.
- [ ] Cross-adapter parity check — same canonical artifact yields semantically equivalent efficiency-relevant prompt structure across all 15 adapters

## Universal Checklist
- [ ] Every published artifact passes static-first ordering; no anti-cache patterns (mid-prompt timestamps, ephemeral counters, per-run UUIDs above stable frames)
- [ ] Efficiency claims are model-agnostic — provider-specific optimizations (e.g., Anthropic `cache_control`) are advisory, not required

## P7 vs P8 Boundary
P7 governs static-prompt efficiency and dependency-edge serialization. P8 governs fan-out width. Cost is never a valid reason to under-fan-out independent work — that is a P8 (B2) violation, not a P7 win. D06 findings that recommend narrowing fan-out must cite a dependency edge, not token economics.

## Domain Boundary

> D06 audits context engineering, token economics, and end-user runtime efficiency under normal operation. **Versus D05** (prompt engineering quality): D05 = "is the instruction clear and complete?"; D06 = "is the prompt structured for cache and tokens?" If a finding is about meaning/clarity → D05; if about ordering/structure/tool-call patterns → D06. **Versus D07** (orchestration optimization): D07 = pipeline-level architecture (phase ordering, review-loop convergence); D06 = per-prompt token mechanics within those phases. **Versus D15** (security): adversarial input → D15; normal-operation token/cache → D06.
