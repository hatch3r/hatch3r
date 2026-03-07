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

- `src/cli/` - CLI entry point and commands
- `src/adapters/` - Tool-specific adapters (Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code, Aider, Kiro, Goose, Zed)
- `src/merge/` - Safe merge logic for template updates
- `src/detect/` - Tool detection utilities
- `src/manifest/` - Manifest and pack metadata handling
- `src/models/` - Model alias resolution and customization
- `src/env/` - MCP environment variable handling
- `src/hooks/` - Hook system definitions and parsing
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

For common issues with the CLI, MCP, board commands, validation, and generated files, see **[docs/troubleshooting.md](docs/troubleshooting.md)**.

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
