# Domain 11: End-to-End Data Flow

> Last updated: 2026-04-19

**Pillars served:** P4 (primary), P2 (supporting).

**Scope:** The full data flow from canonical source through adapters to tool-specific output.
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 11.1 | Canonical to Adapter to Output Tracing |
| 11.2 | Managed Blocks & Safe Write |
| 11.3 | MCP Propagation & Secrets |
| 11.4 | Customization & CLI Lifecycle |

## Audit Checklists

### 11.1 Canonical to Adapter to Output Tracing
- [ ] Trace every canonical file type (rules, agents, skills, prompts, commands, mcp, hooks, guardrails, learnings) through `readCanonicalFiles()` to `adapter.generate()` to `AdapterOutput[]` to file writes
- [ ] Verify no content is lost or corrupted in transformation
- [ ] Multi-issue parallelism correctness — dependency graph construction and parallel dispatch
- [ ] Adapter-specific content transformation — each adapter's unique formatting applied correctly
- [ ] Split-brain prevention — after partial sync/update failure, is the integrity manifest accurate for which adapters actually succeeded vs. failed? Does the system leave a consistent state?

### 11.2 Managed Blocks & Safe Write
- [ ] Managed blocks (`HATCH3R:BEGIN`/`HATCH3R:END`) merge integrity
- [ ] User content preservation on update — content outside blocks survives
- [ ] Safe write atomicity — writes complete fully or not at all
- [ ] Backup creation before destructive operations
- [ ] Rollback on failure — failed writes restore previous state
- [ ] Concurrent safety — multiple processes do not corrupt files
- [ ] Force mode behavior — correctly overrides when requested

### 11.3 MCP Propagation & Secrets
- [ ] MCP config propagation per adapter format — each adapter receives correctly formatted MCP config
- [ ] `.env.mcp` generation — all MCP server environment variables included
- [ ] `envFile` injection for Copilot — correct path and format
- [ ] `${env:VAR}` patterns — variable substitution works across adapters
- [ ] Secret leakage prevention — no secrets in generated config files or managed blocks

### 11.4 Customization & CLI Lifecycle
- [ ] CLI lifecycle correctness — init, sync, update, status, validate, verify sequence
- [ ] Customization override flow — `.hatch3r/{id}.customize.yaml` correctly applied
- [ ] Deny pattern enforcement — safety-critical content protected
- [ ] Idempotency — repeated operations produce consistent results
- [ ] Hook mapping — 6 hooks correctly mapped to adapter-specific formats

## Domain Boundary

> D02 audits adapter contracts and abstractions (base.ts, canonical.ts, customization.ts, content system, integrity system): "Are the abstractions correct?" D09 audits per-adapter implementations: "Does each adapter correctly implement the contract for its target platform?" D11 audits end-to-end integration by tracing specific content types through the full pipeline: "When content flows from canonical source through adapter transformation to disk output, does it arrive correctly?" D11 findings must demonstrate cross-component failures that neither D02 nor D09 would catch independently.
