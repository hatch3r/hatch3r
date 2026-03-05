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

Every task MUST follow this four-phase pipeline:

**Phase 1 — Research:** Spawn `hatch3r-researcher` for context gathering. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). All other tasks require researcher context. **Before spawning researchers, score the task's complexity per the `hatch3r-deep-context` rule** and add the tier-appropriate researcher modes alongside the standard task-type modes (see Deep Context Integration below).

**Phase 2 — Implement:** Spawn `hatch3r-implementer` for ALL code changes. One dedicated implementer per task. Never implement inline — always delegate via the Task tool. **Include reference conventions, resolved requirements, and blast radius data** from Phase 1 in the implementer prompt when available (see Deep Context Integration below).

**Phase 3 — Review Loop:**

- 3a. Spawn `hatch3r-reviewer` to review the implementation.
- 3b. If Critical or Warning findings exist: spawn `hatch3r-fixer` with the reviewer output.
- 3c. Re-review: spawn `hatch3r-reviewer` on the fixed code.
- 3d. Repeat 3b–3c until the reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
- 3e. If max iterations reached with remaining findings: surface to user for manual resolution.

**Phase 4 — Final Quality** (runs ONLY after the review loop is clean):

Spawn all applicable specialists in parallel:

| Specialist | When | Mandatory? |
|-----------|------|------------|
| `hatch3r-test-writer` | After every code change | YES — always for code changes |
| `hatch3r-security-auditor` | After every code change | YES — always for code changes |
| `hatch3r-docs-writer` | After every implementation | EVALUATE — spawn when changes affect APIs, architecture, user-facing behavior, or when specs/ADRs need updating |
| `hatch3r-lint-fixer` | When lint errors present | Conditional |
| `hatch3r-a11y-auditor` | When UI/accessibility changes | Conditional |
| `hatch3r-perf-profiler` | When performance-sensitive changes | Conditional |
| `hatch3r-dependency-auditor` | When dependencies change | Conditional |
| `hatch3r-ci-watcher` | When CI fails | Conditional |
| `hatch3r-architect` | When architectural decisions are needed or system design review is requested | Conditional |
| `hatch3r-devops` | When CI/CD, deployment, or infrastructure tasks are involved | Conditional |

## Agent Roster

| Agent | Purpose | Invoke When |
|-------|---------|-------------|
| `hatch3r-researcher` | Context gathering across 15 research modes | ALWAYS before implementation. Skip only for trivial single-line edits. Select modes by task type + tier-appropriate deep context modes. |
| `hatch3r-implementer` | Focused single-task implementation | ALWAYS. One dedicated implementer per task — standalone issues, epic sub-issues, batched issues, and plain chat tasks all get dedicated implementers. |
| `hatch3r-reviewer` | Code review for quality, security, performance | ALWAYS in review loop (Phase 3). Reviews implementation, then re-reviews after fixes. |
| `hatch3r-fixer` | Targeted fixes for reviewer findings | When `hatch3r-reviewer` reports Critical or Warning findings during the review loop (Phase 3). |
| `hatch3r-test-writer` | Regression and coverage tests | ALWAYS for code changes in final quality (Phase 4). Not just bugs — every code change gets tests. |
| `hatch3r-security-auditor` | Security rules, data flows, access control | ALWAYS for code changes in final quality (Phase 4). Not just `area:security` — every code change gets a security review. |
| `hatch3r-docs-writer` | Specs, ADRs, documentation maintenance | ALWAYS evaluate in final quality (Phase 4). Spawn when changes affect APIs, architecture, or user-facing behavior. |
| `hatch3r-lint-fixer` | Style, formatting, type error cleanup | After implementation when lint errors are present. |
| `hatch3r-a11y-auditor` | WCAG AA compliance checks | When UI/accessibility changes are made. |
| `hatch3r-perf-profiler` | Performance profiling and optimization | When performance-sensitive changes are made. |
| `hatch3r-dependency-auditor` | Supply chain security, CVE scanning | When dependencies change or new packages are added. |
| `hatch3r-ci-watcher` | CI/CD failure diagnosis and fix suggestions | When CI fails during or after implementation. |
| `hatch3r-architect` | Architecture design, system design review, technical decision documentation | When architectural decisions are needed or system design review is requested. |
| `hatch3r-devops` | CI/CD pipeline operations, deployment configuration, infrastructure setup | When CI/CD, deployment, or infrastructure tasks are involved. |

## Deep Context Integration

Before spawning researchers in Phase 1, score the task's complexity using the `hatch3r-deep-context` rule criteria. The resulting tier determines which additional researcher modes to include alongside the standard task-type modes.

### Tier-Adjusted Research Modes

**Tier 1 (Light — score 0–2):** Use only the standard task-type modes below. No additional modes.

**Tier 2 (Standard — score 3–5):** Add these modes at `quick` depth alongside the task-type modes:
- `requirements-elicitation` — scan for top ambiguities, ask 3–5 clarifying questions
- `similar-implementation` — find 1 reference implementation, extract top-level patterns

Present the elicitation questions to the user inline. Await answers before proceeding to Phase 2.

**Tier 3 (Deep — score 6+):** Add these modes at `deep` depth alongside the task-type modes:
- `requirements-elicitation` — full 10-dimension ambiguity scan, dependency questions, cross-cutting concern checklist
- `similar-implementation` — find 2–3 references, full convention extraction, divergence analysis
- `codebase-impact` at `deep` depth (with transitive tracing, API consumer map, blast radius)

**Mandatory Tier 3 checkpoint:** Present a consolidated Pre-Implementation Summary to the user and ASK for confirmation. Do NOT proceed to Phase 2 until all unresolved questions are answered.

### Implementer Prompt Enrichment

When spawning `hatch3r-implementer` in Phase 2, include the following from Phase 1 results when available:
- **Reference Conventions**: `similar-implementation` output — the implementer uses this in its Convention Lock step (Step 1b)
- **Resolved Requirements**: User's answers to `requirements-elicitation` questions — explicit decisions the implementer should follow instead of guessing
- **Blast Radius**: Enhanced `codebase-impact` output with transitive traces and API consumer maps — informs which consumers and contracts must be preserved

## Mandatory Delegation Directives

### Context Gathering (Before Implementation)

You MUST spawn a `hatch3r-researcher` subagent before implementing any task. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Select research modes by task type, then add tier-appropriate modes per the Deep Context Integration section above:

- **`type:bug`**: modes `symptom-trace`, `root-cause`, `codebase-impact` + tier modes
- **`type:feature`**: modes `codebase-impact`, `feature-design`, `architecture` + tier modes
- **`type:refactor`**: modes `current-state`, `refactoring-strategy`, `migration-path` + tier modes
- **`type:qa`**: modes `codebase-impact` + tier modes

Use depth `quick` for low-risk tasks, `standard` for medium-risk, `deep` for high-risk. The `hatch3r-deep-context` tier may override depth upward (e.g., a Tier 3 task always uses `deep` depth for the additional modes, even if the task-type modes use `standard`).

### Implementation Delegation

You MUST spawn a `hatch3r-implementer` subagent via the Task tool for ALL code changes. Never implement inline.

- **Single standalone issue**: Spawn one `hatch3r-implementer`. The orchestrator coordinates git, PR, and board operations.
- **Plain chat single task**: Spawn one `hatch3r-implementer`. Create synthetic issue context first (title, acceptance criteria, type).
- **Epics with sub-issues**: Spawn one `hatch3r-implementer` per sub-issue. Execute level-by-level respecting dependency order.
- **Multiple standalone issues (batch)**: Treat as a batch. Group by dependency level, spawn one `hatch3r-implementer` per issue, execute level-by-level. Shared branch, combined PR.

**Implementer prompt enrichment:** For Tier 2 and Tier 3 tasks, include the deep context outputs in the implementer prompt:
- `similar-implementation` findings as "Reference Conventions" (triggers the implementer's Convention Lock step)
- Resolved `requirements-elicitation` answers as "Resolved Requirements"
- Enhanced `codebase-impact` blast radius data (Tier 3 only)

### Post-Implementation Quality Pipeline

You MUST run the review loop and final quality phases after implementation completes.

**Phase 3 — Review Loop:**

1. Spawn `hatch3r-reviewer` — code review. Include the diff and acceptance criteria in the prompt.
2. If the reviewer reports Critical or Warning findings: spawn `hatch3r-fixer` with the full reviewer output (findings, file paths, line references, suggested fixes).
3. After fixes: spawn `hatch3r-reviewer` again to re-review the fixed code.
4. Repeat steps 2–3 until the reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
5. If max iterations reached with remaining findings: surface to user for manual resolution. Do not proceed to Phase 4 until the user acknowledges.

**Phase 4 — Final Quality** (runs ONLY after the review loop is clean):

Launch as many independent subagents in parallel as the platform supports — no artificial concurrency limit.

**Always spawn (mandatory for every code change):**

1. `hatch3r-test-writer` — tests for all code changes. Unit tests for new logic, regression tests for bug fixes, integration tests for cross-module changes.
2. `hatch3r-security-auditor` — security review of all code changes. Audit data flows, access control, input validation, and secret management.

**Always evaluate (spawn when applicable):**

3. `hatch3r-docs-writer` — spawn when changes affect public APIs, architectural patterns, user-facing behavior, or when specs/ADRs need updating. If no documentation impact exists, skip silently.

**Conditional specialists (spawn when triggered):**

4. `hatch3r-lint-fixer` — when lint or type errors are present after implementation.
5. `hatch3r-a11y-auditor` — when UI or accessibility changes are made.
6. `hatch3r-perf-profiler` — when performance-sensitive changes are made.
7. `hatch3r-dependency-auditor` — when dependencies change or new packages are added.
8. `hatch3r-architect` — when architectural decisions are needed or system design review is requested.
9. `hatch3r-devops` — when CI/CD, deployment, or infrastructure tasks are involved.

## Skill Loading Directives

Before implementing any task, you MUST read and follow the matching hatch3r skill:

| Task Type | Skill |
|-----------|-------|
| `type:bug` | `hatch3r-bug-fix` |
| `type:feature` | `hatch3r-feature` |
| `type:refactor` + `area:ui` | `hatch3r-visual-refactor` |
| `type:refactor` + behavior change | `hatch3r-logical-refactor` |
| `type:refactor` (other) | `hatch3r-refactor` |
| `type:qa` | `hatch3r-qa-validation` |

When a skill references agents under "Required Agent Delegation", those delegations are mandatory — you MUST spawn the listed agents via the Task tool.

## Subagent Spawning Protocol

When spawning any subagent via the Task tool:

1. **Use `subagent_type: "generalPurpose"`** for all hatch3r agent delegations.
2. **Include in every subagent prompt**:
   - The agent protocol to follow (e.g., "Follow the hatch3r-implementer agent protocol").
   - All `scope: always` rules from `.agents/rules/` that apply.
   - The project's tooling hierarchy (Context7 MCP for library docs, web research for current context).
   - Relevant learnings from `.agents/learnings/` if the directory exists.
3. **Launch as many independent subagents in parallel as the platform supports.** Do not impose an artificial concurrency limit. Use maximum parallelism for independent work.
4. **Await and review results** before proceeding. If a subagent reports BLOCKED or PARTIAL, surface to the user.

## Single-Task Plain Chat Protocol

When the user provides a single task in plain chat (no command invoked, no issue reference), the full sub-agent pipeline still applies:

1. **Classify** the task by type (bug/feature/refactor/QA/other) based on context.
2. **Create synthetic issue context** — title, acceptance criteria, and type — from the user's instruction.
3. **Run the Universal Sub-Agent Pipeline**: Phase 1 (Research) → Phase 2 (Implement) → Phase 3 (Review Loop) → Phase 4 (Final Quality).
4. For issue references in chat (e.g., "fix #5"), fetch issue details using the platform CLI (check `platform` in `.agents/hatch.json`) and use them as the task context instead of creating synthetic context:
   - **GitHub:** `gh issue view`
   - **Azure DevOps:** `az boards work-item show --id`
   - **GitLab:** `glab issue view`

This ensures consistent quality regardless of how the task was initiated.

## Multi-Task Detection (Plain Chat)

When the user provides multiple tasks in a single message — numbered lists, comma-separated instructions, multiple issue references (e.g., "implement #1, #3, #7"), or multiple distinct requests — you MUST parallelize them:

1. **Parse** the message into individual discrete tasks. Each distinct implementation request is one task.
2. **Classify** each task by type (bug/feature/refactor/QA/other) based on context or explicit labels.
3. **Build a dependency graph** among the tasks. Independent tasks share the same level and run in parallel.
4. **Spawn one `hatch3r-researcher` subagent per task** (skip for trivial single-line edits only). Launch in parallel.
5. **Spawn one `hatch3r-implementer` subagent per task** per dependency level.
6. **For issue references**: fetch issue details using the platform CLI (check `platform` in `.agents/hatch.json`):
   - **GitHub:** `gh issue view`
   - **Azure DevOps:** `az boards work-item show --id`
   - **GitLab:** `glab issue view`
7. **For natural language tasks**: create synthetic issue context (title, acceptance criteria, type) from the instruction. Pass this context to the implementer subagent.
8. **Run the review loop** (Phase 3) after all implementations complete: spawn reviewer, then fixer for Critical/Warning findings, re-review, repeat until clean (max 3 iterations).
9. **Spawn final quality subagents** (Phase 4, after review loop is clean): test-writer + security-auditor (always), plus docs-writer, auditors as applicable.

This directive applies regardless of whether board-pickup was invoked. Any context where implementation tasks are identified MUST use one subagent per task with maximum parallelism.

## Rule Application

All hatch3r rules with `scope: always` apply to every implementation task, including work delegated to subagents. When constructing subagent prompts, include the rule directives — subagents do not automatically inherit the parent's rule context.
