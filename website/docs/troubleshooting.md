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

Running `hatch3r init` on an existing `.hatch3r/` setup is supported. It detects the previous configuration, prompts for confirmation (showing how many content items will change), and cleans up stale content from the previous preset automatically.

For lighter reconfiguration without re-initializing, use:

- `npx hatch3r config` -- interactively change tools, features, content items, and MCP servers
- `npx hatch3r sync` -- regenerate tool outputs from canonical source
- `npx hatch3r update` -- pull latest hatch3r templates

### Invalid tool(s)

Use only valid tools: `cursor`, `copilot`, `claude`. (The adapter set was hard-cut to these 3 in 1.9.0.)

```bash
npx hatch3r init --tools cursor,claude
```

### Not in a git repository

Init reads owner/repo from `git remote get-url origin`. Without a git remote, these stay empty. Edit `.hatch3r/hatch.json` to add them manually.

### No .hatch3r/hatch.json found

Run `npx hatch3r init` first. If you had a working setup before, check your git history (`git log --all -- .hatch3r/hatch.json`).

## Drift and Validation

Run `npx hatch3r verify` (or `npx hatch3r status`) to detect drift: hatch3r regenerates each adapter output from the bundled canonical content and diffs it against the on-disk copy. There is no `.integrity.json` checksum file — drift is detected by regeneration, not stored hashes. To fix drift, run `npx hatch3r sync`.

Run `npx hatch3r validate` to check content structure and frontmatter (bundled content plus your `.hatch3r/overrides/`).

| Error | Solution |
|-------|----------|
| Missing manifest (`.hatch3r/hatch.json`) | Re-run `npx hatch3r init` or restore from git history |
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

Edit `.hatch3r/hatch.json`:

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

### Sync removed an adapter output file

On every run, `hatch3r sync` unlinks files previously recorded under `managedFilesByAdapter` in `hatch.json` but no longer emitted by the current adapter set (orphan cleanup, implemented in `src/merge/orphanCleanup.ts`). This is expected when an adapter is removed, a canonical item is deleted, or the precedence-prefixed `NN-hatch3r-*` naming supersedes a pre-1.6.0 `hatch3r-*` filename.

Safety refusals skip deletion for: user-wrapped content carrying a `HATCH3R:BEGIN/END` block, paths outside the adapter's output root, non-`hatch3r-`/`NN-hatch3r-` basenames, and first-run cases with no manifest history. If a needed customization was unlinked, restore it from git (`git checkout HEAD -- <path>`) and move the content into a non-`hatch3r-` filename so future syncs leave it alone.

## Validation Errors

### `description is N chars (min 60 required for disambiguation)`

`hatch3r validate` enforces a minimum description length of 60 characters on every canonical agent, skill, rule, and command. Expand the frontmatter `description:` field to describe scope plus primary signal for the artifact.

### `Description collision: ... ↔ ... (cosine=0.NN, cluster=...)`

Two artifacts in the same `(type, primary-tag)` cluster have descriptions that cosine-collide at `>= 0.55`. Rewrite one to emphasize its distinct scope (different trigger, different domain, different output).

## Board Sync Verification

### `board-init` reports workflow verification mismatch

Starting in 1.6.0, `board-init` verifies that the GitHub Project's built-in workflows are enabled (item-closed, PR-merged). If the verification fails, open the Project's workflow settings in the GitHub UI, enable the required workflows, then re-run `npx hatch3r board-init --resume` to persist the verified state into `hatch.json` under `board.workflows`.

### `board-fill` or `board-pickup` halts with "retry budget exceeded"

Board Sync Enforcement rule 10 aborts batch sync once per-run retry count exceeds 20% of batch size. Inspect `.hatch3r/.failure-log.jsonl` for the underlying GraphQL errors (option-mapping race, null option, auth), resolve the root cause, and re-run. Rules 8 and 9 (retry-then-halt with rollback, null-option abort) surface specific halts — treat each as a substantive failure, not a transient retry.

## Diagnostics and Failure Logs

### Reading the failure log

When pipeline operations fail, hatch3r writes structured entries to `.hatch3r/.failure-log.jsonl`. Each line is a JSON object with timestamp, command, error message, and context.

To inspect recent failures:

```bash
# View the last 10 failures
tail -10 .hatch3r/.failure-log.jsonl | jq .

# Filter by command
grep '"command":"sync"' .hatch3r/.failure-log.jsonl | jq .
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
