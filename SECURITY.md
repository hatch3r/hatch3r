# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in hatch3r, please report it responsibly. **Do not open a public GitHub issue.**

### How to Report

Send an email to **security@hatch3r.com** with:

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
- **Drift detection** -- `hatch3r status` / `hatch3r verify` regenerate adapter outputs from the bundled canonical content and diff them against the on-disk copies, flagging drifted, hand-edited, or stale generated files. This is unsigned drift detection (regenerate-and-diff), not cryptographic per-file integrity: there is no `.integrity.json` checksum file (the SHA-256 manifest was removed in 1.9.0 per CONSTITUTION §6 Decision 12). See **Content Signing Limitations** below for the threat-model boundary
- **Pipeline prompt injection guards** -- ASI01-aligned input sanitization, output validation, and boundary markers for inter-agent communication
- **Agent tool allowlists** -- ASI02-aligned per-agent capability restrictions enforcing least-privilege access
- **Atomic file writes** -- all file operations use temp+rename to prevent corruption from interrupted writes
- **Local-only snapshot store** -- snapshot/rollback files under `.hatch3r/snapshots/` are written locally with no network egress and inherit the user's filesystem permissions (process umask); keep your home directory non-world-readable when working in repos whose user-edited content may contain secrets

## Enforcement Model

Each security control is either **code-enforced** (validated at runtime by TypeScript modules) or **instruction-delegated** (declared in content files and enforced by AI agent compliance with those instructions). Code-enforced controls fail hard; instruction-delegated controls depend on agent adherence.

| Control | Enforcement | Source Location | Status |
|---------|-------------|-----------------|--------|
| Prompt injection guard (input sanitization, output validation, boundary markers) | Code | `src/pipeline/promptGuard.ts` | Active |
| Agent tool allowlists (per-agent least-privilege) | Hybrid | Code: `src/pipeline/agentToolAllowlist.ts` (canonical policy registry + `checkToolAccess` orchestrator gate — the active enforcement point for the canonical `generalPurpose` spawn convention). Adapters: per-platform PreToolUse / MCP gating emission — Claude Code `.claude/hooks/pretooluse-allowlist.mjs` + `.claude/hooks/agent-tool-policies.json`; Cursor `.cursor/rules/hatch3r-tool-allowlist.mdc` + `.cursor/agents-policy.json` (Cursor lacks a PreToolUse hook surface, so enforcement is rule-delegated); Copilot ships an allowlist-only `tools:` array with no PreToolUse gate and no subcommand-grain deny (`git`→`execute`), so its emitted surface is instruction-delegated — see the Copilot runtime row under §Allowlist Hybrid Contract. | Active — orchestrator-boundary `checkToolAccess`. The Claude PreToolUse hook gates only a `hatch3r-`-prefixed `agent_type`; the `generalPurpose` default spawn carries Claude Code's own `agent_type` and passes the hook through (by design), so the hook is defense-in-depth that fires only for role-bearing native subagent spawns, not the active layer for generic spawns. |
| Circuit breaker (transient vs substantive failure classification) | Code | `src/pipeline/circuitBreaker.ts` | Active |
| Failure logging (structured failure capture) | Code | `src/pipeline/failureLog.ts` | Active |
| Phase output size compaction (summary bounding) | Code | `src/pipeline/phaseOutputSchema.ts` | Active |
| Phase/pipeline/adapter timeouts | Code | `src/pipeline/phaseTimeout.ts`, `pipelineTimeout.ts`, `adapterTimeout.ts` | Active |
| Compliance verification | Code | `src/pipeline/complianceVerification.ts` | Active |
| Agent identity validation | Library | `src/pipeline/agentIdentity.ts` (`@library_export_only`) | Library-only — ASI03 provenance metadata contract exported for downstream agent-runtime integrators (packs, orchestrators); not invoked on any hatch3r CLI codepath, so it is not a runtime-enforced control of the CLI. Tracked in `docs/decisions/ADR-001` (Enforcement `library-contract-for-downstream`) and gated by `scripts/validate-control-reachability.ts`. |
| Observability (telemetry, tracing) | Code | `src/pipeline/observability.ts` | Active |
| Atomic file writes (temp+rename) | Code | `src/merge/safeWrite.ts` | Active |
| Managed block boundary markers | Code | `src/merge/managedBlocks.ts` | Active |
| Drift detection (regenerate-and-diff against bundled canonical content) | Code | `hatch3r status` / `hatch3r verify` (`src/cli/commands/status.ts`, `verify.ts`) — no `.integrity.json` checksum file; SHA-256 manifest removed in 1.9.0 per CONSTITUTION §6 Decision 12 | Active |
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
| ASI02 | Tool use restrictions | Hybrid | Code: `src/pipeline/agentToolAllowlist.ts` -- per-agent tool category restrictions enforced at the orchestrator boundary via `checkToolAccess(roleId, category)`. This boundary gate is the **active** layer under the canonical `generalPurpose` spawn convention (`rules/hatch3r-agent-orchestration.md` -> Subagent Spawning Protocol -> Tool-allowlist enforcement boundary), because the runtime PreToolUse hook below gates only a `hatch3r-`-prefixed `agent_type` and a `generalPurpose` spawn does not carry one. Adapter emission: `src/adapters/claude.ts` writes `.claude/hooks/pretooluse-allowlist.mjs` (runtime PreToolUse gate — defense-in-depth, fires for role-bearing native `hatch3r-<role>` subagent spawns) + `.claude/hooks/agent-tool-policies.json` (machine-readable policy data) so the canonical allowlist survives into the Claude Code runtime as a deny-on-mismatch hook. `src/adapters/cursor.ts` writes `.cursor/agents-policy.json` + `.cursor/rules/hatch3r-tool-allowlist.mdc` (Cursor has no PreToolUse hook surface; rule + machine-readable policy file delegate enforcement to the Cursor agent runtime, paired with the `readonly: true` frontmatter primitive for read-only roles). `src/adapters/copilot.ts` emits an allowlist-only `tools:` array (no PreToolUse gate, no `Bash:<subcommand>` deny → `git` collapses to `execute`), so its enforcement is instruction-delegated — disclosed in the Copilot runtime row under §Allowlist Hybrid Contract. |
| ASI03 | Agent isolation | Hybrid | Code: review loop iteration limits (`reviewLoop.ts`), diff-hash verification (`diffHash.ts`). Instruction: agent role boundaries, file access scoping |
| ASI04 | Secure model configuration | Instruction | Model selection per-agent via `customize.yaml`. No runtime model override mechanism |
| ASI05 | Input/output validation | Code | `src/pipeline/promptGuard.ts` -- input size limits (MAX_PHASE_INPUT_LENGTH 500 KB) and output size limits (MAX_AGENT_OUTPUT_LENGTH 1 MB); `src/adapters/customization.ts` -- deny-pattern scanning; `src/pipeline/phaseOutputSchema.ts` -- CLI summary compaction |
| ASI06 | Monitoring and logging | Code | `src/pipeline/observability.ts`, `src/pipeline/failureLog.ts` |
| ASI07 | Data flow integrity | Code | Phase boundary schemas, diff-hash on handoffs |
| ASI08 | Supply chain security | Code (CI) | `.github/workflows/ci.yml` -- supply chain audit, lockfile checks |
| ASI09 | Access control | Code | Path traversal guards, tool allowlists, managed block enforcement |
| ASI10 | Secure deployment | Instruction | Deployment guidance in agent content. No runtime deployment control |

## Allowlist Hybrid Contract

The agent tool allowlist (ASI02) is enforced at two layers — the **canonical/repo-level allowlist** (`src/pipeline/agentToolAllowlist.ts::AGENT_TOOL_POLICIES`) is the single source of truth, and **adapter-emitted PreToolUse / MCP-gating hooks** carry that policy into each platform's runtime.

| Layer | Mechanism | Failure mode |
|-------|-----------|--------------|
| Canonical (repo) | `checkToolAccess(agentId, tool)` rejects with `AllowlistDenialEvent` when called from the hatch3r orchestrator pipeline (`src/pipeline/` callers) | Deny-by-default; structured `failure-log.jsonl` entry per finding C7.5-W2B2-H44 |
| Adapter (runtime) — Claude | Claude Code: `.claude/hooks/pretooluse-allowlist.mjs` parses the PreToolUse JSON payload on stdin (`tool_name`, `agent_type`, `agent_id` per https://code.claude.com/docs/en/hooks, accessed 2026-05-21), evaluates the request against `.claude/hooks/agent-tool-policies.json`, and emits a stdout JSON deny decision when the requested category falls outside the active hatch3r sub-agent's policy. Scope is limited to `hatch3r-*` sub-agents — main-thread calls and Claude Code's own sub-agents (e.g. `general-purpose`, `Plan`) pass through. The Claude `tools:` frontmatter additionally carries the source `Bash:git commit`/`Bash:git push` deny entries forward, so a git-restricted agent keeps unrestricted-execute fenced off at the subcommand grain. | PreToolUse hook exits 0 and emits `{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"…"}}` on stdout (Claude Code denies the tool); structured deny event also written to stderr for failure-log persistence. |
| Adapter (runtime) — Cursor | Cursor: `.cursor/rules/hatch3r-tool-allowlist.mdc` (`alwaysApply: true`) + `.cursor/agents-policy.json` instruct the Cursor agent runtime to refuse out-of-policy tool calls. Pairs with the `readonly: true` frontmatter primitive for agents whose policy lacks `write` and `execute`. Cursor exposes no PreToolUse hook surface and no subcommand-grain deny, so write/execute roles fall back to instruction-delegated refusal. | Rule-delegated — instruction violation surfaces in the review loop. |
| Adapter (runtime) — Copilot (D15-22 / SA15.3-F7) | GitHub Copilot: the emitted custom-agent surface installs **no PreToolUse runtime gate** (Copilot is the only adapter with `hooks: false` in `ADAPTER_CAPABILITIES`). The `tools:` frontmatter is a tool-level **allowlist only** — there is no `Bash:<subcommand>` deny primitive (verified 2026-06-09 @ https://docs.github.com/en/copilot/reference/custom-agents-configuration), so the `git` category collapses to `execute` (`src/pipeline/adapterToolTranslator.ts` `COPILOT_CATEGORY_MAP`) and a git-restricted agent receives **unrestricted execute**. The source `tools.deny: ["Bash:git commit", ...]` cannot be re-emitted at finer grain the way the Claude row carries it. Enforcement on the shipped surface is instruction-delegated (the `## Copilot Enforcement Model` addendum + `.github/instructions/` directives are normative, not advisory). | Instruction-delegated; no runtime deny. Self-detectable drift indicators (see the emitted addendum) are the active control. The VS Code agent-customization PreToolUse hook is Preview (https://code.visualstudio.com/docs/agent-customization/hooks, accessed 2026-06-09); wiring hatch3r to emit it is a tracked CL-2 content-gap candidate, after which this row gains a code-enforced deny. |

Rationale for Hybrid (not pure Code): the orchestrator-side check (`checkToolAccess`) only fires when the hatch3r pipeline mediates the agent invocation. Once a generated agent runs inside Claude Code, Cursor, or any other adapter target, the orchestrator is no longer in the loop — runtime enforcement must travel with the generated artifacts. Adapter-emitted hooks close the gap; the canonical policy registry remains the single source.

Source of truth: `src/pipeline/agentToolAllowlist.ts::AGENT_TOOL_POLICIES`. Adapter emission helpers: `buildAgentToolPoliciesJson()`, `buildClaudePreToolUseHookScript()`, `buildCursorAllowlistRule()`.

## Content Signing Limitations

Integrity is **drift detection** — `hatch3r status` / `hatch3r verify` regenerate adapter outputs from the bundled canonical content shipped inside the npm package and diff them against the on-disk copies. There is no `.integrity.json` checksum file (the SHA-256 manifest was removed in 1.9.0 per CONSTITUTION §6 Decision 12). The mechanism is **not cryptographically signed**:

- **What it detects:** on-disk adapter output that no longer matches what the bundled canonical content would regenerate — drifted, hand-edited, or stale generated files
- **What it does not prevent:** an attacker who can modify both the on-disk output and the bundled package content can produce a clean diff. The comparison anchors on package-shipped content, not a signed digest
- **Trust model:** drift detection flags accidental and stale changes during `hatch3r status` / `verify`. It does not provide a tamper-proof guarantee. Users who need stronger assurance should verify the installed npm package against published hashes
- **Limitation scope:** this is a detection-only mechanism appropriate for a developer-local CLI tool. Signing would require key management infrastructure that exceeds the current threat model

## Scope

### In Scope

- hatch3r CLI (`npx hatch3r init/sync/update/add/status/validate/verify/config/clean/worktree-setup`)
- Tool adapters (Cursor, Copilot, Claude Code)
- Content validation and safe merging logic
- Content safety deny patterns and secret detection
- MCP configuration generation
- Integrity verification and compliance checking

### Out of Scope

- Third-party MCP servers (report to the respective MCP server maintainers)
- User-generated packs (pack authors are responsible for their own content)
- AI model behavior (hatch3r provides configuration, not runtime execution)
- Generated agent/skill content quality (prompt engineering, not security)
