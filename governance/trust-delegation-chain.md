# Trust Delegation Chain

Finding #85 (D15, High): Document trust delegation chain.

## Overview

This document describes how trust flows through the hatch3r pipeline — from the
human user who initiates work, through the orchestrator, to individual agents,
and down to the tools those agents invoke.

Each link in the chain grants a subset of the upstream entity's trust, following
the principle of **monotonically decreasing privilege**.

## Chain Diagram

```
User (full trust)
  |
  |-- delegates to -->  Pipeline Orchestrator (scoped trust)
  |                       |
  |                       |-- delegates to -->  Agent (role-scoped trust)
  |                       |                       |
  |                       |                       |-- invokes -->  Tool (capability-scoped trust)
  |                       |                       |
  |                       |                       |-- invokes -->  MCP Server (service-scoped trust)
  |                       |
  |                       |-- validates -->  Phase Boundary (schema check)
  |                       |
  |                       |-- enforces -->  Timeout (resource limit)
  |
  |-- reviews -->  Pipeline Output (verified trust)
```

## Trust Levels

### Level 0: User

- **Trust**: Full — the user owns the repository, credentials, and final decisions
- **Grants**: Pipeline execution authority, credential access, approval
- **Retains**: Ability to cancel, override, or reject any agent output
- **Verification**: User reviews pipeline outputs before merge/deploy

### Level 1: Pipeline Orchestrator

- **Trust**: Scoped to the current task (issue, epic, or batch)
- **Receives from User**: Task scope, credential references, configuration
- **Grants to Agents**: Phase-specific execution authority with tool allowlists
- **Controls**:
  - Pipeline timeout (max total execution time)
  - Phase timeout (max per-phase execution time)
  - Review loop iteration limit
  - Agent selection based on task type and context
- **Does NOT have**: Direct credential access (credentials are injected via env)

### Level 2: Agent

- **Trust**: Role-scoped — each agent can only perform actions within its role
- **Receives from Orchestrator**: Task context, tool allowlist, time budget
- **Grants to Tools**: Individual tool invocations within the allowlist
- **Controls**:
  - Tool selection within allowlist (ASI02)
  - Output quality within its domain
- **Does NOT have**:
  - Access to tools outside its allowlist
  - Ability to invoke other agents directly
  - Git operations (reserved for orchestrator)
  - Board/project management operations (reserved for orchestrator)
- **Identity**: Every output is annotated with agent identity metadata (ASI03)

### Level 3: Tool

- **Trust**: Capability-scoped — tools perform single, well-defined operations
- **Receives from Agent**: Specific invocation parameters
- **Controls**: Execution of one operation (read, write, search, execute)
- **Does NOT have**:
  - Autonomous decision-making
  - Ability to invoke other tools
  - Persistent state between invocations

### Level 3 (alternate): MCP Server

- **Trust**: Service-scoped — MCP servers access one external service
- **Receives from Agent**: API call parameters
- **Controls**: API interaction with the external service
- **Constraints**:
  - Credential scope limits operations (e.g., read-only PAT)
  - Blast radius documented per server (see `docs/mcp-server-blast-radius.md`)
  - Secret detection prevents credential leakage (Finding #82)

## Trust Boundaries

### Boundary 1: User to Orchestrator

- **Mechanism**: Explicit invocation (`hatch3r` CLI command)
- **Scope Control**: Task definition (issue number, type, configuration)
- **Credential Handling**: Credentials in `.env.mcp` (gitignored), injected as env vars
- **Revocation**: User can cancel at any time

### Boundary 2: Orchestrator to Agent

- **Mechanism**: Phase-based invocation with structured context
- **Scope Control**: Tool allowlist (ASI02), time budget, phase context
- **Input Validation**: Prompt injection sanitization (ASI01)
- **Output Validation**: Schema validation at phase boundary (ASI07)
- **Identity Tracking**: Agent identity metadata on outputs (ASI03)

### Boundary 3: Agent to Tool/MCP

- **Mechanism**: Tool invocation within allowlist
- **Scope Control**: Tool category must be in agent's allowlist
- **Deny-by-Default**: Unknown agents or tools are rejected
- **Audit**: Tool invocations are logged with agent identity

## Invariants

The following invariants must hold at all times:

1. **No privilege escalation**: An agent cannot grant more trust than it received.
   Tools cannot invoke other tools or agents.

2. **Deny-by-default**: Unknown agents have no tool access. Unknown tools are
   rejected. New agents must be explicitly registered with a tool policy.

3. **Bounded execution**: Every pipeline has a maximum timeout. Every phase has
   a maximum timeout. Every review loop has a maximum iteration count.

4. **Verifiable provenance**: Every pipeline output includes metadata identifying
   which agent produced it, when, and with what capabilities.

5. **Schema-validated handoffs**: Data flowing between phases is validated against
   the expected schema before the next phase begins.

6. **Secret containment**: Credentials are never included in agent prompts,
   pipeline context, or output metadata. They are injected as environment
   variables and accessed only by MCP servers.

## Failure Modes

| Failure                        | Containment                                      |
|-------------------------------|--------------------------------------------------|
| Agent exceeds time budget     | Phase timeout terminates the agent gracefully     |
| Agent attempts unauthorized tool | Allowlist check rejects with logged violation  |
| Phase output schema invalid   | Schema validation blocks handoff to next phase    |
| Review loop does not converge | Hard max iterations terminates the loop           |
| Pipeline exceeds total timeout| Graceful termination with progress report         |
| Secret in env configuration   | `hatch3r validate` detects and reports the secret |
| Prompt injection attempt      | Input sanitization strips dangerous patterns      |
| Diff hash mismatch            | Fixer output is rejected; reviewer re-runs        |
