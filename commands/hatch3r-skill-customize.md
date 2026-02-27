---
id: hatch3r-skill-customize
type: command
description: Configure per-skill customization including description overrides, enable/disable control, and project-specific markdown instructions
---
# Skill Customization — Per-Skill Configuration

Customize individual skill behavior for project-specific needs via `.hatch3r/skills/` configuration files. Supports structured YAML overrides and free-form markdown instruction injection, all propagated to every adapter output on sync.

---

## Customization File Locations

Each skill supports two optional customization files:

```
.hatch3r/skills/{skill-id}.customize.yaml    # structured overrides
.hatch3r/skills/{skill-id}.customize.md      # free-form markdown instructions
```

Both files are optional and can be used independently or together.

## YAML Customization Schema

```yaml
skill: hatch3r-issue-workflow
description: "Issue workflow with mandatory security review step"
enabled: true
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | (from canonical) | Override the skill's description in adapter frontmatter |
| `enabled` | boolean | `true` | Set to `false` to exclude this skill from adapter output generation |

## Markdown Customization

Create `.hatch3r/skills/{skill-id}.customize.md` with free-form markdown to inject project-specific instructions into the skill's managed block. This content is appended after the canonical skill definition under a `## Project Customizations` header.

### Example

**File:** `.hatch3r/skills/hatch3r-issue-workflow.customize.md`

```markdown
## Project-Specific Workflow Steps

Before starting any issue implementation:

1. Check the `docs/security-checklist.md` for applicable security controls
2. Run `npm run check:deps` to verify no new vulnerability advisories
3. If the issue touches API endpoints, update the OpenAPI spec in `docs/api/`

### Required Labels

All PRs must include at least one of: `feature`, `bugfix`, `refactor`, `docs`, `chore`
```

### How It Works

1. During `hatch3r sync`, adapters read the `.customize.md` file
2. The markdown content is appended inside the managed block, after the canonical skill content
3. All adapter outputs receive the customization automatically
4. Changes propagate on every sync

## Disabling a Skill

To exclude a skill from adapter output without deleting its canonical file:

```yaml
# .hatch3r/skills/hatch3r-visual-refactor.customize.yaml
enabled: false
```

## Workflow

1. Identify which skill to customize
2. Create `.hatch3r/skills/{skill-id}.customize.yaml` and/or `.customize.md`
3. Run `npx hatch3r sync` to propagate changes to all adapter outputs
4. Verify the customization appears in the tool-specific skill files

## Guardrails

- Customization files cannot remove the skill's core workflow steps
- Invalid YAML produces warnings but does not prevent skill execution (graceful degradation)
- Customization files should be committed to the repository

## Related

- Agent customization: `hatch3r-agent-customize` command
- Command customization: `hatch3r-command-customize` command
- Rule customization: `hatch3r-rule-customize` command
