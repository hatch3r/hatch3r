/**
 * Per-phase timeout configuration and enforcement for the pipeline.
 *
 * Each pipeline phase can have a configurable timeout value. When a phase
 * exceeds its timeout, it is terminated gracefully with a descriptive error.
 *
 * Finding #57 (D8, High): Define and enforce per-phase timeout values.
 */

// ── Constants ────────────────────────────────────────────────────

/** Default per-phase timeout in milliseconds (5 minutes). */
export const DEFAULT_PHASE_TIMEOUT_MS = 5 * 60 * 1000;

/** Minimum allowed phase timeout in milliseconds (10 seconds). */
export const MIN_PHASE_TIMEOUT_MS = 10_000;

/** Maximum allowed phase timeout in milliseconds (30 minutes). */
export const MAX_PHASE_TIMEOUT_MS = 30 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────

export type PhaseName =
  | "generation"
  | "merge"
  | "review"
  | "fix"
  | "validation"
  | "integrity"
  | "adapter";

export interface PhaseTimeoutConfig {
  /** Timeout in milliseconds. Clamped to [MIN, MAX]. */
  timeoutMs: number;
}

export interface PhaseTimeoutResult<T> {
  /** Whether the phase completed within the timeout. */
  completed: boolean;
  /** The result of the phase, if completed. */
  result?: T;
  /** Error message if the phase timed out or failed. */
  error?: string;
  /** The phase name that was executed. */
  phase: PhaseName;
  /** Actual elapsed time in milliseconds. */
  elapsedMs: number;
}

// ── Default timeout map ──────────────────────────────────────────

const DEFAULT_PHASE_TIMEOUTS: Record<PhaseName, number> = {
  generation: 5 * 60 * 1000,   // 5 min
  merge: 2 * 60 * 1000,        // 2 min
  review: 10 * 60 * 1000,      // 10 min
  fix: 10 * 60 * 1000,         // 10 min
  validation: 2 * 60 * 1000,   // 2 min
  integrity: 1 * 60 * 1000,    // 1 min
  adapter: 3 * 60 * 1000,      // 3 min
};

// ── Implementation ───────────────────────────────────────────────

/**
 * Clamp a timeout value to the allowed range.
 */
export function clampTimeout(timeoutMs: number): number {
  return Math.max(MIN_PHASE_TIMEOUT_MS, Math.min(timeoutMs, MAX_PHASE_TIMEOUT_MS));
}

/**
 * Get the default timeout for a given phase.
 */
export function getDefaultPhaseTimeout(phase: PhaseName): number {
  return DEFAULT_PHASE_TIMEOUTS[phase] ?? DEFAULT_PHASE_TIMEOUT_MS;
}

/**
 * Create a phase timeout configuration with clamping.
 */
export function createPhaseTimeoutConfig(
  timeoutMs?: number,
  phase?: PhaseName,
): PhaseTimeoutConfig {
  const raw = timeoutMs ?? (phase ? getDefaultPhaseTimeout(phase) : DEFAULT_PHASE_TIMEOUT_MS);
  return { timeoutMs: clampTimeout(raw) };
}

/**
 * Execute a phase function with a timeout.
 *
 * If the phase completes within the timeout, returns the result.
 * If the phase exceeds the timeout, returns a timeout error with
 * details about which phase timed out and how long it ran.
 *
 * The phase function receives an AbortSignal that is aborted when
 * the timeout is reached, allowing the phase to clean up.
 */
export async function executeWithPhaseTimeout<T>(
  phase: PhaseName,
  fn: (signal: AbortSignal) => Promise<T>,
  config?: PhaseTimeoutConfig,
): Promise<PhaseTimeoutResult<T>> {
  const timeoutMs = config?.timeoutMs ?? getDefaultPhaseTimeout(phase);
  const clampedTimeout = clampTimeout(timeoutMs);
  const startTime = Date.now();
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      fn(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new PhaseTimeoutError(
              phase,
              clampedTimeout,
              Date.now() - startTime,
            ),
          );
        }, clampedTimeout);
      }),
    ]);

    const elapsedMs = Date.now() - startTime;
    return {
      completed: true,
      result,
      phase,
      elapsedMs,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    if (err instanceof PhaseTimeoutError) {
      return {
        completed: false,
        error: err.message,
        phase,
        elapsedMs,
      };
    }

    // Re-throw non-timeout errors
    throw err;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// ── Error class ──────────────────────────────────────────────────

export class PhaseTimeoutError extends Error {
  constructor(
    public readonly phase: PhaseName,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
  ) {
    super(
      `Pipeline phase "${phase}" timed out after ${Math.round(timeoutMs / 1000)}s ` +
      `(elapsed: ${Math.round(elapsedMs / 1000)}s). ` +
      `Consider increasing the timeout or investigating phase performance.`,
    );
    this.name = "PhaseTimeoutError";
  }
}
