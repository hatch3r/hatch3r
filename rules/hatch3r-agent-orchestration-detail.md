---
id: hatch3r-agent-orchestration-detail
type: rule
description: Extended orchestration reference — PipelineContext schemas, resilience protocols, observability integration, and auto-mode guardrails
scope: conditional
globs: "**/.hatch3r/**,**/pipeline/**,**/*orchestrat*,**/*agent*"
tags: [orchestration, floor:protocol]
precedence: normal
quality_charter: agents/shared/quality-charter.md
cache_friendly: true
detail_rule: true
consumed_by: hatch3r-agent-orchestration
---
# Agent Orchestration — Extended Reference

This is the on-demand companion to `hatch3r-agent-orchestration`. Load when you need detailed schemas, failure handling protocols, or guardrail specifications.

## PipelineContext Schema

The `PipelineContext` is the structured handoff object passed between pipeline phases. Each phase reads its inputs and writes its outputs to this context.

```
PipelineContext {
  correlationId: string          // UUID v4, generated before Phase 1
  taskType: "bug" | "feature" | "refactor" | "qa"
  issueRef: string | null        // Issue number or null for plain chat
  deepContextTier: 1 | 2 | 3    // From hatch3r-deep-context scoring

  // Detected project type for specialist selection (Finding #56)
  projectType?: {
    languages: string[]          // From repo analysis (e.g., "typescript", "python", "go")
    frameworks: string[]         // Detected frameworks (e.g., "next", "express")
    isMonorepo: boolean
    packageManager: string       // "npm" | "yarn" | "pnpm" | "bun" | "unknown"
  }

  // Phase 1 outputs (Research)
  researchFindings: {
    modes: string[]              // Researcher modes used
    affectedFiles: string[]      // Files to create/modify/delete
    blastRadius: string[]        // Downstream consumers
    existingTests: string[]      // Test files covering affected code
    dependencies: string[]       // Internal + external dependencies
    conventions: object | null   // From similar-implementation mode
    resolvedRequirements: object | null  // From requirements-elicitation
  }

  // Research gap flags from mid-implementation checkpoint (Finding #52)
  researchGaps?: string[]        // Gaps identified during Phase 2

  // Phase 2 outputs (Implementation)
  implementationResult: {
    filesChanged: string[]
    testsWritten: string[]
    status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED" | "TIMEOUT"
    reason: string | null
  }

  // Phase 3 outputs (Review)
  reviewResult: {
    iterations: number           // 1-3
    finalVerdict: "CLEAN" | "UNRESOLVED"
    findings: ReviewFinding[]
    confirmationPassResult: "PASS" | "FAIL"
  }

  // Phase 4 outputs (Quality)
  qualityResults: {
    specialists: SpecialistResult[]
    validationPass: {
      testsPass: boolean
      typecheckPass: boolean
      fixAttempts: number
      regressionsPersist: boolean
    }
  }

  // Metadata
  startedAt: string              // ISO-8601
  completedAt: string | null
  totalDuration: number | null   // milliseconds
}
```

The TypeScript implementation of this schema with runtime validation is in `src/pipeline/pipelineContext.ts`. Use `validatePhaseTransition()` to verify context completeness before advancing between phases.

## Resilience and Failure Handling

### Phase Failure Protocols

| Phase | Failure Mode | Protocol |
|-------|-------------|----------|
| Phase 1 (Research) | Researcher timeout | Proceed with partial findings; flag missing modes. |
| Phase 1 (Research) | No relevant findings | Surface to user; ask whether to proceed with implementation. |
| Phase 2 (Implementation) | Build/test failure | Attempt self-fix (max 2 iterations). Escalate to user if unresolved. |
| Phase 2 (Implementation) | Scope creep detected | Halt. Surface deviation to user. Resume only with approval. |
| Phase 3 (Review) | Max iterations (3) | Surface unresolved findings to user. Do not merge. |
| Phase 3 (Review) | DESIGN_OBJECTION verdict | Terminate review loop immediately. Surface the objection and alternative approaches to the user for an architectural decision. Do not spawn fixer. |
| Phase 3 (Review) | Fixer introduces regressions | Revert fixer changes. Surface original findings + regression to user. |
| Phase 4 (Quality) | Specialist timeout | Log timeout. Continue with available results. Flag in output. |
| Phase 4 (Quality) | Validation pass fails | Spawn fixer (max 2 attempts). Surface if unresolved. |

### Subagent Error Recovery

1. **Timeout:** Forward partial output. Mark status `TIMEOUT`. Continue pipeline.
2. **Crash/no output:** Mark status `FAILED`. Log reason. Continue if non-blocking.
3. **Conflicting outputs:** When two specialists disagree (e.g., security vs performance), escalate to user with both positions.
4. **Resource exhaustion:** If context window is exhausted, summarize prior context and continue with summary.

### Retry Policies

- Subagent retries: 0 (spawn a new agent with adjusted prompt instead).
- Phase retries: Phase 3 review loop retries up to 3 iterations. All other phases: 0 retries (escalate to user).
- Never retry the same failed operation identically — adjust the prompt or approach.

## Observability Integration

### Structured Logging

All pipeline events should produce structured log entries when the project has observability infrastructure:

```
{
  "event": "pipeline.phase.start" | "pipeline.phase.end" | "subagent.spawn" | "subagent.complete",
  "correlationId": "...",
  "phase": 1-4,
  "agent": "hatch3r-implementer",
  "status": "SUCCESS" | "PARTIAL" | "FAILED" | "TIMEOUT",
  "duration": 12345,
  "metadata": {}
}
```

### Metrics to Track

| Metric | Description |
|--------|-------------|
| Pipeline duration | Total time from Phase 1 start to Phase 4 end |
| Phase duration | Time per phase |
| Review iterations | Number of Phase 3 review cycles |
| Specialist invocations | Count of Phase 4 specialists launched |
| Fix attempts | Number of fixer invocations across all phases |
| Failure rate | Proportion of tasks not reaching SUCCESS |

### Correlation ID Propagation

The correlation ID generated before Phase 1 MUST be:
- Included in every subagent prompt
- Included in every structured log entry
- Included in every status report and output
- Used as the key for cross-referencing pipeline artifacts

## Auto-Mode Guardrails

When operating in unattended/auto mode (no human in the loop), enforce these guardrails after each phase:

### Scope Containment

- **File scope:** Only modify files identified in Phase 1 research + files discovered during implementation that are direct dependencies. No drive-by refactors.
- **Dependency scope:** Do not add new external dependencies without explicit approval.
- **Destructive operations:** Never execute `rm -rf`, `DROP TABLE`, force push, or other destructive operations in auto mode. Queue for human review.

### Output Schema Compliance

After each phase, validate that the output conforms to the expected PipelineContext schema fields. Missing required fields trigger a HALT.

### Escalation Triggers

Auto-mode MUST halt and surface to user when:
1. A CRITICAL finding is detected in Phase 3.
2. Phase 4 validation pass fails after 2 fix attempts.
3. Any specialist reports FAILED status.
4. Scope containment violation detected.
5. Implementation touches more than 20 files (may indicate scope creep).

### Budget Guards

- **Token budget:** If cumulative subagent token usage exceeds 80% of estimated budget, surface to user before spawning additional agents.
- **Time budget:** If pipeline duration exceeds 2x the estimated time (based on deep context tier), surface status and request continuation approval.

## Adaptive Pipeline Behavior

### Complexity-Driven Adaptation

The pipeline should adapt its behavior based on observed task complexity, not just the initial tier assignment:

| Signal During Execution | Adaptation |
|------------------------|------------|
| Phase 1 research finds >10 affected files (initial estimate was <5) | Upgrade tier to 3 if currently 2. Re-run `codebase-impact` at `deep` depth before Phase 2. |
| Phase 2 implementer reports >3 research gaps | Pause Phase 2. Run targeted researcher with gap-specific modes before continuing. |
| Phase 3 review loop reaches iteration 2 with increasing Critical count | Classify as complexity underestimate. Surface to user with recommendation to break the task into smaller sub-tasks. |
| Phase 4 validation pass fails on first attempt | Check whether failure is in test-writer's new tests (expected -- fix test) or in pre-existing tests (regression -- fix implementation). Route to appropriate fixer. |

### Post-Pipeline Learning

After pipeline completion, the orchestrator captures lessons for future runs:

1. **Tier accuracy:** Was the initial tier correct? If the pipeline needed adaptation (above), persist a tier-accuracy record (`taskId`, `initialTier`, `finalTier`, `adjustmentReasons`, `correlationId`, `ts`) to `.hatch3r/telemetry/<session-id>-tier.json` via the atomic-write path in `src/pipeline/costEstimator.ts` (sibling of `CostTelemetryRecord`). Tier mismatch beyond ±10% across 50 tasks triggers a CL-3 signal-weight recalibration proposal.
2. **Phase duration ratios:** Record time spent per phase. Anomalous ratios (e.g., Phase 3 taking 5x Phase 2) indicate systemic issues worth investigating.
3. **Specialist value:** Record which Phase 4 specialists produced actionable findings vs. clean reports. Over time, this data informs smarter specialist dispatch.

## Multi-Task and Concurrent Pipeline Support

Finding D7-M13 / D7-SA7.5-3: the orchestration rule's `Task Context Protocols` paragraph documents multi-task / epic / batch handling in a single sentence; the protocol benefits from an expanded canonical schema so downstream pack integrators have a deterministic specification.

**Dependency-graph construction.** Multi-task input (epic, plain-chat multi-request, or board batch) is parsed into discrete units. Each unit carries its own `correlationId` (epic sub-issues get individual IDs sharing a parent epic ID; batch tasks share one ID with a sub-task index). The orchestrator builds a directed acyclic dependency graph from declared inter-unit constraints (e.g., "issue B depends on issue A's API changes"); units with no declared dependency form the root level.

**Per-level parallelism.** At each dependency level, the orchestrator parallelizes researchers + implementers across all units in that level subject to the three Parallel Safety conditions in the canonical rule. The parallelism width per level is bounded by the same `max_phase4_parallel` ceiling (env-overridable via `HATCH3R_MAX_PHASE4_PARALLEL`) the Phase 4 specialists honor, plus an `HATCH3R_MAX_LEVEL_PARALLEL` ceiling (default `8`, valid range 1–16) when implementer fan-out width exceeds the Phase 4 ceiling at deeper levels.

**Concurrent primitive — `concurrent_pipeline_unit`.** Each unit in a level is a `concurrent_pipeline_unit` record: `{ unitId: string; correlationId: string; parentEpicId?: string; level: number; dependsOn: string[]; priority: "p0"|"p1"|"p2"|"p3"; status: "pending"|"running"|"complete"|"blocked"; }`. Within a level the orchestrator dispatches by priority descending (p0 first); when concurrency limits cap the level, the in-flight pool is filled with highest-priority units first and the rest queue for the next dispatch slot.

**File-overlap reconciliation.** When two parallel implementers in the same level touch the same file: accept disjoint-region edits without conflict; merge overlapping regions using the larger-scope change as base (the smaller change replays onto the larger); halt on semantic conflicts for user resolution. Per Parallel Safety condition 3, NO mid-pipeline writes to shared mutable state (`.hatch3r/hatch.json`, `.hatch3r/learnings/INDEX.md`) — learnings consolidation happens at pipeline completion only.

**Review loop coordination.** After all level-N implementers complete, the orchestrator runs ONE consolidated Phase 3 review loop covering the union diff produced by the level. Per-unit Phase 4 specialist dispatch then runs in parallel bounded by `max_phase4_parallel`. Level-N+1 begins only after Level-N reaches Phase 4 completion (validated by `evaluatePhase4Completion`).

**Concurrent-invocation handling.** Cross-pipeline (two `hatch3r` commands in two shells against the same repo) is deferred to a future cycle pending the Decision 27 resumability work — see CL-2 spec at the end of `governance/AUDIT-EXECUTE.md`.

## Pipeline Pattern (Cross-Command Consistency)

Finding D7-M12 / D7-SA7.5-2: implementation-flavored orchestrators (`workflow`, `board-pickup`, `revision`, `quick-change`, `board-fill`) MUST follow the canonical pattern below. Per-command deviations require an explicit rationale in the command body's "Pipeline Deviations" subsection.

| Stage | Canonical agent | Required at Tier | Carve-out |
|-------|-----------------|------------------|-----------|
| Phase 1 Research | `hatch3r-researcher` | T2/T3 | T1 skip per Phase Skip Criteria |
| Phase 2 Implement | `hatch3r-implementer` | All | T1 quick-change inline carve-out only |
| Phase 3 Review Loop | `hatch3r-reviewer` ↔ `hatch3r-fixer` (max `DEFAULT_MAX_REVIEW_ITERATIONS`) | T2/T3 nontrivial | T1 all-trivial skip per Phase Skip Criteria |
| Phase 4 Final Quality | CQ + SSOT specialists, batched by severity, bounded by `max_phase4_parallel` | T2/T3 | T1 — only always-mode floor (`security` + `testability`) |
| Phase 4 Validation Pass | re-run tests/typecheck vs Phase-3 baseline; re-review on specialist code mutations | T2/T3 | — |

Cross-command error-handling defaults: sub-agent failure → retry once then fall back to direct/inline implementation per command's carve-out; quality-check failure → max 2 retry loops then ASK; context-degradation threshold → 25 turns (quick-change tightens to 15 per its documented rationale). Concurrent-invocation handling and lockfile semantics are deferred to a future cycle pending the Decision 27 resumability work.

## Context Token Optimization

When pipeline context exceeds 50% of the available context window, apply these compression strategies in order:

1. **Summarize Phase 1 output.** Replace full research findings with a structured summary: affected files (list), blast radius (count + top 3), key conventions (bullet points). Keep raw data only for the fields the current phase needs.
2. **Prune resolved findings.** After Phase 3 review loop, remove findings that were fixed and confirmed. Only carry forward unresolved findings.
3. **Collapse specialist results.** In the final output, summarize specialist results as a single status table rather than including full specialist reports. Full reports are available on request.
4. **Never truncate security findings.** Security auditor output is always included in full regardless of context pressure.

These strategies preserve decision-critical information while reducing token overhead for long pipelines.

**Handoff loss measurement.** Compression is lossy by design, so measure it. At each phase transition the orchestrator records a `PhaseHandoffMetrics` record (`src/pipeline/observability.ts::createPhaseHandoffMetrics`) capturing input bytes, output bytes, whether summarisation was applied, and an `informationLossEstimate` (0-1 fraction of input bytes dropped). When `informationLossEstimate` exceeds `0.3`, surface the single-line warning from `formatPhaseHandoffWarning` in the iteration summary so downstream phases validate that critical context survived. This closes the gap where a downstream phase silently receives a summary when it needed the full upstream output.
