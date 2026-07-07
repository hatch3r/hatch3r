/**
 * PipelineContext type definitions and runtime validation.
 *
 * The PipelineContext is the structured handoff object passed between pipeline
 * phases. Each phase reads its inputs and writes its outputs to this context.
 * Runtime validation ensures that required fields are present and correctly
 * typed when context is passed between phases.
 *
 * Finding #54 (D7, High): Add TypeScript PipelineContext type with runtime validation.
 *
 * @library_export_only — canonical handoff schema for the hatch3r agent pipeline
 * (consumed by hatch3r-* agents and downstream pack integrators); the CLI itself
 * never instantiates a PipelineContext because runtime execution happens inside
 * Claude Code / the host coding tool, not inside the CLI process.
 */

// ── Types ────────────────────────────────────────────────────────

export type TaskType = "bug" | "feature" | "refactor" | "qa";
export type DeepContextTier = 1 | 2 | 3;
/**
 * AgentStatus — terminal status produced by any agent in the pipeline.
 *
 * - SUCCESS: work completed against the acceptance criteria.
 * - PARTIAL: work completed partially; `reason` explains what remains.
 * - FAILED: work did not complete due to an error or fault; `reason` explains.
 * - SKIPPED: work was skipped per documented skip criteria; `reason` cites the criterion.
 * - TIMEOUT: work exceeded the allotted phase timeout.
 * - BLOCKED_PREMISE_CHALLENGE: the agent determined the task premise is misconceived
 *   (e.g., requested feature already exists, conflicts with an architectural invariant,
 *   or requirements are internally contradictory) and the pipeline should halt pending
 *   user clarification. Surfaces quality-charter §3 ("Question Unclear Requirements")
 *   as a machine-actionable signal. `reason` must contain the premise concern and at
 *   least one alternative approach. See Finding D7-SA7.1-2 / C7.5-W2B2-H24.
 */
export type AgentStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED"
  | "TIMEOUT"
  | "BLOCKED_PREMISE_CHALLENGE";

/**
 * The canonical list of all AgentStatus values. Consumers that validate status
 * strings at runtime must import this constant rather than duplicating the
 * list, so adding a new variant updates every consumer in lock-step.
 */
export const AGENT_STATUS_VALUES: readonly AgentStatus[] = [
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "SKIPPED",
  "TIMEOUT",
  "BLOCKED_PREMISE_CHALLENGE",
] as const;

/**
 * True when the status indicates the pipeline should halt and surface to the
 * user rather than proceed to the next phase. Currently only
 * BLOCKED_PREMISE_CHALLENGE triggers halt semantics; other non-success states
 * (FAILED/TIMEOUT) are handled by retry/circuit-breaker logic, not halt.
 */
export function isHaltStatus(status: AgentStatus): boolean {
  return status === "BLOCKED_PREMISE_CHALLENGE";
}

export type ReviewVerdict = "CLEAN" | "UNRESOLVED";
export type ConfirmationPassResult = "PASS" | "FAIL";

export interface ResearchFindings {
  /** Researcher modes used. */
  modes: string[];
  /** Files to create/modify/delete. */
  affectedFiles: string[];
  /** Downstream consumers at risk. */
  blastRadius: string[];
  /** Test files covering affected code. */
  existingTests: string[];
  /** Internal + external dependencies. */
  dependencies: string[];
  /** From similar-implementation mode. */
  conventions: Record<string, unknown> | null;
  /** From requirements-elicitation mode. */
  resolvedRequirements: Record<string, unknown> | null;
}

export interface ImplementationResult {
  filesChanged: string[];
  testsWritten: string[];
  status: AgentStatus;
  reason: string | null;
}

export interface ReviewFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  description: string;
  filePath?: string;
  line?: number;
  confidence: "high" | "medium" | "low";
}

export interface SpecialistResult {
  specialist: string;
  status: AgentStatus;
  findingsCount: number;
  summary: string;
  /**
   * Critical-severity findings this specialist surfaced that remain unresolved
   * after its fixer pass (Finding D7-19). Optional/backward-compatible: absent →
   * treated as 0. `evaluatePhase4Completion` sums this field across specialists
   * to derive `unresolvedCriticalFindings` when the caller does not pass an
   * explicit override, so the completion gate no longer depends on a severity
   * count threaded through a separate options argument that the typed
   * `SpecialistResult` record did not carry. The severity-descending Phase 4
   * batch scheduler reads the same field as its typed input.
   */
  criticalCount?: number;
}

export interface ValidationPass {
  testsPass: boolean;
  typecheckPass: boolean;
  fixAttempts: number;
  regressionsPersist: boolean;
}

/**
 * Default maximum Phase 4 Validation Pass fixer iterations.
 *
 * Finding D7-SA7.3-F-7 (Cycle 10): the "max 2 iterations" Phase 4 Validation
 * Pass bound in `rules/hatch3r-agent-orchestration.md` (Phase 4 Validation
 * Pass) previously had no calibration anchor, unlike the sibling review-loop
 * bound which cites `DEFAULT_MAX_REVIEW_ITERATIONS` in `reviewLoop.ts`. This
 * constant is that anchor: the rule prose references it by name and
 * `pipelineContext.test.ts` asserts rule↔code parity (CI-enforced), closing the
 * same "unjustified prose-only bound" failure class SA7.2 F-4 closed for the
 * review loop. The validation pass re-runs the test suite + type checker after
 * a `hatch3r-fixer` pass on Phase-4-introduced regressions; the cap bounds how
 * many fixer→re-validate cycles run before persistent regressions surface to
 * the user. Lower than the review-loop cap (4) because a validation-pass
 * iteration only re-runs the fixer on the same diff — no specialist re-spawn —
 * so the per-iteration cost and the expected convergence count are both small.
 *
 * See `VALIDATION_PASS_CALIBRATION` below for the empirical basis and the
 * recalibration triggers that, if observed, invalidate this default.
 */
export const DEFAULT_MAX_VALIDATION_PASS_ITERATIONS = 2;

/**
 * Reproducible calibration record for `DEFAULT_MAX_VALIDATION_PASS_ITERATIONS`.
 *
 * Finding D7-SA7.3-F-7 (Cycle 10): same failure class as the review-loop
 * calibration (D7-SA7.2-1 / C7.5-W2B2-H25). Per the Scientific Rigor Contract
 * (`agents/shared/rigor-contract.md`) a numeric bound must carry
 * a reproducible basis or be downgraded to an informed estimate. No historical
 * validation-pass iteration-count dataset exists, so `basis` is
 * `"informed_estimate"` with `sampleSize: 0`; the record captures the
 * measurement method a future implementer uses to replace the estimate with
 * measured data and the runtime conditions that invalidate the current default.
 * Structure mirrors `src/pipeline/reviewLoop.ts::CALIBRATION` so both bounds are
 * audited the same way.
 */
export interface ValidationPassCalibration {
  /** Whether the cap is measured from data or an informed estimate. */
  readonly basis: "measured" | "informed_estimate";
  /** Source dataset identifier for re-derivation. */
  readonly source: string;
  /** Number of observations underlying the claim (0 when basis=informed_estimate). */
  readonly sampleSize: number;
  /** ISO date of most recent measurement (null when basis=informed_estimate). */
  readonly measuredAt: string | null;
  /**
   * Observable conditions under which the current default must be re-derived.
   * If any trigger is observed in production, the default is not safe.
   */
  readonly recalibrationTriggers: Readonly<{
    /** Re-derive if the fraction of validation passes that converge within the cap falls below this value. */
    convergeWithinCapRateBelow: number;
    /** Re-derive if validation-pass fixer iterations hit the cap on more than this fraction of runs. */
    capHitRateAbove: number;
  }>;
  /** Path (relative to repo root) documenting the measurement method. */
  readonly measurementMethodRef: string;
}

export const VALIDATION_PASS_CALIBRATION: Readonly<ValidationPassCalibration> = Object.freeze({
  basis: "informed_estimate",
  // Honest non-citation per Charter directive 20 — no historical validation-
  // pass iteration-count dataset exists. The cap of 2 is an author judgment:
  // a validation-pass regression is normally a single localized break the
  // fixer resolves in one pass; a second pass covers a follow-on break the
  // first fix surfaces. When validation-pass telemetry lands per the CL-2 spec
  // below, replace this with the path to the produced dataset.
  source:
    "no historical dataset; informed_estimate based on author judgment pending validation-pass iteration-count telemetry (CL-2 spec in measurementMethodRef)",
  sampleSize: 0,
  measuredAt: null,
  recalibrationTriggers: Object.freeze({
    convergeWithinCapRateBelow: 0.9,
    capHitRateAbove: 0.1,
  }),
  // CL-2 spec for validation-pass iteration-count telemetry (Finding D7-SA7.3-F-7),
  // identical mechanism to the review-loop calibration (D7-SA7.2-1):
  // (1) Add `validation_pass_iteration_count: number` to per-finding records in
  //     `governance/audit/finding-registry.json`.
  // (2) Add `scripts/calibrate-validation-pass.ts` that reads the registry,
  //     emits the measured iteration distribution, and writes a candidate
  //     VALIDATION_PASS_CALIBRATION update PR once the sample crosses 30 findings.
  // (3) Promote `basis` to `"measured"` and set `measuredAt` once the script
  //     runs against a 30+ finding sample.
  measurementMethodRef:
    "CL-2 spec: per-finding validation_pass_iteration_count column in governance/audit/finding-registry.json + scripts/calibrate-validation-pass.ts (D7-SA7.3-F-7)",
});

export interface QualityResults {
  specialists: SpecialistResult[];
  validationPass: ValidationPass;
}

/**
 * Phase 4 (Final Quality) completion contract.
 *
 * Finding D7-M8 (D7-SA7.3-3): Phase 4 completion criteria were scattered
 * across `rules/hatch3r-agent-orchestration.md` Phase 4 Validation Pass +
 * Specialist Success Criteria + per-command bodies, with no canonical typed
 * contract a caller could check programmatically. This interface aggregates
 * the criteria into a single record alongside `QualityResults` so consumers
 * read one structure to decide "is Phase 4 truly complete?". Mirrors the
 * `Phase 4 Validation Pass` semantics in the orchestration rule.
 *
 * Completion is `complete: true` only when ALL of the following hold:
 * 1. `validationPass.testsPass === true` AND `validationPass.typecheckPass === true`
 *    (test suite + type checker pass against the Phase 3 baseline cached in
 *    `PipelineContext.implementationResult.filesChanged`).
 * 2. `validationPass.regressionsPersist === false` (no Phase-4-introduced
 *    failures persist after up to `DEFAULT_MAX_VALIDATION_PASS_ITERATIONS`
 *    validation-pass fixer iterations per `rules/hatch3r-agent-orchestration.md`
 *    Phase 4 Validation Pass; see `VALIDATION_PASS_CALIBRATION` for the basis).
 * 3. `mandatoryFloorsSatisfied === true` (always-mode floor specialists —
 *    `hatch3r-security` and `hatch3r-testability` — returned `SUCCESS` per
 *    `rules/hatch3r-agent-orchestration.md` Specialist Success Criteria).
 * 4. `reReviewIterations <= 1` (at most one lightweight re-review after
 *    specialists produced code fixes, per Phase 4 Validation Pass; Critical
 *    findings trigger a single fixer pass).
 * 5. `unresolvedCriticalFindings === 0` (no Phase-4 specialist surfaced
 *    Critical-severity findings that were not resolved by the fixer pass).
 *    Derived by default from `qualityResults.specialists` (sum of each
 *    `SpecialistResult.criticalCount`) per Finding D7-19; an explicit
 *    `options.unresolvedCriticalFindings` overrides the derived sum.
 */
export interface Phase4CompletionContract {
  complete: boolean;
  /** Whether always-mode floor specialists (security + testability) succeeded. */
  mandatoryFloorsSatisfied: boolean;
  /** Number of lightweight reviewer re-reviews after specialist code fixes. */
  reReviewIterations: number;
  /** Critical findings still unresolved after the fixer pass. */
  unresolvedCriticalFindings: number;
  /**
   * Specialists that produced code mutations (not just findings) — used to
   * scope the Phase 4 Validation Pass re-review per the orchestration rule.
   */
  codeMutatingSpecialists: string[];
  /**
   * Reason the contract is `complete: false`, if applicable. Cited per
   * Charter directive 20 (proof_trace) — never report incompleteness without
   * naming which clause failed.
   */
  incompletionReason?: string;
}

/**
 * Evaluate the Phase 4 completion contract against a populated PipelineContext.
 *
 * Finding D7-M8: provides a single typed predicate the orchestrator (or a
 * downstream AI tool consuming the typed state-model) checks before declaring
 * Phase 4 complete. Pure function with no side effects; safe to call from
 * read-only contexts. Returns `complete: false` with `incompletionReason`
 * naming the first failing clause so callers can surface the gap to the user
 * without re-implementing the clause set.
 *
 * Finding D16-5 (D16, High): this predicate is the fail-closed authority the
 * `rules/hatch3r-agent-orchestration-detail.md` → "Phase Failure Protocols"
 * mandatory-CQ3/CQ5 row mirrors in prose. A mandatory always-mode floor
 * specialist (`hatch3r-security` CQ3, `hatch3r-testability` CQ5) that did not
 * return SUCCESS — including the TIMEOUT / crash / no-output case — sets
 * `mandatoryFloorsSatisfied: false`, which forces `complete: false`. Absence of
 * a floor specialist's `SpecialistResult` is treated identically (the `find`
 * returns `undefined`, never an implicit pass), so a security gate that times
 * out can never be reported as complete. The detail rule cites this function by
 * name so the prose and the typed gate are one authority, not two.
 */
export function evaluatePhase4Completion(
  qualityResults: QualityResults,
  options: {
    reReviewIterations?: number;
    unresolvedCriticalFindings?: number;
    codeMutatingSpecialists?: string[];
  } = {},
): Phase4CompletionContract {
  const reReviewIterations = options.reReviewIterations ?? 0;
  // Finding D7-19: derive the unresolved-Critical count from the typed
  // SpecialistResult records by default (sum of each specialist's criticalCount,
  // absent → 0). An explicit options.unresolvedCriticalFindings still wins so
  // callers holding a count from outside the SpecialistResult set can override,
  // but the gate no longer silently reports 0 when the specialists themselves
  // recorded Critical findings.
  const unresolvedCriticalFindings =
    options.unresolvedCriticalFindings ??
    qualityResults.specialists.reduce((sum, s) => sum + (s.criticalCount ?? 0), 0);
  const codeMutatingSpecialists = options.codeMutatingSpecialists ?? [];

  const securitySpec = qualityResults.specialists.find(
    (s) => s.specialist === "hatch3r-security",
  );
  const testabilitySpec = qualityResults.specialists.find(
    (s) => s.specialist === "hatch3r-testability",
  );
  const mandatoryFloorsSatisfied =
    securitySpec?.status === "SUCCESS" && testabilitySpec?.status === "SUCCESS";

  const v = qualityResults.validationPass;

  if (!v.testsPass) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason: "validationPass.testsPass === false",
    };
  }
  if (!v.typecheckPass) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason: "validationPass.typecheckPass === false",
    };
  }
  if (v.regressionsPersist) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason: "validationPass.regressionsPersist === true",
    };
  }
  if (!mandatoryFloorsSatisfied) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason:
        "mandatory floor specialist (hatch3r-security or hatch3r-testability) did not return SUCCESS",
    };
  }
  if (reReviewIterations > 1) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason:
        "Phase 4 Validation Pass re-review exceeded max 1 iteration (rules/hatch3r-agent-orchestration.md)",
    };
  }
  if (unresolvedCriticalFindings > 0) {
    return {
      complete: false,
      mandatoryFloorsSatisfied,
      reReviewIterations,
      unresolvedCriticalFindings,
      codeMutatingSpecialists,
      incompletionReason: `${unresolvedCriticalFindings} Critical finding(s) unresolved after Phase 4 fixer pass`,
    };
  }

  return {
    complete: true,
    mandatoryFloorsSatisfied,
    reReviewIterations,
    unresolvedCriticalFindings,
    codeMutatingSpecialists,
  };
}

export interface ReviewResult {
  iterations: number;
  finalVerdict: ReviewVerdict;
  findings: ReviewFinding[];
  confirmationPassResult: ConfirmationPassResult;
  /**
   * C8-D13-M1: Reviewer self-reported confidence (optional, backward-compatible).
   * Consumed by evaluateReviewGate in reviewLoop.ts.
   */
  confidence?: "high" | "medium" | "low";
}

/** Detected project type for specialist selection (Finding #56). */
export interface ProjectTypeContext {
  languages: string[];
  frameworks: string[];
  isMonorepo: boolean;
  packageManager: string;
}

/**
 * Variance budget for opt-in non-determinism handling.
 *
 * NOT-YET-AVAILABLE (Finding D7-22): this is a typed contract only. No runtime
 * reads it, the `varianceTracker.ts` reconciliation module it references does
 * not exist, and `--variance-runs=N` is NOT a registered CLI flag on any
 * command in `src/cli/commands/` — it names the intended opt-in surface for the
 * future module, not a flag a user can pass today. The N=3 sampling rule in
 * `agents/shared/quality-charter.md` §Non-Determinism Budget and the
 * `rules/hatch3r-agent-orchestration.md` Tier-to-Phase-4 mapping describe the
 * same not-yet-shipped control. Treat any `varianceBudget` value as inert until
 * `varianceTracker.ts` lands and a `--variance-runs` flag is registered.
 *
 * Finding D7-M10 / D7-SA7.4-3 (CL-2 spec for `varianceTracker.ts`). The audit
 * prompt (`governance/AUDIT.md` §Reproducibility) acknowledges LLM sampling
 * variance for findings; framework runtime orchestrators inherit no analogous
 * posture yet. This record is the CL-2 stub a future implementation will read —
 * `N` is the intended sample count (`1` = single-pass default at Tier 1/2),
 * `majorityVoteUsed` records whether the orchestrator already reached a
 * majority verdict and can short-circuit further runs. When the module ships,
 * Tier 3 with `floor:security` items will default to `N=3` on the always-mode
 * specialists per the quality charter; lower-stakes orchestrators stay `N=1`.
 */
export interface VarianceBudget {
  /** Sample count for variance reduction. `1` = single-pass default. */
  N: number;
  /** Whether a majority verdict was reached before all N runs completed. */
  majorityVoteUsed: boolean;
  /**
   * Reproducibility key components recorded when `N > 1` runs land — the
   * future `varianceTracker.ts` writes these per-run for replay audit.
   * Mirrors `rules/hatch3r-ai-evals.md` reproducibility key vocabulary.
   */
  reproducibilityKey?: {
    model: string;
    promptHash: string;
    seed?: number;
    temperature?: number;
  };
}

/**
 * Phase-level snapshot reference (Finding D7-SA7.1-F-9).
 *
 * Records which `src/pipeline/snapshot.ts` session captures the disk state at a
 * given phase exit, so the orchestrator can offer "roll back to Phase 3 clean"
 * (via `applyRollback(sessionId)`) instead of a whole-session restart when a
 * downstream phase fails. The orchestrator populates one entry as each phase
 * completes, calling `withSnapshot` / `createSnapshot` with a session id it
 * derives from `correlationId` + the phase number. The CLI itself never writes
 * this — it is part of the canonical handoff schema consumed by the host
 * coding tool and downstream pack integrators (see the module header).
 */
export interface SnapshotRef {
  /** Phase whose post-completion disk state this snapshot captures. */
  afterPhase: 1 | 2 | 3 | 4;
  /** Snapshot session id, restorable via `applyRollback(snapshotId)`. */
  snapshotId: string;
}

/**
 * Pending user-input request accumulated across phases (Finding D7-SA7.1-F-10).
 *
 * The shape mirrors the Plain-Text Fallback Template in
 * `agents/shared/user-question-protocol.md`: each request carries the options
 * and the mandatory default-if-no-response. Phases push a request here instead
 * of emitting a direct prompt when they need input; the orchestrator drains the
 * array between phases (paginating when more than 3 accumulate) so multiple
 * ASK checkpoints across a Tier 3 run can be batched rather than each rendered
 * independently. This is the cross-phase aggregation layer the per-question
 * protocol does not itself define.
 */
export interface PendingUserInput {
  phase: 1 | 2 | 3 | 4;
  /** Agent (or orchestrator step) that raised the request. */
  agent: string;
  /** One-sentence reason the input is needed. */
  reason: string;
  /** 2-4 candidate options per the user-question-protocol. */
  options: { label: string; value: string }[];
  /** Option `value` applied on non-response (lowest-blast-radius choice). */
  defaultIfNoResponse: string;
}

/**
 * Mid-run tier upgrade carrier (Finding D7-14).
 *
 * `deepContextTier` is a single pre-Phase-1 value. The Complexity-Driven
 * Adaptation table in `rules/hatch3r-agent-orchestration-detail.md` mandates
 * upgrading the tier mid-run when execution surfaces complexity the initial
 * score missed (e.g. Phase 1 research finds >10 affected files when the initial
 * estimate was <5). Without a typed carrier the upgraded tier lived only in the
 * orchestrator's prose reasoning and never reached the Tier→Phase-4-depth
 * mapping in `rules/hatch3r-agent-orchestration.md` (Deep Context Integration),
 * so Phase 4 specialist depth stayed pinned to the stale initial tier. This
 * record is that carrier: the orchestrator populates it when it adapts the tier,
 * `resolveEffectiveTier` reads it so downstream depth selection uses the
 * upgraded value, and `formatTierUpgradeNote` renders the one-line iteration-
 * summary surfacing so the adaptation is visible, not silent.
 */
export interface TierUpgrade {
  /** Tier the run started at (the pre-Phase-1 `deepContextTier`). */
  from: DeepContextTier;
  /** Tier the run was upgraded to mid-execution. */
  to: DeepContextTier;
  /**
   * Adaptation trigger naming the observed complexity signal, cited per
   * Charter directive 20 (never adapt silently). Matches a Complexity-Driven
   * Adaptation table row, e.g. "Phase 1 research found 12 affected files
   * (initial estimate <5)".
   */
  reason: string;
  /** Phase at which the upgrade was applied. */
  atPhase: 1 | 2 | 3 | 4;
}

/**
 * The PipelineContext is the canonical handoff object passed between
 * all four pipeline phases. Each phase populates its section.
 */
export interface PipelineContext {
  /** UUID v4, generated before Phase 1. */
  correlationId: string;
  taskType: TaskType;
  /** Issue number or null for plain chat. */
  issueRef: string | null;
  /** From hatch3r-deep-context scoring (the pre-Phase-1 baseline tier). */
  deepContextTier: DeepContextTier;

  /**
   * Mid-run tier upgrade applied by the orchestrator when execution surfaced
   * complexity the initial `deepContextTier` missed (Finding D7-14). Absent →
   * no adaptation occurred and `deepContextTier` is authoritative. When present,
   * `resolveEffectiveTier(context)` returns `tierUpgrade.to` so the Tier→
   * Phase-4-depth mapping uses the upgraded tier; `formatTierUpgradeNote` renders
   * the one-line iteration-summary surfacing.
   */
  tierUpgrade?: TierUpgrade;

  /** Detected project type for specialist selection (Finding #56). */
  projectType?: ProjectTypeContext;

  /**
   * Variance budget for opt-in non-determinism handling (CL-2 spec per
   * Finding D7-M10 / D7-SA7.4-3). `null` or absent → single-pass default;
   * non-null → opt-in sampled run per `agents/shared/quality-charter.md`
   * §Non-Determinism Budget.
   */
  varianceBudget?: VarianceBudget | null;

  // Phase 1 outputs (Research)
  researchFindings?: ResearchFindings;
  /** Research gap flags identified at mid-implementation checkpoint (Finding #52). */
  researchGaps?: string[];

  // Phase 2 outputs (Implementation)
  implementationResult?: ImplementationResult;

  // Phase 3 outputs (Review)
  reviewResult?: ReviewResult;

  // Phase 4 outputs (Quality)
  qualityResults?: QualityResults;

  /**
   * Per-phase snapshot references for phase-level rollback (Finding
   * D7-SA7.1-F-9). Populated by the orchestrator after each phase completes;
   * `null`/absent means no phase snapshots were captured (e.g. a dry run or a
   * Tier 1 carve-out). Enables "roll back to Phase N clean" instead of a full
   * session restart on a downstream-phase failure.
   */
  snapshotRefs?: SnapshotRef[];

  /**
   * User-input requests awaiting an answer, aggregated across phases (Finding
   * D7-SA7.1-F-10). Phases push to this array rather than emitting direct
   * prompts; the orchestrator drains it between phases. Empty/absent means no
   * phase is currently blocked on user input.
   */
  pendingUserInputs?: PendingUserInput[];

  // Metadata
  /** ISO-8601 timestamp. */
  startedAt: string;
  completedAt: string | null;
  /** Total duration in milliseconds. */
  totalDuration: number | null;
}

// ── Mid-run tier upgrade resolution (Finding D7-14) ──────────────

/**
 * Resolve the tier the orchestrator should drive downstream depth from.
 *
 * Finding D7-14: returns `tierUpgrade.to` when a mid-run upgrade is recorded,
 * else the baseline `deepContextTier`. The Tier→Phase-4-depth mapping in
 * `rules/hatch3r-agent-orchestration.md` (Deep Context Integration) MUST read
 * the effective tier via this function rather than `context.deepContextTier`
 * directly, so an upgrade applied at Phase 1 (e.g. research found >10 affected
 * files) actually raises Phase 4 specialist depth instead of leaving it pinned
 * to the stale initial score.
 *
 * Defensive: a malformed upgrade whose `to` is not a smaller-blast-radius
 * escalation above `from` (i.e. `to <= from`) is ignored — the carrier only
 * ever raises the tier, never silently lowers it, so a bad record cannot
 * downgrade quality coverage. Pure function with no I/O; safe to call from
 * read-only orchestrator paths.
 */
export function resolveEffectiveTier(
  context: Pick<PipelineContext, "deepContextTier" | "tierUpgrade">,
): DeepContextTier {
  const upgrade = context.tierUpgrade;
  if (upgrade && upgrade.to > context.deepContextTier) {
    return upgrade.to;
  }
  return context.deepContextTier;
}

/**
 * Render the one-line iteration-summary surfacing for a mid-run tier upgrade,
 * or `null` when no upgrade is recorded (Finding D7-14).
 *
 * The orchestrator appends the returned string to its iteration summary when a
 * tier upgrade occurred, so the adaptation is visible to the user rather than
 * silent. Mirrors the `formatPhaseHandoffWarning` surfacing pattern in
 * `src/pipeline/observability.ts`. A recorded-but-non-escalating upgrade
 * (`to <= from`, the same case `resolveEffectiveTier` ignores) returns `null`
 * so the two helpers agree on what counts as an effective upgrade. Pure
 * function; never throws.
 */
export function formatTierUpgradeNote(
  context: Pick<PipelineContext, "deepContextTier" | "tierUpgrade">,
): string | null {
  const upgrade = context.tierUpgrade;
  if (!upgrade || upgrade.to <= context.deepContextTier) {
    return null;
  }
  return (
    `Tier upgraded ${upgrade.from}→${upgrade.to} at Phase ${upgrade.atPhase}: ` +
    `${upgrade.reason} — Phase 4 specialist depth now scales to Tier ${upgrade.to}.`
  );
}

// ── Phase Skip Criteria (Finding #53) ────────────────────────────

/**
 * Consistent phase-skip criteria across all commands.
 *
 * Each phase has documented conditions under which it can be safely skipped.
 * Commands reference these criteria to maintain consistency.
 *
 * The "documentation-only" and "trivial single-line edit" conditions below are
 * backed by the programmatic predicates {@link isDocumentationOnly} /
 * {@link isTrivialChange} (Finding D7-SA7.1-F-4); the orchestrator resolves a
 * skip via {@link shouldSkipPhase} rather than re-classifying the diff in
 * prose. For Phase 4 specifically, a `true` documentation-only verdict makes
 * the phase fully skippable and the mandatory-minimum (testability + security)
 * does not apply, while a `false` verdict binds the mandatory-minimum —
 * dissolving the mixed-change ambiguity the prose table alone left open
 * (Finding D7-SA7.3-F-9).
 */
export interface PhaseSkipCriteria {
  phase: 1 | 2 | 3 | 4;
  phaseName: string;
  /** Conditions under which this phase can be safely skipped. */
  skipConditions: string[];
  /** What must always run even when the phase is "skipped". */
  mandatoryMinimum: string[];
}

export const PHASE_SKIP_CRITERIA: readonly PhaseSkipCriteria[] = [
  {
    phase: 1,
    phaseName: "Research",
    skipConditions: [
      "Trivial single-line edits (typo, comment, single-value config change)",
      "Task is classified as Tier 1 AND affects a single file with no cross-module impact",
      "Research was already performed in a prior invocation and results are cached in PipelineContext",
    ],
    mandatoryMinimum: [
      "Affected files must still be identified (even if via quick inline scan)",
      "Existing tests in the affected area must be noted",
    ],
  },
  {
    phase: 2,
    phaseName: "Implement",
    skipConditions: [
      "Never — implementation is always required when there are code changes",
    ],
    mandatoryMinimum: [
      "All code changes must go through hatch3r-implementer (never inline except trivial items in quick-change)",
    ],
  },
  {
    phase: 3,
    phaseName: "Review Loop",
    skipConditions: [
      "All items in the batch are classified as trivial (quick-change only)",
      "Change is documentation-only with no code modifications",
    ],
    mandatoryMinimum: [
      "Quality checks (lint, typecheck, test) must still pass",
      "Acceptance criteria must still be verified",
    ],
  },
  {
    phase: 4,
    phaseName: "Final Quality",
    skipConditions: [
      "Review loop (Phase 3) did not produce a clean verdict AND user chose to proceed manually",
      "Change is documentation-only with no code modifications",
      "All items are trivial AND quality checks pass (quick-change only)",
    ],
    mandatoryMinimum: [
      "testability and security specialists are always required for code changes regardless of command",
      "Quality checks must pass before completion",
    ],
  },
] as const;

// ── Specialist Trigger Table (Finding #55) ───────────────────────

/**
 * Phase 4 specialist trigger conditions.
 *
 * Defines when each specialist should be triggered based on the changes
 * made during implementation. The CQ3 security specialist owns dependency
 * file modifications (absorbing the legacy dependency-auditor scope per
 * F16.3-H1, Cycle 10 Wave 1C).
 */
export interface SpecialistTrigger {
  specialist: string;
  /**
   * When to trigger: "always", "evaluate", "conditional", or
   * "mandatory-on-match".
   *
   * "mandatory-on-match" matches exactly like "conditional" (same
   * triggerConditions / triggerFilePatterns / triggerPathGlobs evaluation) —
   * the difference is the dispatch obligation, not the matching. Conditional:
   * triggered ⇒ orchestrator-guided spawn. Mandatory-on-match: triggered ⇒
   * spawning a DEDICATED per-specialist sub-agent instance is a hard mandate
   * at deep-context Tier 2 and Tier 3 (skipping a triggered mandatory-on-match
   * specialist at Tier >= 2 is a gate failure); Tier 1 keeps its Phase Skip
   * Criteria skip. The tier gate lives in orchestrator prose
   * (`rules/hatch3r-agent-orchestration.md` → Tier-to-Phase-4 specialist depth
   * mapping) — this table stays tier-agnostic, and
   * {@link shouldTriggerSpecialist} surfaces `mandatory: true` on a match.
   */
  mode: "always" | "evaluate" | "conditional" | "mandatory-on-match";
  /** File patterns or conditions that trigger this specialist. */
  triggerConditions: string[];
  /**
   * Basename file patterns: either `*.<ext>` (matched against a file's
   * basename suffix) or an exact basename (e.g. `package.json`). Used for the
   * CQ3 security specialist's supply-chain manifests and the front-end CQ
   * specialists' component extensions.
   */
  triggerFilePatterns?: string[];
  /**
   * Path-segment globs that trigger this specialist when a changed file's path
   * contains the segment (Finding D7-20). A glob `seg/` matches any changed file
   * whose path has `seg` as a directory segment (e.g. `routes/` matches
   * `src/server/routes/auth.ts` and `app/routes.ts`). Backend specialists
   * (`hatch3r-reliability` CQ4, `hatch3r-scalability` CQ6, plus the backend
   * portions of CQ7/CQ8/CQ9) carry these so their `## Specialist Delegation`
   * agent-table triggers ("Service handlers", "Stateful handlers", connection
   * pools, migrations) actually fire on backend `.ts`/`.go`/`.py` surfaces —
   * which the basename-only `triggerFilePatterns` (`*.tsx`/`*.jsx`/`*.vue`/
   * `*.svelte`) could not reach. Matched by `shouldTriggerSpecialist` via a
   * directory-segment test, no external glob dependency.
   *
   * `readonly` so the shared `BACKEND_PATH_GLOBS` constant can be assigned
   * directly without a defensive copy; the matcher only ever reads it.
   */
  triggerPathGlobs?: readonly string[];
}

/**
 * Backend directory-segment globs shared by the CQ4/CQ6 (and backend CQ7-CQ9)
 * specialists (Finding D7-20). Each entry is a `<segment>/` glob the
 * {@link shouldTriggerSpecialist} path-segment matcher tests against a changed
 * file's directory segments. Kept as one named constant so the backend
 * specialists stay aligned and a future segment addition lands in one place.
 * Conservative by construction: only paths whose directory structure names a
 * server/data-tier concern match, so a pure front-end change does not trigger
 * a backend specialist.
 */
const BACKEND_PATH_GLOBS: readonly string[] = [
  "routes/",
  "route/",
  "handlers/",
  "controllers/",
  "controller/",
  "services/",
  "service/",
  "api/",
  "server/",
  "middleware/",
  "db/",
  "database/",
  "migrations/",
  "migration/",
  "repositories/",
  "queue/",
  "queues/",
  "workers/",
  "worker/",
  "jobs/",
];

export const SPECIALIST_TRIGGER_TABLE: readonly SpecialistTrigger[] = [
  {
    specialist: "hatch3r-docs-writer",
    mode: "evaluate",
    triggerConditions: [
      "Public API changes",
      "Architectural pattern changes",
      "User-facing behavior changes",
      "Specs or ADRs need updating",
    ],
  },
  {
    specialist: "hatch3r-lint-fixer",
    mode: "conditional",
    triggerConditions: ["Lint or type errors present after implementation"],
  },
  {
    specialist: "hatch3r-architect",
    mode: "conditional",
    triggerConditions: ["Architectural decisions needed", "New module or service introduced"],
  },
  {
    specialist: "hatch3r-devops",
    mode: "conditional",
    triggerConditions: ["CI/CD changes", "Infrastructure or deployment changes"],
  },
  // ── CQ1–CQ9 quality-vector specialists (Finding F7.3-C1 / KDD #22) ──
  // One per CONSTITUTION §2B content-quality pillar. Each specialist enforces
  // measurable floors on end-user generated code via Phase 4 dispatch.
  // F16.3-H1 (Cycle 10 Wave 1C): the 5 legacy meta-agents (test-writer,
  // security-auditor, a11y-auditor, perf-profiler, dependency-auditor) were
  // retired into their CQ successors (testability/security/ui/performance/
  // security respectively). The CQ specialists below now carry the always-mode
  // floor that test-writer + security-auditor previously enforced.
  {
    specialist: "hatch3r-ui",
    mode: "mandatory-on-match",
    triggerConditions: [
      "UI component files modified",
      "Design-token or theme files modified",
      "Component-library imports changed",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
      "tailwind.config.js",
      "tailwind.config.ts",
      "theme.ts",
    ],
  },
  {
    specialist: "hatch3r-ux",
    mode: "mandatory-on-match",
    triggerConditions: [
      "Flow / route-transition / modal / error-state files modified",
      "Microcopy or i18n strings modified",
      "Async-view wrappers modified",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
    ],
  },
  {
    specialist: "hatch3r-security",
    mode: "always",
    triggerConditions: [
      "Any code change (always-mode floor — absorbs legacy security-auditor scope)",
      "Auth / JWT / OAuth / WebAuthn code modified",
      "Release workflow modified",
      "Cookie / session handling modified",
      "Dependency files modified (absorbs legacy dependency-auditor scope)",
      "New dependency added",
      "Dependency version changed",
      "Lockfile modified",
    ],
    triggerFilePatterns: [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "go.mod",
      "go.sum",
      "Cargo.toml",
      "Cargo.lock",
      "requirements.txt",
      "Pipfile",
      "Pipfile.lock",
      "pyproject.toml",
      "poetry.lock",
      "Gemfile",
      "Gemfile.lock",
      "composer.json",
      "composer.lock",
      "pubspec.yaml",
      "pubspec.lock",
      "mix.exs",
      "mix.lock",
      "build.gradle",
      "build.gradle.kts",
      "pom.xml",
      "Package.swift",
      ".npmrc",
      ".nvmrc",
    ],
  },
  {
    specialist: "hatch3r-reliability",
    mode: "conditional",
    triggerConditions: [
      "Service handler / request handler modified",
      "OpenTelemetry / SLO / observability config modified",
      "Retry / circuit-breaker / error-format code modified",
      "Kubernetes probe / health-check manifests modified",
    ],
    // Finding D7-20: CQ4 owns service/request handlers — path-shaped surfaces
    // the basename patterns could not reach. Triggers on backend `.ts`/`.go`/
    // `.py` files under server/route/handler/service directory segments.
    triggerPathGlobs: BACKEND_PATH_GLOBS,
  },
  {
    specialist: "hatch3r-testability",
    mode: "always",
    triggerConditions: [
      "Any code change (always-mode floor — absorbs legacy test-writer scope)",
      "Test code added, modified, or removed",
      "Mandate-map feature class introduced (parser / payment / RPC / AI eval)",
      "Coverage threshold or test-runner config modified",
    ],
  },
  {
    specialist: "hatch3r-scalability",
    mode: "conditional",
    triggerConditions: [
      "Request handler / route definition modified",
      "Queue client / connection-pool config modified",
      "Session storage / cache layer modified",
      "Background-job / horizontally-scaled tier code modified",
    ],
    // Finding D7-20: CQ6 owns stateful handlers, queue producers/consumers, and
    // connection pools — backend path-shaped surfaces. Same segment set as CQ4.
    triggerPathGlobs: BACKEND_PATH_GLOBS,
  },
  {
    specialist: "hatch3r-performance",
    mode: "conditional",
    triggerConditions: [
      "ORM query / data-access layer modified",
      "UI-rendering component modified",
      "Bundle config or vendor dependency >50KB introduced",
      "Hot-path code modified",
    ],
    triggerFilePatterns: [
      "*.tsx",
      "*.jsx",
      "*.vue",
      "*.svelte",
    ],
    // Finding D7-20: CQ7 covers p95/p99-affecting backend code + N+1 / ORM
    // queries, not only LCP/INP/CLS front-end render paths. The frontend
    // basename patterns above stay; these reach the backend data-access tier.
    triggerPathGlobs: BACKEND_PATH_GLOBS,
  },
  {
    specialist: "hatch3r-maintainability",
    mode: "conditional",
    triggerConditions: [
      "Any code mutation (duplication-index + complexity scan)",
      "Schema or migration file modified",
      "API spec (OpenAPI / GraphQL SDL / Protobuf) modified",
    ],
    triggerFilePatterns: [
      "*.proto",
      "openapi.yaml",
      "openapi.json",
      "schema.graphql",
    ],
    // Finding D7-20: CQ8 expand-contract-migration scope is path-shaped — a
    // migration lives under a migrations/ directory regardless of basename, so
    // the basename API-spec patterns above could not reach it.
    triggerPathGlobs: ["migrations/", "migration/", "db/migrate/"],
  },
  {
    specialist: "hatch3r-enhancability",
    mode: "conditional",
    triggerConditions: [
      "User-visible behavior modified",
      "Public API surface modified (OpenAPI / GraphQL SDL / AsyncAPI)",
      "Config schema or feature-flag definition modified",
      "Extension-point interface modified",
    ],
    triggerFilePatterns: [
      "*.proto",
      "openapi.yaml",
      "openapi.json",
      "schema.graphql",
      "asyncapi.yaml",
    ],
  },
] as const;

// ── Project-type-aware specialist selection (Finding #56) ────────

/**
 * Language-specific specialist configurations.
 *
 * Maps detected project languages to additional specialist considerations
 * and dependency file patterns. Used by the orchestrator to make
 * project-type-aware specialist selections.
 */
export interface LanguageSpecialistConfig {
  language: string;
  /** Dependency files specific to this language ecosystem. */
  dependencyFiles: string[];
  /** Additional specialist hints for this language. */
  specialistHints: {
    specialist: string;
    hint: string;
  }[];
}

export const LANGUAGE_SPECIALIST_CONFIGS: readonly LanguageSpecialistConfig[] = [
  {
    language: "typescript",
    dependencyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Check for TypeScript strict mode violations and type errors" },
      { specialist: "hatch3r-testability", hint: "Use project test framework (vitest/jest); ensure type-safe test assertions" },
    ],
  },
  {
    language: "javascript",
    dependencyFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use project test framework (vitest/jest/mocha)" },
    ],
  },
  {
    language: "python",
    dependencyFiles: ["requirements.txt", "Pipfile", "Pipfile.lock", "pyproject.toml", "poetry.lock", "setup.py"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run ruff/flake8/mypy per project config" },
      { specialist: "hatch3r-testability", hint: "Use pytest; check for type annotations" },
      { specialist: "hatch3r-security", hint: "Check for pickle deserialization, SQL injection, SSTI" },
    ],
  },
  {
    language: "go",
    dependencyFiles: ["go.mod", "go.sum"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run golangci-lint; check for go vet warnings" },
      { specialist: "hatch3r-testability", hint: "Use standard testing package; check for table-driven tests" },
      { specialist: "hatch3r-security", hint: "Run govulncheck; check for unsafe pointer usage" },
    ],
  },
  {
    language: "rust",
    dependencyFiles: ["Cargo.toml", "Cargo.lock"],
    specialistHints: [
      { specialist: "hatch3r-lint-fixer", hint: "Run clippy with project-configured lints" },
      { specialist: "hatch3r-security", hint: "Run cargo-audit; check for unsafe blocks" },
    ],
  },
  {
    language: "java",
    dependencyFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use JUnit 5; check for integration test coverage" },
      { specialist: "hatch3r-security", hint: "Check for OWASP dependency-check findings" },
    ],
  },
  {
    language: "ruby",
    dependencyFiles: ["Gemfile", "Gemfile.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use RSpec or minitest per project convention" },
      { specialist: "hatch3r-security", hint: "Run bundler-audit; check for mass assignment" },
    ],
  },
  {
    language: "php",
    dependencyFiles: ["composer.json", "composer.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use PHPUnit per project convention" },
      { specialist: "hatch3r-security", hint: "Check for SQL injection, XSS, deserialization" },
    ],
  },
  {
    language: "swift",
    dependencyFiles: ["Package.swift", "Package.resolved"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use XCTest; check for async test patterns" },
    ],
  },
  {
    language: "dart",
    dependencyFiles: ["pubspec.yaml", "pubspec.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use flutter_test or test package" },
    ],
  },
  {
    language: "elixir",
    dependencyFiles: ["mix.exs", "mix.lock"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use ExUnit; check for doctest coverage" },
    ],
  },
  {
    language: "csharp",
    dependencyFiles: ["*.csproj", "*.sln", "Directory.Packages.props"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use xUnit/NUnit per project convention" },
      { specialist: "hatch3r-security", hint: "Check for SQL injection, CSRF, insecure deserialization" },
    ],
  },
  {
    language: "kotlin",
    dependencyFiles: ["build.gradle.kts", "build.gradle"],
    specialistHints: [
      { specialist: "hatch3r-testability", hint: "Use JUnit 5 or kotest per project convention" },
    ],
  },
] as const;

// ── Runtime Validation ───────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Optional advance-gate signals for {@link validatePhaseTransition}.
 *
 * Finding D7-10 / D7-11: the Phase 3 → 4 gate has two documented carve-outs the
 * field-presence checks alone could not express.
 */
export interface PhaseTransitionOptions {
  /**
   * Finding D7-10: when `reviewResult.finalVerdict === "UNRESOLVED"`, the
   * Phase 3 → 4 gate rejects the advance unless this is `true`. Mirrors the
   * `PHASE_SKIP_CRITERIA` Phase 4 skip condition "Review loop (Phase 3) did not
   * produce a clean verdict AND user chose to proceed manually": an unresolved
   * review is only allowed past the gate on an explicit user decision, so an
   * un-reviewed context can never pass the gate advertised as authoritative by
   * default.
   */
  allowUnresolvedAdvance?: boolean;
  /**
   * Finding D7-11: Phase 3 (Review) is skippable for documentation-only /
   * trivial changes per {@link PHASE_SKIP_CRITERIA} — no reviewer ran, so there
   * is no `reviewResult` and `iterations` is 0. When `true`, the Phase 3 → 4
   * gate accepts an absent `reviewResult` (and `iterations: 0` when a synthetic
   * SKIPPED result is supplied), the same carve-out the Phase 2 → 3 gate gives
   * research via `researchGaps`. Without this signal the gate continues to
   * require a reviewed context, so a skip is never granted implicitly.
   */
  phase3Skipped?: boolean;
}

/**
 * Validate that required PipelineContext fields are present for a given phase.
 *
 * Phase transitions require specific fields to be populated:
 * - Phase 1 -> 2: correlationId, taskType, deepContextTier, startedAt
 * - Phase 2 -> 3: researchFindings (unless research was skipped per skip criteria)
 * - Phase 3 -> 4: implementationResult, reviewResult (unless Phase 3 was skipped
 *   per `options.phase3Skipped` — Finding D7-11). An UNRESOLVED review verdict is
 *   rejected unless `options.allowUnresolvedAdvance` is set (Finding D7-10).
 * - Phase 4 -> completion: qualityResults
 */
export function validatePhaseTransition(
  context: Partial<PipelineContext>,
  targetPhase: 1 | 2 | 3 | 4 | "completion",
  options: PhaseTransitionOptions = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Always required
  if (!context.correlationId || typeof context.correlationId !== "string") {
    errors.push({ field: "correlationId", message: "correlationId must be a non-empty string (UUID v4)" });
  }
  if (!context.taskType || !["bug", "feature", "refactor", "qa"].includes(context.taskType)) {
    errors.push({ field: "taskType", message: 'taskType must be one of: "bug", "feature", "refactor", "qa"' });
  }
  if (!context.deepContextTier || ![1, 2, 3].includes(context.deepContextTier)) {
    errors.push({ field: "deepContextTier", message: "deepContextTier must be 1, 2, or 3" });
  }
  if (!context.startedAt || typeof context.startedAt !== "string") {
    errors.push({ field: "startedAt", message: "startedAt must be an ISO-8601 timestamp string" });
  }

  // Phase-specific requirements
  if (targetPhase === 2 || targetPhase === 3 || targetPhase === 4 || targetPhase === "completion") {
    // Phase 2+ needs research findings (or explicit gap acknowledgment)
    if (!context.researchFindings && (!context.researchGaps || context.researchGaps.length === 0)) {
      errors.push({
        field: "researchFindings",
        message: "researchFindings must be populated before Phase 2 (or researchGaps must document why research was skipped)",
      });
    }
  }

  if (targetPhase === 3 || targetPhase === 4 || targetPhase === "completion") {
    if (!context.implementationResult) {
      errors.push({ field: "implementationResult", message: "implementationResult must be populated before Phase 3" });
    } else {
      if (!AGENT_STATUS_VALUES.includes(context.implementationResult.status)) {
        errors.push({ field: "implementationResult.status", message: "implementationResult.status must be a valid AgentStatus" });
      }
    }
  }

  if (targetPhase === 4 || targetPhase === "completion") {
    if (!context.reviewResult) {
      // Finding D7-11: Phase 3 is skippable for documentation-only / trivial
      // changes (no reviewer ran ⇒ no reviewResult). Accept an absent
      // reviewResult only under the explicit phase3Skipped signal — the same
      // carve-out the Phase 2 → 3 gate gives research via researchGaps.
      if (!options.phase3Skipped) {
        errors.push({
          field: "reviewResult",
          message:
            "reviewResult must be populated before Phase 4 (or pass phase3Skipped when Phase 3 was skipped per PHASE_SKIP_CRITERIA)",
        });
      }
    } else {
      // Finding D7-11: when Phase 3 was skipped, a synthetic reviewResult may
      // carry iterations: 0 (no review loop ran). Require iterations >= 1 only
      // when Phase 3 actually ran.
      const minIterations = options.phase3Skipped ? 0 : 1;
      if (
        typeof context.reviewResult.iterations !== "number" ||
        context.reviewResult.iterations < minIterations
      ) {
        errors.push({
          field: "reviewResult.iterations",
          message: options.phase3Skipped
            ? "reviewResult.iterations must be a non-negative number (0 when Phase 3 was skipped)"
            : "reviewResult.iterations must be a positive number",
        });
      }
      if (!["CLEAN", "UNRESOLVED"].includes(context.reviewResult.finalVerdict)) {
        errors.push({ field: "reviewResult.finalVerdict", message: 'reviewResult.finalVerdict must be "CLEAN" or "UNRESOLVED"' });
      }
      // Finding D7-10: the Phase 3 → 4 advance gate (targetPhase === 4) must
      // reject an UNRESOLVED verdict unless the caller passes
      // allowUnresolvedAdvance, so an un-reviewed-clean context cannot pass the
      // gate the orchestration rule advertises as authoritative. The check is
      // scoped to targetPhase === 4 (the advance decision), not "completion".
      if (
        targetPhase === 4 &&
        context.reviewResult.finalVerdict === "UNRESOLVED" &&
        !options.allowUnresolvedAdvance
      ) {
        errors.push({
          field: "reviewResult.finalVerdict",
          message:
            'reviewResult.finalVerdict is "UNRESOLVED"; pass allowUnresolvedAdvance to advance to Phase 4 manually (PHASE_SKIP_CRITERIA Phase 4: review unresolved AND user chose to proceed)',
        });
      }
    }
  }

  if (targetPhase === "completion") {
    if (!context.qualityResults) {
      errors.push({ field: "qualityResults", message: "qualityResults must be populated at completion" });
    } else {
      if (!Array.isArray(context.qualityResults.specialists)) {
        errors.push({ field: "qualityResults.specialists", message: "qualityResults.specialists must be an array" });
      }
      if (!context.qualityResults.validationPass) {
        errors.push({ field: "qualityResults.validationPass", message: "qualityResults.validationPass must be populated" });
      }
    }
  }

  return errors;
}

/**
 * Source-file extensions a backend path-glob trigger applies to (Finding D7-20).
 * A path-segment match (e.g. `routes/`) only fires for a source file, so a
 * non-source artifact that happens to live under a backend directory (a README
 * in `routes/`, a fixture JSON, a snapshot) does not spuriously trigger a
 * backend specialist. Conservative toward NOT triggering on non-code.
 */
const BACKEND_SOURCE_SUFFIXES: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".go",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".rs",
  ".php",
  ".cs",
  ".scala",
  ".ex",
  ".exs",
  ".sql",
];

/**
 * True when `file`'s path contains `glob` as a directory segment (Finding
 * D7-20). `glob` is a `<segment>/` form; the match is on a normalized,
 * lower-cased path so `routes/` matches `src/server/routes/auth.ts`,
 * `app/Routes/Index.ts`, and a leading `routes/auth.ts`, but not a basename
 * substring like `myroutesfile.ts`. Pure helper, no I/O.
 */
function pathMatchesSegmentGlob(file: string, glob: string): boolean {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const segment = glob.toLowerCase();
  return normalized.startsWith(segment) || normalized.includes(`/${segment}`);
}

/**
 * Check whether a specialist should be triggered based on changed files
 * and project type context.
 *
 * Finding #55: dependency-auditor triggers on dependency file changes.
 * Finding #56: project-type-aware specialist selection.
 * Finding D7-20: backend specialists trigger on path-segment globs
 * (`triggerPathGlobs`) for source files under server/data-tier directories,
 * which the basename-only `triggerFilePatterns` could not reach.
 *
 * Release 2.2.0: a triggered `mandatory-on-match` specialist (hatch3r-ui CQ1 /
 * hatch3r-ux CQ2) returns `mandatory: true` — the orchestrator treats that
 * flag as a non-skippable dedicated-instance spawn at deep-context Tier 2/3
 * (tier gate is orchestrator prose; this predicate stays tier-agnostic).
 */
export function shouldTriggerSpecialist(
  specialist: string,
  changedFiles: string[],
  projectType?: ProjectTypeContext,
): { triggered: boolean; reasons: string[]; mandatory?: boolean } {
  const trigger = SPECIALIST_TRIGGER_TABLE.find((t) => t.specialist === specialist);
  if (!trigger) {
    return { triggered: false, reasons: [`Unknown specialist: ${specialist}`] };
  }

  // "always" mode specialists are always triggered for code changes.
  // F16.3-H1 (Cycle 10 Wave 1C): when an always-mode specialist also carries
  // triggerFilePatterns (e.g., hatch3r-security absorbed the legacy
  // dependency-auditor file-pattern scope), continue past the early-return so
  // the file-pattern + language-aware reasoning still annotates the result.
  if (trigger.mode === "always" && changedFiles.length > 0 && !trigger.triggerFilePatterns) {
    return { triggered: true, reasons: trigger.triggerConditions };
  }

  const reasons: string[] = [];
  // Always-mode specialists with file patterns: prepend the always-mode floor
  // reason so the conditional-pattern reasons add specificity on top.
  if (trigger.mode === "always" && changedFiles.length > 0) {
    reasons.push(...trigger.triggerConditions);
  }

  // Check file pattern triggers (e.g., dependency-auditor, CQ specialists)
  if (trigger.triggerFilePatterns) {
    const matchedFiles = changedFiles.filter((file) => {
      const basename = file.split("/").pop() ?? file;
      return trigger.triggerFilePatterns!.some((pattern) => {
        if (pattern.startsWith("*")) {
          return basename.endsWith(pattern.slice(1));
        }
        return basename === pattern;
      });
    });
    if (matchedFiles.length > 0) {
      const label =
        trigger.specialist === "hatch3r-security"
          ? "Dependency files modified"
          : "Trigger files modified";
      reasons.push(`${label}: ${matchedFiles.join(", ")}`);
    }
  }

  // Path-segment trigger globs (Finding D7-20). A backend source file under a
  // matched directory segment (e.g. src/server/routes/auth.ts) triggers the
  // backend specialists (reliability/scalability/performance/maintainability)
  // their basename-only triggerFilePatterns could not reach.
  if (trigger.triggerPathGlobs) {
    const matchedPaths = changedFiles.filter((file) => {
      const normalized = file.replace(/\\/g, "/").toLowerCase();
      const isSource = BACKEND_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
      if (!isSource) return false;
      return trigger.triggerPathGlobs!.some((glob) => pathMatchesSegmentGlob(file, glob));
    });
    if (matchedPaths.length > 0) {
      reasons.push(`Backend path-glob trigger: ${matchedPaths.join(", ")}`);
    }
  }

  // Project-type-aware trigger enhancement (Finding #56)
  // F16.3-H1 (Cycle 10 Wave 1C): hatch3r-security absorbed the legacy
  // dependency-auditor scope including language-aware dependency-file checks.
  if (projectType && trigger.specialist === "hatch3r-security") {
    const langConfigs = LANGUAGE_SPECIALIST_CONFIGS.filter((lc) =>
      projectType.languages.includes(lc.language),
    );
    for (const lc of langConfigs) {
      const langMatches = changedFiles.filter((file) => {
        const basename = file.split("/").pop() ?? file;
        return lc.dependencyFiles.some((pattern) => {
          if (pattern.startsWith("*")) {
            return basename.endsWith(pattern.slice(1));
          }
          return basename === pattern;
        });
      });
      if (langMatches.length > 0) {
        reasons.push(`${lc.language} dependency files modified: ${langMatches.join(", ")}`);
      }
    }
  }

  const triggered = reasons.length > 0;
  // Mandatory-on-match (2.2.0): same matching as "conditional"; a hit flags
  // the spawn as a hard mandate for the Tier 2/3 orchestrator gate.
  if (trigger.mode === "mandatory-on-match" && triggered) {
    return { triggered, reasons, mandatory: true };
  }
  return { triggered, reasons };
}

// ── Skip-decision predicates (Finding D7-SA7.1-F-4 / D7-SA7.3-F-9) ────

/**
 * Verdict returned by the programmatic skip-decision predicates. `canSkip`
 * is the machine-checkable answer the orchestrator records in the iteration
 * summary; `reason` is the human-readable justification (cited per Charter
 * directive 20 — never skip a phase without naming why).
 */
export interface SkipVerdict {
  canSkip: boolean;
  reason: string;
}

/**
 * File extensions + path prefixes treated as documentation rather than code.
 * Used by {@link isDocumentationOnly} to give `shouldSkipPhase`-style callers
 * a typed verdict instead of relying on the orchestrator LLM to re-classify a
 * diff under token pressure (Finding D7-SA7.1-F-4 causal chain: LLM mis-classifies
 * mixed docs+code as docs-only → review skipped on a code change → regression).
 *
 * Conservative by construction: anything NOT matching this allow-list counts as
 * a code modification, so the predicate fails safe toward running the phase.
 */
const DOC_FILE_SUFFIXES: readonly string[] = [
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".rst",
  ".adoc",
];

const DOC_PATH_PREFIXES: readonly string[] = ["docs/", "doc/"];

/**
 * Classify a change set as documentation-only by inspecting file paths against
 * a code-extension allow-list (Finding D7-SA7.1-F-4). Returns `canSkip: true`
 * only when EVERY changed file is documentation; a single code file flips the
 * verdict to `false`. An empty change set is not skippable (nothing to assert
 * about an unknown diff).
 *
 * Pure function with no I/O — safe to call from read-only orchestrator paths.
 * The orchestrator consults this at the Phase 3 / Phase 4 skip-decision boundary
 * (Finding D7-SA7.3-F-9): `canSkip === true` → the "documentation-only" skip
 * condition in {@link PHASE_SKIP_CRITERIA} is satisfied programmatically and the
 * Phase 4 mandatory-minimum (testability + security) does NOT apply; `canSkip
 * === false` → the change touches code, so the mandatory-minimum binds and the
 * docs-only skip is rejected. This dissolves the mixed-change ambiguity between
 * the skip condition and the mandatory-minimum that the prose table alone left open.
 */
export function isDocumentationOnly(filesChanged: string[]): SkipVerdict {
  if (filesChanged.length === 0) {
    return { canSkip: false, reason: "no changed files supplied; cannot assert documentation-only" };
  }
  const codeFiles = filesChanged.filter((file) => {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    const isDocByPrefix = DOC_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`));
    const isDocBySuffix = DOC_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
    return !(isDocByPrefix || isDocBySuffix);
  });
  if (codeFiles.length > 0) {
    return {
      canSkip: false,
      reason: `change touches ${codeFiles.length} non-documentation file(s): ${codeFiles.slice(0, 5).join(", ")}`,
    };
  }
  return { canSkip: true, reason: `all ${filesChanged.length} changed file(s) are documentation` };
}

/**
 * Classify a change set as trivial by file count + per-file churn (Finding
 * D7-SA7.1-F-4). A trivial change is at most one file with at most
 * {@link TRIVIAL_MAX_LINES} changed lines — the Tier 1 "single-line edit (typo,
 * comment, single-value config)" carve-out in {@link PHASE_SKIP_CRITERIA} made
 * programmatic. `linesChangedPerFile` maps a changed file to its added+removed
 * line count; a file absent from the map is treated as 0 changed lines.
 *
 * Pure function with no I/O. Fails safe: any file exceeding the line budget, or
 * more than one changed file, yields `canSkip: false`.
 */
export const TRIVIAL_MAX_LINES = 3;

export function isTrivialChange(
  filesChanged: string[],
  linesChangedPerFile: Record<string, number> = {},
): SkipVerdict {
  if (filesChanged.length === 0) {
    return { canSkip: false, reason: "no changed files supplied; cannot assert trivial change" };
  }
  if (filesChanged.length > 1) {
    return { canSkip: false, reason: `change spans ${filesChanged.length} files (>1); not trivial` };
  }
  const file = filesChanged[0];
  const lines = linesChangedPerFile[file] ?? 0;
  if (lines > TRIVIAL_MAX_LINES) {
    return { canSkip: false, reason: `${file} changed ${lines} lines (> ${TRIVIAL_MAX_LINES}); not trivial` };
  }
  return { canSkip: true, reason: `single file ${file} with ${lines} changed line(s)` };
}

/**
 * Resolve whether a given phase may be skipped for a change set, combining the
 * documented {@link PHASE_SKIP_CRITERIA} with the programmatic predicates above
 * (Finding D7-SA7.1-F-4 / D7-SA7.3-F-9). Only the predicate-backed skip
 * conditions are evaluated here — conditions that depend on runtime signals the
 * orchestrator holds (cached research, user-chose-manual, all-items-trivial in a
 * quick-change batch) remain the orchestrator's call and are reported as
 * `canSkip: false` with a reason pointing the orchestrator at the residual
 * decision so a skip is never granted on an unverified premise.
 *
 * Phase 2 is never skippable (returns `canSkip: false`). Phases 3 and 4 are
 * skippable when {@link isDocumentationOnly} holds; Phase 1 is additionally
 * skippable when {@link isTrivialChange} holds.
 */
export function shouldSkipPhase(
  phase: 1 | 2 | 3 | 4,
  filesChanged: string[],
  linesChangedPerFile: Record<string, number> = {},
): SkipVerdict {
  if (phase === 2) {
    return { canSkip: false, reason: "Phase 2 (Implement) is never skippable for code changes" };
  }
  const docsOnly = isDocumentationOnly(filesChanged);
  if (docsOnly.canSkip) {
    return { canSkip: true, reason: `documentation-only: ${docsOnly.reason}` };
  }
  if (phase === 1) {
    const trivial = isTrivialChange(filesChanged, linesChangedPerFile);
    if (trivial.canSkip) {
      return { canSkip: true, reason: `trivial change: ${trivial.reason}` };
    }
  }
  return {
    canSkip: false,
    reason: `${docsOnly.reason}; remaining skip conditions for Phase ${phase} require an orchestrator runtime decision (see PHASE_SKIP_CRITERIA)`,
  };
}

/**
 * Get language-specific specialist hints for the detected project type.
 *
 * Finding #56: project-type-aware specialist selection.
 * Returns hints that should be included in specialist prompts.
 */
export function getSpecialistHints(
  specialist: string,
  projectType: ProjectTypeContext,
): string[] {
  const hints: string[] = [];

  for (const lang of projectType.languages) {
    const config = LANGUAGE_SPECIALIST_CONFIGS.find((lc) => lc.language === lang);
    if (!config) continue;

    for (const hint of config.specialistHints) {
      if (hint.specialist === specialist) {
        hints.push(`[${lang}] ${hint.hint}`);
      }
    }
  }

  return hints;
}
