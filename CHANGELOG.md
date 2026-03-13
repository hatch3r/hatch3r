# Changelog

All notable changes to hatch3r are documented in this file.

## [1.2.0] - 2026-03-10

### Added

- **Worktree file isolation**: Git worktree support for parallel agent sessions — `.worktreeinclude` generation, `hatch3r worktree-setup` CLI command, `WorktreeConfig` in manifest, auto-enabled for worktree-capable tools (claude), migration checkpoint for existing projects, Claude PostToolUse hook for automatic `git worktree add` detection
- **Dynamic bridge orchestration**: `generateBridgeOrchestration()` reads skills from disk and injects a Skill Dispatch Table into every adapter's bridge output (all 12 adapters migrated from static constant to dynamic generation)
- **Inline skill checklists in AGENTS.md**: `extractSkillChecklist()` pulls condensed steps from skill content (max 20 lines per skill), displayed as "Skill Quick Reference" in canonical AGENTS.md so agents don't need a separate file read
- **Cross-reference validation**: `validateCrossReferences()` scans installed content for broken `hatch3r-*` references between agents, skills, rules, and commands — integrated into `hatch3r validate`
- **Orchestration dependency guard**: `validateOrchestrationDependencies()` warns when content selection is missing pipeline-critical agents (researcher, implementer, reviewer, test-writer, security-auditor) — checks during both `init` and `validate`
- **Spec staleness detection**: `hatch3r sync` compares `docs/specs/` file modification times against latest git commit, warns if oldest spec is >7 days old
- **Spec awareness in agents**: Implementer agent reads `docs/specs/` headers for relevant specifications; reviewer agent cross-references specs against changed files for compliance checks
- **Mandatory behavior #5**: Bridge orchestration adds "Consult specs" directive for all adapters
- **`worktree-create` and `worktree-remove` hook events**: New lifecycle hooks for worktree operations
- **`specs` manifest field**: Tracks project spec paths and generation timestamps in `hatch.json`
- **Worktree configuration in `hatch3r config`**: Interactive prompt for enabling/disabling worktree isolation
- **`test-plan` command**: Plan comprehensive test strategies with parallel researchers (coverage analysis, complexity risk, test pattern extraction, boundary analysis, risk-based prioritization). Produces test plan specs, todo.md entries, and optional ADRs. Supports feature-scoped and module/codebase-level planning. Chains to `hatch3r-test-writer` or `hatch3r-board-fill`.
- 5 new researcher modes for test planning: `coverage-analysis`, `complexity-risk`, `test-pattern`, `boundary-analysis`, `risk-prioritization`
- **Selective init with content presets**: `hatch3r init` now asks project type (greenfield/brownfield), team size (solo/team), and content profile (minimal/standard/full/custom) to install only the content files you need
- Content tagging system: all 105 content files (agents, skills, rules, commands, prompts, hooks, github-agents) tagged with workflow, context, and domain tags for intelligent filtering
- 4 content presets: **Minimal** (core agents/workflows only), **Standard** (full dev lifecycle without niche audits, recommended), **Full** (everything), **Custom** (pick exactly what you need)
- Context-aware filtering: greenfield projects exclude brownfield-only items, solo developers exclude team-only items (board commands, onboard, etc.)
- `hatch3r config` content management: add/remove individual content items post-init via interactive checkbox
- Dynamic `AGENTS.md` generation: `.agents/AGENTS.md` now reflects only installed agents, skills, and commands instead of a static roster
- `ContentSelection` tracking in `hatch.json` manifest for explicit content item tracking
- Legacy migration checkpoint: `hatch3r update` on pre-selective-init projects auto-populates content tracking from disk
- `hatch3r config` CLI command for interactive reconfiguration of tools, MCP servers, features, and platform after init
- Archive system: removed tool outputs are moved to `.hatch3r-archive/<tool>/<timestamp>/` instead of being deleted
- Customization migration: manual customizations outside managed blocks are auto-migrated to `.hatch3r/<type>/<id>.customize.md` when a tool is removed
- Shared `runUpdate()` function extracted from the update command for reuse by config
- Signal handlers (SIGINT/SIGTERM) for graceful CLI shutdown
- OTel GenAI semantic conventions for AI agent observability (gen_ai.* spans, agent invocation, tool call, LLM tracing)
- Tool call audit trail schema in observability rule
- Correlation IDs for agent workflow tracing
- External verification signals (`npm test`, `npm run lint`, `npx tsc --noEmit`) in reviewer agent
- `_hatch3r` metadata markers on generated JSON adapter configs (Claude, Gemini, Cline, OpenCode)
- `protected: true` flag on implementer, fixer, researcher agents

### Fixed

- **Structured hook activation**: All 5 hook-enabled adapters (claude, gemini, cursor, cline, kiro) now emit `HATCH3R_HOOK_ACTIVATED` directives with explicit agent protocol paths instead of generic echo placeholders — 100% of hook-based automation was previously non-functional
- **Claude TaskCompleted hook**: Replaced generic quality gate message with `HATCH3R_QUALITY_GATE` directive listing Phase 3/4 verification checks
- **Claude TeammateIdle hook**: Replaced generic pipeline message with `HATCH3R_PIPELINE_CHECK` directive listing pending Phase 4 specialist tasks
- **Adapter capabilities**: Amp `commands` and Zed `skills` flags corrected in capability matrix
- **MCP filtering**: `readFilteredMcp` now respects `manifest.mcp.servers` selection instead of emitting all servers
- **Website documentation**: stale reference counts, ghost `error-handling` rule reference, `/.agents/` path inconsistencies across 6 docs pages
- **README**: reduced from 514 to 204 lines, bridge adapter count corrected 11→13
- **Bug report template**: Node.js version updated to 22.0.0+ minimum
- **Command files**: 4 stale `.cursor/commands/` paths updated to `.agents/commands/`
- **Content system**: `Error` → `HatchError` for consistent error handling in addContentItem
- Adapter singleton warning array leakage on failed `generate()` calls
- Customization warnings silently dropped in 10 adapters (14 call sites)
- Dead `CANONICAL_AGENTS_MD` constant and unused import removed
- `execFileSync` blocking without timeout — added 30s timeout with SIGTERM kill signal

### Security

- **Atomic writes**: `safeWriteFile` now uses write-to-temp-then-rename pattern to prevent corruption on crash
- **Path traversal guard**: `assertSafePath()` validates all content paths before copy/add/remove operations
- **Symlink detection**: canonical file reader skips symlinks via `lstat()` check to prevent directory traversal
- **Homoglyph normalization**: deny-list scanning normalizes Cyrillic confusables and strips zero-width characters
- **Archive verification**: copy verified via `stat()` before removing source files
- `atomicWriteFile` now used for all manifest writes (`hatch.json`, `.integrity.json`, `.env.mcp`)
- GitHub Actions pinned to SHA digests (11 references across 4 workflows)

### Changed

- **Bridge orchestration is now dynamic**: `BaseAdapter.bridgeHeader()` changed from synchronous (static constant) to async (reads skills from disk), ensuring every adapter's bridge output includes the current skill inventory
- **safeWrite simplified**: Removed `backup` option, `createBackup()`/`writeWithBackup()` functions, and `.backups/` directory. Corrupted managed blocks now rely on git for recovery. `MergeResult.action` no longer includes `"backed-up"`.
- **`docs/specs/` in worktree isolation**: Spec files are now included in worktree copy patterns so parallel agent sessions see project specifications
- **DRY extraction**: 8 shared constants/functions extracted from init.ts and config.ts to `src/cli/shared/constants.ts`
- **`TYPE_TO_SELECTION_KEY`**: content type mapping exported as single constant (was duplicated 3x)
- **Validate command**: refactored from monolithic 362-line function into 9 focused sub-validators
- **CI workflows**: added `permissions: { contents: read }` to ci.yml and pr-checks.yml
- **PRD**: added sections for content system (FR-12), config command (FR-13), archive functionality (FR-14)
- **Competitive analysis**: updated command/MCP counts, docs site status
- **Plugin metadata**: command count updated 33→34
- `hatch3r init --yes` defaults to **standard** preset with auto-detected greenfield/brownfield and solo team size
- `hatch3r update` now respects content selections — only updates files matching the manifest's content selection (legacy projects without selections continue copying everything)
- `hatch3r validate` uses dynamic agent roster from manifest instead of hardcoded agent list
- Init summary box now shows content profile and item count breakdown
- Board commands modularized: `board-shared.md` split into core + 4 sub-files, `board-pickup.md` split into core + 7 sub-files (under `commands/board/`)
- OWASP Agentic Top 10 (ASI01–ASI10) expanded with detection heuristics, code pattern examples, and remediation steps

### Tests

- Added 200 new tests across 4 files: `tags.test.ts` (15), `verify.test.ts` (20), `content/index.test.ts` (71), `config.test.ts` (79)
- New audit test suites: `toml-utils.test.ts` (9 tests), `constants.test.ts` (15 tests), `assertSafePath.test.ts` (19 tests) — +43 tests from audit execution
- Statement/line coverage: 77.54% → 90.5% (threshold: 80%)
- Total test count: 543 → 786

### Audit Execution (103/104 findings resolved — score 79→95)

#### Added
- Amazon Q adapter — 14th platform adapter (`.amazonq/rules/`, `.amazonq/settings.json`)
- Kiro hook emission via steering file (`.kiro/steering/hatch3r-hooks.md`)
- Goose MCP config emission in `.goosehints`
- MCP setup guide (`website/docs/guides/mcp-setup.md`)
- Adapter depth strategy document (`website/docs/reference/architecture/`)
- Audit domain reports and execution templates (`audit/`)
- Migration checkpoint tests, malformed manifest tests (+65 tests total, 786→851)
- Hook condition fixtures (labels/branches)
- Base adapter error path and branch coverage tests
- Structured reasoning sections in implementer, reviewer, researcher agents
- Provenance tracking and confidence levels for learnings consumption
- Learnings dispute/correction workflow
- Token budget estimation in `hatch3r status`
- Non-JS monorepo markers (Cargo workspaces, Go workspaces, Gradle multi-project, Pants)
- Detected languages stored in manifest for tag filtering
- Content ID collision warnings in content index
- Archive pruning (max 5 entries per tool)
- MCP server name allowlist validation

#### Fixed
- `atomicWriteFile` now calls `fdatasync()` before rename for power-loss safety
- `atomicWriteFile` retries once on `EBUSY`/`EPERM` (Windows AV lock) with 100ms delay
- Managed block auto-repair now creates backup before overwriting
- Deny pattern replacement uses global regex (was only replacing first match)
- Customization input normalized: homoglyphs, boundary markers, zero-width chars, multi-line collapse
- Copilot MCP config key changed from `mcpServers` to `servers`
- Copilot envFile replaced with env object
- Windsurf trigger format corrected to YAML frontmatter
- OpenCode schema URL corrected (`config-schema.json` → `config.json`)
- Claude `teammateMode` updated to documented values
- Aider adapter now uses managed block support
- `unhandledRejection` handler prevents raw stack trace crashes
- Manifest validation now throws descriptive error (was silently returning null)
- Update timeout now shows timeout-specific message via `err.killed`/`err.signal` check
- Exit code 2 for usage/argument errors (POSIX convention)
- Signal handler drains stdout/stderr before exit
- Error messages include help URL (`https://hatch3r.dev/docs/troubleshooting`)
- `runInit` refactored from 12 positional params to `RunInitOptions` interface
- Warning array no longer reset on adapter `generate()` error
- npm pinned to `npm@11.5.1` in release workflow
- Release workflow adds `environment: npm-publish` protection
- Lockfile version synced to match package.json

#### Security
- HMAC integrity replaced with SHA-256 content-addressed hashing
- Greek-to-Latin homoglyph mappings added (~20 codepoints)
- Boundary marker spoofing blocked (strips `MANAGED-BLOCK:*` and `USER-CUSTOMIZATION:*` markers)
- MCP filesystem scope narrowed to exclude `.env.mcp`
- `npx -y` guidance expanded in security patterns
- Integrity manifest documents guarantees and limitations (no signing caveat)
- Structural verification heuristic for rule propagation to sub-agents
- Circuit breaker tracking (CLOSED/OPEN/HALF-OPEN states)

#### Changed
- Bridge orchestration minimized from ~2,500 to ~500 tokens
- Tiered rule inclusion per agent phase role
- PipelineContext schema with correlation IDs and phase handoffs
- Confirmation pass after clean reviewer verdict (non-determinism mitigation)
- Per-task review within multi-task batches
- Research completeness check before implementer handoff
- Canonical severity mapping across agent families
- Stall detection for oscillating fix-break cycles
- Blast radius summary passed from Phase 1 to specialists
- OTel span naming updated to `invoke_agent {gen_ai.agent.name}`
- Adapter capability matrix version updated to v1.2.0
- Kiro removed from Intentional Omissions in capability matrix
- Status codes standardized to SUCCESS/PARTIAL/BLOCKED
- 5 missing rules added to reference docs page
- Introduction file tree updated to show all adapter outputs
- Quick Start MCP server listing expanded

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

- Agent count expanded from 11 to 16; skills from 22 to 25; rules from 18 to 22; commands from 25 to 34
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
