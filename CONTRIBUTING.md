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
- `src/adapters/` - Tool-specific adapters (Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code)
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

For creating or modifying community packs, see the [Pack Authoring Guide](hatch3r-prd.md#pack-authoring-guide).

## Troubleshooting

For common issues with the CLI, MCP, board commands, validation, and generated files, see **[docs/troubleshooting.md](docs/troubleshooting.md)**.

**Quick fixes for contributors:**
- **Build fails with ESM/module errors:** Ensure Node.js 22+: `node --version`
- **Tests fail with ENOENT/fixtures:** Run `npm run build` then `npm test`

## Code of conduct

Be respectful and constructive in all interactions. We aim to maintain a welcoming environment for everyone.
