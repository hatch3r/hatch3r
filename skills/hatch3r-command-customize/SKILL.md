---
id: hatch3r-command-customize
description: Create and manage per-command customization files for description overrides, enable/disable control, and project-specific markdown instructions. Use when tailoring command behavior to project-specific needs.
---
# Command Customization Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify which command to customize
- [ ] Step 2: Determine customization needs
- [ ] Step 3: Create the customization files
- [ ] Step 4: Sync to propagate changes
- [ ] Step 5: Verify the customized output
```

## Step 1: Identify Command

Determine which hatch3r command needs customization:
- Review the commands in `.agents/commands/` and their default behavior
- Identify gaps between default behavior and project needs
- Check for existing customization files in `.hatch3r/commands/`

## Step 2: Determine Customization Needs

Decide which customization approach to use:

**YAML (`.customize.yaml`)** — for structured overrides:
- **Description**: Change how the command is described in adapter outputs
- **Enabled**: Set to `false` to disable the command entirely

**Markdown (`.customize.md`)** — for free-form instructions:
- Project-specific workflow steps
- Additional prerequisites or constraints
- Custom deployment or release procedures

## Step 3: Create Customization Files

Create files in `.hatch3r/commands/`:

**For YAML overrides:**
```yaml
# .hatch3r/commands/{command-id}.customize.yaml
description: "Release workflow with staging validation"
```

**For markdown instructions:**
Create `.hatch3r/commands/{command-id}.customize.md` with project-specific additions. This content is injected into the managed block under `## Project Customizations`.

## Step 4: Sync

Run `npx hatch3r sync` to propagate customizations to all adapter outputs.

## Step 5: Verify

Confirm customizations appear in adapter output files:
- Check description in adapter outputs (where applicable)
- Check markdown instructions appear inside the managed block
- Verify disabled commands are absent from adapter outputs

## Definition of Done

- [ ] Customization files created in `.hatch3r/commands/`
- [ ] `npx hatch3r sync` completes without errors
- [ ] Adapter output files reflect the customizations
- [ ] Customization files committed to the repository
