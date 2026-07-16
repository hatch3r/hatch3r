# Troubleshooting

This guide helps you resolve common issues with the hatch3r CLI, MCP servers, board commands, and generated tool configs. If you don't find your issue here, see [Getting Help](#getting-help) at the end.

**Quick links:** [Prerequisites](#prerequisites) | [CLI Commands](#cli-commands) | [Validation](#validation-npx-hatch3r-validate) | [MCP and Secrets](#mcp-and-secrets) | [Board Commands](#board-commands) | [Azure DevOps](#azure-devops-board-commands) | [GitLab](#gitlab-board-commands) | [Claude Code MCP](#claude-code-mcpjson-issues) | [Generated Files](#generated-files-and-adapters) | [Development](#development-contributors) | [Security Model](#security-model)

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

**Solution:** Confirm Node.js 22+ is active by running `node --version` and reading a value `>= v22.0.0`. If using nvm: `nvm use 22` or `nvm install 22`. Then run `npm run build` again.

---

## CLI Commands

### `npx hatch3r init` — when to use sync instead

**Symptom:** You ran `init` but `.hatch3r/` already exists.

**Cause:** Init is for first-time setup. If `.hatch3r/` is present, you should sync or update instead.

**Solution:** Run `npx hatch3r sync` to regenerate tool outputs from the existing canonical source. Use `npx hatch3r update` to pull the latest hatch3r templates.

### Invalid tool(s): `Invalid tool(s): xyz`

**Symptom:** Error when passing `--tools` to init, e.g. `npx hatch3r init --tools invalid-tool`.

**Cause:** The tool name is not supported.

**Solution:** As of v1.9.0, hatch3r ships 3 adapters: `claude`, `cursor`, `copilot`. Pass one or more, comma-separated. Example: `npx hatch3r init --tools claude,cursor`. The 12 other adapters previously shipped (`aider`, `amazon-q`, `amp`, `antigravity`, `cline`, `codex`, `gemini`, `goose`, `kiro`, `opencode`, `windsurf`, `zed`) were removed in v1.9.0; pick one of the 3 supported targets instead.

### Not in a git repository

**Symptom:** Init completes but `owner` and `repo` in `hatch.json` are empty.

**Cause:** hatch3r reads owner/repo from `git remote get-url origin`. Without a git repo or remote, these stay empty.

**Solution:** Run init from a git repository root. If you need board config later, you can edit `.hatch3r/hatch.json` and add `owner`, `repo`, and `board.owner`, `board.repo` manually.

### No .hatch3r/hatch.json found

**Symptom:** `sync`, `update`, or `status` fails with a missing-manifest error (`Missing hatch.json manifest (run hatch3r init to create one)`).

**Cause:** The project has not been initialized, or the manifest was removed.

**Solution:** Run `npx hatch3r init` first. If you had a working setup before, recover `hatch.json` from git history: `git show HEAD:.hatch3r/hatch.json > .hatch3r/hatch.json`.

### Failed to generate {tool} output

**Symptom:** Sync or update fails with "Failed to generate {tool} output" and an error message.

**Cause:** An adapter encountered an error while generating tool-specific files.

**Solution:**
1. Run `npx hatch3r validate` to check for structural issues
2. Fix any validation errors (see [Validation](#validation-npx-hatch3r-validate))
3. Re-run `npx hatch3r sync`

### Corrupted managed block: duplicate start/end marker found

**Symptom:** Sync or update fails with "Corrupted managed block: duplicate start marker found" (or "duplicate end marker found").

**Cause:** A generated file (e.g. in `.cursor/`, `.claude/`, or `.github/`) was manually edited and now contains `<!-- HATCH3R:BEGIN -->` or `<!-- HATCH3R:END -->` more than once. hatch3r expects exactly one of each marker per file.

**Solution:**
1. Find files with duplicate markers (run from project root):
   ```bash
   grep -rl "HATCH3R:BEGIN" .cursor .claude .github 2>/dev/null | while read f; do
     [ "$(grep -c "HATCH3R:BEGIN" "$f")" -gt 1 ] && echo "$f"
   done
   ```
2. Open each listed file and remove the extra `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` so only one pair remains. Keep the content between the first start and last end marker.
3. Re-run `npx hatch3r sync` or `npx hatch3r update`.

---

## Validation (`npx hatch3r validate`)

Run `npx hatch3r validate` to check structural correctness of the bundled canonical content and your project's `.hatch3r/hatch.json` manifest. Below are common errors and how to fix them.

> **validate vs verify:** `validate` checks structural correctness (frontmatter, directories, cross-references). `verify` regenerates adapter outputs from the bundled canonical content and diffs the managed block against the on-disk copy to detect content drift, and also scans the on-disk `HATCH3R:BEGIN`/`HATCH3R:END` marker structure for tampering (orphan/duplicate markers, wrong host-comment syntax) — reported as advisory warnings that do not change the drift PASS/FAIL exit code. Use `validate` for content issues, `verify` for drift detection.

### Missing hatch.json manifest

**Symptom:** Validation warns "Missing hatch.json manifest (run `hatch3r init` to create one)."

**Solution:** Init may not have run in this project, or the manifest was removed. Re-run `npx hatch3r init`, or restore the manifest from git history: `git show HEAD:.hatch3r/hatch.json > .hatch3r/hatch.json`.

### hatch.json: missing 'version' field / no tools configured

**Solution:** Open `.hatch3r/hatch.json` and confirm it has a `version` string and a non-empty `tools` array (e.g. `["cursor", "claude"]`). Re-run `npx hatch3r init` to regenerate a valid manifest if it was hand-edited into an invalid state.

### Invalid frontmatter (no closing ---)

**Symptom:** Validation reports "Invalid frontmatter (no closing ---)" for a specific file.

**Solution:** Open the affected file (e.g. a `.hatch3r/overrides/rules/hatch3r-*.md` override) and confirm the YAML frontmatter has both opening and closing `---` delimiters on their own lines:

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

### Invalid JSON in mcp/mcp.json

**Solution:** Validate JSON syntax of your resolved MCP config (e.g. with `jq . .hatch3r/mcp/mcp.json` or an online validator). Fix trailing commas, unquoted keys, or malformed strings. Restore from git history if needed: `git checkout HEAD -- .hatch3r/mcp/mcp.json`.

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
3. **Fine-grained PAT:** Grant repository permissions for Contents, Issues, Pull requests, Metadata. Add Organization → Members (read) for org projects. For board commands, grant Projects (Read & Write) under repository or organization permissions
4. Add the token to `.env.mcp`: `GITHUB_PAT=ghp_xxxx`
5. Source `.env.mcp` and restart your editor

See [mcp-setup.md](mcp-setup.md#github-pat-scopes) for detailed scope guidance.

### Brave Search or other MCP servers

**Solution:** See [mcp-setup.md](mcp-setup.md) for per-server environment variables (e.g. `BRAVE_API_KEY`) and setup instructions.

---

## Board Commands

Board commands (`board-init`, `board-fill`, `board-groom`, `board-pickup`, `board-refresh`) use the GitHub API and Projects V2. Common issues:

### GraphQL or permission failures

**Symptoms:** "Permission denied", mutation failures, or 403 when creating/updating projects or issues.

**Cause:** The GitHub PAT lacks the `project` scope required for Projects V2 operations.

**Solution:**
- **If using gh CLI:** Run `gh auth refresh -s project` to add the project scope
- **If using a PAT:** Create or update your token to include the `project` scope (classic) or Projects permissions (fine-grained)

### Board config missing: "I need the GitHub owner and repository"

**Symptom:** The board command prompts for owner and repo.

**Cause:** `hatch.json` is missing `owner`/`repo` or `board.owner`/`board.repo`.

**Solution:** Provide owner and repo when prompted. To persist: edit `.hatch3r/hatch.json` and add:
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

### Azure DevOps board commands

**Symptoms:** Board commands fail with authentication errors, work item creation fails, or status updates don't work.

**Solutions:**

1. **Authentication:** Set `AZURE_DEVOPS_PAT` and `AZURE_DEVOPS_ORG` in `.env.mcp`, then confirm both are exported with `grep -E '^(AZURE_DEVOPS_PAT|AZURE_DEVOPS_ORG)=' .env.mcp`. If using `az` CLI, run `az login` first
2. **PAT permissions:** The PAT needs Work Items (Read & Write), Code (Read & Write), Build (Read), and Project and Team (Read) scopes
3. **Work item types:** Azure DevOps uses different terminology (Epic, User Story, Task, Bug). hatch3r maps its type labels accordingly — if custom work item types are configured in your project, board commands may need the types configured in `hatch.json`
4. **Organization URL:** Verify your org name matches the URL pattern `https://dev.azure.com/{org}`

### GitLab board commands

**Symptoms:** Board commands fail with 401/403 errors, merge requests aren't created, or board operations fail.

**Solutions:**

1. **Token scopes:** `GITLAB_TOKEN` needs the `api` scope. Tokens with only `read_api` will fail on write operations
2. **MR vs PR terminology:** GitLab uses "merge requests" (MRs) instead of "pull requests" (PRs). hatch3r handles this mapping automatically, but error messages from the GitLab API will reference MRs
3. **Self-hosted instances:** Set `GITLAB_HOST=https://gitlab.example.com` in `.env.mcp` if not using gitlab.com
4. **Board configuration:** GitLab boards use labels for columns. Run `hatch3r-board-init` once to create the expected labels, then verify them in the GitLab UI under Project → Labels

### Claude Code `.mcp.json` issues

**Symptoms:** Claude Code fails to connect to MCP servers, reports JSON parse errors, or ignores server entries.

**Cause:** Claude Code uses a different env var placeholder syntax (`${VAR}`) than other tools (`${env:VAR}`), and requires a `type` field on each server entry.

**Solution:** Run `npx hatch3r sync` to regenerate `.mcp.json` with the expected format. The Claude adapter automatically applies the syntax transform. If you edited `.mcp.json` manually, verify two things:
- Env vars use `${VAR}` syntax (not `${env:VAR}`)
- Each server has a `"type": "stdio"` or `"type": "http"` field

---

## Generated Files and Adapters

### Adapter output looks wrong after manual edits

**Symptom:** Files in `.cursor/`, `.github/`, or other generated directories don't match what you expect.

**Solution:** Run `npx hatch3r sync` to regenerate from the canonical source. Content outside `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` in markdown files is preserved. Non-prefixed files (e.g. `my-project-conventions.mdc`) are never touched.

### Drift between canonical and generated files

**Symptom:** You're unsure if generated files are in sync with the bundled canonical content.

**Solution:** Run `npx hatch3r status` to see synced, drifted, or missing files. Run `npx hatch3r sync` to fix drift.

### PreToolUse hook error on every tool call (pretooluse-allowlist.mjs)

**Symptom:** Claude Code prints `PreToolUse:… hook error / Failed with non-blocking status code: …pretooluse-allowlist.mjs:<line>` on every tool call — Bash, Read, all of them. Opening `.claude/hooks/pretooluse-allowlist.mjs` shows the script body twice; the duplicated ESM `import` bindings are a Node `SyntaxError` at load.

**Cause:** A pre-2.6.0 `hatch3r sync` spliced managed-block markers above the old raw script instead of replacing it. Current releases replace recognized legacy scripts wholesale, but a file corrupted before that fix stays corrupted: sync preserves content below the `// HATCH3R:END` marker as user content, so re-running sync does not heal it — and `hatch3r status`/`verify` report the file as in-sync.

**Solution:**
1. Delete the corrupted file: `rm .claude/hooks/pretooluse-allowlist.mjs` (it then shows as `missing` in `hatch3r status`)
2. Run `npx hatch3r sync` to regenerate it

### Tool-specific behavior

**Solution:** See [adapter-capability-matrix.md](adapter-capability-matrix.md) for per-tool output paths, capabilities, and limitations (e.g. Claude Code uses `${VAR}` env-var syntax in `.mcp.json` while Cursor uses `${env:VAR}` in `.cursor/mcp.json`; Copilot writes instructions only and does not consume an MCP config). See [model-selection.md](model-selection.md) for per-agent model configuration.

---

## Development (Contributors)

### Build fails with module errors

**Solution:** Confirm Node.js 22+ by running `node --version` and reading `>= v22.0.0`. Then run `npm run build` again.

### Tests fail with ENOENT or fixture errors

**Symptom:** Tests fail with "ENOENT" or symlink-related errors.

**Solution:**
1. Run `npm run build` to refresh `dist/` from current sources
2. Run `npm test` again

### More contributor troubleshooting

See [CONTRIBUTING.md](../CONTRIBUTING.md#troubleshooting) for additional development setup and troubleshooting.

---

## Exit Codes

hatch3r returns a differentiated POSIX exit code per failure kind so CI scripts can branch on *what* failed, not just *whether* it failed. The kind-specific codes (64/65/69/70/73/74/75) follow the BSD `sysexits.h` convention (FreeBSD `/usr/include/sysexits.h`); their source of truth is `ERROR_CODE_TO_EXIT_CODE` in `src/types.ts`, which those rows mirror row-for-row. The remaining rows — `1` (unclassified crash), `2` (usage error), and `129`/`130`/`143` (termination signals) — are process-level codes emitted by the CLI entrypoint, not entries in that map.

| Exit code | Name (`sysexits.h`) | Error kind | When it fires |
|----------:|---------------------|------------|---------------|
| 0 | — | success / user cancel | Command succeeded, or you cancelled an interactive prompt (Ctrl+C at a question). |
| 1 | — | unexpected crash | An unclassified error or unhandled promise rejection escaped a command (report as a bug — a run id, and a `.hatch3r/.failure-log.jsonl` pointer when the log was written, print to stderr), or the Node.js &lt; 22 startup guard fired. |
| 2 | — | usage error | Bad flag or argument; Commander wrote the usage help. |
| 64 | `EX_USAGE` | `VALIDATION_ERROR` | Content/structure validation failed, or an unknown `--tools` value. |
| 65 | `EX_DATAERR` | `CONFIG_ERROR` | Manifest or config malformed / missing (`.hatch3r/hatch.json`). |
| 69 | `EX_UNAVAILABLE` | `ADAPTER_ERROR` | An adapter failed to generate tool output. |
| 70 | `EX_SOFTWARE` | `UNKNOWN_ERROR` | Unclassified internal error. |
| 73 | `EX_CANTCREAT` | `INTEGRITY_ERROR` | Generated output drifted and cannot be regenerated to match canonical (`hatch3r verify`). |
| 74 | `EX_IOERR` | `FS_ERROR`, `CLEAN_ERROR` | Filesystem read/write/clean failure. |
| 75 | `EX_TEMPFAIL` | `NETWORK_ERROR`, `LOCK_TIMEOUT` | Retryable failure — network fetch, or another hatch3r process holds the lock. |
| 129 | — | SIGHUP | Terminated by hang-up — the controlling terminal closed or an SSH session dropped (128 + signal 1). |
| 130 | — | SIGINT | Interrupted with Ctrl+C (128 + signal 2). |
| 143 | — | SIGTERM | Terminated by `kill` or a supervisor/orchestrator requesting shutdown (128 + signal 15). |

**JSON output note:** every non-stub command accepts `--format <human|json>`. An invalid `--format` value is an exit-2 usage error, and so is `--format json` on an invocation that would prompt (e.g. `mcp setup`, bare `cli-tools`, interactive flows without `--yes`) — the prompts would interleave with the JSON document. In JSON mode, stdout carries exactly one JSON document (envelope: `status`, command payload fields, `command`, `hatch3rVersion`, `timestamp`); diagnostics and spinners go to stderr.

**Envelope `status` values.** In JSON mode the first field to branch on is `status`. The lifecycle commands (`init`, `sync`, `update`, `config`) share one vocabulary:

| `status` | Meaning |
|----------|---------|
| `passed` | The run completed and every adapter write succeeded. |
| `partial` | The run completed but at least one adapter failed while others succeeded — some tool outputs were written, some were not. |
| `failed` | The operation could not complete. |
| `dry-run` | A `--dry-run` preview; no files were written. A `--dry-run --format json` run emits this one envelope in place of the human box, so a preview is machine-readable rather than empty stdout. |

The `status` label for a some-adapters-failed run can read `partial` or `failed` depending on the command, so branch on the **exit code** (`69` `ADAPTER_ERROR`, above) — not the label string — to catch every partial-failure. Read-only commands reuse the field for command-specific values (`verify` → `pass`/`fail`, `status` → `in-sync`/`drift`, `validate` → `passed`/`failed`), so the exit code stays the portable, command-agnostic success signal.

**Scripting note (CI):** branch on the exact code, not `[ $? -eq 1 ]`. Structured command failures never collapse to 1 — `VALIDATION_ERROR`, `CONFIG_ERROR`, and `ADAPTER_ERROR` surface as 64/65/69, so a `-eq 1` check misses every one of them. Exit 1 is reserved for the unclassified-crash class (the code-`1` row above), so a `-eq 1` branch catches only that bug class and never a classified failure. The structured `errorCode` string also prints to stderr, and `npx hatch3r validate --format json` emits it as a machine-readable field. Example:

```bash
npx hatch3r validate
case $? in
  0)  echo "ok" ;;
  64) echo "validation failed — fix listed errors" ;;
  65) echo "config/manifest problem — run 'npx hatch3r init'" ;;
  *)  echo "other failure (code $?)" ;;
esac
```

---

## Security Model

hatch3r is an instruction-generation framework. Understanding its trust boundaries helps you use it safely.

**IDE Sandbox.** hatch3r generates markdown instruction files, rule files, and tool configurations. It does not execute agent actions itself — your IDE or CLI tool (Claude Code, Cursor, Copilot, etc.) provides the execution sandbox. Agent outputs such as file writes, shell commands, and API calls are governed by the host tool's own permission model, not by hatch3r. Review your IDE's security settings (e.g., Claude Code's `.claude/settings.json` permissions, Cursor's tool approval prompts) to control what agents can do at runtime.

**Advisory Boundaries.** Agent capability boundaries expressed in hatch3r instructions — such as "Never: Create branches, commits, or PRs without explicit user approval" — are advisory markdown directives, not technical enforcement. This is a known characteristic of all instruction-based agentic frameworks: the LLM interprets these instructions but is not mechanically prevented from violating them. Treat these boundaries as strong guidance rather than hard security controls. For operations requiring strict enforcement, rely on your IDE's built-in permission system or external guardrails (branch protection rules, CI checks, etc.).

**Trust Model for Content.** hatch3r manages content within `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` blocks. Content outside these blocks in managed files — and any non-prefixed files you add to tool directories — becomes part of the agent's instruction context. Since agents treat all instruction content as trusted, review any custom content added to managed files before syncing. Avoid placing secrets, credentials, or untrusted third-party content in instruction files.

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
