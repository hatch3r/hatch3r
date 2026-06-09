---
name: h4tcher-content-author
description: Author or modify a canonical content artifact (agent, skill, rule, command, hook) with frontmatter, quality charter compliance, and duplication checking.
effort: high
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

> Last updated: 2026-05-29

# Content Author

Author or modify a hatch3r canonical content artifact.

## §0.1: Ambiguity Gate (P8 B1)

Per CONSTITUTION §2 P8 B1: every framework-dev workflow mutating canonical artifacts detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven. Apply the protocol when any hold: (a) ambiguous scope (which artifact type — agent vs skill vs command per the Decision #13 discriminator — or new-vs-edit), (b) multiple valid interpretations with materially different cost/scope/risk, (c) irreversible action (public artifact id rename, frontmatter-field drop), or (d) missing acceptance criteria (no testable definition of done). Use the platform-native question tool; one question per turn; 2-4 numbered options with one-line trade-offs; declare the default-if-no-response. Do NOT proceed to Step 1 until resolved or the default is confirmed.

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

## Step 3: Reputable-Source Reconnaissance (Decision #14)

Required for new agents, skills, and rules. Skip only for trivial edits (typo, frontmatter-only, single-line clarification).

1. Web-search ≥2 independent reputable sources covering the topic the new artifact will address. Trust tier ordering per `agents/shared/rigor-contract.md`: official vendor docs > peer-reviewed methodology > named-maintainer agent/skill libraries (e.g., Anthropic Claude Code agent registry, established cookbook patterns) > vendor notes > independent analyses > blog posts. Recency window ≤12 months.
2. Synthesise patterns — what structural choices, decision criteria, and verification steps recur across sources. Do NOT copy verbatim; encode the synthesis in the new artifact's voice.
3. Record sources in a `## References` section at the bottom of the new artifact: URL, access date (YYYY-MM-DD), trust tier, one-line attribution of what you took from each.
4. If <2 reputable sources exist for the topic, halt and surface that finding — the artifact may be premature.

## Step 4: Author

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

## Step 5: Validate

9. **Pillar alignment:** Document which pillar(s) this artifact serves (P1-P8)
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
    - Is the artifact sized to the limit for its type? There is no universal `<150` cap. Pipeline agents (research/implement/review/final) target ≲150 lines per D05 §5.1; every other class follows its CONSTITUTION §2 P5 file-class limit (e.g., `rules/*.md` critical/high ≤250, normal/low ≤120). Orchestrators, board, and spec artifacts legitimately run longer — measure against the class limit, not 150.
12. **Anti-slop scan:** Verify zero banned phrases per wordlist in CLAUDE.md
