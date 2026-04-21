/**
 * Exponential backoff retry for transient operations.
 *
 * Wraps an async function with retry-on-transient-failure semantics:
 * substantive failures (auth, 404, malformed config) propagate immediately,
 * while transient failures (network errors, 503, timeouts) are retried with
 * exponentially increasing delays up to a configurable cap.
 *
 * Reuses the failure classification from `circuitBreaker.ts` so the retry
 * decision matches the project's transient/substantive contract — the
 * circuit breaker counts only transient failures, and retryWithBackoff
 * retries only those same classes.
 *
 * Finding C7-C1 (D8 Critical): retry-with-backoff module wired into CLI
 * command code paths that call into adapters or external services.
 */
import { classifyFailure, type FailureType } from "./circuitBreaker.js";

// ── Constants ────────────────────────────────────────────────────

/** Default maximum number of attempts (inclusive of the first try). */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Default initial delay between retries in milliseconds. */
export const DEFAULT_INITIAL_DELAY_MS = 200;

/** Default ceiling for the per-attempt delay in milliseconds. */
export const DEFAULT_MAX_DELAY_MS = 5_000;

/** Default exponent applied to the delay between attempts. */
export const DEFAULT_BACKOFF_FACTOR = 2;

// ── Types ────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Inclusive maximum attempts. Clamped to [1, 20]. Default: 3. */
  maxAttempts?: number;
  /** First-retry delay in milliseconds. Default: 200. */
  initialDelayMs?: number;
  /** Per-attempt delay ceiling in milliseconds. Default: 5000. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay each attempt. Default: 2. */
  backoffFactor?: number;
  /**
   * Predicate deciding whether an error should trigger another attempt.
   * Default: classify via `circuitBreaker.classifyFailure` and retry only
   * for `transient` failures.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /**
   * Optional sleep override used by tests so they don't pay real wall time.
   * Defaults to `setTimeout`.
   */
  sleep?: (ms: number) => Promise<void>;
}

// ── Defaults ────────────────────────────────────────────────────

/** Default `shouldRetry`: retry only failures classified as `transient`. */
export function defaultShouldRetry(err: unknown, _attempt: number): boolean {
  const type: FailureType = classifyFailure(err);
  return type === "transient";
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Implementation ───────────────────────────────────────────────

/**
 * Compute the delay for a given attempt index using exponential backoff.
 *
 * Attempt 1 produces `initialDelayMs * backoffFactor^0`,
 * attempt 2 produces `initialDelayMs * backoffFactor^1`, and so on.
 * The result is clamped to `[0, maxDelayMs]`.
 */
export function computeBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = initialDelayMs * Math.pow(backoffFactor, exponent);
  if (!Number.isFinite(raw) || raw < 0) return Math.max(0, maxDelayMs);
  return Math.min(maxDelayMs, raw);
}

/**
 * Run `fn` and retry on transient failures with exponential backoff.
 *
 * If the function throws a substantive error (per `classifyFailure`), the
 * error propagates immediately without further attempts. After exhausting
 * `maxAttempts`, the last error is rethrown.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(20, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) break;
      if (!shouldRetry(err, attempt)) break;
      const delay = computeBackoffDelay(attempt, initialDelayMs, maxDelayMs, backoffFactor);
      if (delay > 0) await sleep(delay);
    }
  }

  throw lastError;
}
