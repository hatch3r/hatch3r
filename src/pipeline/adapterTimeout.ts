/**
 * Per-adapter generation timeout.
 *
 * Wraps adapter output generation with a configurable timeout.
 * If an adapter takes too long, it is skipped with a warning
 * rather than blocking the entire pipeline.
 *
 * Finding #60 (D8, High): Add per-adapter generation timeout.
 */

import type { AdapterOutput, Tool, HatchManifest, GenerationMode } from "../types.js";
import type { Adapter } from "../adapters/base.js";

// ── Constants ────────────────────────────────────────────────────

/** Default per-adapter timeout in milliseconds (3 minutes). */
export const DEFAULT_ADAPTER_TIMEOUT_MS = 3 * 60 * 1000;

/** Minimum allowed adapter timeout in milliseconds (5 seconds). */
export const MIN_ADAPTER_TIMEOUT_MS = 5_000;

/** Maximum allowed adapter timeout in milliseconds (15 minutes). */
export const MAX_ADAPTER_TIMEOUT_MS = 15 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────

export interface AdapterTimeoutConfig {
  /** Timeout in milliseconds per adapter. */
  timeoutMs: number;
  /** Per-tool timeout overrides. */
  overrides?: Partial<Record<Tool, number>>;
}

export interface AdapterGenerationResult {
  /** The tool/adapter name. */
  tool: Tool;
  /** Whether generation completed within the timeout. */
  completed: boolean;
  /** Generated outputs, if completed. */
  outputs?: AdapterOutput[];
  /** Adapter warnings (from both successful and timed-out runs). */
  warnings: string[];
  /** Error message if the adapter timed out or failed. */
  error?: string;
  /** Elapsed time in milliseconds. */
  elapsedMs: number;
}

// ── Implementation ───────────────────────────────────────────────

/**
 * Clamp an adapter timeout to the allowed range.
 */
export function clampAdapterTimeout(timeoutMs: number): number {
  return Math.max(MIN_ADAPTER_TIMEOUT_MS, Math.min(timeoutMs, MAX_ADAPTER_TIMEOUT_MS));
}

/**
 * Get the effective timeout for a specific tool.
 */
export function getAdapterTimeout(
  tool: Tool,
  config?: AdapterTimeoutConfig,
): number {
  const override = config?.overrides?.[tool];
  const raw = override ?? config?.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  return clampAdapterTimeout(raw);
}

/**
 * Run adapter generation with a timeout.
 *
 * If the adapter completes within the timeout, returns its outputs.
 * If the adapter exceeds the timeout, returns a timeout error and
 * the adapter is skipped with a warning.
 *
 * C9-H20 (D8-H8.3.1): An `AbortController` is created per call. Its
 * signal is passed to `adapter.generate(..., signal)` so adapters with
 * long-running loops can check `signal.aborted` and exit cooperatively
 * instead of leaving the surrounding `Promise.race` waiting for them.
 * An optional `parentSignal` lets a caller (e.g. the outer phase
 * timeout) propagate a higher-level cancellation into the adapter.
 */
export async function generateWithTimeout(
  tool: Tool,
  adapter: Adapter,
  canonicalRoot: string,
  manifest: HatchManifest,
  generationMode: GenerationMode,
  config?: AdapterTimeoutConfig,
  parentSignal?: AbortSignal,
  userRepoRoot?: string,
): Promise<AdapterGenerationResult> {
  const timeoutMs = getAdapterTimeout(tool, config);
  const startTime = Date.now();
  const controller = new AbortController();

  // Honour an already-aborted parent before scheduling work — adapter
  // generate calls `BaseAdapter.throwIfSignalAborted(signal)` at entry so
  // the AbortError surfaces on the first await.
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  }
  const onParentAbort = () => {
    controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const outputs = await Promise.race([
      adapter.generate(canonicalRoot, manifest, userRepoRoot, generationMode, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Abort first so the adapter's cooperative checks unwind any
          // in-flight loop iterations cleanly, then reject the race so
          // the surrounding caller sees an AdapterTimeoutError.
          controller.abort();
          reject(
            new AdapterTimeoutError(tool, timeoutMs),
          );
        }, timeoutMs);
      }),
    ]);

    const elapsedMs = Date.now() - startTime;
    return {
      tool,
      completed: true,
      outputs,
      warnings: [...adapter.warnings],
      elapsedMs,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    if (err instanceof AdapterTimeoutError) {
      return {
        tool,
        completed: false,
        warnings: [
          `Adapter "${tool}" timed out after ${Math.round(timeoutMs / 1000)}s and was skipped. ` +
          `Its output files were not updated.`,
        ],
        error: err.message,
        elapsedMs,
      };
    }

    // Non-timeout errors: return as a failed result
    return {
      tool,
      completed: false,
      warnings: [...adapter.warnings],
      error: err instanceof Error ? err.message : String(err),
      elapsedMs,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

// ── Error class ──────────────────────────────────────────────────

export class AdapterTimeoutError extends Error {
  constructor(
    public readonly tool: Tool,
    public readonly timeoutMs: number,
  ) {
    super(
      `Adapter "${tool}" exceeded the ${Math.round(timeoutMs / 1000)}s timeout ` +
      `and was skipped. Consider increasing the adapter timeout or investigating ` +
      `why this adapter is slow.`,
    );
    this.name = "AdapterTimeoutError";
  }
}
