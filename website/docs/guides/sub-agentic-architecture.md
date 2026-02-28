---
sidebar_position: 6
title: Sub-Agentic Architecture
---

# Sub-Agentic Architecture

hatch3r includes a proven sub-agentic delegation system for orchestrating complex work.

## Components

### Implementer Agent

The `hatch3r-implementer` agent is a focused implementation agent for a single sub-issue. It:

- Receives issue context from a parent orchestrator
- Delivers code and tests
- Reports structured results
- Does **not** handle git or board operations (the orchestrator manages those)

### Issue Workflow Skill

The `hatch3r-issue-workflow` skill provides an 8-step structured workflow:

1. Parse the issue
2. Load the appropriate skill
3. Read project specs
4. Plan the implementation
5. Implement
6. Test
7. Create a PR
8. Address review feedback

For epics, it delegates to parallel sub-agents for independent sub-issues.

### Board Pickup

The `board-pickup` command orchestrates the full cycle:

- Dependency-aware auto-pick with collision detection
- Branch creation and issue status updates
- Sub-agent orchestration for epics
- Quality checks and PR creation

## Tooling Hierarchy

When agents need information, they follow this priority order:

1. **Project docs** -- `docs/specs/`, `docs/adr/`, `docs/process/`
2. **Codebase search** -- grep, read files, understand existing code
3. **Library docs** -- Context7 MCP for up-to-date documentation
4. **Web research** -- Brave Search MCP as a last resort

## Delegation Patterns

### Sequential Pipeline

For dependent work (implement, then test, then review):

1. Spawn `hatch3r-implementer` with file scope
2. Collect results, spawn `hatch3r-test-writer` with implementation summary
3. Collect results, spawn `hatch3r-reviewer` with full diff

### Parallel Fan-Out

For independent work across areas:

1. Spawn `hatch3r-implementer` for `src/api/` changes
2. Spawn `hatch3r-implementer` for `src/ui/` changes (different files)
3. Spawn `hatch3r-docs-writer` for documentation updates

### Planning Fan-Out

Planning commands use parallel researcher sub-agents:

- `project-spec` -- stack, features, architecture, pitfalls, UX, business, production
- `feature-plan` -- codebase impact, feature design, architecture, risk
- `bug-plan` -- symptom tracer, root cause investigator, impact assessor, regression researcher
- `refactor-plan` -- current state analyzer, strategy designer, impact assessor, migration planner
