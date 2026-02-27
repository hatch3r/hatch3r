# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

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

- **Command deny list** (`/.agents/policy/deny-commands.yml`) blocks destructive operations (rm -rf, force push, DROP DATABASE, etc.)
- **Safe-run wrapper** (`/.agents/tools/safe-run`) validates commands against the deny list before execution
- **No hardcoded secrets** -- all sensitive configuration uses environment variable placeholders (`${env:GITHUB_PAT}`, `${env:BRAVE_API_KEY}`). Secrets are centralized in a single `.env.mcp` file at the project root, which is gitignored via the `.env.*` pattern
- **MCP server warnings** -- init displays security warnings when MCP servers are enabled
- **Path traversal protection** -- pack installation validates paths stay within the project root
- **Naming convention isolation** -- `hatch3r-*` prefix separates managed from user files, preventing unintended overwrites

## Scope

### In Scope

- hatch3r CLI (`npx hatch3r init/sync/update/add/status/validate`)
- Tool adapters (Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code)
- Pack validation and merging logic
- Safe-run wrapper and deny-commands policy
- MCP configuration generation

### Out of Scope

- Third-party MCP servers (report to the respective MCP server maintainers)
- User-generated packs (pack authors are responsible for their own content)
- AI model behavior (hatch3r provides configuration, not runtime execution)
- Generated agent/skill content quality (prompt engineering, not security)
