# Domain 9: Platform Adapters

> Last updated: 2026-05-20

**Pillars served:** governance-axis P3 (primary), P4 (supporting); content-quality-axis CQ9 Enhancability (supporting — adapter extensibility).

**Scope:** The 3 retained adapters (claude, cursor, copilot) and the capability matrix. One sub-agent per adapter for depth; two sequential synthesis sub-agents (capability matrix verification + emerging platforms).
**Sub-agents:** 5

Sub-agents 9.4 and 9.5 are **sequential** — they run only after 9.1–9.3 complete, and may run in parallel with each other once unblocked.

**Reference:** `docs/adapter-capability-matrix.md`

| SA | Adapter | Source | Output Format | Last Research |
|----|---------|--------|---------------|---------------|
| 9.1 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` | see insights |
| 9.2 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) | see insights |
| 9.3 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) | see insights |
| 9.4 | **Capability Matrix Verification (SEQUENTIAL)** | `docs/adapter-capability-matrix.md` + per-adapter findings | Cross-adapter synthesis | n/a |
| 9.5 | **Emerging Platforms (SEQUENTIAL)** | Web research on AI coding tools with significant traction | New candidate scan | n/a |

> "see insights" = `governance/audit/execution-insights.json` → `d9_adapter_research_dates.{adapter}`.
> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

**Specific source set (D9-targeted):** official platform documentation for each adapter target (URL + access date YYYY-MM-DD), platform changelog diff vs prior audit cycle, vendor release notes <=12 months. Single-source acceptable only when the trust tier is `official-docs` AND the claim is platform-specific.

## Audit Checklists

> **Per-finding (Decision 17 / charter directive 18):** every finding declares `impact_horizon: short|medium|long` AND `progress_toward_pillar: <axis>.<pillar_id>+<delta>` (e.g., `governance.P5+0.15` or `content-quality.CQ4+0.20`); orchestrator DROPS at output time if either missing.

### 9.1–9.3 Per-Adapter Checklist

Each adapter sub-agent MUST:
1. Read the adapter source code (`src/adapters/{name}.ts`)
2. Read the corresponding test file (`src/__tests__/adapters/{name}.test.ts`)
3. Per-cycle currency research (mandatory): write a `**Last web-research date:** YYYY-MM-DD` line at the top of `.audit-workspace/D9-SA9.{N}.findings.md` citing the platform's official documentation URL, access date, author/org, and trust tier per `governance/audit/templates/rigor-contract.md`. Compare against the prior cycle's date in `governance/audit/execution-insights.json::d9_adapter_research_dates.{adapter_name}`. If the prior date is ≤90 days old AND the platform changelog has no new entries since, the SA MAY cite the prior research with ≤2 spot-check URLs. Otherwise full re-research is mandatory. Omitting the date line or prior-cycle comparison is a Medium finding.
4. Verify against the following checklist:
- [ ] Output file paths match the capability matrix documentation
- [ ] Output format matches current platform docs (not assumptions); feature flag behavior skips unsupported capabilities
- [ ] Model emission rendering matches platform-native preference syntax (native field if supported, guidance string fallback otherwise); MCP config transformation matches the platform's documented schema; secret loading method matches platform's documented secret-source
- [ ] Hook/event mapping matches the platform's current hook taxonomy (event names, payload shape); new platform capabilities not yet supported by the adapter are flagged
- [ ] User-question tool: verify platform's current native question tool via official docs. Confirm `ASK_USER_TOOLS[adapter]` in `src/pipeline/adapterToolTranslator.ts` and `nativeQuestionTool` in `src/adapters/index.ts` agree (both populated, or both null/false). Cite URL + access date.
- [ ] **Capability utilization scan (Decision 21):** enumerate every native capability of {claude|cursor|copilot} from official docs (hooks, slash commands, tool-use modes, MCP transports, settings.json keys); map current adapter coverage (utilized/partially-utilized/unutilized); surface unutilized capabilities as Info or Medium findings depending on capability value. Cite vendor docs URL + access date per rigor contract.
- [ ] **Comparable-artifact delta (Decision 20):** for the audited adapter (claude/cursor/copilot), web-research ≥2 reputable comparable platform-adapter implementations (e.g., Aider, CrewAI, GoodIdea adapters); tabulate feature/pattern delta vs current hatch3r adapter; surface deltas as findings.
- [ ] Companion content emission: adapter calls `emitCompanionContent` for every support subdirectory in scope and emits each `.md` file to the per-adapter native path with `substituteCanonicalContent` applied
- [ ] Test coverage: test file adequately covers adapter output paths

### 9.4 Capability Matrix Verification (SEQUENTIAL)

Runs after 9.1–9.3 complete. Owns cross-adapter synthesis.

- [ ] Cross-reference Implementation Matrix against per-adapter findings; purge omission claims contradicted by adapter source or vendor docs
- [ ] Verify "Canonical Path Matches" remain accurate across the 3 retained adapters
- [ ] Maintenance guide verified: every retained adapter listed, every command documented, every hook mapping shown, against filesystem actuals
- [ ] Companion-content emission verified: each adapter's `emitCompanionContent` output appears under the per-adapter native path for `agents/modes/`, `agents/shared/`, `commands/board/`, `commands/revision/`, `checks/` (1.9.0 feature — see commit 8c92831)
- [ ] **Utilization-gap aggregation:** collate unutilized capabilities across the 3 adapters; surface top 3-5 highest-value gaps as CL-2 candidates for next-cycle adapter enhancement.

### 9.5 Emerging Platforms (SEQUENTIAL)

Runs after 9.1–9.3 complete. Owns new-platform monitoring.

- [ ] Emerging platforms: search for AI coding tools with significant traction (VC-funded, rising GitHub stars in AI/coding category)
- [ ] Tracked candidates: monitor signal for previously-retired adapters (opencode, gemini, codex, cline, aider, kiro, goose, zed, windsurf, amp, amazonq, antigravity) and assess re-introduction triggers
- [ ] Recommend adapter additions with priority ranking and rationale; output feeds next-cycle CL-2 candidate list

## Domain Boundary

> **Domain boundary with D02 + D11 — see [D02 §Domain Boundary](D02-adapter-infrastructure.md#domain-boundary).** D02 carries the canonical text (Anti-Bloat Principle 1 — single source of truth).
