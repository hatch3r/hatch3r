# Security Patterns

Security patterns required in all `src/` code (P6: Security & Trust Governance):

1. **Atomic file writes:** Use temp file + rename pattern via `src/merge/safeWrite.ts` — never write directly to target path
2. **Path traversal guards:** Validate all user-provided paths. No `../` traversal outside project root
3. **No hardcoded secrets:** Use `${env:VAR}` placeholder syntax for API keys, tokens. Check `.env.mcp` for MCP credentials
4. **Prompt injection defense:** Content safety deny patterns in `src/pipeline/promptGuard.ts` — 500KB input limit, 1MB output limit, boundary marker verification
5. **Tool allowlists:** Per-agent capability restrictions via `src/pipeline/agentToolAllowlist.ts` — deny-by-default, 8 tool categories
6. **Integrity verification:** SHA-256 hashing via `src/integrity/index.ts` for all canonical files
7. **Circuit breaker:** Transient vs substantive failure classification in `src/pipeline/circuitBreaker.ts` — only transient failures trip the breaker

Reference: `governance/audit/domains/D15-agentic-security.md`, OWASP ASI01-10 controls.
