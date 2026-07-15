---
id: hatch3r-recipe
name: hatch3r-recipe
type: skill
description: Authors and validates composition specs that an orchestrating agent walks via the Task tool to run hatch3r commands and skills in a dependency-ordered sequence. Use when designing a multi-step capability composition, customizing an existing one, or debugging a composition the agent walks.
tags: [orchestration]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---
# Composition Recipes

A composition recipe is a YAML spec that names a repeatable multi-step sequence of hatch3r commands and skills with their dependency edges. hatch3r ships no recipe-runner binary and no `.hatch3r/recipes/` materialization; the recipe is read and walked by the orchestrating agent, which dispatches each step's `command:`/`skill:` reference via the Task tool in dependency order. This skill authors and validates that spec — it does not invoke a runtime.

## Quick Start

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Identify the sequence to capture as a recipe
- [ ] Step 2: Design the step sequence and dependency graph
- [ ] Step 3: Write the recipe YAML
- [ ] Step 4: Validate the spec (resolve references, detect cycles)
- [ ] Step 5: Have the orchestrating agent walk the recipe via the Task tool
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any work, scan the invocation for unresolved questions in scope, intent, acceptance criteria, target environment, or irreversibility. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md`. Do not proceed under silent assumption. Default path, not an exception. Triggers for THIS skill: recipe scope (one project vs shared across projects), required variables and defaults, checkpoint policy (which steps pause for user confirmation), error policy (re-walk from the failed step vs restart the whole recipe), and where the spec file lives in the repo.

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output.

## Step 1: Identify the Sequence

Determine the repeatable sequence pattern:
- Which hatch3r commands/skills/agents are involved?
- What order does the orchestrating agent dispatch them in?
- Which steps can the agent dispatch in parallel (disjoint writes, no shared mutable state per `rules/hatch3r-agent-orchestration.md` → Parallel Safety)?
- Where should the agent pause to ask the user to confirm (checkpoints)?

## Step 2: Design Step Sequence

Map out the dependency graph:
- List all steps with their hatch3r command or skill reference
- Identify dependencies between steps
- Identify steps that can run in parallel
- Mark checkpoint steps where user confirmation adds value

## Recipe Schema

A recipe is a YAML spec the orchestrating agent reads and walks. Store it wherever the repo keeps shared agent context (for example, a `docs/recipes/` directory you commit, or pasted directly into the agent prompt) — there is no reserved hatch3r path and no loader that auto-discovers it. The agent resolves each step's `command:`/`skill:` reference against the bundled content inventory and dispatches it via the Task tool:

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

A recipe can reference another recipe as a step via `recipe: <name>` with `inputs:`; the orchestrating agent inlines the referenced spec and walks its steps in place.

## Example Composition Patterns

These are illustrative sequences you can encode as recipe specs — hatch3r does not ship them as files. Each arrow is a `depends_on` edge the orchestrating agent honors when walking the spec:

1. **Greenfield Setup** — `project-spec` → `board-init` → (`security-audit` ∥ a11y audit) → first issue
2. **Legacy Onboarding** — codebase analysis → `codebase-map` → `board-init` → `healthcheck` → first improvements
3. **Security Hardening** — `security-audit` → `dep-audit` → findings triage → hardening
4. **Performance Sprint** — `benchmark` → budget review → optimization → verification
5. **Release Preparation** — `healthcheck` → test validation → security scan → changelog → `release`
6. **Quality Gate** — lint fix → test coverage review → a11y audit → `benchmark` → security scan

## How the Agent Walks a Recipe

The orchestrating agent (not a hatch3r binary) walks the spec:

1. Parse the YAML and check the schema.
2. Collect variable values — from the user prompt or an ASK checkpoint per `agents/shared/user-question-protocol.md` when a `required` variable is unset.
3. Build the dependency DAG from `depends_on`/`parallel_with`.
4. Walk the DAG: for each ready step, dispatch its `command:` or `skill:` reference via the Task tool, parallelizing steps that share no `depends_on` edge and write disjoint paths.
5. Pause at every `checkpoint: true` step to ASK the user before proceeding.
6. Emit the completion message.

Guardrails the agent applies: never auto-proceed past a destructive-operation checkpoint (database migrations, deletions); reject a spec whose `depends_on` graph contains a cycle (report the cycle chain); reject a spec that references a `command:`/`skill:` id not in the bundled content inventory; treat every `{{ variable }}` value as untrusted input and never interpolate it into a shell command without quoting (P6 — `rules/hatch3r-security-patterns.md`).

## Step 3: Write Recipe YAML

Write the recipe spec following the schema above and commit it to the repo (for example under `docs/recipes/`) so the orchestrating agent can read it. Include:
- Clear name and description
- Required variables with descriptions
- Steps with their `depends_on` and `parallel_with` relationships
- Checkpoint markers at decision points
- Completion message with next steps

## Step 4: Validate the Spec

Statically check the spec before any agent walks it — this is author-time review, not a CLI command:
- YAML schema is valid (every step has an `id` and exactly one of `command:`/`skill:`/`recipe:`)
- Every referenced `command:`/`skill:` id exists in the bundled content inventory
- The `depends_on` graph has no cycles
- Every `{{ variable }}` reference names a variable defined in the `variables:` block
- Prerequisites are stated checks a human or the agent can confirm

Resolve every `command:` and `skill:` reference against the bundled content inventory at this step and reject any missing id, so a deprecated or renamed reference fails at author time rather than mid-walk.

## Step 5: Have the Agent Walk the Recipe

Hand the validated spec to the orchestrating agent (paste it into the agent prompt or point the agent at the committed file) and have it walk the recipe per "How the Agent Walks a Recipe" above. Confirm on a representative run that:
- The agent dispatches steps in dependency order
- Parallel steps write disjoint paths and do not conflict
- The agent pauses at every `checkpoint: true` step
- A deliberately failed step surfaces the step id, its inputs, and the error
- The completion message reflects the actual outcome

## Error Handling

- **A step fails while the agent walks the recipe**: the orchestrating agent reports which step failed, its inputs, and the error message, then offers to re-walk from the failed step after the cause is fixed rather than restarting the whole recipe.
- **The recipe YAML has schema errors**: report the specific field and line that violates the schema. The agent does not walk a spec that fails validation.
- **A cycle exists between steps**: catch it during Step 4 validation and report the dependency chain that forms the loop.

## Definition of Done

- [ ] Recipe YAML validates against the schema (Step 4 checks all pass)
- [ ] Every `command:`/`skill:` reference resolves to a bundled-inventory id
- [ ] The orchestrating agent walks the recipe in dependency order on a representative run
- [ ] A deliberately failed step is handled as described in Error Handling
- [ ] Recipe spec committed to the repo for reuse
