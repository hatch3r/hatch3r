---
id: shared-clarification-default-block
type: reference
description: Canonical §0 Detect Ambiguity block referenced by every hatch3r-* agent. Lifted from per-agent duplication per D6-M3 (Cycle 9 / Wave 3) to enforce the B1 directive in one place.
tags: [shared, p8, floor:protocol]
cache_friendly: true
---

## §0 Detect Ambiguity (P8 B1)

> Last updated: 2026-05-28

This is the canonical body of the §0 Detect Ambiguity block referenced by every `agents/hatch3r-*.md`. Each agent's body cites this file via a one-line pointer plus a one-line domain-specific trigger list. The shared protocol is the constant; the trigger list is the variable.

### Protocol (constant across all agents)

Before any action, scan the brief for unresolved questions in scope, acceptance criteria, irreversibility, or constraint conflicts. If any are found, ask the user via the platform-native question tool per `agents/shared/user-question-protocol.md` — do not proceed under silent assumption. This is the default path, not an exception. Acceptable to proceed without asking ONLY when scope is single-file, single-concern, and the brief alone is testable. The Boundaries "Ask first" rule remains in force for residual ambiguity discovered mid-execution.

CONSTITUTION §2 P8 establishes the B1 directive verbatim:

> Every hatch3r-invoked agentic workflow detects and resolves ambiguity via `agents/shared/user-question-protocol.md` BEFORE executing — default behavior, not exception-driven.

### Domain-specific trigger lists (variable per agent)

Each consuming agent enumerates its own ambiguity triggers in a single line at the citation site. Reference shapes (one per consuming agent):

| Agent | Domain-specific trigger phrase |
|-------|--------------------------------|
| `hatch3r-implementer` | contradictory criteria, missing API contract, unknown convention |
| `hatch3r-architect` | load targets, consistency model, migration window, new infrastructure dependencies |
| `hatch3r-fixer` | finding contradicts acceptance criteria, suggested fix is unclear, blast radius missing for shared-interface fix |
| `hatch3r-reviewer` | which files, which severity bar, whether prior reviewer findings apply |
| `hatch3r-researcher` | multi-interpretation subject, missing mode selection, contradictory specs |
| `hatch3r-creator` | which artifact type, which preset, which pillar mapping |
| `hatch3r-devops` | which target environment, which provider, which release window |
| `hatch3r-docs-writer` | which audience tier, which source-of-truth doc, scope (page / section / line) |
| `hatch3r-handoff-loader` | which branch context, ranking weights, output size budget |
| `hatch3r-handoff-preparer` | which work-item id, which session boundary, which status to record |
| `hatch3r-learnings-loader` | which scope glob, which depth, which staleness tolerance |
| `hatch3r-brownfield-spec` | which existing module to align with, which migration path |
| `hatch3r-greenfield-spec` | which architecture style, which feature set scope, which deployment target |
| `hatch3r-ci-watcher` | which workflow run, which failure window, which retry budget |
| `hatch3r-context-rules` | which precedence axis (cosmetic, gate, floor), which scope (always, conditional) |
| `hatch3r-lint-fixer` | which lint rules to apply, which severity threshold |
| `hatch3r-pack-installer` | which trust tier the pack claims (canonical vs marketplace), which signing method applies (npm-provenance vs cosign-keyless), whether the declared capability set is authorized, whether an `--allow-untrusted` override was explicitly passed |
| `hatch3r-incident-responder` | user-facing vs internal-only impact, known vs unknown blast radius, rollback-safety verified vs unverified, stakeholder-notification scope, mitigation writes data (irreversible) vs flips a flag (reversible) |
| `hatch3r-dependency-drafter` | upgrade scope (one dependency / group / full manifest), upgrade target band (patch / minor / major), driver (routine currency / CVE advisory / new direct dependency), success acceptance criterion |
| 9 CQ specialists (`hatch3r-ui`, `hatch3r-ux`, `hatch3r-security`, `hatch3r-reliability`, `hatch3r-testability`, `hatch3r-scalability`, `hatch3r-performance`, `hatch3r-maintainability`, `hatch3r-enhancability`) | See `agents/shared/quality-specialist-frame.md` → §0 Detect Ambiguity; each CQ specialist names CQ-vector-specific triggers |

### Authoring rules

1. Citing this file with the canonical pointer (`See agents/shared/clarification-default-block.md → §0 Detect Ambiguity (P8 B1)`) plus the agent's own one-line trigger list satisfies the B1 directive. Re-wording the protocol body inline is forbidden — duplication is the failure mode this file exists to eliminate.
2. The 9 CQ specialists continue to incorporate the protocol via `agents/shared/quality-specialist-frame.md` (which references this file transitively); they do not need a separate direct pointer.
3. When a new agent is added, append one row to the trigger-list table above. The CI gate `npm run validate` parses for the pointer phrase; a missing pointer in an agent body is a P8 B1 violation.

### Related references

- `agents/shared/user-question-protocol.md` — how to ask (native tool table + plain-text fallback)
- `agents/shared/quality-charter.md` §3 — when to ask (Question Unclear Requirements)
- `agents/shared/quality-charter.md` §8 — escalate ambiguity early
- `rules/hatch3r-clarification-default.md` — repo-level mirror of the B1 directive
- `.claude/rules/clarification-default.md` — framework-dev mirror loaded each Claude Code session
