---
name: h4tcher-content-author
description: Author or modify a canonical content artifact (agent, skill, rule, command, hook) with frontmatter, quality charter compliance, and duplication checking.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

# Content Author

Author or modify a hatch3r canonical content artifact.

## Step 1: Determine Artifact Type

Identify the content type from user input:
- **Agent:** `agents/hatch3r-{name}.md`
- **Skill:** `skills/hatch3r-{name}/SKILL.md`
- **Rule:** `rules/hatch3r-{name}.md` + `rules/hatch3r-{name}.mdc` (both required)
- **Command:** `commands/hatch3r-{name}.md`
- **Hook:** `hooks/hatch3r-{name}.md`

## Step 2: Study Existing Patterns

1. Read `agents/shared/quality-charter.md` — all artifacts must embody these standards
2. Read 2-3 existing artifacts of the same type for frontmatter schema, structure, tone
3. Check `agents/shared/external-knowledge.md` for tooling hierarchy (if it exists)

## Step 3: Author

4. Write YAML frontmatter:
   ```yaml
   ---
   id: hatch3r-{name}
   type: agent|skill|rule|command|hook
   description: One-line description
   tags: [relevant, tags]
   quality_charter: agents/shared/quality-charter.md
   ---
   ```
5. For agents: include role definition, key files, key specs sections
6. For skills: follow Quick Start + Step pattern with numbered workflow steps
7. For rules: produce both `.md` and `.mdc` variants with matching content
8. For commands: include workflow steps, sub-agent delegation, quality gates

## Step 4: Validate

9. **Pillar alignment:** Document which pillar(s) this artifact serves (P1-P7)
10. **Duplication check:** Search existing artifacts for overlapping scope:
    ```
    grep -r "similar-keyword" agents/ skills/ rules/ commands/ hooks/
    ```
    If overlap found: propose merge or boundary clarification instead of creating duplicate
11. **D05 universal checklist** (from `governance/audit/domains/D05-prompt-engineering.md`):
    - Would an LLM execute this on first attempt without clarification?
    - Are instructions unambiguous and sequenced logically?
    - Is expected output format explicitly defined?
    - Are scope boundaries clear?
    - Is the artifact optimally sized (<150 lines)?
12. **Anti-slop scan:** Verify zero banned phrases per wordlist in CLAUDE.md
