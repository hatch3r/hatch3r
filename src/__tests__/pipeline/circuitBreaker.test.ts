import { describe, it, expect } from "vitest";
import {
  createCircuitBreaker,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  classifyFailure,
  classifyDependency,
  getRecoveryGuidance,
  formatActionableError,
  circuitBreakerSummary,
  formatBreakerStateEntry,
  parseBreakerStateLog,
  hydrateBreakersFromLog,
  serializeBreakerMap,
  BREAKER_STATE_TTL_MS,
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

    it("should not increment consecutive failures for unknown errors", () => {
      let cb = createCircuitBreaker({ serviceId: "test", failureThreshold: 2 });
      cb = recordFailure(cb, "unknown");
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
      // Counter pinned at the threshold so the cooldown cycle restarts stably.
      expect(cb.consecutiveFailures).toBe(3);
    });

    // D1-SA1.9-03 (Cycle 12 Wave 3, D1, P2): the HALF_OPEN re-open is gated on
    // `transient`, honoring the module invariant "only transient failures trip
    // the breaker" in the one state where it matters most. A non-transient
    // probe outcome is a DEFINITIVE answer from a reachable dependency, so it
    // resolves the probe by CLOSING the circuit (staying HALF_OPEN would
    // deadlock: shouldAllowRequest blocks all requests in HALF_OPEN). The
    // pre-fix unconditional re-open pinned a persistent substantive condition
    // (e.g. a genuinely-missing package) into an OPEN/HALF_OPEN loop for the
    // 24h persistence TTL.
    function halfOpenState(): CircuitBreakerState {
      return {
        state: "HALF_OPEN",
        consecutiveFailures: 3,
        lastFailureAt: new Date().toISOString(),
        lastSuccessAt: null,
        totalFailures: 3,
        totalSuccesses: 0,
        config: { failureThreshold: 3, cooldownMs: 30_000, serviceId: "test" },
      };
    }

    it("closes the circuit on a SUBSTANTIVE failure in HALF_OPEN (reachability proven, D1-SA1.9-03)", () => {
      const cb = recordFailure(halfOpenState(), "substantive");
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0); // transient streak resolved
      expect(cb.totalFailures).toBe(4); // the failure is still recorded
      expect(cb.lastFailureAt).not.toBeNull();
    });

    it("closes the circuit on an UNKNOWN failure in HALF_OPEN (non-transient never holds the circuit)", () => {
      const cb = recordFailure(halfOpenState(), "unknown");
      expect(cb.state).toBe("CLOSED");
      expect(cb.consecutiveFailures).toBe(0);
      expect(cb.totalFailures).toBe(4);
    });

    it("after a substantive probe close, fresh transient failures re-trip the breaker from zero", () => {
      // The reset counter must give the dependency a full threshold budget
      // again — not trip on the first transient after the close.
      let cb = recordFailure(halfOpenState(), "substantive");
      expect(cb.state).toBe("CLOSED");
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("CLOSED");
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("CLOSED");
      cb = recordFailure(cb, "transient");
      expect(cb.state).toBe("OPEN"); // threshold=3 reached again
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

  // ── C7.5-W2B2-H28: External-Dependency Classification ──────────
  describe("classifyDependency", () => {
    it("classifies filesystem errno codes as filesystem", () => {
      const cases = ["EACCES", "EPERM", "ENOSPC", "EROFS", "EISDIR",
        "EMFILE", "ENFILE", "ENOTDIR", "EEXIST", "ENOENT"];
      for (const code of cases) {
        const err = new Error("io failure") as NodeJS.ErrnoException;
        err.code = code;
        expect(classifyDependency(err)).toBe("filesystem");
      }
    });

    it("classifies network errno codes as network", () => {
      const cases = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND",
        "EPIPE", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"];
      for (const code of cases) {
        const err = new Error("socket closed") as NodeJS.ErrnoException;
        err.code = code;
        expect(classifyDependency(err)).toBe("network");
      }
    });

    it("classifies adapter subprocess spawn failures as adapter-spawn", () => {
      expect(classifyDependency(new Error("spawn /usr/bin/claude ENOENT"))).toBe("adapter-spawn");
      expect(classifyDependency(new Error("child process exited with code 1"))).toBe("adapter-spawn");
      expect(classifyDependency(new Error("Adapter cursor did not complete"))).toBe("adapter-spawn");
    });

    it("classifies npm/pnpm/yarn/bun spawn ENOENT as package-manager", () => {
      expect(classifyDependency(new Error("spawn npm ENOENT"))).toBe("package-manager");
      expect(classifyDependency(new Error("spawn pnpm ENOENT"))).toBe("package-manager");
      expect(classifyDependency(new Error("spawn yarn EACCES"))).toBe("package-manager");
      expect(classifyDependency(new Error("spawn bun ENOENT"))).toBe("package-manager");
    });

    it("classifies MCP messages as mcp-transport", () => {
      expect(classifyDependency(new Error("MCP server handshake failed"))).toBe("mcp-transport");
      expect(classifyDependency(new Error("Model Context Protocol transport error"))).toBe("mcp-transport");
      expect(classifyDependency(new Error("SSE stream closed unexpectedly"))).toBe("mcp-transport");
      expect(classifyDependency(new Error("stdio transport write failed"))).toBe("mcp-transport");
    });

    it("classifies HTTP 401/403 and related markers as auth", () => {
      expect(classifyDependency(new Error("401 Unauthorized"))).toBe("auth");
      expect(classifyDependency(new Error("403 Forbidden"))).toBe("auth");
      expect(classifyDependency(new Error("invalid token"))).toBe("auth");
      expect(classifyDependency(new Error("invalid api-key"))).toBe("auth");
      expect(classifyDependency(new Error("expired credential"))).toBe("auth");
    });

    it("classifies package-manager markers as package-manager", () => {
      expect(classifyDependency(new Error("npm install failed: ETARGET"))).toBe("package-manager");
      expect(classifyDependency(new Error("request to registry.npmjs.org failed"))).toBe("package-manager");
      expect(classifyDependency(new Error("package was not found in registry"))).toBe("package-manager");
    });

    it("classifies generic HTTP 5xx/timeout as network", () => {
      expect(classifyDependency(new Error("HTTP 503 Service Unavailable"))).toBe("network");
      expect(classifyDependency(new Error("504 gateway timeout"))).toBe("network");
      expect(classifyDependency(new Error("fetch failed"))).toBe("network");
      expect(classifyDependency(new Error("request timed out"))).toBe("network");
    });

    it("returns unknown for non-Error values and unmatched messages", () => {
      expect(classifyDependency("string error")).toBe("unknown");
      expect(classifyDependency(42)).toBe("unknown");
      expect(classifyDependency(null)).toBe("unknown");
      expect(classifyDependency(undefined)).toBe("unknown");
      expect(classifyDependency(new Error("something weird happened"))).toBe("unknown");
    });

    it("gives filesystem errno precedence over spawn ENOENT message", () => {
      // An errno-coded error (e.g. fs.access returning EACCES) should be
      // classified as filesystem regardless of message shape.
      const err = new Error("EACCES: permission denied, open '/tmp/x'") as NodeJS.ErrnoException;
      err.code = "EACCES";
      expect(classifyDependency(err)).toBe("filesystem");
    });
  });

  describe("getRecoveryGuidance", () => {
    it("returns a non-empty actionable sentence for every DependencyClass", () => {
      const classes = ["network", "filesystem", "adapter-spawn",
        "mcp-transport", "package-manager", "auth", "unknown"] as const;
      for (const cls of classes) {
        const msg = getRecoveryGuidance(cls);
        expect(msg.length).toBeGreaterThan(10);
        expect(/[.!?]$/.test(msg)).toBe(true);
      }
    });

    it("varies network guidance by failure type", () => {
      const transient = getRecoveryGuidance("network", "transient");
      const substantive = getRecoveryGuidance("network", "substantive");
      expect(transient).toContain("transient");
      expect(substantive).toContain("network configuration");
      expect(transient).not.toBe(substantive);
    });

    it("varies package-manager guidance by failure type", () => {
      const transient = getRecoveryGuidance("package-manager", "transient");
      const substantive = getRecoveryGuidance("package-manager", "substantive");
      expect(transient).toContain("Retry");
      expect(substantive).toContain("package");
      expect(transient).not.toBe(substantive);
    });

    it("mentions .env.mcp for mcp-transport and auth guidance", () => {
      expect(getRecoveryGuidance("mcp-transport")).toContain(".env.mcp");
      expect(getRecoveryGuidance("auth")).toContain(".env.mcp");
    });

    it("mentions --verbose for adapter-spawn guidance", () => {
      expect(getRecoveryGuidance("adapter-spawn")).toContain("--verbose");
    });

    it("mentions disk space and permissions for filesystem guidance", () => {
      const msg = getRecoveryGuidance("filesystem");
      expect(msg).toContain("permissions");
      expect(msg).toContain("disk space");
    });

    it("unknown guidance varies by failure type", () => {
      const transient = getRecoveryGuidance("unknown", "transient");
      const substantive = getRecoveryGuidance("unknown", "substantive");
      expect(transient).not.toBe(substantive);
      expect(transient).toContain("Retry");
    });
  });

  describe("formatActionableError", () => {
    it("returns vendor message plus guidance plus classification metadata", () => {
      const err = new Error("HTTP 503 Service Unavailable");
      const out = formatActionableError("claude", err);
      expect(out.message).toContain("claude:");
      expect(out.message).toContain("HTTP 503 Service Unavailable");
      expect(out.message).toContain("transient network issue");
      expect(out.dependencyClass).toBe("network");
      expect(out.failureType).toBe("transient");
    });

    it("normalizes trailing punctuation before appending guidance", () => {
      const err = new Error("connection refused.");
      const out = formatActionableError("mcp", err);
      // No double period between vendor text and guidance.
      expect(out.message).not.toMatch(/\.\.\s/);
    });

    it("handles non-Error inputs without throwing", () => {
      const out = formatActionableError("sync", "raw string failure");
      expect(out.message).toContain("sync:");
      expect(out.dependencyClass).toBe("unknown");
      expect(out.failureType).toBe("unknown");
    });

    it("reports filesystem class for ENOSPC errors with disk guidance", () => {
      const err = new Error("no space left on device") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      const out = formatActionableError("merge", err);
      expect(out.dependencyClass).toBe("filesystem");
      expect(out.message).toContain("disk space");
    });

    it("reports mcp-transport for MCP handshake failures", () => {
      const err = new Error("MCP server handshake failed after 3s");
      const out = formatActionableError("mcp", err);
      expect(out.dependencyClass).toBe("mcp-transport");
      expect(out.message).toContain(".env.mcp");
    });

    it("reports auth for 401 Unauthorized with credential guidance", () => {
      const err = new Error("401 Unauthorized");
      const out = formatActionableError("update", err);
      expect(out.dependencyClass).toBe("auth");
      expect(out.message).toContain("credentials");
    });
  });

  // D8-M4 (Cycle 10 rollover): persisted-state JSONL + TTL semantics. The
  // adapter cohort under `hatch3r sync` / `hatch3r update` hydrates the
  // breaker map from `.hatch3r/.breaker-state.jsonl` so a recurring transient
  // failure surface is recognised as already-open across invocations.
  describe("persistence (D8-M4)", () => {
    it("formatBreakerStateEntry produces valid JSON with persistedAt + state", () => {
      const cb = createCircuitBreaker({ serviceId: "adapter:claude" });
      const line = formatBreakerStateEntry(cb);
      const parsed = JSON.parse(line) as { persistedAt: string; state: CircuitBreakerState };
      expect(typeof parsed.persistedAt).toBe("string");
      expect(parsed.state.config.serviceId).toBe("adapter:claude");
    });

    it("parseBreakerStateLog skips malformed lines without aborting", () => {
      const valid = formatBreakerStateEntry(createCircuitBreaker({ serviceId: "ok" }));
      const content = [valid, "not json at all", "{}", valid].join("\n");
      const map = parseBreakerStateLog(content);
      expect(map.size).toBe(1);
      expect(map.has("ok")).toBe(true);
    });

    it("parseBreakerStateLog drops entries older than the TTL", () => {
      const cb = createCircuitBreaker({ serviceId: "stale" });
      // Manually construct a stale entry (persistedAt = 48h ago).
      const staleEntry = {
        persistedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        state: cb,
      };
      const freshEntry = {
        persistedAt: new Date().toISOString(),
        state: createCircuitBreaker({ serviceId: "fresh" }),
      };
      const content = [JSON.stringify(staleEntry), JSON.stringify(freshEntry)].join("\n");
      const map = parseBreakerStateLog(content);
      expect(map.has("stale")).toBe(false);
      expect(map.has("fresh")).toBe(true);
    });

    it("parseBreakerStateLog keeps the latest entry when serviceId repeats", () => {
      const sid = "adapter:cursor";
      const olderState = createCircuitBreaker({ serviceId: sid });
      const newerState: CircuitBreakerState = {
        ...createCircuitBreaker({ serviceId: sid }),
        state: "OPEN",
        consecutiveFailures: 3,
      };
      const olderEntry = {
        persistedAt: new Date(Date.now() - 60_000).toISOString(),
        state: olderState,
      };
      const newerEntry = {
        persistedAt: new Date().toISOString(),
        state: newerState,
      };
      // Order in the log: older first, then newer. parse must pick newer.
      const content = [JSON.stringify(olderEntry), JSON.stringify(newerEntry)].join("\n");
      const map = parseBreakerStateLog(content);
      const got = map.get(sid);
      expect(got?.state).toBe("OPEN");
      expect(got?.consecutiveFailures).toBe(3);
    });

    it("hydrateBreakersFromLog returns an empty map for empty content", () => {
      expect(hydrateBreakersFromLog("").size).toBe(0);
      expect(hydrateBreakersFromLog("\n\n").size).toBe(0);
    });

    it("serializeBreakerMap returns empty string for empty input", () => {
      expect(serializeBreakerMap(new Map())).toBe("");
    });

    it("serializeBreakerMap → hydrateBreakersFromLog is a round-trip", () => {
      const a = createCircuitBreaker({ serviceId: "adapter:claude" });
      const b: CircuitBreakerState = {
        ...createCircuitBreaker({ serviceId: "adapter:cursor" }),
        state: "OPEN",
        consecutiveFailures: 3,
        lastFailureAt: new Date().toISOString(),
      };
      const inputMap = new Map<string, CircuitBreakerState>([
        ["adapter:claude", a],
        ["adapter:cursor", b],
      ]);
      const serialized = serializeBreakerMap(inputMap);
      const hydrated = hydrateBreakersFromLog(serialized);
      expect(hydrated.size).toBe(2);
      expect(hydrated.get("adapter:claude")?.state).toBe("CLOSED");
      expect(hydrated.get("adapter:cursor")?.state).toBe("OPEN");
      expect(hydrated.get("adapter:cursor")?.consecutiveFailures).toBe(3);
    });

    it("TTL constant exposes a 24h budget so callers can scale tests", () => {
      expect(BREAKER_STATE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
