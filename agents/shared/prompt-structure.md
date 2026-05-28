---
id: shared-prompt-structure
type: reference
description: XML-tag structuring pattern for agent prompts — reduces misinterpretation of instructions vs context vs rules per Anthropic Claude 4.x 2026 guidance.
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

## Prompt Structure Pattern

Anthropic's Claude 4.x prompt-engineering guidance (docs.claude.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices, accessed 2026-04-20) recommends wrapping distinct prompt components in named XML tags to reduce misinterpretation when prompts mix instructions, context, rules, and variable inputs. Multi-document structured inputs place queries at the end for up to 30% quality improvement in Anthropic internal tests.

### When To Apply

Agent markdown files whose sections exceed 200 lines, or that interleave (a) the agent's role/task, (b) project or runtime context, and (c) rules/constraints. Short single-purpose agents (e.g., `hatch3r-lint-fixer`) do not need wrapping — the structural benefit appears once multiple content types coexist.

### Canonical Tags

| Tag | Wraps | Example content |
|-----|-------|-----------------|
| `<task>` | What the agent does and its boundaries | Role statement, inputs received, outputs produced |
| `<context>` | Project or runtime state the agent should ground in | Pre-loaded spec summary, issue body, branch, reviewer output |
| `<rules>` | Hard constraints and prohibitions | Never-do list, safety guardrails, scope limits |

Use each tag at most once per agent file — nested or repeated occurrences defeat the parsing benefit. Place tags around the canonical sections that already exist; do not rewrite section content to fit the tag.

### Authoring Rules

1. Tag content stays human-readable markdown — no escape tricks or CDATA blocks.
2. Frontmatter stays outside the tags. The first `<task>` tag opens after frontmatter and the main role paragraph.
3. If a section already carries a clearer purpose (e.g., `## Boundaries`), keep the heading and wrap its body in `<rules>`.
4. Do not introduce new tag names ad hoc — extend this list and update this file if a new category is needed (pillar-backed rationale required per P4 lean coverage).
5. Preserve existing cross-references and links exactly — XML wrapping is additive, not a rewrite.

### Reference Implementations

The following agents demonstrate the pattern and serve as templates for future rollout:

- `agents/hatch3r-implementer.md`
- `agents/hatch3r-researcher.md`
- `agents/hatch3r-reviewer.md`
- `agents/hatch3r-fixer.md`
- `agents/hatch3r-creator.md`
- `agents/hatch3r-architect.md` (D6-M4 — Cycle 9 / Wave 3)
- `agents/hatch3r-learnings-loader.md` (D6-M4 — Cycle 9 / Wave 3)
- `agents/hatch3r-handoff-loader.md` (D6-M4 — Cycle 9 / Wave 3)
- `agents/hatch3r-greenfield-spec.md` (D6-M4 — Cycle 9 / Wave 3)
- `agents/hatch3r-brownfield-spec.md` (D6-M4 — Cycle 9 / Wave 3)

### Rollout Scope

Cycle 7.5 applied the pattern to the first four agents above. Cycle 9 / Wave 3 (per D6-M4) extends it to the five largest remaining agents (architect, learnings-loader, handoff-loader, greenfield-spec, brownfield-spec), bringing total coverage to 10/19 main agents. Remaining single-purpose agents (e.g., `hatch3r-lint-fixer`, `hatch3r-ci-watcher`) do not require wrapping per the When-To-Apply rule. See finding `D6-M4` for the tracking entry.
