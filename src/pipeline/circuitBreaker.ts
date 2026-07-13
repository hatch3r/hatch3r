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
 * Only transient failures trip the circuit breaker — in every state,
 * including the HALF_OPEN probe: a substantive/unknown probe failure proves
 * the dependency is reachable and CLOSES the circuit instead of re-opening
 * it (D1-SA1.9-03; see `recordFailure`).
 */

// ── Types ────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type FailureType = "transient" | "substantive" | "unknown";

/**
 * C7.5-W2B2-H28 (D8 rollover): Canonical enumeration of external-dependency
 * failure classes. Used by `classifyDependency` + `getRecoveryGuidance` to
 * attach actionable recovery text to error messages produced in sync/update
 * catch blocks. Each class maps 1:1 to an actionable hatch3r remediation
 * step. The list is closed: any failure not matching one of these classes
 * is classified as `"unknown"` and given a generic retry hint.
 *
 * - `network`: transport-level connectivity (DNS, TCP, socket) to any
 *   external HTTP endpoint (npm registry, GitHub API, MCP SSE, etc.).
 * - `filesystem`: local-disk I/O (ENOSPC, EACCES, EMFILE, EROFS, etc.).
 * - `adapter-spawn`: a spawned adapter subprocess could not be started
 *   or exited with a non-zero code before producing output.
 * - `mcp-transport`: MCP server transport (stdio/HTTP) initialization or
 *   protocol-level handshake failure.
 * - `package-manager`: npm/pnpm/yarn/bun registry fetch or install failure.
 * - `auth`: authentication/authorization failure against an external
 *   service (401/403, invalid token, expired credential).
 * - `unknown`: nothing above matched; generic retry hint is provided.
 */
export type DependencyClass =
  | "network"
  | "filesystem"
  | "adapter-spawn"
  | "mcp-transport"
  | "package-manager"
  | "auth"
  | "unknown";

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

// ── External-Dependency Classification (C7.5-W2B2-H28, D8) ───────

/**
 * Classify an error by the external dependency it implicates. This is
 * orthogonal to `classifyFailure` (which decides *transience*); callers
 * typically use both: `classifyFailure` decides whether the circuit
 * breaker trips, `classifyDependency` decides what remediation message
 * to show the user.
 *
 * Matching order is deliberate: errno codes first (most specific),
 * then MCP-specific message shape, then HTTP auth codes, then generic
 * network/HTTP signals, then package-manager markers. The first match
 * wins.
 */
export function classifyDependency(error: unknown): DependencyClass {
  if (!(error instanceof Error)) return "unknown";

  const msg = error.message.toLowerCase();
  const code = (error as NodeJS.ErrnoException).code;

  // Filesystem errno codes (local disk I/O).
  if (code === "EACCES" || code === "EPERM" || code === "ENOSPC" ||
      code === "EROFS" || code === "EISDIR" || code === "EMFILE" ||
      code === "ENFILE" || code === "ENOTDIR" || code === "EEXIST" ||
      code === "ENOENT") {
    return "filesystem";
  }

  // Network errno codes (DNS, TCP, socket).
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" ||
      code === "ENOTFOUND" || code === "EPIPE" || code === "EAI_AGAIN" ||
      code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "network";
  }

  // Subprocess spawn errors (adapter subprocesses, package manager shells).
  // ENOENT on an executable path surfaces as "spawn <cmd> ENOENT".
  if (/spawn\s+\S+\s+enoent/i.test(msg) || /spawn\s+\S+\s+eacces/i.test(msg) ||
      /\badapter\s+.*\s+(failed|did not complete|exited)/i.test(msg) ||
      /child process exited/i.test(msg)) {
    // Package-manager shells (npm/pnpm/yarn/bun) bubble up as spawn ENOENT
    // when the binary is missing; prefer package-manager classification.
    if (/spawn\s+(npm|pnpm|yarn|bun)\b/i.test(msg)) return "package-manager";
    return "adapter-spawn";
  }

  // MCP-specific transport markers.
  if (/\bmcp\b/i.test(msg) || /model context protocol/i.test(msg) ||
      /sse (stream|transport)/i.test(msg) ||
      /stdio transport/i.test(msg)) {
    return "mcp-transport";
  }

  // Authentication / authorization failures.
  if (/\b(401|403)\b/.test(msg) || /unauthorized/i.test(msg) ||
      /forbidden/i.test(msg) || /invalid (token|credential|api.?key)/i.test(msg) ||
      /expired (token|credential)/i.test(msg)) {
    return "auth";
  }

  // Package-manager / registry markers.
  if (/\bnpm\b/i.test(msg) || /\bpnpm\b/i.test(msg) || /\byarn\b/i.test(msg) ||
      /registry\.npmjs\.org/i.test(msg) || /package.*not.*found/i.test(msg) ||
      /ETARGET|E404/.test(msg)) {
    return "package-manager";
  }

  // Generic HTTP / network signals (after errno matches).
  if (/\b(502|503|504|429)\b/.test(msg) || /service unavailable/i.test(msg) ||
      /gateway timeout/i.test(msg) || /bad gateway/i.test(msg) ||
      /too many requests/i.test(msg) ||
      /\bfetch failed\b/i.test(msg) || /\bnetwork\b/i.test(msg) ||
      /timeout|timed out/i.test(msg)) {
    return "network";
  }

  return "unknown";
}

/**
 * Return a single-line recovery hint for the given dependency class.
 * Callers should append this to the user-facing error message so the
 * CLI satisfies P1 (actionable errors) per cli-ux-standards.md and
 * D8-SA8.1-1 (external-dependency failure enumeration with recovery
 * guidance).
 *
 * The hint is a complete sentence (leading capital, trailing period)
 * so it can be concatenated after the vendor error text with a space
 * separator.
 */
export function getRecoveryGuidance(
  dependencyClass: DependencyClass,
  failureType: FailureType = "unknown",
): string {
  switch (dependencyClass) {
    case "network":
      return failureType === "substantive"
        ? "Check the endpoint URL and your network configuration, then retry."
        : "This appears to be a transient network issue. Check connectivity and retry, or set HATCH3R_UPDATE_TIMEOUT_MS to raise the timeout.";
    case "filesystem":
      return "Check file permissions and available disk space, then retry. For permission errors, re-run from a writable working directory.";
    case "adapter-spawn":
      return "An adapter subprocess failed to start or exited early. Re-run with --verbose to see the adapter's output, or rerun `hatch3r update` to refresh canonical content.";
    case "mcp-transport":
      return "MCP server transport failed. Verify the server binary is installed, `.env.mcp` contains the required secrets, and the server is reachable.";
    case "package-manager":
      return failureType === "substantive"
        ? "The package or version was not found. Verify the package name in package.json and your registry configuration."
        : "Package manager request failed. Retry the command, or set HATCH3R_UPDATE_TIMEOUT_MS to raise the timeout.";
    case "auth":
      return "Authentication failed. Check credentials in `.env.mcp` (or your tokens for the underlying service) and retry.";
    case "unknown":
    default:
      return failureType === "transient"
        ? "This looks like a transient failure. Retry the command."
        : "Run with --verbose for details, or file an issue at https://github.com/denismasatovic/hatch3r/issues if the failure persists.";
  }
}

/**
 * Convenience helper: produce the full actionable error message for a
 * caught error by combining the raw message with the classified
 * recovery guidance. This is the one-liner intended for `logError` in
 * sync/update catch blocks.
 *
 * Example output:
 *   "claude: request timed out. This appears to be a transient network
 *    issue. Check connectivity and retry, or set HATCH3R_UPDATE_TIMEOUT_MS
 *    to raise the timeout."
 */
export function formatActionableError(
  context: string,
  error: unknown,
): { message: string; dependencyClass: DependencyClass; failureType: FailureType } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const dependencyClass = classifyDependency(error);
  const failureType = classifyFailure(error);
  const guidance = getRecoveryGuidance(dependencyClass, failureType);
  // Normalize punctuation between raw message and guidance.
  const trimmed = rawMessage.trimEnd().replace(/[.!?]$/, "");
  const message = `${context}: ${trimmed}. ${guidance}`;
  return { message, dependencyClass, failureType };
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
 * Only transient failures contribute to tripping the breaker — in EVERY
 * state. Substantive/unknown failures are recorded (timestamps + totals) but
 * never open or hold the circuit.
 *
 * HALF_OPEN probe resolution (D1-SA1.9-03, Cycle 12 Wave 3, D1, P2):
 *   - transient probe failure → re-OPEN (the dependency is still
 *     unavailable); counter pinned at the threshold.
 *   - substantive/unknown probe failure → CLOSE and reset the counter. A
 *     non-transient response (404, auth, bad config) is a DEFINITIVE answer
 *     from a reachable dependency — the availability question the probe asks
 *     is resolved positively; the failure itself surfaces to the caller
 *     through the normal error path, exactly as it would from CLOSED (where
 *     it also never trips the breaker).
 *   The pre-fix branch re-opened on ANY probe failure, contradicting the
 *   module invariant above and pinning a persistent substantive condition
 *   (e.g. a genuinely-missing package) into an OPEN/HALF_OPEN cycle for the
 *   24h persistence TTL. Leaving the state at HALF_OPEN instead was not an
 *   option: `shouldAllowRequest` blocks every request in HALF_OPEN ("probe
 *   already in flight"), so a neutral no-op would deadlock the breaker —
 *   resolution to CLOSED is the single-probe analogue of resilience4j's
 *   "ignored exceptions do not drive the half-open transition".
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

    // Transient failure on the HALF_OPEN probe: re-open and pin the counter
    // at the threshold (not threshold+1) so the cooldown cycle restarts from
    // a stable count.
    if (state.state === "HALF_OPEN") {
      newState.state = "OPEN";
      newState.consecutiveFailures = state.config.failureThreshold;
    }
  } else if (state.state === "HALF_OPEN") {
    // Substantive/unknown failure on the probe: the dependency answered, so
    // it is reachable — resolve the probe by closing the circuit and
    // resetting the transient streak (see JSDoc above).
    newState.state = "CLOSED";
    newState.consecutiveFailures = 0;
  }

  return newState;
}

// ── Persistence (D8-M4, Cycle 10 rollover) ───────────────────────
//
// Prior to D8-M4 the per-tool breaker map was rebuilt fresh on every
// `hatch3r sync`/`hatch3r update` invocation, so a recurring transient
// failure surface (a flaky MCP endpoint or a slow registry) had to trip
// the threshold from zero on every run. Persisting the breaker state to
// `.hatch3r/.breaker-state.jsonl` lets repeated invocations recognise an
// already-open circuit and short-circuit without burning the threshold
// budget again. Each entry is appended (JSONL) and the latest entry per
// serviceId wins; entries older than the TTL are discarded on read so
// stale state from a long-ago bad run cannot pin a circuit open.
//
// The on-disk schema is intentionally minimal: timestamp + the
// CircuitBreakerState snapshot. Persistence is best-effort and silent
// failures degrade to the in-memory default (no-op) so a permissions
// problem on `.hatch3r/` never blocks a sync.

/** Default filename for the persisted breaker log. */
export const BREAKER_STATE_FILE = ".breaker-state.jsonl";

/**
 * Time-to-live for persisted breaker entries, in milliseconds. Older entries
 * are ignored on read. 24h covers an overnight CI gap while preventing a
 * week-old transient outage from spuriously short-circuiting a fresh run.
 */
export const BREAKER_STATE_TTL_MS = 24 * 60 * 60 * 1000;

/** One persisted snapshot. The serviceId is on `state.config.serviceId`. */
export interface PersistedBreakerEntry {
  /** ISO-8601 timestamp the entry was written. */
  persistedAt: string;
  /** Full breaker state at the time of persistence. */
  state: CircuitBreakerState;
}

/**
 * Format a breaker state as a single JSONL line for append-only writes.
 * Returns the line WITHOUT a trailing newline so the caller controls
 * line termination (matches `failureLog.formatLogEntry`).
 */
export function formatBreakerStateEntry(state: CircuitBreakerState): string {
  const entry: PersistedBreakerEntry = {
    persistedAt: new Date().toISOString(),
    state,
  };
  return JSON.stringify(entry);
}

/**
 * Parse a JSONL breaker-state log into a serviceId → latest-state map.
 *
 * - Skips malformed lines (tolerant of in-flight rotation, partial writes).
 * - Discards entries older than {@link BREAKER_STATE_TTL_MS} relative to
 *   {@link nowMs} so stale state from a long-ago bad run cannot pin the
 *   circuit open.
 * - When multiple entries exist for the same serviceId, the latest entry
 *   (by persistedAt) wins.
 */
export function parseBreakerStateLog(
  content: string,
  nowMs: number = Date.now(),
): Map<string, CircuitBreakerState> {
  const result = new Map<string, CircuitBreakerState>();
  const latestPersistedAt = new Map<string, number>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: PersistedBreakerEntry;
    try {
      entry = JSON.parse(trimmed) as PersistedBreakerEntry;
    } catch {
      // Tolerate partial writes / corrupted lines without aborting the
      // whole log — the next sync will overwrite via append.
      continue;
    }
    if (
      typeof entry.persistedAt !== "string" ||
      !entry.state ||
      !entry.state.config ||
      typeof entry.state.config.serviceId !== "string"
    ) {
      continue;
    }
    const persistedAtMs = new Date(entry.persistedAt).getTime();
    if (Number.isNaN(persistedAtMs)) continue;
    // TTL gate: drop entries older than the budget.
    if (nowMs - persistedAtMs > BREAKER_STATE_TTL_MS) continue;
    const serviceId = entry.state.config.serviceId;
    const prevPersistedAt = latestPersistedAt.get(serviceId);
    if (prevPersistedAt === undefined || persistedAtMs > prevPersistedAt) {
      latestPersistedAt.set(serviceId, persistedAtMs);
      result.set(serviceId, entry.state);
    }
  }

  return result;
}

/**
 * Hydrate a Map<serviceId, breaker> from a previously persisted log content.
 * Empty content → empty map. Returns a *fresh* Map so callers can mutate
 * without affecting parser state.
 */
export function hydrateBreakersFromLog(
  content: string,
  nowMs: number = Date.now(),
): Map<string, CircuitBreakerState> {
  return parseBreakerStateLog(content, nowMs);
}

/**
 * Serialize a serviceId → breaker map to JSONL for atomic write. One line
 * per service; the caller is responsible for writing via
 * `atomicWriteFile` (or the equivalent). Returns the FULL log content
 * (replacing any prior log), not an append delta — this keeps the on-disk
 * file bounded by the number of distinct serviceIds rather than growing
 * unboundedly across sync invocations.
 */
export function serializeBreakerMap(
  breakers: Map<string, CircuitBreakerState>,
): string {
  if (breakers.size === 0) return "";
  const lines: string[] = [];
  for (const state of breakers.values()) {
    lines.push(formatBreakerStateEntry(state));
  }
  return lines.join("\n") + "\n";
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
