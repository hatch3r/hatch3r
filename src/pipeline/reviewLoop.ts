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
 */

// ── Constants ────────────────────────────────────────────────────

/**
 * Default maximum review iterations before the loop must terminate.
 *
 * Calibration note (D7 finding 7.16): The default of 3 is based on observed
 * patterns across audit cycles 3-4 (233 resolved findings). Empirical data:
 * - 78% of changes pass review clean on iteration 1
 * - 18% require exactly 2 iterations (one fixer pass)
 * - 4% require 3 iterations; beyond 3, the fixer typically oscillates
 *   rather than converging (see detectOscillation below)
 * Recalibrate this value if the converging-on-iteration-1 rate drops below
 * 60% or if oscillation detection triggers on >10% of review loops.
 */
export const DEFAULT_MAX_REVIEW_ITERATIONS = 3;

/** Absolute ceiling -- even if configured higher, never exceed this. */
export const HARD_MAX_REVIEW_ITERATIONS = 10;

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
 * The max is clamped to [1, HARD_MAX_REVIEW_ITERATIONS] to prevent
 * misconfiguration from causing runaway loops or zero-iteration bypasses.
 */
export function createReviewLoop(
  maxIterations: number = DEFAULT_MAX_REVIEW_ITERATIONS,
): ReviewLoopState {
  const clamped = Math.max(1, Math.min(maxIterations, HARD_MAX_REVIEW_ITERATIONS));
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
    throw new Error(
      `Review loop already terminated (reason: ${state.terminationReason}). ` +
      `Cannot record iteration ${state.currentIteration + 1}.`,
    );
  }

  if (state.currentIteration >= state.maxIterations) {
    throw new Error(
      `Review loop at maximum iterations (${state.maxIterations}). ` +
      `Call terminateReviewLoop() to finalize.`,
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
