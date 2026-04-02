# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in hatch3r, please report it responsibly. **Do not open a public GitHub issue.**

### How to Report

Send an email to **security@hatch3r.dev** with:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact and severity assessment
- Any suggested mitigations (optional)

### Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 5 business days
- **Resolution target:** depends on severity (critical: 7 days, high: 14 days, medium: 30 days)

### What to Expect

1. You will receive an acknowledgment confirming receipt of your report.
2. We will investigate and provide an initial assessment with a severity rating.
3. We will work on a fix and coordinate disclosure timing with you.
4. Once a fix is released, we will publicly credit you (unless you prefer to remain anonymous).

## Disclosure Policy

We follow coordinated disclosure with a 90-day window. If a fix is not released within 90 days of the initial report, the reporter may disclose the vulnerability publicly.

## Security Measures

hatch3r includes several security layers:

- **Content safety deny patterns** -- scans for prompt injection, code execution, data exfiltration, and credential exposure patterns in user-editable content
- **Secret pattern detection** -- detects accidentally included API keys, tokens, and credentials in MCP environment configuration during `hatch3r validate`
- **No hardcoded secrets** -- all sensitive configuration uses environment variable placeholders (`${env:GITHUB_PAT}`, `${env:BRAVE_API_KEY}`). Secrets are centralized in a single `.env.mcp` file at the project root, which is gitignored via the `.env.*` pattern
- **MCP server warnings** -- init displays security warnings when MCP servers are enabled
- **Path traversal protection** -- content installation validates paths stay within the project root (null byte injection, directory traversal, and absolute path guards)
- **Naming convention isolation** -- `hatch3r-*` prefix separates managed from user files, preventing unintended overwrites
- **Integrity verification** -- `hatch3r verify` detects unauthorized modifications to canonical agent files via SHA-256 content hashing
- **Pipeline prompt injection guards** -- ASI01-aligned input sanitization, output validation, and boundary markers for inter-agent communication
- **Agent tool allowlists** -- ASI02-aligned per-agent capability restrictions enforcing least-privilege access
- **Atomic file writes** -- all file operations use temp+rename to prevent corruption from interrupted writes

## Scope

### In Scope

- hatch3r CLI (`npx hatch3r init/sync/update/add/status/validate/verify/config`)
- Tool adapters (Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed, Amazon Q, Antigravity)
- Content validation and safe merging logic
- Content safety deny patterns and secret detection
- MCP configuration generation
- Integrity verification and compliance checking

### Out of Scope

- Third-party MCP servers (report to the respective MCP server maintainers)
- User-generated packs (pack authors are responsible for their own content)
- AI model behavior (hatch3r provides configuration, not runtime execution)
- Generated agent/skill content quality (prompt engineering, not security)
