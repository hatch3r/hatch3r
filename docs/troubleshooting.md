# Troubleshooting

This guide helps you resolve common issues with the hatch3r CLI, MCP servers, board commands, and generated tool configs. If you don't find your issue here, see [Getting Help](#getting-help) at the end.

**Quick links:** [Prerequisites](#prerequisites) | [CLI Commands](#cli-commands) | [Validation](#validation-npx-hatch3r-validate) | [MCP and Secrets](#mcp-and-secrets) | [Board Commands](#board-commands) | [Generated Files](#generated-files-and-adapters) | [Development](#development-contributors)

---

## Prerequisites

### `npx hatch3r` fails with module or ESM errors

**Symptoms:**
- `ERR_UNSUPPORTED_ESM_URL` or similar module resolution errors
- `SyntaxError: Unexpected token` when running hatch3r

**Cause:** Node.js version is below 22. hatch3r requires Node.js 22+.

**Solution:**
1. Check your version: `node --version` (should show v22.0.0 or higher)
2. Upgrade Node.js using [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or your system package manager
3. Verify: `node --version` and `npx hatch3r --help`

### `npm run build` fails with ESM resolution errors

**Cause:** Same as above — Node.js &lt; 22.

**Solution:** Ensure Node.js 22+ is active. If using nvm: `nvm use 22` or `nvm install 22`. Then run `npm run build` again.

---

## CLI Commands

### `npx hatch3r init` — when to use sync instead

**Symptom:** You ran `init` but `.agents/` already exists.

**Cause:** Init is for first-time setup. If `.agents/` is present, you should sync or update instead.

**Solution:** Run `npx hatch3r sync` to regenerate tool outputs from the existing canonical source. Use `npx hatch3r update` to pull the latest hatch3r templates.

### Invalid tool(s): `Invalid tool(s): xyz`

**Symptom:** Error when passing `--tools` to init, e.g. `npx hatch3r init --tools invalid-tool`.

**Cause:** The tool name is not supported.

**Solution:** Use only valid tools: `cursor`, `copilot`, `claude`, `opencode`, `windsurf`, `amp`, `codex`, `gemini`, `cline`. Example: `npx hatch3r init --tools cursor,claude`.

### Not in a git repository

**Symptom:** Init completes but `owner` and `repo` in `hatch.json` are empty.

**Cause:** hatch3r reads owner/repo from `git remote get-url origin`. Without a git repo or remote, these stay empty.

**Solution:** Run init from a git repository root. If you need board config later, you can edit `/.agents/hatch.json` and add `owner`, `repo`, and `board.owner`, `board.repo` manually.

### No .agents/hatch.json found

**Symptom:** `sync`, `update`, or `status` fails with "No .agents/hatch.json found."

**Cause:** The project has not been initialized, or the manifest was removed.

**Solution:** Run `npx hatch3r init` first. If you had a working setup before, check `.agents/.backups/` for a backup of `hatch.json`.

### Failed to generate {tool} output

**Symptom:** Sync or update fails with "Failed to generate {tool} output" and an error message.

**Cause:** An adapter encountered an error while generating tool-specific files.

**Solution:**
1. Run `npx hatch3r validate` to check for structural issues
2. Fix any validation errors (see [Validation](#validation-npx-hatch3r-validate))
3. Re-run `npx hatch3r sync`

---

## Validation (`npx hatch3r validate`)

Run `npx hatch3r validate` to check the `.agents/` structure. Below are common errors and how to fix them.

### .agents/ directory not found

**Solution:** Run `npx hatch3r init` to create the canonical structure.

### Missing .agents/hatch.json manifest

**Solution:** Init may have been interrupted. Re-run `npx hatch3r init`, or restore `hatch.json` from `.agents/.backups/` if available.

### Required directory missing: .agents/agents/, .agents/skills/, or .agents/rules/

**Solution:** Restore from `.agents/.backups/` or re-run `npx hatch3r init` to recreate the structure.

### Invalid frontmatter (no closing ---)

**Symptom:** Validation reports "Invalid frontmatter (no closing ---)" for a specific file.

**Solution:** Open the file (e.g. `.agents/rules/hatch3r-*.md`) and ensure the YAML frontmatter has both opening and closing `---`:

```markdown
---
id: my-rule
type: rule
description: My rule
---
# Content
```

### Missing 'id' or 'type' in frontmatter

**Solution:** Add `id:` and `type:` to the YAML frontmatter of the affected file. Required fields: `id`, `type`, and typically `description`.

### Invalid JSON in .agents/mcp/mcp.json

**Solution:** Validate JSON syntax (e.g. with `jq . .agents/mcp/mcp.json` or an online validator). Fix trailing commas, unquoted keys, or malformed strings. Restore from `.agents/.backups/` if needed.

### Managed file missing from disk

**Solution:** Run `npx hatch3r sync` to regenerate the missing file from the canonical source.

### Managed file without hatch3r- prefix

**Solution:** Files in `managedFiles` that are not shared (AGENTS.md, CLAUDE.md, etc.) should use the `hatch3r-` prefix. Rename the file to `hatch3r-*.md` or remove it from `managedFiles` if it is a custom file.

---

## MCP and Secrets

### MCP servers not connecting

**Symptoms:**
- Red or gray dots next to MCP servers in Cursor: Settings → Tools & MCP
- MCP tools do not appear in "Available Tools" in chat/composer

**Causes:** Secrets not loaded; wrong config path; editor not restarted after config changes.

**Solution:**
1. **Load secrets:** For Cursor, Claude Code, and most editors, source `.env.mcp` before launching:
   ```bash
   set -a && source .env.mcp && set +a && cursor .
   ```
2. **Restart the editor** after running `hatch3r init` or changing MCP config
3. **Verify config path:** Cursor uses `.cursor/mcp.json`; Claude Code uses `.mcp.json`. See [mcp-setup.md](mcp-setup.md) for per-tool paths

### GitHub MCP returns 401 or 403

**Symptoms:** GitHub tools fail with authentication or permission errors.

**Causes:** Missing or invalid `GITHUB_PAT`; insufficient token scopes.

**Solution:**
1. Create a [Personal Access Token](https://github.com/settings/tokens/new)
2. **Classic PAT:** Grant `repo` and `read:org`. For board commands, add `project`
3. **Fine-grained PAT:** Grant repository permissions for Contents, Issues, Pull requests, Metadata. Add Organization → Members (read) for org projects. For board commands, ensure Projects access
4. Add the token to `.env.mcp`: `GITHUB_PAT=ghp_xxxx`
5. Source `.env.mcp` and restart your editor

See [mcp-setup.md](mcp-setup.md#github-pat-scopes) for detailed scope guidance.

### Brave Search or other MCP servers

**Solution:** See [mcp-setup.md](mcp-setup.md) for per-server environment variables (e.g. `BRAVE_API_KEY`) and setup instructions.

---

## Board Commands

Board commands (`board-init`, `board-fill`, `board-pickup`) use the GitHub API and Projects V2. Common issues:

### GraphQL or permission failures

**Symptoms:** "Permission denied", mutation failures, or 403 when creating/updating projects or issues.

**Cause:** The GitHub PAT lacks the `project` scope required for Projects V2 operations.

**Solution:**
- **If using gh CLI:** Run `gh auth refresh -s project` to add the project scope
- **If using a PAT:** Create or update your token to include the `project` scope (classic) or Projects permissions (fine-grained)

### Board config missing: "I need the GitHub owner and repository"

**Symptom:** The board command prompts for owner and repo.

**Cause:** `hatch.json` is missing `owner`/`repo` or `board.owner`/`board.repo`.

**Solution:** Provide owner and repo when prompted. To persist: edit `/.agents/hatch.json` and add:
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

---

## Generated Files and Adapters

### Adapter output looks wrong after manual edits

**Symptom:** Files in `.cursor/`, `.github/`, or other generated directories don't match what you expect.

**Solution:** Run `npx hatch3r sync` to regenerate from the canonical source. Content outside `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` in markdown files is preserved. Non-prefixed files (e.g. `my-project-conventions.mdc`) are never touched.

### Drift between canonical and generated files

**Symptom:** You're unsure if generated files are in sync with `/.agents/`.

**Solution:** Run `npx hatch3r status` to see synced, drifted, or missing files. Run `npx hatch3r sync` to fix drift.

### Tool-specific behavior

**Solution:** See [adapter-capability-matrix.md](adapter-capability-matrix.md) for per-tool output paths, capabilities, and limitations (e.g. Windsurf MCP is global-only; some tools don't support hooks).

---

## Development (Contributors)

### Build fails with module errors

**Solution:** Ensure Node.js 22+: `node --version`. Run `npm run build` again.

### Tests fail with ENOENT or fixture errors

**Symptom:** Tests fail with "ENOENT" or symlink-related errors.

**Solution:**
1. Run `npm run build` to ensure `dist/` is up to date
2. Run `npm test` again

### More contributor troubleshooting

See [CONTRIBUTING.md](../CONTRIBUTING.md#troubleshooting) for additional development setup and troubleshooting.

---

## Getting Help

If this guide didn't resolve your issue:

1. **Open an issue** at [github.com/hatch3r/hatch3r/issues](https://github.com/hatch3r/hatch3r/issues)
2. **Include:**
   - OS and version (e.g. macOS 14, Ubuntu 22.04)
   - Node version: `node --version`
   - hatch3r version (from `npx hatch3r --version` or package)
   - Tools configured (e.g. Cursor, Copilot)
   - Exact error message or output
   - Steps to reproduce

This information helps us diagnose and fix issues faster.
