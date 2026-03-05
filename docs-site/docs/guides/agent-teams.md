---
sidebar_position: 4
title: Agent Teams
---

# Agent Teams Integration Guide

How hatch3r agent definitions integrate with Claude Code Agent Teams (multi-agent orchestration).

## Agent-to-Teammate Mapping

| Hatch3r Concept | Agent Teams Equivalent |
|-----------------|----------------------|
| Agent definition (`.agents/agents/*.md`) | Teammate spawn prompt |
| Agent `description` frontmatter | Teammate role summary |
| Agent content body | Teammate system instructions |
| Skill (`SKILL.md`) | Context file referenced in spawn prompt |
| Rule (`.agents/rules/*.md`) | Included in teammate instructions |

## Spawn Prompt Best Practices

1. **Include the agent content verbatim** as the teammate's role definition
2. **Reference skills explicitly** -- tell the teammate to read specific `SKILL.md` files
3. **State the task goal clearly** at the top of the spawn prompt
4. **Set output expectations** -- specify what the teammate should return

Example spawn prompt:

```
You are the hatch3r-implementer agent. Your task is to implement the feature described in issue #42.

Read .agents/skills/hatch3r-feature/SKILL.md for the implementation workflow.
Read .agents/rules/hatch3r-code-standards.md for coding conventions.

Focus on: src/api/ and src/services/
Do not modify: tests/, docs/, config/
```

## Recommended Team Patterns

**Four-phase pipeline** (standard hatch3r quality pipeline):

1. Spawn `hatch3r-researcher` for context gathering
2. Spawn `hatch3r-implementer` with file scope, researcher output, and resolved requirements
3. Review loop: spawn `hatch3r-reviewer`, if Critical/Warning findings exist spawn `hatch3r-fixer`, re-review — repeat until clean (max 3 iterations)
4. Final quality: spawn `hatch3r-test-writer` + `hatch3r-security-auditor` in parallel

**Parallel fan-out** (independent work across areas):

1. Spawn `hatch3r-implementer` for `src/api/` changes
2. Spawn `hatch3r-implementer` for `src/ui/` changes (different files)
3. Spawn `hatch3r-docs-writer` for documentation updates

## File Boundary Assignment

- Assign non-overlapping directories to each teammate
- Use the agent's natural scope (e.g., `hatch3r-test-writer` owns `src/__tests__/`)
- Shared files (types, configs) should be assigned to one primary teammate
