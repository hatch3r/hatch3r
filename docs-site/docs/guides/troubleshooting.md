---
sidebar_position: 6
title: Troubleshooting
---

# Troubleshooting

Common issues and solutions for the hatch3r CLI, MCP servers, board commands, and generated tool configs.

## Prerequisites

### `npx hatch3r` fails with module or ESM errors

**Cause:** Node.js version is below 22. hatch3r requires Node.js 22+.

**Solution:**
1. Check your version: `node --version` (should show v22.0.0 or higher)
2. Upgrade Node.js using [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or your system package manager
3. Verify: `node --version` and `npx hatch3r --help`

## CLI Commands

### `npx hatch3r init` — when to use sync instead

If `.agents/` already exists, you should sync or update instead. Run `npx hatch3r sync` to regenerate tool outputs from existing canonical source, or `npx hatch3r update` to pull the latest hatch3r templates.

### Invalid tool(s)

Use only valid tools: `cursor`, `copilot`, `claude`, `opencode`, `windsurf`, `amp`, `codex`, `gemini`, `cline`, `aider`, `kiro`, `goose`, `zed`.

### Not in a git repository

hatch3r reads owner/repo from `git remote get-url origin`. Without a git repo or remote, these stay empty. Run init from a git repository root, or edit `.agents/hatch.json` manually.

## MCP and Secrets

### MCP servers not connecting

1. **Load secrets:** Source `.env.mcp` before launching:
   ```bash
   set -a && source .env.mcp && set +a && cursor .
   ```
2. **Restart the editor** after running `hatch3r init` or changing MCP config
3. **Verify config path:** Cursor uses `.cursor/mcp.json`; Claude Code uses `.mcp.json`

### GitHub MCP returns 401 or 403

1. Create a [Personal Access Token](https://github.com/settings/tokens/new)
2. **Classic PAT:** Grant `repo`, `read:org`, and `project`
3. **Fine-grained PAT:** Grant Contents, Issues, Pull requests, Projects, and Metadata
4. Add the token to `.env.mcp`: `GITHUB_PAT=ghp_xxxx`
5. Source `.env.mcp` and restart your editor

See the [MCP Setup guide](mcp-setup#github-pat-scopes) for detailed scope guidance.

## Board Commands

Board commands (`hatch3r-board-init`, `hatch3r-board-fill`, `hatch3r-board-groom`, `hatch3r-board-pickup`, `hatch3r-board-refresh`) use the GitHub API and Projects V2.

### GraphQL or permission failures

**Cause:** The GitHub PAT lacks the `project` scope required for Projects V2 operations.

**Solution:**
- **If using gh CLI:** Run `gh auth refresh -s project`
- **If using a PAT:** Create or update your token to include the `project` scope (classic) or Projects permissions (fine-grained)

### Board config missing

Edit `.agents/hatch.json` and add `owner`, `repo`, and `board.owner`, `board.repo`.

## Azure DevOps

### Board commands fail with authentication errors

1. Ensure `AZURE_DEVOPS_PAT` and `AZURE_DEVOPS_ORG` are set in `.env.mcp`
2. PAT needs Work Items (Read & Write), Code (Read & Write), Build (Read), and Project and Team (Read) scopes
3. If using `az` CLI, run `az login` first
4. Verify org name matches `https://dev.azure.com/{org}`

## GitLab

### Board commands fail with 401/403

1. `GITLAB_TOKEN` needs the `api` scope (not just `read_api`)
2. For self-hosted instances, set `GITLAB_HOST=https://gitlab.example.com` in `.env.mcp`
3. GitLab uses "merge requests" instead of "pull requests" — hatch3r maps this automatically

## Claude Code MCP

### Claude Code fails to connect to MCP servers

Claude Code uses `${VAR}` syntax (not `${env:VAR}`) and requires a `type` field on each server entry. Run `npx hatch3r sync` to regenerate `.mcp.json` with the correct format.

## Generated Files

### Adapter output looks wrong after manual edits

Run `npx hatch3r sync` to regenerate from the canonical source. Content outside managed blocks (`<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->`) is preserved.

### Drift between canonical and generated files

Run `npx hatch3r status` to see synced, drifted, or missing files. Run `npx hatch3r sync` to fix drift.

## Getting Help

1. Open an issue at [github.com/hatch3r/hatch3r/issues](https://github.com/hatch3r/hatch3r/issues)
2. Include: OS, Node version, hatch3r version, configured tools, exact error message, steps to reproduce
