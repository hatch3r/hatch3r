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

### `npx hatch3r init` -- when to use sync instead

If `.agents/` already exists, you should sync or update instead of running init again.

- `npx hatch3r sync` -- regenerate tool outputs from canonical source
- `npx hatch3r update` -- pull latest hatch3r templates

### Invalid tool(s)

Use only valid tools: `cursor`, `copilot`, `claude`, `opencode`, `windsurf`, `amp`, `codex`, `gemini`, `cline`.

```bash
npx hatch3r init --tools cursor,claude
```

### Not in a git repository

Init reads owner/repo from `git remote get-url origin`. Without a git remote, these stay empty. Edit `/.agents/hatch.json` to add them manually.

### No .agents/hatch.json found

Run `npx hatch3r init` first. If you had a working setup before, check `.agents/.backups/`.

## Validation

Run `npx hatch3r validate` to check the `.agents/` structure.

| Error | Solution |
|-------|----------|
| `.agents/` directory not found | Run `npx hatch3r init` |
| Missing manifest | Re-run init or restore from `.agents/.backups/` |
| Required directory missing | Restore from backups or re-run init |
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

Edit `/.agents/hatch.json`:

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

## Generated Files

### Adapter output looks wrong after manual edits

Run `npx hatch3r sync` to regenerate. Content outside managed blocks is preserved.

### Drift between canonical and generated files

Run `npx hatch3r status` to check. Run `npx hatch3r sync` to fix drift.

## Getting Help

If this guide didn't resolve your issue, [open an issue](https://github.com/hatch3r/hatch3r/issues) with:

- OS and version
- Node version (`node --version`)
- hatch3r version
- Tools configured
- Exact error message
- Steps to reproduce
