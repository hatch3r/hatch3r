# Contributing to hatch3r

Thank you for your interest in contributing to hatch3r. This document provides guidelines and instructions for contributing.

## Prerequisites

- Node.js 22 or higher
- npm

## Development setup

1. Clone the repository:
   ```bash
   git clone https://github.com/hatch3r/hatch3r.git
   cd hatch3r
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

## Project structure

The list below is the full set of `src/` subsystems (run `ls -d src/*/` to regenerate). For the higher-level architecture map — CLI command count, pipeline module count, and canonical-content directories — see the Architecture table in [`CLAUDE.md`](CLAUDE.md).

- `src/cli/` - CLI entry point and commands
- `src/adapters/` - 3 platform adapters: Cursor, GitHub Copilot, Claude Code
- `src/pipeline/` - Agentic-pipeline modules (circuit breaker, prompt guard, timeouts, tool allowlists, observability)
- `src/content/` - Canonical-content indexing, frontmatter, presets, tags, learnings, handoffs
- `src/merge/` - Safe merge logic for template updates (atomic write, managed blocks, orphan cleanup)
- `src/detect/` - Project/tool/package-manager detection and convention-conflict analysis
- `src/manifest/` - Manifest (`hatch.json`), MCP filtering, provenance, rehydration
- `src/models/` - Model alias resolution and customization
- `src/env/` - MCP environment variable handling and secret detection
- `src/hooks/` - Hook system definitions, parsing, and SessionStart registry
- `src/audit/` - Audit registry schema, archival, cleanup, insights, migration
- `src/install/` - Self-update install logic
- `src/cliTools/` - External CLI-tool detection, install, registry, one-liner generation
- `src/workspace/` - Workspace detection, git integration, manifest, resolve, sync
- `src/worktree/` - Git-worktree setup and resolution
- `src/migration/` - Legacy `.agents/` to hatch3r content migration
- `src/importers/` - Importers for Cursor, Copilot, Windsurf, awesome-cursorrules sources
- `src/version/` - Version checkpoints and comparison
- `src/archive/` - Archive operations
- `src/clean/` - Clean operations
- `src/__tests__/` - Test files

## Running tests

- Run all tests: `npm test`
- Run tests in watch mode: `npm run test:watch`

## Linting and type checking

- Lint: `npm run lint`
- Type check: `npm run typecheck`

## Pull request conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) style (e.g. `feat: add X`, `fix: resolve Y`)
- Keep PRs focused on a single change or feature
- Include tests for new features
- Ensure `npm test`, `npm run lint`, and `npm run typecheck` pass before submitting

## Pack authoring

A **pack** is a self-contained directory that bundles agents, commands, rules, and skills for hatch3r. To create or modify a pack:

### Pack structure

```
my-pack/
├── agents/          # Agent definitions (e.g. hatch3r-my-agent.md)
├── commands/        # Slash-command definitions (e.g. hatch3r-my-command.md)
├── rules/           # Always-on rules (e.g. hatch3r-my-rule.md)
└── skills/          # Skill directories (e.g. hatch3r-my-skill/SKILL.md)
```

All filenames must be prefixed with `hatch3r-`. Not every subdirectory is required — include only the types your pack provides.

### File format

Each markdown file uses YAML frontmatter followed by a markdown body:

```markdown
---
id: hatch3r-my-command
type: command
description: Short description of what this file provides
---

Markdown body with the full content (instructions, templates, etc.)
```

Required frontmatter fields:

| Field         | Description                                              |
| ------------- | -------------------------------------------------------- |
| `id`          | Unique identifier, matching the filename (without `.md`) |
| `type`        | One of `agent`, `command`, `rule`, or `skill`            |
| `description` | Brief summary shown in listings and help output          |

### Examples

The repository's own `agents/`, `commands/`, `rules/`, and `skills/` directories serve as canonical examples of the expected format and conventions.

### Installing packs

Packs can be installed via:

```bash
hatch3r add <pack-name>   # coming soon
```

## Troubleshooting

For common issues with the CLI, MCP, board commands, validation, and generated files, see **[Troubleshooting](https://docs.hatch3r.com/docs/troubleshooting)**.

**Quick fixes for contributors:**
- **Build fails with ESM/module errors:** Ensure Node.js 22+: `node --version`
- **Tests fail with ENOENT/fixtures:** Run `npm run build` then `npm test`

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) to certify that contributors have the right to submit their contributions under the project's license. The DCO is a lightweight alternative to a Contributor License Agreement (CLA), well-suited for MIT-licensed open-source projects.

**Sign-off requirement:** All commits must include a sign-off. You can add it by:

- Using `git commit -s` when committing (adds `Signed-off-by:` automatically), or
- Appending `Signed-off-by: Your Name <your.email@example.com>` to your commit message.

By signing off, you certify that your contribution is under the terms of the [DCO](https://developercertificate.org/).

## Code of conduct

Be respectful and constructive in all interactions. We aim to maintain a welcoming environment for everyone.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the full Contributor Covenant, the enforcement guidelines, and the escalation ladder. Report violations to conduct@hatch3r.com.
