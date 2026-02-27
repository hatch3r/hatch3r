---
id: security
type: check
description: Security review criteria covering vulnerability patterns, input validation, authentication, secrets handling, and dependency safety
---
# Security Check

Review criteria for evaluating security posture in pull requests.

## Input Validation

- `[CRITICAL]` All external input (HTTP params, form data, file uploads, CLI args) is validated and sanitized before use.
- `[CRITICAL]` SQL queries use parameterized statements or an ORM — no string concatenation of user input into queries.
- `[CRITICAL]` HTML output is escaped to prevent XSS. No use of `dangerouslySetInnerHTML`, `v-html`, or equivalent without sanitization.
- `[CRITICAL]` File paths constructed from user input are validated against directory traversal (`../`).
- `[RECOMMENDED]` Input validation uses schema validation (Zod, Joi, JSON Schema) rather than manual checks.

## Authentication and Authorization

- `[CRITICAL]` New endpoints have appropriate authentication guards. No accidental public exposure of protected resources.
- `[CRITICAL]` Authorization checks verify the authenticated user has access to the specific resource, not just that they're logged in.
- `[CRITICAL]` Authentication tokens are not logged, included in URLs, or exposed in error messages.
- `[RECOMMENDED]` Session tokens use secure attributes: `HttpOnly`, `Secure`, `SameSite=Strict`, appropriate `Max-Age`.
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
- `[RECOMMENDED]` Dependency count increase is justified — prefer standard library solutions when adequate.
- `[RECOMMENDED]` New dependencies have appropriate licenses compatible with the project.

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
- `[RECOMMENDED]` Security-relevant errors (auth failures, permission denials) are logged with sufficient context for incident investigation.
