/**
 * Overall pipeline execution timeout with graceful termination.
 *
 * Enforces a maximum total execution time for the entire pipeline.
 * When the timeout is reached, the pipeline terminates gracefully:
 * saving progress, reporting what was completed, and providing
 * a summary of what remained.
 *
 * Finding #58 (D8, High): Add maximum pipeline execution time with graceful termination.
 */

import type { PhaseName } from "./phaseTimeout.js";

// ── Constants ────────────────────────────────────────────────────

/**
 * Error thrown by {@link runWithPipelineDeadman} when the overall pipeline
 * budget elapses before the wrapped body resolves (F8.3.4 / D8).
 *
 * Distinct from a per-phase {@link import("./phaseTimeout.js")} timeout: this
 * is the top-level deadman that fires even when an inner phase hangs without
 * ever yielding back to the loop, which is the failure mode the post-loop
 * {@link isPipelineTimedOut} check could not catch.
 */
export class PipelineTimeoutError extends Error {
  /** The budget that elapsed, in milliseconds. */
  readonly timeoutMs: number;
  /** Elapsed wall-clock time when the deadman fired, in milliseconds. */
  readonly elapsedMs: number;
  constructor(timeoutMs: number, elapsedMs: number) {
    super(
      `Pipeline exceeded its ${Math.round(timeoutMs / 1000)}s deadman budget ` +
        `(elapsed ${Math.round(elapsedMs / 1000)}s) and was aborted.`,
    );
    this.name = "PipelineTimeoutError";
    this.timeoutMs = timeoutMs;
    this.elapsedMs = elapsedMs;
  }
}

/** Default maximum pipeline execution time in milliseconds (15 minutes). */
export const DEFAULT_PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

/** Minimum allowed pipeline timeout in milliseconds (30 seconds). */
export const MIN_PIPELINE_TIMEOUT_MS = 30_000;

/** Maximum allowed pipeline timeout in milliseconds (60 minutes). */
export const MAX_PIPELINE_TIMEOUT_MS = 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────

export interface PhaseProgress {
  phase: PhaseName;
  status: "completed" | "in_progress" | "pending" | "skipped" | "timed_out";
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  /** Partial results for in-progress phases. */
  partialResult?: string;
}

export interface PipelineExecutionState {
  /** Whether the pipeline is currently running. */
  running: boolean;
  /** ISO timestamp of pipeline start. */
  startedAt: string;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  /** Progress of each phase. */
  phases: PhaseProgress[];
  /** Whether the pipeline was terminated due to timeout. */
  timedOut: boolean;
  /** ISO timestamp of termination, if applicable. */
  terminatedAt?: string;
  /** Summary of completed work at termination. */
  completionSummary?: string;
}

export interface PipelineTerminationReport {
  /** Whether the pipeline completed all phases. */
  completedAll: boolean;
  /** Total elapsed time in milliseconds. */
  totalElapsedMs: number;
  /** Phases that completed successfully. */
  completedPhases: PhaseName[];
  /** Phase that was in progress when timeout hit (if any). */
  interruptedPhase?: PhaseName;
  /** Phases that were never started. */
  pendingPhases: PhaseName[];
  /** Human-readable summary. */
  summary: string;
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Clamp a pipeline timeout to the allowed range.
 */
export function clampPipelineTimeout(timeoutMs: number): number {
  return Math.max(MIN_PIPELINE_TIMEOUT_MS, Math.min(timeoutMs, MAX_PIPELINE_TIMEOUT_MS));
}

/**
 * Run a pipeline body under a top-level deadman timer (F8.3.4 / D8).
 *
 * Wraps `body` in `Promise.race([body, deadman])` where the deadman REJECTS
 * with a {@link PipelineTimeoutError} once `timeoutMs` (clamped to the allowed
 * range) elapses. Unlike the post-loop {@link isPipelineTimedOut} check — which
 * is only consulted between loop iterations and therefore cannot interrupt a
 * phase that hangs without yielding — this race fires on wall-clock time
 * regardless of what the body is doing.
 *
 * An {@link AbortController} is signalled the moment the deadman fires so the
 * body can observe `signal.aborted` (or attach an `abort` listener) and unwind
 * cooperatively — e.g. abort an in-flight `executeWithPhaseTimeout(..., signal)`
 * or a child process. The body receives the signal as its sole argument. The
 * deadman timer is `unref()`-ed so it never keeps the Node event loop alive on
 * its own, and is always cleared once the race settles (success or failure) so
 * no dangling timer leaks.
 *
 * Resolution semantics:
 *   - Body resolves first → its value is returned; the timer is cleared.
 *   - Deadman fires first → rejects with {@link PipelineTimeoutError}; the
 *     controller is aborted so the still-running body can stop.
 *   - Body rejects first → that error propagates unchanged; the timer is
 *     cleared.
 *
 * @param body       Receives an {@link AbortSignal}; returns the pipeline result.
 * @param timeoutMs  Deadman budget; defaults to {@link DEFAULT_PIPELINE_TIMEOUT_MS}.
 *                   Clamped to `[MIN_PIPELINE_TIMEOUT_MS, MAX_PIPELINE_TIMEOUT_MS]`.
 * @param controller Optional caller-supplied controller (e.g. to share the
 *                   signal with sibling work); a fresh one is created otherwise.
 * @throws {PipelineTimeoutError} when the budget elapses before `body` settles.
 */
export async function runWithPipelineDeadman<T>(
  body: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
  controller: AbortController = new AbortController(),
): Promise<T> {
  const budget = clampPipelineTimeout(timeoutMs);
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadman = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const elapsed = Date.now() - startedAt;
      controller.abort();
      reject(new PipelineTimeoutError(budget, elapsed));
    }, budget);
    // Do not let the deadman timer alone keep the process alive.
    (timer as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([body(controller.signal), deadman]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Create a new pipeline execution state.
 */
export function createPipelineExecution(
  phases: PhaseName[],
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
): PipelineExecutionState {
  return {
    running: true,
    startedAt: new Date().toISOString(),
    timeoutMs: clampPipelineTimeout(timeoutMs),
    phases: phases.map((phase) => ({
      phase,
      status: "pending",
    })),
    timedOut: false,
  };
}

/**
 * Check if the pipeline has exceeded its timeout.
 *
 * D8-M7 (Cycle 10 rollover): this is an OBSERVATIONAL helper for callers that
 * inspect a {@link PipelineExecutionState} after the fact. It is NOT a
 * functional enforcement mechanism — a phase that hangs without yielding back
 * to the loop will never be detected by this check (the post-loop sentinel
 * fires only after the loop iteration completes, which never happens). For
 * functional enforcement use {@link runWithPipelineDeadman}, which races the
 * body against a `setTimeout`-driven {@link AbortController} and aborts the
 * in-flight phase the moment the budget elapses. The `sync` / `update`
 * command entry points were migrated to `runWithPipelineDeadman` in F8.3.4
 * (CHANGELOG #58); no production caller depends on the post-loop check.
 */
export function isPipelineTimedOut(state: PipelineExecutionState): boolean {
  if (state.timedOut) return true;
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return elapsed >= state.timeoutMs;
}

/**
 * D8-M7: deadman-aware wrapper for callers that want both the
 * setTimeout-driven AbortController enforcement of
 * {@link runWithPipelineDeadman} AND the post-hoc observability that
 * {@link isPipelineTimedOut} provides via the {@link PipelineExecutionState}
 * tracker. Single-call helper for new call sites so the two mechanisms cannot
 * drift apart.
 *
 * Returns `{ value, state }` where `state` carries the final phase progress
 * (so the caller can render `pipelineProgressSummary` for the UI) and `value`
 * is the body's return value. Throws {@link PipelineTimeoutError} on a
 * wall-clock breach with the partially-updated state attached via the error's
 * cause, so the caller can inspect what completed before the abort.
 *
 * Note: the wrapped body is responsible for calling
 * {@link markPhaseStarted}/{@link markPhaseCompleted}/{@link markPhaseSkipped}
 * against the state it receives so the tracker reflects per-phase progress.
 * The wrapper threads the AbortController signal directly into `body` as its
 * SECOND argument so the body can attach an `abort` listener.
 */
export async function runWithDeadmanTracker<T>(
  phases: PhaseName[],
  body: (state: PipelineExecutionState, signal: AbortSignal) => Promise<T>,
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
): Promise<{ value: T; state: PipelineExecutionState }> {
  const tracker = createPipelineExecution(phases, timeoutMs);
  const value = await runWithPipelineDeadman(
    (signal) => body(tracker, signal),
    timeoutMs,
  );
  return { value, state: tracker };
}

/**
 * Get remaining time in milliseconds for the pipeline.
 * Returns 0 if the timeout has been exceeded.
 */
export function getRemainingTime(state: PipelineExecutionState): number {
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return Math.max(0, state.timeoutMs - elapsed);
}

/**
 * Mark a phase as started.
 */
export function markPhaseStarted(
  state: PipelineExecutionState,
  phase: PhaseName,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? { ...p, status: "in_progress" as const, startedAt: new Date().toISOString() }
        : p,
    ),
  };
}

/**
 * Mark a phase as completed.
 */
export function markPhaseCompleted(
  state: PipelineExecutionState,
  phase: PhaseName,
  elapsedMs: number,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? {
            ...p,
            status: "completed" as const,
            completedAt: new Date().toISOString(),
            elapsedMs,
          }
        : p,
    ),
  };
}

/**
 * Mark a phase as skipped.
 */
export function markPhaseSkipped(
  state: PipelineExecutionState,
  phase: PhaseName,
): PipelineExecutionState {
  return {
    ...state,
    phases: state.phases.map((p) =>
      p.phase === phase
        ? { ...p, status: "skipped" as const }
        : p,
    ),
  };
}

/**
 * Gracefully terminate the pipeline due to timeout.
 *
 * Records what was completed, what was in progress, and what
 * was pending. Returns the updated state and a termination report.
 */
export function terminatePipeline(
  state: PipelineExecutionState,
  partialResult?: string,
): { state: PipelineExecutionState; report: PipelineTerminationReport } {
  const now = new Date().toISOString();
  const totalElapsedMs = Date.now() - new Date(state.startedAt).getTime();

  // Mark any in-progress phase as timed_out
  const updatedPhases = state.phases.map((p) => {
    if (p.status === "in_progress") {
      return {
        ...p,
        status: "timed_out" as const,
        completedAt: now,
        elapsedMs: p.startedAt
          ? Date.now() - new Date(p.startedAt).getTime()
          : undefined,
        partialResult,
      };
    }
    return p;
  });

  const completedPhases = updatedPhases
    .filter((p) => p.status === "completed")
    .map((p) => p.phase);

  const interruptedPhase = updatedPhases.find(
    (p) => p.status === "timed_out",
  )?.phase;

  const pendingPhases = updatedPhases
    .filter((p) => p.status === "pending")
    .map((p) => p.phase);

  const completedAll = pendingPhases.length === 0 && !interruptedPhase;

  // Build summary
  const summaryParts: string[] = [
    `Pipeline ${completedAll ? "completed" : "terminated after timeout"} ` +
    `(${Math.round(totalElapsedMs / 1000)}s / ${Math.round(state.timeoutMs / 1000)}s limit).`,
  ];

  if (completedPhases.length > 0) {
    summaryParts.push(`Completed phases: ${completedPhases.join(", ")}.`);
  }

  if (interruptedPhase) {
    summaryParts.push(`Interrupted phase: ${interruptedPhase}.`);
  }

  if (pendingPhases.length > 0) {
    summaryParts.push(`Pending phases: ${pendingPhases.join(", ")}.`);
  }

  const summary = summaryParts.join(" ");

  const updatedState: PipelineExecutionState = {
    ...state,
    running: false,
    phases: updatedPhases,
    timedOut: !completedAll,
    terminatedAt: now,
    completionSummary: summary,
  };

  const report: PipelineTerminationReport = {
    completedAll,
    totalElapsedMs,
    completedPhases,
    interruptedPhase,
    pendingPhases,
    summary,
  };

  return { state: updatedState, report };
}

/**
 * Generate a human-readable progress summary of the pipeline.
 */
export function pipelineProgressSummary(state: PipelineExecutionState): string {
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  const remaining = Math.max(0, state.timeoutMs - elapsed);
  const parts: string[] = [
    `Pipeline: ${Math.round(elapsed / 1000)}s elapsed, ${Math.round(remaining / 1000)}s remaining`,
  ];

  const completed = state.phases.filter((p) => p.status === "completed").length;
  const total = state.phases.length;
  parts.push(`Phases: ${completed}/${total} completed`);

  if (state.timedOut) {
    parts.push("Status: TIMED OUT");
  } else if (!state.running) {
    parts.push("Status: finished");
  } else {
    const current = state.phases.find((p) => p.status === "in_progress");
    parts.push(`Status: ${current ? `running ${current.phase}` : "idle"}`);
  }

  return parts.join(" | ");
}
