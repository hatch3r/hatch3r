---
id: hatch3r-recipe
name: hatch3r-recipe
description: Create, test, and manage workflow recipes that compose hatch3r capabilities into guided sequences. Use when creating new recipes, customizing existing ones, or troubleshooting recipe execution.
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Recipe Management

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Identify the workflow to capture as a recipe
- [ ] Step 2: Design the step sequence and dependency graph
- [ ] Step 3: Write the recipe YAML
- [ ] Step 4: Test with dry-run mode
- [ ] Step 5: Validate with a real execution
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: recipe scope (single project vs shared), required variables and defaults, checkpoint policy (pause vs flow), error handling (resume vs restart), and target file location (`.hatch3r/recipes/` project vs global).

## Fan-out Discipline (P8 B2)

This skill delegates per task size:
- Tier 1 (trivial single-file): inline execution acceptable.
- Tier 2 (multi-file or multi-concern): spawn parallel sub-agents per concern via the Task tool.
- Tier 3 (multi-module / high-risk): one fresh sub-agent per independent module or gate; orchestrator integrates only.

Never under-fan-out to save tokens. Token cost is dominated by quality and completeness gains. Emit `sub_agents_spawned: { count, rationale }` in your output.

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

## Recipe Schema

Recipes are YAML files stored in `.hatch3r/recipes/` (project-level) or `~/.hatch3r/recipes/` (user-level):

```yaml
name: greenfield-setup
version: 1.0.0
description: Full greenfield project setup from spec to first PR
author: hatch3r
tags: [setup, greenfield, planning]

prerequisites:
  - GitHub repository initialized
  - hatch3r initialized (hatch3r init)

variables:
  project_name:
    description: Project name
    required: true
  tech_stack:
    description: Primary tech stack
    required: true
    options: [react, vue, next, express, fastify]

steps:
  - id: generate-spec
    name: Generate Project Specification
    command: hatch3r-project-spec
    inputs:
      project_name: "{{ project_name }}"
    checkpoint: true

  - id: init-board
    name: Initialize Project Board
    skill: hatch3r-board-init
    depends_on: [generate-spec]
    checkpoint: true

  - id: security-baseline
    name: Security Baseline Audit
    command: hatch3r-security-audit
    depends_on: [init-board]
    parallel_with: [a11y-baseline]

  - id: a11y-baseline
    name: Accessibility Baseline
    skill: hatch3r-a11y-audit
    depends_on: [init-board]
    parallel_with: [security-baseline]

completion:
  message: "Project {{ project_name }} is set up."
  next_steps:
    - Continue with `board-pickup` to implement remaining issues
```

Recipes can also reference other recipes as steps via `recipe: <name>` with `inputs:`.

## Built-in Recipes

1. **Greenfield Setup** — spec → board → audit → first issue
2. **Legacy Onboarding** — codebase analysis → codebase map → board setup → healthcheck → first improvements
3. **Security Hardening** — security audit → dep audit → findings triage → hardening
4. **Performance Sprint** — perf audit → budget review → optimization → verification
5. **Release Preparation** — healthcheck → test validation → security scan → changelog → release
6. **Quality Gate** — lint fix → test coverage review → a11y audit → perf audit → security scan

## Execution Modes

| Mode | Behavior |
|------|----------|
| Interactive (default) | Pause at checkpoints, show progress |
| Auto (`--auto`) | Skip checkpoints, run all steps autonomously |
| Dry-run (`--dry-run`) | Show execution plan without running |
| Resume (`--resume`) | Continue from last checkpoint |

Workflow: parse recipe → check prerequisites → collect variables (CLI args or prompt) → build DAG from `depends_on`/`parallel_with` → execute (parallelizing where possible) → handle checkpoints → report completion.

Guardrails: recipes must not bypass safety checkpoints for destructive operations; YAML is validated against the schema before execution; circular dependencies are detected and rejected; variable injection is sanitized to prevent command injection.

## Step 3: Write Recipe YAML

Create the recipe file in `.hatch3r/recipes/` following the schema above. Include:
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
- Variables are referenced with valid names that resolve to defined values
- Prerequisites are checkable

The recipe runner MUST resolve every `command:` and `skill:` reference against `governance/inventory.json` before execution and raise on any missing ID, so a deprecated or renamed reference fails at parse time rather than mid-workflow.

## Step 5: Validate with Real Execution

Run the recipe on a test project to verify:
- Steps execute in correct order
- Parallel steps don't conflict
- Checkpoints pause appropriately
- Error handling works (intentionally fail a step)
- Completion message is accurate

## Error Handling

- **Recipe step fails during execution**: The recipe runner should report which step failed, its inputs, and the error message. Provide a `resume-from` option to restart from the failed step after fixing the issue.
- **Recipe YAML has schema validation errors**: Report the specific field and line that violates the schema. Do not attempt to execute a recipe that fails validation.
- **Circular dependency between recipe steps**: Detect cycles during the dry-run phase and report the dependency chain that creates the loop.

## Definition of Done

- [ ] Recipe YAML validates against schema
- [ ] Dry-run completes without errors
- [ ] Real execution produces expected results
- [ ] Error handling tested
- [ ] Recipe committed to project or shared globally
