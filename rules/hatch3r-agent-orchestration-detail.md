---
id: hatch3r-agent-orchestration-detail
type: rule
description: Extended orchestration reference — PipelineContext schemas, resilience protocols, observability integration, and auto-mode guardrails
scope: conditional
tags: [core]
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

  // Phase 2 outputs (Implementation)
  implementationResult: {
    filesChanged: string[]
    testsWritten: string[]
    status: "SUCCESS" | "PARTIAL" | "FAILED"
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

## Resilience and Failure Handling

### Phase Failure Protocols

| Phase | Failure Mode | Protocol |
|-------|-------------|----------|
| Phase 1 (Research) | Researcher timeout | Proceed with partial findings; flag missing modes. |
| Phase 1 (Research) | No relevant findings | Surface to user; ask whether to proceed with implementation. |
| Phase 2 (Implementation) | Build/test failure | Attempt self-fix (max 2 iterations). Escalate to user if unresolved. |
| Phase 2 (Implementation) | Scope creep detected | Halt. Surface deviation to user. Resume only with approval. |
| Phase 3 (Review) | Max iterations (3) | Surface unresolved findings to user. Do not merge. |
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
