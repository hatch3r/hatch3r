---
id: hatch3r-recipe
description: Create, test, and manage workflow recipes that compose hatch3r capabilities into guided sequences. Use when creating new recipes, customizing existing ones, or troubleshooting recipe execution.
---
# Recipe Management

## Quick Start

```
Task Progress:
- [ ] Step 1: Identify the workflow to capture as a recipe
- [ ] Step 2: Design the step sequence and dependency graph
- [ ] Step 3: Write the recipe YAML
- [ ] Step 4: Test with dry-run mode
- [ ] Step 5: Validate with a real execution
```

## Step 1: Identify Workflow

Determine the repeatable workflow pattern:
- What commands/skills/agents are involved?
- What order do they execute in?
- Which steps can run in parallel?
- Where should the user be asked to confirm (checkpoints)?

## Step 2: Design Step Sequence

Map out the dependency graph:
- List all steps with their hatch3r command or skill reference
- Identify dependencies between steps
- Identify steps that can run in parallel
- Mark checkpoint steps where user confirmation adds value

## Step 3: Write Recipe YAML

Create the recipe file in `.hatch3r/recipes/` following the schema defined in the `hatch3r-recipe` command. Include:
- Clear name and description
- Required variables with descriptions
- Steps with proper `depends_on` and `parallel_with` relationships
- Checkpoint markers at decision points
- Completion message with next steps

## Step 4: Test with Dry-Run

Execute `--dry-run` to validate:
- YAML schema is valid
- All referenced commands/skills exist
- Dependency graph has no cycles
- Variables are properly referenced
- Prerequisites are checkable

## Step 5: Validate with Real Execution

Run the recipe on a test project to verify:
- Steps execute in correct order
- Parallel steps don't conflict
- Checkpoints pause appropriately
- Error handling works (intentionally fail a step)
- Completion message is accurate

## Definition of Done

- [ ] Recipe YAML validates against schema
- [ ] Dry-run completes without errors
- [ ] Real execution produces expected results
- [ ] Error handling tested
- [ ] Recipe committed to project or shared globally
