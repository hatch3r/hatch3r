# Adapter Capability Matrix

> **Last verified**: 2026-02-27 | **hatch3r version**: 1.0.0

Living reference for framework capabilities vs. adapter implementations. This document tracks what each adapter emits, what each platform supports natively, and where gaps remain.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Y** | Adapter emits files for this capability |
| **~** | Platform reads canonical `.agents/` paths natively; no adapter output needed |
| **B** | Bridge: content folded into an instruction file the platform reads (AGENTS.md, CLAUDE.md, GEMINI.md, etc.) |
| **--** | Platform has no known support for this capability |
| **skip** | Platform supports this but only globally (not project-scoped); intentionally omitted |

---

## Framework Capabilities

| Capability | Canonical Source | Description |
|------------|------------------|-------------|
| **rules** | `.agents/rules/` | Persistent instructions (coding standards, conventions) |
| **agents** | `.agents/agents/` | Agent definitions / custom modes |
| **agent model** | `hatch.json`, agent frontmatter, `.hatch3r/agents/{id}.customize.yaml` | Per-agent AI model preference (opus, sonnet, codex, etc.) |
| **skills** | `.agents/skills/*/SKILL.md` | On-demand instruction bundles for specific tasks |
| **prompts** | `.agents/prompts/` | Reusable prompt templates |
| **commands** | `.agents/commands/` | Slash-command workflows |
| **mcp** | `.agents/mcp/mcp.json` | Model Context Protocol server config |
| **guardrails** | `.agents/policy/` | Deny lists, command restrictions |
| **githubAgents** | `.agents/github-agents/` | GitHub Copilot-specific agent definitions |
| **hooks** | `.agents/hooks/` | Event-triggered automation (pre-commit, session-start, etc.) |

---

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | githubAgents | hooks | model |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:------------:|:-----:|:-----:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y |
| **copilot** | Y | Y | Y | Y | Y | Y | -- | Y | -- | Y |
| **claude** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y |
| **cline** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y |
| **codex** | B | B | Y | -- | -- | Y | -- | -- | -- | Y |
| **gemini** | Y | B | Y | -- | Y | Y | -- | -- | Y | Y |
| **windsurf** | Y | B | Y | -- | Y | Y | -- | -- | -- | Y |
| **amp** | B | B | Y | -- | ~ | Y | -- | -- | -- | Y |
| **opencode** | Y | Y | Y | -- | Y | Y | -- | -- | -- | Y |
| **aider** | B | B | Y | -- | -- | -- | -- | -- | -- | Y |
| **kiro** | Y | B | Y | -- | -- | Y | -- | -- | -- | Y |
| **goose** | B | B | B | -- | -- | -- | -- | -- | -- | Y |
| **zed** | B | B | -- | -- | -- | -- | -- | -- | -- | Y |

### Agent Model Customization

All adapters emit model preferences when configured via `hatch.json`, agent frontmatter, or `.hatch3r/agents/{id}.customize.yaml`. Resolution order: customization file > manifest per-agent > agent frontmatter > manifest default. See [model-selection.md](model-selection.md) for configuration, aliases, and platform behavior. Use the `hatch3r-agent-customize` command for per-agent overrides.

| Adapter | Emission | Notes |
|---------|----------|-------|
| **cursor** | Native | `model:` in agent YAML frontmatter |
| **copilot** | Native (VS Code) | `model:` in agent YAML; ignored on github.com |
| **opencode** | Native | `model: provider/id` in agent config |
| **codex** | Native | `model = "id"` in TOML agent section |
| **claude** | Guidance | Text in agent content: `/model` and env var |
| **cline** | Guidance | Text in `roleDefinition` |
| **gemini** | Guidance | Text in GEMINI.md |
| **windsurf** | Guidance | Text in .windsurfrules |
| **amp** | Guidance | Text in .amp/AGENTS.md |
| **aider** | Guidance | Text in CONVENTIONS.md |
| **kiro** | Guidance | Text in .kiro/steering/hatch3r-agents.md |
| **goose** | Guidance | Text in .goosehints |
| **zed** | Guidance | Text in .rules |

---

## Bridge Orchestration

All adapters that emit bridge files (Cursor, Claude, Copilot, Gemini, Windsurf, Amp) now include **inline orchestration content** from a shared constant (`BRIDGE_ORCHESTRATION` in `src/cli/shared/agentsContent.ts`). This content comprises:

- **Mandatory Behaviors** — 6 directives (load skill, spawn researcher, spawn specialists, use Task tool, propagate rules, consult learnings)
- **Agent Quick Reference** — Table of 11 agents with "When to Use"
- **Canonical Structure** — Paths for rules, agents, skills, commands, MCP, policy

Previously only the Cursor adapter inlined this content; others merely referenced `/.agents/AGENTS.md`. Inlining ensures every platform receives orchestration guidance directly in context, improving instruction-following reliability. Codex and OpenCode reference `.agents/AGENTS.md` via config and do not emit bridge markdown files.

---

## File Path Mapping

### Cursor

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.cursor/rules/hatch3r-{id}.mdc` | MDC frontmatter (`description`, `alwaysApply`, `globs`) |
| agents | `.cursor/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`) |
| skills | `.cursor/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| commands | `.cursor/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.cursor/mcp.json` | Direct copy of canonical MCP config |
| hooks | `.cursor/rules/hatch3r-hook-{id}.mdc` | MDC rule with hook event metadata |
| bridge | `.cursor/rules/hatch3r-bridge.mdc` | Always-apply rule with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference |

### Copilot

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules (always) | `.github/copilot-instructions.md` | Managed block with inlined rules |
| bridge | `.github/copilot-instructions.md` | Inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference, above rules |
| rules (scoped) | `.github/instructions/hatch3r-{id}.instructions.md` | YAML frontmatter (`applyTo`) |
| agents | `.github/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`) |
| skills | `.github/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| prompts | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content |
| commands | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content (mapped to prompts) |
| githubAgents | `.github/agents/hatch3r-{id}.md` | Raw content |
| mcp | `.vscode/mcp.json` | Canonical MCP config with `envFile: "${workspaceFolder}/.env.mcp"` injected on STDIO servers |
| setup | `.github/copilot-setup-steps.yml` | YAML build steps |

### Claude

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.claude/rules/hatch3r-{id}.md` | Header + description + content |
| agents | `.claude/agents/hatch3r-{id}.md` | YAML frontmatter (`description`) + model guidance in content |
| skills | `.claude/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.claude/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.mcp.json` | Direct copy of canonical MCP config |
| hooks | `.claude/settings.json` | Claude event mapping (PreToolUse, PostToolUse, etc.) |
| bridge | `CLAUDE.md` | Managed block with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference |

### Cline / Roo Code

| Capability | Output Path | Format |
|------------|-------------|--------|
| agents | `.roomodes` | JSON (`customModes` array with slug/roleDefinition/groups) |
| rules | `.roo/rules/hatch3r-{id}.md` | Header + description + content |
| skills | `.cline/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.clinerules/workflows/hatch3r-{id}.md` | Raw content (mapped to workflows) |
| mcp | `.roo/mcp.json` | JSON with transport type mapping |
| hooks | `.roo/rules/hatch3r-hook-{id}.md` | Rule with hook event/agent metadata |

### Codex

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.codex/config.toml` | `model_instructions_file` reference to AGENTS.md (bridge) |
| agents | `.codex/config.toml` | `[agents.{id}]` sections with `model_instructions_file`, optional `model` |
| skills | `.codex/skills/hatch3r-{id}/SKILL.md` | Raw content |
| mcp | `.codex/config.toml` | `[mcp_servers.{name}]` TOML sections |

### Gemini

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `GEMINI.md` | Inlined into managed block |
| agents | `GEMINI.md` | Inlined into managed block (bridge) |
| skills | `.gemini/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.gemini/commands/hatch3r-{id}.toml` | TOML (`description`, `prompt`) |
| mcp | `.gemini/settings.json` | JSON `mcpServers` object |
| hooks | `.gemini/settings.json` | Gemini event mapping (BeforeTool, AfterTool, etc.) |
| bridge | `GEMINI.md` | Managed block with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference |

### Windsurf

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.windsurf/rules/hatch3r-{id}.md` | YAML frontmatter (`trigger`, `globs`) |
| agents | `.windsurfrules` | Inlined into managed block (bridge) |
| skills | `.windsurf/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| commands | `.windsurf/workflows/hatch3r-{id}.md` | Raw content |
| mcp | `.windsurf/mcp.json` | Direct copy of canonical MCP config |
| bridge | `.windsurfrules` | Managed block with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference |

### Amp

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.amp/AGENTS.md` | Inlined into managed block (bridge) |
| agents | `.amp/AGENTS.md` | Inlined into managed block (bridge) |
| bridge | `.amp/AGENTS.md` | Inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference, above rules/agents |
| skills | `.amp/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | *(canonical match)* | Amp reads `.agents/commands/` natively |
| mcp | `.amp/settings.json` | JSON `amp.mcpServers` object |

### OpenCode

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `opencode.json` | `instructions` array with glob references |
| agents | `.opencode/agents/hatch3r-{id}.md` | YAML frontmatter (`description`, `model`) |
| skills | `.opencode/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.opencode/commands/hatch3r-{id}.md` | Raw content |
| mcp | `opencode.json` | JSON `mcp` object with type/command/url |

### Aider

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `CONVENTIONS.md` | Inlined into managed block (bridge) |
| agents | `CONVENTIONS.md` | Inlined into managed block (bridge) |
| skills | `.aider/skills/hatch3r-{id}/SKILL.md` | Raw content |
| bridge | `CONVENTIONS.md` | Managed block with inline orchestration + canonical reference |
| config | `.aider.conf.yml` | YAML config with `read: CONVENTIONS.md` |

### Kiro

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules (always) | `.kiro/steering/hatch3r-agents.md` | Inlined into managed block (bridge) |
| rules (scoped) | `.kiro/steering/hatch3r-{id}.md` | Conditional inclusion via YAML frontmatter (`globs`) |
| agents | `.kiro/steering/hatch3r-agents.md` | Inlined into managed block (bridge) |
| skills | `.kiro/steering/hatch3r-{id}.md` | Raw content |
| mcp | `.kiro/settings/mcp.json` | JSON `mcpServers` object |
| bridge | `.kiro/steering/hatch3r-agents.md` | Managed block with inline orchestration + canonical reference |

### Goose

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.goosehints` | Inlined into managed block (bridge) |
| agents | `.goosehints` | Inlined into managed block (bridge) |
| skills | `.goosehints` | Inlined into managed block (bridge) |
| bridge | `.goosehints` | Managed block with inline orchestration + canonical reference |

### Zed

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.rules` | Inlined into managed block (bridge) |
| agents | `.rules` | Inlined into managed block (bridge) |
| bridge | `.rules` | Managed block with inline orchestration + canonical reference |

---

## Canonical Path Matches

Some platforms natively read from `.agents/` paths, making adapter output unnecessary:

| Platform | Path | Notes |
|----------|------|-------|
| **Amp** | `.agents/commands/` | Amp discovers commands in `.agents/commands/` by convention. Canonical files work without transformation. |
| **Amp** | `.agents/skills/` | Amp discovers skills in `.agents/skills/` by convention. The adapter also writes to `.amp/skills/` for explicit registration. |
| **Codex** | `.agents/AGENTS.md` | Codex reads `model_instructions_file` pointing to `.agents/AGENTS.md`. Rules are available through this bridge. |
| **Windsurf** | `.agents/skills/` | Windsurf natively discovers skills in `/.agents/skills/` for skill auto-discovery. The adapter also writes to `.windsurf/skills/` for explicit registration. |
| **All** | `AGENTS.md` (root) | hatch3r generates a root `AGENTS.md` with managed blocks. Platforms that discover AGENTS.md (Amp, Codex, Windsurf, Cline) automatically read it. |

---

## Secret Management

All MCP secrets are centralized in a single `.env.mcp` file at the project root (generated by `hatch3r init`, gitignored via `.env.*`). How each adapter loads those secrets differs by platform capability:

| Adapter | Secret loading method | Auto-loads `.env.mcp`? | Notes |
|---------|----------------------|:----------------------:|-------|
| **copilot** | `envFile` field per STDIO server | **Yes** | VS Code natively reads `envFile: "${workspaceFolder}/.env.mcp"` |
| **cursor** | `${env:VAR}` from process env | No | User must source `.env.mcp` before launching, or set vars in shell profile / Cursor UI |
| **claude** | `${env:VAR}` from process env | No | User must source `.env.mcp` before launching |
| **cline** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **opencode** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **amp** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **gemini** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **codex** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **windsurf** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **aider** | N/A | No | No project-level MCP support |
| **kiro** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **goose** | N/A (global MCP only) | No | Goose MCP is global; secrets set via global config |
| **zed** | N/A (global MCP only) | No | Zed MCP is global; secrets set via Zed settings |

### Sourcing `.env.mcp`

For editors that don't auto-load the file, source it before launching:

```bash
set -a && source .env.mcp && set +a && <editor-command> .
```

`set -a` marks all sourced variables for export so the editor's child processes (MCP servers) inherit them.

---

## Intentional Omissions

| Adapter | Capability | Reason |
|---------|------------|--------|
| **windsurf** | hooks | No documented Windsurf hook/event system. |
| **opencode** | hooks | No documented OpenCode hook/event system. |
| **amp** | hooks | No documented Amp hook/event system. |
| **codex** | hooks | No documented Codex hook/event system. |
| **aider** | mcp | Aider has no project-level MCP config file format. |
| **aider** | hooks | No documented Aider hook/event system. |
| **goose** | mcp | Goose MCP is global-only (`~/.config/goose/config.yaml`). No project-level MCP path. |
| **goose** | hooks | No documented Goose hook/event system. |
| **kiro** | hooks | No documented Kiro hook/event system for project-level config. |
| **zed** | mcp | Zed MCP config is global-only (Zed settings). No project-level MCP path. |
| **zed** | hooks | No documented Zed hook/event system. |
| **zed** | skills | Zed has no skills concept; rules cover all guidance. |
| **all** | guardrails | No adapter emits policy files. Canonical location `.agents/policy/` exists for future use. |
| **all** | prompts (except copilot) | Only Copilot has a dedicated prompts format (`.github/prompts/`). Other platforms map prompts to commands or skills. |
| **all** | githubAgents (except copilot) | Copilot-specific capability; only the Copilot adapter emits. |

---

## Platform Documentation

| Topic | Docs |
|-------|------|
| **Agent model customization** | [model-selection.md](model-selection.md) — configuration, aliases, resolution order; [hatch3r-agent-customize](../commands/hatch3r-agent-customize.md) — per-agent overrides |
| Cursor | [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) |
| Copilot | [Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) / [Agent Skills](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills) |
| Claude | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Cline | [Cline Rules](https://docs.cline.bot/features/cline-rules/overview) / [Workflows](https://docs.cline.bot/customization/workflows) |
| Codex | [Codex Config](https://developers.openai.com/codex/config-reference) / [AGENTS.md](https://developers.openai.com/codex/guides/agents-md) |
| Gemini | [Gemini Code Assist](https://docs.cloud.google.com/gemini/docs/codeassist/agent-mode) |
| Windsurf | [Windsurf MCP](https://docs.windsurf.com/windsurf/mcp) |
| Amp | [AGENTS.md](https://ampcode.com/agent.md) / [Custom Commands](https://ampcode.com/news/custom-slash-commands) |
| OpenCode | [OpenCode](https://opencode.ai) |
| Aider | [Aider YAML Config](https://aider.chat/docs/config/aider_conf.html) / [Conventions](https://aider.chat/docs/usage/conventions.html) |
| Kiro | [Kiro Steering](https://kiro.dev/docs/steering/) |
| Goose | [Goosehints](https://block.github.io/goose/docs/guides/using-goosehints) |
| Zed | [Zed AI Rules](https://zed.dev/docs/ai/rules.html) |

---

## Maintenance Guide

When adding a new capability or adapter:

1. Add the canonical source to `.agents/{capability}/` and update `CanonicalFile.type` in `src/types.ts`
2. Update `readCanonicalFiles()` in `src/adapters/canonical.ts` if a new content type is needed
3. Implement the capability in each adapter's `generate()` method, guarding behind the appropriate `features.*` flag
4. Add tests in `src/__tests__/adapters/{adapter}.test.ts` verifying both emission and feature-flag skip
5. Update this matrix document: add the capability to the Implementation Matrix, File Path Mapping, and any relevant sections
6. If the platform reads canonical paths natively, document it in the Canonical Path Matches section
7. If support is intentionally omitted, document the reason in Intentional Omissions
