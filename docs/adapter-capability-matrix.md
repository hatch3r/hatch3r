# Adapter Capability Matrix

> **Last verified**: 2026-06-06 | **hatch3r version**: 2.0.0

Living reference for framework capabilities vs. adapter implementations. As of 1.9.0 hatch3r supports 3 adapters: Claude Code, Cursor, and GitHub Copilot. Twelve adapters (aider, amazonq, amp, antigravity, cline, codex, gemini, goose, kiro, opencode, windsurf, zed) were removed in a hard cut — see [CHANGELOG.md](../CHANGELOG.md) §[1.9.0]. This document tracks what each remaining adapter emits, what each platform supports natively, and where gaps remain.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Y** | Adapter emits files for this capability |
| **B** | Bridge: content folded into an instruction file the platform reads |
| **--** | Platform has no known support for this capability |
| **skip** | Platform supports this but only globally (not project-scoped); intentionally omitted |

---

## Framework Capabilities

Canonical content lives inside the bundled npm package (`<pkgRoot>/dist/content/` or, in dev, the repo's top-level `agents/`, `skills/`, `rules/`, ...). Adapters resolve it via `resolveBundledContentRoot()` from `src/content/contentRoot.ts`. End-user repos do not contain a `.agents/` mirror.

| Capability | Bundled source | Description |
|------------|----------------|-------------|
| **rules** | `rules/` | Persistent instructions (coding standards, conventions) |
| **agents** | `agents/` | Agent definitions / custom modes |
| **agent model** | `hatch.json`, agent frontmatter, `.hatch3r/agents/{id}.customize.yaml` | Per-agent AI model preference |
| **skills** | `skills/*/SKILL.md` | On-demand instruction bundles for specific tasks |
| **prompts** | `prompts/` | Reusable prompt templates |
| **commands** | `commands/` | Slash-command workflows |
| **mcp** | `mcp/mcp.json` (bundled defaults), `.hatch3r/mcp/mcp.json` (user resolved) | Model Context Protocol server config |
| **guardrails** | `policy/` | Deny lists, command restrictions |
| **githubAgents** | `github-agents/` | GitHub Copilot-specific agent definitions |
| **hooks** | `hooks/` | Event-triggered automation (pre-commit, session-start, etc.) |
| **agentTeams** | adapter-generated | Multi-agent team orchestration (Claude Code Agent Teams) |
| **overrides** | `.hatch3r/overrides/` | User-authored canonical overrides (escape hatch). Adapters prefer overrides over bundled content. |

---

## Implementation Matrix

| Adapter | rules | agents | skills | prompts | commands | mcp | guardrails | githubAgents | hooks | model | agentTeams |
|---------|:-----:|:------:|:------:|:-------:|:--------:|:---:|:----------:|:------------:|:-----:|:-----:|:----------:|
| **cursor** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | -- |
| **copilot** | Y | Y | Y | --[^prompts] | Y | Y | -- | Y | -- | Y | -- |
| **claude** | Y | Y | Y | -- | Y | Y | -- | -- | Y | Y | Y |

[^prompts]: copilot `prompts: --` matches `ADAPTER_CAPABILITIES.copilot.prompts = false` (`src/adapters/index.ts:125`): hatch3r ships no canonical `prompts/` content, so no adapter emits a `.github/prompts/*.prompt.md` from a *prompts* source (D9-H-5, Cycle 10). The platform's native `.github/prompts/` picker stays an unutilized enhancement surface (`PLATFORM_CAPABILITY_SEED.copilot.prompts = supported`). Copilot's *commands* still route to `.github/prompts/hatch3r-{id}.prompt.md` under the separate `commands` flag (see [File Path Mapping → Copilot](#copilot)). The cell-vs-`ADAPTER_CAPABILITIES` agreement of every boolean-backed Implementation Matrix column is pinned by `src/__tests__/adapters/capability-matrix-doc.test.ts`.

#### Hook-surface notes

- **copilot** carries `hooks: --` because hatch3r emits no Copilot hook file yet (`ADAPTER_CAPABILITIES.copilot.hooks = false`). The platform surface is now mixed: VS Code documents a **Preview** `PreToolUse` hook with `permissionDecision: "deny"` plus an agent-scoped `hooks:` field ([VS Code custom-agents docs](https://code.visualstudio.com/docs/copilot/customization/custom-agents), verified 2026-06-06), so server-side blocking IS reachable on VS Code Preview — but it is not GA, is absent on github.com, and exposes no transcript access for external processes there. Until the Preview stabilizes and the adapter emits a hook, hatch3r enforces pipeline orchestration on Copilot via instructional rules only — the `## Copilot Enforcement Model (no hook surface)` section emitted into `.github/copilot-instructions.md` by `src/adapters/copilot.ts` documents the trust-based model and self-detectable drift indicators. Emitting a Preview-gated PreToolUse deny-gate is a CL-2 candidate (D9-17). See [hatch3r issue #73](https://github.com/hatch3r-dev/hatch3r/issues/73).

### Agent Model Customization

All 3 adapters emit model preferences when configured via `hatch.json`, agent frontmatter, or `.hatch3r/agents/{id}.customize.yaml`. Resolution order: customization file > manifest per-agent > agent frontmatter > manifest default. See [model-selection.md](model-selection.md) for configuration, aliases, and platform behavior. Use the `hatch3r-customize` skill for per-agent overrides.

| Adapter | Emission | Notes |
|---------|----------|-------|
| **cursor** | Native | `model:` in agent YAML frontmatter. Also emits `readonly:` and `background:` for v2.5+ sub-agent control. |
| **copilot** | Native (VS Code) | `model:` in agent YAML; ignored on github.com |
| **claude** | Native (frontmatter `model:`) | Emits `model:` in sub-agent YAML frontmatter (authoritative per [sub-agents docs](https://code.claude.com/docs/en/sub-agents#choose-a-model), accessed 2026-05-27); also retains `## Recommended Model` prose (`/model` + `CLAUDE_CODE_SUBAGENT_MODEL`) in non-minimal mode for per-session override. |

### Native User-Question / Triage Tool

Tracks whether the adapter exposes a documented platform-native question/triage tool (vs. the plain-text fallback). Source of truth: `ASK_USER_TOOLS` in `src/pipeline/adapterToolTranslator.ts` and the `nativeQuestionTool` column in `ADAPTER_CAPABILITIES` (`src/adapters/index.ts`). Capability-matrix invariant test: `src/__tests__/adapters/capability-matrix.test.ts`.

| Adapter | Native question tool | Notes |
|---------|:--------------------:|-------|
| **claude** | Y | `AskUserQuestion` tool (verified 2026-05-28 @ https://code.claude.com/docs/en/sub-agents) |
| **cursor** | -- | No native question tool documented; plain-text fallback applies (verified 2026-05-28 @ https://cursor.com/docs/agent/subagents) |
| **copilot** | -- | No native question tool documented; plain-text fallback applies (verified 2026-05-28 @ https://docs.github.com/en/copilot/reference/custom-agents-configuration) |

When `nativeQuestionTool: false` (deny-by-default) the agent uses the plain-text numbered-options fallback per `agents/shared/user-question-protocol.md`.

### CLI Tools (Agent-Tooling Surface)

Tracks whether the adapter emits per-tool CLI skills from `skills/hatch3r-cli-*` (the CLI-tooling pivot positions OS-native CLI tools as the token-efficient agent-tooling story; MCP is opt-in). Source of truth: the `cliTools` column in `ADAPTER_CAPABILITIES` (`src/adapters/index.ts`). All 3 adapters opt in.

| Adapter | CLI tools |
|---------|:---------:|
| **cursor** | Y |
| **claude** | Y |
| **copilot** | Y |

---

## Bridge Orchestration

All 3 adapters emit bridge files that inline orchestration content from a shared constant (`BRIDGE_ORCHESTRATION` in `src/cli/shared/agentsContent.ts`). This content comprises:

- **Mandatory Behaviors** — 6 directives (load skill, spawn researcher, spawn specialists, use Task tool, propagate rules, consult learnings)
- **Agent Quick Reference** — table of agents with "When to Use"
- **Canonical Structure** — bundled-content paths for rules, agents, skills, commands, MCP, policy and the `.hatch3r/` user-state paths

Inlining ensures every platform receives orchestration guidance directly in context. The root `/AGENTS.md` shared bridge was removed in 1.9.0 — each adapter emits only its native surface.

---

## File Path Mapping

### Cursor

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.cursor/rules/hatch3r-{id}.mdc` | MDC frontmatter (`description`, `alwaysApply`, `globs`) |
| agents | `.cursor/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`, `readonly`, `background`) |
| skills | `.cursor/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| commands | `.cursor/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.cursor/mcp.json` | Direct copy of resolved MCP config |
| hooks | `.cursor/rules/hatch3r-hook-{id}.mdc` | MDC rule with hook event metadata |
| bridge | `.cursor/rules/hatch3r-bridge.mdc` | Always-apply rule with inline orchestration + canonical reference + Cursor v2.5+ sub-agent configuration guidance |
| environment | `.cursor/environment.json` | JSON with `instructions` array; emitted when `cursor` is in manifest tools |

### Copilot

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules (always) | `.github/copilot-instructions.md` | Managed block with inlined rules |
| bridge | `.github/copilot-instructions.md` | Inline orchestration + canonical reference, above rules |
| rules (scoped) | `.github/instructions/hatch3r-{id}.instructions.md` | YAML frontmatter (`applyTo`) |
| agents | `.github/agents/hatch3r-{id}.md` | YAML frontmatter (`name`, `description`, `model`) |
| skills | `.github/skills/hatch3r-{id}/SKILL.md` | YAML frontmatter (`name`, `description`) |
| prompts | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content |
| commands | `.github/prompts/hatch3r-{id}.prompt.md` | Raw content |
| githubAgents | `.github/agents/hatch3r-{id}.agent.md` | Raw content |
| mcp | `.vscode/mcp.json` | Canonical MCP config; STDIO secrets via `envFile` (`.env.mcp`), HTTP header secrets via `${input:NAME}` prompts |
| setup | `.github/workflows/copilot-setup-steps.yml` | YAML build steps |

### Claude

| Capability | Output Path | Format |
|------------|-------------|--------|
| rules | `.claude/rules/hatch3r-{id}.md` | Header + description + content |
| agents | `.claude/agents/hatch3r-{id}.md` | YAML frontmatter (`description`) + model guidance in content |
| skills | `.claude/skills/hatch3r-{id}/SKILL.md` | Raw content |
| commands | `.claude/commands/hatch3r-{id}.md` | Raw content |
| mcp | `.mcp.json` | Resolved MCP config with Claude Code compatibility transforms (see below) |
| hooks | `.claude/settings.json` | Claude event mapping (PreToolUse, PostToolUse, etc.) |
| permissions | `.claude/settings.json` | Configurable via `claude.permissions` and `claude.teammateMode` in `hatch.json` |
| bridge | `CLAUDE.md` | Managed block with inline orchestration + canonical reference |

**Claude Code `.mcp.json` compatibility:** The Claude adapter applies two transforms to the resolved MCP config: (1) env var placeholders are converted from `${env:VAR}` to `${VAR}` syntax, and (2) a `type` field (`stdio` or `http`) is added to each server entry. These transforms ensure Claude Code can parse the MCP config without manual editing.

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

---

## Secret Management

All MCP secrets are centralized in a single `.env.mcp` file at the project root (generated by `hatch3r init`, gitignored via `.env.*`). How each adapter loads those secrets differs by platform capability:

| Adapter | Secret loading method | Auto-loads `.env.mcp`? | Notes |
|---------|----------------------|:----------------------:|-------|
| **copilot** | `envFile` (STDIO) + `${input:NAME}` (HTTP headers) | STDIO: yes | STDIO servers set `envFile: "${workspaceFolder}/.env.mcp"`, which VS Code auto-loads (VS Code does not shell-expand an inline `env` object). HTTP-transport header secrets are not read from `.env.mcp`; VS Code prompts for them via `${input:NAME}` variables on first use |
| **cursor** | `${env:VAR}` from process env | No | User must source `.env.mcp` before launching, or set vars in shell profile / Cursor UI |
| **claude** | `${env:VAR}` from process env | No | User must source `.env.mcp` before launching |

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
| **copilot** | hooks | No adapter hook file is emitted yet. A VS Code Preview `PreToolUse` deny-hook now exists (not GA, absent on github.com); emitting it is a CL-2 candidate, not a permanent omission (see Hook-surface notes above). |
| **all** | guardrails | No adapter emits policy files. Canonical location `policy/` exists in bundled content for future use. |
| **all** | prompts | No adapter emits a prompts file from a canonical `prompts/` source — hatch3r ships none (`ADAPTER_CAPABILITIES.{cursor,claude,copilot}.prompts = false`). Only Copilot's platform exposes a dedicated `.github/prompts/` picker, which stays an unutilized enhancement surface; Copilot's *commands* reuse that path under the separate `commands` flag (see Implementation Matrix `prompts` footnote). Cursor and Claude map commands to their own native command surface. |
| **all** | githubAgents (except copilot) | Copilot-specific capability; only the Copilot adapter emits. |
| **gemini → antigravity** | (retired adapter migration) | Gemini CLI (removed in the 1.9.0 hard cut) sunsets for AI Pro/Ultra/free tiers on 2026-06-18; Google's sanctioned migration target is Antigravity CLI ([Google Developers Blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/), accessed 2026-06-06). Antigravity is tracked but not re-introduced — Tier 3 keep-retired: it fails the SA9.5 re-introduction trigger T2. The current question is no longer days-since-launch but schema stability: Antigravity's config surface is now documented (the migration moves skills from `.gemini/skills/` to `.agents/skills/`, reads `GEMINI.md`/`AGENTS.md` context files unchanged, and relocates MCP config to `mcp_config.json` with the `url`→`serverUrl` rename — [Antigravity Gemini-CLI migration docs](https://antigravity.google/docs/gcli-migration), accessed 2026-06-06), yet T2 requires that schema be stable ≥6 months and no schema-stability dates are published for the post-migration surface. **`.agents/` collision note:** Antigravity's documented config directory `.agents/` is the same root-level path hatch3r removed in the 1.9.0 hard cut (the `/.agents/` materialization mirror was dropped in favor of bundled content per CONSTITUTION §6 Decision 12); re-introducing this adapter would re-collide an end-user repo path the framework deliberately deleted, so any future re-grade must resolve that path conflict before T2 can clear. Surveillance for the Gemini market position transfers from `gemini` to `antigravity`. Re-evaluation cadence: D09 SA9.5, each audit cycle. |

---

## Platform Documentation

| Topic | Docs |
|-------|------|
| **Agent model customization** | [model-selection.md](model-selection.md) — configuration, aliases, resolution order; [hatch3r-customize](../skills/hatch3r-customize/SKILL.md) — per-artifact overrides |
| Cursor | [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) / [Subagents](https://cursor.com/docs/context/subagents) / [Plugins](https://cursor.com/docs/plugins) |
| Copilot | [Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) / [Agent Skills](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills) / [VS Code Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents) (Preview PreToolUse hook + handoffs) |
| Claude | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) |

---

## Maintenance Guide

When adding a new capability or adapter:

1. Add the canonical source to `{capability}/` at the repo root (bundled into `dist/content/` by `scripts/copy-content.ts`) and update `CanonicalFile.type` in `src/types.ts`
2. Update `readCanonicalFiles()` in `src/adapters/canonical.ts` if a new content type is needed
3. Implement the capability in each adapter's `generate()` method, guarding behind the appropriate `features.*` flag
4. Add tests in `src/__tests__/adapters/{adapter}.test.ts` verifying both emission and feature-flag skip
5. Update this matrix document: add the capability to the Implementation Matrix, File Path Mapping, and any relevant sections
6. If support is intentionally omitted, document the reason in Intentional Omissions
