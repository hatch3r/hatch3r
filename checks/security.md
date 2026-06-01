---
id: security
type: check
description: Security review criteria covering vulnerability patterns, input validation, authentication, secrets handling, and dependency safety
cache_friendly: true
---
# Security Check

> **Severity vocabulary:** see [agents/shared/severity-mapping.md](../agents/shared/severity-mapping.md) for canonical 5-column mapping.

Review criteria for evaluating security posture in pull requests.

## Input Validation

- `[CRITICAL]` All external input (HTTP params, form data, file uploads, CLI args) is validated and sanitized before use.
- `[CRITICAL]` SQL queries use parameterized statements or an ORM — no string concatenation of user input into queries.
- `[CRITICAL]` HTML output is escaped to prevent XSS. No use of `dangerouslySetInnerHTML`, `v-html`, or equivalent without sanitization.
- `[CRITICAL]` File paths constructed from user input are validated against directory traversal (`../`).
- `[RECOMMENDED]` Input validation uses schema validation (Zod, Joi, JSON Schema) rather than manual checks.

## Authentication and Authorization

- `[CRITICAL]` New endpoints enforce authentication and resource-level authorization per an OAuth 2.1 / RBAC rubric — every non-public route rejects unauthenticated requests (401) and out-of-scope authenticated requests (403). No accidental public exposure of protected resources.
- `[CRITICAL]` Authorization checks verify the authenticated user has access to the specific resource, not just that they're logged in.
- `[CRITICAL]` Authentication tokens are not logged, included in URLs, or exposed in error messages.
- `[RECOMMENDED]` Session tokens use secure attributes: `HttpOnly`, `Secure`, `SameSite=Strict`, and a `Max-Age` no longer than the session policy (default ≤24h for access tokens, ≤30d for refresh tokens).
- `[RECOMMENDED]` Rate limiting is applied to authentication endpoints (login, password reset, OTP verification).

## Secrets and Credentials

- `[CRITICAL]` No hardcoded secrets, API keys, passwords, or tokens in source code.
- `[CRITICAL]` No secrets in committed configuration files, test fixtures, or comments.
- `[CRITICAL]` `.env` files are gitignored. Only `.env.example` (with placeholder values) is committed.
- `[RECOMMENDED]` Secrets are loaded from environment variables or a secrets manager, not from config files.
- `[RECOMMENDED]` New secrets are documented in `.env.example` with a description of their purpose.

## Dependency Safety

- `[CRITICAL]` New dependencies are from trusted sources with active maintenance (recent commits, multiple maintainers).
- `[CRITICAL]` No known critical or high vulnerabilities in new or updated dependencies (`npm audit`, `pip audit`, etc.).
- `[RECOMMENDED]` Each added runtime dependency is justified in the PR description; a standard-library or already-present-dependency equivalent that covers the same use case is preferred over a new transitive dependency tree.
- `[RECOMMENDED]` New dependencies carry an OSI-approved license compatible with the project license (no GPL/AGPL copyleft in a permissively-licensed product unless legal-approved).

## Data Exposure

- `[CRITICAL]` API responses do not leak internal implementation details (stack traces, database errors, internal paths).
- `[CRITICAL]` PII fields are not included in logs, error messages, or analytics events.
- `[CRITICAL]` Sensitive data in database queries is not selected unnecessarily (select only needed columns).
- `[RECOMMENDED]` API responses use DTOs or serializers that explicitly whitelist fields, rather than returning raw database objects.

## Cryptography

- `[CRITICAL]` No use of deprecated or weak algorithms (MD5 for security, SHA1 for signatures, DES, RC4).
- `[CRITICAL]` Random values for security purposes (tokens, nonces) use cryptographically secure generators (`crypto.randomBytes`, `secrets.token_hex`).
- `[RECOMMENDED]` Passwords are hashed with bcrypt, scrypt, or Argon2 — not SHA-256 or PBKDF2 with low iterations.
- `[RECOMMENDED]` TLS certificate validation is not disabled, even in test environments.

## Error Handling

- `[CRITICAL]` Error responses to clients do not include stack traces, internal paths, or database details.
- `[RECOMMENDED]` Security-relevant errors (auth failures, permission denials) are logged with the five fields an incident responder needs — timestamp, actor/subject identifier, action attempted, resource, and outcome — and never the secret or credential that was rejected.
