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
```

- Detects your repo (reads `git remote` for owner/repo)
- Asks which coding tools you use
- Asks about MCP server configuration
- Generates canonical source in `/.agents/`
- Generates native config for each selected tool
- Creates `.env.mcp` with secret placeholders

## hatch3r sync

Re-generates tool-specific files from the canonical `/.agents/` source.

```bash
npx hatch3r sync
```

Run after manually editing canonical files or when generated files get out of sync. Preserves content outside managed blocks in markdown files.

## hatch3r update

Pulls the latest hatch3r templates and merges them with your canonical source.

```bash
npx hatch3r update
```

Uses the safe merge system: managed blocks are updated, your customizations are preserved.

## hatch3r status

Checks sync status between canonical `/.agents/` and generated tool files.

```bash
npx hatch3r status
```

Reports synced, drifted, and missing files for each configured tool.

## hatch3r validate

Validates the `.agents/` directory structure and file contents.

```bash
npx hatch3r validate
```

Checks for:
- Required directories (`agents/`, `skills/`, `rules/`)
- Valid `hatch.json` manifest
- Frontmatter integrity (opening/closing `---`, required `id` and `type` fields)
- Valid MCP JSON configuration
- Managed file presence and naming conventions
