---
sidebar_position: 1
title: CLI Commands
---

# CLI Commands

Commands you run directly in the terminal via `npx hatch3r`.

## Standard flags (2.0.0)

Every non-stub command and subcommand accepts:

| Flag | Description |
|------|-------------|
| `--format <human\|json>` | `human` (default) or `json`. JSON mode emits exactly one JSON document on stdout (envelope: `status`, command payload fields, `command`, `hatch3rVersion`, `timestamp`); diagnostics and spinners go to stderr. An invalid value, or `--format json` on an invocation that would prompt (e.g. `mcp setup`, bare `cli-tools`, interactive flows without `--yes`), is an exit-2 usage error |
| `--quiet` | Suppress stdout chrome (banner, spinners, boxes, next steps); stderr diagnostics still emit |

Mutating commands additionally accept `--dry-run` (preview without writing): init, sync, update, config, clean, rollback, worktree-setup, worktree-cleanup, mcp setup/remove, cli-tools, learn capture. `--verbose` is registered only on commands that have detail output wired. The per-command tables below list command-specific flags; the standard flags are not repeated.

## hatch3r init

Interactive setup that initializes hatch3r in your repository.

```bash
npx hatch3r init
npx hatch3r init --tools cursor,claude
npx hatch3r init --yes    # headless mode (standard preset, auto-detected context)
npx hatch3r init --preset full --project-type brownfield --team-size team --yes
```

**Flags:**

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--tools` | comma-separated tool names | auto-detected | Which coding tools to configure (Claude Code, Cursor, Copilot) |
| `--quick`, `--default` | — | off | Aliases for `--yes` (headless mode) |
| `--yes` | — | off | Skip all prompts (headless mode) |
| `--preset` | `minimal`, `standard`, `full`, `web-app`, `api-service`, `cli-tool`, `monorepo`, `legacy`, `security`, or a comma-list to compose | `standard` | Content profile preset |
| `--project-type` | `greenfield`, `brownfield` | auto-detected | Project type context |
| `--team-size` | `solo`, `team` | git-inferred | Team size context |
| `--maturity` | `solo`, `team`, `scaleup`, `enterprise` | `solo` | Investment-depth dial — calibrates how deeply agents build (see [Maturity Tiers](../../guides/maturity-tiers)). Does not filter content; every tier installs the full corpus |
| `--cli-tools`, `--no-cli-tools` | `tier1`, `all`, or comma-separated ids | picker / smart default | Resolve the CLI-tools selection up front (skips the picker); `--no-cli-tools` skips CLI tools entirely |
| `--mcp`, `--no-mcp` | — | off | Opt in to MCP servers (interactive init does not prompt for MCP); `--no-mcp` force-disables even with `--mcp` |
| `--dry-run` | — | off | Preview what init would create or change without writing files |
| `--workspace` | — | off | Force workspace mode for multi-repo directories |

When CWD is a non-git directory containing git subdirectories, init auto-detects a workspace layout and suggests workspace mode. Use `--workspace` to force workspace mode without the prompt.

The interactive flow asks (default branch, project type, and team size are inferred, not prompted):

1. **Platform** -- GitHub, Azure DevOps, or GitLab (auto-detected from git remote)
2. **Repo identity** -- owner/org and repo name (auto-filled from the remote where possible)
3. **Content profile** -- Minimal, Standard (recommended), Full, or Custom
4. **Maturity tier** -- solo, team, scaleup, or enterprise (seeded at the git-inferred default); `--maturity <tier>` skips this prompt. The tier is an investment-depth dial, not a content gate -- every tier installs the full corpus (see [Maturity Tiers](../../guides/maturity-tiers))
5. **Communication style** -- plain (default) or technical operator register for generated-agent output; `--communication-style <style>`, headless flags, or `--resume` skip this prompt (added 2.8.5)
6. **Custom content items** -- only when Custom is selected at step 3
7. **Tools** -- select from the 3 supported adapters (Claude Code, Cursor, GitHub Copilot)
8. **CLI tools** -- tier-grouped picker (tier-1 + trigger-matched tier-2 pre-checked; enter-through equals the `--yes` smart default). There is no MCP prompt — opt in with `--mcp` or `npx hatch3r mcp setup` later

The common (non-custom) path is 7 prompts; the custom-content multi-select adds an 8th only when Custom is chosen at step 3 (steps renumber accordingly).

Only the content matching your profile and context is generated into your adapter outputs (canonical content is read from the bundled npm package, not copied into your repo). Use `hatch3r config` to add or remove items later.

With `--yes`, init auto-detects greenfield/brownfield, defaults to solo + standard preset, selects tier-1 + triggered tier-2 CLI tools, and skips all prompts.

## hatch3r setup

Added in 2.1.0. Scaffolds a fresh project directory and then chains into the `hatch3r init` prompts inside it. The happy path needs only Node 22+ and `git`.

```bash
npx hatch3r setup my-app
npx hatch3r setup my-app --remote
npx hatch3r setup demo --yes --tools claude
npx hatch3r setup my-app --dry-run    # preview the scaffold without writing
```

**Flags:**

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--remote` | — | off | Create a private GitHub remote via `gh repo create` after `git init`. Acts only when `gh` is installed and authenticated (`gh auth status` exits 0); otherwise it prints a warning and continues the local scaffold |
| `--tools` | comma-separated tool names | auto-detected | Forwarded to `init` — which coding tools to configure (Claude Code, Cursor, Copilot) |
| `--preset` | `minimal`, `standard`, `full`, or any `init` preset value | `standard` | Forwarded to `init` — content profile preset |
| `--maturity` | `solo`, `team`, `scaleup`, `enterprise` | git-inferred | Forwarded to `init` — investment-depth tier; supplying it skips the maturity prompt |
| `--yes` | — | off | Forwarded to `init` — skip all prompts (headless mode) |
| `--format <human\|json>` | `human`, `json` | `human` | Forwarded to `init`. `--format json` without `--yes` is an exit-2 usage error |
| `--quiet` | — | off | Forwarded to `init` — suppress stdout chrome |
| `--dry-run` | — | off | Preview the scaffold plan (directory, `git init`, remote, then init) and write nothing; `init` is not run |
| `--verbose` | — | off | Forwarded to `init` — verbose per-step output |

What it does, in order:

1. Resolves the target directory from the positional `[dir]` argument; when omitted it uses the current directory if empty, otherwise prompts for a directory name. An existing target with content beyond a lone `.git` is refused with an actionable `FS_ERROR` (exit 74)
2. Creates the directory (skipped when it already exists empty)
3. Runs `git init` — idempotent, skipped when a `.git` is already present
4. With `--remote`, creates the private GitHub remote (warns and continues when `gh` is missing/unauthenticated, or if `gh repo create` fails)
5. Changes into the new directory and runs the `hatch3r init` prompts (see above); `init` emits the single terminal outcome box / JSON envelope

## hatch3r config

Interactive reconfiguration of your hatch3r setup. Also accepts scalar forms: `config maturity=<tier>`, `config get <key>`, `config set <key> <value>`.

```bash
npx hatch3r config
npx hatch3r config --dry-run        # preview the change without writing
npx hatch3r config maturity=team    # scalar form, no prompts
```

- Change platform, tools, features, and MCP servers
- Add or remove individual content items (agents, skills, rules, commands) — manifest-only bookkeeping: the selection is written to `.hatch3r/hatch.json` and adapter outputs are regenerated from the bundled canonical content (no `.agents/` materialization). Removing an item rescues its hand-authored `.customize.*` overrides into the archive
- Enable/disable worktree file isolation for parallel agent sessions
- Manage workspace repos (add/remove sub-repos, toggle sync, change sync strategy)
- Archives removed tool outputs to `.hatch3r-archive/`
- Re-syncs all adapters after changes

**Command-specific flags:** `--dry-run` (preview without writing), `--verbose`.

## hatch3r sync

Re-generates tool-specific files from the bundled canonical content plus your `.hatch3r/overrides/`.

```bash
npx hatch3r sync
npx hatch3r sync --repos frontend backend   # sync specific sub-repos only
npx hatch3r sync --dry-run                   # preview without writing
npx hatch3r sync --force                     # overwrite even if unchanged
```

**Flags:**

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--repos` | space-separated paths | all repos | Sync only the listed sub-repos |
| `--dry-run` | — | off | Show what would be synced without writing files |
| `--force` | — | off | Overwrite target files even if unchanged |
| `--diff` | — | off | Show a before/after diff summary for each generated file |
| `--minimal` | — | off | Generate stripped-down output (no comments, minimal formatting) to reduce token usage |
| `--strict-budget` | — | off | Fail sync if any adapter's generated output exceeds its context budget (default: warn) |
| `--verbose` | — | off | Show detailed output for each file processed |

:::info Drift gate
There is no integrity-checksum preflight (the `.agents/`-scoped integrity manifest was removed in the Wave 7 bundled-content model). Drift is detected by regenerating each adapter output and diffing it against the on-disk copy. `--force` overwrites target files even when unchanged.
:::

:::info Orphan cleanup (1.6.0)
Since 1.6.0, `sync` unlinks files previously emitted by hatch3r but no longer produced, tracked per-adapter via `managedFilesByAdapter` in `hatch.json`. Four safety refusals prevent accidental deletion: user-wrapped content, paths outside adapter roots, non-`hatch3r-` basenames, and no-history first-run.
:::

Run after editing anything under `.hatch3r/overrides/`, upgrading hatch3r, or when generated files get out of sync. Preserves content outside managed blocks in markdown files. Warns if project specs in `docs/specs/` are stale (>7 days without update).

In a workspace, sync generates tool-specific files in each sub-repo from the bundled canonical content plus the workspace-level selection and any per-repo overrides from `workspace.json`. Sub-repos receive independent copies (not symlinks).

## hatch3r update

Pulls the latest hatch3r package and regenerates adapter outputs from the updated bundled content, safe-merging into your customizations.

```bash
npx hatch3r update
```

Uses the safe merge system: managed blocks are updated, your customizations are preserved.

**Flags:**

| Flag | Description |
|------|-------------|
| `--yes` | Skip interactive prompts, use defaults |
| `--diff` | Show a before/after diff summary for each generated file |
| `--force` | Overwrite generated outputs even when unchanged |
| `--offline`, `--skip-fetch` | Skip the package fetch step; regenerate only from already-installed canonical content |
| `--dry-run` | Preview what would change (added/modified/unchanged per adapter) without writing files |

## hatch3r status

Checks sync status by regenerating each adapter output from the bundled canonical content (plus your overrides) and diffing it against the generated tool files on disk.

```bash
npx hatch3r status
npx hatch3r status --verbose   # detailed per-file status
npx hatch3r status --diff      # before/after diff summary per generated file
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--verbose` | Show detailed per-file status information |
| `--diff` | Show a before/after diff summary for each generated file (same box `hatch3r sync --diff` emits) |

Status compares only the hatch3r-managed block (`HATCH3R:BEGIN`/`END`) against a fresh regeneration; content you author outside the markers is never reported here. (The former `--deep` flag was removed — regeneration is the only drift path.)

Reports synced, drifted, and missing files for each configured tool. When a `workspace.json` manifest exists, also displays workspace topology -- listing each sub-repo, its sync status, and any per-repo overrides.

## hatch3r validate

Validates content structure and file contents — bundled canonical content plus your `.hatch3r/overrides/`.

```bash
npx hatch3r validate
npx hatch3r validate --verbose   # detailed validation output
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--verbose` | Show detailed validation output for each check |

Checks for:
- Required directories (`agents/`, `skills/`, `rules/`)
- Valid `hatch.json` manifest
- Frontmatter integrity (opening/closing `---`, required `id` and `type` fields)
- Valid MCP JSON configuration
- Managed file presence and naming conventions
- Content consistency — manifest items vs. files on disk
- Orphaned customization files in `.hatch3r/`
- Cross-reference integrity — verifies `hatch3r-*` references between content items resolve to existing IDs
- Orchestration dependencies — warns if pipeline-critical agents (researcher, implementer, reviewer, test-writer, security-auditor) are missing from the content selection
- MCP version-pin check — flags unpinned `npx @scope/pkg` invocations and `@latest` tags as supply-chain risk (per OWASP ASI 2026)

## hatch3r verify

A thin drift-detection wrapper over `status`: it regenerates each adapter output from the bundled canonical content and diffs it against the on-disk copy, then exits non-zero if any output is drifted or missing. There is no `.integrity.json` checksum file — drift is computed by regeneration, not stored hashes.

```bash
npx hatch3r verify
npx hatch3r verify --fix                        # auto-repair drift by regenerating output
npx hatch3r verify --fix --max-fix-attempts 3   # raise the default 2-cycle cap
```

Reports each adapter output as synced, drifted, or missing. Exits 73 (`INTEGRITY_ERROR`) if any drift remains — see [Exit Codes](https://github.com/hatch3r/hatch3r/blob/main/docs/troubleshooting.md#exit-codes).

**Flags:**

| Flag | Description |
|------|-------------|
| `--fix` | Auto-repair drifted/missing output by regenerating it (the same in-memory regeneration `hatch3r sync` performs), re-checking drift after each pass |
| `--max-fix-attempts <n>` | Maximum regenerate-then-recheck cycles (default: 2, clamped to 1–5) |
| `--verbose` | Show the per-tool / per-file drift breakdown before the PASS/FAIL summary |
| `--diff` | Show a before/after diff summary for each generated file |

Recovery:
- **Drifted:** Run `hatch3r verify --fix` (or `hatch3r sync`) to regenerate the on-disk output
- **Missing:** Run `hatch3r sync` to regenerate

## hatch3r clean

Remove all hatch3r artifacts from the current repository.

```bash
npx hatch3r clean
npx hatch3r clean --yes       # skip confirmation (no reinit)
npx hatch3r clean --dry-run   # preview without modifying files
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--yes` | Skip confirmation prompts (cleans without reinit) |
| `--dry-run` | Show what would be removed without modifying files |

Removes `.hatch3r/hatch.json`, all generated tool files, and archive directories (`.hatch3r-archive/`). Keeps the rest of `.hatch3r/` — learnings, handoffs, overrides, mcp, and `.customize.yaml` files. Optionally offers to reinitialize after cleanup.

## hatch3r worktree-setup

Sets up gitignored files (`.env.mcp` and other `.env.*`, plus the shared `.hatch3r/` state) in a new git worktree, per the patterns in `.worktreeinclude`.

```bash
npx hatch3r worktree-setup [worktree-path]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--from <path>` | Main repo path (auto-detected by default) |
| `--dry-run` | Show what would be done without changes |
| `--force` | Overwrite existing files in the worktree |
| `--yes` | Skip the secret-propagation confirmation prompt |

Automatically triggered by the Claude adapter's PostToolUse hook when `git worktree add` is detected. Can also be run manually after creating a worktree.

### Secret propagation (blast radius)

`.env.mcp` and other `.env.*` files are copied (not symlinked) into each worktree so MCP servers can start without reaching outside the worktree root. This duplicates plaintext credentials and aligns with [CWE-552](https://cwe.mitre.org/data/definitions/552.html) (Files or Directories Accessible to External Parties).

Before running `worktree-setup`, consider the blast radius:

- Worktree paths on shared locations (`/tmp` mounts, network drives, devcontainer volumes) expose the copied secrets to every user with read access.
- Ephemeral worktree farms (per-branch CI sandboxes, parallel AI agent scratch dirs) multiply the exposure surface — N worktrees equals N plaintext credential copies.
- `hatch3r worktree-cleanup` removes symlinks and unmodified copies; run it as soon as a worktree is no longer needed.

When `.env.mcp` is present, `worktree-setup` prints a highlighted warning box and, on an interactive terminal, asks for confirmation before continuing. Use `--yes` to skip the prompt in automation (for example, the Claude adapter's PostToolUse hook).

## hatch3r worktree-cleanup

Remove symlinks and copied files created by `worktree-setup` in the current worktree.

```bash
npx hatch3r worktree-cleanup
npx hatch3r worktree-cleanup --dry-run   # preview without changes
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be done without changes |

## hatch3r add

Install content packs from a local path or an installed npm package (v1 trust tiers; git/marketplace sources remain roadmap).

```bash
npx hatch3r add <pack>                 # resolve + trust-gate + install into .hatch3r/overrides/
npx hatch3r add <pack> --dry-run       # preview the install plan without writing
```

Packs are validated before any write: manifest check, signing gate, SHA-256 integrity map, lifecycle-script ban, and path-traversal guards; unsigned packs are refused unless `--allow-untrusted` is passed explicitly (recorded in the install ledger at `.hatch3r/packs/<pack_id>.json`).

## hatch3r cli-tools

Added in 1.7.5. Manage the agentic CLI-tools selection (ripgrep, fd, jq, gh, ast-grep, and 25 others across three tiers). The CLI-tooling pivot positions OS-native CLI tools as the default token-efficient agent-tooling surface; MCP is opt-in.

```bash
npx hatch3r cli-tools                 # open the tier-grouped picker
npx hatch3r cli-tools list            # show current selection + install status
npx hatch3r cli-tools detect          # read-only detection report
npx hatch3r cli-tools install         # re-run the installer offer for missing tools
```

Detection uses POSIX `command -v` / Windows `where` with a 2-second timeout and fail-open semantics. The installer never executes — it prints copy-paste commands grouped per package manager (`brew`, `apt`, `dnf`, `winget`, `scoop`, with `cargo` / `pipx` / `npm` fallback). After every flow that touches CLI-tool selection, a warning-style box surfaces any selected-but-not-installed tools alongside a one-liner that chains installable tools through their shared package manager.

The bare command also accepts `--dry-run` (show the resulting selection without writing the manifest). `--format json` is accepted on `list` and `detect`; the bare picker and `install` can prompt, so JSON is rejected there (exit 2).

See the [CLI Tools getting-started guide](../../getting-started/cli-tools.md) for the full tier catalog.

## hatch3r mcp

Added in 1.7.5. Manage MCP server configuration. MCP is pure opt-in since 2.0.0: interactive `init` does not prompt for it, and no init path configures it without `--mcp`. `mcp setup` is the primary opt-in surface; `setup` and `remove` keep the manifest's `features.mcp` flag consistent (`true` only while at least one server remains selected).

```bash
npx hatch3r mcp setup                 # open the MCP server picker (writes manifest + .env.mcp)
npx hatch3r mcp list                  # show current MCP configuration
npx hatch3r mcp remove <id>           # delete a single MCP server
npx hatch3r mcp env-check             # audit .env.mcp for missing required env vars
```

`setup` and `remove` accept `--dry-run` (show the resulting server list + `features.mcp` without writing). `--format json` is accepted on the headless subcommands (`list`, `remove`, `env-check`); `setup` always prompts, so JSON is rejected there (exit 2).

See [MCP setup](../../guides/mcp-setup.md) for server reference and security model.
