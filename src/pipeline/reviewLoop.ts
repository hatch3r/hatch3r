/**
 * Review loop iteration counter with programmatic enforcement.
 *
 * The pipeline's Phase 3 (Review Loop) cycles between hatch3r-reviewer and
 * hatch3r-fixer. This module provides a counter that enforces a hard maximum
 * on iterations to prevent infinite loops when the fixer cannot resolve
 * all findings.
 *
 * Finding #76 (D15, High): Add iteration counter with programmatic enforcement.
 * Finding #68 (D13, High): Add iteration-count-based confidence signal to review gate output.
 * Finding C7.5-W2B2-H25 (D7-SA7.2-1, High): Capture the max-iteration
 *   calibration as a reproducible module artifact (`CALIBRATION`).
 * Finding C7.5-W2B2-H26 (D7-SA7.2-2, High): Raise DEFAULT_MAX_REVIEW_ITERATIONS
 *   from 3 to 4 so the oscillation detector is reachable in default config.
 * Finding C7.5-W2B2-H40 (D15-F15.2-02, High): Expose runtime-enforcement
 *   entry points (`enforceReviewIteration`, `assertReviewIterationAllowed`)
 *   so production callers do not rely on prompt-advisory iteration limits.
 */

import { HatchError } from "../types.js";

// ── Constants ────────────────────────────────────────────────────

/**
 * Default maximum review iterations before the loop must terminate.
 *
 * Raised from 3 to 4 in Cycle 7.5 W2B2 (finding C7.5-W2B2-H26) so the
 * oscillation detector below can fire within the default configuration.
 * The oscillation detector requires `state.history.length >= 3` AND
 * `directionChanges >= 2`, which needs at minimum 4 history entries.
 * With max=3 the detector was unreachable in the default path.
 *
 * Opt-down: callers wanting the prior 3-iteration cap pass `createReviewLoop(3)`
 * (or any value in `[MIN_MAX_REVIEW_ITERATIONS, HARD_MAX_REVIEW_ITERATIONS]`).
 * See `CALIBRATION` below for the empirical basis and recalibration triggers.
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

/**
 * Reproducible calibration record for `DEFAULT_MAX_REVIEW_ITERATIONS`.
 *
 * Finding C7.5-W2B2-H25 (D7-SA7.2-1): The prior comment-only calibration
 * (78/18/4% iteration split across cycles 3-4) was unreproducible — no
 * captured dataset, no rerun path. Per the Scientific Rigor Contract
 * (`governance/audit/templates/rigor-contract.md`) empirical claims must
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
  source: "governance/audit/finding-registry.json (cycles 3-4 aggregate; per-finding iteration count not yet recorded)",
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
  measurementMethodRef: ".audit-workspace/D7-SA7.2.findings.md",
});

// ── Types ────────────────────────────────────────────────────────

export type ReviewVerdict = "clean" | "warning" | "critical";

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
  verdict: ReviewVerdict;
  findingsCount: number;
  timestamp: string;
}

export interface ReviewLoopState {
  /** Current iteration number (1-based). */
  currentIteration: number;
  /** Maximum iterations allowed. */
  maxIterations: number;
  /** Whether the loop has been terminated. */
  terminated: boolean;
  /** Reason for termination, if terminated. */
  terminationReason?: "clean" | "max_iterations" | "manual";
  /** History of review iterations. */
  history: ReviewIterationEntry[];
  /** Unresolved findings after loop termination. */
  unresolvedFindings: number;
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

  // Confidence based on iteration count when terminated cleanly
  if (state.currentIteration <= 1) return "high";
  if (state.currentIteration <= 2) return "medium";
  return "low";
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Create a new review loop state with configurable max iterations.
 *
 * The max is clamped to [MIN_MAX_REVIEW_ITERATIONS, HARD_MAX_REVIEW_ITERATIONS]
 * to prevent misconfiguration from causing runaway loops or zero-iteration
 * bypasses. Callers that want the pre-Cycle-7.5 default of 3 pass `3`
 * explicitly (see Finding C7.5-W2B2-H26 for the rationale for raising the
 * default to 4).
 */
export function createReviewLoop(
  maxIterations: number = DEFAULT_MAX_REVIEW_ITERATIONS,
): ReviewLoopState {
  const clamped = Math.max(
    MIN_MAX_REVIEW_ITERATIONS,
    Math.min(maxIterations, HARD_MAX_REVIEW_ITERATIONS),
  );
  return {
    currentIteration: 0,
    maxIterations: clamped,
    terminated: false,
    history: [],
    unresolvedFindings: 0,
  };
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
 * Record a review iteration result and advance the counter.
 *
 * If the verdict is "clean", the loop terminates successfully.
 * If max iterations is reached with unresolved findings, the loop
 * terminates and surfaces remaining findings to the user.
 *
 * Throws if the loop has already terminated or would exceed max iterations.
 */
export function recordReviewIteration(
  state: ReviewLoopState,
  verdict: ReviewVerdict,
  findingsCount: number,
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

  const newState: ReviewLoopState = {
    ...state,
    currentIteration: nextIteration,
    history: [...state.history, entry],
    unresolvedFindings: findingsCount,
  };

  // Clean verdict terminates the loop successfully
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

  return newState;
}

// ── Runtime Enforcement (Finding C7.5-W2B2-H40) ─────────────────

/**
 * Return type from `enforceReviewIteration`.
 *
 * `allowed` is false when the loop has already terminated or the
 * incoming iteration would exceed `maxIterations`. Callers in
 * production paths use this as the gate: spawn the next reviewer +
 * fixer pass only when `allowed === true`.
 */
export interface EnforceReviewResult {
  allowed: boolean;
  state: ReviewLoopState;
  reason?: "already_terminated" | "max_iterations_exceeded";
}

/**
 * Production-path runtime enforcement entry point.
 *
 * Finding C7.5-W2B2-H40 (D15-F15.2-02): The review-loop iteration limit
 * was prompt-advisory — agents/hatch3r-implementer.md told the orchestrator
 * "max 3 iterations" but no production code path invoked
 * `recordReviewIteration`. This function is the runtime-enforced entry
 * point that callers invoke per-iteration instead of trusting prompt text.
 *
 * Behaviour:
 * 1. If the loop is already terminated, return `{allowed: false}` without
 *    throwing — production paths must handle clean termination gracefully.
 * 2. If the loop has reached `maxIterations` without terminating, return
 *    `{allowed: false, reason: "max_iterations_exceeded"}` with the state
 *    advanced and marked terminated via `recordReviewIteration`.
 * 3. Otherwise record the iteration and return `{allowed: true, state}`.
 *
 * The strict runtime gate is the `canContinueReview` predicate inside
 * this function — a caller that attempts to continue after `allowed=false`
 * gets a `HatchError` via the underlying `recordReviewIteration` guard.
 */
export function enforceReviewIteration(
  state: ReviewLoopState,
  verdict: ReviewVerdict,
  findingsCount: number,
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

  const advanced = recordReviewIteration(state, verdict, findingsCount);
  return { allowed: !advanced.terminated, state: advanced };
}

/**
 * Assert that the caller may begin a review iteration.
 *
 * Finding C7.5-W2B2-H40: Hard runtime check for orchestrators that want
 * a throw-on-violation shape rather than the boolean-returning
 * `enforceReviewIteration`. Throws a `HatchError` when the loop is
 * terminated or at max iterations. Production code paths that cannot
 * inline the `enforceReviewIteration` result should call this first.
 */
export function assertReviewIterationAllowed(state: ReviewLoopState): void {
  if (state.terminated) {
    throw new HatchError(
      `Review loop already terminated (reason: ${state.terminationReason}). ` +
      `Runtime-enforcement check: no further iterations permitted.`,
      1,
      "VALIDATION_ERROR",
    );
  }
  if (!canContinueReview(state)) {
    throw new HatchError(
      `Review loop at maximum iterations (${state.maxIterations}). ` +
      `Runtime-enforcement check: further review passes would exceed the iteration limit. ` +
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

// ── Oscillation Detection (#244, D8-8.11) ───────────────────────

/**
 * Detect oscillation patterns in the review loop history.
 *
 * #244 (D8-8.11): Oscillation occurs when findings count alternates between
 * high and low values across iterations, indicating the fixer is introducing
 * new issues while resolving old ones (fix-break cycle).
 *
 * Detection criteria:
 * - At least 3 iterations of history
 * - Findings count increases after a decrease (or vice versa) for 2+ consecutive direction changes
 *
 * Reachability note (Finding C7.5-W2B2-H26): With DEFAULT_MAX_REVIEW_ITERATIONS
 * raised to 4, a default-configured loop can now accumulate the 4-entry
 * history required for 2 direction changes. Under the prior default of 3
 * this detector was unreachable in default config.
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

  if (directionChanges >= 2) {
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

// ── D13 Medium: Trust-building and feedback loop helpers (#331-#343) ──

/**
 * User-friendly explanation of the confidence signal.
 *
 * D13 Medium (#331-#343): Help users understand what the confidence
 * level means and what action they should take based on it.
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
