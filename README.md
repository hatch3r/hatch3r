# hatch3r

[![npm version](https://img.shields.io/npm/v/hatch3r.svg)](https://www.npmjs.com/package/hatch3r)

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI and Cursor plugin that installs a tool-agnostic agentic coding setup into any repository. Audited each release across 24 governance domains and generated for 3 platform adapters (Claude Code, Cursor, GitHub Copilot). One command gives you the full set of agents, skills, rules, commands, hooks, and MCP integrations -- optimized for your coding tool of choice (live counts in [`governance/inventory.json`](governance/inventory.json) <!-- counts auto-derived; see governance/inventory.json -->). Selective init installs only what you need based on your project type and team size.

> **v1.9.0 scope cut:** As of 1.9.0 hatch3r supports only Claude Code, Cursor, and GitHub Copilot. Twelve adapters were removed in a hard cut; canonical content is now read from the bundled npm package (no `.agents/` materialization in user repos), and the manifest moved to `.hatch3r/hatch.json`. See [CHANGELOG.md](CHANGELOG.md) for the full breaking-change list and migration notes.

## Quick Start

Requires Node.js 22+.

```bash
npx hatch3r init --default  # recommended: zero-prompt setup with the standard profile
npx hatch3r init            # interactive: customize tools, profile, and MCP (asks <=5 questions)
```

`--default` generates a working standard-profile setup with no questions — the fastest path to a configured repo. The interactive `init` detects your repo, asks about your project context (greenfield/brownfield, solo/team), lets you choose a content profile (minimal/standard/full/custom), and generates everything. The platform (GitHub, Azure DevOps, or GitLab) is auto-detected from your git remote either way. Run into issues? See [Troubleshooting](https://docs.hatch3r.com/docs/troubleshooting).

## What You Get

| Category | Count | Highlights |
|----------|-------|-----------|
| **Agents** | 30 | Code reviewer, test writer, security auditor, implementer (sub-agentic), fixer, researcher, architect, DevOps, handoff loader / preparer, 9 content-quality specialists (UI/UX/security/reliability/testability/scalability/performance/maintainability/enhancability), and more |
| **Skills** | 43 | Bug fix, feature implementation, issue workflow, release, incident response, context health, cost tracking, handoff prepare / resume, recipes, API spec, CI pipeline, migration, customization, board lifecycle, 5 standalone CLI-tool skills (ripgrep, jq, gh, fd, fzf) + a 24-tool `cli-toolbox`, and more |
| **Rules** | 56 | Code standards, testing, API design, observability, theming, i18n, security patterns, agent orchestration, deep context analysis, handoff readiness, mobile + backend stack rules, and more |
| **Commands** | 23 | Board management, planning (feature, bug, refactor, test), workflow, quick-change, revision, debug, healthcheck, security-audit, onboard, benchmark, handoff (prepare/resume/list/complete/prune), and more |
| **CLI tools** | 29 across 3 tiers | Tier-1 default (ripgrep, fd, jq, yq, gh, delta, bat, sd, ast-grep, zstd); tier-2 conditional (Playwright, duckdb, qsv, taplo, glab, az-devops, Docker, llm, fzf, lazygit, difftastic); tier-3 opt-in (RTK, Stagehand, aichat, mods, Comby, miller, csvkit, Podman) -- emitted as per-tool canonical skills + a decision-tree overview |
| **MCP Servers** | 10 (opt-in) | Playwright, Context7, Filesystem, GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab -- gated behind a Yes/No prompt during `init` (default No since 1.7.5; pass `--mcp` to restore prior `--yes` behavior) |
| **Platforms** | 3 | GitHub, Azure DevOps, GitLab -- auto-detected from git remote |

## Supported Tools (3 Adapters)

| Tool | Output |
|------|--------|
| **Cursor** | `.mdc` rules, agents, skills, commands, MCP config |
| **GitHub Copilot** | instructions, prompts, GitHub agents |
| **Claude Code** | `CLAUDE.md`, skills, `.mcp.json` |

Platform is auto-detected from your git remote during `hatch3r init`. All board commands, agents, rules, and skills adapt to your selected platform.

## How It Works

```
.hatch3r/                              <- hatch3r footprint in your repo
  ├── hatch.json                       <- Manifest
  ├── overrides/                       <- User-authored canonical overrides (escape hatch)
  ├── learnings/                       <- /learn-captured project knowledge
  ├── handoffs/                        <- Cross-session handoff bundles
  └── mcp/mcp.json                     <- Resolved MCP server config

.claude/                               <- Generated (Claude Code adapter) + CLAUDE.md at repo root
.cursor/                               <- Generated (Cursor adapter)
.github/copilot-instructions.md        <- Generated (Copilot adapter, plus .github/instructions, .github/prompts, .github/agents)
.worktreeinclude                       <- Generated (worktree isolation)
```

Canonical content (agents, skills, rules, commands, hooks) lives inside the bundled npm package -- adapters read from there directly, so end-user repos no longer contain a `.agents/` mirror. The only hatch3r-managed directory in your repo is `.hatch3r/`. hatch3r can also manage multiple git repos from a single workspace root -- see the [Workspace guide](https://docs.hatch3r.com/docs/guides/workspace).

## Workflow

hatch3r provides a full project lifecycle, from setup to release:

1. **Initialize** -- `npx hatch3r init` detects your repo and platform, asks about context and profile, generates agents/skills/rules/commands/MCP. For headless CI, pass `--yes` (add `--mcp` to keep MCP servers).
2. **Set up the board** -- `hatch3r-board-init` creates or connects a Projects V2 board with status fields, label taxonomy, and config writeback.
3. **Define work** -- Create a `todo.md` at the project root (one item per line).
4. **Fill the board** -- `hatch3r-board-fill` parses `todo.md`, classifies items, groups into epics, builds a dependency DAG, and marks issues `status:ready`.
5. **Groom the backlog** -- `hatch3r-board-groom` surfaces stale items, priority imbalances, and decomposition candidates.
6. **Pick up work** -- `hatch3r-board-pickup` auto-selects the next issue by dependency order and priority, creates a branch, delegates implementation, and opens a PR.
7. **Review cycle** -- Reviewer + fixer agents loop (max 3 iterations) until clean, then test-writer and security-auditor run final checks.
8. **Release** -- `hatch3r-release` determines the semver bump, generates a changelog, tags, and publishes.

> **After init:** For greenfield, run `hatch3r-project-spec` then `hatch3r-roadmap`. For brownfield, run `hatch3r-codebase-map`. For a single feature, run `hatch3r-feature-plan`. For small changes, run `hatch3r-quick-change`.

## Commands

### CLI Commands

```bash
npx hatch3r init          # Interactive setup (or --default for zero prompts)
npx hatch3r config        # Reconfigure tools, MCP servers, features, and platform
npx hatch3r sync          # Re-generate from canonical state
npx hatch3r update        # Pull latest templates (safe merge)
npx hatch3r status        # Check sync status between canonical and generated files
npx hatch3r validate      # Validate bundled canonical content + on-disk adapter outputs
npx hatch3r verify        # Drift check on adapter outputs (non-zero exit on drift)
npx hatch3r clean         # Remove generated files (optional --reinit)
npx hatch3r worktree-setup <path>   # Set up gitignored files in a worktree
npx hatch3r worktree-cleanup <path> # Clean up worktree-specific files
npx hatch3r cli-tools     # Manage CLI tools (picker / list / install / detect)
npx hatch3r mcp           # Manage MCP servers (setup / list / remove / env-check)
npx hatch3r add <pack>    # Install a community pack (coming soon)
```

`hatch3r cli-tools` and `hatch3r mcp` are side-door entry points for users who skipped a section during init. `cli-tools` defaults to the picker (`list`, `install`, `detect` are the other subcommands); `mcp` requires a subcommand (`setup`, `list`, `remove <id>`, `env-check`).

### Agent Commands

Invoked inside your coding tool (e.g., as Cursor commands). All are prefixed `hatch3r-`.

- **Board management:** `board-fill`, `board-pickup` (lifecycle helpers `board-init`, `board-groom`, `board-refresh`, `board-shared` ship as skills)
- **Planning:** `project-spec`, `codebase-map`, `roadmap`, `feature-plan`, `bug-plan`, `refactor-plan`, `migration-plan`, `test-plan`, `api-spec`
- **Workflow:** `workflow`, `quick-change`, `revision`, `debug`, `onboard`, `benchmark`, `hooks`, `learn`, `pr-resolve`, `handoff`
- **Operations:** `healthcheck`, `security-audit`, `report` (helpers `dep-audit`, `release`, `context-health`, `cost-tracking`, `recipe` ship as skills)
- **Customization:** `create` (single `hatch3r-customize` skill covers agent/command/skill/rule customization)

See the [CLI Commands reference](https://docs.hatch3r.com/docs/reference/commands/cli-commands) and [Agent Commands reference](https://docs.hatch3r.com/docs/reference/commands/agent-commands) for full details.

## CLI Tools

Since 1.7.5, hatch3r ships a first-class CLI-tools surface as the token-efficient alternative to MCP. The picker runs during `init` (3 tiers grouped, tier-1 default-on, tier-2 conditional on detected project signals, tier-3 opt-in). Detection probes each tool via `command -v` / `where` with a 2s timeout; the installer prints copy-paste commands grouped by package manager and never executes on your behalf. 5 essentials (ripgrep, jq, gh, fd, fzf) ship as standalone skills; the remaining 24 tools live in a single `hatch3r-cli-toolbox` skill, emitted to all 3 adapters. Manage at any time via `npx hatch3r cli-tools [list|install|detect]`. See [CLI Tools](https://docs.hatch3r.com/docs/getting-started/cli-tools) for the full 29-tool table and the trade-off discussion vs MCP.

## MCP Configuration

Since 1.7.5, MCP is **opt-in**. `npx hatch3r init` gates MCP behind a Yes/No prompt (default No) after the features picker. Declining skips MCP entirely -- no `.env.mcp`, no `mcp.json`, no servers in the manifest. When you accept, `hatch3r init` writes a gitignored `.env.mcp` with the required environment variables and MCP config to the tool-appropriate location (`.cursor/mcp.json`, `.mcp.json`, `.vscode/mcp.json`).

- **VS Code / Copilot:** secrets pass via the `env` object in `.vscode/mcp.json`.
- **Cursor / Claude Code / others:** source the file first: `set -a && source .env.mcp && set +a && cursor .`

Manage MCP at any time via `npx hatch3r mcp setup | list | remove <id> | env-check`. **CI note:** as of 1.7.5, `npx hatch3r init --yes` no longer configures MCP by default -- add `--mcp` to restore prior behavior. See [MCP Setup](https://docs.hatch3r.com/docs/guides/mcp-setup) for per-server details and PAT scope guidance.

## Content Profiles

During `hatch3r init`, you choose a content profile:

| Profile | What's included | Best for |
|---------|----------------|----------|
| **Minimal** | Core agents and workflows only (`core` tag) | Quick setup, minimal footprint |
| **Standard** (recommended) | Full lifecycle; drops AI feature engineering + performance capability clusters -- pick Full if you need those | Most projects |
| **Full** | Everything including board management and all audits | Large teams, full coverage |
| **Custom** | Choose exactly what you need | Fine-grained control |

After init, use `hatch3r config` to add or remove individual content items.

## Sub-Agentic Architecture

A four-phase pipeline (Research, Implement, Review Loop with reviewer + fixer at max 3 iterations, Final Quality with testing + security) drives implementation. The implementer agent receives a single sub-issue and returns code + tests; the fixer agent applies targeted fixes from reviewer findings; the issue-workflow skill runs an 8-step flow with parallel sub-agent delegation for epics. Tooling hierarchy: project docs > codebase search > library docs (Context7) > web research. See [Agent Teams](https://docs.hatch3r.com/docs/guides/agent-teams) for delegation patterns and [governance/COMPETITIVE-ANALYSIS.md](governance/COMPETITIVE-ANALYSIS.md) for how hatch3r compares to rule-distribution tools like Ruler.

## Customization

hatch3r separates managed from custom files:

- `hatch3r-*` files are managed and fully replaced on update; files without the prefix are your customizations and are never touched.
- All hatch3r-generated markdown uses managed blocks (`<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->`); content outside the markers is preserved.
- User-authored canonical overrides live under `.hatch3r/overrides/` (escape hatch); adapters prefer overrides over bundled content.
- Configure preferred AI models per agent via `hatch.json` (global default + per-agent overrides), agent frontmatter, or `.hatch3r/agents/{id}.customize.yaml`. Resolution order: customization file > manifest per-agent > agent frontmatter > manifest default. See [Model Selection](https://docs.hatch3r.com/docs/guides/model-selection).

## Cursor Plugin

hatch3r is also available as a [Cursor plugin](https://cursor.com/marketplace). Enable it for instant access to all rules, skills, agents, and commands without running `init`.

## Documentation

Full documentation is at [docs.hatch3r.com](https://docs.hatch3r.com).

- [Vision](governance/VISION.md) -- Framework north-star vision and principles
- [MCP Setup](https://docs.hatch3r.com/docs/guides/mcp-setup) -- Connecting MCP servers and managing secrets
- [Adapter Capability Matrix](https://docs.hatch3r.com/docs/reference/adapter-capability-matrix) -- Per-tool support and output paths
- [Agentic Process](https://docs.hatch3r.com/docs/guides/agentic-process) -- Visual diagrams of init flow, board workflow, and agent orchestration
- [Troubleshooting](https://docs.hatch3r.com/docs/troubleshooting) -- Common issues and solutions
- [Changelog](CHANGELOG.md) -- Release history

## License

MIT
