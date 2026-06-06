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

## Tool-poisoning mitigation: `_description` strip

Tool poisoning ([Invariant Labs, 2025](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)) plants attacker-controlled instructions inside an MCP server's tool/description metadata so the editor renders them into the agent's context. hatch3r blocks this at adapter emission: `BaseAdapter.readFilteredMcp` (`src/adapters/base.ts` → `const { _disabled, _description, ...clean } = entry;`) destructures `_description` out of every entry, so the field is **never written** to any generated `.mcp.json` / `.cursor/mcp.json` / `.vscode/mcp.json`.

This is a positive control, not a best-effort scan: even a poisoned description that survives the sync-time deny-pattern scan (`src/pipeline/mcpDescriptionScan.ts`, which only warns) and canonical-file review cannot reach the editor's tool-description display surface, because the adapter output carries no description field at all. A contributor refactoring `readFilteredMcp` must preserve the `_description` strip — re-including the field would silently re-open the tool-poisoning display surface this control closes.

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
