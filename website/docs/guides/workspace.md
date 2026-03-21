---
sidebar_position: 8
title: Multi-Repo Workspaces
---

# Multi-Repo Workspaces

hatch3r can manage multiple git repositories from a single workspace root. A shared `.agents/` directory holds canonical content and a `workspace.json` manifest, and `hatch3r sync` cascades configuration into each sub-repo.

## What is a workspace?

A workspace is a non-git directory that contains multiple git repositories as subdirectories. hatch3r treats the parent directory as the workspace root and each git subdirectory as a managed sub-repo.

```
my-platform/               <- Workspace root (not a git repo)
  .agents/                  <- Shared canonical source
    workspace.json          <- Workspace manifest
    hatch.json
    agents/
    rules/
    skills/
    commands/
    mcp/
    AGENTS.md
  frontend/                 <- Git repo
    .agents/                <- Synced subset
    .cursor/
    CLAUDE.md
  backend/                  <- Git repo
    .agents/                <- Synced subset
    CLAUDE.md
  infra/                    <- Git repo
    .cursor/
    CLAUDE.md
```

## Setting up a workspace

Run `hatch3r init` inside the workspace root directory. If the directory is not a git repo but contains git subdirectories, init auto-detects the workspace layout and prompts to confirm.

```bash
cd ~/projects/my-platform
npx hatch3r init
```

To skip the prompt, pass `--workspace`:

```bash
npx hatch3r init --workspace
```

Init walks through the standard setup flow (platform, tools, content profile, features, MCP servers) and then asks which subdirectories to include as managed repos.

## Workspace manifest

The workspace manifest lives at `.agents/workspace.json`. It tracks which repos are managed, their per-repo overrides, and the sync strategy.

```json
{
  "version": "1.0.0",
  "syncStrategy": "on-sync",
  "repos": [
    {
      "path": "frontend",
      "tools": ["cursor", "claude"],
      "sync": true,
      "overrides": {
        "include": ["hatch3r-implementer", "hatch3r-reviewer"],
        "exclude": ["hatch3r-board-fill"]
      }
    },
    {
      "path": "backend",
      "tools": ["claude"],
      "sync": true,
      "overrides": {}
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `syncStrategy` | `"manual"` -- sync only when you run `hatch3r sync`; `"on-sync"` -- cascade on every sync |
| `repos[].path` | Relative path from workspace root to the sub-repo |
| `repos[].tools` | Tools enabled for this repo (overrides workspace-level tools) |
| `repos[].sync` | Set to `false` to skip this repo during sync cascades |
| `repos[].overrides` | Per-repo content include/exclude lists |

## Syncing content to sub-repos

`hatch3r sync` copies content from the workspace `.agents/` into each sub-repo and generates tool-specific files.

```bash
npx hatch3r sync                          # sync all repos
npx hatch3r sync --repos frontend         # sync one repo
npx hatch3r sync --repos frontend backend # sync specific repos
npx hatch3r sync --dry-run                # preview without writing
npx hatch3r sync --force                  # overwrite even if unchanged
```

Sync uses **copy-based distribution** -- each sub-repo receives independent copies of the generated files, not symlinks. This means sub-repos work correctly when opened in isolation.

## Per-repo overrides

Each repo entry in `workspace.json` can override tools, features, and content:

- **Tools** -- different repos can target different coding tools
- **Include** -- add content IDs beyond the workspace defaults
- **Exclude** -- remove specific content IDs from this repo

```json
{
  "path": "frontend",
  "tools": ["cursor", "claude"],
  "sync": true,
  "overrides": {
    "include": ["hatch3r-a11y-audit"],
    "exclude": ["hatch3r-devops", "hatch3r-ci-pipeline"]
  }
}
```

## Content inheritance model

Content resolution follows three layers, applied in order:

1. **Workspace defaults** -- content selected during `hatch3r init` at the workspace root (stored in `hatch.json`)
2. **Per-repo includes** -- additional content IDs added via `overrides.include`
3. **Per-repo excludes** -- content IDs removed via `overrides.exclude`

The final content set for each sub-repo is: `(workspace defaults + includes) - excludes`.

## How AI tools behave

Different coding tools handle file inheritance differently, and workspace layout accounts for this:

- **Claude Code** walks up the directory tree looking for `CLAUDE.md`. A sub-repo `CLAUDE.md` can be lean because Claude will also find the workspace-level instructions if the workspace root is an ancestor directory.
- **Cursor** does not inherit from parent directories. Each sub-repo needs a complete `.cursor/` directory with all rules, agents, and MCP config. hatch3r sync handles this automatically.
- **Other tools** -- most tools (Copilot, Windsurf, Cline, etc.) read configuration from the project root only. Sync generates complete files in each sub-repo.

## Managing repos via hatch3r config

Use `hatch3r config` to manage workspace repos interactively:

```bash
npx hatch3r config
```

The config flow includes workspace management options:

- Add new sub-repos to the workspace
- Remove repos from sync management
- Toggle sync on/off for individual repos
- Change per-repo tool and content overrides
- Switch the sync strategy

You can also edit `.agents/workspace.json` directly.

## Sync strategies

| Strategy | Behavior |
|----------|----------|
| `manual` | Sub-repos are only updated when you explicitly run `hatch3r sync` |
| `on-sync` | Every `hatch3r sync` (and `hatch3r update`) cascades changes to all enabled sub-repos |

Choose `manual` if you want full control over when sub-repos are updated. Choose `on-sync` (the default) for a hands-off workflow where changes propagate automatically.

Change the strategy via `hatch3r config` or by editing `syncStrategy` in `workspace.json`.
