---
sidebar_position: 3
title: MCP Setup
---

# MCP Setup

How to connect hatch3r's MCP servers and manage secrets securely.

:::info Last verified
2026-06-11. Credential acquisition URLs and provider scope models reverified each audit cycle (P3 — Adapter & MCP Currency).
:::

## Overview

MCP is **opt-in**: interactive `hatch3r init` does not prompt for it. Enable it with `npx hatch3r init --mcp` on any init path, or `npx hatch3r mcp setup` at any time after init. Without an opt-in, no MCP config or `.env.mcp` is written and `features.mcp` stays false in the manifest.

hatch3r ships with 10 MCP servers: 3 pre-checked in the picker (no env vars required) and 7 requiring API keys (GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab). All secrets are centralized in a single `.env.mcp` file at the project root (gitignored by default). MCP configs use `${env:VAR}` placeholders so you never commit secrets.

## Supported MCP Servers

hatch3r supports 10 MCP servers. Three are enabled by default (no API keys required) and seven are opt-in (require environment variables).

**Default servers (no configuration needed):**

| Server | Description |
|--------|-------------|
| **Playwright** | Browser automation, web testing, and UI interaction |
| **Context7** | Up-to-date, version-specific library documentation for LLMs |
| **Filesystem** | File management and code editing operations |

**Opt-in servers (require API keys):**

| Server | Description | Required env vars |
|--------|-------------|-------------------|
| **GitHub** | Repository management, code review, issues, PRs, and project boards | `GITHUB_PAT` |
| **Azure DevOps** | Work items, repos, pipelines, and boards | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` |
| **GitLab** | Issues, merge requests, pipelines, and project management | `GITLAB_TOKEN` |
| **Brave Search** | Web research, fact-checking, and current information retrieval | `BRAVE_API_KEY` |
| **Sentry** | Error tracking and performance monitoring | `SENTRY_AUTH_TOKEN` |
| **Postgres** | PostgreSQL database queries and schema inspection | `POSTGRES_URL` |
| **Linear** | Linear issue tracking and project management | `LINEAR_API_KEY` |

The platform-specific MCP server (GitHub, Azure DevOps, or GitLab) is pre-selected in the picker based on your detected platform.

## Opting In to MCP

Interactive `npx hatch3r init` does not prompt for MCP. To enable it, run `npx hatch3r mcp setup` (or pass `--mcp` to any init invocation). The picker works as follows:

1. hatch3r detects your platform (GitHub, Azure DevOps, or GitLab) and pre-selects the matching platform MCP server
2. The three default servers (Playwright, Context7, Filesystem) are pre-checked
3. You can toggle any server on or off using the interactive checkbox prompt
4. After selection, hatch3r writes only the chosen servers to `.hatch3r/mcp/mcp.json` and sets `features.mcp` in the manifest (`true` only while at least one server is selected; `hatch3r mcp remove` maintains the same flag)

To change MCP servers later, run `npx hatch3r mcp setup` again — the picker is pre-populated with your current choices. `npx hatch3r config` offers the same selection behind its MCP gate.

## Where MCP Config Lives

When MCP is enabled, all adapters that support it emit tool-specific configuration during `npx hatch3r init --mcp`, `npx hatch3r mcp setup`, or `npx hatch3r sync`. The resolved MCP source is `.hatch3r/mcp/mcp.json`; each adapter transforms it into the format and path the tool expects.

| Tool | Config path | Format | Notes |
|------|-------------|--------|-------|
| Cursor | `.cursor/mcp.json` | JSON (direct copy) | Also reads `mcp.json` at project root if using the Cursor plugin |
| Claude Code | `.mcp.json` | JSON (direct copy) | Also generates `.claude/settings.json` with opinionated permissions |
| Copilot / VS Code | `.vscode/mcp.json` | JSON, `envFile` + `${input}` | STDIO env via `envFile` (`.env.mcp`); HTTP header secrets via `${input:NAME}` prompts |
| Codex | `.codex/config.toml` | TOML managed region | STDIO and Streamable HTTP; secrets become `env_vars`, `bearer_token_env_var`, or `env_http_headers` references |

## Connecting MCP Servers

### Cursor

1. Run `npx hatch3r mcp setup` (or `npx hatch3r init --mcp` on first init) and select MCP servers in the picker
2. Config is written to `.cursor/mcp.json` and secrets template to `.env.mcp`
3. Fill in your API keys in `.env.mcp` (see [Managing Secrets](#managing-secrets))
4. **Restart Cursor** for changes to take effect
5. In Cursor: Settings -> Tools & MCP -- verify servers show a green dot

If using the Cursor plugin, the plugin provides `mcp.json` at the project root. Cursor loads project-level config from `.cursor/mcp.json` (takes precedence over global `~/.cursor/mcp.json`).

### Claude Code

Config goes to `.mcp.json`. Claude Code reads it from the project root. Fill in `.env.mcp`, source it, and restart Claude Code after enabling MCP.

### Codex

Config is merged into `.codex/config.toml`. Fill in `.env.mcp`, export those variables before launching Codex, and trust the project before expecting project-scoped config to load. Hatcher preserves user TOML outside its managed region and refuses user-owned MCP table-name collisions. Secret-sensitive keys require exact environment-variable indirection; credential-bearing URLs, private-key material, and literal credentials are rejected. Literal STDIO environment values and HTTP headers are limited to validated non-secret protocol fields such as `MODE`, `PORT`, `Accept`, and `X-MCP-Toolsets`. See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Other Hosts

See the [Adapter Capability Matrix](../reference/adapter-capability-matrix) for per-tool output paths.

## Managing Secrets

### The `.env.mcp` file

`hatch3r init` generates a `.env.mcp` file at the project root containing every environment variable your selected MCP servers need. This file is covered by `.gitignore` (the `.env.*` pattern) and must never be committed.

```bash
# .env.mcp (generated by hatch3r init)
GITHUB_PAT=ghp_xxxxxxxxxxxx
BRAVE_API_KEY=xxxxxxxx
```

When you add new MCP servers and run `hatch3r init` or `hatch3r sync`, any new variables are appended to `.env.mcp` without overwriting existing values.

### How secrets are loaded per editor

**VS Code / Copilot** -- STDIO servers auto-load env from `.env.mcp` via each entry's `envFile` field (VS Code does not shell-expand an inline `env` object). HTTP-transport servers (e.g. the remote GitHub server) send their secret in a header; VS Code does not read header secrets from `.env.mcp`, so those are prompted via `${input:NAME}` variables on first use and cached by VS Code.

**Cursor** -- Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && cursor .
```

Alternatively, add your tokens to `~/.zshrc` / `~/.bashrc` for persistent access, or paste them in Cursor: Settings -> Tools & MCP -> pencil icon next to each server.

**Claude Code** -- Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && claude
```

**Other editors** -- Same sourcing pattern. See the [Adapter Capability Matrix](../reference/adapter-capability-matrix#secret-management) for per-tool details.

### Required environment variables

#### Default servers

| Server | Env var | How to get it |
|--------|---------|---------------|
| **GitHub** | `GITHUB_PAT` | [Create a PAT](https://github.com/settings/tokens/new) -- see [GitHub PAT scopes](#github-pat-scopes) |
| **Brave Search** | `BRAVE_API_KEY` | [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register) -- see [Brave Search pricing notes](#brave-search-pricing-notes) |

#### Opt-in servers (enable during init)

| Server | Env var | How to get it |
|--------|---------|---------------|
| Sentry | `SENTRY_AUTH_TOKEN` | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) -- see [Sentry token types](#sentry-token-types) |
| Postgres | `POSTGRES_URL` | Your PostgreSQL connection string |
| Linear | `LINEAR_API_KEY` | [Linear API keys](https://linear.app/settings/api) -- OAuth 2.0 also supported, see [Linear authentication](#linear-authentication) |
| Azure DevOps | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) -- see [Azure DevOps authentication notes](#azure-devops-authentication-notes) |
| GitLab | `GITLAB_TOKEN` | [Create a PAT](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) -- see [GitLab token alternatives](#gitlab-token-alternatives) |

### GitHub PAT scopes {#github-pat-scopes}

**Classic PAT** (Settings -> Developer settings -> Personal access tokens -> Tokens (classic)):
- `repo` -- full control of private repositories (read/write code, issues, PRs)
- `read:org` -- read org and team membership (needed for org projects)
- `project` -- read/write access to GitHub Projects V2 (required for board commands `hatch3r-board-fill`, `hatch3r-board-pickup` and board skills `hatch3r-board-init`, `hatch3r-board-groom`, `hatch3r-board-refresh`)

**Fine-grained PAT** (recommended):

| Permission | Access | Required for |
|------------|--------|-------------|
| Contents | Read and write | Code, file operations |
| Issues | Read and write | Issue creation, labeling, assignment |
| Pull requests | Read and write | PR creation, review, merge |
| Projects | Read and write | Board commands and skills (`hatch3r-board-fill`, `hatch3r-board-init`, etc.) |
| Metadata | Read | Repository metadata (auto-granted) |
| Members (Organization) | Read | Org projects and team membership |

Fine-grained tokens have [limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations) (e.g. user-owned Projects V2 may require classic PATs).

**Note:** If board commands fail with GraphQL permission errors, the most likely cause is a missing `project` scope. For classic PATs, add the `project` scope. For fine-grained PATs, ensure Projects has read and write access. You can also run `gh auth refresh -s project` if using the GitHub CLI.

**User-owned Projects V2 caveat:** As of 2026, fine-grained PATs still cannot access Projects V2 owned by a user account (only org-owned projects). For board commands targeting a user-owned project, use a classic PAT with the `project` scope.

### Brave Search pricing notes {#brave-search-pricing-notes}

Brave retired the free tier of its Search API in 2026 and moved every account onto credit-based billing.

- **New users** receive $5 in credits each month (~1,000 web search queries at $5 / 1,000 requests). A credit card is required at sign-up as an anti-fraud measure even for credit-only usage.
- **Legacy users** who were on the original 2,000 queries / month free plan are grandfathered to that allowance.
- Sign up at [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register). The older `brave.com/search/api/` URL still works but redirects to the dashboard for key creation.
- Paid tiers: Basic ($5 / 20k queries), Starter ($20 / 100k), Standard ($40 / 500k), Enterprise (custom).

### Sentry token types {#sentry-token-types}

Sentry supports two auth-token types:

- **User Auth Tokens** ([sentry.io/settings/account/api/auth-tokens/](https://sentry.io/settings/account/api/auth-tokens/)) — tied to your personal account. Best for individual MCP use.
- **Organization Auth Tokens** (Org Settings → Auth Tokens) — tied to the org rather than a single user. Recommended for shared / CI / production use because they survive personnel changes.

For MCP, set `SENTRY_AUTH_TOKEN` to whichever token matches your scope. Read scopes (`org:read`, `project:read`, `event:read`) are sufficient for the read-only error / performance views the Sentry MCP server exposes.

### Linear authentication {#linear-authentication}

Linear supports two auth methods for the API used by the MCP server:

- **Personal API keys** ([linear.app/settings/api](https://linear.app/settings/api)) — quickest to set up, good for individual / single-user MCP. Set `LINEAR_API_KEY` to the generated key.
- **OAuth 2.0** — recommended for shared installations, multi-user products, or anything that needs to act on behalf of multiple Linear accounts. Use `OAuth actor authorization` for integration scenarios.

For the typical single-developer MCP setup, the personal API key is the right call.

### Azure DevOps authentication notes {#azure-devops-authentication-notes}

Microsoft now actively recommends Microsoft Entra ID tokens, managed identities, or service principals over PATs (PATs are flagged in the Microsoft Learn docs as "long-lived credentials [that] can be leaked, stolen, or misused"). PATs still work for hatch3r MCP today, but be aware:

- For Microsoft Entra-backed organizations, you must sign in to Azure DevOps via the full auth flow at least every 90 days for your PAT to remain active.
- Tokens are 84 characters long and include a fixed `AZDO` signature at positions 76–80 — useful for secret-scanning rules.
- Microsoft also publishes an Azure DevOps MCP Server (`/azure/devops/mcp-server/mcp-server-overview`); hatch3r ships the `@tiberriver256/mcp-server-azure-devops` STDIO server today, but the official server is an alternative if you prefer Microsoft-maintained tooling.

For least-privilege automation, see Microsoft's guidance on [reducing PAT usage](https://devblogs.microsoft.com/devops/reducing-pat-usage-across-azure-devops/).

### GitLab token alternatives {#gitlab-token-alternatives}

Personal access tokens are the simplest path for individual MCP use, but for automation contexts GitLab offers narrower-scope alternatives:

- **Project Access Tokens** — bound to a single project, no human user account needed; preferred for project-specific automation.
- **Group Access Tokens** — same idea at the group level.
- **CI/CD Job Tokens** — fine-grained permissions scoped to a pipeline run; preferred for pipeline-driven workflows.

For self-hosted GitLab, also set `GITLAB_HOST=https://gitlab.example.com` in `.env.mcp`.

### Verifying connection

1. Restart your editor after setting secrets
2. Check MCP status: Cursor shows green dots in Settings -> Tools & MCP
3. In chat/composer, check "Available Tools" -- you should see tools from each enabled server

## Server Details

| Server | Type | Requires | Notes |
|--------|------|----------|-------|
| **GitHub** | Remote | `GITHUB_PAT` | `https://api.githubcopilot.com/mcp/` with `X-MCP-Toolsets` |
| **Context7** | STDIO | -- | Up-to-date library docs |
| **Filesystem** | STDIO | -- | Uses `.` (project root) as allowed directory |
| **Playwright** | STDIO | -- | Browser automation |
| **Brave Search** | STDIO | `BRAVE_API_KEY` | Web research and fact-checking |
| **Sentry** | STDIO | `SENTRY_AUTH_TOKEN` | Error tracking and performance monitoring |
| **Postgres** | STDIO | `POSTGRES_URL` | Database queries and schema inspection |
| **Linear** | STDIO | `LINEAR_API_KEY` | Issue tracking and project management |
| **Azure DevOps** | STDIO | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | Boards, work items, repos |
| **GitLab** | STDIO | `GITLAB_TOKEN` | Issues, merge requests, boards |

## How MCP Config Is Distributed to Adapters

During `hatch3r init` or `hatch3r sync`, the resolved MCP config at `.hatch3r/mcp/mcp.json` is transformed into tool-specific formats for each selected adapter. The process works as follows:

1. **Resolved source** -- `.hatch3r/mcp/mcp.json` contains the `mcpServers` object with only the servers you selected during init
2. **Adapter transformation** -- each adapter reads the canonical config and writes it to the tool-specific path and format
3. **Secret indirection** -- adapters translate placeholders into their supported environment-reference syntax. Literal secret values are never emitted into Codex TOML

The adapter capability matrix determines which adapters emit MCP config:

| Adapter | Emits MCP | Output path | Format notes |
|---------|-----------|-------------|--------------|
| Cursor | Yes | `.cursor/mcp.json` | Direct JSON copy |
| Claude Code | Yes | `.mcp.json` | Direct JSON copy |
| Copilot / VS Code | Yes | `.vscode/mcp.json` | STDIO env via `envFile`; HTTP header secrets via `${input:NAME}` |
| Codex | Yes | `.codex/config.toml` | STDIO `env_vars`; HTTP `bearer_token_env_var` / `env_http_headers`; Streamable HTTP only (SSE rejected) |

All four supported adapters emit MCP config. When you run `hatch3r sync` or `hatch3r config`, each adapter projects the same selected server set into its platform format; unsupported transport details fail closed instead of being guessed.

## Adding Custom MCP Servers

You can add custom MCP servers by editing `.hatch3r/mcp/mcp.json` directly. Add your server definition to the `mcpServers` object:

```json
{
  "mcpServers": {
    "playwright": { "..." : "..." },
    "context7": { "..." : "..." },
    "my-custom-server": {
      "command": "npx",
      "args": ["-y", "@my-org/my-mcp-server"],
      "env": {
        "MY_API_KEY": "${env:MY_API_KEY}"
      }
    }
  }
}
```

After adding a custom server:

1. Add any required environment variables to `.env.mcp`
2. Run `npx hatch3r sync` to propagate the config to all adapter output paths
3. Restart your editor for changes to take effect

Custom servers persist across `hatch3r sync` and `hatch3r update` operations. However, `hatch3r init` regenerates `mcp.json` from the template -- if you re-run init, your custom servers will need to be re-added.

:::info MCP version-pin check (1.6.0)
`npx hatch3r validate` warns on unpinned `npx @scope/pkg` invocations and `@latest` tags in MCP server configs — both are supply-chain risks (per Palo Alto Networks' 2025 npm supply-chain attack report and OWASP ASI 2026). Pin to a specific version or SHA to clear the warning.
:::

:::tip
For remote (HTTP-based) MCP servers, use the `url` and `headers` fields instead of `command`/`args`:

```json
{
  "my-remote-server": {
    "url": "https://my-api.example.com/mcp/",
    "headers": {
      "Authorization": "Bearer ${env:MY_API_TOKEN}"
    }
  }
}
```
:::
