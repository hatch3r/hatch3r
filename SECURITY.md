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

## Enforcement Model

Each security control is either **code-enforced** (validated at runtime by TypeScript modules) or **instruction-delegated** (declared in content files and enforced by AI agent compliance with those instructions). Code-enforced controls fail hard; instruction-delegated controls depend on agent adherence.

| Control | Enforcement | Source Location | Status |
|---------|-------------|-----------------|--------|
| Prompt injection guard (input sanitization, output validation, boundary markers) | Code | `src/pipeline/promptGuard.ts` | Active |
| Agent tool allowlists (per-agent least-privilege) | Code | `src/pipeline/agentToolAllowlist.ts` | Active |
| Circuit breaker (transient vs substantive failure classification) | Code | `src/pipeline/circuitBreaker.ts` | Active |
| Failure logging (structured failure capture) | Code | `src/pipeline/failureLog.ts` | Active |
| Phase output schema validation | Code | `src/pipeline/phaseOutputSchema.ts` | Active |
| Phase/pipeline/adapter timeouts | Code | `src/pipeline/phaseTimeout.ts`, `pipelineTimeout.ts`, `adapterTimeout.ts` | Active |
| Compliance verification | Code | `src/pipeline/complianceVerification.ts` | Active |
| Agent identity validation | Code | `src/pipeline/agentIdentity.ts` | Active |
| Observability (telemetry, tracing) | Code | `src/pipeline/observability.ts` | Active |
| Atomic file writes (temp+rename) | Code | `src/merge/safeWrite.ts` | Active |
| Managed block boundary markers | Code | `src/merge/managedBlocks.ts` | Active |
| SHA-256 integrity verification | Code | `src/integrity/index.ts` | Active |
| MCP configuration integrity | Code | `src/integrity/index.ts` (covers `mcp/` directory) | Active |
| MCP timeout enforcement | Code | `src/adapters/mcp-utils.ts` (per-server configurable, default 30s) | Active |
| Path traversal protection | Code | `src/cli/` (init/sync path validation) | Active |
| Secret pattern detection | Code | `src/env/secretDetection.ts`, `src/cli/commands/validate.ts` | Active |
| Customization content-length limits | Code | `src/models/customize.ts`, `src/adapters/customization.ts` | Active |
| Content safety deny patterns | Hybrid | `src/adapters/customization.ts` (code scan) + `agents/shared/quality-charter.md` (instruction) | Active |
| Agent behavioral constraints | Instruction | `agents/hatch3r-*.md` (per-agent role definitions) | Active |
| Guardrails policy | Instruction | `rules/hatch3r-code-standards.md`, `rules/hatch3r-security-patterns.md` | Active |
| Hook condition guards | Instruction | `hooks/hatch3r-*.md` (glob/label/branch scoping) | Active |
| MCP server security warnings | Instruction | `agents/shared/quality-charter.md` | Active |

## ASI Control Delegation Mapping

OWASP ASI controls are implemented through a combination of code enforcement and instruction delegation. The following table maps each ASI control to its enforcement mechanism.

| ASI Control | Description | Enforcement | Implementation |
|-------------|-------------|-------------|----------------|
| ASI01 | Prompt injection prevention | Code | `src/pipeline/promptGuard.ts` -- input sanitization, output validation, boundary markers |
| ASI02 | Tool use restrictions | Code | `src/pipeline/agentToolAllowlist.ts` -- per-agent tool category restrictions |
| ASI03 | Agent isolation | Hybrid | Code: review loop iteration limits (`reviewLoop.ts`), diff-hash verification (`diffHash.ts`). Instruction: agent role boundaries, file access scoping |
| ASI04 | Secure model configuration | Instruction | Model selection per-agent via `customize.yaml`. No runtime model override mechanism |
| ASI05 | Input/output validation | Code | `src/pipeline/phaseOutputSchema.ts` -- schema validation at phase boundaries |
| ASI06 | Monitoring and logging | Code | `src/pipeline/observability.ts`, `src/pipeline/failureLog.ts` |
| ASI07 | Data flow integrity | Code | Phase boundary schemas, diff-hash on handoffs |
| ASI08 | Supply chain security | Code (CI) | `.github/workflows/ci.yml` -- supply chain audit, lockfile checks |
| ASI09 | Access control | Code | Path traversal guards, tool allowlists, managed block enforcement |
| ASI10 | Secure deployment | Instruction | Deployment guidance in agent content. No runtime deployment control |

## Content Signing Limitations

The integrity verification system (`src/integrity/index.ts`) is **content-addressed** (SHA-256 per-file hashing with a manifest-level checksum) but **not cryptographically signed**:

- **What it detects:** unauthorized modifications, missing files, new files not in the manifest, and manifest tampering (via the checksum field)
- **What it does not prevent:** an attacker with write access to `.agents/` can regenerate a valid manifest that certifies tampered content. The manifest has no HMAC or digital signature
- **Trust model:** the integrity system detects accidental changes and flags intentional modifications during `hatch3r verify`. It does not provide a tamper-proof guarantee. Users who need stronger assurance should verify content against the published npm package hashes
- **Limitation scope:** this is a detection-only mechanism appropriate for a developer-local CLI tool. Signing would require key management infrastructure that exceeds the current threat model

## Scope

### In Scope

- hatch3r CLI (`npx hatch3r init/sync/update/add/status/validate/verify/config/clean/worktree-setup`)
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
