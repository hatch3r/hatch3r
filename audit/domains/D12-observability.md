# Domain 12: Agent Observability & Debuggability

**Scope:** Can users understand, trace, and debug what agents do?
**Sub-agents:** 4

| SA | Focus |
|----|-------|
| 12.1 | Decision Logging |
| 12.2 | Tool Call Audit Trails |
| 12.3 | Pipeline Traceability |
| 12.4 | OpenTelemetry AI Agent Alignment |

## Audit Checklists

### 12.1 Decision Logging
- [ ] Can users see what decisions each agent made?
- [ ] Is there structured logging of agent reasoning?
- [ ] Are decision points documented in agent output?
- [ ] Are decision logs machine-parseable for post-hoc analysis?

### 12.2 Tool Call Audit Trails
- [ ] Are tool calls (file reads, writes, web searches, MCP calls) logged with inputs and outputs?
- [ ] Can users replay a tool call sequence?
- [ ] Are tool call costs tracked and attributed to specific agents?
- [ ] Is there a tool call budget or rate limiting mechanism?

### 12.3 Pipeline Traceability
- [ ] Can users trace the full pipeline execution (research, implement, review, final quality)?
- [ ] Are there trace IDs or correlation IDs linking related operations?
- [ ] Can users see time spent per phase?
- [ ] Are inter-phase handoffs visible in trace output?

### 12.4 OpenTelemetry AI Agent Alignment
- [ ] Alignment with OpenTelemetry AI agent semantic conventions
- [ ] Does hatch3r's observability guidance (rules, agents) align with the emerging standard?
- [ ] Reasoning trace capability — can the system explain why an agent made a specific choice?
- [ ] Replay/simulation support — can a pipeline execution be replayed with different inputs?
- [ ] EU AI Act traceability requirements — does the framework support the level of traceability regulators expect?
