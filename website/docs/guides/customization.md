---
sidebar_position: 5
title: Customization
---

# Customization

hatch3r is designed to be extended without conflicting with managed updates.

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

hatch3r provides `.customize.yaml` files for fine-grained overrides without modifying managed definitions.

### Agents

Create `.hatch3r/agents/{agent-id}.customize.yaml`:

```yaml
agent: hatch3r-reviewer
model: codex
```

Use the `agent-customize` command for interactive setup.

### Skills

Create `.hatch3r/skills/{skill-id}.customize.yaml`:

```yaml
skill: hatch3r-feature
```

Use the `skill-customize` command for interactive setup.

### Rules

Create `.hatch3r/rules/{rule-id}.customize.yaml`:

```yaml
rule: hatch3r-code-standards
```

Use the `rule-customize` command for interactive setup.

### Rule precedence and generated filenames

Rules declare an optional `precedence: critical|high|normal|low` field in canonical frontmatter (default `normal`). Per-file rule adapters (cursor, windsurf, copilot, claude, cline) emit filenames prefixed with a two-digit rank — `10-` (critical), `30-` (high), `50-` (normal), `70-` (low) — so generated output loads in precedence order. Inline adapters (gemini, aider, amp, goose, zed, antigravity, amazon-q, codex) sort by precedence before concatenation.

Validate with `npx hatch3r validate`. Parity between `.md` and `.mdc` variants is enforced by `npm run validate:rule-parity`. See [Rules reference](../reference/rules#rule-precedence-and-description-quality).

### Commands

Create `.hatch3r/commands/{command-id}.customize.yaml`:

```yaml
command: hatch3r-board-fill
```

Use the `command-customize` command for interactive setup.

## Authoring New User-Tier Artifacts

The `*-customize` commands above adjust hatch3r's stock content. To author a brand-new project-specific artifact that hatch3r does not ship, use the `create` command.

`/hatch3r-create` walks you through type selection (agent, skill, rule, command, or hook), name, description, tags, adapter scope, and type-specific fields. It then delegates to the `hatch3r-creator` sub-agent, which composes the frontmatter and body skeleton, runs the same strict frontmatter/security/structural gates the framework uses on canonical content (block on failure) plus style/lean checks as warnings, and atomic-writes the file.

Outputs land under `.agents/user/{type}/{name}.md`:

- Rule artifacts also receive a paired `.mdc` companion via the `.md → .mdc` scope transform.
- Skill artifacts create a `{name}/SKILL.md` subdirectory.

Files under `.agents/user/` are preserved across `hatch3r update` and `hatch3r clean`. Names beginning with `hatch3r-` are reserved for canonical framework content and rejected at validation. Run `hatch3r sync` after creation to propagate the artifact to all enabled adapter outputs.

See the [create command reference](../reference/commands/agent-commands#create) for the full input contract and gate behavior.

## Composable Recipes

Recipes are reusable workflow templates that chain multiple commands and skills into repeatable sequences. Use the `recipe` command to create and manage them.

## Event-Driven Hooks

Hooks trigger agents on specific lifecycle events (e.g., post-commit, pre-push, issue assignment). Use the `hooks` command to view, add, remove, and test hooks. Supports both local and CI hook targets.

## Presets

hatch3r ships with 4 content presets: **Minimal** (core only), **Standard** (recommended, full dev lifecycle without niche audits), **Full** (everything including board management and all audits), and **Custom** (pick exactly what you need). Select during `hatch3r init` or change later with `hatch3r config`.

## Task-Type Routing

`hatch3r sync` emits a `## Task Type → Routing` table into `.agents/AGENTS.md` (inherited by Claude, Cursor, Windsurf, and Copilot bridges). Each row maps a workflow or domain tag (planning, implementation, review, devops, maintenance, board, security-review, accessibility, performance, customize, core-workflow) to:

- **Primary** — the best-matching agent, slash-command, or skill for that task type
- **Fallback Agents** — other agents carrying the same tag
- **Skills** and **Rules** — relevant supporting content

The table is rebuilt from the selected content on every `sync`: customizing your content selection (adding or removing agents/skills/commands/rules) changes which rows and fallbacks appear. Rows are built by `buildTaskRouterModel()` in `src/cli/shared/agentsContent.ts`.
