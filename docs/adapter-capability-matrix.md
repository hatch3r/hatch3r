# Adapter Capability Matrix

> **Last verified**: 2026-05-13 | **hatch3r version**: 1.7.5

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
| **agentTeams** | adapter-generated | Multi-agent team orchestration (Claude Code Agent Teams) |

---

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | githubAgents | hooks | model | agentTeams |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:------------:|:-----:|:-----:|:----------:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **copilot** | Y | Y | Y | Y | Y | Y | -- | Y | -- | Y | -- |
| **claude** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | Y |
| **cline** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **codex** | B | B | Y | -- | -- | Y | -- | -- | Y | Y | -- |
| **gemini** | B | B | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **windsurf** | Y | B | Y | -- | Y | Y | -- | -- | -- | Y | -- |
| **amp** | B | B | Y | -- | ~ | Y | -- | -- | -- | Y | -- |
| **opencode** | Y | Y | Y | -- | Y | Y | -- | -- | -- | Y | -- |
| **aider** | B | B | Y | -- | -- | -- | -- | -- | -- | Y | -- |
| **kiro** | Y | B | Y | -- | -- | Y | -- | -- | Y | Y | -- |
| **goose** | B | B | B | -- | -- | Y | -- | -- | -- | Y | -- |
| **zed** | B | B | -- | -- | -- | -- | -- | -- | -- | Y | -- |
| **amazon-q** | B | B | Y | -- | -- | Y | -- | -- | Y | Y | -- |
| **antigravity** | B | B | Y | -- | -- | Y | -- | -- | -- | Y | -- |
| **agents-md** | B | B | B | -- | -- | -- | -- | -- | -- | Y | -- |

#### Hook-surface notes

- **copilot** carries `hooks: --` because GitHub Copilot Chat exposes no `PreToolUse` / pre-edit hook, no transcript access for external processes, and no tool-refusal API (verified against [GitHub Copilot Chat docs](https://docs.github.com/en/copilot/customizing-copilot/about-customizing-github-copilot-chat-responses) on 2026-05-12). Hatch3r enforces pipeline orchestration on Copilot via instructional rules only — the `## Copilot Enforcement Model (no hook surface)` section emitted into `.github/copilot-instructions.md` by `src/adapters/copilot.ts` documents the trust-based model and self-detectable drift indicators. See [hatch3r issue #73](https://github.com/hatch3r-dev/hatch3r/issues/73).

### Agent Model Customization

All adapters emit model preferences when configured via `hatch.json`, agent frontmatter, or `.hatch3r/agents/{id}.customize.yaml`. Resolution order: customization file > manifest per-agent > agent frontmatter > manifest default. See [model-selection.md](model-selection.md) for configuration, aliases, and platform behavior. Use the `hatch3r-agent-customize` command for per-agent overrides.

| Adapter | Emission | Notes |
|---------|----------|-------|
| **cursor** | Native | `model:` in agent YAML frontmatter. Also emits `readonly:` and `background:` for v2.5+ subagent control. |
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
| **amazon-q** | Guidance | Text in .amazonq/rules/hatch3r-agents.md |
| **antigravity** | Guidance | Text in .antigravity/rules.md |
| **agents-md** | Guidance | `**Model:** \`id\`` annotation per agent in AGENTS.md |

### Native User-Question / Triage Tool

Added in 1.7.1. Tracks whether the adapter exposes a documented platform-native question/triage tool (vs. the plain-text fallback). Source of truth: `ASK_USER_TOOLS` in `src/pipeline/adapterToolTranslator.ts` and the `nativeQuestionTool` column in `ADAPTER_CAPABILITIES` (`src/adapters/index.ts`). Capability-matrix invariant test: `src/__tests__/adapters/capability-matrix.test.ts`. At canonical-write time, the `<!-- HATCH3R:PLATFORM-TOOL -->` marker is replaced with a per-adapter row table by `copySelectedContent` in `src/content/index.ts`.

| Adapter | Native question tool | Notes |
|---------|:--------------------:|-------|
| **claude** | Y | `AskUserQuestion` tool |
| **cursor** | -- | Pending per-cycle web-research verification by adapter author |
| **copilot** | -- | Pending per-cycle web-research verification by adapter author |
| **windsurf** | -- | Pending per-cycle web-research verification by adapter author |
| **codex** | -- | Pending per-cycle web-research verification by adapter author |
| **cline** | -- | Pending per-cycle web-research verification by adapter author |
| **opencode** | -- | Pending per-cycle web-research verification by adapter author |
| **amp** | -- | Pending per-cycle web-research verification by adapter author |
| **aider** | -- | Pending per-cycle web-research verification by adapter author |
| **kiro** | -- | Pending per-cycle web-research verification by adapter author |
| **goose** | -- | Pending per-cycle web-research verification by adapter author |
| **zed** | -- | Pending per-cycle web-research verification by adapter author |
| **amazon-q** | -- | Pending per-cycle web-research verification by adapter author |
| **gemini** | -- | Pending per-cycle web-research verification by adapter author |
| **antigravity** | -- | Pending per-cycle web-research verification by adapter author |

When `nativeQuestionTool: false` (deny-by-default) the agent uses the plain-text numbered-options fallback per `agents/shared/user-question-protocol.md`.

### CLI Tools (Agent-Tooling Surface)

Added in 1.7.5. Tracks whether the adapter emits per-tool CLI skills from `skills/hatch3r-cli-*` (the CLI-tooling pivot positions OS-native CLI tools as the token-efficient agent-tooling story; MCP is opt-in). Source of truth: the `cliTools` column in `ADAPTER_CAPABILITIES` (`src/adapters/index.ts`). Adapters with `cliTools: true` opt in to `processSkillsRawCliFiltered` / `processSkillsWithFmCliFiltered` filtering pipelines per `BaseAdapter.readCliFilteredSkills`. Picker UX, detection (POSIX `command -v` / Windows `where`, 2s timeout, fail-open), and the post-flow missing-tools disclaimer with one-liner installer live in `src/cliTools/`. Capability-matrix invariant test: `src/__tests__/adapters/capability-matrix.test.ts`.

| Adapter | CLI tools | Notes |
|---------|:---------:|-------|
| **cursor** | Y | |
| **claude** | Y | |
| **gemini** | Y | |
| **cline** | Y | |
| **codex** | Y | |
| **amazon-q** | Y | |
| **copilot** | Y | |
| **opencode** | Y | |
| **windsurf** | Y | |
| **amp** | -- | Reads canonical `skills/` natively; no filter pipeline needed |
| **kiro** | Y | |
| **aider** | Y | |
| **goose** | Y | |
| **zed** | -- | `skills: false`; CLI tools surface as a follow-up reference inline |
| **antigravity** | Y | |

When `cliTools: false` the user can still select CLI tools during init / `hatch3r cli-tools`; the manifest still records the selection and detection still runs, but no per-tool skill files are emitted for that adapter.

---

## Bridge Orchestration

All adapters that emit bridge files (Cursor, Claude, Copilot, Gemini, Windsurf, Amp, AGENTS.md) now include **inline orchestration content** from a shared constant (`BRIDGE_ORCHESTRATION` in `src/cli/shared/agentsContent.ts`). This content comprises:

- **Mandatory Behaviors** — 6 directives (load skill, spawn researcher, spawn specialists, use Task tool, propagate rules, consult learnings)
- **Agent Quick Reference** — Table of 17 agents with "When to Use"
- **Canonical Structure** — Paths for rules, agents, skills, commands, MCP, policy

Previously only the Cursor adapter inlined this content; others merely referenced `.agents/AGENTS.md`. Inlining ensures every platform receives orchestration guidance directly in context, improving instruction-following reliability. Codex and OpenCode reference `.agents/AGENTS.md` via config and do not emit bridge markdown files.

---

## File Path Mapping

### Cursor

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.cursor/rules/hatch3r-{id}.mdc` | MDC frontmatter (`description`, `alwaysApply`, `globs`) |
| agents | `.cursor/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`, `readonly`, `background`) |
| skills | `.cursor/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| commands | `.cursor/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.cursor/mcp.json` | Direct copy of canonical MCP config |
| hooks | `.cursor/rules/hatch3r-hook-{id}.mdc` | MDC rule with hook event metadata |
| bridge | `.cursor/rules/hatch3r-bridge.mdc` | Always-apply rule with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference + Cursor v2.5+ subagent configuration guidance |
| environment | `.cursor/environment.json` | JSON with `instructions` array pointing to AGENTS.md; emitted when `cursor` is in manifest tools |

### Copilot

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules (always) | `.github/copilot-instructions.md` | Managed block with inlined rules |
| bridge | `.github/copilot-instructions.md` | Inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference, above rules |
| rules (scoped) | `.github/instructions/hatch3r-{id}.instructions.md` | YAML frontmatter (`applyTo`) |
| agents | `.github/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`) |
| skills | `.github/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| prompts | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content |
| commands | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content |
| githubAgents | `.github/agents/hatch3r-{id}.agent.md` | Raw content |
| mcp | `.vscode/mcp.json` | Canonical MCP config with `env` object for secret passing |
| setup | `.github/workflows/copilot-setup-steps.yml` | YAML build steps |

### Claude

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.claude/rules/hatch3r-{id}.md` | Header + description + content |
| agents | `.claude/agents/hatch3r-{id}.md` | YAML frontmatter (`description`) + model guidance in content |
| skills | `.claude/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.claude/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.mcp.json` | Canonical MCP config with Claude Code compatibility transforms (see below) |
| hooks | `.claude/settings.json` | Claude event mapping (PreToolUse, PostToolUse, etc.) |
| permissions | `.claude/settings.json` | Configurable via `claude.permissions` and `claude.teammateMode` in `hatch.json` |
| bridge | `CLAUDE.md` | Managed block with inline orchestration (mandatory behaviors, agent roster, canonical structure) + canonical reference |

**Claude Code `.mcp.json` compatibility:** The Claude adapter applies two transforms to the canonical MCP config: (1) env var placeholders are converted from `${env:VAR}` to `${VAR}` syntax, and (2) a `type` field (`stdio` or `http`) is added to each server entry. These transforms ensure Claude Code can parse the MCP config without manual editing.

#### Configurable Permissions

The Claude adapter generates `.claude/settings.json` with tool permissions and teammate mode. These are configurable via the `claude` key in `hatch.json`:

```json
{
  "claude": {
    "permissions": {
      "allow": ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "LS", "TodoRead", "TodoWrite"],
      "deny": []
    },
    "teammateMode": "tool-using"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `permissions.allow` | `string[]` | 9 common tools (Read, Edit, etc.) | Tools Claude Code is allowed to use without confirmation |
| `permissions.deny` | `string[]` | `[]` | Tools Claude Code is never allowed to use |
| `teammateMode` | `"tool-using" \| "full-trust" \| "manual-approval"` | `"tool-using"` | How spawned teammates operate |

When omitted, the adapter falls back to sensible defaults so existing projects continue to work without changes.

### Cline / Roo Code

| Capability | Output Path | Format |
|------------|-------------|--------|
| agents | `.roomodes` | JSON (`customModes` array with slug/roleDefinition/groups) |
| rules | `.roo/rules/hatch3r-{id}.md` | Header + description + content |
| skills | `.cline/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.clinerules/workflows/hatch3r-{id}.md` | Raw content (mapped to workflows) |
| mcp | `.roo/mcp.json` | JSON with transport type mapping |
| hooks | `.roo/rules/hatch3r-hook-{id}.md` | Rule with hook event/agent metadata |
| bridge | `.roo/rules/hatch3r-bridge.md` | Managed block with inline orchestration + canonical reference |

### Codex

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.codex/config.toml` | Rule comments referencing AGENTS.md (bridge) |
| agents | `.codex/agents/hatch3r-{id}.toml` | Per-agent TOML with `name`, `description`, `developer_instructions` (required); optional `model` |
| skills | `.codex/skills/hatch3r-{id}/SKILL.md` | Raw content |
| mcp | `.codex/config.toml` | `[mcp_servers.{name}]` TOML sections |
| hooks | `.codex/config.toml` | `[hooks."{event}"]` TOML sections with command trigger |
| project-doc precedence | `.codex/config.toml` | `project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]`; `status` warns when `AGENTS.override.md` is present (per 2026 Codex discovery chain) |

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
| rules | `.windsurf/rules/hatch3r-{id}.md` | Markdown with HTML comment metadata (`trigger`, `globs`) |
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
| agents | `.opencode/agent/hatch3r-{id}.md` | YAML frontmatter (`description`, `model`) |
| skills | `.opencode/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.opencode/command/hatch3r-{id}.md` | Raw content |
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
| rules (scoped) | `.kiro/steering/hatch3r-rule-{id}.md` | Conditional inclusion via YAML frontmatter (`globs`) |
| agents | `.kiro/steering/hatch3r-agents.md` | Inlined into managed block (bridge) |
| skills | `.kiro/steering/hatch3r-skill-{id}.md` | Raw content |
| hooks | `.kiro/hooks/hatch3r-{id}.md` | YAML frontmatter with `trigger:` mapped to Kiro 2026 identifiers (file-save, pre-tool-use, post-tool-use, prompt-submit, manual-trigger) plus optional `filePattern`/`branches` |
| mcp | `.kiro/settings/mcp.json` | JSON `mcpServers` object |
| bridge | `.kiro/steering/hatch3r-agents.md` | Managed block with inline orchestration + Kiro Powers callout + canonical reference |

### Goose

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.goosehints` | Inlined into managed block (bridge) |
| agents | `.goosehints` | Inlined into managed block (bridge) |
| skills | `.goosehints` | Inlined into managed block (bridge) |
| mcp | `.goose/profile.yaml` | Extensions array within Goose profile config |
| bridge | `.goosehints` | Managed block with inline orchestration + canonical reference |

### Zed

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.rules` | Inlined into managed block (bridge) |
| agents | `.rules` | Inlined into managed block (bridge) |
| bridge | `.rules` | Managed block with inline orchestration + canonical reference |

### Amazon Q

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.amazonq/rules/hatch3r-agents.md` | Inlined into managed block (bridge) |
| agents | `.amazonq/rules/hatch3r-agents.md` | Inlined into managed block (bridge) |
| skills | `.amazonq/rules/hatch3r-skill-{id}.md` | Raw content |
| mcp | `.amazonq/mcp.json` | JSON `mcpServers` object |
| hooks | `.amazonq/rules/hatch3r-hooks.md` | Lifecycle event bindings with agent spawn directives |
| bridge | `.amazonq/rules/hatch3r-agents.md` | Managed block with inline orchestration + canonical reference |

### Antigravity

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.antigravity/rules.md` | Inlined into managed block (bridge) |
| agents | `.antigravity/rules.md` | Inlined into managed block (bridge) |
| skills | `.agent/skills/hatch3r-{id}/SKILL.md` | Raw content (canonical Antigravity workspace path) |
| mcp | `.antigravity/settings.json` | JSON `mcpServers` object |
| bridge | `.antigravity/rules.md` | Managed block with inline orchestration + canonical reference |

### AGENTS.md (AAIF)

Produces a single AAIF-compliant `AGENTS.md` at the project root. Use this adapter for tools that read the AAIF standard directly and for which hatch3r ships no dedicated adapter (AAIF specification: https://agents.md, 60k+ repositories as of 2026-04).

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `AGENTS.md` | `## Rules` section with per-rule `### {id}` subsections (bridge) |
| agents | `AGENTS.md` | `## Agent: {id}` sections with description, model annotation, `### Instructions` (bridge) |
| skills | `AGENTS.md` | `## Skills` section with per-skill `### {id}` subsections (bridge) |
| bridge | `AGENTS.md` | Managed block with inline orchestration + canonical structure reference |

---

## Canonical Path Matches

Some platforms natively read from `.agents/` paths, making adapter output unnecessary:

| Platform | Path | Notes |
|----------|------|-------|
| **Amp** | `.agents/commands/` | Amp discovers commands in `.agents/commands/` by convention. Canonical files work without transformation. |
| **Amp** | `.agents/skills/` | Amp discovers skills in `.agents/skills/` by convention. The adapter also writes to `.amp/skills/` for explicit registration. |
| **Codex** | `AGENTS.md` (root) | Codex 2026 discovery precedence per scope: `AGENTS.override.md` -> `AGENTS.md` -> filenames in `project_doc_fallback_filenames`. hatch3r writes root `AGENTS.md` and registers `TEAM_GUIDE.md`, `.agents.md` as fallbacks in `.codex/config.toml`. `hatch3r status` warns when project-level `AGENTS.override.md` exists (it silently overrides hatch3r's AGENTS.md). |
| **Windsurf** | `.agents/skills/` | Windsurf natively discovers skills in `.agents/skills/` for skill auto-discovery. The adapter also writes to `.windsurf/skills/` for explicit registration. |
| **All** | `AGENTS.md` (root) | hatch3r generates a root `AGENTS.md` with managed blocks. Platforms that discover AGENTS.md (Amp, Codex, Windsurf, Cline) automatically read it. |

---

## Secret Management

All MCP secrets are centralized in a single `.env.mcp` file at the project root (generated by `hatch3r init`, gitignored via `.env.*`). How each adapter loads those secrets differs by platform capability:

| Adapter | Secret loading method | Auto-loads `.env.mcp`? | Notes |
|---------|----------------------|:----------------------:|-------|
| **copilot** | `env` object per server | No | Env vars are passed directly via the `env` object in `.vscode/mcp.json`; user must source `.env.mcp` or set vars manually |
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
| **goose** | `${env:VAR}` from process env | No | MCP configured as extensions in `.goose/profile.yaml` |
| **zed** | N/A (global MCP only) | No | Zed MCP is global; secrets set via Zed settings |
| **amazon-q** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **antigravity** | `${env:VAR}` from process env | No | Same sourcing pattern |
| **agents-md** | N/A | No | AGENTS.md adapter emits no MCP config; platforms consuming AGENTS.md load MCP through their own adapter or tooling |

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
| **aider** | mcp | Aider has no project-level MCP config file format. |
| **aider** | hooks | No documented Aider hook/event system. |
| **goose** | hooks | No documented Goose hook/event system. |
| **zed** | mcp | Zed MCP config is global-only (Zed settings). No project-level MCP path. |
| **zed** | hooks | No documented Zed hook/event system. |
| **zed** | skills | Zed has no skills concept; rules cover all guidance. |
| **amazon-q** | commands | No documented Amazon Q commands format. |
| **antigravity** | hooks | No documented Antigravity hook/event system. |
| **antigravity** | commands | No documented Antigravity commands format. |
| **agents-md** | mcp, commands, prompts, hooks, githubAgents | AAIF `AGENTS.md` is a pure markdown bridge format: agents, rules, and skills only. Platform-specific capabilities (MCP, slash commands, event hooks, GitHub agent sidecars) are out of AAIF scope; consuming tools load those via their own adapters. |
| **all** | guardrails | No adapter emits policy files. Canonical location `.agents/policy/` exists for future use. |
| **all** | prompts (except copilot) | Only Copilot has a dedicated prompts format (`.github/prompts/`). Other platforms map prompts to commands or skills. |
| **all** | githubAgents (except copilot) | Copilot-specific capability; only the Copilot adapter emits. |

---

## Platform Documentation

| Topic | Docs |
|-------|------|
| **Agent model customization** | [model-selection.md](model-selection.md) — configuration, aliases, resolution order; [hatch3r-agent-customize](../commands/hatch3r-agent-customize.md) — per-agent overrides |
| Cursor | [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) / [Subagents](https://cursor.com/docs/context/subagents) / [Plugins](https://cursor.com/docs/plugins) |
| Copilot | [Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) / [Agent Skills](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills) |
| Claude | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |
| Cline | [Cline Rules](https://docs.cline.bot/features/cline-rules/overview) / [Workflows](https://docs.cline.bot/customization/workflows) |
| Codex | [Codex Config](https://developers.openai.com/codex/config-reference) / [AGENTS.md](https://developers.openai.com/codex/guides/agents-md) |
| Gemini | [Gemini Code Assist](https://docs.cloud.google.com/gemini/docs/codeassist/agent-mode) |
| Windsurf | [Windsurf MCP](https://docs.windsurf.com/windsurf/mcp) |
| Amp | [AGENTS.md](https://ampcode.com/agent.md) / [Custom Commands](https://ampcode.com/news/custom-slash-commands) |
| OpenCode | [OpenCode](https://opencode.ai) |
| Aider | [Aider YAML Config](https://aider.chat/docs/config/aider_conf.html) / [Conventions](https://aider.chat/docs/usage/conventions.html) |
| Kiro | [Kiro Steering](https://kiro.dev/docs/steering/) / [Hooks](https://kiro.dev/docs/hooks/) / [Powers](https://kiro.dev/blog/introducing-powers/) |
| Goose | [Goosehints](https://block.github.io/goose/docs/guides/using-goosehints) |
| Zed | [Zed AI Rules](https://zed.dev/docs/ai/rules.html) |
| Amazon Q | [Amazon Q CLI Agents](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-cli-agents.html) |
| Antigravity | [Antigravity Docs](https://antigravity.dev/docs) |
| AGENTS.md (AAIF) | [AAIF / AGENTS.md Standard](https://agents.md) |

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
