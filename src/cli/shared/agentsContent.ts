import { wrapInManagedBlock } from "../../merge/managedBlocks.js";

/**
 * Shared orchestration content inlined into adapter bridge files (CLAUDE.md, GEMINI.md,
 * .windsurfrules, .amp/AGENTS.md, .github/copilot-instructions.md, .cursor/rules/hatch3r-bridge.mdc).
 * Includes mandatory behaviors, agent quick reference, and canonical structure.
 * Ensures every platform receives inline orchestration guidance instead of relying solely
 * on "read /.agents/AGENTS.md" references.
 */
export const BRIDGE_ORCHESTRATION = `## Universal Sub-Agent Pipeline

Every task — board-pickup, workflow command, plain chat, single-task, or multi-task — MUST use this four-phase sub-agent pipeline. There are NO exceptions. Never implement code inline; always delegate to sub-agents.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\` for context gathering. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Score task complexity per \`hatch3r-deep-context\` rule and add tier-appropriate modes (\`requirements-elicitation\`, \`similar-implementation\`) alongside standard task-type modes.

**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` for ALL code changes. One dedicated implementer per task. Never implement inline — always delegate. Include reference conventions, resolved requirements, and blast radius data from Phase 1 when available.

**Phase 3 — Review Loop:**
- 3a. Spawn \`hatch3r-reviewer\` to review the implementation.
- 3b. If Critical or Warning findings: spawn \`hatch3r-fixer\` with the reviewer output.
- 3c. Re-review: spawn \`hatch3r-reviewer\` on the fixed code.
- 3d. Repeat 3b–3c until reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
- 3e. If max iterations reached with remaining findings: surface to user.

**Phase 4 — Final Quality** (runs ONLY after review loop is clean):
- \`hatch3r-test-writer\` — ALWAYS for code changes (mandatory, not just bugs)
- \`hatch3r-security-auditor\` — ALWAYS for code changes (mandatory, not just area:security)
- \`hatch3r-docs-writer\` — ALWAYS evaluate; spawn when changes affect APIs, architecture, or user-facing behavior
- \`hatch3r-lint-fixer\` — when lint errors present after implementation
- \`hatch3r-a11y-auditor\` — when UI/accessibility changes
- \`hatch3r-perf-profiler\` — when performance-sensitive changes
- \`hatch3r-dependency-auditor\` — when dependencies change

For plain chat tasks without issue context: classify the task (bug/feature/refactor/QA), create synthetic issue context (title, acceptance criteria, type), then run the full pipeline above.

## Mandatory Behaviors

1. **Load the matching skill** before implementing any task. Read \`/.agents/skills/\` for the skill matching the task type (bug-fix, feature, refactor, qa-validation, etc.).
2. **Use the Task tool** (\`subagent_type: "generalPurpose"\`) for all agent delegations. Launch as many independent subagents in parallel as the platform supports — no artificial concurrency limit.
3. **Propagate rules to subagents**: include all \`scope: always\` rule directives in subagent prompts — subagents do not inherit the parent's rule context automatically.
4. **Consult learnings**: check \`/.agents/learnings/\` for relevant pitfalls and patterns before implementation.

## Agent Quick Reference

| Agent | When to Use |
|-------|-------------|
| \`hatch3r-researcher\` | ALWAYS before implementation (skip only for trivial single-line edits) |
| \`hatch3r-implementer\` | ALWAYS. One dedicated implementer per task — standalone, epic sub-issue, batch, or plain chat |
| \`hatch3r-learnings-loader\` | When consulting project learnings or historical decisions |
| \`hatch3r-reviewer\` | ALWAYS in review loop (Phase 3); reviews and re-reviews until clean |
| \`hatch3r-fixer\` | When reviewer reports Critical or Warning findings (Phase 3 review loop) |
| \`hatch3r-test-writer\` | ALWAYS for code changes (Phase 4 final quality) |
| \`hatch3r-security-auditor\` | ALWAYS for code changes (Phase 4 final quality) |
| \`hatch3r-docs-writer\` | ALWAYS evaluate; spawn when documentation impact exists (Phase 4 final quality) |
| \`hatch3r-lint-fixer\` | When lint/type errors present after implementation |
| \`hatch3r-a11y-auditor\` | When UI/accessibility changes |
| \`hatch3r-architect\` | When making architectural decisions, designing APIs, or evaluating design trade-offs |
| \`hatch3r-perf-profiler\` | When performance-sensitive changes |
| \`hatch3r-dependency-auditor\` | When dependencies change |
| \`hatch3r-ci-watcher\` | When CI fails |
| \`hatch3r-context-rules\` | When establishing or updating project-specific coding patterns and conventions |
| \`hatch3r-devops\` | When infrastructure, deployment, or CI/CD changes are needed |

See the \`hatch3r-agent-orchestration\` rule in \`/.agents/rules/\` for the full orchestration protocol.

## Canonical Structure

- Rules: \`/.agents/rules/\` (source of truth for all tool-specific rules)
- Agents: \`/.agents/agents/\` (agent definitions)
- Skills: \`/.agents/skills/\` (skill workflows)
- Commands: \`/.agents/commands/\` (executable commands)
- MCP: \`/.agents/mcp/mcp.json\` (MCP server configuration)
- Policy: \`/.agents/policy/\` (guardrails and deny lists)

Do not manually edit files with the \`hatch3r-\` prefix -- they are managed by hatch3r
and will be overwritten on update. Create non-prefixed files for customizations.`;

export const AGENTS_MD_INNER = [
  "# Project Agent Instructions",
  "",
  "This project uses hatch3r for agentic coding setup.",
  "Full canonical instructions are at `/.agents/AGENTS.md`.",
  "",
  "## Quick Reference",
  "",
  "- Rules: `/.agents/rules/`",
  "- Agents: `/.agents/agents/`",
  "- Skills: `/.agents/skills/`",
  "- Commands: `/.agents/commands/`",
].join("\n");

export const AGENTS_MD_FULL = `${wrapInManagedBlock(AGENTS_MD_INNER)}\n`;

export const CANONICAL_AGENTS_MD = `# hatch3r — Canonical Agent Instructions

This file is the canonical reference for all agent orchestration in this project. It is auto-generated by hatch3r and should not be manually edited.

## Universal Sub-Agent Pipeline

Every task — board-pickup, workflow command, plain chat, single-task, or multi-task — MUST use this four-phase sub-agent pipeline. There are NO exceptions. Never implement code inline; always delegate to sub-agents.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\` for context gathering before implementation. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Select research modes by task type. Score task complexity per \`hatch3r-deep-context\` rule and add tier-appropriate modes (\`requirements-elicitation\`, \`similar-implementation\`) alongside standard modes.

**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` for ALL code changes. One dedicated implementer per task. Never implement inline — always delegate via the Task tool. Include reference conventions, resolved requirements, and blast radius data from Phase 1 when available.

**Phase 3 — Review Loop:**
- 3a. Spawn \`hatch3r-reviewer\` to review the implementation.
- 3b. If Critical or Warning findings: spawn \`hatch3r-fixer\` with the reviewer output.
- 3c. Re-review: spawn \`hatch3r-reviewer\` on the fixed code.
- 3d. Repeat 3b–3c until reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
- 3e. If max iterations reached with remaining findings: surface to user for manual resolution.

**Phase 4 — Final Quality** (runs ONLY after the review loop is clean):

Spawn all applicable specialists in parallel:
- \`hatch3r-test-writer\` — ALWAYS for code changes (mandatory, not just bugs)
- \`hatch3r-security-auditor\` — ALWAYS for code changes (mandatory, not just area:security)
- \`hatch3r-docs-writer\` — ALWAYS evaluate; spawn when changes affect APIs, architecture, or user-facing behavior
- \`hatch3r-lint-fixer\` — when lint errors present after implementation
- \`hatch3r-a11y-auditor\` — when UI/accessibility changes
- \`hatch3r-perf-profiler\` — when performance-sensitive changes
- \`hatch3r-dependency-auditor\` — when dependencies change
- \`hatch3r-ci-watcher\` — when CI fails

This pipeline applies regardless of how the task was initiated. For plain chat tasks without issue context: classify the task (bug/feature/refactor/QA), create synthetic issue context (title, acceptance criteria, type), then run the full pipeline.

## Orchestration Protocol

Every task MUST follow this protocol:

1. **Load the matching skill** from \`/.agents/skills/\` based on task type before implementation.
2. **Score task complexity** per the \`hatch3r-deep-context\` rule. Add tier-appropriate researcher modes (\`requirements-elicitation\`, \`similar-implementation\`) alongside standard task-type modes.
3. **Spawn a researcher subagent** (\`hatch3r-researcher\`) for context gathering before implementation.
4. **Spawn an implementer subagent** (\`hatch3r-implementer\`) for code changes. Never implement inline. Include reference conventions and resolved requirements from Phase 1.
5. **Run the review loop** (Phase 3): spawn \`hatch3r-reviewer\`, then \`hatch3r-fixer\` for Critical/Warning findings, re-review, repeat until clean (max 3 iterations).
6. **Spawn final quality subagents** (Phase 4, after review loop is clean): test-writer and security-auditor (always for code changes), plus docs-writer, a11y-auditor, perf-profiler, lint-fixer as applicable.
7. **Propagate rules** to all subagent prompts — subagents do not inherit rules automatically.
8. **Consult learnings** from \`/.agents/learnings/\` before implementation.

See the \`hatch3r-agent-orchestration\` rule in \`/.agents/rules/\` for the full mandatory protocol.

## Agent Roster

| Agent | Purpose | Invoke When |
|-------|---------|-------------|
| \`hatch3r-researcher\` | Context gathering across 15 research modes | ALWAYS before implementation (skip only for trivial single-line edits). Select modes by task type + tier-appropriate deep context modes. |
| \`hatch3r-implementer\` | Focused single-task implementation | ALWAYS. One dedicated implementer per task — standalone, epic sub-issue, batch, or plain chat. Convention Lock step aligns with reference implementations. |
| \`hatch3r-learnings-loader\` | Project learning curation and consultation | When consulting historical decisions, past mistakes, or established project patterns |
| \`hatch3r-reviewer\` | Code review | ALWAYS in review loop (Phase 3); reviews and re-reviews until clean |
| \`hatch3r-fixer\` | Targeted fixes for reviewer findings | When reviewer reports Critical or Warning findings (Phase 3 review loop) |
| \`hatch3r-test-writer\` | Regression and coverage tests | ALWAYS for code changes in final quality (Phase 4) |
| \`hatch3r-security-auditor\` | Security audit | ALWAYS for code changes in final quality (Phase 4) |
| \`hatch3r-docs-writer\` | Documentation maintenance | ALWAYS evaluate in final quality (Phase 4); spawn when documentation impact exists |
| \`hatch3r-lint-fixer\` | Style, formatting, type cleanup | When lint errors present after implementation |
| \`hatch3r-a11y-auditor\` | WCAG AA compliance | When UI/accessibility changes |
| \`hatch3r-architect\` | System architecture, ADRs, API design, trade-off analysis | When making architectural decisions, designing new systems, or evaluating design trade-offs |
| \`hatch3r-perf-profiler\` | Performance profiling | When performance-sensitive changes |
| \`hatch3r-dependency-auditor\` | Supply chain security | When dependencies change |
| \`hatch3r-ci-watcher\` | CI/CD failure diagnosis | When CI fails |
| \`hatch3r-context-rules\` | Context-aware rule generation from project patterns | When establishing project conventions or adapting rules to discovered patterns |
| \`hatch3r-devops\` | Infrastructure, deployment, CI/CD configuration | When infrastructure, deployment, or CI/CD pipeline changes are needed |

## Skill Dispatch Table

| Task Type | Skill |
|-----------|-------|
| \`type:bug\` | \`hatch3r-bug-fix\` |
| \`type:feature\` | \`hatch3r-feature\` |
| \`type:refactor\` + \`area:ui\` | \`hatch3r-visual-refactor\` |
| \`type:refactor\` + behavior change | \`hatch3r-logical-refactor\` |
| \`type:refactor\` (other) | \`hatch3r-refactor\` |
| \`type:qa\` | \`hatch3r-qa-validation\` |

## Researcher Mode Selection

| Task Type | Standard Modes | Tier 2+ Modes (per \`hatch3r-deep-context\`) |
|-----------|---------------|----------------------------------------------|
| \`type:bug\` | \`symptom-trace\`, \`root-cause\`, \`codebase-impact\` | + \`requirements-elicitation\` |
| \`type:feature\` | \`codebase-impact\`, \`feature-design\`, \`architecture\` | + \`requirements-elicitation\`, \`similar-implementation\` |
| \`type:refactor\` | \`current-state\`, \`refactoring-strategy\`, \`migration-path\` | + \`similar-implementation\`, \`requirements-elicitation\` |
| \`type:qa\` | \`codebase-impact\` | + \`requirements-elicitation\` |

## Subagent Spawning

Use the Task tool with \`subagent_type: "generalPurpose"\` for all agent delegations. Launch as many independent subagents in parallel as the platform supports — no artificial concurrency limit. Every subagent prompt MUST include:

- The agent protocol to follow
- All \`scope: always\` rules from \`/.agents/rules/\`
- The project's tooling hierarchy
- Relevant learnings from \`/.agents/learnings/\`

## Multi-Issue Parallelism

When multiple issues or tasks are identified (board pickup batch, multiple issue references, or multi-task chat instructions), the framework MUST parallelize them:

1. **Parse** into individual discrete tasks.
2. **Build dependency graph**, group into parallel levels (independent = same level).
3. **Phase 1 — Researchers:** Spawn one \`hatch3r-researcher\` per task in parallel. Skip for trivial single-line edits only.
4. **Phase 2 — Implementers:** Spawn one \`hatch3r-implementer\` per task per dependency level. Each implementer receives its researcher output.
5. **Phase 3 — Review Loop:** Spawn \`hatch3r-reviewer\`, then \`hatch3r-fixer\` for Critical/Warning findings, re-review, repeat until clean (max 3 iterations).
6. **Phase 4 — Final Quality:** Spawn \`hatch3r-test-writer\` and \`hatch3r-security-auditor\` (always for code changes), plus \`hatch3r-docs-writer\`, auditors, etc. as applicable across the batch.
7. **Shared branch, combined PR** closing all issues.

This pattern applies to ALL contexts: board-pickup, workflow command, and plain chat. Every task gets its own implementer subagent — never implement multiple tasks inline.

## Single-Task and Plain Chat Protocol

When the user provides a single task in plain chat (no command invoked, no issue reference), the full sub-agent pipeline still applies:

1. **Classify** the task by type (bug/feature/refactor/QA/other) based on context.
2. **Create synthetic issue context** (title, acceptance criteria, type) from the instruction.
3. **Run the Universal Sub-Agent Pipeline**: Research → Implement → Review Loop → Final Quality (all four phases, all mandatory specialists).

This ensures consistent quality regardless of how the task was initiated.

## Directory Structure

- \`/.agents/rules/\` — Rules (source of truth for all tool-specific rules)
- \`/.agents/agents/\` — Agent definitions
- \`/.agents/skills/\` — Skill workflows
- \`/.agents/commands/\` — Executable commands
- \`/.agents/mcp/\` — MCP server configuration
- \`/.agents/policy/\` — Guardrails and deny lists
- \`/.agents/learnings/\` — Project learnings (pitfalls, patterns, decisions)
`;

