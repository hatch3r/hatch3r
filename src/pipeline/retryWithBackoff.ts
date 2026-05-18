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
  /**
   * Jitter strategy applied to the computed backoff delay (C9-H1).
   *
   * `none` — no randomisation (legacy behaviour). Use only when callers
   *   need deterministic delays for snapshot tests.
   * `full` — sleep a uniform random value in `[0, computedDelay]` (AWS
   *   "Full Jitter" — every retrier picks an independent point in the
   *   backoff window, decorrelating retry timing across N clients).
   * `decorrelated` — `min(maxDelayMs, U(initialDelayMs, prevDelay * 3))`
   *   AWS "Decorrelated Jitter" walk — yields better tail behaviour than
   *   full jitter when many retriers share a transient failure.
   *
   * Default: `full`. AWS Builder's Library recommends Full Jitter as the
   * preferred starting point; deterministic tests opt out via `none`.
   * Reference: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
   */
  jitter?: "none" | "full" | "decorrelated";
  /**
   * Optional random source (returns a value in `[0, 1)`). Defaults to
   * `Math.random`. Tests inject a deterministic source to assert jitter
   * arithmetic without flakes.
   */
  random?: () => number;
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
 * Compute the base (un-jittered) delay for a given attempt index using
 * exponential backoff.
 *
 * Attempt 1 produces `initialDelayMs * backoffFactor^0`,
 * attempt 2 produces `initialDelayMs * backoffFactor^1`, and so on.
 * The result is clamped to `[0, maxDelayMs]`. Callers that want jitter
 * apply it through {@link applyJitter} or by passing a non-`none` jitter
 * strategy to {@link retryWithBackoff}.
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
 * Apply AWS-style jitter to a base exponential-backoff delay (C9-H1).
 *
 * - `none` — return `baseDelay` unchanged (deterministic, used by tests).
 * - `full` — return `random() * baseDelay`. Each call picks an independent
 *   uniform random point in `[0, baseDelay]`, decorrelating retry timing
 *   across concurrent retriers.
 * - `decorrelated` — return `min(maxDelayMs, initialDelayMs +
 *   random() * (prevDelay * 3 - initialDelayMs))`. The walk grows toward
 *   the ceiling without being strictly tied to the exponential schedule.
 *
 * `prevDelay` is the previous attempt's actual (post-jitter) sleep so the
 * decorrelated walk advances from the real prior value rather than the
 * exponential nominal.
 *
 * Reference: AWS Builder's Library — Timeouts, retries, and backoff with jitter.
 */
export function applyJitter(
  baseDelay: number,
  options: {
    strategy: "none" | "full" | "decorrelated";
    initialDelayMs: number;
    maxDelayMs: number;
    prevDelay: number;
    random: () => number;
  },
): number {
  const { strategy, initialDelayMs, maxDelayMs, prevDelay, random } = options;
  if (baseDelay <= 0) return 0;
  if (strategy === "none") return baseDelay;
  if (strategy === "full") {
    const r = random();
    const jittered = r * baseDelay;
    return Math.max(0, Math.min(maxDelayMs, jittered));
  }
  // decorrelated: U(initialDelayMs, prevDelay * 3) clamped to maxDelayMs.
  // On the very first retry `prevDelay` is 0, so the upper bound collapses
  // to `initialDelayMs` and the walk seeds from the configured floor.
  const lo = Math.max(0, initialDelayMs);
  const hi = Math.max(lo, prevDelay * 3);
  const r = random();
  const jittered = lo + r * (hi - lo);
  return Math.max(0, Math.min(maxDelayMs, jittered));
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
  const jitter = options.jitter ?? "full";
  const random = options.random ?? Math.random;

  let lastError: unknown;
  let prevDelay = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) break;
      if (!shouldRetry(err, attempt)) break;
      const baseDelay = computeBackoffDelay(attempt, initialDelayMs, maxDelayMs, backoffFactor);
      const delay = applyJitter(baseDelay, {
        strategy: jitter,
        initialDelayMs,
        maxDelayMs,
        prevDelay,
        random,
      });
      prevDelay = delay;
      if (delay > 0) await sleep(delay);
    }
  }

  throw lastError;
}
