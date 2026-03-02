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
  hatch3r-error-handling.mdc     # Managed
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

Config files (JSON, TOML, YAML) are fully regenerated on sync.

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

### Commands

Create `.hatch3r/commands/{command-id}.customize.yaml`:

```yaml
command: hatch3r-board-fill
```

Use the `command-customize` command for interactive setup.

## Composable Recipes

Recipes are reusable workflow templates that chain multiple commands and skills into repeatable sequences. Use the `recipe` command to create and manage them.

## Event-Driven Hooks

Hooks trigger agents on specific lifecycle events (e.g., post-commit, pre-push, issue assignment). Use the `hooks` command to view, add, remove, and test hooks. Supports both local and CI hook targets.

## Presets

hatch3r currently ships with the `default` preset which includes everything. Additional preset packs (web-app, api-service, cli-tool, monorepo, legacy, security) are planned for future releases.
