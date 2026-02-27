---
description: Security patterns including input validation, auth enforcement, and AI/agentic security for the project
alwaysApply: true
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

### ASI02 — Tool Misuse & Exploitation

- Deny-by-default tool access. Each tool requires explicit grant per agent role.
- Enforce parameter schemas on every tool call. Reject calls with unexpected, missing, or out-of-range arguments.
- Rate-limit tool invocations per agent per time window. Alert on anomalous tool usage patterns.
- Sandbox tool execution: restrict file system access, network egress, and subprocess spawning.

### ASI03 — Identity & Privilege Abuse

- Assign unique agent IDs per invocation. Log all actions with agent identity for non-repudiation.
- Apply least privilege: agents receive scoped credentials, never full user or admin tokens.
- Prevent privilege escalation across agent boundaries. An agent must not request or inherit higher privileges than its caller.
- Audit delegation chains: every permission grant from user → agent → sub-agent must be traceable.

### ASI04 — Supply Chain Vulnerabilities

- Pin MCP server and plugin versions. Never auto-install unverified packages (`npx -y` on untrusted sources).
- Verify package integrity (checksums, signatures) before loading tools or plugins.
- Audit third-party prompt templates for injected instructions before use.
- Maintain an allowlist of approved MCP servers and tool sources.

### ASI05 — Unexpected Code Execution

- Never execute agent-generated code without sandboxing (isolated container, restricted runtime, no network).
- Require human review for generated code that touches file system, network, or credentials.
- Restrict generated code to a safe subset: no `eval`, `exec`, shell commands, or dynamic imports.
- Enforce file system access controls: agents can only read/write within designated workspace directories.

### ASI06 — Memory & Context Poisoning

- Validate stored context before reuse. Re-check integrity and relevance of cached agent state on retrieval.
- Set expiry / TTL for all cached agent memory. Stale context is a poisoning vector.
- Tag and isolate RAG-retrieved content from trusted system instructions. Never promote retrieved content to system-level authority.
- Detect tampering: hash or sign stored memory entries, verify on read.

### ASI07 — Insecure Inter-Agent Communication

- Authenticate agent-to-agent messages. Each agent must verify the identity of its communication partner.
- Scope delegation tokens: a sub-agent receives only the permissions needed for its specific task.
- Validate message integrity (signing or HMAC) to prevent tampering in multi-agent workflows.
- Enforce privilege boundaries: a delegated agent cannot escalate beyond the scope granted by its parent.

### ASI08 — Cascading Failures

- Implement circuit breakers between agent stages. A failure in one agent must not propagate unchecked.
- Enforce timeouts on every agent invocation and tool call. No unbounded waits.
- Contain blast radius: isolate agent workflows so a compromised agent cannot affect unrelated workflows.
- Log and alert on error chains. Three consecutive failures in an agent chain should trigger automatic halt.

### ASI09 — Human-Agent Trust Exploitation

- Mandatory human confirmation for destructive operations: file deletion, database writes, external API calls with side effects, financial transactions.
- Enforce cost limits: cap token usage, API call counts, and compute time per agent invocation.
- Present agent actions transparently: show the user what the agent did and why, not just the result.
- Resist social engineering: agents must not bypass confirmation flows based on urgency framing in user input.

### ASI10 — Rogue Agents

- Monitor agent outputs for policy violations, off-topic responses, and anomalous behavior patterns.
- Validate agent outputs against expected schemas and content policies before acting on them.
- Enforce scope: reject agent actions outside the declared task boundary.
- Implement kill switches: ability to immediately terminate a running agent and revoke its credentials.
- Run anomaly detection on tool call patterns, output length, and execution time to flag compromised agents.

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
- Subscribe to security advisories for all critical dependencies (GitHub Dependabot, Snyk, or equivalent).
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
- Pin GitHub Actions and CI plugins by commit SHA, not mutable tags.

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
