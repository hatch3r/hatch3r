---
sidebar_position: 5
title: Customization
---

# Customization

hatch3r is designed to be extended without conflicting with managed updates.

## When to use which mechanism

Five mechanisms separate hatch3r-managed content from your project's customizations. Pick by intent, not by file type:

| Intent | Mechanism | Where it lives | What survives `hatch3r sync` |
|--------|-----------|----------------|-------------------------------|
| Add a project-specific rule / agent / skill that hatch3r does not ship | **Non-prefixed file** (no `hatch3r-` prefix) | `.cursor/rules/my-rule.mdc`, `.claude/agents/my-agent.md`, etc. | The whole file — hatch3r never reads or writes it |
| Append project-specific guidance to a hatch3r-managed file (e.g. notes under `CLAUDE.md`) | **Managed block** | Outside the `<!-- HATCH3R:BEGIN -->` / `<!-- HATCH3R:END -->` markers in the managed file | Everything outside the markers |
| Override a single field on a hatch3r-shipped artifact (model, scope, frontmatter) without forking it | **`.customize.yaml`** | `.hatch3r/{agents,skills,rules,commands}/{id}.customize.yaml` | The override file — hatch3r reads it on every sync |
| Append project-specific guidance to a hatch3r-shipped artifact's body from a separate override file (survives full regeneration) | **`.customize.md`** | `.hatch3r/{agents,skills,commands,rules}/{id}.customize.md` | The override file — hatch3r re-appends its content to the artifact body on every sync |
| Replace a hatch3r-shipped artifact's body entirely | **Canonical override** | `.hatch3r/overrides/{type}/{id}.md` | The override file — adapters prefer this over the bundled canonical |

Rule of thumb: use `.customize.yaml` for narrow field overrides (model selection, scope tweak), use `.customize.md` to append project-specific guidance to a shipped artifact's body, use canonical overrides for whole-body rewrites, use managed blocks for free-form notes alongside generated content, and use non-prefixed files for original project artifacts.

## Managed vs. Custom Files

hatch3r uses a naming convention to separate managed from custom files:

- `hatch3r-*` files are managed by hatch3r
- Files without the prefix are your customizations and are never touched

```
.cursor/rules/
  hatch3r-code-standards.mdc     # Managed
  hatch3r-git-conventions.mdc    # Managed
  my-project-conventions.mdc     # Custom -- never touched
```

## Managed Blocks

All hatch3r-generated markdown files use managed blocks. Only the content between `<!-- HATCH3R:BEGIN -->` and `<!-- HATCH3R:END -->` is updated on `hatch3r sync` or `hatch3r update`. Content you add outside these markers is preserved.

```markdown
<!-- HATCH3R:BEGIN -->
...managed content (updated on sync/update)...
<!-- HATCH3R:END -->

## My Custom Section
...never overwritten...
```

Config files (JSON, TOML, YAML) are fully regenerated on sync. For details on how managed blocks work across the adapter system, see [Adapter System](../reference/architecture/adapter-system).

## Per-Component Customization

hatch3r provides two per-artifact override files under `.hatch3r/{type}/`, both read on every `hatch3r sync` without modifying the managed definitions: `.customize.yaml` for narrow field overrides (`model`, `scope`, `description`, `enabled`) and `.customize.md` for appending content to the artifact body. Four override layers compose in a fixed order.

### Override precedence

A higher layer wins on conflict; a lower-layer attempt to change a field a higher layer locks is dropped with a warning.

| Layer | Source | Governs | Notes |
|-------|--------|---------|-------|
| 1 (highest) | Canonical frontmatter — `protected: true` and `floor:*` tags | Whether lower layers may change `scope`, `description`, `enabled` | `protected` locks all three; a `floor:*` tag locks `enabled` only. A blocked field warns and is ignored. |
| 2 | `.customize.yaml` fields (`model`, `scope`, `description`, `enabled`) | Narrow field overrides | `scope` is honored on rules only; `enabled: false` only when the artifact is neither protected nor floor-tagged; `model` only after passing the deny-pattern scan. |
| 3 | `.customize.md` body | Content appended to the artifact body | Byte caps and the fail-closed deny scan are covered in [Content append](#content-append-customizemd). |
| 4 (lowest) | Manifest `customization` payload in `hatch.json` | Round-trips layer-2 fields across `clean` → re-init | Superseded by `.customize.yaml` on the same field whenever both are present. |

Model selection resolves on its own four-level axis (`.customize.yaml` → manifest per-artifact → canonical frontmatter → manifest default, agents only); see [Model Selection](./model-selection) for that axis and the per-adapter emission surfaces.

### Agents

Create `.hatch3r/agents/{agent-id}.customize.yaml` (the file is keyed by id via its filename, so set only the override fields — `model` for agents):

```yaml
model: codex
```

Run the `/hatch3r-customize` skill (an AI-tool slash command inside Cursor or Claude Code) for interactive setup across every artifact type.

### Skills

Create `.hatch3r/skills/{skill-id}.customize.yaml`. Skills accept `model`, `description`, and `enabled` (the `model` value is emitted only on adapters that support a per-skill model — see [Model Selection](./model-selection)):

```yaml
model: sonnet
description: Feature workflow tuned for our service conventions
```

The `/hatch3r-customize` skill handles skills too — pass the skill id when it asks what to customize.

### Rules

Create `.hatch3r/rules/{rule-id}.customize.yaml`. Rules accept `scope` (when the rule applies) plus `description` and `enabled`:

```yaml
scope: always
```

The `/hatch3r-customize` skill handles rules too — pass the rule id when it asks what to customize.

### Rule precedence and generated filenames

Rules declare an optional `precedence: critical|high|normal|low` field in canonical frontmatter (default `normal`). Per-file rule adapters (cursor, copilot) emit filenames prefixed with a two-digit rank — `10-` (critical), `30-` (high), `50-` (normal), `70-` (low) — so generated output loads in precedence order. The Claude adapter inlines always-apply rules into `CLAUDE.md` in precedence order.

Validate with `npx hatch3r validate`. Parity between `.md` and `.mdc` variants is enforced by `npm run validate:rule-parity`. See [Rules reference](../reference/rules#rule-precedence-and-description-quality).

### Commands

Create `.hatch3r/commands/{command-id}.customize.yaml`. Commands accept `model`, `description`, and `enabled` (the `model` value is emitted only on adapters that support a per-command model — see [Model Selection](./model-selection)):

```yaml
enabled: false
```

The `/hatch3r-customize` skill handles commands too — pass the command id when it asks what to customize.

### Content append (`.customize.md`)

`.customize.yaml` overrides individual frontmatter fields; `.customize.md` appends free-form markdown to the artifact's body. Use it to add project-specific guidance to a hatch3r-shipped agent, skill, command, or rule without forking the canonical file — house conventions an agent should follow, or repo-specific context for a rule.

Create `.hatch3r/{type}/{id}.customize.md` (for example `.hatch3r/agents/hatch3r-reviewer.customize.md`). On every `hatch3r sync`, hatch3r appends the file's content inside the artifact's managed body as override Layer 3.

Three guards run on every append, in order:

- **Byte cap.** 10,240 bytes (10 KB) for ordinary artifacts; 2,048 bytes (2 KB) for `protected` artifacts (security floors). Content over the cap is truncated on a codepoint boundary and a warning names the file.
- **Injection and deny-pattern scan (fail-closed).** The append passes through the same prompt-injection guard and deny-pattern scan hatch3r runs on pipeline input. A single hit drops the entire append — not only the matched span — and reports each violation as a warning.
- **Marker neutralization.** Embedded `HATCH3R:BEGIN`/`END` or `USER-CUSTOMIZATION:BEGIN`/`END` markers are rewritten to inert comments so appended text cannot forge hatch3r's managed-block trust boundary.

Because the append is applied at sync time from a separate file, it survives full regeneration of the artifact — unlike a hand-edit to the generated file, which survives only when placed outside the managed block.

## Authoring New User-Tier Artifacts

The `/hatch3r-customize` skill above adjusts hatch3r's stock content. To author a brand-new project-specific artifact that hatch3r does not ship, use the `create` command.

`/hatch3r-create` walks you through type selection (agent, skill, rule, command, or hook), name, description, tags, adapter scope, and type-specific fields. It then delegates to the `hatch3r-creator` sub-agent, which composes the frontmatter and body skeleton, runs the same strict frontmatter/security/structural gates the framework uses on canonical content (block on failure) plus style/lean checks as warnings, and atomic-writes the file.

Outputs land under `.hatch3r/overrides/{type}/{name}.md`:

- Rule artifacts also receive a paired `.mdc` companion via the `.md → .mdc` scope transform.
- Skill artifacts create a `{name}/SKILL.md` subdirectory.

Files under `.hatch3r/overrides/` are preserved across `hatch3r update` and `hatch3r clean`. Names beginning with `hatch3r-` are reserved for canonical framework content and rejected at validation. Run `hatch3r sync` after creation to propagate the artifact to all enabled adapter outputs.

See the [create command reference](../reference/commands/agent-commands#create) for the full input contract and gate behavior.

## Switching tools

When you change your selected tools with `hatch3r config` (for example, dropping Claude Code and adding Cursor), your project-level work is tool-agnostic and is not lost. Here is what happens to each category:

| Category | What happens on switch |
|----------|------------------------|
| `.hatch3r/overrides/`, `.hatch3r/learnings/`, `.hatch3r/handoffs/`, `.hatch3r/mcp/` | **Carries forward unconditionally.** These directories are tool-neutral state — `hatch3r config` never archives or rewrites them. |
| Removed tool's adapter output (`.claude/`, `.cursor/`, `.github/`, bridge files) | **Swept to `.hatch3r-archive/`** per the tool's archive prefix set. The sweep is directory-based, so files you authored yourself under those paths (your own `.github/prompts/*.prompt.md` or `.github/instructions/*`, a hand-written `.cursor/rules/*.mdc`) are moved too — the removal preview counts them as non-hatch3r files and warns before asking consent. To undo the removal, run `hatch3r rollback --session=<id>` with the `config-<ts>` snapshot named in the summary: it restores everything swept, including your own files. `.hatch3r-archive/` itself is gitignored and deleted by `hatch3r clean` — an inspection copy, not the undo path. |
| Added tool's adapter output | **Generated from bundled canonical content** on the next sync. Restart your editor to pick it up. |
| `.env.mcp` MCP secrets | **Shared across tools** — no re-entry needed. Cursor and Claude Code require sourcing `.env.mcp` before launch (`set -a && source .env.mcp && set +a`); VS Code / Copilot auto-load it via `.vscode/mcp.json`. |

How learnings replay on the new tool: the canonical agents (`hatch3r-reviewer`, `hatch3r-researcher`, `hatch3r-implementer`, `hatch3r-fixer`, and others) read `.hatch3r/learnings/INDEX.md` on their first invocation, per the mandatory consultation gate in `rules/hatch3r-learning-system.md`. You do not re-point the new tool's agents at your learnings; they consult `INDEX.md` automatically when it is present. The same is true of handoff documents under `.hatch3r/handoffs/`.

## Composable Recipes

Recipes are reusable workflow templates that chain multiple commands and skills into repeatable sequences. Use the `recipe` command to create and manage them.

## Event-Driven Hooks

Hooks trigger agents on specific lifecycle events (e.g., post-commit, pre-push, issue assignment). Use the `hooks` command to view, add, remove, and test hooks. Supports both local and CI hook targets.

## Presets

hatch3r ships with 4 content presets: **Minimal** (core orchestration + implementation plus floor), **Standard** (recommended — full dev lifecycle plus floor; drops 2 capability clusters: AI feature engineering + performance), **Full** (every capability, including AI feature engineering and performance), and **Custom** (pick exactly what you need). Select during `hatch3r init` or change later with `hatch3r config`.

## Task-Type Routing

`hatch3r sync` emits a `## Task Type → Routing` table into each adapter's bridge instruction file (`CLAUDE.md` for Claude Code, `copilot-instructions.md` for Copilot, the inlined orchestration doc for Cursor). Each row maps a workflow or domain tag (planning, implementation, review, devops, maintenance, board, security-review, accessibility, performance, customize, core-workflow) to:

- **Primary** — the best-matching agent, slash-command, or skill for that task type
- **Fallback Agents** — other agents carrying the same tag
- **Skills** and **Rules** — relevant supporting content

The table is rebuilt from the selected content on every `sync`: customizing your content selection (adding or removing agents/skills/commands/rules) changes which rows and fallbacks appear. Rows are built by `buildTaskRouterModel()` in `src/cli/shared/agentsContent.ts`.
