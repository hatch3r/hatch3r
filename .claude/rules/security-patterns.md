---
id: security-patterns
type: rule
description: Mandatory security patterns in src/ — atomic writes, path traversal guards, no hardcoded secrets, prompt injection defense, tool allowlists, drift detection, circuit breaker.
tags: [maintainer, security, p6]
scope: always
precedence: high
---

# Security Patterns

**Pillars:** P6 (Security & Trust)

Security patterns required in all `src/` code:

1. **Atomic file writes:** Use temp file + rename pattern via `src/merge/safeWrite.ts` — never write directly to target path
2. **Path traversal guards:** Validate all user-provided paths. No `../` traversal outside project root
3. **No hardcoded secrets:** Use `${env:VAR}` placeholder syntax for API keys, tokens. Check `.env.mcp` for MCP credentials
4. **Prompt injection defense:** Content safety deny patterns in `src/pipeline/promptGuard.ts` — 500KB input limit, 1MB output limit, boundary marker verification
5. **Tool allowlists:** Per-agent capability restrictions via `src/pipeline/agentToolAllowlist.ts` — deny-by-default, 8 tool categories
6. **Drift detection:** `hatch3r status` / `hatch3r verify` regenerate adapter outputs from the bundled canonical content shipped with the npm package and diff against on-disk copies — there is no `.integrity.json` checksum file (legacy `src/integrity/` removed in 1.9.0 per CONSTITUTION §6 Decision 12)
7. **Circuit breaker:** Transient vs substantive failure classification in `src/pipeline/circuitBreaker.ts` — only transient failures trip the breaker

Reference: `governance/audit/domains/D15-agentic-security.md`, OWASP ASI01-10 controls.
