---
id: hatch3r-agent-customize
description: Create and manage per-agent customization files for model overrides, description changes, and project-specific markdown instructions. Use when tailoring agent behavior to project-specific needs.
---
# Agent Customization Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify which agent to customize
- [ ] Step 2: Determine customization needs
- [ ] Step 3: Create the customization files
- [ ] Step 4: Sync to propagate changes
- [ ] Step 5: Verify the customized output
```

## Step 1: Identify Agent

Determine which hatch3r agent needs customization:
- Review the agents in `.agents/agents/` and their default behaviors
- Identify gaps between default behavior and project needs
- Check for existing customization files in `.hatch3r/agents/`

## Step 2: Determine Customization Needs

Decide which customization approach to use:

**YAML (`.customize.yaml`)** — for structured overrides:
- **Model**: Override the agent's preferred model (e.g., `model: opus`)
- **Description**: Change how the agent is described in adapter frontmatter
- **Enabled**: Set to `false` to disable the agent entirely

**Markdown (`.customize.md`)** — for free-form instructions:
- Domain-specific review checklists
- Architecture context and constraints
- Project-specific workflow steps
- Compliance and security requirements

## Step 3: Create Customization Files

Create files in `.hatch3r/agents/`:

**For YAML overrides:**
```yaml
# .hatch3r/agents/{agent-id}.customize.yaml
model: opus
description: "Security-focused reviewer for healthcare platform"
```

**For markdown instructions:**
Create `.hatch3r/agents/{agent-id}.customize.md` with project-specific instructions. This content is injected into the managed block under `## Project Customizations`.

Set only the fields/content you need — partial customization is valid.

## Step 4: Sync

Run `npx hatch3r sync` to propagate customizations to all adapter outputs. The sync:
- Reads `.customize.yaml` for structured overrides (model, description, enabled)
- Reads `.customize.md` and appends it inside the managed block
- Generates updated output for every configured adapter (Cursor, Claude, etc.)

## Step 5: Verify

Confirm customizations appear in adapter output files:
- Check model appears in frontmatter (e.g., `.cursor/agents/hatch3r-reviewer.md`)
- Check markdown instructions appear inside the managed block
- Verify disabled agents are absent from adapter outputs

## Definition of Done

- [ ] Customization files created in `.hatch3r/agents/`
- [ ] `npx hatch3r sync` completes without errors
- [ ] Adapter output files reflect the customizations
- [ ] Customization files committed to the repository
