/**
 * Circuit breaker for shared external dependencies.
 *
 * #249 (D8-8.16): Prevents cascading failures when external services
 * (npm registry, MCP servers, etc.) are unavailable. The circuit breaker
 * tracks consecutive failures and temporarily short-circuits requests
 * to avoid wasting time on known-down services.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through.
 * - OPEN: Service is down, requests fail immediately.
 * - HALF_OPEN: After cooldown, one probe request is allowed.
 *
 * #250 (D8-8.17): Failure classification differentiates transient
 * (network timeout, 503) from substantive (404, auth) failures.
 * Only transient failures trip the circuit breaker.
 */

// ── Types ────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type FailureType = "transient" | "substantive" | "unknown";

export interface CircuitBreakerConfig {
  /** Number of consecutive transient failures before opening the circuit. */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN. */
  cooldownMs: number;
  /** Identifier for the external dependency (for logging). */
  serviceId: string;
}

export interface CircuitBreakerState {
  /** Current circuit state. */
  state: CircuitState;
  /** Number of consecutive transient failures. */
  consecutiveFailures: number;
  /** ISO timestamp of last failure, if any. */
  lastFailureAt: string | null;
  /** ISO timestamp of last success, if any. */
  lastSuccessAt: string | null;
  /** Total failure count since creation. */
  totalFailures: number;
  /** Total success count since creation. */
  totalSuccesses: number;
  /** Configuration. */
  config: CircuitBreakerConfig;
}

// ── Default Configs ──────────────────────────────────────────────

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 30_000, // 30 seconds
  serviceId: "unknown",
};

// ── Failure Classification (#250, D8-8.17) ───────────────────────

/**
 * Classify a failure as transient or substantive.
 *
 * Transient failures are temporary (network issues, server overload).
 * Substantive failures are permanent (bad config, auth errors).
 * Only transient failures contribute to circuit breaker tripping.
 */
export function classifyFailure(error: unknown): FailureType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const code = (error as NodeJS.ErrnoException).code;

    // Network-level transient failures
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" ||
        code === "ENOTFOUND" || code === "EPIPE" || code === "EAI_AGAIN") {
      return "transient";
    }

    // HTTP-level transient failures (503, 429, 502, 504)
    if (/\b(503|502|504|429)\b/.test(msg) || /service unavailable/i.test(msg) ||
        /too many requests/i.test(msg) || /gateway timeout/i.test(msg) ||
        /bad gateway/i.test(msg)) {
      return "transient";
    }

    // Timeout indicators
    if (/timeout|timed out/i.test(msg)) {
      return "transient";
    }

    // HTTP-level substantive failures (401, 403, 404, 422)
    if (/\b(401|403|404|422)\b/.test(msg) || /unauthorized/i.test(msg) ||
        /forbidden/i.test(msg) || /not found/i.test(msg)) {
      return "substantive";
    }

    // Configuration errors
    if (/invalid.*config/i.test(msg) || /malformed/i.test(msg) ||
        /missing.*required/i.test(msg)) {
      return "substantive";
    }
  }

  return "unknown";
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Create a new circuit breaker state.
 */
export function createCircuitBreaker(
  config: Partial<CircuitBreakerConfig> = {},
): CircuitBreakerState {
  return {
    state: "CLOSED",
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    totalFailures: 0,
    totalSuccesses: 0,
    config: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config },
  };
}

/**
 * Check if a request should be allowed through the circuit breaker.
 *
 * Returns the updated state and whether the request is allowed.
 */
export function shouldAllowRequest(
  state: CircuitBreakerState,
): { allowed: boolean; state: CircuitBreakerState; reason?: string } {
  switch (state.state) {
    case "CLOSED":
      return { allowed: true, state };

    case "OPEN": {
      // Check if cooldown period has elapsed
      if (state.lastFailureAt) {
        const elapsed = Date.now() - new Date(state.lastFailureAt).getTime();
        if (elapsed >= state.config.cooldownMs) {
          // Transition to HALF_OPEN -- allow one probe request
          return {
            allowed: true,
            state: { ...state, state: "HALF_OPEN" },
            reason: `Circuit half-open for ${state.config.serviceId}: allowing probe request after ${Math.round(elapsed / 1000)}s cooldown`,
          };
        }
      }
      return {
        allowed: false,
        state,
        reason: `Circuit open for ${state.config.serviceId}: ${state.consecutiveFailures} consecutive failures. Retry after cooldown.`,
      };
    }

    case "HALF_OPEN":
      // The single probe was granted when transitioning OPEN → HALF_OPEN.
      // Block concurrent callers until recordSuccess / recordFailure resolves it.
      return {
        allowed: false,
        state,
        reason: `Circuit half-open for ${state.config.serviceId}: probe already in flight`,
      };

    default:
      return { allowed: true, state };
  }
}

/**
 * Record a successful request through the circuit breaker.
 */
export function recordSuccess(
  state: CircuitBreakerState,
): CircuitBreakerState {
  return {
    ...state,
    state: "CLOSED",
    consecutiveFailures: 0,
    lastSuccessAt: new Date().toISOString(),
    totalSuccesses: state.totalSuccesses + 1,
  };
}

/**
 * Record a failed request through the circuit breaker.
 *
 * Only transient failures contribute to tripping the breaker.
 * Substantive failures are recorded but do not increment the counter.
 */
export function recordFailure(
  state: CircuitBreakerState,
  failureType: FailureType = "unknown",
): CircuitBreakerState {
  const now = new Date().toISOString();
  const newState = {
    ...state,
    lastFailureAt: now,
    totalFailures: state.totalFailures + 1,
  };

  // Only transient failures contribute to tripping the breaker
  if (failureType === "transient") {
    newState.consecutiveFailures = state.consecutiveFailures + 1;

    if (newState.consecutiveFailures >= state.config.failureThreshold) {
      newState.state = "OPEN";
    }
  }

  // In HALF_OPEN, any failure re-opens the circuit
  if (state.state === "HALF_OPEN") {
    newState.state = "OPEN";
    newState.consecutiveFailures = state.config.failureThreshold; // Keep at threshold
  }

  return newState;
}

/**
 * Get a human-readable summary of the circuit breaker state.
 */
export function circuitBreakerSummary(state: CircuitBreakerState): string {
  const parts: string[] = [
    `Circuit[${state.config.serviceId}]: ${state.state}`,
    `failures: ${state.consecutiveFailures}/${state.config.failureThreshold}`,
    `total: ${state.totalSuccesses}ok/${state.totalFailures}err`,
  ];

  if (state.state === "OPEN" && state.lastFailureAt) {
    const elapsed = Date.now() - new Date(state.lastFailureAt).getTime();
    const remaining = Math.max(0, state.config.cooldownMs - elapsed);
    parts.push(`cooldown: ${Math.round(remaining / 1000)}s remaining`);
  }

  return parts.join(" | ");
}
