import { describe, it, expect } from "vitest";
import {
  createReviewLoop,
  canContinueReview,
  recordReviewIteration,
  terminateReviewLoop,
  reviewLoopSummary,
  reviewLoopConfidence,
  detectOscillation,
  DEFAULT_MAX_REVIEW_ITERATIONS,
  HARD_MAX_REVIEW_ITERATIONS,
} from "../../pipeline/reviewLoop.js";

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

    it("should clamp max iterations to at least 1", () => {
      const state = createReviewLoop(0);
      expect(state.maxIterations).toBe(1);

      const stateNeg = createReviewLoop(-5);
      expect(stateNeg.maxIterations).toBe(1);
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
    it("should enforce max 3 iterations by default and surface remaining findings", () => {
      let state = createReviewLoop();

      // Simulate 3 iterations that never reach clean
      state = recordReviewIteration(state, "critical", 10);
      expect(canContinueReview(state)).toBe(true);

      state = recordReviewIteration(state, "warning", 5);
      expect(canContinueReview(state)).toBe(true);

      state = recordReviewIteration(state, "warning", 3);
      // After 3rd iteration (max), loop must be terminated
      expect(state.terminated).toBe(true);
      expect(state.terminationReason).toBe("max_iterations");
      expect(state.unresolvedFindings).toBe(3);
      expect(canContinueReview(state)).toBe(false);
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
  });
});
