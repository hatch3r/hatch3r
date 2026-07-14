# Model Selection

hatch3r lets you configure preferred AI models for your agents — and, where the tool supports it, for skills and commands. You can set a global default (agents only), override per artifact id, or use project-specific customization files. Each adapter emits the model in the format its platform expects.

## Overview

When you configure a model, hatch3r includes it in the generated config for each tool (Claude Code, Cursor, Copilot, etc.). Some platforms support native model selection in their config; others receive the recommendation as guidance text. Either way, the preference is preserved across `npx hatch3r sync` runs.

**When no model is configured at any level**, hatch3r does not emit a model preference. Each platform (Claude Code, Cursor, Copilot, etc.) uses its own default. Since 2.6.0 every canonical agent ships a model *class* in its frontmatter (see [Model Classes](#model-classes)), so for agents the "nothing configured" case no longer occurs — it still applies to skills and commands, which carry no canonical `model:`.

**When you change a model on an already-generated artifact**, the new value lands in the YAML frontmatter stub at the top of the generated file — a region hatch3r treats as user-owned and preserves across `sync`/`update` (the managed `HATCH3R:BEGIN…END` block below it is what gets refreshed). To apply a model change to an existing file, delete that generated file and run `npx hatch3r update` (it re-emits missing files with current config); freshly generated files always carry the configured model.

## Configuration Points

The same four layers apply per artifact class (`agents`, `skills`, `commands`):

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/{class}/{id}.customize.yaml` | Highest |
| Manifest per-artifact | `hatch.json` → `models.{class}.{id}` (`models.agents`, `models.skills`, `models.commands`) | 2nd |
| Canonical frontmatter | bundled artifact frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` → `models.default` — **agents only** | 4th |
| (none) | — | Platform auto-select |

> **Authoring `.customize.*` files.** No terminal command writes these files. Create `.hatch3r/{type}/{id}.customize.yaml` (settings — `model`, `scope`, `description`, `enabled`) or `.hatch3r/{type}/{id}.customize.md` (markdown appended under the managed block) by hand, or run the `/hatch3r-customize` workflow which authors them for you. `hatch3r sync` then propagates the override into the generated outputs. The `hatch.json` and frontmatter columns above ARE edited via `hatch3r config`; the `.customize.*` layer is not.

## Resolution Order

1. **Customization file** — If `.hatch3r/{class}/{id}.customize.yaml` exists and has a `model` field, that value wins.
2. **Manifest per-artifact** — `hatch.json` → `models.{class}[id]`
3. **Canonical frontmatter** — `model:` in the bundled artifact
4. **Manifest default** — `hatch.json` → `models.default` — applies to **agents only**. Skills and commands never inherit `models.default`: a default that fed them would add `model:` lines to every generated skill/command the moment it is set, and a command-level model switches the whole conversation model — that must stay an explicit per-id choice.
5. **No model** — hatch3r emits nothing; the platform uses its own default.

## Model Classes

Canonical agents do not pin concrete models. Each declares a capability **class** in `model:` frontmatter — `economy`, `default`, or `strongest` (`src/models/tiers.ts`). A class travels through the resolution order above like any other `model:` value and is mapped to each platform's native vocabulary at emission time. The legacy tier words remain accepted as synonyms in user overrides (`fast` → `economy`, `standard` → `default`, `reasoning` → `strongest`); the canonical corpus itself uses only the three class words (enforced by the `--model-class` validator mode).

| Class | Claude Code | Cursor | Copilot |
|-------|-------------|--------|---------|
| `economy` | `model: haiku` + `effort: medium` | `model: fast` | omitted |
| `default` | `model: sonnet` (no `effort:` line — platform default applies) | omitted (inherit-by-omission) | omitted |
| `strongest` | `model: opus` + `effort: high` | advisory body line (no native value) | omitted |

- **Claude Code** maps classes to aliases (`haiku`/`sonnet`/`opus`), not pinned ids, so the platform tracks the current GA model in each tier without a per-release re-pin of every emitted agent file. `effort:` is emitted only alongside a tier-mapped model, never for a user-set concrete model.
- **Cursor**'s native vocabulary is `fast`, `inherit`, or a concrete id, so only `economy` maps natively; `default` is expressed by omitting the field; `strongest` becomes an advisory body line unless a `models.tiers.strongest` pin supplies a concrete id.
- **Copilot** emits no class-derived `model:` value — a class word emits nothing there unless a `models.tiers` pin supplies a concrete id.

### Project-wide class remap (`models.tiers`)

Pin what a class means in your repo — wherever a class word wins resolution, the pinned value replaces the adapter's mapping verbatim (then passes through alias expansion):

```json
{
  "models": {
    "tiers": {
      "strongest": "fable"
    }
  }
}
```

With this pin, every `model: strongest` agent emits `fable`'s resolved id on all three platforms instead of the per-adapter defaults above.

### Floor pinning

An agent's canonical class is its **floor**: runtime allocation may raise the class for a high-tier task, never lower it, and `hatch3r-security`, `hatch3r-testability`, and the other verdict-class specialists must not resolve below `default` from any override layer — an override that would is surfaced as a config error and the run proceeds at `default` or above. Per-spawn allocation semantics live in the `hatch3r-model-allocation` rule (`rules/hatch3r-model-allocation.md`).

## Emission Surfaces (per adapter)

Model lines are emitted only where the tool documents a `model` field on that surface. `inherit` is never written — an omitted field IS the inherit/unset semantic — and platform-unrecognizable values (e.g. `gpt-4` on Claude Code, the hatch3r tier words `standard`/`fast`) are omitted rather than shipped as dead frontmatter.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| Claude Code | `model:` in `.claude/agents/*.md` (+ `## Recommended Model` prose) | `model:` in `.claude/skills/*/SKILL.md` | `model:` in `.claude/commands/*.md` |
| Copilot | `model:` in `.github/agents/*.agent.md` | never (SKILL.md model support unverified as of 2026-07-08) | `model:` in `.github/prompts/*.prompt.md` (string form only; no `inherit` keyword — unset = field omitted) |
| Cursor | `model:` in `.cursor/agents/*.md` | never (no documented field) | never (no documented field) |

## Aliases

You can use short aliases instead of full model IDs. hatch3r resolves them before emitting.

| Alias | Resolves To |
|-------|-------------|
| `opus` | `claude-opus-4-8` |
| `sonnet` | `claude-sonnet-4-6` |
| `haiku` | `claude-haiku-4-5` |
| `codex` | `gpt-5.3-codex` |
| `codex-prev` | `gpt-5.2-codex` |
| `codex-mini` | `gpt-5.1-codex-mini` |
| `codex-spark` | `gpt-5.3-codex-spark` |
| `gemini-pro` | `gemini-3.1-pro` |
| `gemini-flash` | `gemini-3-flash` |
| `gemini-stable` | `gemini-2.5-pro` |

Unknown values are passed through as-is.

> **Currency note (verified 2026-07-11 against the vendor model reference; D1-SA1.6-03).** Anthropic's current Sonnet-tier model is `claude-sonnet-5` ($3/$15 per 1M in/out; introductory $2/$10 through 2026-08-31); `claude-sonnet-4-6` — the `sonnet` alias target above — is vendor-designated previous-generation but remains fully available at $3/$15. The current top model, `claude-fable-5` ($10/$50), has no short alias. Exact ids pass through unchanged, so you can pin either today (e.g. `"model": "claude-sonnet-5"` in `hatch.json`) without waiting for an alias bump; `explain --cost --model` rate lookup covers aliased/rated ids only, so pass-through ids cost-estimate at default rates. The `sonnet` alias bump lands as one coordinated sweep across `src/models/aliases.ts`, the `costEstimator.ts` rate/tier rows, and this table (the lock-step contract in `aliases.ts`).

## Examples

### hatch.json

```json
{
  "models": {
    "default": "opus",
    "agents": {
      "hatch3r-lint-fixer": "sonnet",
      "hatch3r-testability": "gemini-pro"
    }
  }
}
```

### Canonical agent frontmatter

In the bundled `agents/hatch3r-implementer.md` (or a `.hatch3r/overrides/agents/hatch3r-implementer.md` override):

```yaml
---
id: hatch3r-implementer
description: Focused implementation agent for a single issue.
model: opus
---
```

### Customization YAML

In `.hatch3r/agents/hatch3r-reviewer.customize.yaml` (keyed by id via its filename, so set only override fields):

```yaml
model: codex
```

## Built-in Agent Defaults

Every one of the 30 canonical agents ships a model **class** in its frontmatter (see [Model Classes](#model-classes)) — no concrete model id appears anywhere in the canonical corpus:

| Class | Agents | Rationale |
|-------|--------|-----------|
| `strongest` (16) | the 10 CQ specialists (`ui`, `ux`, `security`, `reliability`, `testability`, `scalability`, `performance`, `maintainability`, `enhancability`, `product-spec`) + `reviewer`, `architect`, `edge-case-analyst`, `incident-responder`, `greenfield-spec`, `brownfield-spec` | Verdict/sign-off agents — a quality gate evaluated on a cheaper class silently weakens every verdict |
| `default` (9) | `implementer`, `fixer`, `researcher`, `docs-writer`, `devops`, `creator`, `pack-installer`, `dependency-drafter`, `handoff-preparer` | Work agents — routine multi-file execution; runtime allocation raises them to `strongest` on Tier-3 tasks |
| `economy` (5) | `lint-fixer`, `ci-watcher`, `context-rules`, `handoff-loader`, `learnings-loader` | Mechanical agents — bounded transformations, re-verified downstream by the review gate and the Phase 4 validation pass |

These classes sit at precedence level 3 (canonical frontmatter). Override at any higher level — a per-agent concrete id, a per-agent class, or a project-wide `models.tiers` remap:

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

Class words map per adapter (see [Model Classes](#model-classes)), so nothing vendor-specific ships by default on platforms without a mapping. To route every class to another vendor's models, pin the classes project-wide:

```json
{
  "models": {
    "tiers": {
      "economy": "codex-spark",
      "default": "codex",
      "strongest": "codex"
    }
  }
}
```

`models.tiers` pins replace the adapter maps verbatim wherever a class word wins resolution; per-agent `models.agents` entries and `.customize.yaml` files continue to take resolution-order priority over canonical frontmatter.

## Platform Behavior

When no model is set, each tool uses its own default.

| Platform | Native config? | When model is set |
|----------|----------------|-------------------|
| Cursor | Yes | Emits `model:` in agent YAML frontmatter |
| Copilot | Yes (VS Code) | Emits `model:` in agent/prompt YAML; ignored on github.com |
| OpenCode | Yes | Emits `model: provider/id` in agent config |
| Codex (OpenAI) | Yes | Emits `model = "id"` in TOML |
| Claude Code | Yes | Emits `model:` in agent/skill/command YAML frontmatter (Claude-recognizable values); agents also carry `## Recommended Model` guidance (`/model` command and env var) |
| Cline/Roo | No | Emits guidance in role definition |
| Gemini | No | Emits guidance in GEMINI.md |
| Windsurf | No | Emits guidance in .windsurfrules |
| Amp | No | Emits guidance in .amp/AGENTS.md |
| Aider | No | Emits guidance as comment in CONVENTIONS.md |
| Kiro | No | Emits guidance in steering files |
| Goose | No | Emits guidance as comment in .goosehints |
| Zed | No | Emits guidance as comment in .rules |

## Adapter Support

- **Native config** — Claude Code, Cursor, Copilot, OpenCode, Codex emit the model in the platform's config format. The tool can apply it directly.
- **Guidance** — Cline, Gemini, Windsurf, Amp receive the model as instructional text. Users set it manually (e.g., via CLI flag or UI). Claude Code agents additionally carry `## Recommended Model` guidance for the per-session override path.

## Related

- [adapter-capability-matrix.md](adapter-capability-matrix.md) — Platform support matrix and model emission per adapter
- [hatch3r-customize](../skills/hatch3r-customize/SKILL.md) — Per-artifact customization (agents, commands, rules, skills) including model overrides via `.hatch3r/agents/{id}.customize.yaml`
