# Domain 11: End-to-End Data Flow

> Last updated: 2026-04-19

**Pillars served:** governance-axis P2 (primary); content-quality-axis CQ4 Reliability (primary), CQ6 Scalability (supporting).

**Scope:** The full data flow from canonical source through adapters to tool-specific output.
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 11.1 | Canonical to Adapter to Output Tracing |
| 11.2 | Managed Blocks & Safe Write |
| 11.3 | MCP Propagation & Secrets |
| 11.4 | Customization & CLI Lifecycle |

> Apply the rigor contract per [../templates/rigor-contract.md](../templates/rigor-contract.md) on every finding.

## Severity Discipline Cap

D11 Medium findings are capped at **8 per cycle** absent explicit justification per finding above the cap. Cycle 6 D11 produced 25 Mediums; Cycle 7 triage reduced to 6 by removing items where the impact was below the Medium threshold definition. If the cap is exceeded, the orchestrator MUST tag each Medium beyond #8 with a `cap_exception_rationale` referencing a specific user-impact scenario.

## Audit Checklists

> **Per-finding (Decision 17 / charter directive 18):** every finding declares `impact_horizon: short|medium|long` AND `progress_toward_pillar: <axis>.<pillar_id>+<delta>` (e.g., `governance.P5+0.15` or `content-quality.CQ4+0.20`); orchestrator DROPS at output time if either missing.

### 11.1 Canonical to Adapter to Output Tracing
- [ ] Trace every canonical file type (rules, agents, skills, prompts, commands, mcp, hooks, guardrails, learnings) through `readCanonicalFiles()` to `adapter.generate()` to `AdapterOutput[]` to file writes
- [ ] Verify no content is lost or corrupted in transformation
- [ ] Multi-issue parallelism correctness — dependency graph construction and parallel dispatch
- [ ] Adapter-specific content transformation — each adapter's unique formatting applied correctly
- [ ] Split-brain prevention — after partial sync/update failure, does drift detection report the actual state per adapter (which succeeded vs. failed) and does the system leave a consistent state?

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

> **Domain boundary with D02 + D09 — see [D02 §Domain Boundary](D02-adapter-infrastructure.md#domain-boundary).** D02 carries the canonical text (Anti-Bloat Principle 1 — single source of truth).
