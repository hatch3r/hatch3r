---
id: hatch3r-security-patterns
type: rule
description: Security patterns including input validation, auth enforcement, and AI/agentic security for the project
scope: always
tags: [security]
---
# Security Patterns

## Input Validation

- Validate at the boundary: API routes, form handlers, webhook receivers, CLI parsers. Never trust data that has crossed a trust boundary.
- Use type-safe runtime schemas (zod, valibot, joi) co-located with the handler. Compile-time types alone are insufficient.
- Allowlist over denylist for string inputs (permitted characters, values, formats). Denylists are always incomplete.
- Enforce length limits, numeric range checks, and format validation (email, URL, UUID, ISO dates) on every external field.
- Reject unexpected fields with strict/passthrough-off schemas. Unknown keys are an attack surface.
- File uploads: validate type by magic bytes (not extension), enforce size limits, generate server-side filenames, reject path traversal (`..`, absolute paths, null bytes).

## Output Encoding

- Apply context-aware encoding: HTML entities for markup, URL-encoding for query params, JavaScript escaping for inline scripts, CSS escaping for style contexts.
- Never construct HTML from user input without sanitization (DOMPurify or equivalent server-side library). Treat all user content as untrusted.
- Use parameterized queries / prepared statements for SQL, Firestore filters, and NoSQL queries. Zero tolerance for string concatenation with user input.
- Enable auto-escaping in template engines by default. Disable only per-expression with review.
- Sanitize data before logging. Log output is also an injection vector (log forging, ANSI escape injection).

## Authentication Enforcement

- Auth middleware on every route by default. Public routes require explicit opt-out with code review justification.
- Token validation: pin allowed algorithms (reject `none`), enforce expiry (`exp`), verify audience (`aud`) and issuer (`iss`) claims. Reject tokens failing any check.
- Session security: `HttpOnly`, `Secure`, `SameSite=Strict` (or `Lax` with justification) cookies. Rotate session ID on privilege change (login, role switch).
- Multi-factor authentication for sensitive operations: admin actions, payment, account deletion, API key generation.
- Rate-limit authentication endpoints (login, token refresh, password reset). Lock accounts or add progressive delays after repeated failures.
- Invalidate all sessions on password change. Provide "sign out everywhere" capability.

## Fail-Closed Defaults

- Default deny for authorization. Every permission must be explicitly granted; absence of a rule means deny.
- Error handlers must not leak internal state: no stack traces, query details, file paths, or dependency versions in responses. Return generic error codes.
- Fallback to the most restrictive behavior on config parse failure. Misconfiguration must never widen access.
- Circuit breakers for downstream service failures. Degrade gracefully rather than retrying indefinitely or passing errors upstream.
- Health checks and readiness probes must not expose sensitive configuration or internal topology.
- Disable debug endpoints, verbose logging, and source maps in production builds. Gate behind feature flags if needed in staging.

## CSRF Protection

- Apply synchronizer token pattern or double-submit cookie for all state-mutating requests (POST, PUT, PATCH, DELETE).
- Set `SameSite` cookie attribute as defense-in-depth. It supplements but does not replace CSRF tokens.
- For API-only endpoints (no browser cookies), require a custom header (`X-Requested-With` or equivalent) that browsers will not send cross-origin without CORS preflight.
- Validate `Origin` and `Referer` headers as an additional layer for critical endpoints.

## AI & Agentic Security (OWASP Agentic Top 10)

### ASI01 — Agent Goal Hijack

- Separate system prompts from user input with clear delimiters. Never allow user content to override system instructions.
- Implement input guardrails: scan user messages for injection patterns before LLM processing.
- Enforce instruction hierarchy: system > developer > user. Reject attempts to redefine agent purpose.
- Defend against indirect prompt injection: sanitize and tag content retrieved from external sources (RAG, web, files) before including in context.

#### Detection Heuristics

- Monitor for system prompt leakage in agent outputs: log and alert when responses contain fragments matching known system instruction patterns (regex scan on output text).
- Track instruction-override attempts: flag user messages containing phrases like "ignore previous instructions," "you are now," "new system prompt," or base64-encoded instruction blocks.
- Compare agent behavioral fingerprints across sessions: sudden shifts in response style, tone, or domain focus indicate a hijacked goal. Measure cosine similarity of output embeddings against baseline.

#### Code Pattern Examples

```typescript
// VULNERABLE: User input concatenated directly into system context
const prompt = `${systemInstructions}\n\nUser: ${userMessage}`;
const response = await llm.complete(prompt);

// SECURE: Structured message array with role separation and input scanning
import { scanForInjection } from './guardrails';

const injectionResult = scanForInjection(userMessage);
if (injectionResult.detected) {
  logger.warn('Prompt injection attempt detected', {
    userId, patterns: injectionResult.matchedPatterns,
  });
  throw new AgentSecurityError('INPUT_REJECTED');
}

const response = await llm.chat({
  messages: [
    { role: 'system', content: systemInstructions },
    { role: 'user', content: userMessage },
  ],
  // Enforce instruction hierarchy via API-level system prompt pinning
  systemPromptPinned: true,
});
```

#### Remediation Steps

- Deploy a prompt injection classifier (fine-tuned model or rule-based scanner) as pre-processing middleware on all user-facing agent endpoints. Reject or quarantine flagged inputs before they reach the LLM.
- Implement output validation that checks agent responses against a behavioral policy (expected topic scope, disallowed content categories) before returning to the user.
- Rotate and version system prompts; log the active prompt version with every agent invocation so compromised sessions can be correlated to specific prompt configurations.

### ASI02 — Tool Misuse & Exploitation

- Deny-by-default tool access. Each tool requires explicit grant per agent role.
- Enforce parameter schemas on every tool call. Reject calls with unexpected, missing, or out-of-range arguments.
- Rate-limit tool invocations per agent per time window. Alert on anomalous tool usage patterns.
- Sandbox tool execution: restrict file system access, network egress, and subprocess spawning.

#### Detection Heuristics

- Alert on tool call frequency exceeding baseline: track a rolling window of tool invocations per agent session and fire when count exceeds 3x the p95 historical rate for that tool.
- Monitor for tool argument anomalies: flag tool calls where parameter values fall outside observed distributions (e.g., file paths outside the workspace, URLs to internal services, unusually large payloads).
- Cross-reference tool call sequences against known attack patterns: sequential calls to `list_files` -> `read_file` -> `write_file` on sensitive paths (`.env`, `credentials.json`, SSH keys) indicate reconnaissance-then-exfiltration.

#### Code Pattern Examples

```typescript
// VULNERABLE: No schema validation, no access control on tool calls
async function executeTool(toolName: string, params: unknown) {
  const tool = toolRegistry[toolName];
  return tool.execute(params); // Arbitrary tool, arbitrary params
}

// SECURE: Schema-validated, permission-checked, rate-limited tool execution
import { z } from 'zod';
import { checkToolPermission, rateLimiter } from './agent-security';

async function executeTool(agentContext: AgentContext, toolName: string, params: unknown) {
  // 1. Verify agent has permission for this tool
  if (!checkToolPermission(agentContext.role, toolName)) {
    throw new AgentSecurityError('TOOL_ACCESS_DENIED', { toolName, agentRole: agentContext.role });
  }
  // 2. Rate-limit: max 30 tool calls per minute per agent session
  await rateLimiter.consume(agentContext.sessionId, { points: 1, duration: 60, limit: 30 });
  // 3. Validate params against registered schema
  const tool = toolRegistry[toolName];
  const validatedParams = tool.schema.parse(params); // zod schema throws on invalid
  // 4. Execute in sandbox
  return sandbox.run(() => tool.execute(validatedParams));
}
```

#### Remediation Steps

- Audit the tool registry: enumerate all registered tools and map each to the agent roles that legitimately need access. Remove overly broad grants and implement per-role allowlists.
- Add schema definitions to every tool using zod or JSON Schema. Run a CI check that fails if any registered tool lacks a parameter schema.
- Deploy tool call logging with structured attributes (`tool.name`, `agent.id`, `tool.input_hash`, `tool.output_status`) and create anomaly detection alerts for out-of-pattern usage.

### ASI03 — Identity & Privilege Abuse

- Assign unique agent IDs per invocation. Log all actions with agent identity for non-repudiation.
- Apply least privilege: agents receive scoped credentials, never full user or admin tokens.
- Prevent privilege escalation across agent boundaries. An agent must not request or inherit higher privileges than its caller.
- Audit delegation chains: every permission grant from user → agent → sub-agent must be traceable.

#### Detection Heuristics

- Monitor for credential scope expansion: alert when an agent requests or uses a token with broader permissions than its initially granted scope (compare `token.scope` in auth logs against the agent's registered permission set).
- Track delegation depth: flag chains where delegation exceeds 3 levels (user -> agent -> sub-agent -> sub-sub-agent) as privilege laundering risk. Log full chain with `agent.parent_id` at each level.
- Detect impersonation attempts: alert when an agent's identity claims (`agent.id`, `agent.name`) do not match the cryptographically signed identity in its bearer token or session context.

#### Code Pattern Examples

```typescript
// VULNERABLE: Agent inherits the full user session, no scoping
async function spawnAgent(userSession: Session) {
  const agent = new Agent({
    credentials: userSession.token, // Full user privileges
    permissions: userSession.permissions, // Everything the user can do
  });
  return agent.run(task);
}

// SECURE: Scoped credentials with delegation tracking
import { createScopedToken, validateDelegationDepth } from './agent-auth';

async function spawnAgent(parentContext: AgentContext, task: AgentTask) {
  const agentId = crypto.randomUUID();
  // Scope token to only the permissions this task requires
  const scopedToken = await createScopedToken({
    parentToken: parentContext.token,
    allowedScopes: task.requiredPermissions, // Subset of parent's permissions
    agentId,
    ttl: task.estimatedDuration + BUFFER_MS,
  });
  // Enforce max delegation depth
  validateDelegationDepth(parentContext.delegationChain, { max: 3 });

  const agent = new Agent({
    id: agentId,
    credentials: scopedToken,
    parentId: parentContext.agentId,
    delegationChain: [...parentContext.delegationChain, agentId],
  });
  return agent.run(task);
}
```

#### Remediation Steps

- Implement scoped token minting for agents: every agent receives a short-lived, narrowly scoped credential derived from (but never equal to) its caller's permissions. Revoke agent tokens automatically on task completion.
- Add delegation chain logging to all agent invocations. Store the full chain (`user.id -> agent.id -> sub_agent.id`) as a structured attribute on every span and log entry.
- Conduct a quarterly privilege audit: enumerate all agent roles, their granted permissions, and actual permission usage. Revoke unused permissions and tighten scopes to match observed usage patterns.

### ASI04 — Supply Chain Vulnerabilities

- Pin MCP server and plugin versions. Never auto-install unverified packages (`npx -y` on untrusted sources).
- Verify package integrity (checksums, signatures) before loading tools or plugins.
- Audit third-party prompt templates for injected instructions before use.
- Maintain an allowlist of approved MCP servers and tool sources.

#### Detection Heuristics

- Monitor MCP server connection events: alert when an agent connects to an MCP server not on the approved allowlist or when a server's TLS certificate fingerprint changes unexpectedly.
- Track plugin/tool version drift: compare loaded plugin versions against pinned versions in the lockfile at startup. Log and alert on any mismatch, even patch-level differences.
- Scan third-party prompt templates on ingestion: run injection pattern detection (regex for override phrases, base64 blocks, encoded instructions) against all imported prompt templates before they enter the template registry.

#### Code Pattern Examples

```typescript
// VULNERABLE: Dynamic MCP server loading with no verification
async function connectMcpServer(serverUrl: string) {
  const server = await McpClient.connect(serverUrl); // No allowlist check
  const tools = await server.listTools(); // No integrity verification
  toolRegistry.registerAll(tools);
}

// SECURE: Allowlisted, version-pinned, integrity-verified MCP connection
import { MCP_ALLOWLIST, verifyServerIntegrity } from './supply-chain-policy';

async function connectMcpServer(serverUrl: string, expectedVersion: string) {
  // 1. Check against allowlist
  if (!MCP_ALLOWLIST.has(new URL(serverUrl).hostname)) {
    throw new SupplyChainError('MCP_SERVER_NOT_ALLOWED', { serverUrl });
  }
  const server = await McpClient.connect(serverUrl);
  // 2. Verify server version and integrity
  const serverInfo = await server.getServerInfo();
  if (serverInfo.version !== expectedVersion) {
    throw new SupplyChainError('VERSION_MISMATCH', {
      expected: expectedVersion, actual: serverInfo.version,
    });
  }
  await verifyServerIntegrity(serverInfo.checksum, serverUrl);
  // 3. Register tools with source tracking
  const tools = await server.listTools();
  toolRegistry.registerAll(tools, { source: serverUrl, version: expectedVersion });
}
```

#### Remediation Steps

- Create and maintain a centralized MCP server allowlist in version control. Require PR review for any additions. Block agent connections to servers not on the list at the network level (egress firewall rules or proxy).
- Implement checksum verification for all plugin artifacts. Store expected checksums in a signed manifest file and verify at load time. Fail closed if verification fails.
- Audit all third-party prompt templates quarterly: re-scan for injection patterns, review changelogs for suspicious modifications, and verify template source authenticity.

### ASI05 — Unexpected Code Execution

- Never execute agent-generated code without sandboxing (isolated container, restricted runtime, no network).
- Require human review for generated code that touches file system, network, or credentials.
- Restrict generated code to a safe subset: no `eval`, `exec`, shell commands, or dynamic imports.
- Enforce file system access controls: agents can only read/write within designated workspace directories.

#### Detection Heuristics

- Static-analyze agent-generated code before execution: scan for `eval()`, `Function()`, `child_process.exec`, `import()`, `require()` with dynamic arguments, and `fs` operations outside the workspace root. Block execution if any are detected.
- Monitor sandbox escape indicators: alert on generated code that attempts network connections, accesses environment variables, reads `/proc` or `/etc` paths, or spawns subprocesses. Log the full generated code block for forensic review.
- Track code execution metrics per agent session: flag sessions where generated code execution time exceeds 5x the p95 baseline or where memory allocation grows beyond the sandbox limit, indicating potential resource abuse or crypto-mining attempts.

#### Code Pattern Examples

```typescript
// VULNERABLE: Direct execution of agent-generated code
async function runGeneratedCode(code: string) {
  const result = eval(code); // Arbitrary code execution, no sandbox
  return result;
}

// SECURE: AST-validated, sandboxed execution with resource limits
import { parseScript } from 'meriyah';
import { createSandbox } from './sandbox';
import { FORBIDDEN_PATTERNS } from './code-policy';

async function runGeneratedCode(agentContext: AgentContext, code: string) {
  // 1. Static analysis: parse AST and check for forbidden patterns
  const ast = parseScript(code, { module: false });
  const violations = FORBIDDEN_PATTERNS.check(ast); // eval, exec, dynamic imports, etc.
  if (violations.length > 0) {
    logger.warn('Generated code policy violation', { agentId: agentContext.id, violations });
    throw new CodeExecutionError('POLICY_VIOLATION', { violations });
  }
  // 2. Execute in resource-limited sandbox
  const sandbox = createSandbox({
    workspaceRoot: agentContext.workspaceDir,
    allowNetwork: false,
    maxMemoryMb: 128,
    timeoutMs: 10_000,
    allowedModules: ['path', 'util'], // Explicit allowlist
  });
  return sandbox.execute(code);
}
```

#### Remediation Steps

- Deploy a code policy engine that AST-parses all agent-generated code before execution. Maintain a blocklist of forbidden AST node types (CallExpression on `eval`, `exec`, `spawn`; ImportExpression with non-literal sources). Fail closed on parse errors.
- Enforce sandbox resource limits at the container/runtime level: CPU time cap (10s default), memory cap (128MB), no network access, filesystem restricted to a temporary workspace directory. Kill processes exceeding limits immediately.
- Require human-in-the-loop approval for generated code that accesses the file system, makes network requests, or interacts with credentials. Present the full code diff for review before execution.

### ASI06 — Memory & Context Poisoning

- Validate stored context before reuse. Re-check integrity and relevance of cached agent state on retrieval.
- Set expiry / TTL for all cached agent memory. Stale context is a poisoning vector.
- Tag and isolate RAG-retrieved content from trusted system instructions. Never promote retrieved content to system-level authority.
- Detect tampering: hash or sign stored memory entries, verify on read.

#### Detection Heuristics

- Verify integrity hashes on every memory read: compute HMAC of stored content and compare against the stored signature. Alert and discard entries where the hash does not match — this indicates tampering between write and read.
- Monitor for injection patterns in retrieved context: scan RAG results and cached memory for prompt injection signatures (role override phrases, instruction delimiters, encoded payloads) before including in the agent's context window.
- Track memory staleness metrics: log the age of every cached context entry at retrieval time. Alert when agents consume context entries older than their configured TTL, indicating TTL enforcement bypass or clock skew.

#### Code Pattern Examples

```typescript
// VULNERABLE: Cached context used without validation or integrity check
async function getAgentMemory(agentId: string, key: string): Promise<string> {
  const cached = await memoryStore.get(`${agentId}:${key}`);
  return cached.content; // No integrity check, no TTL check, no sanitization
}

// SECURE: Integrity-verified, TTL-enforced, injection-scanned memory retrieval
import { verifyHmac, scanForInjection } from './memory-security';

async function getAgentMemory(agentId: string, key: string): Promise<string> {
  const entry = await memoryStore.get(`${agentId}:${key}`);
  if (!entry) return '';
  // 1. Check TTL
  if (Date.now() - entry.storedAt > entry.ttlMs) {
    logger.info('Memory entry expired, discarding', { agentId, key, age: Date.now() - entry.storedAt });
    await memoryStore.delete(`${agentId}:${key}`);
    return '';
  }
  // 2. Verify integrity
  if (!verifyHmac(entry.content, entry.hmac, MEMORY_SIGNING_KEY)) {
    logger.error('Memory integrity check failed — possible tampering', { agentId, key });
    await memoryStore.delete(`${agentId}:${key}`);
    throw new MemoryIntegrityError('HMAC_MISMATCH');
  }
  // 3. Scan for injection before returning
  const injectionCheck = scanForInjection(entry.content);
  if (injectionCheck.detected) {
    logger.warn('Injection pattern in stored memory', { agentId, key, patterns: injectionCheck.matchedPatterns });
    return ''; // Discard poisoned content
  }
  return entry.content;
}
```

#### Remediation Steps

- Implement HMAC signing on all memory writes. Use a per-agent signing key derived from a root secret. Verify on every read and hard-fail (discard + alert) on mismatch. Rotate signing keys on a regular schedule.
- Enforce TTL at the storage layer: configure the backing store (Redis, DynamoDB, etc.) with native TTL/expiry so entries are automatically evicted. Do not rely solely on application-level TTL checks.
- Tag all RAG-retrieved and external content with a `source: external` metadata field. Enforce at the prompt construction layer that external-tagged content is placed in a user/context role, never in the system role.

### ASI07 — Insecure Inter-Agent Communication

- Authenticate agent-to-agent messages. Each agent must verify the identity of its communication partner.
- Scope delegation tokens: a sub-agent receives only the permissions needed for its specific task.
- Validate message integrity (signing or HMAC) to prevent tampering in multi-agent workflows.
- Enforce privilege boundaries: a delegated agent cannot escalate beyond the scope granted by its parent.

#### Detection Heuristics

- Log and verify message signatures on every inter-agent message: alert immediately when a message fails HMAC verification. Track signature failure rate per agent pair — a spike indicates a man-in-the-middle or a compromised agent.
- Monitor for unauthorized agent-to-agent connections: maintain a directed graph of allowed communication paths. Alert when an agent sends messages to a peer not in its declared communication topology.
- Detect privilege boundary violations in delegation: compare the permission set in a delegation token against the parent agent's own permission set. Alert if the delegated token contains any permission not present in the parent's scope.

#### Code Pattern Examples

```typescript
// VULNERABLE: No authentication or integrity on inter-agent messages
async function sendToAgent(targetAgentId: string, message: AgentMessage) {
  await messageBus.publish(targetAgentId, JSON.stringify(message));
}

// SECURE: Signed, authenticated, topology-checked inter-agent messaging
import { signMessage, verifyMessage } from './agent-crypto';
import { AGENT_TOPOLOGY } from './agent-topology';

async function sendToAgent(senderContext: AgentContext, targetAgentId: string, message: AgentMessage) {
  // 1. Verify communication is allowed by topology
  if (!AGENT_TOPOLOGY.isAllowed(senderContext.agentId, targetAgentId)) {
    throw new AgentSecurityError('COMMUNICATION_NOT_ALLOWED', {
      sender: senderContext.agentId, target: targetAgentId,
    });
  }
  // 2. Sign message with sender's key
  const signedPayload = signMessage({
    ...message,
    senderId: senderContext.agentId,
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
  }, senderContext.signingKey);

  await messageBus.publish(targetAgentId, signedPayload);
}

async function receiveFromAgent(receiverContext: AgentContext, signedPayload: string) {
  // Verify sender identity and message integrity
  const message = verifyMessage(signedPayload, trustedKeyStore);
  if (!message.verified) {
    throw new AgentSecurityError('MESSAGE_VERIFICATION_FAILED');
  }
  // Check for replay attacks
  if (await nonceStore.exists(message.nonce)) {
    throw new AgentSecurityError('REPLAY_DETECTED');
  }
  await nonceStore.set(message.nonce, { ttl: 300_000 }); // 5-minute nonce window
  return message;
}
```

#### Remediation Steps

- Implement message signing using HMAC-SHA256 or Ed25519 on all inter-agent communication channels. Each agent receives a unique signing key at provisioning. Verify signatures on the receiving end before processing.
- Define and enforce a communication topology: store allowed agent-to-agent edges in a configuration file under version control. Reject messages from agents not in the allowed topology. Review the topology on any agent role change.
- Add replay protection with nonces and timestamp validation: reject messages older than 5 minutes or with previously seen nonces. Use a distributed nonce store (Redis) with automatic TTL expiry.

### ASI08 — Cascading Failures

- Implement circuit breakers between agent stages. A failure in one agent must not propagate unchecked.
- Enforce timeouts on every agent invocation and tool call. No unbounded waits.
- Contain blast radius: isolate agent workflows so a compromised agent cannot affect unrelated workflows.
- Log and alert on error chains. Three consecutive failures in an agent chain should trigger automatic halt.

#### Detection Heuristics

- Track consecutive failure counts per agent chain: increment a counter on each agent/tool failure within a workflow. Alert and halt when 3 consecutive failures occur. Reset the counter on success. Use a distributed counter (Redis `INCR` with TTL) for cross-instance tracking.
- Monitor agent invocation latency percentiles: alert when p99 latency for an agent stage exceeds 2x the historical baseline, indicating a downstream bottleneck or retry storm that will cascade upstream.
- Detect retry amplification: log retry counts per stage. Alert when total retries across a workflow exceed the configured retry budget (e.g., sum of retries > 10 across all stages). Retry storms are the primary cascade amplifier.

#### Code Pattern Examples

```typescript
// VULNERABLE: No circuit breaker, no timeout, unbounded retries
async function runAgentChain(tasks: AgentTask[]) {
  const results = [];
  for (const task of tasks) {
    const result = await runAgent(task); // No timeout, no failure isolation
    results.push(result);
  }
  return results;
}

// SECURE: Circuit-broken, timeout-enforced, failure-isolated agent chain
import { CircuitBreaker, CircuitState } from './circuit-breaker';

const agentBreakers = new Map<string, CircuitBreaker>();

async function runAgentChain(tasks: AgentTask[]) {
  const results = [];
  let consecutiveFailures = 0;

  for (const task of tasks) {
    // Get or create circuit breaker for this agent stage
    const breaker = agentBreakers.get(task.agentName) ??
      new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
    agentBreakers.set(task.agentName, breaker);

    if (breaker.state === CircuitState.OPEN) {
      logger.warn('Circuit open, skipping agent stage', { agent: task.agentName });
      throw new CascadeHaltError('CIRCUIT_OPEN', { agent: task.agentName });
    }
    try {
      const result = await Promise.race([
        runAgent(task),
        rejectAfterTimeout(task.timeoutMs ?? 30_000),
      ]);
      breaker.recordSuccess();
      consecutiveFailures = 0;
      results.push(result);
    } catch (err) {
      breaker.recordFailure();
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        logger.error('Cascade halt: 3 consecutive failures', { chain: tasks.map(t => t.agentName) });
        throw new CascadeHaltError('CONSECUTIVE_FAILURE_LIMIT');
      }
      throw err;
    }
  }
  return results;
}
```

#### Remediation Steps

- Deploy circuit breakers at every agent-to-agent and agent-to-tool boundary. Configure failure threshold (3 failures), open duration (30 seconds), and half-open probe count (1). Use a shared circuit state store for multi-instance deployments.
- Enforce hard timeouts on every agent invocation and tool call using `Promise.race` or `AbortController`. Default timeout: 30 seconds for tool calls, 120 seconds for agent invocations. Make timeouts configurable per tool/agent.
- Implement workflow-level failure budgets: define a maximum total failure count per workflow execution (e.g., 5 across all stages). Halt the entire workflow when the budget is exhausted and emit a structured alert with the full failure chain.

### ASI09 — Human-Agent Trust Exploitation

- Mandatory human confirmation for destructive operations: file deletion, database writes, external API calls with side effects, financial transactions.
- Enforce cost limits: cap token usage, API call counts, and compute time per agent invocation.
- Present agent actions transparently: show the user what the agent did and why, not just the result.
- Resist social engineering: agents must not bypass confirmation flows based on urgency framing in user input.

#### Detection Heuristics

- Monitor confirmation bypass attempts: log all human confirmation requests and their outcomes. Alert when an agent's output contains urgency language ("immediately," "critical," "do this now or data will be lost") immediately before a confirmation prompt — this pattern indicates social engineering of the human approver.
- Track cost accumulation in real-time: emit metrics for `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` per agent session. Alert when cumulative cost exceeds 80% of the configured budget before the task is complete. Kill the agent at 100%.
- Audit confirmation-to-action latency: flag cases where human confirmation is received in under 2 seconds for destructive operations, suggesting automated rubber-stamping or a compromised approval flow.

#### Code Pattern Examples

```typescript
// VULNERABLE: Destructive operation without confirmation or cost limits
async function agentDeleteFiles(agent: Agent, paths: string[]) {
  for (const path of paths) {
    await fs.unlink(path); // No confirmation, no cost tracking
  }
  return { deleted: paths.length };
}

// SECURE: Confirmation-gated, cost-limited, transparent destructive operation
import { requestHumanConfirmation, CostTracker } from './agent-safety';

async function agentDeleteFiles(agentContext: AgentContext, paths: string[]) {
  // 1. Check cost budget before proceeding
  const costTracker = new CostTracker(agentContext.sessionId, agentContext.costLimits);
  if (costTracker.isExhausted()) {
    throw new CostLimitError('BUDGET_EXHAUSTED', { spent: costTracker.totalSpent });
  }
  // 2. Present full action plan and request confirmation
  const confirmation = await requestHumanConfirmation({
    agentId: agentContext.id,
    action: 'DELETE_FILES',
    details: {
      files: paths,
      reason: agentContext.currentTaskReason,
      reversible: false,
    },
    // Resist social engineering: strip urgency framing from agent rationale
    sanitizeRationale: true,
    minimumReviewTimeMs: 5_000, // Enforce minimum review time
  });
  if (!confirmation.approved) {
    logger.info('Human rejected destructive operation', { agentId: agentContext.id, action: 'DELETE_FILES' });
    return { deleted: 0, status: 'rejected_by_human' };
  }
  // 3. Execute with full audit trail
  for (const path of paths) {
    await fs.unlink(path);
    logger.info('Agent deleted file', { agentId: agentContext.id, path, approvedBy: confirmation.userId });
  }
  return { deleted: paths.length };
}
```

#### Remediation Steps

- Implement a confirmation gateway service: all destructive operations route through a centralized confirmation API that enforces minimum review times (5 seconds), logs approver identity, and prevents automated bypass.
- Deploy real-time cost tracking per agent session: track token usage, tool call counts, and compute time against per-session budgets. Terminate agents that reach 100% of their budget. Emit budget utilization metrics for dashboard monitoring.
- Add urgency-framing detection to agent outputs: before presenting confirmation prompts to users, scan the agent's rationale for social engineering patterns and either strip them or flag the prompt with a warning banner.

### ASI10 — Rogue Agents

- Monitor agent outputs for policy violations, off-topic responses, and anomalous behavior patterns.
- Validate agent outputs against expected schemas and content policies before acting on them.
- Enforce scope: reject agent actions outside the declared task boundary.
- Implement kill switches: ability to immediately terminate a running agent and revoke its credentials.
- Run anomaly detection on tool call patterns, output length, and execution time to flag compromised agents.

#### Detection Heuristics

- Build behavioral baselines per agent role: track distributions of output length, tool call count, tool call diversity (unique tools used), and execution time per session. Flag sessions exceeding 2 standard deviations from the baseline on any dimension.
- Run output policy classifiers on every agent response: check for disallowed content categories (PII leakage, credential exposure, off-topic output, harmful content) using a lightweight classifier before the response reaches the user or downstream system.
- Monitor for scope creep in tool usage: compare the set of tools invoked in a session against the declared tool allowlist for the agent's role. Alert on any tool invocation not in the allowlist, even if the tool call is otherwise well-formed.

#### Code Pattern Examples

```typescript
// VULNERABLE: Agent output returned directly without validation or anomaly check
async function getAgentResponse(agent: Agent, task: AgentTask): Promise<AgentOutput> {
  const output = await agent.run(task);
  return output; // No schema validation, no policy check, no anomaly detection
}

// SECURE: Schema-validated, policy-checked, anomaly-monitored agent output
import { outputPolicyClassifier, anomalyDetector } from './agent-monitoring';
import { AgentOutputSchema } from './schemas';

async function getAgentResponse(agentContext: AgentContext, task: AgentTask): Promise<AgentOutput> {
  const output = await agent.run(task);
  // 1. Validate output schema
  const parsed = AgentOutputSchema.safeParse(output);
  if (!parsed.success) {
    logger.error('Agent output schema violation', { agentId: agentContext.id, errors: parsed.error.issues });
    await killSwitch.terminate(agentContext.id, 'SCHEMA_VIOLATION');
    throw new RogueAgentError('OUTPUT_SCHEMA_INVALID');
  }
  // 2. Policy classification
  const policyResult = await outputPolicyClassifier.check(parsed.data.content);
  if (policyResult.violations.length > 0) {
    logger.error('Agent policy violation', { agentId: agentContext.id, violations: policyResult.violations });
    await killSwitch.terminate(agentContext.id, 'POLICY_VIOLATION');
    throw new RogueAgentError('POLICY_VIOLATION', { violations: policyResult.violations });
  }
  // 3. Anomaly detection
  const anomalyScore = anomalyDetector.score(agentContext.id, {
    outputLength: parsed.data.content.length,
    toolCallCount: agentContext.metrics.toolCallCount,
    executionTimeMs: agentContext.metrics.executionTimeMs,
    uniqueToolsUsed: agentContext.metrics.uniqueToolsUsed,
  });
  if (anomalyScore > ANOMALY_THRESHOLD) {
    logger.warn('Anomalous agent behavior', { agentId: agentContext.id, anomalyScore });
    await killSwitch.terminate(agentContext.id, 'ANOMALY_DETECTED');
    throw new RogueAgentError('ANOMALY_DETECTED');
  }
  return parsed.data;
}
```

#### Remediation Steps

- Deploy a kill switch service that can immediately terminate any running agent, revoke its credentials, and invalidate its session. The kill switch must be invocable via API, CLI, and automated policy triggers. Test kill switch latency monthly (target: < 1 second from trigger to termination).
- Implement output validation as a mandatory pipeline stage: every agent output passes through schema validation (zod) and content policy classification before reaching the user or downstream system. Rejected outputs are logged with full context for incident review.
- Build and maintain per-role behavioral baselines using historical agent telemetry. Update baselines weekly. Use statistical anomaly detection (z-score or isolation forest) on output length, tool call patterns, and execution time. Tune the anomaly threshold to achieve < 1% false positive rate.

## OWASP Top 10 2025 (Web Application Security)

### A01 — Broken Access Control

- Enforce access control server-side. Client-side checks are UX, not security.
- Deny by default: every resource requires explicit permission. Absence of a grant means deny.
- Implement resource-level ownership checks: verify the authenticated user owns (or has a role granting access to) the requested resource. Parameterized IDs in URLs are not authorization — always validate ownership.
- Disable directory listing. Restrict access to metadata files (`.git`, `.env`, backup files).
- Rate-limit API access to minimize automated IDOR scanning and credential stuffing.
- Log access control failures and alert on repeated violations from the same identity.

### A02 — Cryptographic Failures

- Classify data by sensitivity (PII, financial, health, credentials). Apply encryption requirements per classification.
- Encrypt data in transit (TLS 1.2+ mandatory, prefer 1.3) and at rest (AES-256 or equivalent).
- Never use deprecated algorithms: MD5, SHA-1, DES, RC4, ECB mode. Use SHA-256+ for hashing, AES-GCM for symmetric encryption, RSA-OAEP or ECDSA for asymmetric.
- Hash passwords with bcrypt, scrypt, or Argon2id with appropriate work factors. Never use raw SHA/MD5 for passwords.
- Generate cryptographic keys with secure random sources (`crypto.randomBytes`, not `Math.random`). Never hard-code keys or IVs.
- Disable caching for responses containing sensitive data (`Cache-Control: no-store`).

### A03 — Injection

- Use parameterized queries or prepared statements for all database operations. Zero tolerance for string concatenation with user input in queries.
- Apply context-aware output encoding: HTML entities, URL encoding, JavaScript escaping, CSS escaping, LDAP escaping — matched to the output context.
- Validate and sanitize all external input with allowlist validation. Limit input length, character sets, and format.
- Use `LIMIT` and pagination in queries to prevent mass data disclosure via injection.
- For OS command execution: avoid entirely if possible. If necessary, use parameterized APIs (not shell interpolation) with strict input validation.

### A04 — Insecure Design

- Use threat modeling during design phase (STRIDE, attack trees, or equivalent). Identify trust boundaries and abuse cases before writing code.
- Establish and enforce secure design patterns: separation of concerns, defense in depth, least privilege, fail-closed.
- Write abuse-case user stories alongside feature user stories: "As an attacker, I want to..."
- Design rate limiting, resource quotas, and cost controls into the architecture — not as afterthoughts.
- Establish secure development lifecycle (SDL) practices: security requirements, design review, code review, testing.

### A05 — Security Misconfiguration

- Harden all environments: remove default accounts, disable unused features/ports/services, remove sample applications.
- Use identical security configuration across development, staging, and production. Differences in security settings between environments mask vulnerabilities.
- Automate configuration verification: infrastructure-as-code with security baselines, configuration scanning in CI.
- Send security headers on every response (HSTS, CSP, X-Content-Type-Options, X-Frame-Options). Centralize in middleware.
- Review cloud permissions quarterly. Remove unused IAM roles, security groups, and service accounts.
- Disable detailed error messages in production. Use generic error responses with correlation IDs for debugging.

### A06 — Vulnerable and Outdated Components

- Maintain a software bill of materials (SBOM) for all direct and transitive dependencies.
- Run `npm audit` (or equivalent) in CI on every build. Block merges with critical or high vulnerabilities.
- Subscribe to security advisories for all critical dependencies using the platform's built-in tools or third-party equivalents:
  - **GitHub:** Dependabot alerts and security advisories
  - **Azure DevOps:** Microsoft Defender for DevOps or WhiteSource/Mend integration
  - **GitLab:** GitLab Dependency Scanning CI template, or Snyk integration
- Remove unused dependencies. Unused code with known vulnerabilities is still a risk.
- Pin dependency versions in lockfiles. Review lockfile changes in PRs with the same scrutiny as code changes.
- Establish SLAs for vulnerability remediation: critical within 24 hours, high within 1 week, moderate within 1 sprint.

### A07 — Identification and Authentication Failures

- Implement multi-factor authentication for privileged accounts and sensitive operations.
- Enforce password complexity requirements: minimum 8 characters, check against breached password databases (Have I Been Pwned API).
- Protect against credential stuffing: rate-limit login attempts, implement progressive delays, use CAPTCHA after repeated failures.
- Session management: generate new session ID on login, invalidate on logout, set absolute and idle timeouts.
- Never expose session IDs in URLs. Use secure, HttpOnly, SameSite cookies.
- Implement account lockout with notification after repeated failed attempts.

### A08 — Software and Data Integrity Failures

- Verify integrity of all software updates, dependencies, and CI/CD pipeline artifacts using digital signatures or checksums.
- Use lockfiles and verify their integrity. `npm ci` (not `npm install`) in CI to ensure deterministic builds.
- CI/CD pipelines: require code review for all changes, enforce branch protection, sign commits where feasible.
- Never deserialize untrusted data without validation. Use schemas (zod, JSON Schema) to validate structure before processing.
- Protect CI/CD secrets and permissions: restrict who can modify pipeline configuration, require approval for deployment steps.
- Pin CI actions/tasks by commit SHA or exact version, not mutable tags:
  - **GitHub Actions:** Pin by commit SHA (e.g., `actions/checkout@abc123`)
  - **Azure DevOps:** Pin pipeline tasks by exact version (e.g., `task@2`)
  - **GitLab CI:** Pin included templates by SHA or tag reference

### A09 — Security Logging and Monitoring Failures

- Log all authentication events (success, failure, lockout), access control failures, input validation failures, and security-relevant business events.
- Use structured logging with correlation IDs. Include: timestamp, severity, event type, user identity (if available), source IP, resource accessed, outcome.
- Never log sensitive data: passwords, tokens, PII, credit card numbers, session IDs. Redact before logging.
- Centralize logs and enable real-time alerting for security events. Alert on: brute-force patterns, privilege escalation, anomalous access patterns.
- Retain security logs for the compliance-required period (minimum 90 days, typically 1 year).
- Test that logging works: include security event logging in integration tests. Verify alerts fire during incident response drills.

### A10 — Mishandling of Exceptional Conditions

- Catch and handle every possible error at the point of occurrence. Uncaught exceptions are a vulnerability — they can crash services, leak state, or bypass security checks.
- Fail closed, not open. When an error occurs in an authorization check, deny access. When a transaction fails mid-way, roll back completely. Never leave the system in a partially-completed state.
- Implement global exception handlers as a safety net. All unhandled exceptions must be logged, reported, and result in a safe error response (no stack traces, no internal details).
- Handle missing and malformed parameters explicitly. Do not rely on language defaults (undefined, null, zero) for security-sensitive logic.
- Check return values and error codes from all system calls, library functions, and external API responses. Ignored return values are a common source of silent failures.
- Add observability for error patterns: monitor error rates by category, alert on sudden spikes, and investigate recurring error types as potential attack probes.
- Roll back incomplete transactions atomically. Partial writes, partial state changes, and orphaned resources are integrity violations.
