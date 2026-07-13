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

Use only valid tools: `claude`, `cursor`, `copilot`. (The adapter set was hard-cut to these 3 in 1.9.0.)

```bash
npx hatch3r init --tools claude,cursor
```

### Not in a git repository

Init reads owner/repo from `git remote get-url origin`. Without a git remote, these stay empty. Edit `.hatch3r/hatch.json` to add them manually.

### No .hatch3r/hatch.json found

Run `npx hatch3r init` first. If you had a working setup before, check your git history (`git log --all -- .hatch3r/hatch.json`).

## Slash Commands (`/hatch3r-*`)

### `/hatch3r-spec` (or any `/hatch3r-*`) reports "command not found"

**Symptoms:** A `/hatch3r-*` command returns `command not found`, `no such command`, or `zsh: no such file or directory: /hatch3r-spec` when you run it in the terminal — commonly the same terminal you just used for `npx hatch3r init`.

**Cause:** `/hatch3r-*` slash commands run inside your editor's AI chat (Claude Code, Cursor, or GitHub Copilot Chat), not in the shell — so they never resolve in a terminal. The same not-found result also appears inside the editor when the command name is mistyped or a renamed command is invoked by an old name.

**Solution:**
1. Switch from the terminal to your editor's AI chat — `/hatch3r-*` slash commands are not shell commands.
2. Open the slash-command picker and type `/hatch3r` to list every installed command (for example `/hatch3r-spec`, `/hatch3r-roadmap`, `/hatch3r-feature-plan`).
3. Select the command from that list and run it there. The picker is the source of truth for command names, so you do not need to recall the exact spelling.

The reverse holds for `npx hatch3r <command>` (for example `npx hatch3r init`): those run in the shell, not the editor's AI chat.

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

## Per-Command Failure-Mode Map

When a step in the four-phase pipeline fails, the symptom and the root cause are often two different layers. This table maps each top-level command to its common failure modes and the first probe to run (D10-M21).

| Command | Common failure | First probe | Resolution path |
|---------|----------------|-------------|-----------------|
| `npx hatch3r init` | Adapter generation aborts mid-flight; partial `.hatch3r/` left on disk | `npx hatch3r rollback --session=<sessionId>` (sessionId printed in the snapshot line) | Roll back, fix root cause (PATH, permissions, network), re-run |
| `npx hatch3r init` | Detected CLI tools missing from PATH | `npx hatch3r init` re-run with `--no-cli-tools` | Install missing tools per the printed copy-paste commands, or skip cli-tools |
| `npx hatch3r sync` | Drift detected on a file you intentionally edited outside the managed block | `npx hatch3r status` (shows file-level diff) | Wrap your edit in `HATCH3R:BEGIN`/`HATCH3R:END` markers, or move content into `.hatch3r/overrides/` |
| `npx hatch3r sync` | An adapter output file was unlinked unexpectedly | `git checkout HEAD -- <path>` | Rename the customization to a non-`hatch3r-` filename so future syncs leave it alone |
| `npx hatch3r validate` | Frontmatter `description` < 60 chars | Re-read the validate output — it names the file + the count | Expand the `description` field to ≥60 chars |
| `npx hatch3r validate` | Cross-reference points at a missing id | Re-read the validate output — it names the dangling id | Add the missing artifact or remove the cross-reference |
| `npx hatch3r verify` | Exits non-zero with drift report | `npx hatch3r status` (same diff, exits 0) | Run `npx hatch3r sync` to regenerate, or commit your intentional edit |
| `/hatch3r-board-init` | GraphQL 401/403 on Projects V2 | `gh auth status` then `gh auth refresh -s project` | Add the `project` scope to your PAT |
| `/hatch3r-board-init` | Workflow verification mismatch | Open the Project's workflow settings in the GitHub UI | Enable required workflows, re-run `--resume` |
| `/hatch3r-board-fill` | Retry budget exceeded (>20% of batch) | `tail -50 .hatch3r/.failure-log.jsonl | jq .` | Resolve the underlying GraphQL error (option-mapping race, null option, auth) and re-run |
| `/hatch3r-board-pickup` | No `status:ready` items | Refresh the board (`/hatch3r-board-fill` or board UI) | Mark ≥1 item ready, re-run pickup |
| `/hatch3r-board-pickup` | Reviewer + fixer loop exceeds 3 iterations | Read the last iteration's reviewer findings | Pick up manually, address the convergence-blocking finding, re-push |
| MCP servers | `${env:VAR}` placeholder not resolved | Editor running without `.env.mcp` sourced | Re-run `set -a && source .env.mcp && set +a && cursor .` (or equivalent), restart editor |
| MCP servers (Claude Code) | Connection fails despite valid PAT | Check `.mcp.json` uses `${VAR}` not `${env:VAR}` | Run `npx hatch3r sync` to regenerate with Claude-compatible syntax |

For deeper failure analysis, every pipeline failure also writes a structured entry to `.hatch3r/.failure-log.jsonl` (see [Diagnostics and Failure Logs](#diagnostics-and-failure-logs) below).

## Getting Help

If this guide didn't resolve your issue, [open an issue](https://github.com/hatch3r/hatch3r/issues) with:

- OS and version
- Node version (`node --version`)
- hatch3r version
- Tools configured
- Exact error message
- Steps to reproduce
