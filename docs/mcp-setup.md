# MCP Setup Guide

How to connect hatch3r's MCP servers and manage secrets securely.

> **Last verified:** 2026-06-11. Credential acquisition URLs and provider scope models reverified each audit cycle (P3 — Adapter & MCP Currency).

## Overview

MCP is **opt-in**: interactive `hatch3r init` does not prompt for it. Enable it with `npx hatch3r init --mcp` on any init path, or `npx hatch3r mcp setup` at any time after init. Without an opt-in, no MCP config or `.env.mcp` is written and `features.mcp` stays false in the manifest.

hatch3r supports three platforms — **GitHub**, **Azure DevOps**, and **GitLab** — each with its own MCP server for board management, issue tracking, and code operations. When you open the MCP picker, the server matching your detected platform is pre-selected.

hatch3r ships with 10 MCP servers: 3 pre-checked in the picker (no env vars required) and 7 opt-in servers (GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab). All secrets are centralized in a single `.env.mcp` file at the project root (gitignored by default). MCP configs use `${env:VAR}` placeholders so you never commit secrets.

## Where MCP Config Lives

When MCP is enabled, all adapters that support it emit tool-specific configuration during `npx hatch3r init --mcp`, `npx hatch3r mcp setup`, or `npx hatch3r sync`. The MCP source is the bundled `mcp/mcp.json` (defaults), resolved into `.hatch3r/mcp/mcp.json` for your project; each adapter transforms it into the format and path the tool expects.

| Tool | Config path | Format | Notes |
|------|-------------|--------|-------|
| Cursor | `.cursor/mcp.json` | JSON (direct copy) | Also reads `mcp.json` at project root if using the Cursor plugin |
| Claude Code | `.mcp.json` | JSON (direct copy) | Also generates `.claude/settings.json` with opinionated permissions (see [Claude Code Permissions](#claude-code-permissions)) |
| Copilot / VS Code | `.vscode/mcp.json` | JSON, `envFile` + `${input}` | STDIO env via `envFile` (`.env.mcp`); HTTP header secrets via `${input:NAME}` prompts |
| Codex | `.codex/config.toml` | TOML managed region | STDIO and Streamable HTTP; secrets use environment-variable references |

## Connecting MCP Servers

### Cursor

1. Run `npx hatch3r mcp setup` (or `npx hatch3r init --mcp` on first init) and select MCP servers in the picker.
2. Config is written to `.cursor/mcp.json` and secrets template to `.env.mcp`.
3. Fill in your API keys in `.env.mcp` (see [Managing Secrets](#managing-secrets)).
4. **Restart Cursor** for changes to take effect.
5. In Cursor: Settings → Tools & MCP — verify servers show a green dot.

If using the Cursor plugin, the plugin provides `mcp.json` at the project root. Cursor loads project-level config from `.cursor/mcp.json` (takes precedence over global `~/.cursor/mcp.json`).

### Claude Code

Config goes to `.mcp.json`. Claude Code reads it from the project root. Fill in `.env.mcp`, source it, and restart Claude Code after enabling MCP. hatch3r also writes `.claude/settings.json` with opinionated tool permissions — see [Claude Code Permissions](#claude-code-permissions).

### Copilot / VS Code

Config goes to `.vscode/mcp.json`. STDIO server env auto-loads from `.env.mcp` via each entry's `envFile` field (VS Code does not shell-expand an `env` object). HTTP-transport servers (e.g. the remote GitHub server) carry their secret in a header, which VS Code does not read from `.env.mcp` — those are prompted via `${input:NAME}` variables on first use.

### Codex

Config is merged into `.codex/config.toml`. Export `.env.mcp` variables before launching Codex and trust the project so project-scoped config loads. Hatcher maps STDIO secrets to `env_vars` and HTTP secrets to `bearer_token_env_var` or `env_http_headers`; secret-sensitive keys require exact environment-variable indirection, and credential-bearing URLs, private-key material, and literal credentials are rejected. Literal STDIO environment values and HTTP headers are limited to a small set of validated non-secret protocol fields such as `MODE`, `PORT`, `Accept`, and `X-MCP-Toolsets`. See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

All four supported adapters emit MCP configuration natively. See [adapter-capability-matrix.md](adapter-capability-matrix.md) for the full per-tool capability breakdown.

## Claude Code Permissions

When the `claude` tool is enabled, hatch3r generates `.claude/settings.json` with opinionated default permissions:

```json
{
  "permissions": {
    "allow": ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"],
    "deny": []
  },
  "teammateMode": "tool-using"
}
```

These defaults enable common file-operation tools so Claude Code can work without repeated permission prompts. They are **opinionated starting points**, not security boundaries — you can customize them:

- **To restrict:** Add tool names to the `deny` array or remove them from `allow`.
- **To grant more:** Add tool names like `"Bash"` or `"WebFetch"` to `allow`.
- **To override entirely:** Edit `.claude/settings.json` after running `hatch3r sync`. The file is regenerated on sync, so persist changes by modifying the Claude adapter or using a post-sync script.

If hooks are enabled, the `hooks` key is also added to this file with Claude-specific event mappings.

---

## Managing Secrets

### The `.env.mcp` file

When you opt in to MCP (`hatch3r init --mcp` or `hatch3r mcp setup`), hatch3r generates a `.env.mcp` file at the project root containing every environment variable your selected MCP servers need. This file is covered by `.gitignore` (the `.env.*` pattern) and must never be committed.

```bash
# .env.mcp (generated when MCP is opted in)
GITHUB_PAT=ghp_xxxxxxxxxxxx
BRAVE_API_KEY=xxxxxxxx
```

When you add new MCP servers (e.g. via `hatch3r mcp setup`), any new variables are appended to `.env.mcp` without overwriting existing values.

### How secrets are loaded per editor

**VS Code / Copilot** — STDIO servers auto-load env from `.env.mcp` via each entry's `envFile` field (VS Code does not shell-expand an inline `env` object). HTTP-transport servers (e.g. the remote GitHub server) send their secret in a header; VS Code does not read header secrets from `.env.mcp`, so those are prompted via `${input:NAME}` variables on first use and cached by VS Code.

**Cursor** — Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && cursor .
```

Alternatively, add your tokens to `~/.zshrc` / `~/.bashrc` for persistent access, or paste them in Cursor: Settings → Tools & MCP → pencil icon next to each server.

**Claude Code** — Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && claude
```

See [adapter-capability-matrix.md](adapter-capability-matrix.md#secret-management) for per-tool details.

### Required environment variables

#### Default servers (no env vars required)

Playwright, Context7, and Filesystem are pre-checked in the MCP picker and require no configuration.

#### Opt-in servers (enable via `hatch3r mcp setup` or `init --mcp`)

| Server | Env var | How to get it |
|--------|---------|---------------|
| **GitHub** | `GITHUB_PAT` | [Create a PAT](https://github.com/settings/tokens/new) — see [GitHub PAT scopes](#github-pat-scopes) below |
| **Azure DevOps** | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) — see [Azure DevOps PAT scopes](#azure-devops-pat-scopes) below |
| **GitLab** | `GITLAB_TOKEN` | [Create a PAT](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) — see [GitLab token scopes](#gitlab-token-scopes) below |
| **Brave Search** | `BRAVE_API_KEY` | [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register) — see [Brave Search pricing notes](#brave-search-pricing-notes) below |
| Sentry | `SENTRY_AUTH_TOKEN` | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) — see [Sentry token types](#sentry-token-types) below |
| Postgres | `POSTGRES_URL` | Your PostgreSQL connection string |
| Linear | `LINEAR_API_KEY` | [Linear API keys](https://linear.app/settings/api) — OAuth 2.0 also supported, see [Linear authentication](#linear-authentication) below |

### GitHub PAT scopes

For the remote GitHub MCP server (`X-MCP-Toolsets`: repos, issues, pull_requests). Board commands additionally need the `project` PAT scope below — it is consumed by the `hatch3r-board-*` gh-CLI path, not by the MCP toolset (the shipped header does not enable `projects`):

**Classic PAT** (Settings → Developer settings → Personal access tokens → Tokens (classic)):
- `repo` — full control of private repositories (read/write code, issues, PRs)
- `read:org` — read org and team membership (needed for org projects)
- `project` — read/write access to GitHub Projects V2 (required for board commands `hatch3r-board-fill`, `hatch3r-board-pickup` and board skills `hatch3r-board-init`, `hatch3r-board-groom`, `hatch3r-board-refresh`)

**Fine-grained PAT** (recommended):

| Permission | Access | Required for |
|------------|--------|-------------|
| Contents | Read and write | Code, file operations |
| Issues | Read and write | Issue creation, labeling, assignment |
| Pull requests | Read and write | PR creation, review, merge |
| Projects | Read and write | Board commands and skills (`hatch3r-board-fill`, `hatch3r-board-init`, etc.) |
| Metadata | Read | Repository metadata (auto-granted) |
| Members (Organization) | Read | Org projects and team membership |

Fine-grained tokens have [limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations) (e.g. user-owned Projects V2 may require classic PATs); classic may be required for some workflows.

**Note:** `read:packages` is only needed when running the GitHub MCP server locally via Docker. hatch3r uses the remote server, so you do not need it.

**Note:** If board commands fail with GraphQL permission errors, the most likely cause is a missing `project` scope. For classic PATs, add the `project` scope. For fine-grained PATs, grant Projects read and write access. You can also run `gh auth refresh -s project` if using the GitHub CLI.

**User-owned Projects V2 caveat:** As of 2026, fine-grained PATs still cannot access Projects V2 owned by a user account (only org-owned projects). For board commands targeting a user-owned project, use a classic PAT with the `project` scope.

### Brave Search pricing notes

Brave retired the free tier of its Search API in 2026 and moved every account onto credit-based billing.

- **New users** receive $5 in credits each month (~1,000 web search queries at $5 / 1,000 requests). A credit card is required at sign-up as an anti-fraud measure even for credit-only usage.
- **Legacy users** who were on the original 2,000 queries / month free plan are grandfathered to that allowance.
- Sign up at [api-dashboard.search.brave.com/register](https://api-dashboard.search.brave.com/register). The older `brave.com/search/api/` URL still works but redirects to the dashboard for key creation.
- Paid tiers: Basic ($5 / 20k queries), Starter ($20 / 100k), Standard ($40 / 500k), Enterprise (custom).

### Sentry token types

Sentry supports two auth-token types:

- **User Auth Tokens** ([sentry.io/settings/account/api/auth-tokens/](https://sentry.io/settings/account/api/auth-tokens/)) — tied to your personal account. Best for individual MCP use.
- **Organization Auth Tokens** (Org Settings → Auth Tokens) — tied to the org rather than a single user. Recommended for shared / CI / production use because they survive personnel changes.

For MCP, set `SENTRY_AUTH_TOKEN` to whichever token matches your scope. Read scopes (`org:read`, `project:read`, `event:read`) are sufficient for the read-only error / performance views the Sentry MCP server exposes.

### Linear authentication

Linear supports two auth methods for the API used by the MCP server:

- **Personal API keys** ([linear.app/settings/api](https://linear.app/settings/api)) — quickest to set up, good for individual / single-user MCP. Set `LINEAR_API_KEY` to the generated key.
- **OAuth 2.0** — recommended for shared installations, multi-user products, or anything that needs to act on behalf of multiple Linear accounts.

For the typical single-developer MCP setup, the personal API key is the right call.

### Azure DevOps PAT scopes

For the Azure DevOps MCP server (`@tiberriver256/mcp-server-azure-devops`):

1. Go to `https://dev.azure.com/{org}/_usersSettings/tokens` and create a new PAT
2. Grant the following scopes:

| Scope | Access | Required for |
|-------|--------|-------------|
| Work Items | Read & Write | Board commands, issue creation, status updates |
| Code | Read & Write | Repository operations, PR creation |
| Build | Read | CI/CD status checks |
| Project and Team | Read | Project metadata, team membership |

3. Add to `.env.mcp`:

```bash
AZURE_DEVOPS_PAT=your-pat-here
AZURE_DEVOPS_ORG=your-organization-name
```

**Authentication notes (2026):** Microsoft now actively recommends Microsoft Entra ID tokens, managed identities, or service principals over PATs (the Microsoft Learn docs flag PATs as "long-lived credentials [that] can be leaked, stolen, or misused"). PATs still work for hatch3r MCP today, but be aware:

- For Microsoft Entra-backed organizations, you must sign in to Azure DevOps via the full auth flow at least every 90 days for your PAT to remain active.
- Tokens are 84 characters long and include a fixed `AZDO` signature at positions 76–80 — useful for secret-scanning rules.
- Microsoft also publishes an Azure DevOps MCP Server (`/azure/devops/mcp-server/mcp-server-overview`); hatch3r ships the `@tiberriver256/mcp-server-azure-devops` STDIO server today, but the official server is an alternative if you prefer Microsoft-maintained tooling.

For least-privilege automation, see Microsoft's guidance on [reducing PAT usage](https://devblogs.microsoft.com/devops/reducing-pat-usage-across-azure-devops/).

### GitLab token scopes

For the GitLab MCP server (`glab mcp serve`):

1. Go to Settings → Access Tokens → [Personal Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens)
2. Create a token with the `api` scope (grants full API access including issues, merge requests, and boards)
3. Add to `.env.mcp`:

```bash
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
```

For self-hosted GitLab instances, also set `GITLAB_HOST`:

```bash
GITLAB_HOST=https://gitlab.example.com
```

**Token alternatives for automation:** Personal access tokens are the simplest path for individual MCP use, but for automation contexts GitLab offers narrower-scope alternatives:

- **Project Access Tokens** — bound to a single project, no human user account needed; preferred for project-specific automation.
- **Group Access Tokens** — same idea at the group level.
- **CI/CD Job Tokens** — fine-grained permissions scoped to a pipeline run; preferred for pipeline-driven workflows.

### Verifying connection

1. Restart your editor after setting secrets.
2. Check MCP status: Cursor shows green dots in Settings → Tools & MCP.
3. In chat/composer, check "Available Tools" — you should see tools from each enabled server.

## Server details

> **Transport trust floor.** GitHub uses HTTP transport (TLS + a fine-grained PAT); the other nine servers use STDIO transport, which carries **no authentication or encryption** and runs the server as a child process with the editor's full privileges. STDIO is not "safer" than HTTP because it has no `url:` — see [mcp-server-blast-radius.md → MCP transport trust model](mcp-server-blast-radius.md#mcp-transport-trust-model) for the per-transport security floors.

- **GitHub** — Remote server at `https://api.githubcopilot.com/mcp/`. Uses `X-MCP-Toolsets` for repos, issues, pull_requests. `projects` is deliberately excluded from the shipped header as a high-blast-radius toolset (see [mcp-server-blast-radius.md](mcp-server-blast-radius.md)); board Projects V2 runs through the `hatch3r-board-*` gh-CLI path (the `project` PAT scope below), so to drive Projects V2 through MCP instead an operator must add `projects` to `X-MCP-Toolsets` in their own MCP config.
- **Azure DevOps** — STDIO server via `@tiberriver256/mcp-server-azure-devops`. Requires `AZURE_DEVOPS_PAT` and `AZURE_DEVOPS_ORG`.
- **GitLab** — STDIO server via `glab mcp serve` (requires the GitLab CLI; `glab mcp` alone prints help). Requires `GITLAB_TOKEN`. Supports self-hosted instances via `GITLAB_HOST`.
- **Context7** — No secrets. Fetches up-to-date library docs.
- **Filesystem** — No secrets. Uses `.` (project root) as the allowed directory.
- **Playwright** — No secrets. Browser automation.
- **Brave Search** — Requires `BRAVE_API_KEY`.
