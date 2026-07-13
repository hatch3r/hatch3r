# MCP Server Blast Radius and Capability Guidance

Finding #83 (D15, High): Document MCP server blast radius with per-server capability guidance.

## Overview

MCP (Model Context Protocol) servers extend agent capabilities by connecting them
to external services. Each server introduces a specific **blast radius** — the
scope of damage that could occur if the server is compromised, misconfigured, or
misused by an agent.

This document provides per-server capability analysis and security guidance.

## MCP transport trust model

Two transport classes carry different security floors. The per-server blast radius below is **in addition to** these floors, not a substitute for them.

- **STDIO transport** (every `command`-launched server — `context7`, `filesystem`, `playwright`, `brave-search`, `sentry`, `postgres`, `linear`, `azure-devops`, `gitlab`): **no authentication, no encryption**. The MCP 2025-06-18 specification defines authorization only for HTTP-based transports; a STDIO server is trusted purely because it is a locally spawned child process, and it **inherits the editor's full privileges** (file system, network, environment). The absence of a `url:` is not a security claim — a STDIO server has the same host access as the editor that launched it.
- **HTTP transport** (`url`-based servers — `github`): subject to TLS, optional OAuth 2.1 per the MCP spec, and hatch3r's C9-M34 endpoint policy (`src/adapters/mcp-utils.ts::validateMcpHttpEndpoint`) which requires a `_pinned_sha256` artifact hash unless `_trust_bypass: true` is set with a documented Trust Rationale.

Sources: [MCP 2025-06-18 transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [MCP 2025-06-18 authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) (accessed 2026-05-26).

## Known MCP CVEs (as of Cycle 12, 2026-07-10)

This is the dated CVE audit trail for the MCP attack surface, distinct from the per-server blast radius below. The per-server `securityNote`/version-pin checks (postgres, brave-search) catch a CVE bound to one npm package; the entries here are **protocol/client-connect-class** CVEs that no single per-package pin surfaces, because they live in the connect path every STDIO/HTTP server exercises.

Ownership split (part of hatch3r's internal security audit machinery): **audit domain D21 owns running the scan; the agentic-security domain (D15) verifies this audit trail.** The dynamic per-package scan is `npm run mcp:cve-check` (`scripts/check-mcp-cves.ts`) — it queries OSV.dev for every `npx`-launched package in `mcp/*.json` and fails the gate on a Critical/High advisory public for more than 30 days against a shipped version. Re-run it and refresh the date heading every audit cycle (≤90-day window per the P3 external-tool-currency pillar).

| CVE | Class | CVSS | Affected | hatch3r exposure | Status / mitigation |
|-----|-------|------|----------|-------------------|---------------------|
| [CVE-2025-6514](https://nvd.nist.gov/vuln/detail/CVE-2025-6514) | Client-connect RCE (OS command injection via OAuth `authorization_endpoint` URL on connect to an untrusted server) | 9.6 | `mcp-remote` 0.0.5–0.1.15 (fixed 0.1.16) | Not bundled — `mcp/mcp.json` ships no `mcp-remote` launcher; users who add their own `mcp-remote` proxy to reach a remote server inherit it | Pin `mcp-remote>=0.1.16`; connect only to trusted servers over HTTPS. Surfaced by `npm run mcp:cve-check` if added to the pack |
| No CVE id — supply-chain class | Malicious-version / rug-pull (a maintained MCP package publishes a trojaned new version; the postmark-mcp incident, 2026) | n/a | Any launcher on a floating spec (`@latest` or no `@version`) that auto-adopts a new version | None in the shipped pack — all 8 `npx` launchers pin an exact `@<ver>`; a user who adds an unpinned or `@latest` launcher inherits it | Version pinning — `checkVersionPin` (`src/adapters/mcp-utils.ts::checkVersionPin`) flags any floating-`latest`/no-version launcher; see the version-pin note below |

Class-level note (no single CVE id): the OWASP Q1-2026 MCP wave catalogued 30+ CVEs across Jan–Feb 2026 (43% exec/shell injection, 38% of surveyed servers shipping no auth). The structural defenses in this repo that address the class are the STDIO/HTTP transport floors above (untrusted-connect is the CVE-2025-6514 trigger) and the `_description` strip below (tool-poisoning family); neither replaces pinning a maintained server version.

Sources (accessed 2026-06-05): [JFrog CVE-2025-6514 analysis](https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/) (Trust Tier 1, vendor security research), [Wiz CVE-2025-6514](https://www.wiz.io/vulnerability-database/cve/cve-2025-6514) (Trust Tier 1, vendor vulnerability database), [WorkOS — vetting MCP tools / OWASP MCP Top 10](https://workos.com/blog/mcp-supply-chain-security) (Trust Tier 2, named-vendor analysis).

**Version pinning — the control for the malicious-version row, and its residual (D15-SA15.5-03 / -04).** The rug-pull row above is answered by `checkVersionPin` (`src/adapters/mcp-utils.ts::checkVersionPin`): it flags, with a surfaced warning, any on-demand-fetch launcher on a floating spec (`@latest` or no `@version`), so an unpinned or `latest`-tagged server is never emitted silently. The bundled pack goes one step further than the gate requires — all 8 `npx` launchers carry an exact `@<ver>`, not a range. Because npm forbids republishing an existing version with different bytes, an exact `@<ver>` is effectively content-addressed: a maintainer who publishes a trojaned new version cannot reach a pinned consumer without an explicit, reviewable version bump.

Recorded residual (Info, not actioned this cycle — D15-SA15.5-04): `npx -y <pkg>@<ver>` still re-fetches the pinned version from the registry on every editor launch, with no committed lockfile, no `--prefer-offline`, and no integrity subresource. The dominant residual — the registry serving tampered bytes for an already-published version — is closed by npm's version immutability, leaving only a first-fetch registry/DNS interception that a setup-time generator cannot mediate at runtime. The named next hardening rung, if hatch3r later ships it in end-user guidance, is a committed lockfile / `--prefer-offline` resolution or a minimum-release-age cooldown (adopt a new version only after it has been public for N days, so a malicious publish is likely yanked first).

Supply-chain sources (accessed 2026-07-12): [OX Security — MCP supply-chain analysis](https://www.ox.security/blog/the-mother-of-all-ai-supply-chains-critical-systemic-vulnerability-at-the-core-of-the-mcp/) (Trust Tier 2, named-vendor analysis — malicious marketplace-distribution class), [Practical DevSecOps — MCP security statistics 2026](https://www.practical-devsecops.com/mcp-security-statistics-2026-report/) (Trust Tier 2, independent analysis — documents the postmark-mcp malicious-package incident).

## Tool-poisoning mitigation: `_description` strip

Tool poisoning ([Invariant Labs, 2025](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)) plants attacker-controlled instructions inside an MCP server's tool/description metadata so the editor renders them into the agent's context. hatch3r blocks this at adapter emission: `BaseAdapter.readFilteredMcp` (`src/adapters/base.ts` → `const { _disabled, _description, ...clean } = entry;`) destructures `_description` out of every entry, so the field is **never written** to any generated `.mcp.json` / `.cursor/mcp.json` / `.vscode/mcp.json`.

This is a positive control, not a best-effort scan: even a poisoned description that survives the sync-time deny-pattern scan (`src/pipeline/mcpDescriptionScan.ts`, which only warns) and canonical-file review cannot reach the editor's tool-description display surface, because the adapter output carries no description field at all. A contributor refactoring `readFilteredMcp` must preserve the `_description` strip — re-including the field would silently re-open the tool-poisoning display surface this control closes.

## Scope boundary: emission-time controls vs. runtime compromise

Every hatch3r MCP control above acts at **config-emission time** — the `_description` strip, the HTTP endpoint pin (`validateMcpHttpEndpoint`), the version-pin flag (`checkVersionPin`), and the refusal-grade argv scan all run as an adapter writes a client MCP config, before any server starts. They do not, and by architecture cannot, mediate what a server does once the editor launches it. A server that passes every emission-time check and is then compromised at runtime — a maintainer rug-pull, a hijacked upstream endpoint — is contained by the editor's per-tool approval prompt plus the per-server least-privilege guidance below, not by hatch3r.

The concrete runtime surface this leaves open is a server's tool **results**: the `_description` strip closes the tool-description display surface at emission time, but it does not touch the content a server returns at runtime, which must be treated as untrusted data, not executable instruction ([arxiv 2601.17548](https://arxiv.org/html/2601.17548v1) §III-C, accessed 2026-07-12). An editor that renders a malicious tool result into the agent's context is the containment layer there — through its per-tool approval and the least-privilege server scoping in this document — not the generator. This is the honest posture for a setup-time tool: hatch3r hardens the config it writes; the editor and the mitigations below own the runtime.

## Blast Radius Classification

| Level    | Definition                                                       |
|----------|------------------------------------------------------------------|
| Critical | Can modify production data, infrastructure, or billing           |
| High     | Can read/write code, issues, or project configuration            |
| Medium   | Can read external data or execute sandboxed operations           |
| Low      | Read-only access to public or non-sensitive data                 |

## Per-Server Analysis

### github

- **Blast Radius**: High
- **Capabilities**: Repository management, code review, issue/PR management, project boards
- **Required Env**: `GITHUB_PAT`
- **Risk Surface**:
  - Can create/merge PRs, modify code, close issues
  - Can modify project board status and labels
  - Can access private repository contents
- **Mitigation**:
  - Use fine-grained PATs scoped to specific repositories
  - Prefer read-only tokens when full write access is not needed
  - Rotate tokens regularly (90-day maximum)
  - Monitor GitHub audit log for unexpected API activity

#### GitHub toolset scoping

The canonical `github` entry in `mcp/mcp.json` sets `X-MCP-Toolsets: "repos,issues,pull_requests"` rather than `all`. This is the least-privilege baseline: the three write-capable toolsets a coding agent needs, excluding the read-only `context`/`users` toolsets and every high-blast-radius toolset (`code_security`, `secret_protection`, `actions`, `orgs`, `projects`). The header is a comma-separated subset of the toolset names enumerated by the upstream `github/github-mcp-server` (`all` enables every toolset; an explicit subset narrows the granted tool surface). Operators who need more must widen the header explicitly — `all` re-grants secret-scanning, Actions, and org-admin tools, raising the blast radius beyond the High classification above.

#### Trust Rationale (HTTP endpoint, unpinned)

The canonical entry targets the live remote endpoint `https://api.githubcopilot.com/mcp/` over HTTP transport and carries `_trust_bypass: true`. Under the C9-M34 policy (`src/adapters/mcp-utils.ts::validateMcpHttpEndpoint`), an HTTP endpoint (where `url` is set and `command` is not) requires a `_pinned_sha256` artifact hash unless `_trust_bypass: true` is set. SHA-256 pinning is not viable here because GitHub's hosted MCP API serves rotating content with no stable artifact to pin — the exact "pinning impossible" case the policy documents. The `_trust_bypass` opt-out is therefore the intended resolution: it accepts the entry while `validateMcpEntry` emits an auditable warning (Silent Failure Contract), so the bypass remains visible rather than silently shipping an unpinned endpoint that survives only as a soft warning. The accepted residual risk is upstream compromise of the GitHub-hosted endpoint; mitigations are the toolset scoping above plus the fine-grained, rotated PAT.

### azure-devops

- **Blast Radius**: High
- **Capabilities**: Work items, repos, pipelines, boards
- **Required Env**: `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG`
- **Risk Surface**:
  - Can modify work items, trigger pipelines, push code
  - Can access all projects within the organization scope
- **Mitigation**:
  - Scope PAT to minimum required permissions
  - Restrict to specific projects when possible
  - Enable conditional access policies
  - Use short-lived tokens

### gitlab

- **Blast Radius**: High
- **Capabilities**: Issues, merge requests, pipelines, project management
- **Required Env**: `GITLAB_TOKEN`
- **Risk Surface**:
  - Can create/merge MRs, modify code, manage CI/CD
  - API scope grants broad project access
- **Mitigation**:
  - Use project-scoped tokens instead of personal access tokens
  - Limit token scopes to `api` only when needed; prefer `read_api` for read-only
  - Set token expiration dates

### context7

- **Blast Radius**: Low
- **Capabilities**: Library documentation lookup (read-only)
- **Required Env**: None
- **Risk Surface**:
  - Read-only access to public documentation
  - Minimal attack surface
- **Mitigation**:
  - No special mitigation needed
  - Monitor for unexpected network traffic

### filesystem

- **Blast Radius**: Medium
- **Capabilities**: File management and code editing
- **Required Env**: None
- **Risk Surface**:
  - Can read/write/delete files within the project directory
  - Could modify configuration files or inject code
- **Mitigation**:
  - Restrict filesystem server to project directory only
  - Never grant access to home directory or system paths
  - Monitor for modifications to sensitive files (`.env`, config files)

### playwright

- **Blast Radius**: Medium
- **Capabilities**: Browser automation, web testing, UI interaction
- **Required Env**: None
- **Risk Surface**:
  - Can navigate to arbitrary URLs and interact with web pages
  - Could exfiltrate data through browser requests
  - Can capture screenshots of sensitive content
- **Mitigation**:
  - Restrict to localhost/staging URLs when possible
  - Block navigation to external domains in CI environments
  - Clear browser state between test runs

### brave-search

- **Blast Radius**: Low
- **Capabilities**: Web search, fact-checking, information retrieval
- **Required Env**: `BRAVE_API_KEY`
- **Risk Surface**:
  - Read-only web search
  - API key theft could exhaust quota
- **Mitigation**:
  - Use rate limiting on the API key
  - Monitor API usage for unusual patterns
- **Server choice**: The original reference package `@modelcontextprotocol/server-brave-search` is deprecated on npm ("Package no longer supported"). The canonical pack pins Brave's officially maintained `@brave/brave-search-mcp-server` instead (`--transport stdio`). If you supply your own Brave Search MCP server, confirm it is currently maintained and not on the deprecated list.

### sentry

- **Blast Radius**: Medium
- **Capabilities**: Error tracking, performance monitoring
- **Required Env**: `SENTRY_AUTH_TOKEN`
- **Risk Surface**:
  - Can read error details including stack traces with variable values
  - Stack traces may contain sensitive data (user IDs, file paths)
- **Mitigation**:
  - Configure Sentry data scrubbing rules
  - Use organization-scoped tokens with read-only permissions
  - Review what data appears in error reports

### postgres

- **Blast Radius**: Critical
- **Capabilities**: Database queries, schema inspection
- **Required Env**: `POSTGRES_URL`
- **Server choice**: The archived `@modelcontextprotocol/server-postgres` (deprecated on npm; Anthropic archived it 2025-05-29) is NOT used — Datadog documented a SQL-injection in it that bypasses the server's own read-only restriction, so a database-side read-only user is not sufficient protection on that server. The canonical pack pins the maintained `@henkey/postgres-mcp-server` instead. If you supply your own PostgreSQL MCP server, confirm it is currently maintained and not on the deprecated/archived list.
- **Risk Surface**:
  - Direct database access — can read, modify, or delete data
  - Connection string contains credentials
  - SQL injection risk if queries are constructed from agent input — and a server-level read-only flag can be bypassed by an injection bug in the server itself (the archived `server-postgres` CVE), so do not treat any single server-side restriction as the only line of defense
- **Mitigation**:
  - Scope access at the database, not just the server: connect with a role granted only `SELECT` on the specific schemas the agent needs (defense in depth that survives a server-side read-only bypass)
  - Never connect to production databases
  - Use connection pooling with query timeouts
  - Log all queries executed through the MCP server

### linear

- **Blast Radius**: Medium
- **Capabilities**: Issue tracking, project management
- **Required Env**: `LINEAR_API_KEY`
- **Risk Surface**:
  - Can read/modify issues, projects, and team configuration
  - API key provides broad workspace access
- **Mitigation**:
  - Create a dedicated service account with minimum permissions
  - Restrict to specific team if possible
  - Monitor audit logs for unexpected changes

## General Security Principles

1. **Least Privilege**: Configure each MCP server with the minimum permissions
   required for its intended use case.

2. **Credential Rotation**: Rotate all MCP server credentials on a regular
   schedule (recommendation: every 90 days).

3. **Environment Isolation**: Never share MCP credentials between development,
   staging, and production environments.

4. **Audit Logging**: Enable audit logging for all MCP servers that support it.
   Review logs for unexpected operations.

5. **Secret Management**: Store MCP credentials in `.env.mcp` (gitignored) or
   a secrets manager. Never commit credentials to version control. The `hatch3r
   validate` command scans `.env.mcp` for accidentally committed secrets.

6. **Network Segmentation**: In CI environments, restrict MCP server network
   access to only the services they need to reach.
