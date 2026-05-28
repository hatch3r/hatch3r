import { describe, it, expect, vi } from "vitest";
import {
  clampPipelineTimeout,
  createPipelineExecution,
  isPipelineTimedOut,
  getRemainingTime,
  markPhaseStarted,
  markPhaseCompleted,
  markPhaseSkipped,
  terminatePipeline,
  pipelineProgressSummary,
  runWithPipelineDeadman,
  runWithDeadmanTracker,
  PipelineTimeoutError,
  DEFAULT_PIPELINE_TIMEOUT_MS,
  MIN_PIPELINE_TIMEOUT_MS,
  MAX_PIPELINE_TIMEOUT_MS,
} from "../../pipeline/pipelineTimeout.js";

describe("pipelineTimeout", () => {
  describe("clampPipelineTimeout", () => {
    it("should return value when within bounds", () => {
      expect(clampPipelineTimeout(60_000)).toBe(60_000);
    });

    it("should clamp to minimum", () => {
      expect(clampPipelineTimeout(100)).toBe(MIN_PIPELINE_TIMEOUT_MS);
      expect(clampPipelineTimeout(0)).toBe(MIN_PIPELINE_TIMEOUT_MS);
    });

    it("should clamp to maximum", () => {
      expect(clampPipelineTimeout(999_999_999)).toBe(MAX_PIPELINE_TIMEOUT_MS);
    });
  });

  describe("createPipelineExecution", () => {
    it("should create state with default timeout", () => {
      const state = createPipelineExecution(["generation", "merge"]);
      expect(state.running).toBe(true);
      expect(state.timeoutMs).toBe(DEFAULT_PIPELINE_TIMEOUT_MS);
      expect(state.phases).toHaveLength(2);
      expect(state.phases[0].phase).toBe("generation");
      expect(state.phases[0].status).toBe("pending");
      expect(state.phases[1].phase).toBe("merge");
      expect(state.phases[1].status).toBe("pending");
      expect(state.timedOut).toBe(false);
    });

    it("should accept custom timeout", () => {
      const state = createPipelineExecution(["generation"], 60_000);
      expect(state.timeoutMs).toBe(60_000);
    });

    it("should clamp timeout", () => {
      const state = createPipelineExecution(["generation"], 1);
      expect(state.timeoutMs).toBe(MIN_PIPELINE_TIMEOUT_MS);
    });

    it("should set startedAt to ISO timestamp", () => {
      const state = createPipelineExecution(["generation"]);
      expect(() => new Date(state.startedAt)).not.toThrow();
    });
  });

  describe("isPipelineTimedOut", () => {
    it("should return false for a fresh pipeline", () => {
      const state = createPipelineExecution(["generation"], 60_000);
      expect(isPipelineTimedOut(state)).toBe(false);
    });

    it("should return true when timedOut flag is set", () => {
      const state = createPipelineExecution(["generation"], 60_000);
      const { state: terminated } = terminatePipeline(state);
      expect(isPipelineTimedOut(terminated)).toBe(true);
    });

    it("should return true when elapsed exceeds timeout", () => {
      const state = createPipelineExecution(["generation"], MIN_PIPELINE_TIMEOUT_MS);
      // Fake the startedAt to the past
      const past = new Date(Date.now() - MIN_PIPELINE_TIMEOUT_MS - 1000).toISOString();
      const staleState = { ...state, startedAt: past };
      expect(isPipelineTimedOut(staleState)).toBe(true);
    });
  });

  describe("getRemainingTime", () => {
    it("should return positive time for a fresh pipeline", () => {
      const state = createPipelineExecution(["generation"], 60_000);
      expect(getRemainingTime(state)).toBeGreaterThan(0);
    });

    it("should return 0 when timeout is exceeded", () => {
      const state = createPipelineExecution(["generation"], MIN_PIPELINE_TIMEOUT_MS);
      const past = new Date(Date.now() - MIN_PIPELINE_TIMEOUT_MS - 1000).toISOString();
      const staleState = { ...state, startedAt: past };
      expect(getRemainingTime(staleState)).toBe(0);
    });
  });

  describe("markPhaseStarted", () => {
    it("should mark the phase as in_progress", () => {
      const state = createPipelineExecution(["generation", "merge"]);
      const updated = markPhaseStarted(state, "generation");
      expect(updated.phases[0].status).toBe("in_progress");
      expect(updated.phases[0].startedAt).toBeDefined();
      expect(updated.phases[1].status).toBe("pending");
    });
  });

  describe("markPhaseCompleted", () => {
    it("should mark the phase as completed with elapsed time", () => {
      let state = createPipelineExecution(["generation", "merge"]);
      state = markPhaseStarted(state, "generation");
      const updated = markPhaseCompleted(state, "generation", 1500);
      expect(updated.phases[0].status).toBe("completed");
      expect(updated.phases[0].elapsedMs).toBe(1500);
      expect(updated.phases[0].completedAt).toBeDefined();
    });
  });

  describe("markPhaseSkipped", () => {
    it("should mark the phase as skipped", () => {
      const state = createPipelineExecution(["generation", "merge"]);
      const updated = markPhaseSkipped(state, "merge");
      expect(updated.phases[1].status).toBe("skipped");
      expect(updated.phases[0].status).toBe("pending");
    });
  });

  describe("terminatePipeline", () => {
    it("should mark in-progress phases as timed_out", () => {
      let state = createPipelineExecution(["generation", "merge", "review"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      state = markPhaseStarted(state, "merge");

      const { state: terminated } = terminatePipeline(state);

      expect(terminated.running).toBe(false);
      expect(terminated.timedOut).toBe(true);
      expect(terminated.terminatedAt).toBeDefined();
      expect(terminated.completionSummary).toBeDefined();

      expect(terminated.phases[0].status).toBe("completed");
      expect(terminated.phases[1].status).toBe("timed_out");
      expect(terminated.phases[2].status).toBe("pending");
    });

    it("should produce accurate termination report", () => {
      let state = createPipelineExecution(["generation", "merge", "review"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      state = markPhaseStarted(state, "merge");

      const { report } = terminatePipeline(state);

      expect(report.completedAll).toBe(false);
      expect(report.completedPhases).toEqual(["generation"]);
      expect(report.interruptedPhase).toBe("merge");
      expect(report.pendingPhases).toEqual(["review"]);
      expect(report.totalElapsedMs).toBeGreaterThanOrEqual(0);
      expect(report.summary).toContain("generation");
      expect(report.summary).toContain("merge");
      expect(report.summary).toContain("review");
    });

    it("should report completedAll when all phases done", () => {
      let state = createPipelineExecution(["generation", "merge"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      state = markPhaseCompleted(markPhaseStarted(state, "merge"), "merge", 500);

      const { report } = terminatePipeline(state);
      expect(report.completedAll).toBe(true);
      expect(report.interruptedPhase).toBeUndefined();
      expect(report.pendingPhases).toHaveLength(0);
    });

    it("should include partial result in timed_out phase", () => {
      let state = createPipelineExecution(["generation"]);
      state = markPhaseStarted(state, "generation");

      const { state: terminated } = terminatePipeline(state, "partial output here");
      expect(terminated.phases[0].partialResult).toBe("partial output here");
    });

    it("should handle skipped phases in report", () => {
      let state = createPipelineExecution(["generation", "merge", "review"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      state = markPhaseSkipped(state, "merge");

      const { report } = terminatePipeline(state);
      expect(report.completedPhases).toEqual(["generation"]);
      expect(report.pendingPhases).toEqual(["review"]);
    });
  });

  describe("pipelineProgressSummary", () => {
    it("should include elapsed and remaining time", () => {
      const state = createPipelineExecution(["generation", "merge"]);
      const summary = pipelineProgressSummary(state);
      expect(summary).toContain("elapsed");
      expect(summary).toContain("remaining");
      expect(summary).toContain("Phases: 0/2 completed");
    });

    it("should show running phase", () => {
      let state = createPipelineExecution(["generation", "merge"]);
      state = markPhaseStarted(state, "generation");
      const summary = pipelineProgressSummary(state);
      expect(summary).toContain("running generation");
    });

    it("should show TIMED OUT status", () => {
      let state = createPipelineExecution(["generation"]);
      state = markPhaseStarted(state, "generation");
      const { state: terminated } = terminatePipeline(state);
      const summary = pipelineProgressSummary(terminated);
      expect(summary).toContain("TIMED OUT");
    });

    it("should show finished status when not running", () => {
      let state = createPipelineExecution(["generation"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      const { state: finished } = terminatePipeline(state);
      // Since all phases completed, timedOut is false
      const summary = pipelineProgressSummary(finished);
      expect(summary).toContain("finished");
    });

    it("should show completed count", () => {
      let state = createPipelineExecution(["generation", "merge", "review"]);
      state = markPhaseCompleted(markPhaseStarted(state, "generation"), "generation", 1000);
      state = markPhaseCompleted(markPhaseStarted(state, "merge"), "merge", 500);
      const summary = pipelineProgressSummary(state);
      expect(summary).toContain("2/3 completed");
    });
  });

  // F8.3.4: top-level deadman timer that fires on wall-clock time even when an
  // inner phase hangs without yielding back to the post-loop timeout check.
  describe("runWithPipelineDeadman (F8.3.4)", () => {
    it("returns the body result when the body resolves before the deadman", async () => {
      const result = await runWithPipelineDeadman(async () => 42);
      expect(result).toBe(42);
    });

    it("passes a non-aborted AbortSignal to the body on the happy path", async () => {
      let observed: AbortSignal | undefined;
      const result = await runWithPipelineDeadman(async (signal) => {
        observed = signal;
        return "ok";
      });
      expect(result).toBe("ok");
      expect(observed).toBeInstanceOf(AbortSignal);
      expect(observed?.aborted).toBe(false);
    });

    it("propagates a body rejection unchanged (deadman does not mask it)", async () => {
      await expect(
        runWithPipelineDeadman(async () => {
          throw new Error("body failed");
        }),
      ).rejects.toThrow("body failed");
    });

    it("rejects with PipelineTimeoutError and aborts the signal when the budget elapses", async () => {
      vi.useFakeTimers();
      try {
        let abortedDuringRun = false;
        const promise = runWithPipelineDeadman((signal) => {
          // A body that never resolves on its own — only the deadman can end it.
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              abortedDuringRun = true;
              reject(new PipelineTimeoutError(MIN_PIPELINE_TIMEOUT_MS, MIN_PIPELINE_TIMEOUT_MS));
            });
          });
        }, MIN_PIPELINE_TIMEOUT_MS);

        // Attach the rejection expectation before advancing timers so the
        // unhandled-rejection guard does not trip.
        const assertion = expect(promise).rejects.toBeInstanceOf(PipelineTimeoutError);
        await vi.advanceTimersByTimeAsync(MIN_PIPELINE_TIMEOUT_MS + 1);
        await assertion;
        expect(abortedDuringRun).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clamps a sub-minimum budget up to MIN before arming the deadman", async () => {
      vi.useFakeTimers();
      try {
        const promise = runWithPipelineDeadman(
          () => new Promise<never>(() => {}),
          10, // below MIN; clamps to MIN_PIPELINE_TIMEOUT_MS
        );
        const assertion = expect(promise).rejects.toBeInstanceOf(PipelineTimeoutError);
        // Just under MIN: deadman must NOT have fired yet.
        await vi.advanceTimersByTimeAsync(MIN_PIPELINE_TIMEOUT_MS - 1);
        // Cross MIN: now it fires.
        await vi.advanceTimersByTimeAsync(2);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it("PipelineTimeoutError carries the budget and elapsed time", () => {
      const err = new PipelineTimeoutError(30_000, 31_000);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("PipelineTimeoutError");
      expect(err.timeoutMs).toBe(30_000);
      expect(err.elapsedMs).toBe(31_000);
      expect(err.message).toContain("deadman");
    });
  });

  // D8-M7 (Cycle 10 rollover): combined deadman + tracker wrapper so new
  // call sites cannot wire the AbortController and the post-hoc
  // PipelineExecutionState observer out of phase.
  describe("runWithDeadmanTracker (D8-M7)", () => {
    it("returns body value and state tracker on happy path", async () => {
      const phases = ["adapter", "merge"] as const;
      const { value, state } = await runWithDeadmanTracker(
        [...phases],
        async (tracker, signal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(tracker.phases.length).toBe(2);
          return 42;
        },
      );
      expect(value).toBe(42);
      expect(state.phases.length).toBe(2);
      expect(state.phases[0].phase).toBe("adapter");
    });

    it("threads the abort signal so a long body can observe abortion", async () => {
      vi.useFakeTimers();
      try {
        let observedAbort = false;
        const promise = runWithDeadmanTracker(
          ["adapter"],
          (_tracker, signal) =>
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                observedAbort = true;
                reject(new PipelineTimeoutError(MIN_PIPELINE_TIMEOUT_MS, MIN_PIPELINE_TIMEOUT_MS));
              });
            }),
          MIN_PIPELINE_TIMEOUT_MS,
        );
        const assertion = expect(promise).rejects.toBeInstanceOf(PipelineTimeoutError);
        await vi.advanceTimersByTimeAsync(MIN_PIPELINE_TIMEOUT_MS + 1);
        await assertion;
        expect(observedAbort).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
