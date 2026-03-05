---
sidebar_position: 3
title: Architecture
---

# Architecture

hatch3r uses a canonical content model with adapter-based generation. One source of truth in `.agents/` produces native configuration for 13 coding tools.

## Canonical Content Model

All hatch3r content lives in the `.agents/` directory. This is the single source of truth -- tool-specific outputs are generated from it.

```
.agents/
  ├── agents/          16 agent definitions (markdown with YAML frontmatter)
  ├── skills/          25 skill bundles (each a directory with SKILL.md)
  ├── rules/           22 rule files (markdown with YAML frontmatter)
  ├── commands/        33 command workflows (markdown)
  ├── prompts/         Reusable prompt templates
  ├── hooks/           Event-driven automation triggers
  ├── mcp/             MCP server configuration (mcp.json)
  ├── policy/          Guardrails and deny lists (future)
  ├── github-agents/   GitHub Copilot-specific agent definitions
  ├── AGENTS.md        Shared orchestration instructions
  └── hatch.json       Project manifest
```

### Content Types

| Type | Source Path | Frontmatter | Purpose |
|------|-----------|-------------|---------|
| **Agent** | `.agents/agents/*.md` | `id`, `type`, `description`, `model`, `readonly`, `background` | Agent role definitions with behavioral instructions |
| **Skill** | `.agents/skills/*/SKILL.md` | `id`, `type`, `description` | On-demand instruction bundles for specific tasks |
| **Rule** | `.agents/rules/*.md` | `id`, `type`, `description`, `alwaysApply`, `globs` | Persistent instructions (coding standards, conventions) |
| **Command** | `.agents/commands/*.md` | `id`, `type`, `description` | Slash-command workflows |
| **Prompt** | `.agents/prompts/*.md` | `id`, `type`, `description` | Reusable prompt templates |
| **Hook** | `.agents/hooks/*.md` | `id`, `type`, `description`, `event`, `agent` | Event-triggered automation |

All content files use markdown with YAML frontmatter. The `id` field uses the `hatch3r-` prefix (e.g., `hatch3r-code-standards`) to distinguish managed content from custom files.

## Adapter System

Adapters transform canonical content into tool-specific formats. Each adapter implements a `generate()` method that reads canonical files and produces output for its target platform.

```
.agents/ (canonical)
    │
    ├──→ Cursor adapter    → .cursor/rules/*.mdc, .cursor/agents/*.md, ...
    ├──→ Copilot adapter   → .github/copilot-instructions.md, .github/agents/*.md, ...
    ├──→ Claude adapter    → CLAUDE.md, .claude/rules/*.md, .mcp.json, ...
    ├──→ OpenCode adapter  → opencode.json, .opencode/agents/*.md, ...
    ├──→ Windsurf adapter  → .windsurfrules, .windsurf/rules/*.md, ...
    ├──→ Amp adapter       → .amp/AGENTS.md, .amp/settings.json, ...
    ├──→ Codex adapter     → AGENTS.md, .codex/config.toml, ...
    ├──→ Gemini adapter    → GEMINI.md, .gemini/settings.json, ...
    ├──→ Cline adapter     → .roomodes, .roo/rules/*.md, .roo/mcp.json, ...
    ├──→ Aider adapter     → CONVENTIONS.md, .aider.conf.yml, ...
    ├──→ Kiro adapter      → .kiro/steering/*.md, .kiro/settings/mcp.json, ...
    ├──→ Goose adapter     → .goosehints
    └──→ Zed adapter       → .rules
```

Adapters handle three emission strategies:

- **Native** -- tool has a specific config format (e.g., Cursor `.mdc` frontmatter, Copilot YAML frontmatter)
- **Bridge** -- content is folded into a single instruction file the platform reads (e.g., `AGENTS.md`, `CLAUDE.md`, `.windsurfrules`)
- **Canonical match** -- platform reads `.agents/` paths natively (e.g., Amp reads `.agents/commands/`)

See the [Adapter Capability Matrix](guides/adapter-capability-matrix) for the full per-tool breakdown.

## Managed Blocks

All hatch3r-generated markdown files use managed blocks to enable safe updates:

```markdown
<!-- HATCH3R:BEGIN -->
...managed content (updated on sync/update)...
<!-- HATCH3R:END -->

## My Custom Section
...never overwritten...
```

Only content between `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` is updated by `hatch3r sync` or `hatch3r update`. Content you add outside these markers is preserved. Config files (JSON, TOML, YAML) are fully regenerated.

## Naming Convention

hatch3r uses a prefix-based naming convention:

- `hatch3r-*` files are **managed** by hatch3r -- updated on sync
- Files without the prefix are **custom** -- never touched by hatch3r

This applies to rules, agents, skills, commands, and all generated tool-specific files.

## Agents

hatch3r ships with 16 agents, each specialized for a role in the development lifecycle:

| Agent | Role |
|-------|------|
| `hatch3r-implementer` | Focused implementation for a single sub-issue |
| `hatch3r-reviewer` | Senior code reviewer (correctness, security, performance) |
| `hatch3r-fixer` | Targeted fix agent for reviewer findings |
| `hatch3r-test-writer` | QA engineer (unit, integration, E2E tests) |
| `hatch3r-security-auditor` | Security analyst (OWASP, privacy, entitlements) |
| `hatch3r-researcher` | Deep investigation sub-agent |
| `hatch3r-architect` | Architecture design and ADR production |
| `hatch3r-docs-writer` | Technical documentation maintenance |
| `hatch3r-lint-fixer` | Code quality enforcement |
| `hatch3r-devops` | CI/CD and deployment operations |
| `hatch3r-perf-profiler` | Performance profiling and optimization |
| `hatch3r-a11y-auditor` | WCAG AA accessibility auditing |
| `hatch3r-dependency-auditor` | Supply chain security and CVE scanning |
| `hatch3r-ci-watcher` | CI/CD failure diagnosis |
| `hatch3r-context-rules` | Dynamic context rule generation |
| `hatch3r-learnings-loader` | Knowledge base consultation |

## Sub-Agentic Architecture

hatch3r includes a proven sub-agentic delegation system with a four-phase pipeline:

1. **Research** -- `hatch3r-researcher` gathers context with parallel analysis
2. **Implement** -- `hatch3r-implementer` delivers code and tests for a single sub-issue
3. **Review loop** -- `hatch3r-reviewer` checks the work; if Critical/Warning findings exist, `hatch3r-fixer` implements fixes; repeat until clean (max 3 iterations)
4. **Final quality** -- `hatch3r-test-writer` and `hatch3r-security-auditor` run in parallel (only after the review loop is clean)

The **tooling hierarchy** governs how agents find information:

1. Project specifications (`docs/specs/`)
2. Codebase search (grep, file reading)
3. Library documentation (Context7 MCP)
4. Web research (Brave Search MCP)

## Documentation Structure

hatch3r projects use a `docs/` folder with three core subdirectories maintained by the `hatch3r-docs-writer` agent:

```
docs/
  specs/        Modular specifications with stable IDs
  adr/          Architecture Decision Records
  process/      Process documentation
```

- **`docs/specs/`** -- domain-specific spec files (glossary, core engine, event model, quality engineering)
- **`docs/adr/`** -- numbered architecture decision records with context, alternatives, and consequences
- **`docs/process/`** -- guides for recurring workflows (branching, release, code review, delegation)

## MCP Integration

hatch3r configures 10 MCP (Model Context Protocol) servers:

| Server | Default | Requires Env |
|--------|---------|-------------|
| Playwright | Yes | No |
| Context7 | Yes | No |
| Filesystem | Yes | No |
| GitHub | Opt-in | `GITHUB_PAT` |
| Brave Search | Opt-in | `BRAVE_API_KEY` |
| Sentry | Opt-in | `SENTRY_AUTH_TOKEN` |
| Postgres | Opt-in | `POSTGRES_URL` |
| Linear | Opt-in | `LINEAR_API_KEY` |
| Azure DevOps | Opt-in | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_ORG` |
| GitLab | Opt-in | `GITLAB_TOKEN` |

MCP config is stored canonically in `.agents/mcp/mcp.json` and transformed by each adapter into the format its platform expects. See the [MCP Setup guide](guides/mcp-setup) for detailed configuration.
