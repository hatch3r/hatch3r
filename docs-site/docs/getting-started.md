---
sidebar_position: 1
title: Getting Started
---

# Getting Started

hatch3r is an open-source CLI that installs a battle-tested, tool-agnostic agentic coding setup into any repository. One command gives you 16 agents, 25 skills, 22 rules, 33 commands, and MCP integrations -- optimized for your coding tool of choice.

## Prerequisites

- **Node.js 22+** -- check with `node --version`
- A git repository (local or remote)
- One or more supported coding tools (Cursor, Copilot, Claude Code, etc.)

## Install and Initialize

Run a single command from your project root:

```bash
npx hatch3r init
```

The interactive setup will:

1. **Detect your repository and platform** -- reads `git remote` to determine owner/repo and auto-detect the platform (GitHub, Azure DevOps, or GitLab)
2. **Ask which tools you use** -- Cursor, Copilot, Claude Code, OpenCode, Windsurf, Amp, Codex CLI, Gemini CLI, Cline, Aider, Kiro, Goose, Zed
3. **Ask which MCP servers to enable** -- Playwright, Context7, Filesystem (default); platform-specific server plus Brave Search, Sentry, Postgres, Linear (opt-in)
4. **Generate everything** -- agents, skills, rules, commands, MCP config, and tool-specific outputs (all platform-aware)

After init completes, you'll have:

```
.agents/              ← Canonical source (tool-agnostic)
  ├── agents/         ← 16 agent definitions
  ├── skills/         ← 25 skill bundles
  ├── rules/          ← 22 rule files
  ├── commands/       ← 33 command workflows
  ├── mcp/            ← MCP server config
  └── hatch.json      ← Project manifest

.cursor/              ← Generated (if Cursor selected)
.github/              ← Generated (if Copilot selected)
CLAUDE.md             ← Generated (if Claude Code selected)
.env.mcp              ← Secrets template (gitignored)
```

## Configure Secrets

If you enabled MCP servers that require API keys, fill in your secrets:

```bash
# Open the generated .env.mcp file
# Fill in your API keys (platform-specific)
GITHUB_PAT=ghp_xxxxxxxxxxxx          # GitHub
AZURE_DEVOPS_PAT=xxxxxxxxxxxx        # Azure DevOps
AZURE_DEVOPS_ORG=my-org              # Azure DevOps
GITLAB_TOKEN=glpat-xxxxxxxxxxxx      # GitLab
BRAVE_API_KEY=xxxxxxxx               # Brave Search (optional)
```

Then load secrets before launching your editor:

```bash
# macOS/Linux
set -a && source .env.mcp && set +a && cursor .

# Windows (PowerShell)
Get-Content .env.mcp | ForEach-Object { if ($_ -match '^\s*([^#][^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process') } }
```

**VS Code / Copilot** loads `.env.mcp` automatically via the `envFile` field -- no sourcing needed.

See the [MCP Setup guide](guides/mcp-setup) for detailed per-server configuration and PAT scope guidance.

## First Workflow

After initialization, choose your starting point:

### New project (greenfield)

```
hatch3r-project-spec   → Generate specs from your project vision
hatch3r-roadmap        → Create a phased plan with epics
hatch3r-board-init     → Set up a GitHub Projects V2 board
hatch3r-board-fill     → Turn todo.md into GitHub issues
```

### Existing project (brownfield)

```
hatch3r-codebase-map   → Analyze your codebase structure
hatch3r-roadmap        → Plan improvements from the analysis
hatch3r-board-init     → Set up a GitHub Projects V2 board
hatch3r-board-fill     → Turn todo.md into GitHub issues
```

### Quick tasks (no board needed)

```
hatch3r-quick-change   → Typo fixes, config tweaks, small refactors
hatch3r-workflow       → Guided 4-phase development lifecycle
hatch3r-debug          → Standalone debug-and-fix
```

## Changing Your Configuration

Need to add or remove tools, MCP servers, or change your platform after init? Run:

```bash
npx hatch3r config
```

This interactive command re-presents all configuration prompts pre-populated with your current settings, safely archives removed tool outputs, migrates any manual customizations you've added to generated files, and runs a full update. See the [Command Reference](command-reference#hatch3r-config) for the full walkthrough.

## Keeping Up to Date

```bash
npx hatch3r config     # Reconfigure tools, MCP servers, features, platform
npx hatch3r sync       # Re-generate tool outputs from canonical source
npx hatch3r update     # Pull latest hatch3r templates (safe merge)
npx hatch3r status     # Check sync status between canonical and generated files
npx hatch3r validate   # Validate .agents/ structure
```

## Supported Tools

| Tool | Output |
|------|--------|
| **Cursor** | `.mdc` rules, agents, skills, commands, MCP config |
| **GitHub Copilot** | instructions, prompts, GitHub agents |
| **Claude Code** | `CLAUDE.md`, skills, `.mcp.json` |
| **OpenCode** | `AGENTS.md`, `opencode.json` |
| **Windsurf** | `.windsurfrules` |
| **Amp** | `AGENTS.md` |
| **Codex CLI** | `AGENTS.md`, `codex.md` |
| **Gemini CLI** | `GEMINI.md` |
| **Cline / Roo Code** | `.clinerules`, `.cursorrules` |
| **Aider** | `CONVENTIONS.md` |
| **Kiro** | `kiro.md`, specs |
| **Goose** | `.goosehints` |
| **Zed** | `.rules` |

## Supported Platforms

hatch3r supports **GitHub**, **Azure DevOps**, and **GitLab** as first-class platforms. Platform is auto-detected from your git remote during init. All board commands, agents, and rules adapt to your selected platform. See [MCP Setup](guides/mcp-setup) for platform-specific PAT and token configuration.

## Next Steps

- [Command Reference](command-reference) -- all 33 commands with descriptions
- [Architecture](architecture) -- how hatch3r's content model and adapters work
- [Configuration](configuration) -- `hatch.json`, `.env.mcp`, and adapter settings
- [Agentic Process](guides/agentic-process) -- visual diagrams of init flow and agent orchestration
- [Troubleshooting](guides/troubleshooting) -- common issues and solutions
