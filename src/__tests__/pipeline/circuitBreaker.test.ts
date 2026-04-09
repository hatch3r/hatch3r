import { describe, it, expect } from "vitest";
import {
  createCircuitBreaker,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  classifyFailure,
  circuitBreakerSummary,
  type CircuitBreakerState,
} from "../../pipeline/circuitBreaker.js";

describe("circuitBreaker", () => {
  describe("createCircuitBreaker", () => {
    it("should create a breaker in CLOSED state", () => {
      const cb = createCircuitBreaker({ serviceId: "npm" });
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.totalFailures).toBe(0);
      expect(cb.totalSuccesses).toBe(0);
      expect(cb.config.serviceId).toBe("npm");
    });

    it("should use default config when no overrides provided", () => {
      const cb = createCircuitBreaker();
      expect(cb.config.failureThreshold).toBe(3);
      expect(cb.config.cooldownMs).toBe(30_000);
    });

    it("should allow custom failureThreshold and cooldownMs", () => {
      const cb = createCircuitBreaker({ failureThreshold: 5, cooldownMs: 60_000, serviceId: "test" });
      expect(cb.config.failureThreshold).toBe(5);
      expect(cb.config.cooldownMs).toBe(60_000);
    });
  });

  describe("shouldAllowRequest", () => {
    it("should allow requests when circuit is CLOSED", () => {
      const cb = createCircuitBreaker({ serviceId: "test" });
      const result = shouldAllowRequest(cb);
      expect(result.allowed).toBe(true);
    });

    it("should block requests when circuit is OPEN and within cooldown", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 1 });
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("OPEN");
      const result = shouldAllowRequest(cb);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Circuit open");
    });

    it("should allow probe request after cooldown expires", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 1, cooldownMs: 0 });
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("OPEN");
      // With cooldownMs=0, should immediately transition to HALF_OPEN
      const result = shouldAllowRequest(cb);
      expect(result.allowed).toBe(true);
      expect(result.state.state).toBe("HALF_OPEN");
    });

    it("should block additional requests while HALF_OPEN probe is in flight", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 1, cooldownMs: 0 });
      cb = recordFailure(cb, "transient");
      const first = shouldAllowRequest(cb);
      expect(first.allowed).toBe(true);
      expect(first.state.state).toBe("HALF_OPEN");
      const second = shouldAllowRequest(first.state);
      expect(second.allowed).toBe(false);
      expect(second.state.state).toBe("HALF_OPEN");
      expect(second.reason).toContain("probe already in flight");
    });
  });

  describe("recordSuccess", () => {
    it("should reset circuit to CLOSED and clear failure count", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 3 });
      cb = recordFailure(cb, "transient");
      cb = recordFailure(cb, "transient");
      expect(cb.consecutiveFailures).toBe(2);

      cb = recordSuccess(cb);
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.totalSuccesses).toBe(1);
    });
  });

  describe("recordFailure", () => {
    it("should increment consecutive failures for transient errors", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 3 });
      cb = recordFailure(cb, "transient");
      expect(cb.consecutiveFailures).toBe(1);
      expect(cb.totalFailures).toBe(1);
      expect(cb.state).toBe("CLOSED");
    });

    it("should open circuit after reaching failure threshold", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 2 });
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("CLOSED");
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("OPEN");
    });

    it("should not increment consecutive failures for substantive errors", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 2 });
      cb = recordFailure(cb, "substantive");
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.totalFailures).toBe(1);
      expect(cb.state).toBe("CLOSED");
    });

    it("should re-open circuit on HALF_OPEN failure", () => {
      let cb: CircuitBreakerState = {
        state: "HALF_OPEN",
        consecutiveFailures: 3,
        lastFailureAt: new Date().toISOString(),
        lastSuccessAt: null,
        totalFailures: 3,
        totalSuccesses: 0,
        config: { failureThreshold: 3, cooldownMs: 30_000, serviceId: "test" },
      };
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("OPEN");
    });
  });

  describe("classifyFailure", () => {
    it("should classify ECONNREFUSED as transient", () => {
      const err = new Error("connect failed") as NodeJS.ErrnoException;
      err.code = "ECONNREFUSED";
      expect(classifyFailure(err)).toBe("transient");
    });

    it("should classify ETIMEDOUT as transient", () => {
      const err = new Error("timed out") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      expect(classifyFailure(err)).toBe("transient");
    });

    it("should classify 503 errors as transient", () => {
      expect(classifyFailure(new Error("HTTP 503 Service Unavailable"))).toBe("transient");
    });

    it("should classify 429 too many requests as transient", () => {
      expect(classifyFailure(new Error("429 Too Many Requests"))).toBe("transient");
    });

    it("should classify timeout messages as transient", () => {
      expect(classifyFailure(new Error("request timed out"))).toBe("transient");
    });

    it("should classify 401 as substantive", () => {
      expect(classifyFailure(new Error("401 Unauthorized"))).toBe("substantive");
    });

    it("should classify 404 as substantive", () => {
      expect(classifyFailure(new Error("404 Not Found"))).toBe("substantive");
    });

    it("should classify malformed config as substantive", () => {
      expect(classifyFailure(new Error("malformed JSON in config"))).toBe("substantive");
    });

    it("should classify unknown errors as unknown", () => {
      expect(classifyFailure(new Error("something weird happened"))).toBe("unknown");
    });

    it("should classify non-Error values as unknown", () => {
      expect(classifyFailure("string error")).toBe("unknown");
      expect(classifyFailure(42)).toBe("unknown");
    });
  });

  describe("circuitBreakerSummary", () => {
    it("should produce a readable summary for CLOSED state", () => {
      const cb = createCircuitBreaker({ serviceId: "npm-registry" });
      const summary = circuitBreakerSummary(cb);
      expect(summary).toContain("npm-registry");
      expect(summary).toContain("CLOSED");
      expect(summary).toContain("failures: 0/3");
    });

    it("should include cooldown info for OPEN state", () => {
      let cb = createCircuitBreaker({ serviceId: "mcp-server", failureThreshold: 1, cooldownMs: 30_000 });
      cb = recordFailure(cb, "transient");
      const summary = circuitBreakerSummary(cb);
      expect(summary).toContain("OPEN");
      expect(summary).toContain("cooldown");
    });
  });
});
