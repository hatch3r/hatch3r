/**
 * Review loop iteration state-model and decision contract.
 *
 * @library_export_only — typed state-model + decision contract for the
 * LLM-orchestrator-driven review loop. NOT invoked by any CLI command in the
 * `src/cli/commands/` tree (`grep -rn "enforceReviewIteration|recordReviewIteration|createReviewLoop" src/cli` returns zero matches; the only non-test importer outside this module is `src/pipeline/complianceVerification.ts`, which consumes only the constants `HARD_MAX_REVIEW_ITERATIONS` + `DEFAULT_MAX_REVIEW_ITERATIONS` for prompt-text parity scanning). These exports serve three documented consumers, in this order:
 *
 * 1. **The LLM orchestrator's prompt-driven loop body.** Phase 3 reviewer/fixer
 *    rounds are spawned via the Task tool under the prompt directives in
 *    `rules/hatch3r-agent-orchestration.md` (Phase 3 step 3) and the per-command
 *    loop bodies in `commands/hatch3r-*.md`. The iteration cap is enforced by
 *    the prompt directive, held in lockstep with `DEFAULT_MAX_REVIEW_ITERATIONS`
 *    by the rule-parity assertion in `reviewLoop.test.ts`.
 * 2. **Downstream pack integrators** that ship a real TypeScript loop driver —
 *    e.g., a Stop/PostToolUse hook refusing to spawn a further fixer pass past
 *    the cap, tracked as out-of-module work in F15.2-H1.
 * 3. **Unit-testable decision contracts** for governance proofs (oscillation
 *    detection, confidence derivation, gate evaluation, calibration record).
 *
 * Finding D7-M6 / D7-SA7.2-4 (Cycle 10): the prior "production caller required"
 * framing was retracted — the framework intentionally has no CLI loop driver
 * because Phase 3 execution happens inside Claude Code / Cursor, not inside
 * the CLI process. The library-only disposition above is the canonical answer.
 *
 * The module's prior execution-boundary note (Cycle 10, findings F7.2-H1 /
 * F15.2-H1) is rolled into the @library_export_only block above.
 *
 * Finding #76 (D15, High): Add iteration counter with programmatic enforcement.
 * Finding #68 (D13, High): Add iteration-count-based confidence signal to review gate output.
 * Finding C7.5-W2B2-H25 (D7-SA7.2-1, High): Capture the max-iteration
 *   calibration as a reproducible module artifact (`CALIBRATION`).
 * Finding C7.5-W2B2-H26 (D7-SA7.2-2, High): Raise DEFAULT_MAX_REVIEW_ITERATIONS
 *   from 3 to 4 so the oscillation detector is reachable in default config.
 * Finding C7.5-W2B2-H40 (D15-F15.2-02, High): Expose the iteration-gate
 *   decision functions (`enforceReviewIteration`, `assertReviewIterationAllowed`)
 *   as the canonical state-model the orchestrator's loop body is checked
 *   against — superseded by the library-only disposition above (D7-M6).
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HatchError, DEFAULT_CONFIDENCE_FLOOR, type ConfidenceFloor } from "../types.js";
import type { ReviewVerdict } from "./pipelineContext.js";

// ── Constants ────────────────────────────────────────────────────

/**
 * Default maximum review iterations before the loop must terminate.
 *
 * Calibration basis (Finding D7-16, Cycle 11): the cap is set from convergence
 * economics, NOT from oscillation-detector reachability. Published review-loop
 * literature (LLM self-correction / multi-agent debate) reports diminishing
 * returns past 2-3 correction rounds with most converging gains captured by
 * round 2; the default holds one round of headroom above that (round 4) so a
 * slow-but-converging change is not cut off prematurely, while the
 * `monotonic_divergence` escape (`recordReviewIteration`, Finding D7-17) and
 * the oscillation escape exit a non-converging loop earlier than the cap. The
 * earlier framing (raise 3->4 so the oscillation detector becomes reachable)
 * was circular — it justified the most user-impactful knob by a detector that
 * the knob itself made reachable. The detector is decoupled in Cycle 11:
 * `detectOscillation` now fires at `history.length >= 3` with
 * `directionChanges >= 1`, so it is reachable independent of this cap. See
 * `CALIBRATION.source` for the recorded basis and recalibration triggers.
 *
 * Opt-down: callers wanting the prior 3-iteration cap pass `createReviewLoop(3)`
 * (or any value in `[MIN_MAX_REVIEW_ITERATIONS, HARD_MAX_REVIEW_ITERATIONS]`).
 */
export const DEFAULT_MAX_REVIEW_ITERATIONS = 4;

/** Absolute ceiling -- even if configured higher, never exceed this. */
export const HARD_MAX_REVIEW_ITERATIONS = 10;

/**
 * Minimum value accepted by `createReviewLoop`. A max of 1 reduces to a
 * single-shot review (no fixer opportunity) which is still valid for
 * opt-down paths; a max of 0 is rejected as nonsensical (the loop must
 * run at least once).
 */
export const MIN_MAX_REVIEW_ITERATIONS = 1;

// ── Loop-Class Taxonomy (Findings D5-SA5.4-03 / D8-SA8.3-02, Cycle 12) ──

/**
 * Review-loop class — fixes which iteration cap a loop runs under.
 *
 * Before Cycle 12 the class semantics lived only in test comments
 * (`reviewLoop.test.ts` CAP_SURFACE_REGISTRY), so prose surfaces stated two
 * caps — "max 4 iterations" in the always-on orchestration rule vs "max 3
 * iterations (code-class cap)" in command bodies — with no shipped artifact
 * defining the classes or the selection rule (Finding D5-SA5.4-03). This
 * export is the shipped definition; the CAP_SURFACE_REGISTRY parity test
 * derives every prose cap surface from it.
 *
 * Selection rule (which class a loop is):
 * - `code` — the reviewer↔fixer loop runs over a CODE diff (implementation,
 *   bug fix, refactor). Command bodies opt down to
 *   `DEFAULT_MAX_REVIEW_ITERATIONS - 1` (3) because code reviews diverge
 *   faster — a fix can spawn a regression the next iteration must catch
 *   (rationale blocks: `commands/hatch3r-workflow.md` Phase 4a,
 *   `commands/hatch3r-board-fill.md` §7.9d). The opt-down is the documented
 *   `createReviewLoop(maxIterationsForClass("code"))` path.
 * - `spec` — the loop refines TEXT (issue specs, plans) against a checklist
 *   with no runtime regressions feeding back; converges slowly, so it keeps
 *   the full default (4). Example: `commands/hatch3r-board-fill.md` §7.9d.
 * - `default` — the generic Phase-3 pipeline bound the orchestration rule,
 *   the reviewer/fixer agents ("After 4 review-fix cycles"), and this state
 *   model enforce (4).
 *
 * Finding D8-SA8.3-02: the detail rule asserted "code-class cap =
 * `DEFAULT_MAX_REVIEW_ITERATIONS` - 1" while no code implemented that
 * arithmetic — the −1 was prose-only, and the detail rule's schema comment
 * claimed the `iterations` field maxes at 3 while `canContinueReview` (which
 * has no class branch) lets it reach 4. Resolution: the detail rule now
 * states the single pipeline bound (4), and this record IS the code backing
 * for the command-level code-class opt-down — the −1 is derived here, not
 * asserted in prose.
 */
export type ReviewLoopClass = "code" | "spec" | "default";

/**
 * Per-class iteration caps — the single derivation point for every prose cap
 * surface (Findings D5-SA5.4-03 / D8-SA8.3-02). A command body passes
 * `maxIterationsForClass(<class>)` to `createReviewLoop` instead of
 * hardcoding an integer; the parity test in `reviewLoop.test.ts` holds every
 * cap-stating `.md` surface in lockstep with this record.
 */
export const REVIEW_LOOP_CLASS_CAPS: Readonly<Record<ReviewLoopClass, number>> =
  Object.freeze({
    code: DEFAULT_MAX_REVIEW_ITERATIONS - 1,
    spec: DEFAULT_MAX_REVIEW_ITERATIONS,
    default: DEFAULT_MAX_REVIEW_ITERATIONS,
  });

/**
 * Iteration cap for a loop class — the value a command body passes to
 * `createReviewLoop` when it opts down (code class) or keeps the default
 * (spec / generic pipeline loops). See {@link ReviewLoopClass} for the
 * selection rule.
 */
export function maxIterationsForClass(loopClass: ReviewLoopClass): number {
  return REVIEW_LOOP_CLASS_CAPS[loopClass];
}

/**
 * Minimum recorded iterations before the `monotonic_divergence` escape can
 * fire (Finding D7-17). Three entries are required so a strictly-increasing
 * series (`[a,b,c]` with `a < b < c`) is two consecutive worsening steps, not
 * a single noisy uptick after one good pass — matching the
 * "reaches iteration 2 with increasing Critical count" trigger in
 * `rules/hatch3r-agent-orchestration-detail.md` while requiring the trend to
 * persist for a second step before halting.
 */
export const MIN_DIVERGENCE_HISTORY = 3;

/**
 * Operator-facing message attached to a `divergence` termination (Finding
 * D7-17). Classifies the strictly-worsening loop as a complexity underestimate
 * and recommends the same remediation as the detail-rule failure-mode row:
 * break the task into smaller sub-tasks. Kept as a named constant so the
 * `reviewLoopSummary` text and any downstream consumer cite identical wording.
 */
export const DIVERGENCE_MESSAGE =
  "complexity underestimate: findings count rose every review pass (fixer is making the change strictly worse); break the task into smaller sub-tasks and re-run";

/**
 * Default cumulative-token-spend ceiling per maturity tier for the
 * cost-budget escape (Finding D7-SA7.2-F-5). Solo-tier users carry the
 * smallest token tolerance (Decision 4), so the default budget tightens as
 * the tier narrows. A caller resolves its active tier and passes the matching
 * value as `createReviewLoop`'s `costBudgetTokens` argument; passing
 * `undefined` (the default) disables the cost-ceiling escape entirely, so the
 * behaviour is opt-in and fully backward-compatible with the iteration-only
 * cap. Units are total input+output tokens summed across review-fix
 * iterations; integrate with `src/pipeline/costEstimator.ts` to convert the
 * pre-execution estimate into the ceiling.
 */
export const DEFAULT_COST_BUDGET_TOKENS_BY_TIER: Readonly<
  Record<"solo" | "team" | "scaleup" | "enterprise", number>
> = Object.freeze({
  solo: 200_000,
  team: 600_000,
  scaleup: 1_200_000,
  enterprise: 2_400_000,
});

/**
 * Reproducible calibration record for `DEFAULT_MAX_REVIEW_ITERATIONS`.
 *
 * Finding C7.5-W2B2-H25 (D7-SA7.2-1): The prior comment-only calibration
 * (78/18/4% iteration split across cycles 3-4) was unreproducible — no
 * captured dataset, no rerun path. Per the Scientific Rigor Contract
 * (`agents/shared/rigor-contract.md`) empirical claims must
 * be triangulated and reproducible, or downgraded to informed estimate.
 *
 * This record downgrades the claim to **informed_estimate** and records:
 * - the exact claim (for future measurement comparison)
 * - the source (synthesis doc + registry location where re-derivation
 *   would occur when per-finding iteration counts are recorded)
 * - the measurement method a future implementer would use to replace the
 *   estimate with measured data
 * - recalibration triggers that, if observed at runtime, invalidate the
 *   current default
 *
 * When iteration-count telemetry is added to `finding-registry.json`
 * (tracked as a Phase-5 candidate), a calibration script can emit the
 * measured split and promote `basis` from "informed_estimate" to
 * "measured", with `measuredAt` populated.
 */
export interface IterationSplitClaim {
  /** Fraction of review loops that pass clean on iteration 1. */
  iteration1CleanRate: number;
  /** Fraction needing exactly 2 iterations. */
  iteration2CleanRate: number;
  /** Fraction needing 3 iterations. */
  iteration3CleanRate: number;
  /** Fraction exceeding 3 iterations (oscillation-prone tail). */
  iteration4PlusRate: number;
}

export interface ReviewLoopCalibration {
  /** Whether the split is measured from data or an informed estimate. */
  readonly basis: "measured" | "informed_estimate";
  /** Source dataset identifier for re-derivation. */
  readonly source: string;
  /** Number of observations underlying the claim (0 when basis=informed_estimate). */
  readonly sampleSize: number;
  /** ISO date of most recent measurement (null when basis=informed_estimate). */
  readonly measuredAt: string | null;
  /** The claimed iteration-split distribution. */
  readonly split: Readonly<IterationSplitClaim>;
  /**
   * Observable conditions under which the current default must be re-derived.
   * If any trigger is observed in production, the default is not safe.
   */
  readonly recalibrationTriggers: Readonly<{
    /** Re-derive if iteration-1 clean rate falls below this value. */
    iteration1CleanRateBelow: number;
    /** Re-derive if oscillation detector fires on more than this fraction of runs. */
    oscillationRateAbove: number;
  }>;
  /** Path (relative to repo root) documenting the measurement method. */
  readonly measurementMethodRef: string;
}

export const CALIBRATION: Readonly<ReviewLoopCalibration> = Object.freeze({
  basis: "informed_estimate",
  // Honest non-citation per Charter directive 20 — no historical iteration-
  // count dataset exists. The pre-Cycle-10 phrasing "cycles 3-4 aggregate"
  // implied a re-derivable source that does not exist (Finding D7-M4 /
  // D7-SA7.2-1). When iteration-count telemetry lands per the CL-2 spec
  // below, replace this with the path to the produced dataset.
  //
  // Cap basis (Finding D7-16): the iteration cap derives from convergence
  // economics — review-loop literature reports most self-correction gains by
  // round 2 with diminishing returns past round 3, so the cap holds one round
  // of headroom (4) over the convergence knee while the divergence + oscillation
  // escapes exit non-converging loops earlier. It is NOT derived from
  // detectOscillation reachability (that was the circular pre-Cycle-11 basis).
  source:
    "cap basis = convergence economics (most self-correction gains by round 2, diminishing returns past round 3; cap = knee + 1 round headroom); iteration-split below is informed_estimate (no historical dataset) pending iteration-count telemetry (CL-2 spec in measurementMethodRef) (D7-16)",
  sampleSize: 0,
  measuredAt: null,
  split: Object.freeze({
    iteration1CleanRate: 0.78,
    iteration2CleanRate: 0.18,
    iteration3CleanRate: 0.04,
    iteration4PlusRate: 0.0,
  }),
  recalibrationTriggers: Object.freeze({
    iteration1CleanRateBelow: 0.6,
    oscillationRateAbove: 0.1,
  }),
  // CL-2 iteration-count telemetry status (spec: Finding D7-M4 / D7-SA7.2-1,
  // Cycle 10; ledger + script built Cycle 12, Finding D7-SA7.2-01; runtime
  // sink built Cycle-12 CL-2 unit U10, Finding D7-SA7.2-04):
  // BUILT — (1) typed runtime iteration ledger: `ReviewLoopLedgerEntry`
  //     (JSONL; `reviewLoopLedgerEntry` + `serializeReviewLoopLedgerEntry`
  //     produce lines, `parseReviewLoopLedger` reads them,
  //     `deriveIterationSplit` computes the measured split). Ledger entries
  //     supersede the originally specced per-finding registry columns as the
  //     data source: the Cycle-10 spec named the audit finding registry,
  //     which would have measured AUDIT loops, not product loops
  //     (D7-SA7.2-04) — the loop is the calibration unit.
  //     (2) `scripts/calibrate-review-loop.ts` — reads the ledger
  //     (default `.hatch3r/review-loop-metrics.jsonl`), emits the
  //     measured split vs this estimate, and prints the candidate
  //     CALIBRATION update once sampleSize >= CALIBRATION_SAMPLE_THRESHOLD.
  //     (3) runtime loop-exit sink: `appendReviewLoopTelemetry` appends one
  //     record per terminated loop to `.hatch3r/review-loop-metrics.jsonl`
  //     (REVIEW_LOOP_METRICS_RELPATH), never throwing — see the function's
  //     JSDoc for the append-vs-atomic-rename rationale + failure isolation.
  // REMAINING — (4) prompt-side emission wiring on the orchestrator surfaces
  //     (the @library_export_only boundary means the prompt-driven runtime
  //     must be instructed to emit the line; cross-ref D7-SA7.2-03), then
  //     accumulate to the 30-sample threshold and promote `basis` to
  //     `"measured"` + set `measuredAt` from the script's candidate block.
  //     (5) Recalibration cadence: re-run the script at every cycle close and
  //     release prep, and whenever a recalibrationTrigger is observed.
  measurementMethodRef:
    "runtime review-loop telemetry ledger (ReviewLoopLedgerEntry JSONL at .hatch3r/review-loop-metrics.jsonl, appended at loop exit via appendReviewLoopTelemetry) + scripts/calibrate-review-loop.ts; promote basis at CALIBRATION_SAMPLE_THRESHOLD (30) samples (D7-M4 / D7-SA7.2-1 / D7-SA7.2-01 / D7-SA7.2-04)",
});

// ── Types ────────────────────────────────────────────────────────

/**
 * Per-iteration reviewer verdict (lowercase three-level scale).
 *
 * Finding D7-12: this type was named `ReviewVerdict`, colliding with the
 * handoff-level `ReviewVerdict` (`"CLEAN" | "UNRESOLVED"`) exported from
 * `pipelineContext.ts` — two `src/pipeline/` exports under one name with
 * incompatible value sets and casing, and no mapper between them. Renamed to
 * `ReviewIterationVerdict` so the two scales are distinct at the type level;
 * `iterationVerdictToHandoffVerdict` below collapses an iteration verdict to the
 * handoff verdict the `ReviewResult.finalVerdict` slice carries.
 *
 * The handoff-level `ReviewVerdict` is now the only `src/pipeline/` export under
 * that name; map between the two scales with {@link iterationVerdictToHandoffVerdict}.
 */
export type ReviewIterationVerdict = "clean" | "warning" | "critical";

/**
 * Collapse a per-iteration reviewer verdict ({@link ReviewIterationVerdict},
 * lowercase three-level) to the handoff verdict the `ReviewResult.finalVerdict`
 * slice carries (`ReviewVerdict` from `pipelineContext.ts`, `"CLEAN" |
 * "UNRESOLVED"`).
 *
 * Finding D7-12: the two scales previously shared the name `ReviewVerdict` with
 * incompatible value sets and no conversion, so the review loop's terminal
 * iteration verdict could not be written into the handoff context without an
 * ad-hoc inline cast. This mapper is the single typed bridge: only a `"clean"`
 * iteration verdict (0 critical + 0 warning findings) maps to `"CLEAN"`; both
 * `"warning"` and `"critical"` map to `"UNRESOLVED"` — fail-closed toward
 * "unresolved" so an unhandled future variant could never silently report a
 * clean handoff. Pure function with no I/O.
 */
export function iterationVerdictToHandoffVerdict(
  verdict: ReviewIterationVerdict,
): ReviewVerdict {
  return verdict === "clean" ? "CLEAN" : "UNRESOLVED";
}

/**
 * Confidence signal derived from review loop iteration count.
 *
 * Finding #68 (D13, High): More iterations = lower confidence that the fix
 * is correct, because repeated review-fix cycles indicate the change is
 * difficult to get right.
 */
export type ReviewConfidenceLevel = "high" | "medium" | "low";

export interface ReviewIterationEntry {
  iteration: number;
  verdict: ReviewIterationVerdict;
  findingsCount: number;
  timestamp: string;
}

/**
 * Terminal reasons a review loop can stop with — the runtime source of truth
 * for `ReviewLoopState.terminationReason` and for the iteration-ledger
 * parser's field validation (Finding D7-SA7.2-01). Per-value semantics are
 * documented on {@link ReviewLoopState.terminationReason}.
 */
export const REVIEW_LOOP_TERMINATION_REASONS = Object.freeze([
  "clean",
  "max_iterations",
  "manual",
  "oscillation",
  "design_objection",
  "cost_budget_exceeded",
  "divergence",
] as const);

export type ReviewLoopTerminationReason =
  (typeof REVIEW_LOOP_TERMINATION_REASONS)[number];

export interface ReviewLoopState {
  /** Current iteration number (1-based). */
  currentIteration: number;
  /** Maximum iterations allowed. */
  maxIterations: number;
  /** Whether the loop has been terminated. */
  terminated: boolean;
  /**
   * Reason for termination, if terminated.
   *
   * - `clean`: reviewer returned a clean verdict (0 critical + 0 warning).
   * - `max_iterations`: iteration cap reached with unresolved findings.
   * - `manual`: external caller terminated the loop early (user cancel, timeout).
   * - `oscillation`: `detectOscillation()` reported a fix-break cycle; the
   *   orchestrator halts the loop before the iteration cap so the conflict
   *   pattern surfaces earlier. Matches the "Forced termination — oscillation"
   *   semantics in `commands/hatch3r-board-fill.md` step 7.9d (Finding D7-M5 /
   *   D7-SA7.2-2).
   * - `design_objection`: reviewer emitted a `DESIGN_OBJECTION` verdict (the
   *   premise itself is broken); halt the loop and surface the objection for
   *   user clarification. Mirrors the board-fill forced-termination case and
   *   the `BLOCKED_PREMISE_CHALLENGE` agent status in `pipelineContext.ts`.
   * - `cost_budget_exceeded`: the cumulative token spend across review-fix
   *   iterations crossed the configured `costBudgetTokens` ceiling before a
   *   clean verdict. The loop halts early so a small number of expensive
   *   non-converging findings cannot run the full iteration cap at runaway
   *   cost (Finding D7-SA7.2-F-5). Complements the iteration ceiling: count is
   *   bounded by `maxIterations`, spend is bounded by `costBudgetTokens`.
   * - `divergence`: the findings count rose strictly monotonically across the
   *   last `MIN_DIVERGENCE_HISTORY` recorded iterations (the fixer is making
   *   the change strictly worse every pass, e.g. `[2,3,4,5]`). The loop halts
   *   before the iteration cap and surfaces the complexity-underestimate
   *   recommendation (break the task into smaller sub-tasks). This is the
   *   strictly-diverging case `detectOscillation` cannot catch — a monotone
   *   series has 0 direction changes — so it is detected by trend analysis
   *   (`calculateFindingsTrend`) instead (Finding D7-17). Mirrors the
   *   "Phase 3 review loop reaches iteration 2 with increasing Critical count
   *   -> complexity underestimate" row in
   *   `rules/hatch3r-agent-orchestration-detail.md`.
   */
  terminationReason?: ReviewLoopTerminationReason;
  /** History of review iterations. */
  history: ReviewIterationEntry[];
  /** Unresolved findings after loop termination. */
  unresolvedFindings: number;
  /**
   * Cumulative review-fix token spend across all recorded iterations.
   * Advanced by the optional `tokensUsedThisIteration` argument to
   * `recordReviewIteration` / `enforceReviewIteration`. `0` when callers do
   * not supply per-iteration spend (cost-ceiling escape inactive).
   * Finding D7-SA7.2-F-5.
   */
  tokensUsedTotal: number;
  /**
   * Optional cumulative-token-spend ceiling for the loop. When set and
   * `tokensUsedTotal` exceeds it after an iteration, the loop terminates with
   * `terminationReason: "cost_budget_exceeded"`. `undefined` disables the
   * cost-ceiling escape (iteration cap remains the only bound).
   * Finding D7-SA7.2-F-5.
   */
  costBudgetTokens?: number;
  /**
   * Iteration-count-based confidence signal.
   * Populated when the loop terminates.
   * Finding #68 (D13, High).
   */
  confidence?: ReviewConfidenceLevel;
}

// ── Confidence Signal ────────────────────────────────────────────

/**
 * Derive a confidence level from the review loop state.
 *
 * Finding #68 (D13, High): Confidence decreases with more iterations.
 * The rationale is that repeated review-fix cycles indicate the change
 * is harder to get right, warranting more human scrutiny.
 *
 * - **high**: Clean on first pass (iteration 1). The fix was straightforward
 *   and correct on the first attempt.
 * - **medium**: Clean on second pass (iteration 2). Required one round of
 *   fixes, which is normal for moderately complex changes.
 * - **low**: Required 3+ iterations or terminated at max iterations with
 *   unresolved findings. The change may need additional human review.
 */
export function reviewLoopConfidence(state: ReviewLoopState): ReviewConfidenceLevel {
  // If terminated at max iterations with unresolved findings, always low
  if (state.terminationReason === "max_iterations") return "low";

  // Manual termination — unknown state, default to low
  if (state.terminationReason === "manual") return "low";

  // Oscillation / design_objection — fixer is unable to converge or the
  // premise is broken; surface as low confidence so downstream gates escalate.
  if (state.terminationReason === "oscillation") return "low";
  if (state.terminationReason === "design_objection") return "low";

  // Cost-budget exceeded — the loop halted on spend, not on a clean verdict;
  // unresolved findings remain, so confidence is low (Finding D7-SA7.2-F-5).
  if (state.terminationReason === "cost_budget_exceeded") return "low";

  // Divergence — the fixer strictly worsened the change every pass; this is the
  // weakest convergence signal of all, so confidence is low (Finding D7-17).
  if (state.terminationReason === "divergence") return "low";

  // Confidence based on iteration count when terminated cleanly
  if (state.currentIteration <= 1) return "high";
  if (state.currentIteration <= 2) return "medium";
  return "low";
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Create a new review loop state with configurable max iterations and an
 * optional cumulative-token-spend ceiling.
 *
 * The max is clamped to [MIN_MAX_REVIEW_ITERATIONS, HARD_MAX_REVIEW_ITERATIONS]
 * to prevent misconfiguration from causing runaway loops or zero-iteration
 * bypasses. Callers that want the pre-Cycle-7.5 default of 3 pass `3`
 * explicitly (see Finding C7.5-W2B2-H26 for the rationale for raising the
 * default to 4).
 *
 * `costBudgetTokens` (Finding D7-SA7.2-F-5) is the optional cumulative
 * token-spend ceiling. When supplied (e.g. a value from
 * {@link DEFAULT_COST_BUDGET_TOKENS_BY_TIER} resolved from the active maturity
 * tier, or a `costEstimator` pre-execution figure), the loop terminates with
 * `cost_budget_exceeded` once `tokensUsedTotal` crosses it. Omitting it (the
 * default) leaves the iteration cap as the only bound — fully backward
 * compatible. A non-positive or non-finite budget is treated as "no ceiling".
 */
export function createReviewLoop(
  maxIterations: number = DEFAULT_MAX_REVIEW_ITERATIONS,
  costBudgetTokens?: number,
): ReviewLoopState {
  const clamped = Math.max(
    MIN_MAX_REVIEW_ITERATIONS,
    Math.min(maxIterations, HARD_MAX_REVIEW_ITERATIONS),
  );
  const state: ReviewLoopState = {
    currentIteration: 0,
    maxIterations: clamped,
    terminated: false,
    history: [],
    unresolvedFindings: 0,
    tokensUsedTotal: 0,
  };
  // Only attach a budget when it is a usable positive ceiling; a non-finite
  // or <= 0 value disables the cost-ceiling escape (treated as "no ceiling").
  if (typeof costBudgetTokens === "number" && Number.isFinite(costBudgetTokens) && costBudgetTokens > 0) {
    state.costBudgetTokens = costBudgetTokens;
  }
  return state;
}

/**
 * Check whether the review loop can continue to the next iteration.
 *
 * Returns false if:
 * - The loop has been terminated (clean verdict or max iterations reached)
 * - The current iteration count has reached the maximum
 */
export function canContinueReview(state: ReviewLoopState): boolean {
  if (state.terminated) return false;
  return state.currentIteration < state.maxIterations;
}

/**
 * Whether the tail of the iteration history is strictly monotonically
 * increasing in findings count over the last `MIN_DIVERGENCE_HISTORY` entries
 * (Finding D7-17). A `true` result means every recent pass had MORE findings
 * than the one before it — the fixer is strictly worsening the change, the
 * documented complexity-underestimate failure mode. A flat step (`==`) or any
 * decrease breaks the run and returns `false`; that case is healthy
 * convergence or non-monotone churn (handled by `detectOscillation`).
 *
 * Distinct from `calculateFindingsTrend`, which only compares the final two
 * entries: divergence requires the worsening to persist across the whole tail
 * window so a single uptick after a clean run does not abort a recoverable loop.
 */
function isMonotonicDivergence(history: ReviewIterationEntry[]): boolean {
  if (history.length < MIN_DIVERGENCE_HISTORY) return false;
  const tail = history.slice(-MIN_DIVERGENCE_HISTORY);
  for (let i = 1; i < tail.length; i++) {
    if (tail[i].findingsCount <= tail[i - 1].findingsCount) return false;
  }
  return true;
}

/**
 * Record a review iteration result and advance the counter.
 *
 * If the verdict is "clean", the loop terminates successfully.
 * If max iterations is reached with unresolved findings, the loop
 * terminates and surfaces remaining findings to the user.
 *
 * `tokensUsedThisIteration` (Finding D7-SA7.2-F-5) is the optional token spend
 * for the iteration being recorded. It accumulates into `state.tokensUsedTotal`.
 * When the loop carries a `costBudgetTokens` ceiling and the running total
 * crosses it on a non-clean verdict, the loop terminates early with
 * `cost_budget_exceeded` — bounding spend the way `maxIterations` bounds count.
 * Omitting the argument leaves spend tracking at 0 and the cost-ceiling escape
 * inactive (backward compatible).
 *
 * Monotonic-divergence escape (Finding D7-17): when the findings count rose
 * strictly every pass over the last `MIN_DIVERGENCE_HISTORY` iterations (the
 * fixer is strictly worsening the change), the loop terminates early with
 * `divergence` and surfaces the complexity-underestimate recommendation rather
 * than burning the remaining budget on a loop that is provably not converging.
 * This is the strictly-diverging case `detectOscillation` cannot see (a monotone
 * series has 0 direction changes). The check runs after the clean and
 * max-iterations gates (a converged or naturally capped loop keeps its own
 * reason) and before the cost-budget gate (divergence is a stronger
 * non-convergence signal than spend).
 *
 * Throws if the loop has already terminated or would exceed max iterations.
 */
export function recordReviewIteration(
  state: ReviewLoopState,
  verdict: ReviewIterationVerdict,
  findingsCount: number,
  tokensUsedThisIteration: number = 0,
): ReviewLoopState {
  if (state.terminated) {
    throw new HatchError(
      `Review loop already terminated (reason: ${state.terminationReason}). ` +
      `Cannot record iteration ${state.currentIteration + 1}.`,
      1,
      "VALIDATION_ERROR",
    );
  }

  if (state.currentIteration >= state.maxIterations) {
    throw new HatchError(
      `Review loop at maximum iterations (${state.maxIterations}). ` +
      `Call terminateReviewLoop() to finalize.`,
      1,
      "VALIDATION_ERROR",
    );
  }

  const nextIteration = state.currentIteration + 1;
  const entry: ReviewIterationEntry = {
    iteration: nextIteration,
    verdict,
    findingsCount,
    timestamp: new Date().toISOString(),
  };

  // Accumulate spend. A negative or non-finite per-iteration value contributes
  // 0 so a malformed input cannot reduce the running total below its prior value.
  const iterSpend =
    Number.isFinite(tokensUsedThisIteration) && tokensUsedThisIteration > 0
      ? tokensUsedThisIteration
      : 0;

  const newState: ReviewLoopState = {
    ...state,
    currentIteration: nextIteration,
    history: [...state.history, entry],
    unresolvedFindings: findingsCount,
    tokensUsedTotal: state.tokensUsedTotal + iterSpend,
  };

  // Clean verdict terminates the loop successfully (a converged loop wins
  // even if it crossed the cost ceiling on the final, resolving pass).
  if (verdict === "clean") {
    newState.terminated = true;
    newState.terminationReason = "clean";
    newState.unresolvedFindings = 0;
    newState.confidence = reviewLoopConfidence(newState);
    return newState;
  }

  // Max iterations reached with unresolved findings
  if (nextIteration >= state.maxIterations) {
    newState.terminated = true;
    newState.terminationReason = "max_iterations";
    newState.unresolvedFindings = findingsCount;
    newState.confidence = reviewLoopConfidence(newState);
    return newState;
  }

  // Monotonic-divergence escape (Finding D7-17): the fixer is strictly
  // worsening the change every pass over the last MIN_DIVERGENCE_HISTORY
  // iterations. detectOscillation cannot catch this (a monotone series has 0
  // direction changes), so terminate here with a complexity-underestimate
  // recommendation. Checked after the clean + max-iteration gates and before
  // the cost-budget gate (a provably diverging loop should not keep spending).
  if (isMonotonicDivergence(newState.history)) {
    newState.terminated = true;
    newState.terminationReason = "divergence";
    newState.unresolvedFindings = findingsCount;
    newState.confidence = reviewLoopConfidence(newState);
    return newState;
  }

  // Cost-budget ceiling crossed with unresolved findings (Finding D7-SA7.2-F-5):
  // halt early rather than burning further iterations on an expensive
  // non-converging loop. Checked after the clean + max-iteration gates so a
  // clean verdict or a natural iteration-cap termination keeps its own reason.
  if (
    typeof newState.costBudgetTokens === "number" &&
    newState.tokensUsedTotal > newState.costBudgetTokens
  ) {
    newState.terminated = true;
    newState.terminationReason = "cost_budget_exceeded";
    newState.unresolvedFindings = findingsCount;
    newState.confidence = reviewLoopConfidence(newState);
    return newState;
  }

  return newState;
}

// ── Iteration-Gate Decision Contract (Finding C7.5-W2B2-H40) ────
// Execution boundary: LLM-orchestrator-driven, not an in-process TS loop.
// See the module header execution-boundary note (F7.2-H1 / F15.2-H1).

/**
 * Return type from `enforceReviewIteration`.
 *
 * `allowed` is false when the loop has already terminated or the
 * incoming iteration would exceed `maxIterations`. A loop body uses this
 * as the gate: proceed to the next reviewer + fixer pass only when
 * `allowed === true`.
 */
export interface EnforceReviewResult {
  allowed: boolean;
  state: ReviewLoopState;
  reason?: "already_terminated" | "max_iterations_exceeded";
}

/**
 * Iteration-gate decision function for the review loop.
 *
 * Finding C7.5-W2B2-H40 (D15-F15.2-02): models the per-iteration gate as a
 * single pure function the orchestrator's loop body is checked against,
 * rather than re-deriving the cap logic ad hoc per command.
 *
 * Execution boundary (F7.2-H1 / F15.2-H1): this function is NOT invoked from
 * an in-process TypeScript loop driver — the hatch3r pipeline is
 * LLM-orchestrator-driven (Task-tool spawns under
 * `rules/hatch3r-agent-orchestration.md` Phase 3 step 3). It is the typed
 * decision contract for that prompt-driven loop and for downstream AI-tool
 * consumption; the runtime cap itself is enforced by the prompt directive,
 * held in lockstep with `DEFAULT_MAX_REVIEW_ITERATIONS` by the rule-parity
 * assertion in `reviewLoop.test.ts`. See the module header execution-boundary
 * note. A caller embedding this in a real TS loop uses `allowed` as the gate:
 * spawn the next reviewer + fixer pass only when `allowed === true`.
 *
 * Behaviour:
 * 1. If the loop is already terminated, return `{allowed: false}` without
 *    throwing — callers must handle clean termination gracefully.
 * 2. If the loop has reached `maxIterations` without terminating, return
 *    `{allowed: false, reason: "max_iterations_exceeded"}` with the state
 *    advanced and marked terminated via `recordReviewIteration`.
 * 3. Otherwise record the iteration and return `{allowed: true, state}`.
 *
 * The decision is driven by the `canContinueReview` predicate inside this
 * function — a caller that records a further iteration after `allowed=false`
 * gets a `HatchError` via the underlying `recordReviewIteration` guard.
 */
export function enforceReviewIteration(
  state: ReviewLoopState,
  verdict: ReviewIterationVerdict,
  findingsCount: number,
  tokensUsedThisIteration: number = 0,
): EnforceReviewResult {
  if (state.terminated) {
    return { allowed: false, state, reason: "already_terminated" };
  }

  if (!canContinueReview(state)) {
    // Loop is at max without a clean verdict: this branch is reached only
    // if the caller skipped the previous enforcement check. Surface the
    // violation deterministically.
    return { allowed: false, state, reason: "max_iterations_exceeded" };
  }

  // `tokensUsedThisIteration` (Finding D7-SA7.2-F-5) flows to
  // recordReviewIteration so the cost-budget ceiling can terminate the loop;
  // when the budget is crossed, recordReviewIteration returns a terminated
  // state and `allowed` becomes false (same shape as the iteration-cap case).
  const advanced = recordReviewIteration(state, verdict, findingsCount, tokensUsedThisIteration);
  return { allowed: !advanced.terminated, state: advanced };
}

/**
 * Assert that the caller may begin a review iteration.
 *
 * Finding C7.5-W2B2-H40: throw-on-violation variant of the iteration-gate
 * decision for callers that want a fail-fast shape rather than the
 * boolean-returning `enforceReviewIteration`. Throws a `HatchError` when the
 * loop is terminated or at max iterations. Same execution boundary as
 * `enforceReviewIteration` (F7.2-H1 / F15.2-H1): this is a state-contract
 * assertion, not an in-process gate intercepting Task-tool spawns.
 */
export function assertReviewIterationAllowed(state: ReviewLoopState): void {
  if (state.terminated) {
    throw new HatchError(
      `Review loop already terminated (reason: ${state.terminationReason}). ` +
      `Iteration-gate check: no further iterations permitted.`,
      1,
      "VALIDATION_ERROR",
    );
  }
  if (!canContinueReview(state)) {
    throw new HatchError(
      `Review loop at maximum iterations (${state.maxIterations}). ` +
      `Iteration-gate check: further review passes would exceed the iteration limit. ` +
      `See src/pipeline/reviewLoop.ts CALIBRATION for the basis of this default.`,
      1,
      "VALIDATION_ERROR",
    );
  }
}

/**
 * Manually terminate the review loop.
 *
 * Used when external factors require stopping the loop early
 * (e.g., user cancellation, timeout).
 */
export function terminateReviewLoop(
  state: ReviewLoopState,
  unresolvedFindings: number = 0,
): ReviewLoopState {
  if (state.terminated) return state;

  const newState: ReviewLoopState = {
    ...state,
    terminated: true,
    terminationReason: "manual",
    unresolvedFindings,
  };
  newState.confidence = reviewLoopConfidence(newState);
  return newState;
}

/**
 * Terminate the review loop with an oscillation verdict.
 *
 * Finding D7-M5 (D7-SA7.2-2): when `detectOscillation()` reports a fix-break
 * cycle, the orchestrator halts the loop before reaching `maxIterations` so the
 * conflict pattern (fixer A breaks what fixer B fixed) surfaces earlier rather
 * than burning the remaining budget on no-progress iterations. Mirrors the
 * board-fill "Forced termination — oscillation" semantics (commands/hatch3r-
 * board-fill.md step 7.9d) inside the typed state model so consumers can
 * branch on `terminationReason === "oscillation"` deterministically.
 */
export function terminateReviewLoopOscillation(
  state: ReviewLoopState,
  unresolvedFindings: number,
): ReviewLoopState {
  if (state.terminated) return state;

  const newState: ReviewLoopState = {
    ...state,
    terminated: true,
    terminationReason: "oscillation",
    unresolvedFindings,
  };
  newState.confidence = reviewLoopConfidence(newState);
  return newState;
}

/**
 * Terminate the review loop with a DESIGN_OBJECTION verdict.
 *
 * Finding D7-M5 (D7-SA7.2-2): the reviewer signals the premise itself is
 * broken (e.g., requested behaviour is internally contradictory). Loop halts;
 * caller surfaces the objection for user clarification. Cross-references the
 * `BLOCKED_PREMISE_CHALLENGE` agent status in `pipelineContext.ts` — both
 * mechanisms cover non-overlapping phases of the same premise-challenge
 * surface (SA7.1-F7).
 */
export function terminateReviewLoopDesignObjection(
  state: ReviewLoopState,
  unresolvedFindings: number,
): ReviewLoopState {
  if (state.terminated) return state;

  const newState: ReviewLoopState = {
    ...state,
    terminated: true,
    terminationReason: "design_objection",
    unresolvedFindings,
  };
  newState.confidence = reviewLoopConfidence(newState);
  return newState;
}

/**
 * Terminate the review loop with a cost-budget-exceeded verdict.
 *
 * Finding D7-SA7.2-F-5: explicit early-exit when an external cost monitor
 * decides the cumulative token spend has crossed the acceptable ceiling before
 * the loop reached a clean verdict (the complement of `terminateReviewLoop`'s
 * iteration-driven exit). `recordReviewIteration` already terminates the loop
 * automatically when its accumulated `tokensUsedTotal` exceeds
 * `state.costBudgetTokens`; this helper covers the case where the caller tracks
 * spend out-of-band (e.g. via `src/pipeline/costEstimator.ts` actuals) and
 * wants to halt the loop directly. `tokensUsedTotal` is updated to the observed
 * spend so `reviewLoopSummary` can report the actual against the budget.
 */
export function terminateReviewLoopCostBudget(
  state: ReviewLoopState,
  unresolvedFindings: number,
  tokensUsedTotal?: number,
): ReviewLoopState {
  if (state.terminated) return state;

  const newState: ReviewLoopState = {
    ...state,
    terminated: true,
    terminationReason: "cost_budget_exceeded",
    unresolvedFindings,
    tokensUsedTotal:
      typeof tokensUsedTotal === "number" && Number.isFinite(tokensUsedTotal) && tokensUsedTotal >= 0
        ? tokensUsedTotal
        : state.tokensUsedTotal,
  };
  newState.confidence = reviewLoopConfidence(newState);
  return newState;
}

// ── Oscillation Detection (#244, D8-8.11) ───────────────────────

/**
 * Detect oscillation patterns in the review loop history.
 *
 * #244 (D8-8.11): Oscillation occurs when findings count alternates between
 * high and low values across iterations, indicating the fixer is introducing
 * new issues while resolving old ones (fix-break cycle).
 *
 * Detection criteria (re-thresholded in Cycle 11, Finding D7-16):
 * - At least 3 iterations of history
 * - At least 1 direction change in the findings-count series (a decrease
 *   followed by an increase, or vice versa)
 *
 * The prior threshold required 2 direction changes (4 history entries), which
 * was only reachable because DEFAULT_MAX_REVIEW_ITERATIONS had been raised to 4
 * *to make the detector reachable* — a circular coupling (Finding D7-16). With
 * the cap now set from convergence economics independent of this detector, the
 * threshold is lowered to `directionChanges >= 1` so a fix-break cycle is
 * caught on the first reversal within a 3-entry default-reachable history. A
 * strictly monotone series (always up or always down) still yields 0 direction
 * changes and is NOT flagged here — monotone *worsening* is handled by the
 * separate `monotonic_divergence` escape in `recordReviewIteration`
 * (Finding D7-17); monotone improvement is healthy convergence.
 */
export function detectOscillation(state: ReviewLoopState): {
  oscillating: boolean;
  description: string;
} {
  if (state.history.length < 3) {
    return { oscillating: false, description: "Insufficient history for oscillation detection" };
  }

  let directionChanges = 0;
  let lastDirection: "up" | "down" | null = null;

  for (let i = 1; i < state.history.length; i++) {
    const prev = state.history[i - 1].findingsCount;
    const curr = state.history[i].findingsCount;
    const direction: "up" | "down" | null =
      curr > prev ? "up" : curr < prev ? "down" : null;

    if (direction && lastDirection && direction !== lastDirection) {
      directionChanges++;
    }
    if (direction) lastDirection = direction;
  }

  if (directionChanges >= 1) {
    const counts = state.history.map((h) => h.findingsCount).join(" -> ");
    return {
      oscillating: true,
      description:
        `Review loop oscillation detected: findings count pattern [${counts}] ` +
        `shows ${directionChanges} direction changes. ` +
        `The fixer may be introducing new issues while resolving old ones.`,
    };
  }

  return { oscillating: false, description: "No oscillation detected" };
}

// ── Suppression-Pattern Detection (Finding D7-15) ───────────────

/**
 * Suppression-pattern class surfaced by {@link detectSuppressionPatterns}.
 *
 * Each value names one superficial-fix class the
 * `rules/hatch3r-agent-orchestration.md` -> Root-Cause Depth Requirements
 * section instructs the orchestrator to reject as PARTIAL:
 *
 * - `as_any`            — a TypeScript `as any` (or `<any>`) cast that erases a
 *                          type mismatch instead of fixing the type at source.
 * - `eslint_disable`    — an `eslint-disable[-next-line|-line]` directive with
 *                          no issue-reference token, suppressing a lint rule
 *                          rather than fixing the underlying pattern. A directive
 *                          carrying an issue reference (`#123`, a URL, or
 *                          `TODO(...)`/`see ...`) is treated as tracked and NOT
 *                          flagged.
 * - `test_skip`         — a `test.skip` / `it.skip` / `describe.skip` / `xit` /
 *                          `xdescribe` (or a `// @ts-expect-error`-style skip
 *                          marker) with no linked issue reference, disabling a
 *                          test instead of fixing the code that breaks it.
 *                          (`.claude/rules/test-requirements.md` forbids
 *                          `test.skip`/`test.todo` without a tracking issue.)
 */
export type SuppressionPatternKind = "as_any" | "eslint_disable" | "test_skip";

/** One detected suppression-pattern occurrence. */
export interface SuppressionPatternHit {
  kind: SuppressionPatternKind;
  /** The trimmed added line the pattern was found on (diff prefix stripped). */
  line: string;
  /** 1-based index of the matching added line within the scanned diff. */
  addedLineIndex: number;
}

export interface SuppressionScanResult {
  /** True when at least one suppression pattern was found in added lines. */
  found: boolean;
  hits: SuppressionPatternHit[];
  /** Human-readable advisory summarizing the hits (empty when none). */
  description: string;
}

/**
 * Whether a line carries an issue-reference token that marks a suppression as
 * tracked rather than ad-hoc. Mirrors the `.claude/rules/test-requirements.md`
 * "without a tracking issue reference" exception and the Root-Cause Depth
 * "test skips without linked issues" wording: an issue number (`#123`), a URL,
 * or a `TODO(...)` / `see ...` pointer is accepted as a reference.
 */
function hasIssueReference(line: string): boolean {
  return (
    /#\d+/.test(line) ||
    /https?:\/\/\S+/.test(line) ||
    /\b(?:TODO|FIXME)\s*\([^)]+\)/i.test(line) ||
    /\bsee\s+\S+/i.test(line)
  );
}

/**
 * Scan a unified diff for superficial-fix suppression patterns (Finding D7-15).
 *
 * The hatch3r pipeline is LLM-orchestrator-driven, so the
 * `rules/hatch3r-agent-orchestration.md` -> Root-Cause Depth Requirements
 * directive ("Reject superficial fixes from any subagent. If a fixer's output
 * contains suppression patterns ... classify as PARTIAL and re-run") had no
 * machine-checkable counterpart — unlike the oscillation, cost-budget, and
 * confidence gates, which all carry typed contracts + tests. This pure function
 * is that counterpart: the orchestrator/reviewer runs it over the Phase-2 /
 * Phase-3 fixer diff and consults `found` the same advisory way the orchestrator
 * consults {@link detectOscillation}. It does NOT mutate state or terminate the
 * loop; the reviewer remains the decision authority (it may downgrade the
 * verdict to a Warning/Critical finding so the existing review gate handles the
 * re-run). Modeled on `detectOscillation`'s shape (read-only, returns a
 * structured advisory with a description string).
 *
 * Only ADDED lines are scanned (diff lines beginning with a single `+`, but not
 * the `+++` file header) — a suppression already present in the pre-image is not
 * introduced by this change. A plain (non-diff) code string is scanned in full,
 * so a caller can pass either a `git diff` or a raw added-code snippet.
 *
 * The three detected classes match the Root-Cause Depth examples verbatim:
 * `as any` casts (type-error suppression), `eslint-disable` without an issue
 * reference (lint suppression), and `test.skip`/`it.skip`/`describe.skip`
 * without a linked issue (test suppression). An `eslint-disable` or skip that
 * carries an issue reference ({@link hasIssueReference}) is treated as tracked
 * and not flagged, matching the "without linked issues" qualifier.
 */
export function detectSuppressionPatterns(diff: string): SuppressionScanResult {
  if (typeof diff !== "string" || diff.length === 0) {
    return { found: false, hits: [], description: "No suppression patterns detected" };
  }

  const lines = diff.split("\n");
  // When the input looks like a unified diff (has at least one +/-/@@ marker),
  // scan only added lines; otherwise treat the whole input as added code.
  const looksLikeDiff = lines.some(
    (l) => /^\+(?!\+\+)/.test(l) || /^-(?!--)/.test(l) || l.startsWith("@@"),
  );

  const hits: SuppressionPatternHit[] = [];
  let addedLineIndex = 0;

  for (const raw of lines) {
    let content: string;
    if (looksLikeDiff) {
      // Skip everything that is not a genuine added line.
      if (!/^\+(?!\+\+)/.test(raw)) continue;
      content = raw.slice(1);
    } else {
      content = raw;
    }
    addedLineIndex += 1;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;

    // `as any` / `<any>` cast (type-error suppression). Word-boundary the
    // `any` so identifiers like `anything` or `Many` do not match.
    if (/\bas\s+any\b/.test(content) || /<\s*any\s*>/.test(content)) {
      hits.push({ kind: "as_any", line: trimmed, addedLineIndex });
      continue;
    }

    // eslint-disable directive without an issue reference (lint suppression).
    if (/eslint-disable(?:-next-line|-line)?\b/.test(content) && !hasIssueReference(content)) {
      hits.push({ kind: "eslint_disable", line: trimmed, addedLineIndex });
      continue;
    }

    // Skipped test without a linked issue (test suppression). Covers the
    // method-call form (`test.skip(`, `it.skip(`, `describe.skip(`) and the
    // x-prefixed form (`xit(`, `xdescribe(`).
    if (
      (/\b(?:test|it|describe|context)\s*\.\s*skip\b/.test(content) ||
        /\bx(?:it|describe)\s*\(/.test(content)) &&
      !hasIssueReference(content)
    ) {
      hits.push({ kind: "test_skip", line: trimmed, addedLineIndex });
      continue;
    }
  }

  if (hits.length === 0) {
    return { found: false, hits: [], description: "No suppression patterns detected" };
  }

  const byKind = hits.reduce<Record<string, number>>((acc, h) => {
    acc[h.kind] = (acc[h.kind] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byKind)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");

  return {
    found: true,
    hits,
    description:
      `Suppression patterns detected in added lines (${summary}): superficial-fix signals ` +
      `the reviewer should reject as a root-cause gap (classify the fixer pass PARTIAL and ` +
      `re-run for a root-cause fix) per rules/hatch3r-agent-orchestration.md Root-Cause Depth Requirements.`,
  };
}

/**
 * Get a summary string for the review loop state.
 *
 * Used for logging and reporting to the user.
 */
export function reviewLoopSummary(state: ReviewLoopState): string {
  const parts: string[] = [
    `Review loop: ${state.currentIteration}/${state.maxIterations} iterations`,
  ];

  if (state.terminated) {
    switch (state.terminationReason) {
      case "clean":
        parts.push("terminated: clean verdict");
        break;
      case "max_iterations":
        parts.push(
          `terminated: max iterations reached (${state.unresolvedFindings} unresolved findings)`,
        );
        break;
      case "manual":
        parts.push("terminated: manual stop");
        break;
      case "oscillation":
        parts.push(
          `terminated: oscillation detected (${state.unresolvedFindings} unresolved findings; fixer is editing the wrong line)`,
        );
        break;
      case "design_objection":
        parts.push(
          "terminated: reviewer raised DESIGN_OBJECTION (premise itself is broken); user clarification required",
        );
        break;
      case "cost_budget_exceeded": {
        // Surface actual spend against the budget so the user sees how far the
        // loop overran before the cost ceiling halted it (Finding D7-SA7.2-F-5).
        const budget = state.costBudgetTokens;
        const spendDetail =
          typeof budget === "number"
            ? `${state.tokensUsedTotal}/${budget} tokens, ${Math.max(0, budget - state.tokensUsedTotal)} remaining`
            : `${state.tokensUsedTotal} tokens spent`;
        parts.push(
          `terminated: cost budget exceeded (${spendDetail}; ${state.unresolvedFindings} unresolved findings)`,
        );
        break;
      }
      case "divergence":
        // Strictly-worsening loop — surface the complexity-underestimate
        // recommendation so the user breaks the task down (Finding D7-17).
        parts.push(
          `terminated: ${DIVERGENCE_MESSAGE} (${state.unresolvedFindings} unresolved findings)`,
        );
        break;
    }
    // Include confidence signal in summary (Finding #68)
    if (state.confidence) {
      parts.push(`confidence: ${state.confidence}`);
    }
  } else {
    parts.push("status: in progress");
  }

  return parts.join(" | ");
}

// ── Iteration Ledger (Finding D7-SA7.2-01 — CL-2 telemetry, Cycle 12) ──

/**
 * Sample size at which the measured iteration split may replace the shipped
 * informed estimate (CL-2 spec point 3, Finding D7-M4 / D7-SA7.2-1): once
 * `deriveIterationSplit` reports `sampleSize >= CALIBRATION_SAMPLE_THRESHOLD`,
 * `scripts/calibrate-review-loop.ts` prints the candidate CALIBRATION update
 * (basis `"measured"`, `measuredAt` populated) for a maintainer PR.
 */
export const CALIBRATION_SAMPLE_THRESHOLD = 30;

/**
 * One terminated review loop, recorded for cap calibration
 * (Finding D7-SA7.2-01). The ledger is a JSONL file — one entry per line via
 * {@link serializeReviewLoopLedgerEntry} — so any loop runner (audit wave
 * sub-agent, prompt-driven orchestrator, downstream pack driver) can append
 * without read-modify-write coordination. `deriveIterationSplit` aggregates
 * entries into the measured `IterationSplitClaim` that replaces the
 * `CALIBRATION.split` informed estimate at the 30-sample threshold.
 */
export interface ReviewLoopLedgerEntry {
  /** ISO-8601 timestamp the entry was recorded. */
  recordedAt: string;
  /** Loop class the run declared — fixes which cap applied ({@link ReviewLoopClass}). */
  loopClass: ReviewLoopClass;
  /** The cap the loop ran under (post-clamp `state.maxIterations`). */
  maxIterations: number;
  /** Iterations actually consumed (`state.currentIteration` at termination). */
  iterationCount: number;
  /** Terminal reason the loop stopped with. */
  terminationReason: ReviewLoopTerminationReason;
  /** Per-iteration reviewer verdicts, oldest first. */
  verdictByIteration: ReviewIterationVerdict[];
  /** Run identifier: finding id, command name, or correlation id. */
  source: string;
  /**
   * Whether the loop converged — `true` iff `terminationReason === "clean"`
   * (Finding D7-SA7.2-04, CL-2 unit U10). Denormalized for downstream
   * analytics; `parseReviewLoopLedger` derives it when absent (pre-U10
   * ledger-line back-compat) and rejects a present-but-inconsistent value so
   * a hand-edited line fails loudly rather than skewing consumers.
   */
  converged: boolean;
  /**
   * Wall-clock span (ms, integer >= 0) from the first to the last recorded
   * iteration timestamp in `state.history` (Finding D7-SA7.2-04, CL-2 unit
   * U10). Omitted when the history is empty (e.g. a `manual` termination
   * before iteration 1) or a timestamp fails to parse. Derived from
   * already-recorded timestamps — building an entry reads no clock beyond
   * the existing `recordedAt` default.
   */
  durationMs?: number;
}

/** Runtime verdict values for ledger-line validation (mirrors {@link ReviewIterationVerdict}). */
const ITERATION_VERDICT_VALUES: readonly ReviewIterationVerdict[] = Object.freeze([
  "clean",
  "warning",
  "critical",
]);

/**
 * Build a ledger entry from a terminated review loop.
 *
 * Throws a `HatchError` when the loop has not terminated — an in-progress
 * loop has no final iteration count, so recording it would bias the split
 * toward low counts.
 */
export function reviewLoopLedgerEntry(
  state: ReviewLoopState,
  meta: { loopClass: ReviewLoopClass; source: string; recordedAt?: string },
): ReviewLoopLedgerEntry {
  if (!state.terminated || state.terminationReason === undefined) {
    throw new HatchError(
      "Cannot record a review-loop ledger entry for a non-terminated loop. " +
        "Record entries only after the loop reaches a terminal state " +
        "(clean, max_iterations, manual, oscillation, design_objection, " +
        "cost_budget_exceeded, or divergence).",
      1,
      "VALIDATION_ERROR",
    );
  }
  const entry: ReviewLoopLedgerEntry = {
    recordedAt: meta.recordedAt ?? new Date().toISOString(),
    loopClass: meta.loopClass,
    maxIterations: state.maxIterations,
    iterationCount: state.currentIteration,
    terminationReason: state.terminationReason,
    verdictByIteration: state.history.map((h) => h.verdict),
    source: meta.source,
    converged: state.terminationReason === "clean",
  };
  // Loop-internal duration from the already-recorded iteration timestamps
  // (D7-SA7.2-04, U10): first-to-last history span, integer ms. Omitted when
  // there is no history or a timestamp does not parse — never a fabricated 0.
  if (state.history.length > 0) {
    const first = Date.parse(state.history[0].timestamp);
    const last = Date.parse(state.history[state.history.length - 1].timestamp);
    if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
      entry.durationMs = Math.round(last - first);
    }
  }
  return entry;
}

/** Serialize one ledger entry to its single-line JSONL form. */
export function serializeReviewLoopLedgerEntry(entry: ReviewLoopLedgerEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parse a JSONL review-loop ledger into validated entries.
 *
 * Blank lines are skipped (trailing newline friendly). A malformed line —
 * invalid JSON or a missing/out-of-domain field — throws a `HatchError`
 * naming the 1-based line number and the offending field, so a corrupted
 * ledger fails the calibration run loudly instead of silently skewing the
 * measured split.
 */
export function parseReviewLoopLedger(content: string): ReviewLoopLedgerEntry[] {
  const entries: ReviewLoopLedgerEntry[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const lineNo = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new HatchError(
        `Malformed review-loop ledger line ${lineNo}: not valid JSON. ` +
          `Fix or remove the line, then re-run the calibration.`,
        1,
        "VALIDATION_ERROR",
      );
    }
    const fail = (field: string, requirement: string): never => {
      throw new HatchError(
        `Malformed review-loop ledger line ${lineNo}: field "${field}" ${requirement}.`,
        1,
        "VALIDATION_ERROR",
      );
    };
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      fail("(root)", "must be a JSON object");
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.recordedAt !== "string" || record.recordedAt.length === 0) {
      fail("recordedAt", "must be a non-empty ISO-8601 string");
    }
    if (
      typeof record.loopClass !== "string" ||
      !(record.loopClass in REVIEW_LOOP_CLASS_CAPS)
    ) {
      fail("loopClass", 'must be one of "code" | "spec" | "default"');
    }
    if (
      typeof record.maxIterations !== "number" ||
      !Number.isInteger(record.maxIterations) ||
      record.maxIterations < MIN_MAX_REVIEW_ITERATIONS
    ) {
      fail("maxIterations", `must be an integer >= ${MIN_MAX_REVIEW_ITERATIONS}`);
    }
    if (
      typeof record.iterationCount !== "number" ||
      !Number.isInteger(record.iterationCount) ||
      record.iterationCount < 0
    ) {
      fail("iterationCount", "must be a non-negative integer");
    }
    if (
      typeof record.terminationReason !== "string" ||
      !(REVIEW_LOOP_TERMINATION_REASONS as readonly string[]).includes(
        record.terminationReason,
      )
    ) {
      fail(
        "terminationReason",
        `must be one of ${REVIEW_LOOP_TERMINATION_REASONS.join(" | ")}`,
      );
    }
    if (
      !Array.isArray(record.verdictByIteration) ||
      record.verdictByIteration.some(
        (v) => !(ITERATION_VERDICT_VALUES as readonly unknown[]).includes(v),
      )
    ) {
      fail("verdictByIteration", 'must be an array of "clean" | "warning" | "critical"');
    }
    if (typeof record.source !== "string" || record.source.length === 0) {
      fail("source", "must be a non-empty string");
    }
    // `converged` (U10): derived when absent (pre-U10 ledger lines carry no
    // such field); when present it must be a boolean AND consistent with
    // terminationReason — an inconsistent value marks a hand-edited or
    // corrupted line, which fails loudly per this parser's posture.
    const derivedConverged = record.terminationReason === "clean";
    if (record.converged !== undefined) {
      if (typeof record.converged !== "boolean") {
        fail("converged", "must be a boolean when present");
      }
      if (record.converged !== derivedConverged) {
        fail(
          "converged",
          `contradicts terminationReason "${String(record.terminationReason)}" ` +
            `(converged must be ${String(derivedConverged)})`,
        );
      }
    }
    // `durationMs` (U10): optional; a finite integer >= 0 when present.
    if (record.durationMs !== undefined) {
      if (
        typeof record.durationMs !== "number" ||
        !Number.isInteger(record.durationMs) ||
        record.durationMs < 0
      ) {
        fail("durationMs", "must be a non-negative integer when present");
      }
    }
    const entry: ReviewLoopLedgerEntry = {
      recordedAt: record.recordedAt as string,
      loopClass: record.loopClass as ReviewLoopClass,
      maxIterations: record.maxIterations as number,
      iterationCount: record.iterationCount as number,
      terminationReason: record.terminationReason as ReviewLoopTerminationReason,
      verdictByIteration: record.verdictByIteration as ReviewIterationVerdict[],
      source: record.source as string,
      converged: derivedConverged,
    };
    if (record.durationMs !== undefined) {
      entry.durationMs = record.durationMs as number;
    }
    entries.push(entry);
  }
  return entries;
}

/** Result of aggregating ledger entries into a measured iteration split. */
export interface DerivedIterationSplit {
  /** Measured split over the sample (rates sum to 1 for a non-empty sample). */
  split: IterationSplitClaim;
  /** Number of ledger entries aggregated. */
  sampleSize: number;
  /** True once `sampleSize >= CALIBRATION_SAMPLE_THRESHOLD` (CL-2 promotion gate). */
  promotable: boolean;
}

/**
 * Aggregate ledger entries into the measured iteration split.
 *
 * Bucket semantics mirror {@link IterationSplitClaim}: `iteration{1,2,3}CleanRate`
 * count loops that terminated `clean` at exactly that iteration;
 * `iteration4PlusRate` is everything else — clean at iteration >= 4 AND every
 * non-clean termination (max_iterations, oscillation, divergence, manual,
 * design_objection, cost_budget_exceeded). A loop that never converged within
 * 3 iterations belongs to the oscillation-prone tail regardless of why it
 * stopped, matching the field's "fraction exceeding 3 iterations" definition.
 * Each entry lands in exactly one bucket, so the four rates sum to 1.
 */
export function deriveIterationSplit(
  entries: ReviewLoopLedgerEntry[],
): DerivedIterationSplit {
  const n = entries.length;
  if (n === 0) {
    return {
      split: {
        iteration1CleanRate: 0,
        iteration2CleanRate: 0,
        iteration3CleanRate: 0,
        iteration4PlusRate: 0,
      },
      sampleSize: 0,
      promotable: false,
    };
  }
  let clean1 = 0;
  let clean2 = 0;
  let clean3 = 0;
  let tail = 0;
  for (const entry of entries) {
    if (entry.terminationReason === "clean" && entry.iterationCount <= 1) clean1++;
    else if (entry.terminationReason === "clean" && entry.iterationCount === 2) clean2++;
    else if (entry.terminationReason === "clean" && entry.iterationCount === 3) clean3++;
    else tail++;
  }
  return {
    split: {
      iteration1CleanRate: clean1 / n,
      iteration2CleanRate: clean2 / n,
      iteration3CleanRate: clean3 / n,
      iteration4PlusRate: tail / n,
    },
    sampleSize: n,
    promotable: n >= CALIBRATION_SAMPLE_THRESHOLD,
  };
}

// ── Runtime Telemetry Sink (Finding D7-SA7.2-04 — CL-2 unit U10, Cycle 12) ──

/**
 * Repo-root-relative path of the runtime review-loop telemetry ledger.
 *
 * Finding D7-SA7.2-04: the Cycle-10 CL-2 spec named the audit finding
 * registry as the calibration data source, but that registry is populated by
 * AUDIT-EXECUTE waves — reading it would measure the audit's own loops, not
 * product review loops. This `.hatch3r/` ledger is the product-runtime
 * source: `scripts/calibrate-review-loop.ts` reads it by default, so
 * `basis: "measured"` means "measured on real hatch3r review loops".
 */
export const REVIEW_LOOP_METRICS_RELPATH = join(
  ".hatch3r",
  "review-loop-metrics.jsonl",
);

/**
 * Result of an {@link appendReviewLoopTelemetry} call. `written` is `true`
 * when the record reached disk; when `false`, `warning` carries an
 * operator-facing message naming the path and cause so the caller can
 * surface it (Silent Failure Contract: reported, never thrown — telemetry
 * write failures must never fail the loop they instrument).
 */
export interface ReviewLoopTelemetryResult {
  written: boolean;
  /** Absolute path of the target ledger file. */
  path: string;
  /** Populated when `written === false`. */
  warning?: string;
}

/**
 * Append one telemetry record for a terminated review loop to
 * `<projectRoot>/.hatch3r/review-loop-metrics.jsonl` (CL-2 unit U10,
 * Findings D7-SA7.2-01 / D7-SA7.2-04).
 *
 * **Write approach — `appendFile`, not the tmp+rename atomic writer.** The
 * `src/merge/safeWrite.ts` tmp+rename pattern gives atomic REPLACE semantics;
 * a JSONL ledger needs APPEND semantics, and rename-replace fits it badly on
 * two axes: (1) cost — replacing an append means read-whole-ledger +
 * rewrite-whole-ledger per record, O(ledger size) for a file that only
 * grows; (2) lost updates — two concurrent loop runners doing
 * read-modify-rename both read N lines and both rename back N+1, so the last
 * rename wins and one record is silently dropped (the concurrent-write
 * ordering caveat documented on `atomicWriteFile`). `fs.appendFile` opens
 * with `O_APPEND`, so the kernel positions every write at the current end of
 * file — concurrent appenders can interleave record ORDER but cannot
 * overwrite one another. Precedent: `failureLog.ts::writeFailureLog`, the
 * `.hatch3r` failure-log JSONL appender.
 *
 * **Partial-line corruption guard.** Each record is serialized to exactly one
 * line with its trailing `\n` and handed to ONE `appendFile` call — never
 * assembled across calls — so a concurrent append cannot split a record
 * mid-line on a local POSIX filesystem. A crash mid-write can still leave a
 * torn tail line; `parseReviewLoopLedger` throws naming the 1-based line
 * number on any malformed line and the calibration script exits 1 on it, so
 * a torn line halts calibration pointing at the exact line to delete rather
 * than silently skewing the measured split (detect-and-discard: losing one
 * sample is acceptable, mis-measuring the distribution is not).
 *
 * **Failure isolation.** NEVER throws. Every failure — a non-terminated
 * state (the {@link reviewLoopLedgerEntry} guard), a `mkdir` failure (the
 * `.hatch3r` path occupied by a file), an `appendFile` errno
 * (EACCES/ENOSPC/EROFS) — returns `{ written: false, warning }`. The loop
 * state is read-only input; no telemetry disposition alters the loop
 * outcome. A missing `.hatch3r/` parent is created (`mkdir -p` semantics).
 *
 * **Execution boundary.** Same `@library_export_only` posture as the rest of
 * this module: the JSONL line format is the cross-boundary interface (a
 * prompt-driven loop runner appends a schema-conformant line directly); this
 * function is the canonical TypeScript writer for in-process drivers and
 * pack integrators. Prompt-side emission wiring is tracked separately
 * (cross-ref D7-SA7.2-03).
 */
export async function appendReviewLoopTelemetry(
  projectRoot: string,
  state: ReviewLoopState,
  meta: { loopClass: ReviewLoopClass; source: string; recordedAt?: string },
): Promise<ReviewLoopTelemetryResult> {
  const metricsPath = join(projectRoot, REVIEW_LOOP_METRICS_RELPATH);
  try {
    const entry = reviewLoopLedgerEntry(state, meta);
    const line = serializeReviewLoopLedgerEntry(entry) + "\n";
    await mkdir(dirname(metricsPath), { recursive: true });
    await appendFile(metricsPath, line, "utf-8");
    return { written: true, path: metricsPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      written: false,
      path: metricsPath,
      warning:
        `Review-loop telemetry record was NOT persisted to ${metricsPath} — ${message}. ` +
        `The calibration sample is one loop short (check write permission / disk space ` +
        `on the .hatch3r/ directory); the review-loop result itself is unaffected.`,
    };
  }
}

// ── D13 Medium: Trust-building and feedback loop helpers (#331-#343) ──

/**
 * User-friendly explanation of the confidence signal.
 *
 * D13 Medium (#331-#343): Help users understand what the confidence
 * level means and what action they should take based on it.
 *
 * D13-2 (D13-SA13.2-F2): these three strings are the typed accessor for the
 * canonical confidence-to-action mapping authored in
 * `rules/hatch3r-iteration-summary.md` -> "Confidence-to-Action Mapping (D13)"
 * (and its `.mdc` twin). That rule is the user-facing surface every orchestrator
 * appends to its §5 Confidence line when a review loop ran, so this guidance is
 * no longer reachable only from a unit test. Keep the returned strings
 * byte-identical to the rule's three bullet bodies when either side changes —
 * the rule-parity scan holds the `.md`/`.mdc` pair in lockstep, and this JSDoc
 * is the cross-link the maintainer follows to keep code and rule aligned.
 */
export function confidenceExplanation(confidence: ReviewConfidenceLevel): string {
  switch (confidence) {
    case "high":
      return "The fix was correct on the first attempt. Human review is optional but recommended for critical code paths.";
    case "medium":
      return "The fix required one round of corrections, which is normal for moderately complex changes. A brief human review is recommended.";
    case "low":
      return "The fix required multiple attempts or was interrupted. A thorough human review is strongly recommended before merging.";
  }
}

/**
 * Calculate a findings trend from review loop history.
 *
 * D13 Medium (#331-#343): Provides feedback on whether the fix
 * process is converging (findings decreasing) or diverging.
 */
export type FindingsTrend = "converging" | "stable" | "diverging" | "insufficient_data";

export function calculateFindingsTrend(state: ReviewLoopState): FindingsTrend {
  if (state.history.length < 2) return "insufficient_data";

  const counts = state.history.map(h => h.findingsCount);
  const lastTwo = counts.slice(-2);

  if (lastTwo[1] < lastTwo[0]) return "converging";
  if (lastTwo[1] === lastTwo[0]) return "stable";
  return "diverging";
}

/**
 * C8-D13-M1: Confidence-threshold review gate.
 *
 * Review gate incorporates the reviewer's self-reported confidence into the
 * PASS decision. A clean verdict (0 critical + 0 warning) with low confidence
 * triggers a second-pass review (if iteration budget remains) or escalation
 * (if exhausted), rather than silently approving uncertain reviews.
 *
 * Cycle 11 additions (Findings D7-18 / D13-16 / D13-21 / D15-20):
 *   - Confidence reconciliation (D13-21): when `reviewLoopConfidence` is
 *     supplied, the gate evaluates the floor against
 *     `min(reviewLoopConfidence, confidence)` so the deterministic signal caps
 *     an over-confident self-rating.
 *   - Provider-independence gating on security diffs (D13-16 / D15-20): when
 *     `securityTouchingDiff` is set and the verdict is not provider-independent
 *     (`same_family` / `unknown`), an otherwise-clean verdict is forced to
 *     `second_pass` (or `escalate` when the budget is exhausted) — making
 *     `verdictIndependence` a gating input rather than a no-op annotation.
 *   - High-risk second-pass floor (D7-18): the forced second pass above lands
 *     only on high-risk diffs, leaving the everyday-review decision unchanged.
 */
export type ReviewGateDecision = "pass" | "second_pass" | "escalate" | "fail";

/**
 * D15-M8: reviewer-vs-fixer model-family independence signal.
 *
 * The '0 Critical + 0 Warning' review gate is gameable when the reviewer and
 * the fixer share the same model family — the fixer can produce output the
 * same family is biased to approve. The hatch3r pipeline does NOT today
 * spawn the reviewer and fixer on different model providers; the limitation
 * is documented at `agents/hatch3r-reviewer.md` and surfaced here as a
 * first-class gate input.
 *
 * Gating behaviour (Findings D13-16 / D15-20, Cycle 11): on a security-touching
 * diff (`ReviewGateInput.securityTouchingDiff === true`) this value is a
 * decision input, not only an annotation. A clean-and-floor-passing verdict
 * with `same_family` or `unknown` independence is downgraded `pass`->`second_pass`
 * (or `pass`->`escalate` when the iteration budget is exhausted), because a
 * same-family or unattested verdict on security-sensitive code is not
 * provider-independent and published self-preference-bias research shows the
 * effect is real and stronger in capable models. On a non-security diff (the
 * default) the value remains an advisory recorded in `reason` — the pre-Cycle-11
 * behaviour is unchanged for everyday reviews, so the gating pressure lands only
 * where the blast radius warrants it (Finding D7-18 high-risk scoping).
 *
 * Values:
 *   - `same_family` — reviewer and fixer share a model family
 *     (e.g. both Anthropic Claude, both OpenAI GPT). On a security-touching
 *     diff this forces a second pass; otherwise it is a non-fatal advisory.
 *   - `different_family` — reviewer and fixer come from distinct model
 *     providers. The clean verdict is already provider-independent, so no
 *     second pass is forced even on a security-touching diff.
 *   - `unknown` — the caller did not declare independence. Default; treated as
 *     not-independent, so on a security-touching diff it forces a second pass,
 *     and the decision reason always notes the omission so audits can flag
 *     unattested gates.
 */
export type VerdictIndependence = "same_family" | "different_family" | "unknown";

export interface ReviewGateInput {
  severityCount: {
    critical: number;
    warning: number;
    suggestion: number;
  };
  confidence: "high" | "medium" | "low" | "unknown";
  iterationBudgetRemaining: number;
  /**
   * D15-M8: declared independence between the reviewer and the fixer.
   * Optional for backward compatibility; defaults to `"unknown"`.
   */
  verdictIndependence?: VerdictIndependence;
  /**
   * D13-SA13.3-F13.3.3 / D13-3: the user's pre-flight assertiveness floor,
   * resolved from the `--confidence-floor` run flag or the persisted
   * `hatch3r config confidence_floor=<floor>` default (`ConfidenceFloor` in
   * `src/types.ts`). Tightens the clean-verdict threshold the four core
   * orchestrators document at `commands/hatch3r-{workflow,board-pickup,
   * quick-change,rework}.md` (and `commands/board/pickup-delegation.md`):
   *
   * - `"any"`    (default): pass on `high`/`medium`; second_pass/escalate on
   *               `low`/`unknown`. The pre-D13-3 behaviour, unchanged.
   * - `"medium"`: same decision surface as `"any"` at the aggregate
   *               `confidence` input — `medium` still passes, `low` forces a
   *               second pass — but declared explicitly so the gate records
   *               which floor it evaluated under.
   * - `"high"`:  `medium` no longer passes — second_pass when
   *               `confidence != "high"` (medium/low/unknown), escalating when
   *               the iteration budget is exhausted.
   *
   * Optional for backward compatibility; defaults to {@link DEFAULT_CONFIDENCE_FLOOR}
   * (`"any"`). The floor only ADDS second-pass pressure on uncertain verdicts;
   * it never relaxes the Critical/Warning fail gates above it.
   */
  confidenceFloor?: ConfidenceFloor;
  /**
   * Findings D7-18 / D13-16 / D15-20: whether the diff under review touches a
   * high-risk surface — a `floor:security` / auth / migration file or any file
   * in the CQ3-security dispatch set (the same surfaces
   * `agents/hatch3r-reviewer.md` "Runtime Confidence Calibration" routes a
   * forced second pass for). When `true`, an otherwise-clean-and-floor-passing
   * verdict that is NOT provider-independent (`verdictIndependence` of
   * `same_family` or `unknown`) is downgraded to `second_pass` (or `escalate`
   * when no iteration budget remains) so security-sensitive code never merges on
   * a single same-family or unattested review pass. The orchestrator should
   * route that second pass to a different model class when one is available
   * (see `rules/hatch3r-reviewer-calibration.md` -> Action); the gate records
   * the forced-pass reason. Optional; defaults to `false` (the everyday-review
   * path, behaviourally identical to the pre-Cycle-11 gate).
   */
  securityTouchingDiff?: boolean;
  /**
   * Finding D13-21: the deterministic, iteration-derived confidence signal from
   * {@link reviewLoopConfidence} for the same loop, supplied alongside the
   * reviewer's self-assigned `confidence`. When present, the gate reconciles the
   * two by taking the LOWER of the two ranks (`high > medium > low > unknown`)
   * before applying the floor — so the deterministic signal CAPS an
   * over-confident self-rating (`agents/hatch3r-reviewer.md` notes the
   * self-assigned value is "structurally over-trusted"). The gate's effective
   * confidence source is documented in the result `reason`. Optional; when
   * omitted the gate uses `confidence` alone (pre-D13-21 behaviour, unchanged).
   */
  reviewLoopConfidence?: ReviewConfidenceLevel;
}

export interface ReviewGateResult {
  decision: ReviewGateDecision;
  reason: string;
  /** D15-M8: echo the independence value used in the decision. */
  verdictIndependence?: VerdictIndependence;
  /**
   * Finding D13-21: the confidence value the floor was actually evaluated
   * against — `min(reviewLoopConfidence, confidence)` when both were supplied,
   * otherwise the self-assigned `confidence`. Echoed so a caller can see which
   * source drove the decision rather than inferring it from `reason`.
   */
  effectiveConfidence?: "high" | "medium" | "low" | "unknown";
}

/**
 * Numeric rank for a confidence level so the gate can take the worse
 * (lower-ranked) of two signals (Finding D13-21). `unknown` is the floor —
 * a self-assigned `unknown` is treated as no weaker than `low` for ordering but
 * distinct in display.
 */
const CONFIDENCE_RANK: Readonly<Record<"high" | "medium" | "low" | "unknown", number>> =
  Object.freeze({ high: 3, medium: 2, low: 1, unknown: 0 });

export function evaluateReviewGate(input: ReviewGateInput): ReviewGateResult {
  const independence: VerdictIndependence =
    input.verdictIndependence ?? "unknown";
  const floor: ConfidenceFloor = input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const independenceNote =
    independence === "same_family"
      ? " (reviewer and fixer share a model family per VerdictIndependence — clean verdict is not provider-independent)"
      : independence === "unknown"
      ? " (verdict independence not declared — see agents/hatch3r-reviewer.md D15-M8)"
      : "";

  // Confidence reconciliation (Finding D13-21): when the deterministic,
  // iteration-derived reviewLoopConfidence is supplied alongside the reviewer's
  // self-assigned confidence, the floor is evaluated against the LOWER of the
  // two — the deterministic signal caps an over-confident self-rating. Absent
  // the deterministic signal, the self-assigned value is used unchanged.
  const selfAssigned = input.confidence;
  const effectiveConfidence: "high" | "medium" | "low" | "unknown" =
    input.reviewLoopConfidence !== undefined
      ? CONFIDENCE_RANK[input.reviewLoopConfidence] <= CONFIDENCE_RANK[selfAssigned]
        ? input.reviewLoopConfidence
        : selfAssigned
      : selfAssigned;
  const confidenceSourceNote =
    input.reviewLoopConfidence !== undefined
      ? ` (effective confidence = min(reviewLoopConfidence "${input.reviewLoopConfidence}", self-assigned "${selfAssigned}") = "${effectiveConfidence}" per D13-21)`
      : "";

  if (
    !Number.isFinite(input.severityCount.critical) ||
    !Number.isFinite(input.severityCount.warning) ||
    !Number.isFinite(input.severityCount.suggestion) ||
    input.severityCount.critical < 0 ||
    input.severityCount.warning < 0 ||
    input.severityCount.suggestion < 0
  ) {
    return {
      decision: "fail",
      reason: "malformed severity counts",
      verdictIndependence: independence,
      effectiveConfidence,
    };
  }
  if (input.severityCount.critical > 0) {
    return {
      decision: "fail",
      reason: `${input.severityCount.critical} Critical finding(s) require fixes`,
      verdictIndependence: independence,
      effectiveConfidence,
    };
  }
  if (input.severityCount.warning > 0) {
    return {
      decision: "fail",
      reason: `${input.severityCount.warning} Warning finding(s) require fixes`,
      verdictIndependence: independence,
      effectiveConfidence,
    };
  }
  // Pass threshold tightens with the confidence floor (D13-3 / D13-SA13.3-F13.3.3),
  // evaluated against the reconciled effectiveConfidence (D13-21):
  //   - floor "any"/"medium": a `high` OR `medium` effective confidence passes.
  //   - floor "high":         only a `high` effective confidence passes; `medium`
  //                           falls through to the second_pass/escalate path.
  // The floor never relaxes the Critical/Warning fail gates above; it only adds
  // second-pass pressure on otherwise-clean-but-uncertain verdicts.
  const passesFloor =
    effectiveConfidence === "high" ||
    (effectiveConfidence === "medium" && floor !== "high");
  if (passesFloor) {
    // Provider-independence gate on high-risk diffs (Findings D13-16 / D15-20 /
    // D7-18): a clean-and-floor-passing verdict on a security-touching diff that
    // is NOT provider-independent (same_family / unknown) must not pass on a
    // single review pass. Force a second (ideally cross-family) pass when budget
    // remains, else escalate. This makes verdictIndependence a gating input
    // rather than a no-op annotation, and scopes the forced second pass to
    // high-risk diffs only so everyday reviews are unaffected.
    const notProviderIndependent = independence !== "different_family";
    if (input.securityTouchingDiff && notProviderIndependent) {
      if (input.iterationBudgetRemaining > 0) {
        return {
          decision: "second_pass",
          reason: `Clean verdict with ${effectiveConfidence} confidence at floor "${floor}" on a security-touching diff, but the verdict is not provider-independent — forcing a second (ideally cross-model-class) review pass (${input.iterationBudgetRemaining} iterations remain)${independenceNote}${confidenceSourceNote}`,
          verdictIndependence: independence,
          effectiveConfidence,
        };
      }
      return {
        decision: "escalate",
        reason: `Clean verdict with ${effectiveConfidence} confidence at floor "${floor}" on a security-touching diff that is not provider-independent, with no iteration budget for a second pass; escalate to human operator${independenceNote}${confidenceSourceNote}`,
        verdictIndependence: independence,
        effectiveConfidence,
      };
    }
    return {
      decision: "pass",
      reason: `Clean verdict with ${effectiveConfidence} confidence at floor "${floor}"${independenceNote}${confidenceSourceNote}`,
      verdictIndependence: independence,
      effectiveConfidence,
    };
  }
  // Below the floor (floor "any"/"medium": low/unknown; floor "high": also medium).
  if (input.iterationBudgetRemaining > 0) {
    return {
      decision: "second_pass",
      reason: `${effectiveConfidence} confidence clean verdict below floor "${floor}"; retry review at higher rigor (${input.iterationBudgetRemaining} iterations remain)${independenceNote}${confidenceSourceNote}`,
      verdictIndependence: independence,
      effectiveConfidence,
    };
  }
  return {
    decision: "escalate",
    reason: `${effectiveConfidence} confidence clean verdict below floor "${floor}" with no iteration budget; escalate to human operator${independenceNote}${confidenceSourceNote}`,
    verdictIndependence: independence,
    effectiveConfidence,
  };
}
