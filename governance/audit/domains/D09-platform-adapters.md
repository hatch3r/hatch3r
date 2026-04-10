# Domain 9: Platform Adapters

**Scope:** All 15 adapters and the capability matrix. One sub-agent per adapter for maximum depth.
**Sub-agents:** 16

Sub-agents 9.15 and 9.16 are **sequential** — they run only after 9.1–9.14 complete.

**Reference:** `docs/adapter-capability-matrix.md`

| SA | Adapter | Source | Output Format |
|----|---------|--------|---------------|
| 9.1 | Cursor | `src/adapters/cursor.ts` | `.cursor/` (.mdc rules, agents, skills, commands, mcp.json, hooks) |
| 9.2 | Copilot | `src/adapters/copilot.ts` | `.github/` (instructions, agents, prompts, mcp) |
| 9.3 | Claude | `src/adapters/claude.ts` | `CLAUDE.md`, `.claude/`, `.mcp.json` |
| 9.4 | Cline | `src/adapters/cline.ts` | `.roo/`, `.roomodes`, `.cline/` |
| 9.5 | Codex | `src/adapters/codex.ts` | `.codex/config.toml`, AGENTS.md bridge |
| 9.6 | Gemini | `src/adapters/gemini.ts` | `GEMINI.md`, `.gemini/` |
| 9.7 | Windsurf | `src/adapters/windsurf.ts` | `.windsurfrules`, `.windsurf/` |
| 9.8 | Amp | `src/adapters/amp.ts` | `.amp/AGENTS.md`, `.amp/` |
| 9.9 | OpenCode | `src/adapters/opencode.ts` | `opencode.json`, `.opencode/` |
| 9.10 | Aider | `src/adapters/aider.ts` | `CONVENTIONS.md`, `.aider/` |
| 9.11 | Kiro | `src/adapters/kiro.ts` | `.kiro/steering/`, `.kiro/settings/` |
| 9.12 | Goose | `src/adapters/goose.ts` | `.goosehints` |
| 9.13 | Zed | `src/adapters/zed.ts` | `.rules` |
| 9.14 | Amazon Q | `src/adapters/amazonq.ts` | `.amazonq/` |
| 9.15 | **Capability Matrix Verification (SEQUENTIAL)** | `docs/adapter-capability-matrix.md` | Cross-adapter synthesis |
| 9.16 | **Emerging Platforms (SEQUENTIAL)** | Web research only | New adapter candidates |

## Audit Checklists

### 9.1–9.14 Per-Adapter Checklist

Each adapter sub-agent MUST:
1. Read the adapter source code (`src/adapters/{name}.ts`)
2. Read the corresponding test file (`src/__tests__/adapters/{name}.test.ts`)
3. Web research the platform's current documentation for config format changes
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
- [ ] Test coverage: does the test file adequately cover the adapter's output paths?

### 9.14 Amazon Q — Additional Notes

**Critical:** No test file exists (`src/__tests__/adapters/amazonq.test.ts` is missing). Sub-agent MUST flag this as a finding. Verify the adapter is registered in `src/adapters/index.ts` and produces correct output format.

### 9.15 Capability Matrix Verification (SEQUENTIAL)

This sub-agent runs after all 14 adapter sub-agents complete:
- [ ] Cross-reference the Implementation Matrix table against all adapter audit findings
- [ ] Verify all "Intentional Omissions" are still valid (platform may have added support)
- [ ] Check for new platform capabilities not yet reflected in the matrix
- [ ] Verify "Canonical Path Matches" are still accurate
- [ ] Ensure maintenance guide is complete and accurate

### 9.16 Emerging Platforms (SEQUENTIAL)
- [ ] Search for new AI coding tools with significant traction
- [ ] Identify VC-funded tools gaining market share
- [ ] Monitor rising GitHub stars in the AI/coding category
- [ ] Recommend adapter additions with priority ranking and rationale

## Domain Boundary

> D02 audits adapter contracts and abstractions (base.ts, canonical.ts, customization.ts, content system, integrity system): "Are the abstractions correct?" D09 audits per-adapter implementations: "Does each adapter correctly implement the contract for its target platform?" D11 audits end-to-end integration by tracing specific content types through the full pipeline: "When content flows from canonical source through adapter transformation to disk output, does it arrive correctly?" D11 findings must demonstrate cross-component failures that neither D02 nor D09 would catch independently.
