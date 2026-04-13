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
| `--yes` | — | off | Skip all prompts (headless mode) |
| `--preset` | `minimal`, `standard`, `full` | `standard` | Content profile preset |
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
7. **Tools** -- select from 15 supported coding tools
8. **Features** -- agents, skills, rules, commands, prompts, MCP, hooks, GitHub agents
9. **MCP servers** -- optionally configure up to 10 MCP servers

Only the content matching your profile and context is copied to `.agents/`. Use `hatch3r config` to add or remove items later.

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

Re-generates tool-specific files from the canonical `.agents/` source.

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
| `--verbose` | — | off | Show detailed output for each file processed |

Run after manually editing canonical files or when generated files get out of sync. Preserves content outside managed blocks in markdown files. Warns if project specs in `docs/specs/` are stale (>7 days without update).

In a workspace, sync cascades content from the workspace `.agents/` into each sub-repo, applying per-repo overrides from `workspace.json`. Sub-repos receive independent copies (not symlinks).

## hatch3r update

Pulls the latest hatch3r templates and merges them with your canonical source.

```bash
npx hatch3r update
```

Uses the safe merge system: managed blocks are updated, your customizations are preserved.

## hatch3r status

Checks sync status between canonical `.agents/` and generated tool files.

```bash
npx hatch3r status
npx hatch3r status --verbose   # detailed per-file status
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--verbose` | Show detailed per-file status information |

Reports synced, drifted, and missing files for each configured tool. When a `workspace.json` manifest exists, also displays workspace topology -- listing each sub-repo, its sync status, and any per-repo overrides.

## hatch3r validate

Validates the `.agents/` directory structure and file contents.

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

## hatch3r verify

Verifies file integrity by comparing canonical files against stored checksums.

```bash
npx hatch3r verify
```

Requires `.agents/.integrity.json` (generated by init and update). Reports each file as PASS, MODIFIED, MISSING, NEW, or TAMPERED. Exit code 1 if any integrity issues are found.

Recovery:
- **Modified/Tampered:** Run `hatch3r update` to restore originals
- **Missing:** Run `hatch3r update` to regenerate

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

Removes `.agents/`, all generated tool files, and archive directories. Optionally offers to reinitialize after cleanup.

## hatch3r worktree-setup

Sets up gitignored files (`.env.mcp`, `.agents/.integrity.json`, etc.) in a new git worktree.

```bash
npx hatch3r worktree-setup [worktree-path]
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--from <path>` | Main repo path (auto-detected by default) |
| `--dry-run` | Show what would be done without changes |
| `--force` | Overwrite existing files in the worktree |

Automatically triggered by the Claude adapter's PostToolUse hook when `git worktree add` is detected. Can also be run manually after creating a worktree.

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
