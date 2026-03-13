---
id: hatch3r-agent-orchestration
type: rule
description: Mandatory agent delegation, skill loading, and subagent usage directives for ALL tasks in ALL contexts
scope: always
tags: [core]
---
# Agent Orchestration

This rule governs when and how to delegate work to hatch3r agents, load skills, and spawn subagents. These directives are mandatory — not suggestions.

## Orchestration Differentiation

Hatch3r's orchestration is not free-form agent chat. It differs from simpler approaches in three structural ways: (1) a **phase-gated pipeline** that enforces Research, Implement, Review, and Quality as distinct stages with explicit entry/exit criteria; (2) **structured handoffs** between phases via the `PipelineContext` schema, ensuring no context is lost or fabricated between agents; and (3) a **mandatory review gate** before the quality phase, preventing untested or unreviewed code from reaching final quality checks.

## Universal Applicability

This rule applies to EVERY context without exception:

- **Board-pickup** (epic, sub-issue, standalone, batch)
- **Workflow command** (full mode and quick mode)
- **Plain chat** (single task or multiple tasks)
- **Issue references** (e.g., "implement #5")
- **Natural language requests** (e.g., "add a dark mode toggle")

Whether the user invokes a command or simply asks for a task in conversation, the full sub-agent pipeline defined below is mandatory. There is no context where implementing code inline (without sub-agents) is acceptable.

## Universal Sub-Agent Pipeline

Every task MUST follow this four-phase pipeline: **Phase 1 — Research** (context gathering via `hatch3r-researcher`), **Phase 2 — Implement** (code changes via `hatch3r-implementer`), **Phase 3 — Review Loop** (review/fix cycle via `hatch3r-reviewer` and `hatch3r-fixer`), **Phase 4 — Final Quality** (parallel specialists after review is clean). See **Mandatory Delegation Directives** below for full phase definitions, entry/exit criteria, and specialist invocation rules.

## Agent Roster

| Agent | Purpose | Invoke When |
|-------|---------|-------------|
| `hatch3r-researcher` | Context gathering (15 modes) | Always — before implementation (skip trivial edits) |
| `hatch3r-implementer` | Single-task implementation | Always — one per task |
| `hatch3r-reviewer` | Code review | Always — Phase 3 review loop |
| `hatch3r-fixer` | Fix reviewer findings | Phase 3 — Critical/Warning findings |
| `hatch3r-test-writer` | Tests | Always — Phase 4 (every code change) |
| `hatch3r-security-auditor` | Security review | Always — Phase 4 (every code change) |
| `hatch3r-docs-writer` | Documentation | Phase 4 — evaluate when APIs/architecture/UX affected |
| `hatch3r-lint-fixer` | Lint/type fixes | Conditional — lint errors present |
| `hatch3r-a11y-auditor` | WCAG AA checks | Conditional — UI/accessibility changes |
| `hatch3r-perf-profiler` | Performance profiling | Conditional — performance-sensitive changes |
| `hatch3r-dependency-auditor` | CVE/supply chain | Conditional — dependencies change |
| `hatch3r-ci-watcher` | CI failure diagnosis | Conditional — CI fails |
| `hatch3r-architect` | Architecture design | Conditional — architectural decisions needed |
| `hatch3r-devops` | CI/CD and deployment | Conditional — infrastructure tasks |

## Deep Context Integration

Score task complexity per the `hatch3r-deep-context` rule (always-loaded) before Phase 1. That rule defines the full tier criteria, researcher modes per tier, and implementer enrichment fields. Apply the resulting tier as follows:

- **Tier 2 (Standard):** Present elicitation questions to the user inline. Await answers before proceeding to Phase 2.
- **Tier 3 (Deep):** Present a consolidated Pre-Implementation Summary and ASK for confirmation. Do NOT proceed to Phase 2 until all unresolved questions are answered.

## Mandatory Delegation Directives

### Context Gathering (Before Implementation)

You MUST spawn a `hatch3r-researcher` subagent before implementing any task. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Select research modes by task type, then add tier-appropriate modes per the Deep Context Integration section above:

- **`type:bug`**: modes `symptom-trace`, `root-cause`, `codebase-impact` + tier modes
- **`type:feature`**: modes `codebase-impact`, `feature-design`, `architecture` + tier modes
- **`type:refactor`**: modes `current-state`, `refactoring-strategy`, `migration-path` + tier modes
- **`type:qa`**: modes `codebase-impact` + tier modes

Use depth `quick` for low-risk tasks, `standard` for medium-risk, `deep` for high-risk. The `hatch3r-deep-context` tier may override depth upward (e.g., a Tier 3 task always uses `deep` depth for the additional modes, even if the task-type modes use `standard`).

### Research Completeness Checklist

Before handing off from Phase 1 (Research) to Phase 2 (Implement), the researcher output MUST be verified against this completeness checklist. Do NOT proceed to implementation until all items are confirmed:

- [ ] **All affected files identified** — every file that will be created, modified, or deleted is listed explicitly.
- [ ] **Blast radius assessed** — downstream consumers, dependents, and integration points that could break are documented.
- [ ] **Existing tests located** — relevant test files and test cases that cover the affected code are identified (or absence of coverage is noted).
- [ ] **Dependencies mapped** — internal module dependencies and external package dependencies relevant to the change are enumerated.

If any item cannot be confirmed, the researcher MUST flag the gap and the orchestrator MUST either: (a) re-run the researcher with additional modes targeting the gap, or (b) surface the gap to the user for manual input before proceeding.

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

### Per-Task Mini-Review

When a single implementation involves multiple sub-tasks (e.g., an epic with ordered steps, a feature requiring schema change + service layer + UI), the implementer MUST perform a lightweight mini-review after completing each sub-task before starting the next:

1. **Verify sub-task correctness** — confirm the sub-task's output compiles/parses without errors and meets its local acceptance criteria.
2. **Check interface contracts** — ensure any interfaces, types, or contracts introduced or modified by the sub-task are consistent with what subsequent sub-tasks will consume.
3. **Validate no regressions** — confirm the sub-task has not broken existing functionality visible at that point (e.g., existing tests still pass if applicable).
4. **Gate progression** — if the mini-review surfaces issues, fix them before moving to the next sub-task. Do not accumulate debt across sub-tasks.

Mini-reviews are internal to the implementer and do not require spawning a separate reviewer agent. They are lighter weight than the full Phase 3 review loop, which still runs after all sub-tasks are complete.

### Post-Implementation Quality Pipeline

You MUST run the review loop and final quality phases after implementation completes.

**Phase 3 — Review Loop:**

1. Spawn `hatch3r-reviewer` — code review. Include the diff and acceptance criteria in the prompt. The reviewer MUST include a **blast radius summary** in its output: number of files changed, number of lines added/removed, and whether any public APIs (exported interfaces, route signatures, event schemas) were changed. This summary gives the orchestrator and the user a quick gauge of change scope and risk.
2. If the reviewer reports Critical or Warning findings: spawn `hatch3r-fixer` with the full reviewer output (findings, file paths, line references, suggested fixes). When fixes touch shared or public interfaces, also include deep context enrichment (blast radius data, reference conventions) per the Implementation Delegation section above.
3. After fixes: spawn `hatch3r-reviewer` again to re-review the fixed code.
4. Repeat steps 2–3 until the reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
5. **Confirmation pass** — after the reviewer reports 0 Critical + 0 Warning, run one final lightweight re-review. This confirmation pass focuses ONLY on: (1) the reviewer's own fix-driven changes were not missed or introduced new issues, (2) no accidental regressions in adjacent code touched by fixes, (3) all acceptance criteria are fully met. If the confirmation pass surfaces new Critical or Warning findings, route them back through steps 2–4 (these iterations count toward the max 3 cap).
6. If max iterations reached with remaining findings: surface to user for manual resolution. Do not proceed to Phase 4 until the user acknowledges.

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

### Specialist Success Criteria

Each Phase 4 specialist agent has a defined success criterion. The specialist's output is considered successful only when its criterion is met. If not met, the orchestrator MUST surface the gap to the user.

| Specialist | Success Criterion |
|-----------|-------------------|
| `hatch3r-test-writer` | All new and modified code paths have corresponding tests; no untested branches remain in changed files. |
| `hatch3r-security-auditor` | No HIGH or CRITICAL severity findings remain unresolved; all MEDIUM findings are documented with remediation plan. |
| `hatch3r-docs-writer` | All affected APIs, architectural changes, and user-facing behavior changes are reflected in documentation. |
| `hatch3r-lint-fixer` | Zero lint errors and zero type errors in all changed files. |
| `hatch3r-a11y-auditor` | All changed UI components meet WCAG AA compliance; no new accessibility violations introduced. |
| `hatch3r-perf-profiler` | No performance regressions detected; any new hot paths are documented with benchmark baselines. |
| `hatch3r-dependency-auditor` | No known CVEs in added or updated dependencies; license compatibility verified. |
| `hatch3r-architect` | Architectural decisions are documented in ADRs; design aligns with existing system patterns or divergence is justified. |
| `hatch3r-devops` | CI/CD pipeline passes end-to-end; deployment configuration is validated against target environment. |

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

## Correlation ID

The orchestrator MUST generate a unique correlation ID (UUID v4 or equivalent) for each top-level task at the start of the pipeline. This ID enables end-to-end tracing across multi-agent workflows.

1. **Generation**: Create one correlation ID per top-level task before Phase 1 begins. Format: UUID v4 (e.g., `550e8400-e29b-41d4-a716-446655440000`).
2. **Propagation**: Include the correlation ID in every subagent prompt — researchers, implementers, reviewers, fixers, and all Phase 4 specialists. Pass it as a top-level field: `correlation_id: "<value>"`.
3. **Usage in subagents**: All subagents MUST include the correlation ID in any logs, error messages, structured outputs, or status reports they produce. This applies to both success and failure paths.
4. **Scope**: One correlation ID per top-level task. Epic sub-issues each get their own correlation ID. Batch tasks share one correlation ID per batch but include a sub-task index (e.g., `correlation_id: "<uuid>", sub_task: 2`).

## Severity Scale

All agents across the pipeline MUST use this canonical severity scale when classifying findings, issues, or audit results. This ensures consistent triage and gating across phases.

| Severity | Definition | Pipeline Action |
|----------|-----------|-----------------|
| **CRITICAL** | Blocks merge; must fix immediately. Security vulnerabilities, data loss risks, broken core functionality. | Merge is blocked. Findings must be resolved before the pipeline can proceed past Phase 3. |
| **HIGH** | Should fix before merge. Significant bugs, performance regressions, incomplete acceptance criteria. | Strongly recommended to fix before merge. Escalate to user if the fix is deferred. |
| **MEDIUM** | Fix in same sprint. Code quality issues, minor bugs, non-critical security findings. | Document with a remediation plan. May merge with tracking issue created. |
| **LOW** | Track for future. Style nits, minor refactoring opportunities, non-blocking improvements. | Log in findings summary. No merge gate. |
| **INFO** | Informational only. Observations, suggestions, context for future work. | Include in output for awareness. No action required. |

All subagents — reviewers, security auditors, test writers, and other specialists — MUST map their findings to this scale. When a subagent uses a different internal scale, it MUST translate to this canonical scale in its output.

## Pipeline Context

The orchestrator MUST maintain a `PipelineContext` object throughout the pipeline lifecycle. This object serves as the data contract between pipeline phases, ensuring structured handoff of findings, decisions, and artifacts.

### PipelineContext Schema

```
PipelineContext {
  correlationId: string           // UUID v4 from the Correlation ID directive
  phase: "research" | "implement" | "review" | "quality"  // Current active phase
  findings: Finding[]             // Accumulated findings from all phases
  decisions: Decision[]           // Decisions made during the pipeline (user answers, trade-offs, overrides)
  artifacts: string[]             // File paths created or modified during the pipeline
}

Finding {
  id: string                      // Unique finding identifier (e.g., "F-001")
  phase: string                   // Phase that produced the finding
  agent: string                   // Agent that produced the finding
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"  // Per Severity Scale
  description: string             // Human-readable finding description
  filePath?: string               // Affected file, if applicable
  resolved: boolean               // Whether the finding has been addressed
}

Decision {
  id: string                      // Unique decision identifier (e.g., "D-001")
  phase: string                   // Phase where the decision was made
  description: string             // What was decided
  rationale: string               // Why this option was chosen
  madeBy: "user" | "agent"        // Who made the decision
}
```

### Phase Handoff Metadata

When transitioning between pipeline phases, the orchestrator MUST include the following metadata fields in each handoff to enable traceability and performance analysis:

- `timestamp` -- ISO 8601 timestamp of the handoff event
- `agentId` -- identifier of the agent completing the phase (e.g., `hatch3r-researcher`, `hatch3r-implementer`)
- `phase` -- the phase being completed (e.g., `research`, `implement`, `review`, `quality`)
- `duration` -- elapsed time in seconds for the completed phase
- `filesModified` -- list of file paths created, modified, or deleted during the phase

These fields are appended to the `PipelineContext` at each phase transition, providing a structured audit trail of which agent did what, when, and for how long.

### Context Caching

When multiple agents need the same context (e.g., project structure, test results, blast radius data, reference conventions), cache it in the shared `PipelineContext` rather than having each agent re-read or re-compute it independently. Specifically:

- Research output from Phase 1 (file lists, dependency maps, convention extractions) should be stored once and passed by reference to the implementer, reviewer, and any Phase 4 specialists that need it.
- Test suite results captured during implementation verification should be cached and forwarded to the reviewer and test-writer rather than re-running the full suite in each phase.
- This reduces redundant file reads, avoids inconsistencies from reading files at different points in time, and conserves token budget across subagent prompts.

### PipelineContext Usage

1. **Initialization**: The orchestrator creates a `PipelineContext` at the start of Phase 1 with the `correlationId` and `phase` set to `"research"`. All other fields are initialized as empty arrays.
2. **Phase transitions**: When moving between phases, update the `phase` field. Do not clear previous phase data — findings and decisions accumulate across the full pipeline.
3. **Subagent input**: Pass the current `PipelineContext` (or relevant subsets) to each subagent so it has full pipeline history.
4. **Subagent output**: Each subagent appends its findings and decisions to the context. The orchestrator merges subagent outputs back into the canonical `PipelineContext`.
5. **Final output**: The completed `PipelineContext` is included in the task summary, giving the user full traceability from research through quality.

## Resilience Directives

This section covers all failure/recovery paths — researcher failure, test failure, reviewer failure, and all other subagent failures.

When a subagent fails (error, timeout, or BLOCKED status), apply the following retry-and-fallback protocol:

1. **Retry once**: Re-send the same prompt to the same agent type exactly once. Do not modify the prompt on retry.
2. **Fallback on second failure**: If the retry also fails, fall back to degraded mode for that phase:
   - **Researcher failure** → Proceed to Phase 2 (Implement) without research context. Add a warning to the implementer prompt: `"WARNING: Research phase failed. Proceeding without research context. Exercise extra caution with assumptions."` The orchestrator should note this gap in the final output.
   - **Reviewer failure** → Surface the raw diff to the user for manual review. Do not proceed to Phase 4 automatically.
   - **Test-writer failure** → Flag the deliverable as "untested" in the PR description. Add label `needs-tests` if the platform supports it.
   - **Fixer failure** → Surface the original reviewer findings to the user. Do not re-enter the review loop.
   - **Security-auditor failure** → Flag as "security-unaudited" in the PR description. Add label `needs-security-review` if the platform supports it.
   - **Other specialist failure** → Skip that specialist, document the gap in the final output (e.g., "docs-writer skipped due to failure").
3. **Retry budget**: Maximum 3 total retries across all subagents per top-level task. Once the budget is exhausted, any subsequent failures go directly to fallback without retry.
4. **Reporting**: Include all failures and fallbacks in the task summary so the user has full visibility into degraded phases.

### Circuit Breaker Tracking

The orchestrator MUST track consecutive failures per agent type and per pipeline phase to prevent repeated invocations of persistently failing agents.

1. **Tracking**: Maintain a per-agent failure counter that increments on each consecutive failure (error, timeout, or BLOCKED) and resets to zero on any success.
2. **Trip threshold**: After **3 consecutive failures** for the same agent type within a single pipeline run, mark that agent as **"tripped"** and skip all subsequent invocations of it for the remainder of the task.
3. **State transitions**: Log every circuit breaker state change with the correlation ID, agent type, and transition:
   - `CLOSED → OPEN` — agent tripped after 3 consecutive failures. Log: `"Circuit breaker OPEN for <agent>: <failure_count> consecutive failures"`.
   - `OPEN → HALF-OPEN` — cooldown period elapsed or manual reset issued. Log: `"Circuit breaker HALF-OPEN for <agent>: attempting probe"`.
   - `HALF-OPEN → CLOSED` — probe invocation succeeded. Log: `"Circuit breaker CLOSED for <agent>: probe succeeded"`.
   - `HALF-OPEN → OPEN` — probe invocation failed. Log: `"Circuit breaker re-OPEN for <agent>: probe failed"`.
4. **Skipping tripped agents**: When an agent is tripped, apply its fallback behavior from the Resilience Directives above and note `"Skipped: circuit breaker OPEN"` in the task summary.
5. **Reset policy**: A tripped agent can be re-enabled by either:
   - **Manual reset** — the user explicitly requests retrying the agent (e.g., "retry the reviewer").
   - **Cooldown period** — if the pipeline spans multiple top-level tasks in a session, a tripped agent automatically transitions to HALF-OPEN after **10 minutes** of inactivity. The next invocation is a probe: success closes the breaker; failure re-opens it.
6. **Cross-task persistence**: Circuit breaker state persists within a session. If an agent trips during task A, it remains tripped for task B unless manually reset or the cooldown period has elapsed.

### Stall Detection

If an agent produces no output for 2 minutes, consider it stalled. The orchestrator MUST:

1. **Log the stall** with the correlation ID, agent type, phase, and elapsed idle time: `"STALL detected for <agent> in <phase>: <elapsed>s with no output"`.
2. **Terminate the stalled agent** and capture any partial output produced before the stall.
3. **Retry once** by re-spawning the same agent type with the same prompt. If the retry also stalls, skip the agent and apply the relevant fallback from the Resilience Directives (e.g., proceed without research context, flag as untested).
4. **Include a warning** in the `PipelineContext` noting the stall and whether the retry succeeded or the agent was skipped.

A stalled invocation counts as a failure for both the retry budget and the circuit breaker failure counter.

### Timeout Policy

Each pipeline phase has an explicit time budget. If a phase exceeds its timeout, capture partial results and move to the next phase. Do not block the pipeline indefinitely.

| Phase / Activity | Per-Item Timeout | Phase Total Timeout |
|-----------------|-----------------|-------------------|
| **Phase 1 — Research** | 5 minutes per file | 30 minutes total |
| **Phase 2 — Implement** | 10 minutes per task | — |
| **Phase 3 — Review Loop** | 5 minutes per review cycle | — |
| **Phase 4 — Final Quality** | 5 minutes per specialist | — |

**Timeout behavior:**

1. **Partial capture**: When a timeout fires, the orchestrator MUST capture whatever output the subagent has produced so far. Partial research context, partial reviews, or partial test suites are preferable to no output.
2. **Logging**: Log the timeout with the correlation ID, phase, agent, elapsed time, and whether partial results were captured: `"TIMEOUT in <phase> for <agent>: <elapsed>s elapsed, partial results captured: <yes/no>"`.
3. **Phase advancement**: After capturing partial results, proceed to the next phase. Include a warning in downstream prompts: `"WARNING: <phase> timed out. Partial results only. Exercise extra caution."`.
4. **Retry interaction**: A timed-out invocation counts as a failure for both the retry budget and the circuit breaker failure counter.

### Observability Span Naming

For observability, name tracing spans consistently using the pattern `hatch3r.{phase}.{agent}`. This convention enables filtering and aggregation across pipeline runs in any OpenTelemetry-compatible backend.

Examples:
- `hatch3r.research.researcher`
- `hatch3r.implement.implementer`
- `hatch3r.review.reviewer`
- `hatch3r.review.fixer`
- `hatch3r.quality.test-writer`
- `hatch3r.quality.security-auditor`

The orchestrator creates a root span `hatch3r.pipeline` for the full task, with child spans for each phase and grandchild spans for each agent invocation within that phase. Include the `correlationId` as a span attribute on every span.

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

## Auto-Mode Guardrails

When agents run in auto-mode (unattended execution without real-time user oversight), the orchestrator MUST apply additional verification after each phase completes:

1. **Scope containment** — verify the agent stayed within its declared scope. If a researcher was scoped to `codebase-impact`, it must not have performed `feature-design` work. If an implementer was scoped to specific files, it must not have modified files outside that set.
2. **No destructive operations without prior approval** — verify the agent did not perform destructive operations (file deletions, database migrations, force-pushes, dependency removals) unless those operations were explicitly listed in the task prompt as approved actions. Any destructive operation not pre-approved MUST be flagged and rolled back before proceeding.
3. **Output schema compliance** — verify all agent outputs match their expected schemas. Researcher output must contain the required sections for its modes. Implementer output must include changed file paths and acceptance criteria status. Reviewer output must use the canonical severity scale. Malformed outputs MUST trigger a retry or escalation, not silent acceptance.

If any guardrail check fails, the orchestrator MUST halt the pipeline and surface the violation to the user (or to a persistent log if fully unattended) before continuing.

## Status Codes

All agents MUST use these canonical status codes when reporting task or phase outcomes. This ensures consistent interpretation across the pipeline.

| Status | Meaning |
|--------|---------|
| **SUCCESS** | Task completed fully, all acceptance criteria met. |
| **PARTIAL** | Task partially completed; some acceptance criteria met, others remain open or degraded. |
| **FAILED** | Task could not be completed; no usable output produced. |
| **SKIPPED** | Task was intentionally not executed (e.g., non-applicable phase, trivial edit bypass). |
| **TIMEOUT** | Task exceeded its time budget; partial results may be available. |

When a subagent returns PARTIAL or FAILED, it MUST include a `reason` field explaining what succeeded and what did not. When a subagent returns TIMEOUT, any captured partial output MUST be forwarded to the next phase.

## Rule Application

All hatch3r rules with `scope: always` apply to every implementation task, including work delegated to subagents. When constructing subagent prompts, include the rule directives — subagents do not automatically inherit the parent's rule context.

### Tiered Rule Inclusion

To manage token budgets when constructing subagent prompts, include rules in tiers. Higher tiers are only loaded when relevant to the specific agent or task phase.

**Tier 1 -- Always include (every subagent prompt):**
- `hatch3r-security-patterns` -- security invariants apply to all code changes
- `hatch3r-code-standards` -- code quality conventions apply universally

**Tier 2 -- Include by phase (match to the active agent):**
- `hatch3r-testing` -- include for `hatch3r-test-writer`, `hatch3r-implementer`, `hatch3r-reviewer`
- `hatch3r-accessibility-standards` -- include for `hatch3r-a11y-auditor`, `hatch3r-reviewer` (UI changes)
- `hatch3r-git-conventions` -- include for orchestrator git operations
- `hatch3r-ci-cd` -- include for `hatch3r-ci-watcher`, `hatch3r-devops`
- `hatch3r-dependency-management` -- include for `hatch3r-dependency-auditor`

**Tier 3 -- On-demand (reference only when the task context requires it):**
- `hatch3r-api-design` -- when designing or reviewing API contracts
- `hatch3r-secrets-management` -- when handling credentials or environment config
- `hatch3r-data-classification` -- when handling PII or sensitive data flows
- `hatch3r-performance-budgets` -- when profiling or reviewing performance
- `hatch3r-browser-verification` -- when verifying UI in browser
- `hatch3r-component-conventions` -- when writing UI components
- `hatch3r-i18n`, `hatch3r-theming`, `hatch3r-migrations`, `hatch3r-feature-flags`, `hatch3r-observability` -- when the task specifically touches these areas

For tools with limited context windows, Tier 1 rules are mandatory. Tier 2 and Tier 3 rules should be included selectively based on the subagent's role and the task scope to avoid exceeding token budgets.
