---
id: hatch3r-customize
description: Create and manage customization files for any hatch3r artifact type (agents, commands, rules, skills). Supports model overrides, description changes, scope overrides, enable/disable control, and project-specific markdown instructions.
tags: [customize]
quality_charter: agents/shared/quality-charter.md
---
# Artifact Customization Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify what to customize (and why)
- [ ] Step 2: Determine customization needs
- [ ] Step 3: Multi-stakeholder review
- [ ] Step 4: Create the customization files
- [ ] Step 5: Sync to propagate changes
- [ ] Step 6: Verify the customized output
```

## Artifact Types

This skill handles customization for all artifact types. The `type` parameter determines file locations, available YAML fields, and verification steps.

| Type | Source Directory | Customization Directory | YAML Fields |
|------|-----------------|------------------------|-------------|
| `agent` | `.agents/agents/` | `.hatch3r/agents/` | `model`, `description`, `enabled` |
| `command` | `.agents/commands/` | `.hatch3r/commands/` | `description`, `enabled` |
| `rule` | `.agents/rules/` | `.hatch3r/rules/` | `scope`, `description`, `enabled` |
| `skill` | `.agents/skills/` | `.hatch3r/skills/` | `description`, `enabled` |

**Protected agents:** Some agents have `protected: true` in their canonical frontmatter. For these agents, `description` and `enabled` overrides are ignored — only `model` and markdown instructions can be customized.

## Step 1: Identify and Root-Cause

Determine which artifact needs customization and **why**:

1. Review the artifacts in the appropriate source directory and their default behaviors.
2. Identify gaps between default behavior and project needs.
3. Check for existing customization files in the appropriate `.hatch3r/{type}s/` directory.
4. **Root-cause analysis:** Before proceeding, consider:
   - Is this a genuine project-specific need, or a workaround for a bug in the default content?
   - Would this customization be better addressed upstream (by modifying the canonical artifact)?
   - Could a rule or learning achieve the same effect with less coupling?

   If the customization is working around a default content issue, note it as a candidate for upstream contribution before proceeding.

## Step 2: Determine Customization Needs

Decide which customization approach to use:

**YAML (`.customize.yaml`)** — for structured overrides:

| Field | Available For | Description |
|-------|--------------|-------------|
| `model` | agent only | Override the agent's preferred model |
| `scope` | rule only | Override when the rule applies (`always` or glob patterns) |
| `description` | all types | Change how the artifact is described in adapter outputs |
| `enabled` | all types | Set to `false` to exclude from adapter output generation |

**Markdown (`.customize.md`)** — for free-form instructions:
- Domain-specific checklists, constraints, or workflow additions
- Architecture context relevant to the artifact's function
- Project-specific requirements (compliance, testing, deployment)

Set only the fields/content you need — partial customization is valid.

## Step 3: Multi-Stakeholder Review

Before creating customization files, consider the impact from multiple perspectives:

1. **Developer experience:** Does this customization make the developer's workflow better or worse? Will it cause confusion for new team members?
2. **Quality impact:** Does disabling or weakening an artifact (especially agents or rules) reduce quality safeguards? What compensating controls exist?
3. **Maintenance burden:** Will this customization need updating when the upstream canonical artifact changes? Is the coupling acceptable?
4. **Consistency:** Does this customization create inconsistency with other artifacts or team conventions?

**Confidence expression:** State your confidence in the customization decision:
- **High confidence:** Clear project-specific need with no quality trade-offs.
- **Medium confidence:** Reasonable need but with trade-offs worth noting.
- **Low confidence:** Workaround or uncertain benefit — recommend revisiting after more experience.

## Step 4: Create Customization Files

Create files in `.hatch3r/{type}s/`:

**For YAML overrides:** Create `.hatch3r/{type}s/{artifact-id}.customize.yaml` with the applicable fields from the Step 2 table.

**For markdown instructions:** Create `.hatch3r/{type}s/{artifact-id}.customize.md` with project-specific content. This is injected into the managed block under `## Project Customizations`.

## Step 5: Sync

Run `npx hatch3r sync` to propagate customizations to all adapter outputs. The sync reads `.customize.yaml` for structured overrides, reads `.customize.md` and appends it inside the managed block, and generates updated output for every configured adapter.

## Step 6: Verify

Confirm customizations appear in adapter output files:
- Check YAML fields are reflected in adapter-specific frontmatter
- Check markdown instructions appear inside the managed block
- Verify disabled artifacts are absent from adapter outputs
- **For rules:** verify scope field in adapter-specific frontmatter matches the configured scope value

### Quality Gate

Verification is not just "sync completes." Confirm:
- [ ] The adapter output for the customized artifact contains the expected changes
- [ ] No unrelated artifacts were affected by the sync
- [ ] If an artifact was disabled, verify no command or skill references it as a required dependency
- [ ] If a rule scope was narrowed, verify the excluded file patterns do not lose important coverage

## Definition of Done

- [ ] Root-cause considered (Step 1) — not working around an upstream issue
- [ ] Multi-stakeholder impact reviewed (Step 3)
- [ ] Customization files created in `.hatch3r/{type}s/`
- [ ] `npx hatch3r sync` completes without errors
- [ ] Adapter output files reflect the customizations
- [ ] Quality gate checks pass (Step 6)
- [ ] Customization files committed to the repository
