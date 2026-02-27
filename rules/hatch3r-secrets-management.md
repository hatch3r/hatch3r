---
id: hatch3r-secrets-management
type: rule
description: Secret management, rotation, and secure handling patterns for the project
scope: always
---
# Secrets Management

## Env Var Management

- Store configuration and secrets in environment variables. Never hard-code secrets (API keys, tokens, passwords, connection strings) in source code, comments, or commit messages.
- Maintain a `.env.example` file in the repository root listing every required environment variable with placeholder values and brief descriptions. Update it whenever a new env var is introduced.
- Actual `.env` files must be in `.gitignore`. Verify `.gitignore` includes `.env`, `.env.local`, `.env.*.local`, and any other secret-bearing files before every commit.
- Use a typed env loader (e.g., `@t3-oss/env-core`, `envalid`, `zod` schema) to validate and parse environment variables at application startup. Fail fast with a clear error message listing missing or invalid variables.
- Separate secrets by environment: `.env.development`, `.env.staging`, `.env.production`. Never share production secrets with development environments.
- Document the source of each secret (which service/provider generates it) in `.env.example` or an internal secrets inventory document.

## Secret Rotation Policies

| Secret Type | Rotation Frequency | Trigger for Immediate Rotation |
|-------------|-------------------|-------------------------------|
| API keys (third-party) | Every 90 days | Suspected compromise, employee departure |
| Database credentials | Every 90 days | Credential exposure, personnel change |
| JWT signing keys | Every 180 days | Algorithm upgrade, key compromise |
| Webhook secrets | Every 180 days | Partner-side breach, integration change |
| Service account tokens | Every 90 days | Scope change, compromise |
| Encryption keys | Every 365 days (or per compliance) | Algorithm vulnerability, compliance audit |
| OAuth client secrets | Every 180 days | Provider breach, app re-registration |

- Implement dual-key (overlap) rotation: deploy the new secret, update all consumers, verify, then revoke the old secret. Never revoke before all consumers have migrated.
- Automate rotation where the provider supports it (AWS Secrets Manager auto-rotation, GCP Secret Manager rotation schedules).
- Log every rotation event: who initiated, when, which secret (by name, never by value), success/failure.

## Cloud Secret Managers

- **AWS Secrets Manager:** Store secrets as JSON key-value pairs. Use IAM policies to scope access per service/role. Enable automatic rotation with Lambda rotation functions. Use `aws-sdk` `GetSecretValue` at runtime — never bake secrets into container images or deployment artifacts.
- **GCP Secret Manager:** Store each secret as a versioned resource. Grant `secretmanager.secretAccessor` role per service account with resource-level IAM. Access secrets via `@google-cloud/secret-manager` client library at startup. Use secret versions (not `latest` in production) for auditability.
- **Azure Key Vault:** Store secrets, keys, and certificates. Use Managed Identity for authentication — no credentials needed to access the vault. Apply access policies per application identity. Enable soft-delete and purge protection.
- **HashiCorp Vault:** Use dynamic secrets where possible (database credentials, cloud IAM). Implement AppRole or Kubernetes auth for machine identity. Set TTLs on all leases. Audit log every access.
- **General:** Abstract the secret provider behind an interface so the application code is not coupled to a specific cloud provider. Inject the provider at startup via configuration.

## CI/CD Secret Injection

- **GitHub Actions:** Store secrets in repository or organization settings. Reference via `${{ secrets.SECRET_NAME }}`. Never echo secrets in workflow logs — use masking (`::add-mask::`). Use environment-scoped secrets for production deployments with required reviewers.
- **GitLab CI:** Store in project or group CI/CD variables. Mark as "Protected" (only available on protected branches) and "Masked" (redacted from logs). Use file-type variables for multi-line secrets (certificates, keys).
- **General CI principles:** Secrets must not appear in build logs, artifacts, or cached layers. Pin CI action versions by SHA (not tag) to prevent supply chain attacks on secret-accessing workflows. Rotate CI secrets on the same schedule as application secrets.
- **Ephemeral secrets:** For CI jobs that need temporary cloud access, use OIDC federation (e.g., GitHub Actions `aws-actions/configure-aws-credentials` with OIDC) instead of long-lived credentials.

## Application-Level Secret Handling

- **Never log secrets.** Sanitize log output to redact any field matching known secret patterns (tokens, keys, passwords). Use structured logging with an explicit allowlist of loggable fields.
- **Never serialize secrets** into JSON responses, error messages, stack traces, or client-side state. Treat secrets as write-only values: they go into the system but never come back out in any observable output.
- **Memory safety:** Clear secret values from memory after use where the language/runtime permits (overwrite buffers, null references). Avoid storing secrets in global/static variables that persist for the application lifetime.
- **Transport:** Transmit secrets only over TLS 1.2+. Never send secrets in URL query parameters (they appear in access logs and browser history). Use request headers or POST body.
- **Principle of least privilege:** Each service/function should have access only to the secrets it needs. Avoid a single "master" secret store accessible to all services.
- **Secret-bearing config objects:** Wrap secrets in a `Secret<T>` type that overrides `toString()` and `toJSON()` to return `"[REDACTED]"`. This prevents accidental exposure via logging or serialization.

## Secret Scanning in CI

- **gitleaks:** Run `gitleaks detect` in CI on every push and PR. Configure `.gitleaks.toml` with project-specific rules and allowlists for false positives (test fixtures, documentation examples).
- **TruffleHog:** Use `trufflehog git` for historical scanning of the full repository. Run quarterly or on suspected compromise. Focus on high-entropy strings and known secret patterns.
- **GitHub Secret Scanning:** Enable GitHub's built-in secret scanning and push protection. Configure custom patterns for project-specific secret formats.
- **Pre-commit hooks:** Install a local pre-commit hook (e.g., `gitleaks protect --staged`) to catch secrets before they reach the remote. This is defense-in-depth — CI scanning is still required.
- **Remediation SLA:** Secrets detected in CI must be rotated immediately (within 1 hour for production secrets). Assume any secret that reached a commit is compromised, even if the commit was force-pushed away — git history is recoverable.

## Emergency Rotation Procedures

When a secret is confirmed or suspected compromised:

1. **Assess scope:** Identify which secret, which environments, and which services are affected. Check audit logs for unauthorized access.
2. **Generate new secret:** Create a replacement via the appropriate provider (cloud console, API, or CLI). Do not reuse or derive from the compromised value.
3. **Deploy new secret:** Update the secret in the secret manager and deploy affected services. Use blue-green or rolling deployment to avoid downtime.
4. **Revoke old secret:** After confirming all services are using the new secret, revoke/delete the old one. Verify revocation by testing that the old value is rejected.
5. **Audit impact:** Review access logs for the compromised secret's lifetime. Identify any unauthorized actions taken with the compromised credential.
6. **Incident report:** Document the timeline, root cause (how the secret was exposed), blast radius, remediation steps, and preventive measures. File as a security incident per the project's incident response process.
7. **Prevent recurrence:** Add scanning rules for the pattern that was missed, review access controls, and update rotation policies if the secret exceeded its rotation window.
