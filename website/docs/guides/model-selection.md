---
sidebar_position: 4
title: Model Selection
---

# Model Selection

hatch3r lets you configure preferred AI models for your agents — and, where the tool supports it, for skills and commands. You can set a global default (agents only), override per artifact id, or use project-specific customization files.

## Overview

When you configure a model, hatch3r includes it where the selected adapter exposes a supported model surface across Claude Code, Cursor, Copilot, and Codex. Unsupported artifact-level surfaces omit the setting. The preference is preserved across `npx hatch3r sync` runs.

When no model is configured at any level, hatch3r does not emit a model preference and the platform uses its own default. Since 2.6.0 every canonical agent ships a model *class* in its frontmatter (see [Model Classes](#model-classes)) — and since 2.7.0 an optional reasoning-*effort* level (see [Effort](#effort)) — so for agents the "nothing configured" case no longer occurs. It still applies to skills and commands, which carry no canonical `model:`.

## Configuration Points

The same four layers apply per artifact class (`agents`, `skills`, `commands`):

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/{class}/{id}.customize.yaml` | Highest |
| Manifest per-artifact | `hatch.json` -> `models.{class}.{id}` | 2nd |
| Canonical frontmatter | `agents/{id}.md` (etc.) frontmatter `model:` (bundled content; override under `.hatch3r/overrides/{class}/`) | 3rd |
| Manifest default | `hatch.json` -> `models.default` — **agents only** | 4th |
| (none) | -- | Platform auto-select |

## Resolution Order

1. **Customization file** -- `.hatch3r/{class}/{id}.customize.yaml` with a `model` field wins
2. **Manifest per-artifact** -- `hatch.json` -> `models.{class}[id]` (`models.agents`, `models.skills`, `models.commands`)
3. **Canonical frontmatter** -- `model:` in the bundled artifact (or its `.hatch3r/overrides/` override)
4. **Manifest default** -- `hatch.json` -> `models.default` -- applies to **agents only**. Skills and commands never inherit `models.default`: a default that fed them would add `model:` lines to every generated skill/command the moment it is set, and a command-level model switches the whole conversation model — that must stay an explicit per-id choice.
5. **No model** -- platform uses its own default

## Model Classes

Canonical agents do not pin concrete models. Each declares a capability **class** in `model:` frontmatter — the 4-class ladder `frontier | advanced | standard | economy`, capability-descending (widened from the 2.6.0 3-class ladder in 2.7.0). A class travels through the resolution order above like any other `model:` value and is mapped to each platform's native vocabulary at emission time. Legacy words remain accepted as synonyms in user overrides only (`fast` -> `economy`, `standard`/`default` -> `standard`, `reasoning`/`strongest` -> `frontier`); the canonical corpus itself uses only the four class words.

| Class | Claude Code | Cursor (native) | Copilot (native) | Codex (native agent TOML) |
|-------|-------------|-----------------|------------------|---------------------------|
| `frontier` | `model: fable` + `effort: xhigh` (authored `max` on 3 agents) | `model: claude-fable-5[effort=high]` — bracket iff resolved effort ≥ `xhigh`, clamped to `high` | `model: Claude Fable 5` | `model = "gpt-5.6-sol"` |
| `advanced` | `model: opus` + `effort:` (authored, else `high`) | `model: claude-opus-4-8` (+ `[effort=high]` iff ≥ `xhigh`) | `model: Claude Opus 4.8` | `model = "gpt-5.6-sol"` |
| `standard` | `model: sonnet` (no `effort:` line) | omitted (inherit-by-omission) | omitted (picker default) | `model = "gpt-5.6-terra"` |
| `economy` | `model: haiku` + `effort: medium` (authored `low` on the 3 loaders) | `model: fast` (never bracketed) | `model: Claude Haiku 4.5` | `model = "gpt-5.6-luna"` |

Two knobs adjust class emission:

- **`models.tiers.<class>`** in `hatch.json` pins what a class means project-wide — the pinned value replaces the adapter map verbatim (then alias-expands). Legacy keys (`default`, `strongest`, ...) still resolve; the canonical key wins when both are present. `models.tiers.<class>: "inherit"` is the per-class off-switch: no native model/effort fields for that class.
- **`cursor.agentModelPins` / `copilot.agentModelPins`** — `"native"` (default) emits the table above; `"conservative"` restores the pre-2.7.0 posture (Cursor `advanced`/`frontier`: no pin, one advisory body line naming the class; Copilot: every class word omitted). `models.tiers` pins are honored under both.

On Claude Code the native field is gated to Claude-recognizable values; if your organization's model allowlist excludes an emitted model, Claude Code itself falls back to `inherit` (the session model) — platform-documented behavior.

## Effort

Since 2.7.0, reasoning effort is a first-class axis orthogonal to class: class selects which model serves an agent; effort sets how much reasoning that model spends. Hatcher's cross-adapter authoring enum is `low | medium | high | xhigh | max`; Codex's documented config range is `minimal | low | medium | high | xhigh`.

Per-agent resolution, highest source first:

1. `.hatch3r/agents/{id}.customize.yaml` `effort:` — agents only, closed five-word enum
2. Authored `effort:` frontmatter on the canonical agent
3. `hatch.json` -> `models.tierEfforts.<class>` — per-class pin (canonical class keys only)
4. Built-in class default: `frontier` -> `xhigh`, `advanced` -> `high`, `economy` -> `medium`; `standard` has none — no `effort:` line is emitted and the platform default applies (inherit-by-omission)

The class-level stages (3–4) apply only when the emitted model came from a class mapping; a concrete user-set model gets explicit per-agent effort only. Authored effort sits above every class-level source, so a `models.tierEfforts` pin can never lower an agent below its authored level — only a per-agent `.customize.yaml` `effort:` can.

Per adapter: Claude Code emits the resolved level verbatim as a native `effort:` frontmatter key; Cursor appends `[effort=high]` to `advanced`/`frontier` pins only when the resolved effort is `xhigh` or `max` (clamped to the documented `high`); Copilot has no effort surface and drops the resolved level. Codex emits `model_reasoning_effort` for `minimal | low | medium | high`; `xhigh` additionally requires an explicit emitted model. The official [subagents guide](https://learn.chatgpt.com/docs/agent-configuration/subagents) mentions model-dependent `max` and `ultra`, but the config reference enum currently stops at `xhigh`; Hatcher follows the config schema and omits those or any other out-of-enum value with an actionable warning rather than down-mapping or emitting invalid TOML ([official config reference](https://learn.chatgpt.com/docs/config-file/config-reference), accessed 2026-08-10).

## Emission Surfaces

Model lines are emitted only where the tool documents a `model` field on that surface. `inherit` is never written — an omitted field IS the inherit/unset semantic on every surface. Class words are mapped per the [Model Classes](#model-classes) table; any other platform-unrecognizable value (for example `gpt-4` on Claude Code) is omitted rather than shipped as dead frontmatter.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| Claude Code | `model:` (+ `effort:`) in `.claude/agents/*.md` (+ `## Recommended Model` prose) | `model:` in `.claude/skills/*/SKILL.md` | `model:` in `.claude/commands/*.md` |
| Copilot | `model:` in `.github/agents/*.agent.md` | never (SKILL.md model support unverified) | `model:` in `.github/prompts/*.prompt.md` (string form; no `inherit` keyword — unset = field omitted) |
| Cursor | `model:` in `.cursor/agents/*.md` | never (no documented field) | never (no documented field) |
| Codex | `model` + supported `model_reasoning_effort` in `.codex/agents/*.toml` | never (no documented skill field) | never (commands are skill bridges) |

## Aliases

Use short aliases instead of full model IDs. hatch3r resolves them before emitting.

| Alias | Resolves To |
|-------|-------------|
| `fable` | `claude-fable-5` |
| `opus` | `claude-opus-4-8` |
| `sonnet` | `claude-sonnet-5` |
| `haiku` | `claude-haiku-4-5` |
| `codex` | `gpt-5.3-codex` |
| `codex-prev` | `gpt-5.2-codex` |
| `codex-mini` | `gpt-5.1-codex-mini` |
| `codex-spark` | `gpt-5.3-codex-spark` |
| `gemini-pro` | `gemini-3.1-pro` |
| `gemini-flash` | `gemini-3-flash` |
| `gemini-stable` | `gemini-2.5-pro` |

Unknown values are passed through as-is. The four model-class words and their legacy synonyms are deliberately NOT aliases — they are capability classes mapped per adapter, not model ids.

## Examples

### hatch.json

```json
{
  "models": {
    "agents": {
      "hatch3r-lint-fixer": "sonnet",
      "hatch3r-testability": "gemini-pro"
    },
    "tiers": {
      "frontier": "fable"
    },
    "tierEfforts": {
      "advanced": "xhigh"
    }
  }
}
```

### Canonical agent frontmatter

In the canonical `agents/hatch3r-architect.md` (bundled content) — class word plus authored effort:

```yaml
---
id: hatch3r-architect
description: System architect who designs architecture and evaluates trade-offs.
model: frontier
effort: xhigh
---
```

### Customization YAML

In `.hatch3r/agents/hatch3r-reviewer.customize.yaml` (keyed by id via its filename, so set only override fields):

```yaml
model: codex
effort: high
```

## Built-in Agent Defaults

Every one of the 30 canonical agents ships a model **class** in its frontmatter — no concrete model id appears anywhere in the canonical corpus. 22 also author an `effort:` level:

| Class | Agents | Authored effort |
|-------|--------|-----------------|
| `frontier` (16) | the 10 CQ specialists (`ui`, `ux`, `security`, `reliability`, `testability`, `scalability`, `performance`, `maintainability`, `enhancability`, `product-spec`) + `reviewer`, `architect`, `edge-case-analyst`, `incident-responder`, `greenfield-spec`, `brownfield-spec` | `xhigh` (13); `max` on `security`, `reviewer`, `edge-case-analyst` |
| `advanced` (3) | `implementer`, `fixer`, `creator` | `xhigh` |
| `standard` (6) | `researcher`, `docs-writer`, `devops`, `pack-installer`, `dependency-drafter`, `handoff-preparer` | -- (platform default) |
| `economy` (5) | `lint-fixer`, `ci-watcher`, `context-rules`, `handoff-loader`, `learnings-loader` | `low` on the 3 loaders; -- (class default `medium`) on the rest |

Override at any higher precedence level:

```json
{
  "models": {
    "agents": {
      "hatch3r-lint-fixer": "sonnet"
    }
  }
}
```

### Cross-Platform Override

Class words map per adapter, so nothing vendor-specific ships by default on surfaces without a mapping. To route every class to another vendor's models, pin the classes project-wide:

```json
{
  "models": {
    "tiers": {
      "economy": "codex-spark",
      "standard": "codex",
      "advanced": "codex",
      "frontier": "codex"
    }
  }
}
```

## Platform Behavior

| Platform | Native config? | When model is set |
|----------|:--------------:|-------------------|
| Cursor | Yes | `model:` in agent YAML frontmatter; effort rides as the `[effort=high]` bracket suffix on `advanced`/`frontier` pins when the resolved effort is `xhigh`+ |
| Copilot | Yes (VS Code) | `model:` in agent/prompt YAML; ignored on github.com; no effort surface — the resolved effort is dropped at emission |
| Claude Code | Yes | `model:` + `effort:` in agent YAML frontmatter (Claude-recognizable values); skills/commands get `model:` only; agents also carry `## Recommended Model` guidance for the `/model` + env-var override path |
| Codex | Yes | `model` + `model_reasoning_effort` in agent TOML; `minimal` through `high` emit directly, `xhigh` requires an explicit emitted model, and `max`/`ultra` are omitted with a warning |

- **Native config** -- the tool can apply the model directly
- **Guidance** -- the model is included as instructional text; users set it manually
