---
sidebar_position: 3
title: MCP Setup
---

# MCP Setup

How to connect hatch3r's MCP servers and manage secrets securely.

## Overview

hatch3r ships with 10 MCP servers: 3 enabled by default (no env vars required) and 7 opt-in servers (GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab). All secrets are centralized in a single `.env.mcp` file at the project root (gitignored by default). MCP configs use `${env:VAR}` placeholders so you never commit secrets.

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

The platform-specific MCP server (GitHub, Azure DevOps, or GitLab) is automatically selected based on your detected platform during init.

## Selecting MCP Servers During Init

When you run `npx hatch3r init`, step 6 asks which MCP servers to enable:

1. hatch3r detects your platform (GitHub, Azure DevOps, or GitLab) and pre-selects the matching platform MCP server
2. The three default servers (Playwright, Context7, Filesystem) are pre-checked
3. You can toggle any server on or off using the interactive checkbox prompt
4. After selection, hatch3r writes only the chosen servers to `.agents/mcp/mcp.json`

To change MCP servers after init, run `npx hatch3r config`. This re-presents the MCP server selection prompt pre-populated with your current choices.

## Where MCP Config Lives

All adapters that support MCP emit tool-specific configuration during `npx hatch3r init` or `npx hatch3r sync`. The canonical MCP source is `.agents/mcp/mcp.json`; each adapter transforms it into the format and path the tool expects.

| Tool | Config path | Format | Notes |
|------|-------------|--------|-------|
| Cursor | `.cursor/mcp.json` | JSON (direct copy) | Also reads `mcp.json` at project root if using the Cursor plugin |
| Claude Code | `.mcp.json` | JSON (direct copy) | Also generates `.claude/settings.json` with opinionated permissions |
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

1. Run `npx hatch3r init` and select MCP servers when prompted
2. Config is written to `.cursor/mcp.json` and secrets template to `.env.mcp`
3. Fill in your API keys in `.env.mcp` (see [Managing Secrets](#managing-secrets))
4. **Restart Cursor** for changes to take effect
5. In Cursor: Settings -> Tools & MCP -- verify servers show a green dot

If using the Cursor plugin, the plugin provides `mcp.json` at the project root. Cursor loads project-level config from `.cursor/mcp.json` (takes precedence over global `~/.cursor/mcp.json`).

### Claude Code

Config goes to `.mcp.json`. Claude Code reads it from the project root. Fill in `.env.mcp`, source it, and restart Claude Code after init.

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

**VS Code / Copilot** -- Secrets load automatically. The generated `.vscode/mcp.json` includes `envFile: "${workspaceFolder}/.env.mcp"` on every STDIO server, so VS Code reads the file natively.

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
| **Brave Search** | `BRAVE_API_KEY` | [Brave Search API](https://brave.com/search/api/) -- free tier: 2,000 queries/month |

#### Opt-in servers (enable during init)

| Server | Env var | How to get it |
|--------|---------|---------------|
| Sentry | `SENTRY_AUTH_TOKEN` | [Sentry Auth Tokens](https://sentry.io/settings/account/api/auth-tokens/) |
| Postgres | `POSTGRES_URL` | Your PostgreSQL connection string |
| Linear | `LINEAR_API_KEY` | [Linear API keys](https://linear.app/settings/api) |
| Azure DevOps | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` | [Create a PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) |
| GitLab | `GITLAB_TOKEN` | [Create a PAT](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) |

### GitHub PAT scopes {#github-pat-scopes}

**Classic PAT** (Settings -> Developer settings -> Personal access tokens -> Tokens (classic)):
- `repo` -- full control of private repositories (read/write code, issues, PRs)
- `read:org` -- read org and team membership (needed for org projects)
- `project` -- read/write access to GitHub Projects V2 (required for board commands: `hatch3r-board-init`, `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`)

**Fine-grained PAT** (recommended):

| Permission | Access | Required for |
|------------|--------|-------------|
| Contents | Read and write | Code, file operations |
| Issues | Read and write | Issue creation, labeling, assignment |
| Pull requests | Read and write | PR creation, review, merge |
| Projects | Read and write | Board commands (`hatch3r-board-init`, etc.) |
| Metadata | Read | Repository metadata (auto-granted) |
| Members (Organization) | Read | Org projects and team membership |

Fine-grained tokens have [limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations) (e.g. user-owned Projects V2 may require classic PATs).

**Note:** If board commands fail with GraphQL permission errors, the most likely cause is a missing `project` scope. For classic PATs, add the `project` scope. For fine-grained PATs, ensure Projects has read and write access. You can also run `gh auth refresh -s project` if using the GitHub CLI.

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

During `hatch3r init` or `hatch3r sync`, the canonical MCP config at `.agents/mcp/mcp.json` is transformed into tool-specific formats for each selected adapter. The process works as follows:

1. **Canonical source** -- `.agents/mcp/mcp.json` contains the `mcpServers` object with only the servers you selected during init
2. **Adapter transformation** -- each adapter reads the canonical config and writes it to the tool-specific path and format
3. **Secret injection** -- environment variable placeholders (`${env:VAR}`) are preserved in all generated configs. The actual values are read from `.env.mcp` at runtime

The adapter capability matrix determines which adapters emit MCP config:

| Adapter | Emits MCP | Output path | Format notes |
|---------|-----------|-------------|--------------|
| Cursor | Yes | `.cursor/mcp.json` | Direct JSON copy |
| Claude Code | Yes | `.mcp.json` | Direct JSON copy |
| Copilot / VS Code | Yes | `.vscode/mcp.json` | Adds `envFile` field for native secret loading |
| OpenCode | Yes | `opencode.json` | Embedded under `mcp` key |
| Windsurf | Yes | `.windsurf/mcp.json` | Standard `mcpServers` format |
| Amp | Yes | `.amp/settings.json` | Under `amp.mcpServers` key |
| Codex | Yes | `.codex/config.toml` | TOML `[mcp_servers.<name>]` sections |
| Gemini | Yes | `.gemini/settings.json` | Under `mcpServers` key |
| Cline / Roo | Yes | `.roo/mcp.json` | Standard `mcpServers` format |
| Kiro | Yes | `.kiro/settings/mcp.json` | Standard `mcpServers` format |

When you run `hatch3r sync` or `hatch3r config`, all adapter MCP configs are regenerated from the canonical source, ensuring consistency across tools.

## Adding Custom MCP Servers

You can add custom MCP servers by editing `.agents/mcp/mcp.json` directly. Add your server definition to the `mcpServers` object:

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
