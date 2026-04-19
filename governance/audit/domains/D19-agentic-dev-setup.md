# Domain 19: Agentic Development Self-Governance

> Last updated: 2026-04-19

**Pillars served:** P5 (primary), P2 (supporting).

**Scope:** The agentic development environment used to develop hatch3r itself — CLAUDE.md, `.claude/` configuration (rules, skills, hooks, settings). Audits whether this setup correctly reflects the governance system it enforces.
**Sub-agents:** 4

## Sub-Agent Decomposition

| SA | Focus |
|----|-------|
| 19.1 | CLAUDE.md & Settings Accuracy |
| 19.2 | Rule-Governance Alignment |
| 19.3 | Skill & Command Completeness |
| 19.4 | Hook Reliability & Self-Coherence |

## Audit Checklists

### 19.1 CLAUDE.md & Settings Accuracy
- [ ] Architecture claims match reality — verify every directory reference, file count, and component name against the actual filesystem
- [ ] Governance references current — CONSTITUTION.md pillars, AUDIT.md domains, AUDIT-EXECUTE.md phases all accurately cited
- [ ] Permissions appropriate — `.claude/settings.json` allow list grants only what development workflows require
- [ ] Anti-slop wordlist matches AUDIT-EXECUTE.md regression gate 10 — no divergence between CLAUDE.md list and source-of-truth
- [ ] Lean thresholds table matches CONSTITUTION.md §2 P5 — no stale values
- [ ] Staleness detection — run Dynamic Verification Protocol counts and compare against CLAUDE.md claims. Flag divergences as Medium findings

### 19.2 Rule-Governance Alignment
- [ ] Pillar coverage — for each pillar (P1-P6) in CONSTITUTION.md, at least one rule in `.claude/rules/` enforces or supports it
- [ ] No contradictions — no rule contradicts any governance document (rule says X, governance says not-X)
- [ ] File references current — all file paths, function names, and module references in rules exist in the codebase
- [ ] Behavioral charter alignment — rules reflect the 13 behavioral charter directives from AUDIT.md
- [ ] Anti-slop — rules themselves pass the anti-slop wordlist check (zero hits). Wordlist matches AUDIT-EXECUTE.md regression gate 10 exactly
- [ ] Pillar attribution — each rule documents which pillar(s) it serves (P1-P6)

### 19.3 Skill & Command Completeness
- [ ] Lifecycle coverage — skill set covers the key development workflows (audit, execution, adapter authoring, content authoring, governance checking, release)
- [ ] SKILL.md executable — mentally trace each skill's steps. Every file reference exists, every command runs, every output path is valid
- [ ] No dangling references — skills reference agents, governance files, and templates that exist
- [ ] No duplication — skills do not replicate functionality already in hatch3r CLI commands (`hatch3r validate`, `hatch3r verify`)
- [ ] Frontmatter valid — each SKILL.md has YAML frontmatter with required fields: name, description, effort, allowed-tools
- [ ] Audit metrics documented — skills that produce metrics (audit-cycle, governance-check) document their output format

### 19.4 Hook Reliability & Self-Coherence
- [ ] Correct event binding — each hook in `.claude/settings.json` fires on the correct Claude Code event (SessionStart, PreToolUse, PostToolUse, SubagentStart) with appropriate matcher
- [ ] Hook targets exist — if hooks reference agents or scripts, those targets exist in the repository
- [ ] Claude Code API currency — web-research current Claude Code documentation to verify hook events, matcher syntax, and settings schema have not changed
- [ ] Performance impact — hooks that fire frequently (PostToolUse on Write, PreToolUse on Bash) complete in under 2 seconds
- [ ] Cross-artifact coherence — hooks, rules, skills, and CLAUDE.md form a consistent system with no broken reference chains

## Domain Boundary

D05 audits canonical content quality: "Is this rule well-written as a prompt?" D09.3 audits the Claude adapter's output format: "Does the adapter emit valid `.claude/` configuration?" D19 audits governance alignment: "Does the active development environment correctly reflect and enforce the governance system?" A finding about a rule being poorly worded belongs in D05. A finding about the Claude adapter emitting wrong JSON belongs in D09.3. A finding about a rule contradicting CONSTITUTION.md, a hook referencing a deleted agent, or CLAUDE.md containing stale architecture claims belongs in D19.
