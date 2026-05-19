import { describe, it, expect, vi } from "vitest";
import {
  retryWithBackoff,
  computeBackoffDelay,
  applyJitter,
  defaultShouldRetry,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
} from "../../pipeline/retryWithBackoff.js";

describe("retryWithBackoff", () => {
  describe("computeBackoffDelay", () => {
    it("should return initialDelayMs on attempt 1", () => {
      expect(computeBackoffDelay(1, 200, 5000, 2)).toBe(200);
    });

    it("should multiply by backoffFactor each attempt", () => {
      expect(computeBackoffDelay(2, 200, 5000, 2)).toBe(400);
      expect(computeBackoffDelay(3, 200, 5000, 2)).toBe(800);
      expect(computeBackoffDelay(4, 200, 5000, 2)).toBe(1600);
    });

    it("should clamp to maxDelayMs", () => {
      expect(computeBackoffDelay(10, 200, 5000, 2)).toBe(5000);
    });

    it("should never return negative", () => {
      expect(computeBackoffDelay(1, 0, 0, 2)).toBe(0);
    });
  });

  describe("defaults", () => {
    it("should expose documented default constants", () => {
      expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
      expect(DEFAULT_INITIAL_DELAY_MS).toBe(200);
      expect(DEFAULT_MAX_DELAY_MS).toBe(5000);
      expect(DEFAULT_BACKOFF_FACTOR).toBe(2);
    });
  });

  describe("defaultShouldRetry", () => {
    it("should retry on transient failure (network code)", () => {
      const err = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      expect(defaultShouldRetry(err, 1)).toBe(true);
    });

    it("should retry on transient failure (timeout message)", () => {
      const err = new Error("operation timed out");
      expect(defaultShouldRetry(err, 1)).toBe(true);
    });

    it("should NOT retry on substantive failure (404)", () => {
      const err = new Error("404 not found");
      expect(defaultShouldRetry(err, 1)).toBe(false);
    });

    it("should NOT retry on substantive failure (auth)", () => {
      const err = new Error("401 unauthorized");
      expect(defaultShouldRetry(err, 1)).toBe(false);
    });
  });

  describe("retryWithBackoff", () => {
    it("succeeds on first attempt without sleeping", async () => {
      const sleep = vi.fn(async () => {});
      const fn = vi.fn(async () => "ok");
      const result = await retryWithBackoff(fn, { sleep });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("succeeds on second attempt after one transient failure", async () => {
      const sleep = vi.fn(async () => {});
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          const err = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
          throw err;
        }
        return "ok";
      });

      const result = await retryWithBackoff(fn, {
        sleep,
        initialDelayMs: 50,
        maxDelayMs: 50,
        jitter: "none",
      });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(50);
    });

    it("gives up after maxAttempts and throws the last error", async () => {
      const sleep = vi.fn(async () => {});
      const fn = vi.fn(async () => {
        throw Object.assign(new Error("etimedout"), { code: "ETIMEDOUT" });
      });

      await expect(
        retryWithBackoff(fn, {
          sleep,
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 10,
          jitter: "none",
        }),
      ).rejects.toThrow(/etimedout/i);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on substantive failures", async () => {
      const sleep = vi.fn(async () => {});
      const fn = vi.fn(async () => {
        throw new Error("invalid config: missing key");
      });

      await expect(retryWithBackoff(fn, { sleep })).rejects.toThrow(/invalid config/);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("respects a custom shouldRetry predicate", async () => {
      const sleep = vi.fn(async () => {});
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        throw new Error("bespoke");
      });

      await expect(
        retryWithBackoff(fn, {
          sleep,
          maxAttempts: 4,
          initialDelayMs: 1,
          maxDelayMs: 1,
          jitter: "none",
          shouldRetry: (_err, attempt) => attempt < 2,
        }),
      ).rejects.toThrow(/bespoke/);
      // 1st attempt fails, predicate(1) true -> retry; 2nd attempt fails, predicate(2) false -> stop.
      expect(calls).toBe(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it("clamps maxAttempts to >=1 even when 0 is passed", async () => {
      const sleep = vi.fn(async () => {});
      const fn = vi.fn(async () => "ok");
      const result = await retryWithBackoff(fn, { sleep, maxAttempts: 0 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("uses the real setTimeout sleep when none is provided", async () => {
      // Single attempt path -- no sleep is invoked, but this exercises the
      // default-sleep code path so the realSleep arrow is covered.
      const fn = vi.fn(async () => "done");
      const result = await retryWithBackoff(fn);
      expect(result).toBe("done");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("triggers a real setTimeout sleep when retrying transient failures", async () => {
      // Force one retry with a tiny delay so the realSleep code path is
      // covered without slowing the test suite materially.
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          throw Object.assign(new Error("temporary"), { code: "ETIMEDOUT" });
        }
        return "ok";
      });
      const result = await retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      });
      expect(result).toBe("ok");
      expect(calls).toBe(2);
    });

    it("uses exponential backoff delays between attempts", async () => {
      const sleeps: number[] = [];
      const sleep = vi.fn(async (ms: number) => {
        sleeps.push(ms);
      });
      const fn = vi.fn(async () => {
        throw Object.assign(new Error("eai_again"), { code: "EAI_AGAIN" });
      });

      await expect(
        retryWithBackoff(fn, {
          sleep,
          maxAttempts: 4,
          initialDelayMs: 100,
          maxDelayMs: 10_000,
          backoffFactor: 3,
          jitter: "none",
        }),
      ).rejects.toThrow();

      // attempts 1,2,3 fail then sleep; attempt 4 fails and we stop.
      expect(sleeps).toEqual([100, 300, 900]);
    });
  });

  describe("applyJitter (C9-H1)", () => {
    it("returns baseDelay unchanged when strategy is 'none'", () => {
      expect(
        applyJitter(500, {
          strategy: "none",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0.99,
        }),
      ).toBe(500);
    });

    it("returns 0 when baseDelay is non-positive regardless of strategy", () => {
      for (const strategy of ["none", "full", "decorrelated"] as const) {
        expect(
          applyJitter(0, {
            strategy,
            initialDelayMs: 100,
            maxDelayMs: 5000,
            prevDelay: 0,
            random: () => 0.5,
          }),
        ).toBe(0);
      }
    });

    it("scales by random() under 'full' strategy", () => {
      // Full jitter: r * baseDelay (clamped to maxDelayMs).
      expect(
        applyJitter(1000, {
          strategy: "full",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0,
        }),
      ).toBe(0);
      expect(
        applyJitter(1000, {
          strategy: "full",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0.5,
        }),
      ).toBe(500);
      expect(
        applyJitter(1000, {
          strategy: "full",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0.999999,
        }),
      ).toBeCloseTo(999.999, 3);
    });

    it("respects maxDelayMs ceiling under 'full' strategy", () => {
      expect(
        applyJitter(10_000, {
          strategy: "full",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0.99,
        }),
      ).toBeLessThanOrEqual(5000);
    });

    it("seeds from initialDelayMs when prevDelay is 0 under 'decorrelated' strategy", () => {
      // First retry: prevDelay=0 → hi collapses to initialDelayMs.
      // U(initialDelayMs, initialDelayMs) is exactly initialDelayMs.
      expect(
        applyJitter(200, {
          strategy: "decorrelated",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 0,
          random: () => 0.7,
        }),
      ).toBe(100);
    });

    it("walks the bound U(initial, prevDelay*3) under 'decorrelated' strategy", () => {
      // initialDelayMs=100, prevDelay=200, so range is U(100, 600).
      // r=0 → 100; r=0.5 → 350; r=1 → 600.
      expect(
        applyJitter(800, {
          strategy: "decorrelated",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 200,
          random: () => 0,
        }),
      ).toBe(100);
      expect(
        applyJitter(800, {
          strategy: "decorrelated",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 200,
          random: () => 0.5,
        }),
      ).toBe(350);
      expect(
        applyJitter(800, {
          strategy: "decorrelated",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 200,
          random: () => 1,
        }),
      ).toBe(600);
    });

    it("clamps decorrelated walk to maxDelayMs", () => {
      // prevDelay*3 = 30_000, but maxDelayMs=5000 caps it.
      expect(
        applyJitter(10_000, {
          strategy: "decorrelated",
          initialDelayMs: 100,
          maxDelayMs: 5000,
          prevDelay: 10_000,
          random: () => 1,
        }),
      ).toBe(5000);
    });
  });

  describe("retryWithBackoff jitter integration (C9-H1)", () => {
    it("defaults to 'full' jitter when no strategy is provided", async () => {
      const sleeps: number[] = [];
      const sleep = vi.fn(async (ms: number) => {
        sleeps.push(ms);
      });
      const fn = vi.fn(async () => {
        throw Object.assign(new Error("transient"), { code: "ETIMEDOUT" });
      });
      // random() always returns 0.25 → full jitter picks 25% of baseDelay.
      await expect(
        retryWithBackoff(fn, {
          sleep,
          random: () => 0.25,
          maxAttempts: 3,
          initialDelayMs: 400,
          maxDelayMs: 5000,
          backoffFactor: 2,
        }),
      ).rejects.toThrow();
      // baseDelays would be [400, 800]; with full jitter at r=0.25 → [100, 200].
      expect(sleeps).toEqual([100, 200]);
    });

    it("threads decorrelated jitter through the prevDelay walk", async () => {
      const sleeps: number[] = [];
      const sleep = vi.fn(async (ms: number) => {
        sleeps.push(ms);
      });
      const fn = vi.fn(async () => {
        throw Object.assign(new Error("transient"), { code: "ETIMEDOUT" });
      });
      // r=1 → upper bound each iteration. With initial=100, max=5000:
      //   attempt 1: prevDelay=0 → U(100,100) → 100; prevDelay := 100.
      //   attempt 2: prevDelay=100 → U(100,300) → 300; prevDelay := 300.
      await expect(
        retryWithBackoff(fn, {
          sleep,
          random: () => 1,
          jitter: "decorrelated",
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffFactor: 2,
        }),
      ).rejects.toThrow();
      expect(sleeps).toEqual([100, 300]);
    });
  });
});
