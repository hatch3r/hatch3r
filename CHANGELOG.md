# Changelog

All notable changes to hatch3r are documented in this file.

## [1.1.0] - 2026-03-05

### Added

- Multi-platform support: GitHub (default), Azure DevOps, and GitLab as first-class platforms
- Platform auto-detection from git remote during `hatch3r init`
- Azure DevOps MCP server integration (@tiberriver256/mcp-server-azure-devops)
- GitLab MCP server integration (glab mcp)
- 4 new adapter targets: Aider (`CONVENTIONS.md`), Kiro (`kiro.md`, specs), Goose (`.goosehints`), Zed (`.rules`)
- Fixer agent for targeted fix implementation in the agentic review loop
- Agentic review loop: reviewer + fixer cycle (max 3 iterations), four-phase pipeline (research, implement, review loop, final quality)
- Deep context analysis rule for codebase understanding and efficient context management
- `board-groom` command for ongoing backlog refinement (re-prioritize, reclassify, re-scope, archive, decompose, merge duplicates)
- `debug` command for structured root-cause analysis and debugging workflows
- `quick-change` command for small, board-free changes (typos, config tweaks, small refactors)
- `revision` command for structured post-implementation revision with specialist sub-agent delegation
- `hatch3r verify` CLI command for integrity verification of canonical sources
- `hatch3r add` CLI command for community pack installation (coming soon)
- Integrity verification system for validating `.agents/` structure and content
- MCP adapter utilities with TOML configuration support
- Package manager auto-detection (npm, yarn, pnpm, bun)
- Performance budget checks framework
- Migration infrastructure for existing users (`migrateManifest`, update checkpoints)
- Greenfield/brownfield post-init guidance
- Product vision support in `board-fill`
- Board operation batching with single-approval workflow
- Quick/defaults mode for `board-init`
- Docusaurus documentation site with getting started, architecture, configuration, and guide pages
- Agentic process diagrams and workflow documentation
- Cursor-format rule files (`.mdc`) for agent orchestration, deep context, and other rules
- PAT scope documentation with project scope guidance

### Changed

- Agent count expanded from 11 to 16; skills from 22 to 25; rules from 18 to 22; commands from 25 to 33
- MCP servers expanded from 5 to 8 (3 default + 5 opt-in: GitHub, Brave Search, Sentry, Postgres, Linear)
- Review cycle upgraded from single-pass to iterative reviewer + fixer loop (max 3 iterations)
- Board pickup now performs adaptive deep context analysis with complexity scoring and requirements elicitation
- Manifest schema version bumped to 2.0.0 with `namespace`/`project`/`repo` fields replacing `owner`/`repo` (backward-compatible)
- All board commands, agents, rules, and skills support GitHub, Azure DevOps, and GitLab
- All agents use platform-conditional CLI references
- All rules use platform-aware tooling hierarchy
- All command references standardized with `hatch3r-` prefix for consistency
- Quality improvements across all agents, commands, rules, skills, and hooks (100+ content files revised)
- CI matrix expanded to Node 22 + 24 across Ubuntu, macOS, and Windows
- PR checks: added bundle size reporting and conventional commit title validation
- Release workflow: added version tag validation against `package.json`
- Test coverage expanded with new suites for MCP utilities, CLI add command, and integrity verification
- Canonical source path corrected from `/.agents/` to `.agents/` across all references

### Fixed

- Claude Code `.mcp.json` compatibility: env var syntax and type field
- WSL multi-select checkbox rendering
- README command terminology consistency

### Removed

- `hatch3r-error-handling` rule (consolidated into security patterns and code standards)

## [1.0.0] - 2026-02-27

Initial release. Battle-tested agentic coding setup framework with 11 agents, 22 skills, 18 rules, 25 commands, and MCP integrations for Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, and Cline.
