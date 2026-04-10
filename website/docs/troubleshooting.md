---
sidebar_position: 100
title: Troubleshooting
---

# Troubleshooting

Common issues and solutions for the hatch3r CLI, MCP servers, board commands, and generated tool configs.

## Prerequisites

### `npx hatch3r` fails with module or ESM errors

**Symptoms:** `ERR_UNSUPPORTED_ESM_URL` or `SyntaxError: Unexpected token`

**Cause:** Node.js version is below 22.

**Solution:**
1. Check your version: `node --version` (should show v22.0.0 or higher)
2. Upgrade via [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or your system package manager
3. Verify: `node --version` and `npx hatch3r --help`

## CLI Commands

### `npx hatch3r init` -- re-init and reconfiguration

Running `hatch3r init` on an existing `.agents/` directory is supported. It detects the previous configuration, prompts for confirmation (showing how many content items will change), and cleans up stale content from the previous preset automatically.

For lighter reconfiguration without re-initializing, use:

- `npx hatch3r config` -- interactively change tools, features, content items, and MCP servers
- `npx hatch3r sync` -- regenerate tool outputs from canonical source
- `npx hatch3r update` -- pull latest hatch3r templates

### Invalid tool(s)

Use only valid tools: `cursor`, `copilot`, `claude`, `opencode`, `windsurf`, `amp`, `codex`, `gemini`, `cline`, `aider`, `kiro`, `goose`, `zed`, `amazon-q`, `antigravity`.

```bash
npx hatch3r init --tools cursor,claude
```

### Not in a git repository

Init reads owner/repo from `git remote get-url origin`. Without a git remote, these stay empty. Edit `.agents/hatch.json` to add them manually.

### No .agents/hatch.json found

Run `npx hatch3r init` first. If you had a working setup before, check your git history (`git log --all -- .agents/hatch.json`).

## Integrity and Validation

Run `npx hatch3r verify` to check file integrity against stored checksums. This detects modified, missing, or tampered canonical files and provides recovery guidance (run `hatch3r update` to restore).

Run `npx hatch3r validate` to check the `.agents/` structure.

| Error | Solution |
|-------|----------|
| `.agents/` directory not found | Run `npx hatch3r init` |
| Missing manifest | Re-run `npx hatch3r init` or restore from git history |
| Required directory missing | Re-run `npx hatch3r init` or `npx hatch3r update` |
| Invalid frontmatter | Ensure both opening and closing `---` delimiters exist |
| Missing `id` or `type` | Add required fields to YAML frontmatter |
| Invalid JSON in mcp.json | Fix syntax (trailing commas, unquoted keys) |

## MCP and Secrets

### MCP servers not connecting

**Causes:** Secrets not loaded, wrong config path, or editor not restarted.

**Solution:**
1. Source `.env.mcp` before launching:
   ```bash
   set -a && source .env.mcp && set +a && cursor .
   ```
2. Restart the editor
3. Verify config path matches your tool (see [MCP Setup](./guides/mcp-setup))

### GitHub MCP returns 401 or 403

**Solution:**
1. Create a [Personal Access Token](https://github.com/settings/tokens/new)
2. Classic PAT: grant `repo` and `read:org`
3. Add to `.env.mcp`: `GITHUB_PAT=ghp_xxxx`
4. Source and restart

## Board Commands

### GraphQL or permission failures

The GitHub PAT lacks the `project` scope for Projects V2 operations.

- **gh CLI:** `gh auth refresh -s project`
- **PAT:** Add `project` scope (classic) or Projects permissions (fine-grained)

### Board config missing

Edit `.agents/hatch.json`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "board": {
    "owner": "your-org",
    "repo": "your-repo"
  }
}
```

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
3. GitLab uses "merge requests" instead of "pull requests" -- hatch3r maps this automatically

## Claude Code MCP

### Claude Code fails to connect to MCP servers

Claude Code uses `${VAR}` syntax (not `${env:VAR}`) and requires a `type` field on each server entry. Run `npx hatch3r sync` to regenerate `.mcp.json` with the correct format.

## Generated Files

### Adapter output looks wrong after manual edits

Run `npx hatch3r sync` to regenerate. Content outside managed blocks is preserved.

### Drift between canonical and generated files

Run `npx hatch3r status` to check. Run `npx hatch3r sync` to fix drift.

## Diagnostics and Failure Logs

### Reading the failure log

When pipeline operations fail, hatch3r writes structured entries to `.agents/.failure-log.jsonl`. Each line is a JSON object with timestamp, command, error message, and context.

To inspect recent failures:

```bash
# View the last 10 failures
tail -10 .agents/.failure-log.jsonl | jq .

# Filter by command
grep '"command":"sync"' .agents/.failure-log.jsonl | jq .
```

Include relevant failure log entries when reporting issues.

### Environment information for bug reports

When filing an issue, include:

```bash
node --version
npx hatch3r --version
npx hatch3r status
```

## Getting Help

If this guide didn't resolve your issue, [open an issue](https://github.com/hatch3r/hatch3r/issues) with:

- OS and version
- Node version (`node --version`)
- hatch3r version
- Tools configured
- Exact error message
- Steps to reproduce
