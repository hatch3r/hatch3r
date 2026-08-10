# Model Selection

hatch3r lets you configure preferred AI models for your agents — and, where the tool supports it, for skills and commands. You can set a global default (agents only), override per artifact id, or use project-specific customization files. Each adapter emits the model in the format its platform expects.

## Overview

When you configure a model, hatch3r includes it where the selected adapter exposes a supported model surface across Claude Code, Cursor, GitHub Copilot, and Codex. Unsupported artifact-level surfaces omit the setting. The preference is preserved across `npx hatch3r sync` runs.

**When no model is configured at any level**, hatch3r does not emit a model preference and the platform uses its own default. Since 2.6.0 every canonical agent ships a model *class* in its frontmatter (see [Model Classes](#model-classes)) — and since 2.7.0 an optional reasoning-*effort* level (see [Effort](#effort)) — so for agents the "nothing configured" case no longer occurs. It still applies to skills and commands, which carry no canonical `model:`.

**When you want to change a model or effort on a generated agent**, use a durable override channel (`.hatch3r/agents/{id}.customize.yaml` or `hatch.json` `models.*`) — the change lands on the next `sync`. Editing the generated file's frontmatter directly is not durable; see [Hand-edits vs durable overrides](#hand-edits-vs-durable-overrides).

## Configuration Points

The same four layers apply per artifact class (`agents`, `skills`, `commands`):

| Source | Path | Precedence |
|--------|------|------------|
| Customization YAML | `.hatch3r/{class}/{id}.customize.yaml` | Highest |
| Manifest per-artifact | `hatch.json` → `models.{class}.{id}` (`models.agents`, `models.skills`, `models.commands`) | 2nd |
| Canonical frontmatter | bundled artifact frontmatter `model:` | 3rd |
| Manifest default | `hatch.json` → `models.default` — **agents only** | 4th |
| (none) | — | Platform auto-select |

> **Authoring `.customize.*` files.** No terminal command writes these files. Create `.hatch3r/{type}/{id}.customize.yaml` (settings — `model`, `effort` (agents only), `scope`, `description`, `enabled`) or `.hatch3r/{type}/{id}.customize.md` (markdown appended under the managed block) by hand, or run the `/hatch3r-customize` workflow which authors them for you. `hatch3r sync` then propagates the override into the generated outputs. The `hatch.json` and frontmatter columns above ARE edited via `hatch3r config`; the `.customize.*` layer is not.

## Resolution Order

1. **Customization file** — If `.hatch3r/{class}/{id}.customize.yaml` exists and has a `model` field, that value wins.
2. **Manifest per-artifact** — `hatch.json` → `models.{class}[id]`
3. **Canonical frontmatter** — `model:` in the bundled artifact
4. **Manifest default** — `hatch.json` → `models.default` — applies to **agents only**. Skills and commands never inherit `models.default`: a default that fed them would add `model:` lines to every generated skill/command the moment it is set, and a command-level model switches the whole conversation model — that must stay an explicit per-id choice.
5. **No model** — hatch3r emits nothing; the platform uses its own default.

## Model Classes

Canonical agents do not pin concrete models. Each declares a capability **class** in `model:` frontmatter — the 4-class ladder `frontier | advanced | standard | economy`, capability-descending (`src/models/tiers.ts`; widened from the 2.6.0 3-class ladder in 2.7.0). A class travels through the resolution order above like any other `model:` value and is mapped to each platform's native vocabulary at emission time. Legacy words remain accepted as synonyms in user overrides only (`fast` → `economy`, `standard`/`default` → `standard`, `reasoning`/`strongest` → `frontier`); the canonical corpus itself uses only the four class words (enforced by the `--model-class` validator mode).

| Class | Claude Code | Cursor (native) | Copilot (native) | Codex (native agent TOML) |
|-------|-------------|-----------------|------------------|---------------------------|
| `frontier` | `model: fable` + `effort: xhigh` (authored `max` on 3 agents) | `model: claude-fable-5[effort=high]` — bracket appended iff resolved effort ≥ `xhigh`, clamped to `high` | `model: Claude Fable 5` | `model = "gpt-5.6-sol"` |
| `advanced` | `model: opus` + `effort:` (authored, else `high`) | `model: claude-opus-4-8` (+ `[effort=high]` iff resolved effort ≥ `xhigh`) | `model: Claude Opus 4.8` | `model = "gpt-5.6-sol"` |
| `standard` | `model: sonnet` (no `effort:` line — platform default applies) | omitted (inherit-by-omission) | omitted (picker default) | `model = "gpt-5.6-terra"` |
| `economy` | `model: haiku` + `effort: medium` (authored `low` on the 3 loaders) | `model: fast` (never bracketed) | `model: Claude Haiku 4.5` | `model = "gpt-5.6-luna"` |

- **Claude Code** maps classes to aliases (`haiku`/`sonnet`/`opus`/`fable`), not pinned ids, so the platform tracks the current GA model in each tier without a per-release re-pin of every emitted agent file. The native field is gated to Claude-recognizable values (the four aliases, a `claude-*` id, or `inherit`); a non-Claude resolved model surfaces only as `## Recommended Model` prose. If your organization's model allowlist excludes an emitted model, Claude Code itself falls back to `inherit` (the session model) — platform-documented behavior (code.claude.com/docs/en/sub-agents, accessed 2026-07-14).
- **Cursor**'s native frontmatter vocabulary is `fast`, `inherit`, or a concrete model id with optional bracket options (`claude-opus-4-8[effort=high]` is the documented form, cursor.com/docs/subagents.md, accessed 2026-07-14). `advanced`/`frontier` therefore pin concrete ids via alias expansion; `economy` uses the `fast` keyword (brackets are documented on concrete ids only, so it is never bracketed); `standard` omits the field.
- **Copilot** agent frontmatter takes a single display-name string (the CLI rejects the array form), mapped from the supported-models reference (docs.github.com/en/copilot/reference/ai-models/supported-models, accessed 2026-07-14). `standard` omits the field; there is no effort surface (see [Effort](#effort)).
- **Codex** emits the resolved model in each `.codex/agents/hatch3r-*.toml`. Its documented config enum is `minimal | low | medium | high | xhigh`; `minimal` through `high` emit directly, while `xhigh` emits only when an explicit model is also emitted. The official [subagents guide](https://learn.chatgpt.com/docs/agent-configuration/subagents) mentions model-dependent `max` and `ultra`, but the config reference enum currently stops at `xhigh`; Hatcher follows the config schema and omits `max`, `ultra`, or any other out-of-enum value with an actionable warning rather than weakening it or writing invalid Codex TOML ([official config reference](https://learn.chatgpt.com/docs/config-file/config-reference), accessed 2026-08-10).

### Emission posture (`agentModelPins`)

`cursor.agentModelPins` and `copilot.agentModelPins` in `hatch.json` control class-word emission per adapter: `"native"` (the default) emits the table above; `"conservative"` restores the pre-2.7.0 posture:

- **Cursor conservative** — `advanced`/`frontier` emit no native pin; one advisory body line names the class and points at the Cursor model picker. `economy` (`fast`) and `standard` (omit) are identical under both postures.
- **Copilot conservative** — every class word is omitted; the picker default applies.

`models.tiers` pins are honored identically under both postures.

### Project-wide class remap (`models.tiers`)

Pin what a class means in your repo — wherever a class word wins resolution, the pinned value replaces the adapter's mapping verbatim (then passes through alias expansion):

```json
{
  "models": {
    "tiers": {
      "frontier": "fable"
    }
  }
}
```

- Keys: the four canonical class words. Legacy keys (`default`, `strongest`, plus the pre-2.6.0 `fast`/`reasoning`) still resolve through the synonym map; when a legacy key and its canonical key are both present, the canonical key wins. `hatch3r validate` lints legacy keys (rename warning), dual-key shadows, unknown keys, and circular pins (a class word pinned to another class word never emits natively).
- Cursor never appends bracket options to a pinned value — an operator who wants brackets pins the bracketed form (e.g. `"frontier": "claude-fable-5[effort=high]"`).
- **Per-class off-switch:** `"tiers": { "<class>": "inherit" }` suppresses native emission for that class — no `model:`/`effort:` lines are written; the class intent stays visible in body prose (Claude `## Recommended Model` / Cursor advisory line).

### Floor pinning

An agent's canonical class is its **floor**: runtime allocation may raise the class for a high-tier task, never lower it — and the tier ladder tops out at `advanced`, so `frontier` enters a spawn only as an authored floor or an explicit operator override. `hatch3r-security`, `hatch3r-testability`, and the other verdict-class specialists must not resolve below `standard` from any override layer — an override that would is surfaced as a config error and the run proceeds at `standard` or above. Per-spawn allocation semantics live in the `hatch3r-model-allocation` rule (`rules/hatch3r-model-allocation.md`).

## Effort

Since 2.7.0, reasoning effort is a first-class axis orthogonal to class: class selects which model serves an agent; effort sets how much reasoning that model spends. Hatcher's cross-adapter authoring enum is `low | medium | high | xhigh | max`; Codex's documented config range is `minimal | low | medium | high | xhigh`.

Effort resolves per agent through this chain, highest source first:

1. `.hatch3r/agents/{id}.customize.yaml` `effort:` — per-agent override. Agents only (a warning drops it on any other type); closed enum — a value outside the five levels is stripped with a warning.
2. Authored `effort:` frontmatter on the canonical agent.
3. `hatch.json` → `models.tierEfforts.<class>` — per-class pin. Canonical class keys only; `hatch3r validate` rejects legacy keys and non-enum values as errors.
4. Built-in class default: `frontier` → `xhigh`, `advanced` → `high`, `economy` → `medium`. `standard` has no built-in default — when the chain resolves to nothing, no `effort:` line is emitted and the platform default applies (inherit-by-omission).

Two scoping rules bound the class-level stages (3–4):

- They apply only when the emitted model came from a class mapping. A concrete user-set model (customize id, `models.agents` id, `models.default`) gets explicit per-agent effort only (stages 1–2) — hatch3r does not assume effort semantics for an operator-chosen model.
- On an operator `models.tiers` model pin, explicit effort (stages 1–2) and a `tierEfforts` pin (stage 3) still ride the pin; the built-in default (stage 4) does not.

**Authored floors are un-degradable by class pins.** Authored `effort:` frontmatter sits above every class-level source, so a `models.tierEfforts` pin can never lower an agent below its authored level — only a per-agent `.customize.yaml` `effort:`, a named per-agent decision, can. The `--model-class` validator mode enforces authored `effort: xhigh` or above across the 16 verdict-class agents (EFFORT-FLOOR) and the 5-level enum on every authored value (EFFORT-VOCAB).

Per-adapter effort surfaces:

| Adapter | Surface |
|---------|---------|
| Claude Code | Native `effort:` frontmatter key beside `model:`, emitted verbatim; omitted when the chain resolves to nothing |
| Cursor | `[effort=high]` bracket suffix on `advanced`/`frontier` pins, appended only when the resolved effort is `xhigh` or `max` and clamped to `high` — the bracket level Cursor documents; below `xhigh`, no bracket |
| Copilot | None — the agent `model` field is a single display-name string, so the resolved effort is dropped at emission (`effortOverride: false` in the capability matrix) |
| Codex | Native `model_reasoning_effort`: `minimal | low | medium | high` emit directly; `xhigh` requires an explicit emitted `model`. Canonical `max`, custom `ultra`, and other out-of-enum values are omitted with a warning |

## Emission Surfaces (per adapter)

Model lines are emitted only where the tool documents a `model` field on that surface. `inherit` is never written — an omitted field IS the inherit/unset semantic. Class words are mapped per the [Model Classes](#model-classes) table; any other platform-unrecognizable value (e.g. `gpt-4` on Claude Code) is omitted rather than shipped as dead frontmatter.

| Adapter | Agents | Skills | Commands |
|---------|--------|--------|----------|
| Claude Code | `model:` (+ `effort:`) in `.claude/agents/*.md` (+ `## Recommended Model` prose) | `model:` in `.claude/skills/*/SKILL.md` | `model:` in `.claude/commands/*.md` |
| Copilot | `model:` in `.github/agents/*.agent.md` | never (SKILL.md model support unverified as of 2026-07-08) | `model:` in `.github/prompts/*.prompt.md` (string form only; no `inherit` keyword — unset = field omitted) |
| Cursor | `model:` in `.cursor/agents/*.md` | never (no documented field) | never (no documented field) |
| Codex | `model` + validated `model_reasoning_effort` in `.codex/agents/*.toml` | never (no documented skill field) | never (commands are skill bridges) |

## Aliases

You can use short aliases instead of full model IDs. hatch3r resolves them before emitting.

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

> **Currency note (verified 2026-07-14 against the vendor model reference).** Every Anthropic alias points at the current GA model in its tier: `fable` → `claude-fable-5` ($10/$50 per 1M in/out), `opus` → `claude-opus-4-8` ($5/$25), `sonnet` → `claude-sonnet-5` ($3/$15), `haiku` → `claude-haiku-4-5` ($1/$5). Exact ids pass through unchanged, so you can pin any published id directly; `explain --cost --model` rate lookup covers aliased/rated ids and class words (a class word prices via the Claude class map), while pass-through ids cost-estimate at default rates. Alias bumps land as one coordinated sweep across `src/models/aliases.ts`, the `costEstimator.ts` rate rows, and this table (the lock-step contract in `aliases.ts`).

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

In the bundled `agents/hatch3r-architect.md` (or a `.hatch3r/overrides/agents/` override) — class word plus authored effort:

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

| Class | Agents | Authored effort | Rationale |
|-------|--------|-----------------|-----------|
| `frontier` (16) | the 10 CQ specialists (`ui`, `ux`, `security`, `reliability`, `testability`, `scalability`, `performance`, `maintainability`, `enhancability`, `product-spec`) + `reviewer`, `architect`, `edge-case-analyst`, `incident-responder`, `greenfield-spec`, `brownfield-spec` | `xhigh` (13); `max` on `security`, `reviewer`, `edge-case-analyst` | Verdict/sign-off agents — a quality gate evaluated on a cheaper class silently weakens every verdict |
| `advanced` (3) | `implementer`, `fixer`, `creator` | `xhigh` | Mutating work agents — multi-file code changes carry the highest rework cost per defect |
| `standard` (6) | `researcher`, `docs-writer`, `devops`, `pack-installer`, `dependency-drafter`, `handoff-preparer` | — (platform default) | Supporting work agents; runtime allocation raises them to `advanced` on Tier-3 tasks |
| `economy` (5) | `lint-fixer`, `ci-watcher`, `context-rules`, `handoff-loader`, `learnings-loader` | `low` on the 3 loaders; — (class default `medium`) on the rest | Mechanical agents — bounded transformations, re-verified downstream by the review gate and the Phase 4 validation pass |

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

Class words map per adapter (see [Model Classes](#model-classes)). To route every class to another vendor's models, pin the classes project-wide:

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

`models.tiers` pins replace the adapter maps verbatim wherever a class word wins resolution; per-agent `models.agents` entries and `.customize.yaml` files continue to take resolution-order priority over canonical frontmatter.

## Hand-edits vs durable overrides

Generated agent files open with a hatch3r-owned frontmatter stub (the region carrying `model:`/`effort:`). Hand-editing those fields in the generated file is not durable:

- **`sync` heals and warns.** Regeneration replaces a stale generated stub; when that replacement changes an emitted `model:`/`effort:` value, sync prints a warning naming each changed field (old → new) plus the durable channels. A prefix carrying genuine user-authored content is never touched.
- **`status`/`verify` attribute the drift.** `.hatch3r/provenance.json` records the emit-time values (`emittedModel`/`emittedEffort`); an on-disk stub whose fields differ from that baseline is reported as `user-modified` with detail `frontmatter-stub-edited`, naming the edited field(s) and the remedy. A stub differing only because canonical content moved stays `canonical-outdated`.
- **Durable channels:** `.hatch3r/agents/{id}.customize.yaml` (`model:`/`effort:`) or `hatch.json` `models.*` — both survive every `sync`.

## Platform Behavior

| Platform | Native config? | When model is set |
|----------|----------------|-------------------|
| Cursor | Yes | Emits `model:` in agent YAML frontmatter; effort rides as the `[effort=high]` bracket suffix on `advanced`/`frontier` pins when the resolved effort is `xhigh`+ |
| Copilot | Yes (VS Code) | Emits `model:` in agent/prompt YAML (display-name string); ignored on github.com; no effort surface — the resolved effort is dropped at emission |
| Claude Code | Yes | Emits `model:` + `effort:` in agent YAML frontmatter (Claude-recognizable values); skills/commands get `model:` only; agents also carry `## Recommended Model` guidance (`/model` command and env var) |
| Codex | Yes | Emits `model` + `model_reasoning_effort` in agent TOML; `minimal` through `high` emit directly, `xhigh` requires an explicit emitted model, and `max`/`ultra` are omitted with a warning |

## Related

- [adapter-capability-matrix.md](adapter-capability-matrix.md) — Platform support matrix and model emission per adapter
- [hatch3r-customize](../skills/hatch3r-customize/SKILL.md) — Per-artifact customization (agents, commands, rules, skills) including model overrides via `.hatch3r/agents/{id}.customize.yaml`
