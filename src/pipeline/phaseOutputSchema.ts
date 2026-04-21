/**
 * Phase output compaction for CLI command summaries.
 *
 * Provides `compactPhaseOutput`, a bounded-size summariser used by the
 * `sync`, `update`, and `verify` commands to keep human-readable output
 * within prompt-guard size limits even when the underlying pipeline
 * produces a large number of per-file or per-adapter results.
 *
 * History: this module previously exported a suite of phase-boundary
 * schema validators (validateResearchOutput, validateImplementationOutput,
 * validateReviewOutput, validateQualityOutput, validatePhaseOutput,
 * formatSchemaViolations) intended to gate runtime handoffs between
 * research/implementation/review/quality phases (ASI07). Those phases
 * run inside the end-user's AI tool, not inside the hatch3r CLI, so the
 * validators were never invoked on production code paths. Per P4 (Lean
 * Coverage) and the Silent-Failure Contract, the unused validator
 * surface was removed in Cycle 7.5 (C7.5-W2B2-H42). Phase-shape contracts
 * remain typed in `pipelineContext.ts` for downstream tool consumption.
 */

// ── Compact ─────────────────────────────────────────────────────

export interface CompactOptions {
  /** Byte-length threshold below which output is returned unchanged. */
  threshold: number;
  /** Maximum characters kept per string value. */
  maxStringLength: number;
  /** Number of items kept from the head of an array. */
  headItems: number;
  /** Number of items kept from the tail of an array. */
  tailItems: number;
}

const COMPACT_DEFAULTS: CompactOptions = {
  threshold: 50_000,
  maxStringLength: 500,
  headItems: 3,
  tailItems: 2,
};

/**
 * Compact a phase output value so it stays within prompt-guard size limits.
 *
 * When `JSON.stringify(output).length <= threshold` the value is returned
 * unchanged. Otherwise strings are truncated, arrays are head/tail-sliced
 * with a compacted-placeholder in the middle, and objects are recursed into.
 * Primitives (number, boolean, null) are always preserved.
 */
export function compactPhaseOutput<T>(
  output: T,
  options?: Partial<CompactOptions>,
): T {
  const opts: CompactOptions = { ...COMPACT_DEFAULTS, ...options };

  if (JSON.stringify(output).length <= opts.threshold) {
    return output;
  }

  return compactValue(output, opts) as T;
}

function compactValue(value: unknown, opts: CompactOptions): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (typeof value) {
    case "number":
    case "boolean":
      return value;

    case "string": {
      if (value.length <= opts.maxStringLength) {
        return value;
      }
      return value.slice(0, opts.maxStringLength) + " [compacted]";
    }

    default:
      break;
  }

  if (Array.isArray(value)) {
    const kept = opts.headItems + opts.tailItems;
    if (value.length <= kept) {
      return value.map((item) => compactValue(item, opts));
    }
    const head = value.slice(0, opts.headItems).map((item) => compactValue(item, opts));
    const tail = value.slice(-opts.tailItems).map((item) => compactValue(item, opts));
    const omitted = value.length - kept;
    return [...head, `[compacted: ${omitted} items omitted]`, ...tail];
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = compactValue(val, opts);
    }
    return result;
  }

  return value;
}
