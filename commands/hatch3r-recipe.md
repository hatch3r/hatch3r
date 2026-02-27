---
id: hatch3r-recipe
type: command
description: Execute shareable workflow recipes that compose agents, skills, and commands into guided sequences for common development scenarios
---
# Recipe System — Composable Workflow Orchestration

Execute predefined or custom workflow recipes that chain hatch3r's agents, skills, and commands into repeatable guided sequences for common development scenarios.

---

## Recipe Format

Recipes are YAML files stored in `.hatch3r/recipes/` (project-level) or `~/.hatch3r/recipes/` (user-level).

### Recipe Schema

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
    command: hatch3r-board-init
    depends_on: [generate-spec]
    checkpoint: true

  - id: fill-board
    name: Fill Board from Specification
    command: hatch3r-board-fill
    depends_on: [init-board]

  - id: security-baseline
    name: Security Baseline Audit
    command: hatch3r-security-audit
    depends_on: [fill-board]
    parallel_with: [a11y-baseline]

  - id: a11y-baseline
    name: Accessibility Baseline
    skill: hatch3r-a11y-audit
    depends_on: [fill-board]
    parallel_with: [security-baseline]

  - id: first-pickup
    name: Pick Up First Issue
    command: hatch3r-board-pickup
    depends_on: [security-baseline, a11y-baseline]
    checkpoint: true

completion:
  message: "Project {{ project_name }} is set up with board, security audit, and first issue in progress."
  next_steps:
    - Continue with `board-pickup` to implement remaining issues
    - Run `hatch3r-dep-audit` for dependency security baseline
```

## Built-in Recipes

### 1. Greenfield Setup
Full project initialization: spec -> board -> audit -> first issue.

### 2. Legacy Onboarding
Codebase analysis -> codebase map -> board setup -> healthcheck -> first improvements.

### 3. Security Hardening
Security audit -> dependency audit -> findings triage -> hardening implementation.

### 4. Performance Sprint
Performance audit -> budget review -> optimization planning -> implementation -> verification.

### 5. Release Preparation
Healthcheck -> test validation -> security scan -> changelog -> release.

### 6. Quality Gate
Lint fix -> test coverage review -> a11y audit -> perf audit -> security scan.

## Recipe Execution

### Workflow

1. **Parse recipe**: Load and validate YAML schema, resolve variable references.
2. **Check prerequisites**: Verify all prerequisites are met before starting.
3. **Collect variables**: Prompt user for required variables (or accept via CLI args).
4. **Build execution graph**: Resolve `depends_on` and `parallel_with` into a dependency DAG.
5. **Execute steps**: Run steps in dependency order, parallelizing where possible.
6. **Handle checkpoints**: At `checkpoint: true` steps, pause and present progress to user.
7. **Report completion**: Show completion message and next steps.

### Execution Modes

| Mode | Behavior |
|------|----------|
| Interactive (default) | Pause at checkpoints, show progress |
| Auto (`--auto`) | Skip checkpoints, run all steps autonomously |
| Dry-run (`--dry-run`) | Show execution plan without running |
| Resume (`--resume`) | Continue from last checkpoint |

### Error Handling

- **Step failure**: Stop execution, show error, offer retry or skip.
- **Dependency failure**: Skip dependent steps, mark as blocked.
- **Partial completion**: Save progress, allow resume from last successful step.

## Custom Recipes

### Creating a Recipe

1. Create a YAML file in `.hatch3r/recipes/your-recipe.yaml`
2. Follow the recipe schema above
3. Test with `--dry-run` mode
4. Share by including in the project repository

### Recipe Composition

Recipes can reference other recipes as steps:
```yaml
steps:
  - id: security
    recipe: security-hardening
    inputs:
      scope: full
```

## Output Format

```
## Recipe Execution: {recipe_name}

**Status:** COMPLETE | PARTIAL | FAILED

**Steps:**

| # | Step | Status | Duration | Notes |
|---|------|--------|----------|-------|
| 1 | Generate Spec | DONE | 5m | Spec created at docs/spec.md |
| 2 | Init Board | DONE | 2m | Board created with 8 columns |
| 3 | Fill Board | DONE | 8m | 24 issues created |
| 4 | Security Audit | DONE | 3m | Audit epic #45 created |
| 5 | First Pickup | IN PROGRESS | - | Working on #46 |

**Variables Used:**
- project_name: {value}
- tech_stack: {value}

**Next Steps:**
- {recommendations}
```

## Guardrails

- Recipes must not bypass safety checkpoints for destructive operations
- Recipe files are validated against the schema before execution
- Circular dependencies in the execution graph are detected and rejected
- Variable injection is sanitized to prevent command injection
