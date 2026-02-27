# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-02-27

### Added

- `hatch3r init` -- interactive setup wizard with tool detection and MCP configuration
- `hatch3r sync` -- regenerate tool outputs from canonical `.agents/` state
- `hatch3r update` -- pull latest templates with safe merge (managed blocks preserved)
- `hatch3r validate` -- validate canonical `.agents/` structure
- `hatch3r status` -- check sync status between canonical and generated files
- `hatch3r add` -- community pack support (coming soon)
- 11 agents: reviewer, test-writer, implementer, security-auditor, ci-watcher, docs-writer, lint-fixer, a11y-auditor, perf-profiler, dependency-auditor, researcher
- 22 skills: feature, bug-fix, refactor, logical-refactor, visual-refactor, release, pr-creation, issue-workflow, qa-validation, architecture-review, incident-response, dep-audit, a11y-audit, perf-audit, context-health, cost-tracking, recipe, gh-agentic-workflows, agent-customize, command-customize, skill-customize, rule-customize
- 18 rules: code-standards, error-handling, testing, api-design, component-conventions, dependency-management, feature-flags, git-conventions, i18n, learning-consult, migrations, observability, performance-budgets, security-patterns, theming, browser-verification, agent-orchestration, tooling-hierarchy
- 25 commands: board-init, board-fill, board-pickup, board-refresh, board-shared, healthcheck, security-audit, dep-audit, release, project-spec, codebase-map, roadmap, feature-plan, bug-plan, refactor-plan, workflow, hooks, learn, context-health, cost-tracking, recipe, agent-customize, command-customize, skill-customize, rule-customize
- 9 adapters: Cursor, GitHub Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline/Roo Code
- MCP configuration template with 5 servers: GitHub, Context7, Filesystem, Playwright, Brave Search
- Sub-agentic architecture with implementer agent, issue workflow skill, and dependency-aware board pickup
- Safe merge system with `hatch3r-*` naming convention and `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` managed blocks
- Universal managed blocks across all hatch3r-generated markdown files
- Bridge orchestration with inline orchestration content across all adapter bridge files
- Browser verification integration via Playwright and cursor-ide-browser MCP
- TDD/test-first workflow option in bug-fix and feature skills
- Pre-release/RC version support in release command
- OWASP Top 10 for Agentic Applications coverage in security audit
- Per-agent, per-skill, per-command, and per-rule customization via `.customize.yaml`
- Model selection with aliases, per-agent overrides, and customization file support
- Event-driven hooks system with 18 event types
- `.env.mcp` secret management with per-editor sourcing instructions
- Cursor plugin distribution
