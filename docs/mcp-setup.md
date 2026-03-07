# MCP Setup Guide

How to connect hatch3r's MCP servers and manage secrets securely.

## Overview

hatch3r supports three platforms — **GitHub**, **Azure DevOps**, and **GitLab** — each with its own MCP server for board management, issue tracking, and code operations. Platform-specific MCP servers are configured automatically during `hatch3r init` based on your selected platform.

hatch3r ships with 10 MCP servers: 3 enabled by default (no env vars required) and 7 opt-in servers (GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab). All secrets are centralized in a single `.env.mcp` file at the project root (gitignored by default). MCP configs use `${env:VAR}` placeholders so you never commit secrets.

## Where MCP Config Lives

All adapters that support MCP emit tool-specific configuration during `npx hatch3r init` or `npx hatch3r sync`. The canonical MCP source is `.agents/mcp/mcp.json`; each adapter transforms it into the format and path the tool expects.

| Tool | Config path | Format | Notes |
|------|-------------|--------|-------|
| Cursor | `.cursor/mcp.json` | JSON (direct copy) | Also reads `mcp.json` at project root if using the Cursor plugin |
| Claude Code | `.mcp.json` | JSON (direct copy) | Also generates `.claude/settings.json` with opinionated permissions (see [Claude Code Permissions](#claude-code-permissions)) |
| Copilot / VS Code | `.vscode/mcp.json` | JSON with `envFile` | Adds `envFile: "${workspaceFolder}/.env.mcp"` per STDIO server for native secret loading |
| OpenCode | `opencode.json` | JSON (inline) | MCP servers embedded in the top-level config under `mcp` key |
| Windsurf | `.windsurf/mcp.json` | JSON | Standard `mcpServers` format |
| Amp | `.amp/settings.json` | JSON | MCP servers under `amp.mcpServers` key |
| Codex | `.codex/config.toml` | TOML | MCP servers as `[mcp_servers.<name>]` sections |
| Gemini | `.gemini/settings.json` | JSON | MCP servers under `mcpServers` key alongside context and hooks |
| Cline / Roo | `.roo/mcp.json` | JSON | Standard `mcpServers` format; remote servers use `streamable-http` transport |
| Kiro | `.kiro/settings/mcp.json` | JSON | Standard `mcpServers` format |

## Connecting MCP Servers

### Cursor

1. Run `npx hatch3r init` and select MCP servers when prompted.
2. Config is written to `.cursor/mcp.json` and secrets template to `.env.mcp`.
3. Fill in your API keys in `.env.mcp` (see [Managing Secrets](#managing-secrets)).
4. **Restart Cursor** for changes to take effect.
5. In Cursor: Settings → Tools & MCP — verify servers show a green dot.

If using the Cursor plugin, the plugin provides `mcp.json` at the project root. Cursor loads project-level config from `.cursor/mcp.json` (takes precedence over global `~/.cursor/mcp.json`).

### Claude Code

Config goes to `.mcp.json`. Claude Code reads it from the project root. Fill in `.env.mcp`, source it, and restart Claude Code after init. hatch3r also writes `.claude/settings.json` with opinionated tool permissions — see [Claude Code Permissions](#claude-code-permissions).

### Copilot / VS Code

Config goes to `.vscode/mcp.json`. Unlike other tools, the Copilot adapter adds `envFile: "${workspaceFolder}/.env.mcp"` to each STDIO server entry, so VS Code loads secrets natively without sourcing `.env.mcp` in the shell.

### OpenCode

MCP servers are embedded directly in `opencode.json` under the `mcp` key. STDIO servers use `type: "local"` with a combined `command` array; remote servers use `type: "remote"`. Source `.env.mcp` before launching.

### Windsurf

Config goes to `.windsurf/mcp.json` using the standard `mcpServers` format. Source `.env.mcp` before launching Windsurf.

### Amp

MCP config is written to `.amp/settings.json` under the `amp.mcpServers` key. Source `.env.mcp` before launching.

### Codex

MCP servers are written as `[mcp_servers.<name>]` sections in `.codex/config.toml`. Environment variables are specified as `env.<KEY>` entries.

### Gemini

Config goes to `.gemini/settings.json` under the `mcpServers` key. Source `.env.mcp` before launching.

### Cline / Roo Code

Config goes to `.roo/mcp.json` using the standard `mcpServers` format. Remote servers are configured with `streamable-http` transport.

### Kiro

Config goes to `.kiro/settings/mcp.json` using the standard `mcpServers` format.

### Other tools

Tools without native MCP support (aider, goose, zed) do not emit MCP configuration. See [adapter-capability-matrix.md](adapter-capability-matrix.md) for the full per-tool capability breakdown.

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

`hatch3r init` generates a `.env.mcp` file at the project root containing every environment variable your selected MCP servers need. This file is covered by `.gitignore` (the `.env.*` pattern) and must never be committed.

```bash
# .env.mcp (generated by hatch3r init)
GITHUB_PAT=ghp_xxxxxxxxxxxx
BRAVE_API_KEY=xxxxxxxx
```

When you add new MCP servers and run `hatch3r init` or `hatch3r sync`, any new variables are appended to `.env.mcp` without overwriting existing values.

### How secrets are loaded per editor

**VS Code / Copilot** — Secrets load automatically. The generated `.vscode/mcp.json` includes `envFile: "${workspaceFolder}/.env.mcp"` on every STDIO server, so VS Code reads the file natively. No sourcing needed.

**Cursor** — Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && cursor .
```

Alternatively, add your tokens to `~/.zshrc` / `~/.bashrc` for persistent access, or paste them in Cursor: Settings → Tools & MCP → pencil icon next to each server.

**Claude Code** — Source `.env.mcp` before launching:

```bash
set -a && source .env.mcp && set +a && claude
```

**Other editors** — Same sourcing pattern. See [adapter-capability-matrix.md](adapter-capability-matrix.md#secret-management) for per-tool details.

### Required environment variables

#### Default servers (no env vars required)

Playwright, Context7, and Filesystem are enabled by default and require no configuration.

#### Opt-in servers (enable during init)

| Server | Env var | How to get it |
|--------|---------|---------------|
| **GitHub** | `GITHUB_PAT` | [Create a PAT](https://github.com/settings/tokens/new) — see [GitHub PAT scopes](#github-pat-scopes) below |
| **Azure DevOps** | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) — see [Azure DevOps PAT scopes](#azure-devops-pat-scopes) below |
| **GitLab** | `GITLAB_TOKEN` | [Create a PAT](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) — see [GitLab token scopes](#gitlab-token-scopes) below |
| **Brave Search** | `BRAVE_API_KEY` | [Brave Search API](https://brave.com/search/api/) — free tier: 2,000 queries/month |
| Sentry | `SENTRY_AUTH_TOKEN` | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) |
| Postgres | `POSTGRES_URL` | Your PostgreSQL connection string |
| Linear | `LINEAR_API_KEY` | [Linear API keys](https://linear.app/settings/api) |

### GitHub PAT scopes

For the remote GitHub MCP server (repos, issues, pull_requests, projects):

**Classic PAT** (Settings → Developer settings → Personal access tokens → Tokens (classic)):
- `repo` — full control of private repositories (read/write code, issues, PRs)
- `read:org` — read org and team membership (needed for org projects)
- `project` — read/write access to GitHub Projects V2 (required for board commands: `hatch3r-board-init`, `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`)

**Fine-grained PAT** (recommended):

| Permission | Access | Required for |
|------------|--------|-------------|
| Contents | Read and write | Code, file operations |
| Issues | Read and write | Issue creation, labeling, assignment |
| Pull requests | Read and write | PR creation, review, merge |
| Projects | Read and write | Board commands (`hatch3r-board-init`, etc.) |
| Metadata | Read | Repository metadata (auto-granted) |
| Members (Organization) | Read | Org projects and team membership |

Fine-grained tokens have [limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations) (e.g. user-owned Projects V2 may require classic PATs); classic may be required for some workflows.

**Note:** `read:packages` is only needed when running the GitHub MCP server locally via Docker. hatch3r uses the remote server, so you do not need it.

**Note:** If board commands fail with GraphQL permission errors, the most likely cause is a missing `project` scope. For classic PATs, add the `project` scope. For fine-grained PATs, ensure Projects has read and write access. You can also run `gh auth refresh -s project` if using the GitHub CLI.

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

### GitLab token scopes

For the GitLab MCP server (`glab mcp`):

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

### Verifying connection

1. Restart your editor after setting secrets.
2. Check MCP status: Cursor shows green dots in Settings → Tools & MCP.
3. In chat/composer, check "Available Tools" — you should see tools from each enabled server.

## Server details

- **GitHub** — Remote server at `https://api.githubcopilot.com/mcp/`. Uses `X-MCP-Toolsets` for repos, issues, pull_requests, projects.
- **Azure DevOps** — STDIO server via `@tiberriver256/mcp-server-azure-devops`. Requires `AZURE_DEVOPS_PAT` and `AZURE_DEVOPS_ORG`.
- **GitLab** — STDIO server via `glab mcp`. Requires `GITLAB_TOKEN`. Supports self-hosted instances via `GITLAB_HOST`.
- **Context7** — No secrets. Fetches up-to-date library docs.
- **Filesystem** — No secrets. Uses `.` (project root) as the allowed directory.
- **Playwright** — No secrets. Browser automation.
- **Brave Search** — Requires `BRAVE_API_KEY`.
