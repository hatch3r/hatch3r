---
id: hatch3r-agent-orchestration
type: rule
description: Mandatory agent delegation, skill loading, and subagent usage directives for ALL tasks in ALL contexts
scope: always
---
# Agent Orchestration

This rule governs when and how to delegate work to hatch3r agents, load skills, and spawn subagents. These directives are mandatory — not suggestions.

## Universal Applicability

This rule applies to EVERY context without exception:

- **Board-pickup** (epic, sub-issue, standalone, batch)
- **Workflow command** (full mode and quick mode)
- **Plain chat** (single task or multiple tasks)
- **Issue references** (e.g., "implement #5")
- **Natural language requests** (e.g., "add a dark mode toggle")

Whether the user invokes a command or simply asks for a task in conversation, the full sub-agent pipeline defined below is mandatory. There is no context where implementing code inline (without sub-agents) is acceptable.

## Universal Sub-Agent Pipeline

Every task MUST follow this three-phase pipeline:

**Phase 1 — Research:** Spawn `hatch3r-researcher` for context gathering. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). All other tasks require researcher context.

**Phase 2 — Implement:** Spawn `hatch3r-implementer` for ALL code changes. One dedicated implementer per task. Never implement inline — always delegate via the Task tool.

**Phase 3 — Quality:** Spawn ALL applicable specialists in parallel after implementation:

| Specialist | When | Mandatory? |
|-----------|------|------------|
| `hatch3r-reviewer` | After every implementation | YES — always |
| `hatch3r-test-writer` | After every code change | YES — always for code changes |
| `hatch3r-security-auditor` | After every code change | YES — always for code changes |
| `hatch3r-docs-writer` | After every implementation | EVALUATE — spawn when changes affect APIs, architecture, user-facing behavior, or when specs/ADRs need updating |
| `hatch3r-lint-fixer` | When lint errors present | Conditional |
| `hatch3r-a11y-auditor` | When UI/accessibility changes | Conditional |
| `hatch3r-perf-profiler` | When performance-sensitive changes | Conditional |
| `hatch3r-dependency-auditor` | When dependencies change | Conditional |
| `hatch3r-ci-watcher` | When CI fails | Conditional |

## Agent Roster

| Agent | Purpose | Invoke When |
|-------|---------|-------------|
| `hatch3r-researcher` | Context gathering across 12 research modes | ALWAYS before implementation. Skip only for trivial single-line edits. Select modes by task type. |
| `hatch3r-implementer` | Focused single-task implementation | ALWAYS. One dedicated implementer per task — standalone issues, epic sub-issues, batched issues, and plain chat tasks all get dedicated implementers. |
| `hatch3r-reviewer` | Code review for quality, security, performance | ALWAYS after implementation, before PR creation. |
| `hatch3r-test-writer` | Regression and coverage tests | ALWAYS for code changes. Not just bugs — every code change gets tests. |
| `hatch3r-security-auditor` | Security rules, data flows, access control | ALWAYS for code changes. Not just `area:security` — every code change gets a security review. |
| `hatch3r-docs-writer` | Specs, ADRs, documentation maintenance | ALWAYS evaluate. Spawn when changes affect APIs, architecture, or user-facing behavior. |
| `hatch3r-lint-fixer` | Style, formatting, type error cleanup | After implementation when lint errors are present. |
| `hatch3r-a11y-auditor` | WCAG AA compliance checks | When UI/accessibility changes are made. |
| `hatch3r-perf-profiler` | Performance profiling and optimization | When performance-sensitive changes are made. |
| `hatch3r-dependency-auditor` | Supply chain security, CVE scanning | When dependencies change or new packages are added. |
| `hatch3r-ci-watcher` | CI/CD failure diagnosis and fix suggestions | When CI fails during or after implementation. |

## Mandatory Delegation Directives

### Context Gathering (Before Implementation)

You MUST spawn a `hatch3r-researcher` subagent before implementing any task. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Select research modes by task type:

- **`type:bug`**: modes `symptom-trace`, `root-cause`, `codebase-impact`
- **`type:feature`**: modes `codebase-impact`, `feature-design`, `architecture`
- **`type:refactor`**: modes `current-state`, `refactoring-strategy`, `migration-path`
- **`type:qa`**: modes `codebase-impact`

Use depth `quick` for low-risk tasks, `standard` for medium-risk, `deep` for high-risk.

### Implementation Delegation

You MUST spawn a `hatch3r-implementer` subagent via the Task tool for ALL code changes. Never implement inline.

- **Single standalone issue**: Spawn one `hatch3r-implementer`. The orchestrator coordinates git, PR, and board operations.
- **Plain chat single task**: Spawn one `hatch3r-implementer`. Create synthetic issue context first (title, acceptance criteria, type).
- **Epics with sub-issues**: Spawn one `hatch3r-implementer` per sub-issue. Execute level-by-level respecting dependency order.
- **Multiple standalone issues (batch)**: Treat as a batch. Group by dependency level, spawn one `hatch3r-implementer` per issue, execute level-by-level. Shared branch, combined PR.

### Post-Implementation Quality Pipeline

You MUST spawn specialist subagents after implementation completes. Launch as many independent subagents in parallel as the platform supports — no artificial concurrency limit.

**Always spawn (mandatory for every code change):**

1. `hatch3r-reviewer` — code review. Include the diff and acceptance criteria in the prompt.
2. `hatch3r-test-writer` — tests for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
3. `hatch3r-security-auditor` — security review of all code changes. Audit data flows, access control, input validation, and secret management.

**Always evaluate (spawn when applicable):**

4. `hatch3r-docs-writer` — spawn when changes affect public APIs, architectural patterns, user-facing behavior, or when specs/ADRs need updating. If no documentation impact exists, skip silently.

**Conditional specialists (spawn when triggered):**

5. `hatch3r-lint-fixer` — when lint or type errors are present after implementation.
6. `hatch3r-a11y-auditor` — when UI or accessibility changes are made.
7. `hatch3r-perf-profiler` — when performance-sensitive changes are made.
8. `hatch3r-dependency-auditor` — when dependencies change or new packages are added.

## Skill Loading Directives

Before implementing any task, you MUST read and follow the matching hatch3r skill:

| Task Type | Skill |
|-----------|-------|
| `type:bug` | `hatch3r-bug-fix` |
| `type:feature` | `hatch3r-feature` (aka `hatch3r-feature-implementation`) |
| `type:refactor` + `area:ui` | `hatch3r-visual-refactor` |
| `type:refactor` + behavior change | `hatch3r-logical-refactor` |
| `type:refactor` (other) | `hatch3r-refactor` (aka `hatch3r-code-refactor`) |
| `type:qa` | `hatch3r-qa-validation` |

When a skill references agents under "Required Agent Delegation", those delegations are mandatory — you MUST spawn the listed agents via the Task tool.

## Subagent Spawning Protocol

When spawning any subagent via the Task tool:

1. **Use `subagent_type: "generalPurpose"`** for all hatch3r agent delegations.
2. **Include in every subagent prompt**:
   - The agent protocol to follow (e.g., "Follow the hatch3r-implementer agent protocol").
   - All `scope: always` rules from `/.agents/rules/` that apply.
   - The project's tooling hierarchy (Context7 MCP for library docs, web research for current context).
   - Relevant learnings from `/.agents/learnings/` if the directory exists.
3. **Launch as many independent subagents in parallel as the platform supports.** Do not impose an artificial concurrency limit. Use maximum parallelism for independent work.
4. **Await and review results** before proceeding. If a subagent reports BLOCKED or PARTIAL, surface to the user.

## Single-Task Plain Chat Protocol

When the user provides a single task in plain chat (no command invoked, no issue reference), the full sub-agent pipeline still applies:

1. **Classify** the task by type (bug/feature/refactor/QA/other) based on context.
2. **Create synthetic issue context** — title, acceptance criteria, and type — from the user's instruction.
3. **Run the Universal Sub-Agent Pipeline**: Phase 1 (Research) → Phase 2 (Implement) → Phase 3 (Quality).
4. For GitHub issue references in chat (e.g., "fix #5"), fetch issue details via `gh issue view` and use them as the task context instead of creating synthetic context.

This ensures consistent quality regardless of how the task was initiated.

## Multi-Task Detection (Plain Chat)

When the user provides multiple tasks in a single message — numbered lists, comma-separated instructions, multiple issue references (e.g., "implement #1, #3, #7"), or multiple distinct requests — you MUST parallelize them:

1. **Parse** the message into individual discrete tasks. Each distinct implementation request is one task.
2. **Classify** each task by type (bug/feature/refactor/QA/other) based on context or explicit labels.
3. **Build a dependency graph** among the tasks. Independent tasks share the same level and run in parallel.
4. **Spawn one `hatch3r-researcher` subagent per task** (skip for trivial single-line edits only). Launch in parallel.
5. **Spawn one `hatch3r-implementer` subagent per task** per dependency level.
6. **For GitHub issue references**: fetch issue details via `gh issue view` and use them as the task context.
7. **For natural language tasks**: create synthetic issue context (title, acceptance criteria, type) from the instruction. Pass this context to the implementer subagent.
8. **Spawn the full quality pipeline** after all implementations complete: reviewer + test-writer + security-auditor (always), plus docs-writer, auditors as applicable.

This directive applies regardless of whether board-pickup was invoked. Any context where implementation tasks are identified MUST use one subagent per task with maximum parallelism.

## Rule Application

All hatch3r rules with `scope: always` apply to every implementation task, including work delegated to subagents. When constructing subagent prompts, include the rule directives — subagents do not automatically inherit the parent's rule context.
