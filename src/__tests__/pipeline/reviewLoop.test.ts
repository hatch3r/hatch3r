import { describe, it, expect } from "vitest";
import {
  createReviewLoop,
  canContinueReview,
  recordReviewIteration,
  terminateReviewLoop,
  reviewLoopSummary,
  reviewLoopConfidence,
  detectOscillation,
  enforceReviewIteration,
  assertReviewIterationAllowed,
  CALIBRATION,
  DEFAULT_MAX_REVIEW_ITERATIONS,
  HARD_MAX_REVIEW_ITERATIONS,
  MIN_MAX_REVIEW_ITERATIONS,
  type ReviewVerdict,
} from "../../pipeline/reviewLoop.js";
import { HatchError } from "../../types.js";

describe("reviewLoop", () => {
  describe("createReviewLoop", () => {
    it("should create a loop with default max iterations", () => {
      const state = createReviewLoop();
      expect(state.currentIteration).toBe(0);
      expect(state.maxIterations).toBe(DEFAULT_MAX_REVIEW_ITERATIONS);
      expect(state.terminated).toBe(false);
      expect(state.history).toHaveLength(0);
      expect(state.unresolvedFindings).toBe(0);
    });

    it("should accept custom max iterations", () => {
      const state = createReviewLoop(5);
      expect(state.maxIterations).toBe(5);
    });

    it("should clamp max iterations to MIN_MAX_REVIEW_ITERATIONS", () => {
      const state = createReviewLoop(0);
      expect(state.maxIterations).toBe(MIN_MAX_REVIEW_ITERATIONS);

      const stateNeg = createReviewLoop(-5);
      expect(stateNeg.maxIterations).toBe(MIN_MAX_REVIEW_ITERATIONS);
    });

    it("should clamp max iterations to HARD_MAX", () => {
      const state = createReviewLoop(999);
      expect(state.maxIterations).toBe(HARD_MAX_REVIEW_ITERATIONS);
    });
  });

  describe("canContinueReview", () => {
    it("should return true for a fresh loop", () => {
      const state = createReviewLoop(3);
      expect(canContinueReview(state)).toBe(true);
    });

    it("should return false for a terminated loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      expect(canContinueReview(state)).toBe(false);
    });

    it("should return false when max iterations reached", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      expect(canContinueReview(state)).toBe(false);
    });

    it("should return true when there are remaining iterations", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "critical", 5);
      expect(canContinueReview(state)).toBe(true);
    });
  });

  describe("recordReviewIteration", () => {
    it("should advance the iteration counter", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      expect(state.currentIteration).toBe(1);
      expect(state.history).toHaveLength(1);
      expect(state.history[0].verdict).toBe("warning");
      expect(state.history[0].findingsCount).toBe(2);
    });

    it("should terminate on clean verdict", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("clean");
      expect(state.unresolvedFindings).toBe(0);
      expect(state.currentIteration).toBe(2);
    });

    it("should terminate at max iterations with unresolved findings", () => {
      let state = createReviewLoop(2);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(state.unresolvedFindings).toBe(3);
    });

    it("should throw if loop is already terminated", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);

      expect(() => recordReviewIteration(state, "warning", 1)).toThrow(
        "already terminated",
      );
    });

    it("should throw if loop is at max iterations without termination", () => {
      // Create loop with max 1 and record critical (which terminates at max)
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 3);
      // Now it's terminated, so further recording should throw
      expect(() => recordReviewIteration(state, "warning", 1)).toThrow(
        "already terminated",
      );
    });

    it("should track full iteration history", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "critical", 10);
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);

      expect(state.history).toHaveLength(4);
      expect(state.history[0].iteration).toBe(1);
      expect(state.history[1].iteration).toBe(2);
      expect(state.history[2].iteration).toBe(3);
      expect(state.history[3].iteration).toBe(4);
      expect(state.history.every((h) => h.timestamp)).toBe(true);
    });
  });

  describe("terminateReviewLoop", () => {
    it("should manually terminate a running loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 5);
      state = terminateReviewLoop(state, 5);

      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("manual");
      expect(state.unresolvedFindings).toBe(5);
    });

    it("should be a no-op on an already terminated loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const before = { ...state };
      state = terminateReviewLoop(state, 99);

      expect(state.terminationReason).toBe("clean");
      expect(state.unresolvedFindings).toBe(before.unresolvedFindings);
    });

    it("should default to 0 unresolved findings", () => {
      let state = createReviewLoop(3);
      state = terminateReviewLoop(state);
      expect(state.unresolvedFindings).toBe(0);
    });
  });

  describe("reviewLoopSummary", () => {
    it("should summarize in-progress loop", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("1/3 iterations");
      expect(summary).toContain("in progress");
    });

    it("should summarize clean termination", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("clean verdict");
    });

    it("should summarize max iterations termination", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("max iterations reached");
      expect(summary).toContain("5 unresolved findings");
    });

    it("should summarize manual termination", () => {
      let state = createReviewLoop(3);
      state = terminateReviewLoop(state);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("manual stop");
    });
  });

  describe("programmatic enforcement", () => {
    it("should enforce max default iterations and surface remaining findings", () => {
      let state = createReviewLoop();

      // Simulate DEFAULT_MAX_REVIEW_ITERATIONS iterations that never reach clean.
      // The final iteration must terminate the loop with max_iterations.
      for (let i = 1; i < DEFAULT_MAX_REVIEW_ITERATIONS; i++) {
        state = recordReviewIteration(state, "critical", 10 - i);
        expect(canContinueReview(state)).toBe(true);
      }

      state = recordReviewIteration(state, "warning", 3);
      // After the final iteration (max), loop must be terminated
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(state.unresolvedFindings).toBe(3);
      expect(canContinueReview(state)).toBe(false);
    });

    it("default matches DEFAULT_MAX_REVIEW_ITERATIONS", () => {
      // Finding C7.5-W2B2-H26: the default was raised from 3 to 4 so
      // the oscillation detector can fire in default config.
      expect(DEFAULT_MAX_REVIEW_ITERATIONS).toBe(4);
    });

    it("opt-down to the pre-Cycle-7.5 default of 3 is accepted", () => {
      // Finding C7.5-W2B2-H26: callers that want the prior behaviour must
      // be able to configure it.
      const state = createReviewLoop(3);
      expect(state.maxIterations).toBe(3);
    });
  });

  describe("reviewLoopConfidence (Finding #68)", () => {
    it("should return high confidence for clean verdict on first iteration", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("high");
      expect(reviewLoopConfidence(state)).toBe("high");
    });

    it("should return medium confidence for clean verdict on second iteration", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("medium");
      expect(reviewLoopConfidence(state)).toBe("medium");
    });

    it("should return low confidence for clean verdict on third or later iteration", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "clean", 0);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should return low confidence for max_iterations termination", () => {
      let state = createReviewLoop(2);
      state = recordReviewIteration(state, "critical", 5);
      state = recordReviewIteration(state, "warning", 3);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should return low confidence for manual termination", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      state = terminateReviewLoop(state, 2);
      expect(state.confidence).toBe("low");
      expect(reviewLoopConfidence(state)).toBe("low");
    });

    it("should include confidence in summary for terminated loops", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "clean", 0);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("confidence: high");
    });

    it("should include low confidence in summary for max iterations", () => {
      let state = createReviewLoop(1);
      state = recordReviewIteration(state, "critical", 5);
      const summary = reviewLoopSummary(state);
      expect(summary).toContain("confidence: low");
    });

    it("should not include confidence in summary for in-progress loops", () => {
      let state = createReviewLoop(3);
      state = recordReviewIteration(state, "warning", 2);
      const summary = reviewLoopSummary(state);
      expect(summary).not.toContain("confidence:");
    });
  });

  describe("detectOscillation (#244, D8-8.11)", () => {
    it("should report insufficient data for fewer than 3 iterations", () => {
      let state = createReviewLoop(5);
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 3);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
      expect(result.description).toContain("Insufficient history");
    });

    it("should detect oscillation pattern: up-down-up", () => {
      let state = createReviewLoop(10);
      // Findings: 5 -> 2 -> 6 -> 1 (down, up, down = 2 direction changes)
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 6);
      state = recordReviewIteration(state, "warning", 1);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(true);
      expect(result.description).toContain("oscillation detected");
      expect(result.description).toContain("direction changes");
    });

    it("should not detect oscillation for monotonically decreasing findings", () => {
      let state = createReviewLoop(5);
      // Findings: 10 -> 7 -> 4 -> 1 (consistently decreasing)
      state = recordReviewIteration(state, "critical", 10);
      state = recordReviewIteration(state, "warning", 7);
      state = recordReviewIteration(state, "warning", 4);
      state = recordReviewIteration(state, "clean", 0);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should not detect oscillation for monotonically increasing findings", () => {
      let state = createReviewLoop(5);
      // Findings: 1 -> 3 -> 5 (consistently increasing -- bad but not oscillating)
      state = recordReviewIteration(state, "warning", 1);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 5);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should not detect oscillation for flat findings counts", () => {
      let state = createReviewLoop(5);
      // Findings: 3 -> 3 -> 3 (no direction at all)
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 3);
      state = recordReviewIteration(state, "warning", 3);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should report no oscillation for a single direction change", () => {
      let state = createReviewLoop(5);
      // Findings: 5 -> 2 -> 4 (down, up = 1 direction change, threshold is 2)
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 4);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(false);
    });

    it("should fire in default configuration (Finding C7.5-W2B2-H26)", () => {
      // Before Cycle 7.5 the default max was 3 which prevented the
      // detector from ever firing (4 entries are required for 2 direction
      // changes). With the new default of 4, an oscillating run now
      // triggers the detector.
      let state = createReviewLoop();
      expect(state.maxIterations).toBeGreaterThanOrEqual(4);
      // Findings: 5 -> 2 -> 6 -> 1 across the default iteration cap.
      state = recordReviewIteration(state, "warning", 5);
      state = recordReviewIteration(state, "warning", 2);
      state = recordReviewIteration(state, "warning", 6);
      state = recordReviewIteration(state, "warning", 1);
      const result = detectOscillation(state);
      expect(result.oscillating).toBe(true);
      expect(result.description).toContain("oscillation detected");
    });
  });

  describe("CALIBRATION (Finding C7.5-W2B2-H25)", () => {
    it("exposes a reproducible calibration record rather than a free-text comment", () => {
      expect(CALIBRATION).toBeDefined();
      expect(typeof CALIBRATION.basis).toBe("string");
      expect(["measured", "informed_estimate"]).toContain(CALIBRATION.basis);
      expect(typeof CALIBRATION.source).toBe("string");
      expect(CALIBRATION.source.length).toBeGreaterThan(0);
      expect(typeof CALIBRATION.sampleSize).toBe("number");
      expect(typeof CALIBRATION.measurementMethodRef).toBe("string");
    });

    it("exposes the claimed iteration-split distribution as structured data", () => {
      const s = CALIBRATION.split;
      expect(s.iteration1CleanRate).toBeCloseTo(0.78, 2);
      expect(s.iteration2CleanRate).toBeCloseTo(0.18, 2);
      expect(s.iteration3CleanRate).toBeCloseTo(0.04, 2);
      expect(s.iteration4PlusRate).toBeCloseTo(0.0, 2);
      const total =
        s.iteration1CleanRate +
        s.iteration2CleanRate +
        s.iteration3CleanRate +
        s.iteration4PlusRate;
      expect(total).toBeCloseTo(1.0, 2);
    });

    it("exposes measurable recalibration triggers", () => {
      const t = CALIBRATION.recalibrationTriggers;
      expect(t.iteration1CleanRateBelow).toBeGreaterThan(0);
      expect(t.iteration1CleanRateBelow).toBeLessThan(1);
      expect(t.oscillationRateAbove).toBeGreaterThan(0);
      expect(t.oscillationRateAbove).toBeLessThan(1);
    });

    it("is frozen to prevent runtime mutation of the claim", () => {
      expect(() => {
        // @ts-expect-error: intentional runtime mutation attempt
        CALIBRATION.basis = "measured";
      }).toThrow();
      expect(() => {
        // @ts-expect-error: nested readonly
        CALIBRATION.split.iteration1CleanRate = 0.99;
      }).toThrow();
    });

    it("declares measurement basis as informed_estimate until telemetry lands", () => {
      // The finding downgrades the claim pending per-finding iteration-count
      // telemetry. When telemetry ships, flipping basis to "measured" and
      // updating sampleSize + measuredAt is the explicit promotion path.
      expect(CALIBRATION.basis).toBe("informed_estimate");
      expect(CALIBRATION.sampleSize).toBe(0);
      expect(CALIBRATION.measuredAt).toBeNull();
    });
  });

  describe("runtime enforcement (Finding C7.5-W2B2-H40)", () => {
    describe("enforceReviewIteration", () => {
      it("returns allowed=true while under the iteration cap", () => {
        const initial = createReviewLoop(3);
        const result = enforceReviewIteration(initial, "warning", 5);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.state.currentIteration).toBe(1);
        expect(result.state.history).toHaveLength(1);
      });

      it("returns allowed=false with clean verdict termination", () => {
        const initial = createReviewLoop(3);
        const result = enforceReviewIteration(initial, "clean", 0);
        expect(result.allowed).toBe(false);
        expect(result.state.terminated).toBe(true);
        expect(result.state.terminationReason).toBe("clean");
      });

      it("returns allowed=false when the iteration cap is reached", () => {
        let state = createReviewLoop(2);
        const first = enforceReviewIteration(state, "warning", 3);
        expect(first.allowed).toBe(true);
        state = first.state;
        const second = enforceReviewIteration(state, "warning", 2);
        expect(second.allowed).toBe(false);
        expect(second.state.terminated).toBe(true);
        expect(second.state.terminationReason).toBe("max_iterations");
      });

      it("returns allowed=false without advancing when already terminated", () => {
        let state = createReviewLoop(3);
        state = recordReviewIteration(state, "clean", 0);
        const result = enforceReviewIteration(state, "warning", 5);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("already_terminated");
        expect(result.state).toBe(state);
      });

      it("returns allowed=false with reason when invoked past the cap", () => {
        // Manufacture a state where the loop is not marked terminated but
        // currentIteration has hit maxIterations (can happen if a caller
        // mutates state outside recordReviewIteration).
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        // After 1 iteration with max=1, state is terminated with max_iterations.
        // Reset the terminated flag to exercise the canContinueReview branch.
        const forced: typeof state = { ...state, terminated: false };
        const result = enforceReviewIteration(forced, "warning", 3);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("max_iterations_exceeded");
      });
    });

    describe("assertReviewIterationAllowed", () => {
      it("does not throw for a fresh loop", () => {
        const state = createReviewLoop(3);
        expect(() => assertReviewIterationAllowed(state)).not.toThrow();
      });

      it("throws HatchError when the loop is already terminated", () => {
        let state = createReviewLoop(3);
        state = recordReviewIteration(state, "clean", 0);
        expect(() => assertReviewIterationAllowed(state)).toThrow(HatchError);
        expect(() => assertReviewIterationAllowed(state)).toThrow(
          /already terminated/,
        );
      });

      it("throws HatchError when the loop is at max iterations", () => {
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        // State is terminated due to max-iterations; un-terminate to test
        // the "at max, not yet terminated" branch.
        const forced: typeof state = { ...state, terminated: false };
        expect(() => assertReviewIterationAllowed(forced)).toThrow(HatchError);
        expect(() => assertReviewIterationAllowed(forced)).toThrow(
          /maximum iterations/,
        );
      });

      it("throw includes CALIBRATION reference so operators can find the default's basis", () => {
        let state = createReviewLoop(1);
        state = recordReviewIteration(state, "warning", 3);
        const forced: typeof state = { ...state, terminated: false };
        expect(() => assertReviewIterationAllowed(forced)).toThrow(
          /CALIBRATION/,
        );
      });
    });

    it("enforceReviewIteration is usable as the per-iteration production gate", () => {
      // Simulates the orchestrator production path invoking the enforcement
      // function at every iteration. The loop must terminate within
      // maxIterations without any external bookkeeping.
      let state = createReviewLoop(3);
      const verdicts: Array<{ verdict: ReviewVerdict; findings: number }> = [
        { verdict: "critical", findings: 8 },
        { verdict: "warning", findings: 4 },
        { verdict: "warning", findings: 3 },
      ];
      let allowedCount = 0;
      for (const v of verdicts) {
        const r = enforceReviewIteration(state, v.verdict, v.findings);
        state = r.state;
        if (r.allowed) allowedCount++;
        else break;
      }
      // Max was 3 so all 3 iterations run; the final one ends with
      // max_iterations and allowed=false.
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(allowedCount).toBeLessThanOrEqual(state.maxIterations);
    });
  });
});
