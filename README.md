# hatch3r

[![npm version](https://img.shields.io/npm/v/hatch3r.svg)](https://www.npmjs.com/package/hatch3r)

**Crack the egg. Hatch better agents.**

hatch3r is an open-source CLI and editor plugin (Claude Code + Cursor) that installs a tool-agnostic agentic coding setup into any repository. Audited each release across 24 governance domains and generated for Claude Code, Cursor, GitHub Copilot, and Codex. One command gives you the content supported by your selected adapter (live counts in [`governance/inventory.json`](governance/inventory.json) <!-- counts auto-derived; see governance/inventory.json -->). Selective init installs only what you need based on your project type and team size.

> **Codex support:** native skills, custom agents, AGENTS.md instructions, MCP, hooks, model/effort settings, and worktrees are generated on documented project surfaces. Commands and handoffs are `$hatch3r-command-*` skill bridges, while glob rules use an AGENTS.md routing bridge; native repository slash commands, native glob-rule files, native handoffs, and an always-available question tool are not claimed.

## Quick Start

Requires Node.js 22.13+.

```bash
npx hatch3r init --default  # recommended: zero-prompt setup with the standard profile
npx hatch3r init            # interactive: customize profile, tools, and CLI tools (7 prompts for GitHub greenfield; +1 for Azure DevOps, +1 for `custom` preset, +1 for workspace mode)
```

`--default` generates a working standard-profile setup with no questions — the fastest path to a configured repo. The interactive `init` detects your repo, infers your project context (greenfield/brownfield, solo/team), then walks board platform → repo identity → content profile (minimal/standard/full/custom) → AI coding tools → CLI-tools picker, and generates everything. MCP is not prompted — opt in with `--mcp` or `npx hatch3r mcp setup` later. The board platform (GitHub, Azure DevOps, or GitLab) is auto-detected from your git remote either way. Run into issues? See [Troubleshooting](https://docs.hatch3r.com/docs/troubleshooting).

**Migrating from Cursor, Copilot, Windsurf, legacy `.cursorrules`, or a root `AGENTS.md`?** Carry your existing rules across with `npx hatch3r init --import <cursor|copilot|windsurf|cursorrules|agents|auto>` (`--import auto` imports every format in one pass) — they land under `.hatch3r/overrides/rules/` (`.md` + `.mdc`) with per-file conflict reporting. See [Migrating from another tool](https://docs.hatch3r.com/docs/getting-started/quick-start#migrating-from-another-tool).

## What You Get

| Category | Count | Highlights |
|----------|-------|-----------|
| **Agents** | 30 | Code reviewer, lint-fixer, dependency auditor, implementer (sub-agentic), fixer, researcher, architect, DevOps, handoff loader / preparer, 10 content-quality specialists (UI/UX/security/reliability/testability/scalability/performance/maintainability/enhancability/product-spec), and more |
| **Skills** | 55 | Bug fix, feature implementation, issue workflow, release, incident response, context health, cost tracking, handoff prepare / resume, recipes, API spec, CI pipeline, migration, customization, board lifecycle, ad-hoc orchestration scaffold, 5 standalone CLI-tool skills (ripgrep, jq, gh, fd, fzf) + a 34-tool `cli-toolbox`, and more |
| **Rules** | 74 | Code standards, testing, API design, observability, theming, i18n, security patterns, agent orchestration, fan-out discipline, model allocation, context budgets, right-sizing, deep context analysis, handoff readiness, mobile + backend stack rules, and more |
| **Commands** | 33 | Board management, planning (router `plan`, feature, bug, refactor, test), workflow, quick-change, bug-pipeline, rework, debug, healthcheck, security-audit, onboard, benchmark, handoff (prepare/resume/list/complete/prune), and more |
| **CLI tools** | 39 across 3 tiers | Tier-1 default, tier-2 conditional, and tier-3 opt-in tools emitted through 5 standalone skills plus the 34-tool `cli-toolbox`; see the live catalog for the complete registry-backed list |
| **MCP Servers** | 10 (opt-in) | Playwright, Context7, Filesystem, GitHub, Brave Search, Sentry, Postgres, Linear, Azure DevOps, GitLab -- pure opt-in since 2.0.0: `init --mcp` or `npx hatch3r mcp setup` (interactive init does not prompt for MCP; `features.mcp` defaults to false) |
| **Platforms** | 3 | GitHub, Azure DevOps, GitLab -- auto-detected from git remote |

## Supported Tools (4 Adapters)

| Tool | Output |
|------|--------|
| **Cursor** | `.mdc` rules, agents, skills, commands, MCP config |
| **GitHub Copilot** | instructions, prompts, GitHub agents |
| **Claude Code** | `CLAUDE.md`, skills, `.mcp.json` |
| **Codex** | `.agents/skills/`, `.codex/agents/`, `AGENTS.md`, `.codex/config.toml`, `.codex/hooks.json` |

Platform is auto-detected from your git remote during `hatch3r init`. The generated surface follows each adapter's capability row; see the [capability matrix](docs/adapter-capability-matrix.md) for native, bridged, and unsupported Codex surfaces.

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
AGENTS.md + .agents/skills/ + .codex/  <- Generated/co-tenanted Codex surfaces
.worktreeinclude                       <- Generated (worktree isolation)
```

Canonical content lives inside the bundled npm package, so end-user repos do not contain the old full `.agents/` mirror. `.hatch3r/` is the tool-neutral state directory; selected adapters also emit managed or co-tenanted files at their documented tool paths. Codex's `.agents/skills/` contains selected skill projections only. hatch3r can also manage multiple git repos from a single workspace root -- see the [Workspace guide](https://docs.hatch3r.com/docs/guides/workspace).

**Where canonical content lives:** to inspect the exact agent/rule/skill files a generated output was produced from, look inside the installed package at `node_modules/hatch3r/dist/content/` (the `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `mcp/` subtree). A global install resolves under your npm global prefix (`npm root -g` → `hatch3r/dist/content/`). This bundled tree is read-only and is the single source of truth for canonical inputs.

## Workflow

hatch3r provides a full project lifecycle, from setup to release:

1. **Initialize** -- `npx hatch3r init` detects your repo and platform, asks about profile, tools, and CLI tools, generates agents/skills/rules/commands. For headless CI, pass `--yes` (add `--mcp` to also configure MCP servers).
2. **Set up the board** -- `hatch3r-board-init` creates or connects a Projects V2 board with status fields, label taxonomy, and config writeback.
3. **Define work** -- Create a `todo.md` at the project root (one item per line).
4. **Fill the board** -- `hatch3r-board-fill` parses `todo.md`, classifies items, groups into epics, builds a dependency DAG, and marks issues `status:ready`.
5. **Groom the backlog** -- `hatch3r-board-groom` surfaces stale items, priority imbalances, and decomposition candidates.
6. **Pick up work** -- `hatch3r-board-pickup` auto-selects the next issue by dependency order and priority, creates a branch, delegates implementation, and opens a PR.
7. **Review cycle** -- Reviewer + fixer agents loop (max 3 iterations) until clean, then testability and security specialists run final checks.
8. **Release** -- `hatch3r-release` determines the semver bump, generates a changelog, tags, and publishes.

> **After init:** For greenfield, run `hatch3r-project-spec` then `hatch3r-roadmap`. For brownfield, run `hatch3r-codebase-map`. For a single feature, run `hatch3r-feature-plan`. For small changes, run `hatch3r-quick-change`.

## Commands

### CLI Commands

```bash
npx hatch3r init          # Interactive setup (or --default for zero prompts)
npx hatch3r setup [dir]   # Scaffold a new project (mkdir + git init) then run init
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
npx hatch3r add <pack>    # Install a content pack (local path or installed npm package)
```

`hatch3r cli-tools` and `hatch3r mcp` are side-door entry points for users who skipped a section during init. `cli-tools` defaults to the picker (`list`, `install`, `detect` are the other subcommands); `mcp` requires a subcommand (`setup`, `list`, `remove <id>`, `env-check`).

Every non-stub command accepts `--format <human|json>` and `--quiet`; mutating commands add `--dry-run`. `--format json` emits exactly one JSON document on stdout and is an exit-2 usage error on a prompting invocation.

### Agent Commands

Invoked inside your coding tool (e.g., as Cursor commands). All are prefixed `hatch3r-`.

- **Board management:** `board-fill`, `board-pickup` (lifecycle helpers `board-init`, `board-groom`, `board-refresh`, `board-shared` ship as skills)
- **Planning:** `plan` (router), `project-spec`, `codebase-map`, `roadmap`, `feature-plan`, `bug-plan`, `refactor-plan`, `migration-plan`, `test-plan`, `api-spec`
- **Workflow:** `workflow`, `quick-change`, `rework`, `debug`, `onboard`, `benchmark`, `hooks`, `learn`, `pr-resolve`, `handoff`
- **Operations:** `healthcheck`, `security-audit`, `report` (helpers `dep-audit`, `release`, `context-health`, `cost-tracking`, `recipe` ship as skills)
- **Customization:** `create` (single `hatch3r-customize` skill covers agent/command/skill/rule customization)

See the [CLI Commands reference](https://docs.hatch3r.com/docs/reference/commands/cli-commands) and [Agent Commands reference](https://docs.hatch3r.com/docs/reference/commands/agent-commands) for full details.

## CLI Tools

Since 1.7.5, hatch3r ships a first-class CLI-tools surface as the token-efficient alternative to MCP. The picker runs during `init` (3 tiers grouped, tier-1 default-on, tier-2 conditional on detected project signals, tier-3 opt-in). Detection probes each tool via `command -v` / `where` with a 2s timeout; the installer prints copy-paste commands grouped by package manager and never executes on your behalf. Five essentials (ripgrep, jq, gh, fd, fzf) ship as standalone skills; the remaining 34 tools live in one `hatch3r-cli-toolbox` skill, emitted to every adapter. In Codex, explicitly invoke these as `$hatch3r-cli-ripgrep` or `$hatch3r-cli-toolbox`. Manage them via `npx hatch3r cli-tools [list|install|detect]`; see the [39-tool table](https://docs.hatch3r.com/docs/getting-started/cli-tools).

## MCP Configuration

Since 1.7.5, MCP is **opt-in**; since 2.0.0 interactive `npx hatch3r init` no longer offers an MCP prompt. Without an opt-in, init skips MCP entirely -- no `.env.mcp`, no `mcp.json`, no servers in the manifest, and `features.mcp` stays false. When you opt in (`init --mcp` on any init path, or `npx hatch3r mcp setup` afterwards), hatch3r writes a gitignored `.env.mcp` with the required environment variables and MCP config to the tool-appropriate location (`.cursor/mcp.json`, `.mcp.json`, `.vscode/mcp.json`, or `.codex/config.toml`).

- **VS Code / Copilot:** secrets pass via the `env` object in `.vscode/mcp.json`.
- **Cursor / Claude Code / Codex:** source the file before launching the tool. Codex projects secret references to `env_vars`, `bearer_token_env_var`, or `env_http_headers`; it never embeds the values.

Manage MCP at any time via `npx hatch3r mcp setup | list | remove <id> | env-check`. **CI note:** interactive init no longer offers MCP, and `npx hatch3r init --yes` does not configure it by default -- opt in via `npx hatch3r mcp setup` or `init --mcp`. See [MCP Setup](https://docs.hatch3r.com/docs/guides/mcp-setup) for per-server details and PAT scope guidance.

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

A four-phase pipeline (Research, Implement, Review Loop with reviewer + fixer at max 3 iterations, Final Quality with testing + security) drives implementation. The implementer agent receives a single sub-issue and returns code + tests; the fixer agent applies targeted fixes from reviewer findings; the issue-workflow skill runs an 8-step flow with parallel sub-agent delegation for epics. Tooling hierarchy: project docs > codebase search > library docs (Context7) > web research. See [Agent Teams](https://docs.hatch3r.com/docs/guides/agent-teams) for delegation patterns; hatch3r is complementary to rule-distribution tools like Ruler — it owns the full generation pipeline rather than distributing a single instruction file.

## Why hatch3r vs just AGENTS.md?

AGENTS.md (Linux Foundation AAIF spec, 60K+ repos as of January 2026) is the greatest-common-denominator markdown standard for agent instructions; it is consumed by 20+ tools including Cursor, Copilot, Codex, and Gemini CLI. In Codex, instruction discovery walks from the repository root to the current working directory and loads one active Markdown file per directory, with `AGENTS.override.md` taking precedence over `AGENTS.md` in that directory. hatch3r complements that native hierarchy by projecting managed instruction blocks and owning their sync, update, archive, and clean lifecycle across 4 supported adapters (Claude Code, Cursor, GitHub Copilot, and Codex). Three measurable differences:

- **Scope:** Native AGENTS instructions are hierarchical Markdown, with one active file per directory on the root-to-CWD path; hatch3r lifecycle-manages its regions within that surface and generates additional platform-specific structured output (`.mdc` rules with frontmatter scoping for Cursor, `CLAUDE.md` with managed blocks for Claude Code, `.github/instructions/` + `.github/prompts/` for Copilot) plus board commands, MCP server configs, and event-driven hooks.
- **Currency:** AGENTS.md content is hand-edited per project; hatch3r ships canonical content (30 agents + 74 rules + 55 skills + 33 commands + 7 hooks + 10 MCP servers — see [`governance/inventory.json`](governance/inventory.json)) audited each release across 24 governance domains.
- **Adoption path:** AGENTS.md remains the spec hatch3r-emitted configurations align with. Codex uses native project skills, subagents, instructions, MCP, and hooks plus explicit command/rule bridges where no native surface exists. Use AGENTS.md alone when one flat file suffices; use hatch3r when managed reusable content and lifecycle support matter.

## Customization

hatch3r separates managed from custom files:

- `hatch3r-*` files are managed and fully replaced on update; files without the prefix are your customizations and are never touched.
- All hatch3r-generated markdown uses managed blocks (`<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->`); content outside the markers is preserved.
- User-authored canonical overrides live under `.hatch3r/overrides/` (escape hatch); adapters prefer overrides over bundled content.
- Configure preferred AI models per agent via `hatch.json` (global default + per-agent overrides), agent frontmatter, or `.hatch3r/agents/{id}.customize.yaml`. Resolution order: customization file > manifest per-agent > agent frontmatter > manifest default. See [Model Selection](https://docs.hatch3r.com/docs/guides/model-selection).

## Editor Plugin

hatch3r ships plugin manifests for both Claude Code (`.claude-plugin/marketplace.json`) and Cursor (`.cursor-plugin/plugin.json`). Install it straight from this repo as a marketplace — in Claude Code, run `/plugin marketplace add hatch3r/hatch3r` then `/plugin install hatch3r@hatch3r` — for access to all rules, skills, agents, and commands without running `init`.

## Documentation

Full documentation is at [docs.hatch3r.com](https://docs.hatch3r.com).

- [Vision](https://docs.hatch3r.com/docs/about) -- Framework north-star vision and principles
- [MCP Setup](https://docs.hatch3r.com/docs/guides/mcp-setup) -- Connecting MCP servers and managing secrets
- [Adapter Capability Matrix](https://docs.hatch3r.com/docs/reference/adapter-capability-matrix) -- Per-tool support and output paths
- [Agentic Process](https://docs.hatch3r.com/docs/guides/agentic-process) -- Visual diagrams of init flow, board workflow, and agent orchestration
- [Troubleshooting](https://docs.hatch3r.com/docs/troubleshooting) -- Common issues and solutions
- [Changelog](CHANGELOG.md) -- Release history

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and DCO sign-off requirement, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards, and [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made. Report security issues privately via [SECURITY.md](SECURITY.md).

## License

MIT
