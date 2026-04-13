# MCP Server Blast Radius and Capability Guidance

Finding #83 (D15, High): Document MCP server blast radius with per-server capability guidance.

## Overview

MCP (Model Context Protocol) servers extend agent capabilities by connecting them
to external services. Each server introduces a specific **blast radius** — the
scope of damage that could occur if the server is compromised, misconfigured, or
misused by an agent.

This document provides per-server capability analysis and security guidance.

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
- **Risk Surface**:
  - Direct database access — can read, modify, or delete data
  - Connection string contains credentials
  - SQL injection risk if queries are constructed from agent input
- **Mitigation**:
  - Use a read-only database user for the MCP connection
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
