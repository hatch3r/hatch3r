# Domain 9: Platform Adapters

> Last updated: 2026-05-20

**Pillars served:** P3 (primary), P4 (supporting).

**Scope:** The 3 retained adapters (claude, cursor, copilot) and the capability matrix. One sub-agent per adapter for depth; one sequential synthesis sub-agent.
**Sub-agents:** 4

Sub-agent 9.4 is **sequential** — it runs only after 9.1–9.3 complete.

**Reference:** `docs/adapter-capability-matrix.md`

| SA | Adapter | Source | Output Format | Last Research |
|----|---------|--------|---------------|---------------|
| 9.1 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` | see insights |
| 9.2 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) | see insights |
| 9.3 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) | see insights |
| 9.4 | **Capability Matrix + Emerging Platforms (SEQUENTIAL)** | `docs/adapter-capability-matrix.md` + web research | Cross-adapter synthesis + new candidate scan | n/a |

> "see insights" = `governance/audit/execution-insights.json` → `d9_adapter_research_dates.{adapter}`. Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

**Specific source set (D9-targeted):** official platform documentation for each adapter target (URL + access date YYYY-MM-DD), platform changelog diff vs prior audit cycle, vendor release notes <=12 months. Single-source acceptable only when the trust tier is `official-docs` AND the claim is platform-specific.

## Audit Checklists

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
- [ ] Test coverage: test file adequately covers adapter output paths

### 9.4 Capability Matrix + Emerging Platforms (SEQUENTIAL)

Runs after 9.1–9.3 complete. Owns cross-adapter synthesis and new-platform monitoring.

- [ ] Cross-reference Implementation Matrix against per-adapter findings; purge omission claims contradicted by adapter source or vendor docs
- [ ] Verify "Canonical Path Matches" remain accurate across the 3 retained adapters
- [ ] Maintenance guide verified: every retained adapter listed, every command documented, every hook mapping shown, against filesystem actuals
- [ ] Emerging platforms: search for AI coding tools with significant traction (VC-funded, rising GitHub stars in AI/coding category). Recommend adapter additions with priority ranking and rationale; output feeds next-cycle CL-2 candidate list

## Domain Boundary

> D02 audits adapter contracts and abstractions (base.ts, canonical.ts, customization.ts, content system, integrity system): "Are the abstractions correct?" D09 audits per-adapter implementations: "Does each adapter correctly implement the contract for its target platform?" D11 audits end-to-end integration by tracing specific content types through the full pipeline: "When content flows from canonical source through adapter transformation to disk output, does it arrive correctly?" D11 findings must demonstrate cross-component failures that neither D02 nor D09 would catch independently.
