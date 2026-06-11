import { describe, it, expect, vi } from "vitest";
import {
  clampTimeout,
  getDefaultPhaseTimeout,
  createPhaseTimeoutConfig,
  executeWithPhaseTimeout,
  PhaseTimeoutError,
  DEFAULT_PHASE_TIMEOUT_MS,
  MIN_PHASE_TIMEOUT_MS,
  MAX_PHASE_TIMEOUT_MS,
} from "../../pipeline/phaseTimeout.js";

describe("phaseTimeout", () => {
  describe("clampTimeout", () => {
    it("should return the value when within bounds", () => {
      expect(clampTimeout(60_000)).toBe(60_000);
    });

    it("should clamp to minimum", () => {
      expect(clampTimeout(100)).toBe(MIN_PHASE_TIMEOUT_MS);
      expect(clampTimeout(0)).toBe(MIN_PHASE_TIMEOUT_MS);
      expect(clampTimeout(-1)).toBe(MIN_PHASE_TIMEOUT_MS);
    });

    it("should clamp to maximum", () => {
      expect(clampTimeout(999_999_999)).toBe(MAX_PHASE_TIMEOUT_MS);
    });

    it("should accept exact boundary values", () => {
      expect(clampTimeout(MIN_PHASE_TIMEOUT_MS)).toBe(MIN_PHASE_TIMEOUT_MS);
      expect(clampTimeout(MAX_PHASE_TIMEOUT_MS)).toBe(MAX_PHASE_TIMEOUT_MS);
    });
  });

  describe("getDefaultPhaseTimeout", () => {
    it("should return known defaults for each phase", () => {
      expect(getDefaultPhaseTimeout("generation")).toBe(5 * 60 * 1000);
      expect(getDefaultPhaseTimeout("merge")).toBe(2 * 60 * 1000);
      expect(getDefaultPhaseTimeout("review")).toBe(10 * 60 * 1000);
      expect(getDefaultPhaseTimeout("fix")).toBe(10 * 60 * 1000);
      expect(getDefaultPhaseTimeout("validation")).toBe(2 * 60 * 1000);
      expect(getDefaultPhaseTimeout("integrity")).toBe(1 * 60 * 1000);
      expect(getDefaultPhaseTimeout("adapter")).toBe(3 * 60 * 1000);
    });
  });

  describe("createPhaseTimeoutConfig", () => {
    it("should use provided timeout", () => {
      const config = createPhaseTimeoutConfig(30_000);
      expect(config.timeoutMs).toBe(30_000);
    });

    it("should clamp provided timeout", () => {
      const config = createPhaseTimeoutConfig(1);
      expect(config.timeoutMs).toBe(MIN_PHASE_TIMEOUT_MS);
    });

    it("should use phase default when no timeout provided", () => {
      const config = createPhaseTimeoutConfig(undefined, "generation");
      expect(config.timeoutMs).toBe(5 * 60 * 1000);
    });

    it("should use global default when neither provided", () => {
      const config = createPhaseTimeoutConfig();
      expect(config.timeoutMs).toBe(DEFAULT_PHASE_TIMEOUT_MS);
    });
  });

  describe("executeWithPhaseTimeout", () => {
    it("should return completed result for fast operations", async () => {
      const result = await executeWithPhaseTimeout(
        "generation",
        async () => "done",
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(true);
      expect(result.result).toBe("done");
      expect(result.phase).toBe("generation");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return a non-completed timeout result when the phase exceeds its budget", async () => {
      // Fake timers fire the 10s clamp floor deterministically and instantly,
      // and also advance Date.now() so elapsedMs is exact. Without them this
      // test either waits 10s of real time or (with a sub-floor task) never
      // exercises the timeout branch at all. Pattern mirrors
      // pipelineTimeout.test.ts "rejects with PipelineTimeoutError ...".
      vi.useFakeTimers();
      try {
        const promise = executeWithPhaseTimeout(
          "merge",
          // Never resolves on its own — only the deadman timer can end it.
          () => new Promise<string>(() => {}),
          { timeoutMs: MIN_PHASE_TIMEOUT_MS },
        );
        // Cross the 10s clamp floor so the internal timer fires.
        await vi.advanceTimersByTimeAsync(MIN_PHASE_TIMEOUT_MS + 1);
        const result = await promise;

        // The completed:false branch (phaseTimeout.ts:158) is now exercised.
        expect(result.completed).toBe(false);
        expect(result.result).toBeUndefined();
        expect(result.phase).toBe("merge");
        // PhaseTimeoutError message names the phase and reports elapsed time.
        expect(result.error).toContain("merge");
        expect(result.error).toMatch(/elapsed: \d+s/);
        // Date.now() advanced under fake timers → elapsed reaches the budget.
        expect(result.elapsedMs).toBeGreaterThanOrEqual(MIN_PHASE_TIMEOUT_MS);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should propagate non-timeout errors", async () => {
      await expect(
        executeWithPhaseTimeout(
          "validation",
          async () => {
            throw new Error("test error");
          },
          { timeoutMs: 30_000 },
        ),
      ).rejects.toThrow("test error");
    });

    it("should use default phase timeout when no config provided", async () => {
      const result = await executeWithPhaseTimeout(
        "generation",
        async () => 42,
      );

      expect(result.completed).toBe(true);
      expect(result.result).toBe(42);
    });

    it("should report elapsed time", async () => {
      const result = await executeWithPhaseTimeout(
        "integrity",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "ok";
        },
        { timeoutMs: 30_000 },
      );

      expect(result.completed).toBe(true);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(40);
    });

    it("should abort the phase signal when the timeout fires", async () => {
      // Fake timers fire the 10s clamp floor instantly. The previous version
      // ran a real 10s setInterval and asserted only `phase`, so it never
      // checked that the signal actually aborted. The source aborts the inner
      // controller (phaseTimeout.ts:135) before rejecting; assert that abort
      // contract here. The completed:false timeout RESULT is covered by the
      // "non-completed timeout result" test above with a body that never
      // resolves — a body that resolves on abort can race the rejection, which
      // is why this test does not re-assert `completed`.
      vi.useFakeTimers();
      try {
        let observedAbort = false;
        // Hang forever so the only thing that touches the signal is the
        // timeout-driven abort; record it synchronously when it fires.
        const promise = executeWithPhaseTimeout(
          "adapter",
          (signal) =>
            new Promise<string>(() => {
              signal.addEventListener("abort", () => {
                observedAbort = true;
              });
            }),
          { timeoutMs: MIN_PHASE_TIMEOUT_MS },
        );
        await vi.advanceTimersByTimeAsync(MIN_PHASE_TIMEOUT_MS + 1);
        const result = await promise;

        expect(observedAbort).toBe(true);
        expect(result.completed).toBe(false);
        expect(result.phase).toBe("adapter");
        expect(result.error).toContain("adapter");
        expect(result.elapsedMs).toBeGreaterThanOrEqual(MIN_PHASE_TIMEOUT_MS);
      } finally {
        vi.useRealTimers();
      }
    });

    // ── C9-H20 (D8-H8.3.1): parentSignal threading ─────────────────
    it("aborts the inner signal when an external parentSignal fires mid-execution", async () => {
      const parent = new AbortController();
      let innerSignal: AbortSignal | undefined;
      const promise = executeWithPhaseTimeout(
        "adapter",
        async (signal) => {
          innerSignal = signal;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "ok";
        },
        { timeoutMs: 30_000 },
        parent.signal,
      );
      // Abort the parent before the task finishes.
      setTimeout(() => parent.abort(new Error("parent-cancelled")), 10);
      const result = await promise;
      expect(innerSignal?.aborted).toBe(true);
      // Phase still reports as "completed" because the task itself
      // resolved with "ok" — but the inner signal was forwarded.
      expect(result.phase).toBe("adapter");
    });

    it("propagates an already-aborted parentSignal to the inner signal immediately", async () => {
      const parent = new AbortController();
      parent.abort(new Error("pre-aborted"));
      let observedAbortedOnEntry = false;
      const result = await executeWithPhaseTimeout(
        "adapter",
        async (signal) => {
          observedAbortedOnEntry = signal.aborted;
          return "ran";
        },
        { timeoutMs: 30_000 },
        parent.signal,
      );
      expect(observedAbortedOnEntry).toBe(true);
      expect(result.phase).toBe("adapter");
    });
  });

  describe("PhaseTimeoutError", () => {
    it("should have correct properties", () => {
      const err = new PhaseTimeoutError("generation", 30_000, 31_000);
      expect(err.name).toBe("PhaseTimeoutError");
      expect(err.phase).toBe("generation");
      expect(err.timeoutMs).toBe(30_000);
      expect(err.elapsedMs).toBe(31_000);
      expect(err.message).toContain("generation");
      expect(err.message).toContain("30s");
    });

    it("should include phase name in message", () => {
      const err = new PhaseTimeoutError("review", 60_000, 65_000);
      expect(err.message).toContain("review");
    });
  });
});
