---
sidebar_position: 1
title: CLI Commands
---

# CLI Commands

Commands you run directly in the terminal via `npx hatch3r`.

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
| `--tools` | comma-separated tool names | auto-detected | Which coding tools to configure |
| `--quick`, `--default` | — | off | Aliases for `--yes` (headless mode) |
| `--yes` | — | off | Skip all prompts (headless mode) |
| `--preset` | `minimal`, `standard`, `full` | `full` | Content profile preset |
| `--project-type` | `greenfield`, `brownfield` | auto-detected | Project type context |
| `--team-size` | `solo`, `team` | `solo` | Team size context |
| `--workspace` | — | off | Force workspace mode for multi-repo directories |

When CWD is a non-git directory containing git subdirectories, init auto-detects a workspace layout and suggests workspace mode. Use `--workspace` to force workspace mode without the prompt.

The init flow asks:

1. **Platform** -- GitHub, Azure DevOps, or GitLab (auto-detected from git remote)
2. **Repo identity** -- owner/org and repo name
3. **Default branch** -- for checkout, PR base, and release
4. **Project type** -- greenfield (new project) or brownfield (existing codebase)
5. **Team size** -- solo developer or team collaboration
6. **Content profile** -- Minimal, Standard (recommended), Full, or Custom
7. **Tools** -- select from the 3 supported adapters (Cursor, Claude Code, GitHub Copilot)
8. **Features** -- agents, skills, rules, commands, MCP, hooks, GitHub agents
9. **MCP servers** -- optionally configure up to 10 MCP servers

Only the content matching your profile and context is generated into your adapter outputs (canonical content is read from the bundled npm package, not copied into your repo). Use `hatch3r config` to add or remove items later.

With `--yes`, init auto-detects greenfield/brownfield, defaults to solo + standard preset, and skips all prompts.

## hatch3r config

Interactive reconfiguration of your hatch3r setup.

```bash
npx hatch3r config
```

- Change platform, tools, features, and MCP servers
- Add or remove individual content items (agents, skills, rules, commands)
- Enable/disable worktree file isolation for parallel agent sessions
- Manage workspace repos (add/remove sub-repos, toggle sync, change sync strategy)
- Archives removed tool outputs to `.hatch3r-archive/`
- Re-syncs all adapters after changes

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
npx hatch3r status --deep      # byte-for-byte comparison
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--verbose` | Show detailed per-file status information |
| `--deep` | Compare byte-for-byte by regenerating every adapter's output in-memory (regeneration is the only drift path since the integrity manifest was removed in Wave 7) |

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

Reports each adapter output as synced, drifted, or missing. Exit code 1 if any drift is found.

**Flags:**

| Flag | Description |
|------|-------------|
| `--fix` | Auto-repair drifted/missing output by regenerating it (the same in-memory regeneration `hatch3r sync` performs), re-checking drift after each pass |
| `--max-fix-attempts <n>` | Maximum regenerate-then-recheck cycles (default: 2, clamped to 1–5) |

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

Install community content packs (coming soon).

```bash
npx hatch3r add <pack>
```

This command will allow installing community-contributed agent packs, rule sets, and workflow recipes. Follow [hatch3r on GitHub](https://github.com/hatch3r) for updates.

## hatch3r cli-tools

Added in 1.7.5. Manage the agentic CLI-tools selection (ripgrep, fd, jq, gh, ast-grep, and 25 others across three tiers). The CLI-tooling pivot positions OS-native CLI tools as the default token-efficient agent-tooling surface; MCP is opt-in.

```bash
npx hatch3r cli-tools                 # open the tier-grouped picker
npx hatch3r cli-tools list            # show current selection + install status
npx hatch3r cli-tools detect          # read-only detection report
npx hatch3r cli-tools install         # re-run the installer offer for missing tools
```

Detection uses POSIX `command -v` / Windows `where` with a 2-second timeout and fail-open semantics. The installer never executes — it prints copy-paste commands grouped per package manager (`brew`, `apt`, `dnf`, `winget`, `scoop`, with `cargo` / `pipx` / `npm` fallback). After every flow that touches CLI-tool selection, a warning-style box surfaces any selected-but-not-installed tools alongside a one-liner that chains installable tools through their shared package manager.

See the [CLI Tools getting-started guide](../../getting-started/cli-tools.md) for the full tier catalog.

## hatch3r mcp

Added in 1.7.5. Manage MCP server configuration as a side-door for users who skipped MCP during init or want to revisit it later. MCP is opt-in in 1.7.5 (`hatch3r init --yes` no longer auto-configures MCP — add `--mcp` to restore the prior behavior).

```bash
npx hatch3r mcp setup                 # reopen the MCP server picker
npx hatch3r mcp list                  # show current MCP configuration
npx hatch3r mcp remove <id>           # delete a single MCP server
npx hatch3r mcp env-check             # audit .env.mcp for missing required env vars
```

See [MCP setup](../../guides/mcp-setup.md) for server reference and security model.
