---
id: hatch3r-skill-customize
description: Create and manage per-skill customization files for description overrides, enable/disable control, and project-specific markdown instructions. Use when tailoring skill workflows to project-specific needs.
---
# Skill Customization Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify which skill to customize
- [ ] Step 2: Determine customization needs
- [ ] Step 3: Create the customization files
- [ ] Step 4: Sync to propagate changes
- [ ] Step 5: Verify the customized output
```

## Step 1: Identify Skill

Determine which hatch3r skill needs customization:
- Review the skills in `.agents/skills/` and their default workflows
- Identify gaps between default workflows and project needs
- Check for existing customization files in `.hatch3r/skills/`

## Step 2: Determine Customization Needs

Decide which customization approach to use:

**YAML (`.customize.yaml`)** — for structured overrides:
- **Description**: Change how the skill is described in adapter frontmatter
- **Enabled**: Set to `false` to disable the skill entirely

**Markdown (`.customize.md`)** — for free-form instructions:
- Project-specific workflow additions
- Additional prerequisites or validation steps
- Custom tooling or process requirements

## Step 3: Create Customization Files

Create files in `.hatch3r/skills/`:

**For YAML overrides:**
```yaml
# .hatch3r/skills/{skill-id}.customize.yaml
description: "Issue workflow with mandatory security review"
```

**For markdown instructions:**
Create `.hatch3r/skills/{skill-id}.customize.md` with project-specific additions. This content is injected into the managed block under `## Project Customizations`.

## Step 4: Sync

Run `npx hatch3r sync` to propagate customizations to all adapter outputs.

## Step 5: Verify

Confirm customizations appear in adapter output files:
- Check description in frontmatter (where applicable)
- Check markdown instructions appear inside the managed block
- Verify disabled skills are absent from adapter outputs

## Definition of Done

- [ ] Customization files created in `.hatch3r/skills/`
- [ ] `npx hatch3r sync` completes without errors
- [ ] Adapter output files reflect the customizations
- [ ] Customization files committed to the repository
