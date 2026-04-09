# Domain 15: Agentic Security & Trust Model

**Scope:** The security of the agentic system itself — not the security guidance hatch3r teaches to end-user projects (covered in D5), but whether hatch3r's own architecture is resilient against agentic attack vectors. Includes trust delegation architecture and compliance mapping.

This is a distinct concern from Domain 1 (source code quality) and Domain 4 (production security). hatch3r generates instructions that guide AI agents with broad code-writing capabilities. The trust model of that system requires dedicated scrutiny.

**Sub-agents:** 6

| SA | Focus |
|----|-------|
| 15.1 | Prompt Injection & Instruction Integrity |
| 15.2 | Trust Boundaries Between Agents |
| 15.3 | OWASP Top 10 for Agentic Applications (ASI01-ASI10) |
| 15.4 | Supply Chain of Agent Definitions |
| 15.5 | MCP Trust Model |
| 15.6 | Agentic Trust Framework Compliance |

## Domain Boundary

> D06 audits context engineering quality under normal operation (overflow, isolation, format validation). D15 audits context security under adversarial conditions (poisoning, injection, weaponization of user-controlled files). If a finding involves intentional malicious input, it belongs in D15.

## Part A: Audit Checklists

### 15.1 Prompt Injection & Instruction Integrity
- [ ] **Managed block injection** — Can malicious content injected outside `HATCH3R:BEGIN`/`HATCH3R:END` blocks influence agent behavior in ways that bypass hatch3r's intended instructions?
- [ ] **Customization override abuse** — Can `.hatch3r/{id}.customize.yaml` files override safety-critical agent behaviors (disabling security checks, bypassing the review loop)?
- [ ] **Skill injection** — Can a malicious skill in `/.agents/skills/` escalate privileges, exfiltrate data, or override the orchestration pipeline?
- [ ] **Agent instruction tampering** — If an agent's `.md` file is modified (compromised dependency, malicious PR), what is the blast radius? Are there integrity checks?
- [ ] **Content system as attack vector** — Can tag/preset manipulation cause malicious content to be included in or excluded from initialization?

### 15.2 Trust Boundaries Between Agents
- [ ] **Agent isolation** — Do sub-agents operate within well-defined capability boundaries? Can the implementer bypass the reviewer?
- [ ] **Context propagation safety** — When rules and learnings are propagated to sub-agent prompts, is there filtering to prevent instruction injection?
- [ ] **Review loop integrity** — Can the fixer mark its own output as clean without the reviewer actually re-reviewing? Is the max-3-iteration limit enforceable or just advisory?
- [ ] **Escalation path reliability** — When max review iterations are reached with remaining findings, is user escalation reliable? Can it be suppressed?
- [ ] **Max-iteration enforcement** — Is the review loop iteration limit enforced at the infrastructure level or only by prompt instruction?

### 15.3 OWASP Top 10 for Agentic Applications (Self-Assessment)

Apply every category from the official OWASP Top 10 for Agentic Applications (ASI01-ASI10) to hatch3r's own agentic architecture.

- [ ] **ASI01: Agent Goal Hijack** — Can hatch3r agent objectives be altered through malicious content in project files, user prompts, or poisoned learnings? Can the orchestration pipeline be redirected?
- [ ] **ASI02: Tool Misuse & Exploitation** — Can agents misuse tools they have access to (file writes, git commands, GitHub API, MCP servers) through parameter pollution or tool chain manipulation? Are permissions minimized?
- [ ] **ASI03: Identity & Privilege Abuse** — Do agents inherit the user's full system credentials? Can a sub-agent escalate privileges beyond what its role requires (implementer gaining reviewer-level trust)?
- [ ] **ASI04: Agentic Supply Chain Vulnerabilities** — Are external components (MCP servers, npm dependencies, community packs, model APIs) validated? Could a compromised MCP server poison the pipeline?
- [ ] **ASI05: Unexpected Code Execution (RCE)** — Can agents be tricked into generating or executing malicious code? Does the implementer agent have RCE safeguards when writing code to the user's project?
- [ ] **ASI06: Memory & Context Poisoning** — Can the `/.agents/learnings/` system be poisoned to manipulate future agent behavior? Can corrupted context from one session persist and affect subsequent sessions?
- [ ] **ASI07: Insecure Inter-Agent Communication** — Are handoffs between agents (researcher to implementer, reviewer to fixer) validated? Can a compromised agent inject instructions into the next agent's prompt via its output?
- [ ] **ASI08: Cascading Failures** — If one agent in the pipeline fails (reviewer crashes), does the entire workflow fail gracefully or does it cascade? Are there circuit breakers or fallback behaviors?
- [ ] **ASI09: Human-Agent Trust Exploitation** — Does the framework create false confidence in agent output? Are users warned when agents are uncertain? Is the "0 Critical + 0 Warning" review gate trustworthy or can it be gamed?
- [ ] **ASI10: Rogue Agents** — Can an agent exhibit behavioral drift over long sessions? Can a sub-agent deviate from its defined role (implementer starting to review its own code)? Are there behavioral guardrails beyond prompt instructions?

### 15.4 Supply Chain of Agent Definitions
- [ ] **Update integrity** — When `hatch3r update` pulls new content from npm, is content integrity verified? Could a compromised npm publish inject malicious agent instructions?
- [ ] **Pack system security** — The `hatch3r add [pack]` feature installs community-authored content. What is the trust model for community packs? Is there sandboxing, review, or signing?
- [ ] **Version pinning** — Can users pin to a specific version of agent content to avoid unexpected behavioral changes?
- [ ] **Integrity manifest tamper detection** — Does the integrity system (`src/integrity/`) provide reliable tamper detection for agent definitions?

### 15.5 MCP Trust Model
- [ ] MCP server trust model — how are MCP servers authenticated and authorized?
- [ ] MCP server capability scoping — are MCP server permissions minimized?
- [ ] Malicious MCP server scenarios — what happens if a registered MCP server is compromised?
- [ ] MCP transport security — are connections encrypted and authenticated?
- [ ] MCP tool permission model — can individual MCP tools be allowed/denied?
- [ ] **MCP server version pinning** — are MCP server versions pinned in mcp.json to prevent supply chain attacks via auto-updated servers?
- [ ] **Tool poisoning via MCP** — can a compromised MCP server inject malicious tool descriptions that manipulate agent behavior? (MCP vulnerabilities surged 270% in Q3 2025)

### 15.6 Agentic Trust Framework Compliance
- [ ] Agentic Trust Framework compliance assessment — does hatch3r's trust model align with the emerging framework?
- [ ] Trust delegation — how is trust delegated from user to agent to sub-agent?
- [ ] Trust verification — how is agent behavior verified against expected behavior?
- [ ] Trust revocation — can trust be revoked for misbehaving agents?
- [ ] Verify trust reference section (Part B below) against current implementation in `src/pipeline/`

## Part B: Trust Reference

> Absorbed from standalone trust-delegation-chain.md (finding #84) and
> trust-framework-compliance.md (finding #85) per governance proposal P17.
> Maintained inline so the audit cycle can verify trust architecture alongside
> the security checklists above.

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
| ASI07 Schema Validation | Integrity | phaseOutputSchema.ts | `validate` asi07-* | #83 |
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
