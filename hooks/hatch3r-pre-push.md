---
id: pre-push-security
type: hook
event: pre-push
agent: security
description: Scan for secrets and security issues before push
tags: [floor:security]
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
---
# Hook: pre-push → security

Activate the security agent before pushing to scan for accidentally committed secrets, API keys, credentials, and other security-sensitive content.

## Agent Behavior

When this hook fires, the assigned agent should:

1. Identify all commits being pushed that are not yet on the remote.
2. Scan the diff of those commits for high-entropy strings, known secret patterns (API keys, tokens, passwords, private keys, connection strings), and files that commonly contain secrets (`.env`, `credentials.json`, `*.pem`).
3. Cross-reference findings against an allowlist (if configured) to suppress known false positives.
4. If secrets are detected, block the push and report the findings with file paths, line numbers, and the type of secret detected.
5. If no secrets are found, allow the push to proceed.

## Expected Output

- If secrets are found: a blocking report listing each finding with file, line, secret type, and remediation advice (e.g., "Rotate this key and move it to environment variables").
- If clean: a short confirmation ("No secrets detected in outgoing commits").

## Configuration

- **Allowlist**: Add known false positives to `.hatch3r/security/secret-allowlist.json` (patterns or file paths to ignore).
- **Pattern extensions**: The agent uses built-in patterns for common secret types. Add project-specific patterns via `.hatch3r/security/custom-patterns.json`.
- **Scope**: By default, scans only the diff of outgoing commits. Set `scanFullHistory: true` to scan all files (slower, useful for initial audits).
