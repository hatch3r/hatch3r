# Domain 9: Platform Adapters

> Last updated: 2026-05-12

**Pillars served:** P3 (primary), P4 (supporting).

**Scope:** All 15 adapters and the capability matrix. One sub-agent per adapter for maximum depth.
**Sub-agents:** 17

Sub-agents 9.16 and 9.17 are **sequential** — they run only after 9.1–9.15 complete.

**Reference:** `docs/adapter-capability-matrix.md`

| SA | Adapter | Source | Output Format | Last Research |
|----|---------|--------|---------------|---------------|
| 9.1 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) | see insights |
| 9.2 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) | see insights |
| 9.3 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` | see insights |
| 9.4 | Cline | `src/adapters/cline.ts` | `.roo/`, `.roomodes`, `.cline/` | see insights |
| 9.5 | Codex | `src/adapters/codex.ts` | `.codex/config.toml`, AGENTS.md bridge | see insights |
| 9.6 | Gemini | `src/adapters/gemini.ts` | `GEMINI.md`, `.gemini/` | see insights |
| 9.7 | Windsurf | `src/adapters/windsurf.ts` | `.windsurfrules`, `.windsurf/` | see insights |
| 9.8 | Amp | `src/adapters/amp.ts` | `.amp/AGENTS.md`, `.amp/` | see insights |
| 9.9 | OpenCode | `src/adapters/opencode.ts` | `opencode.json`, `.opencode/` | see insights |
| 9.10 | Aider | `src/adapters/aider.ts` | `CONVENTIONS.md`, `.aider/` | see insights |
| 9.11 | Kiro | `src/adapters/kiro.ts` | `.kiro/steering/`, `.kiro/settings/` | see insights |
| 9.12 | Goose | `src/adapters/goose.ts` | `.goosehints` | see insights |
| 9.13 | Zed | `src/adapters/zed.ts` | `.rules` | see insights |
| 9.14 | Amazon Q | `src/adapters/amazonq.ts` | `.amazonq/` | see insights |
| 9.15 | Antigravity | `src/adapters/antigravity.ts` | `.antigravity/` | see insights |
| 9.16 | **Capability Matrix Verification (SEQUENTIAL)** | `docs/adapter-capability-matrix.md` | Cross-adapter synthesis | n/a |
| 9.17 | **Emerging Platforms (SEQUENTIAL)** | Web research only | New adapter candidates | n/a |

> "see insights" = `governance/audit/execution-insights.json` → `d9_adapter_research_dates.{adapter}`. Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

**Specific source set (D9-targeted):** official platform documentation for each adapter target (URL + access date YYYY-MM-DD), platform changelog diff vs prior audit cycle, vendor release notes <=12 months. Single-source acceptable only when the trust tier is `official-docs` AND the claim is platform-specific.

## Audit Checklists

### 9.1–9.15 Per-Adapter Checklist

Each adapter sub-agent MUST:
1. Read the adapter source code (`src/adapters/{name}.ts`)
2. Read the corresponding test file (`src/__tests__/adapters/{name}.test.ts`)
3. Per-cycle currency research (mandatory): write a `**Last web-research date:** YYYY-MM-DD` line at the top of `.audit-workspace/D9-SA9.{N}.findings.md` citing the platform's official documentation URL, access date, author/org, and trust tier per `governance/audit/templates/rigor-contract.md`. Compare this date against the prior cycle's date recorded in `governance/audit/execution-insights.json` under `d9_adapter_research_dates.{adapter_name}`. If the prior date is within 90 days AND the platform's public changelog has no new entries since that date, the sub-agent MAY cite the prior research and add ≤2 spot-check URLs to confirm no regression. Otherwise full re-research is mandatory. Omitting either the date line or the prior-cycle comparison is itself a Medium finding.
4. Verify against the following checklist:
- [ ] Output file paths match the capability matrix documentation
- [ ] Output format matches what the platform actually expects (current docs, not assumptions)
- [ ] Feature flag behavior: capabilities the adapter doesn't support are correctly skipped
- [ ] Bridge orchestration: adapters that emit bridge files include the full `BRIDGE_ORCHESTRATION` content
- [ ] Model emission: verify model preference rendering (native vs guidance) per platform
- [ ] MCP format: verify MCP config transformation matches platform's expected schema
- [ ] Secret management: verify secret loading method per adapter
- [ ] Hook format: verify hook/event mapping is correct for this platform
- [ ] New platform features: has the platform added capabilities not yet supported by the adapter?
- [ ] User-question tool: verify the platform's current native question/triage tool name and invocation via official documentation. Confirm `ASK_USER_TOOLS[adapter]` in src/pipeline/adapterToolTranslator.ts and the `nativeQuestionTool` flag in src/adapters/index.ts agree (both populated, or both null/false). Cite URL + access date.
- [ ] Test coverage: does the test file adequately cover the adapter's output paths?

### 9.14 Amazon Q — Additional Notes

Standing gap (≥2 cycles): `src/__tests__/adapters/amazonq.test.ts` missing — sub-agent MUST flag until resolved.

### 9.16 Capability Matrix Verification (SEQUENTIAL)

This sub-agent runs after all 15 adapter sub-agents complete:
- [ ] Cross-reference the Implementation Matrix table against all adapter audit findings
- [ ] Purge any Implementation Matrix omission claim contradicted by the filesystem: if `src/adapters/{name}.ts` emits the feature OR the vendor documentation now advertises support, the omission row is a finding (example: windsurf hooks and kiro hooks are emitted by their adapters as of cycle 7.5 and must not appear as omissions)
- [ ] Check for new platform capabilities not yet reflected in the matrix
- [ ] Verify "Canonical Path Matches" are still accurate
- [ ] Maintenance guide verified: every adapter listed, every command documented, every hook mapping shown, against filesystem actuals

### 9.17 Emerging Platforms (SEQUENTIAL)
- [ ] Search for new AI coding tools with significant traction
- [ ] Identify VC-funded tools gaining market share
- [ ] Monitor rising GitHub stars in the AI/coding category
- [ ] Recommend adapter additions with priority ranking and rationale

## Domain Boundary

> D02 audits adapter contracts and abstractions (base.ts, canonical.ts, customization.ts, content system, integrity system): "Are the abstractions correct?" D09 audits per-adapter implementations: "Does each adapter correctly implement the contract for its target platform?" D11 audits end-to-end integration by tracing specific content types through the full pipeline: "When content flows from canonical source through adapter transformation to disk output, does it arrive correctly?" D11 findings must demonstrate cross-component failures that neither D02 nor D09 would catch independently.
