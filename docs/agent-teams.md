# Agent Teams Integration Guide

How hatch3r agent definitions integrate with Claude Code Agent Teams (multi-agent orchestration).

---

## Agent-to-Teammate Mapping

Hatch3r agent definitions in `.agents/agents/` map directly to teammate spawn prompts. Each agent's `description` and content become the teammate's role instructions.

| Hatch3r Concept | Agent Teams Equivalent |
|-----------------|----------------------|
| Agent definition (`.agents/agents/*.md`) | Teammate spawn prompt |
| Agent `description` frontmatter | Teammate role summary |
| Agent content body | Teammate system instructions |
| Skill (`SKILL.md`) | Context file referenced in spawn prompt |
| Rule (`.agents/rules/*.md`) | Included in teammate instructions or referenced |

## Spawn Prompt Best Practices

When spawning a teammate from a hatch3r agent definition:

1. **Include the agent content verbatim** as the teammate's role definition. Don't summarize — the full instructions ensure consistent behavior.
2. **Reference skills explicitly** — tell the teammate to read specific `SKILL.md` files: `"Read /.agents/skills/hatch3r-issue-workflow/SKILL.md for your workflow."`.
3. **State the task goal clearly** at the top of the spawn prompt, before the agent instructions.
4. **Set output expectations** — specify what the teammate should return (file paths modified, summary, test results).

Example spawn prompt:

```
You are the hatch3r-implementer agent. Your task is to implement the feature described in issue #42.

Read /.agents/skills/hatch3r-feature/SKILL.md for the implementation workflow.
Read /.agents/rules/hatch3r-code-standards.md for coding conventions.

Focus on: src/api/ and src/services/
Do not modify: tests/, docs/, config/
```

## File Boundary Assignment

Teammates work best with explicit file boundaries to avoid conflicts:

- **Assign non-overlapping directories** to each teammate. If two teammates touch the same files, they'll conflict.
- **Use the agent's natural scope** — the `hatch3r-test-writer` agent naturally owns `src/__tests__/`, the `hatch3r-docs-writer` owns `docs/`.
- **Specify boundaries in the spawn prompt** with both include and exclude paths.
- **Shared files** (types, configs) should be assigned to one primary teammate. Other teammates reference but don't modify.

## Context Passing Between Teammates

Teammates operate independently. Pass context explicitly:

- **Task context** — include the issue body, requirements, or relevant excerpts in the spawn prompt.
- **Codebase context** — list the key files the teammate needs to read. Don't assume they'll discover them.
- **Cross-teammate results** — if teammate B depends on teammate A's output, spawn A first, then include A's results in B's prompt.
- **Project conventions** — reference `/.agents/AGENTS.md` and specific rules files so teammates follow project standards.

## Limitations

| Limitation | Workaround |
|------------|------------|
| Teammates don't inherit the parent's conversation history | Include all necessary context in the spawn prompt |
| Teammates can't communicate with each other directly | Orchestrate through the parent agent — collect results and pass forward |
| Teammates don't see each other's file changes in real-time | Spawn teammates sequentially when they share file scope |
| Teammate context window is independent | Keep spawn prompts focused; reference files instead of inlining large content |
| No shared memory between teammates | Write coordination state to a file (e.g., `TODO.md`) that subsequent teammates read |

## Recommended Team Patterns

**Sequential pipeline** — for dependent work (implement, then test, then review):

1. Spawn `hatch3r-implementer` with file scope
2. Collect results, spawn `hatch3r-test-writer` with implementation summary
3. Collect results, spawn `hatch3r-reviewer` with full diff

**Parallel fan-out** — for independent work across areas:

1. Spawn `hatch3r-implementer` for `src/api/` changes
2. Spawn `hatch3r-implementer` for `src/ui/` changes (different files)
3. Spawn `hatch3r-docs-writer` for documentation updates
