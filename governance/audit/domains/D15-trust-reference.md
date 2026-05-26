# D15 Trust Reference

> Last updated: 2026-04-20

**Pillars served:** governance-axis P6 (primary); content-quality-axis CQ3 Security (supporting).

> Companion to `D15-agentic-security.md`. Absorbed from standalone trust-delegation-chain.md (finding #84) and trust-framework-compliance.md (finding #85) per governance proposal P17; extracted from D15 Part B to a governed appendix per EVOLVE proposal P2 (2026-04-19).

### Trust Delegation Chain

```
User (L0)
  |
  |-- grants task scope, credentials, approval
  v
Pipeline Orchestrator (L1)
  |
  |-- grants phase authority, tool allowlists
  v
Agent (L2)
  |
  +-- grants specific operation execution --> Tool (L3a)
  |
  +-- grants defined MCP capabilities -----> MCP Server (L3b)
```

#### Trust Levels

| Level | Entity | Trust Scope | Grants | Retains |
|-------|--------|-------------|--------|---------|
| 0 | User | Full | Pipeline execution, credentials, approval | Cancel, override, reject |
| 1 | Pipeline Orchestrator | Current task | Phase authority, tool allowlists | Timeouts, phase gates |
| 2 | Agent | Role-scoped | Tool invocation within allowlist | Phase boundary enforcement |
| 3a | Tool | Capability-scoped | Specific operation execution | Input/output validation |
| 3b | MCP Server | Service-scoped | Defined MCP capabilities | Transport security, rate limits |

#### Trust Boundaries

| Boundary | Between | Controls |
|----------|---------|----------|
| B1 | User → Orchestrator | Task scope, credential refs, explicit config |
| B2 | Orchestrator → Agent | Tool allowlists, phase timeouts, schema validation |
| B3 | Agent → Tool/MCP | Capability scoping, deny-by-default, input validation |

#### Invariants

1. **Monotonically decreasing privilege** — each delegation grants a subset of upstream trust
2. **Deny-by-default** — unknown agents/tools rejected without explicit allowlist entry
3. **Bounded execution** — timeouts at pipeline and phase levels prevent runaway agents
4. **Verifiable provenance** — metadata on all outputs identifies agent, timestamp, capabilities
5. **Secret containment** — credentials never in prompts, only via environment variables
6. **Schema validation** — data validated at every phase boundary

#### Failure Modes

| Failure | Impact | Containment |
|---------|--------|-------------|
| Agent timeout | Phase stalls | Pipeline timeout kills; partial output preserved |
| Tool rejection | Single operation fails | Agent retries with alternative or escalates |
| MCP server unreachable | External data unavailable | Graceful degradation with user notification |
| Schema validation failure | Bad data at boundary | Phase rejects; previous valid state preserved |
| Credential leak attempt | Security breach | Prompt guard blocks; finding auto-generated |

### Trust Framework Compliance

Maps each implemented security control to one or more trust dimensions,
with validation commands and the originating audit finding.

#### Trust Dimensions

| Dimension | Description |
|-----------|-------------|
| Accountability | Actions traceable to specific agents with audit trails |
| Transparency | Agent capabilities, limitations, and decisions visible |
| Containment | Agent impact bounded by enforced limits and allowlists |
| Integrity | Data between agents validated and tamper-evident |
| Confidentiality | Secrets and sensitive data protected from leakage |
| Resilience | Graceful degradation under failure or adversarial input |

#### Control-to-Trust Mapping

Each row links a security control to the trust dimensions it serves,
the source file that implements it, the validation command, and the
originating audit finding number.

| Control | Trust Dimensions | Implementation | Validation | Finding |
|---------|-----------------|----------------|------------|---------|
| ASI01 Prompt Injection | Integrity, Resilience | promptGuard.ts | `validate` asi01-* | #78 |
| ASI02 Tool Allowlists | Containment, Transparency | agentToolAllowlist.ts | `validate` asi02-* | #79 |
| ASI03 Agent Identity | Accountability, Transparency | agentIdentity.ts | `validate` asi03-* | #80 |
| ASI07 Output Compaction | Integrity | phaseOutputSchema.ts (compactPhaseOutput) | `validate` asi07-* | #83 |
| Review Loop Limits | Containment | Pipeline max 3 iterations | Manual audit | #81 |
| Diff-Hash Verification | Integrity | diffHashVerify.ts | `validate` integrity | #82 |
| Pipeline/Phase Timeouts | Resilience | pipelineTimeout.ts | `validate` timeouts | #84 |
| Secret Detection | Confidentiality | secretDetect.ts | `validate` secrets | #85 |
| MCP Blast Radius | Containment, Transparency | docs/mcp-server-blast-radius.md | Manual audit | #86 |
| Compliance Verification | All | `hatch3r validate` | Automated per-commit | -- |

#### Compliance Verification Schedule

Defines how often each layer of the trust model is verified and by what
method.

| Frequency | Method | Scope |
|-----------|--------|-------|
| Per-commit | `hatch3r validate` (automated) | ASI01-03, ASI07, integrity, timeouts, secrets |
| Weekly | Audit cycle (D15 sub-agents) | Full trust model review |
| Quarterly | Manual review | Trust delegation chain architecture |
| Per-release | Update cycle | Control mapping against latest ASI standards |
