---
id: hatch3r-rule-customize
description: Create and manage per-rule customization files for scope overrides, description changes, enable/disable control, and project-specific markdown instructions. Use when tailoring rules to project-specific needs.
---
# Rule Customization Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify which rule to customize
- [ ] Step 2: Determine customization needs
- [ ] Step 3: Create the customization files
- [ ] Step 4: Sync to propagate changes
- [ ] Step 5: Verify the customized output
```

## Step 1: Identify Rule

Determine which hatch3r rule needs customization:
- Review the rules in `.agents/rules/` and their default scope/content
- Identify gaps between default rules and project needs
- Check for existing customization files in `.hatch3r/rules/`

## Step 2: Determine Customization Needs

Decide which customization approach to use:

**YAML (`.customize.yaml`)** — for structured overrides:
- **Scope**: Override when the rule applies (`always`, glob patterns like `src/**/*.ts`)
- **Description**: Change how the rule is described in adapter outputs
- **Enabled**: Set to `false` to disable the rule entirely

**Markdown (`.customize.md`)** — for free-form instructions:
- Project-specific rule additions or constraints
- Domain-specific standards and requirements
- Framework-specific conventions

## Step 3: Create Customization Files

Create files in `.hatch3r/rules/`:

**For YAML overrides:**
```yaml
# .hatch3r/rules/{rule-id}.customize.yaml
scope: "src/**/*.ts,src/**/*.tsx"
description: "Testing rules with healthcare compliance requirements"
```

**For markdown instructions:**
Create `.hatch3r/rules/{rule-id}.customize.md` with project-specific additions. This content is injected into the managed block under `## Project Customizations`.

## Step 4: Sync

Run `npx hatch3r sync` to propagate customizations to all adapter outputs.

## Step 5: Verify

Confirm customizations appear in adapter output files:
- Check scope is applied correctly in adapter-specific frontmatter (globs, alwaysApply, etc.)
- Check description in adapter outputs
- Check markdown instructions appear inside the managed block
- Verify disabled rules are absent from adapter outputs

## Definition of Done

- [ ] Customization files created in `.hatch3r/rules/`
- [ ] `npx hatch3r sync` completes without errors
- [ ] Adapter output files reflect the customizations (scope, description, content)
- [ ] Customization files committed to the repository
