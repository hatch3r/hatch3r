/**
 * src/audit/insights.ts
 *
 * Type definitions, parsing, validation, and 3-cycle ring-buffer promotion
 * for `governance/audit/execution-insights.json`. Hand-rolled (no schema lib)
 * to match the registry-schema.ts / migrate.ts pattern.
 *
 * Pillars: P2 (Scientific Quality — rigor of cross-cycle calibration),
 *          P5 (Governance Self-Quality — code-enforced contracts),
 *          P7 (Speed & Token Efficiency — bounded history avoids full-file
 *              re-reads on every cycle).
 *
 * The file has two shapes on disk:
 *
 *   legacy: a single object describing one cycle's execution insights
 *           (no `schema_version` field). Treated as `history[0]`.
 *   v2:     `{ schema_version, current, history[] }` envelope where
 *           `current` is null when idle (live data lives in
 *           `.audit-workspace/current-insights.json` during a cycle) and
 *           `history` is newest-last, length 0..HISTORY_MAX.
 *
 * `parseInsights` accepts both shapes. `promote` is a pure ring-buffer
 * push-with-eviction. `promoteToHistory` wires the file system: reads the
 * ephemeral current-cycle file, calls `promote`, atomicWriteFile back.
 */
import { readFile, stat } from "node:fs/promises";
import { atomicWriteFile } from "../merge/safeWrite.js";

export const CURRENT_INSIGHTS_VERSION = "2.0.0";
export const HISTORY_MAX = 3;

/**
 * A single cycle's insight payload. Preserved verbatim from the existing
 * file shape — top-level keys vary across cycles (sub_cycles arrived in
 * Cycle 7.5; gate_failures_attempted is post-Cycle 6) and the schema is
 * deliberately open. The helper fields below are the two stable handles.
 */
export type CycleInsight = Record<string, unknown> & {
  cycle_date?: string;
  cycle_number?: number | string;
};

export interface InsightsRing {
  schema_version: string;
  /**
   * Ephemeral in-flight cycle data. Null when idle. Production never reads
   * `current` from the on-disk file — the cycle writes
   * `.audit-workspace/current-insights.json` and `promoteToHistory` moves
   * the finalized snapshot into `history`. Kept on the envelope only so
   * partial-write recovery scenarios have a place to stage data.
   */
  current: CycleInsight | null;
  /** Newest-last; length 0..HISTORY_MAX. */
  history: CycleInsight[];
}

export interface InsightsDriftReport {
  reason: string;
  detail: string;
}

export class InsightsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightsParseError";
  }
}

/**
 * Raised by `promoteToHistory` when a current-cycle accumulator is missing a
 * structurally-required field (`cycle_date`, a cycle identifier, or
 * `fix_success_rate`). A snapshot lacking these cannot satisfy the Phase-1
 * "Previous Cycle Insights" read or the Phase-6 two-speed calibration, so the
 * promotion is refused rather than poisoning the ring with an un-keyable entry
 * (D16-8 / SA16.2-F3).
 */
export class InsightsAccumulatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightsAccumulatorError";
  }
}

/**
 * Fields a finished-cycle accumulator must carry to be promotable. Mirrors the
 * required handles in the AUDIT-EXECUTE.md §Execution Telemetry output schema
 * (`{cycle_date, fix_success_rate.{...}, ...}`): `cycle_date` and a cycle
 * identifier (`cycle_number` or `cycle`) are the two keys downstream reads
 * index by; `fix_success_rate` is the minimal payload Phase-1 concurrency
 * calibration consumes.
 */
const REQUIRED_ACCUMULATOR_FIELDS = ["cycle_date", "fix_success_rate"] as const;

/**
 * Forward-looking fields that SHOULD be present but are not yet emitted by
 * every cycle: `cl2_artifact_closure` feeds the Phase-6 two-speed calibration
 * (AUDIT-EXECUTE.md §Phase 6 priority-signal calibration). Its absence is a
 * warning, not a hard reject — the emission path is owned by a separate
 * remediation (D16-9). Warning here means a stale accumulator is still
 * promotable, but the gap is surfaced rather than silently swallowed.
 */
const RECOMMENDED_ACCUMULATOR_FIELDS = ["cl2_artifact_closure"] as const;

export interface AccumulatorValidation {
  /** Hard failures — promotion is refused when non-empty. */
  errors: string[];
  /** Soft gaps — promotion proceeds, but the caller surfaces them. */
  warnings: string[];
}

/**
 * Validate a current-cycle accumulator object against the promotable contract.
 *
 * Errors (block promotion):
 *   - missing `cycle_date`
 *   - missing both `cycle_number` and `cycle` (no cycle identifier)
 *   - missing `fix_success_rate`
 *
 * Warnings (do not block):
 *   - missing `cl2_artifact_closure` (Phase-6 calibration source; emission
 *     owned by a separate remediation)
 *
 * Pure: does not throw and does not mutate. `promoteToHistory` runs this and
 * throws `InsightsAccumulatorError` on any error, returning warnings to the
 * caller.
 */
export function validateAccumulator(
  accumulator: Record<string, unknown>,
): AccumulatorValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_ACCUMULATOR_FIELDS) {
    if (!(field in accumulator) || accumulator[field] === undefined) {
      errors.push(`missing required field \`${field}\``);
    }
  }
  // A cycle identifier may be carried as `cycle_number` (history shape) or
  // `cycle` (live-accumulator shape). Require at least one.
  const hasCycleId =
    ("cycle_number" in accumulator && accumulator.cycle_number !== undefined) ||
    ("cycle" in accumulator && accumulator.cycle !== undefined);
  if (!hasCycleId) {
    errors.push("missing cycle identifier (`cycle_number` or `cycle`)");
  }

  for (const field of RECOMMENDED_ACCUMULATOR_FIELDS) {
    if (!(field in accumulator) || accumulator[field] === undefined) {
      warnings.push(
        `missing recommended field \`${field}\` (Phase-6 two-speed calibration source)`,
      );
    }
  }

  return { errors, warnings };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse a raw JSON value into an InsightsRing.
 *
 * Accepts both:
 *   - **Legacy**: a single object with no `schema_version` field — wrapped
 *     as `{ schema_version: CURRENT_INSIGHTS_VERSION, current: null,
 *     history: [<that object>] }`.
 *   - **v2**: an object carrying `schema_version`, `current`, `history[]`.
 *
 * Throws InsightsParseError on null root, non-object root, or any v2 shape
 * violation (history not an array, history > HISTORY_MAX, non-object entry,
 * non-string schema_version, current that is neither null nor an object).
 */
export function parseInsights(raw: unknown): InsightsRing {
  if (raw === null) {
    throw new InsightsParseError("insights root is null; expected an object");
  }
  if (!isPlainObject(raw)) {
    throw new InsightsParseError(
      "insights root is not an object (got " +
        (Array.isArray(raw) ? "array" : typeof raw) +
        ")",
    );
  }

  // Legacy snapshot: no schema_version → wrap whole object as history[0].
  if (!("schema_version" in raw)) {
    return {
      schema_version: CURRENT_INSIGHTS_VERSION,
      current: null,
      history: [raw as CycleInsight],
    };
  }

  // v2 envelope.
  if (typeof raw.schema_version !== "string") {
    throw new InsightsParseError(
      "v2 insights envelope requires a string `schema_version`",
    );
  }
  if (!("history" in raw)) {
    throw new InsightsParseError(
      "v2 insights envelope is missing `history` array",
    );
  }
  if (!Array.isArray(raw.history)) {
    throw new InsightsParseError(
      "v2 insights envelope `history` is not an array",
    );
  }
  if (raw.history.length > HISTORY_MAX) {
    throw new InsightsParseError(
      `v2 insights envelope history length ${raw.history.length} exceeds HISTORY_MAX=${HISTORY_MAX}`,
    );
  }
  for (let i = 0; i < raw.history.length; i++) {
    if (!isPlainObject(raw.history[i])) {
      throw new InsightsParseError(
        `v2 insights envelope history[${i}] is not a non-null object`,
      );
    }
  }
  // `current` is optional on disk (the legacy shape didn't carry it). When
  // present it must be null or a non-null object.
  const currentRaw = raw.current;
  let current: CycleInsight | null;
  if (currentRaw === undefined || currentRaw === null) {
    current = null;
  } else if (isPlainObject(currentRaw)) {
    current = currentRaw as CycleInsight;
  } else {
    throw new InsightsParseError(
      "v2 insights envelope `current` is neither null nor a non-null object",
    );
  }

  return {
    schema_version: raw.schema_version,
    current,
    history: raw.history.map((h) => h as CycleInsight),
  };
}

/**
 * Validate a parsed ring against version + length invariants. Returns drift
 * reports; empty array means no drift.
 *
 * Mirrors the validateRegistry pattern from registry-schema.ts: parse first,
 * validate second so callers can act on a structured drift list rather than
 * a single thrown error.
 */
export function validateInsights(ring: InsightsRing): InsightsDriftReport[] {
  const reports: InsightsDriftReport[] = [];

  if (ring.schema_version !== CURRENT_INSIGHTS_VERSION) {
    reports.push({
      reason: "schema_version mismatch",
      detail: `expected "${CURRENT_INSIGHTS_VERSION}", got "${ring.schema_version}"`,
    });
  }
  if (!Array.isArray(ring.history)) {
    reports.push({
      reason: "history not an array",
      detail: `got ${typeof ring.history}`,
    });
  } else if (ring.history.length > HISTORY_MAX) {
    reports.push({
      reason: "history exceeds HISTORY_MAX",
      detail: `length ${ring.history.length} > ${HISTORY_MAX}`,
    });
  } else {
    for (let i = 0; i < ring.history.length; i++) {
      if (!isPlainObject(ring.history[i])) {
        reports.push({
          reason: "history entry is not a non-null object",
          detail: `index ${i}`,
        });
      }
    }
  }
  if (ring.current !== null && !isPlainObject(ring.current)) {
    reports.push({
      reason: "current is not null and not a non-null object",
      detail: `got ${typeof ring.current}`,
    });
  }

  return reports;
}

/**
 * Push `finishedCycle` to the ring's history (newest-last). Drops oldest
 * entries when length exceeds HISTORY_MAX. Clears `current` to null.
 *
 * Pure: input is not mutated; caller receives a new ring.
 */
export function promote(
  ring: InsightsRing,
  finishedCycle: CycleInsight,
): InsightsRing {
  const next = [...ring.history, finishedCycle];
  while (next.length > HISTORY_MAX) {
    next.shift();
  }
  return {
    schema_version: ring.schema_version,
    current: null,
    history: next,
  };
}

export interface InsightsPaths {
  /** Path to the on-disk ring buffer: `governance/audit/execution-insights.json`. */
  insightsFile: string;
  /** Ephemeral file written during a live cycle: `.audit-workspace/current-insights.json`. */
  currentFile: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Read the insights ring from disk. Initializes a fresh empty ring when
 * the file does not exist (first cycle scenario).
 */
export async function readInsights(paths: InsightsPaths): Promise<InsightsRing> {
  let content: string;
  try {
    content = await readFile(paths.insightsFile, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        schema_version: CURRENT_INSIGHTS_VERSION,
        current: null,
        history: [],
      };
    }
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new InsightsParseError(
      `failed to parse ${paths.insightsFile}: ${(err as Error).message}`,
    );
  }
  return parseInsights(raw);
}

/**
 * Atomically write the ring to disk in a deterministic shape: 2-space
 * indent, trailing newline. Mirrors the project-wide JSON serialization
 * convention used in registry-schema / archive output.
 */
export async function writeInsights(
  paths: InsightsPaths,
  ring: InsightsRing,
): Promise<void> {
  const content = JSON.stringify(ring, null, 2) + "\n";
  await atomicWriteFile(paths.insightsFile, content);
}

/**
 * End-of-cycle promotion: read the ephemeral `paths.currentFile` (written
 * during the live cycle), parse it as a CycleInsight, validate it carries the
 * promotable contract, push into the ring, write the updated ring atomically.
 *
 * Returns `{ promoted: false, ring, warnings: [] }` (unchanged ring) when
 * `currentFile` does not exist — a no-op for cycles that never produced an
 * in-flight snapshot. Otherwise returns
 * `{ promoted: true, ring: <new ring>, warnings: [...] }`.
 *
 * Validation (D16-8 / SA16.2-F3): runs `validateAccumulator` before pushing.
 * Throws `InsightsAccumulatorError` when the snapshot is missing a required
 * field (`cycle_date`, a cycle identifier, or `fix_success_rate`) — an
 * un-keyable entry would silently break the Phase-1 / Phase-6 reads, so it is
 * refused at write time rather than discovered two cycles later. Soft gaps
 * (e.g. an absent `cl2_artifact_closure`) are returned in `warnings` and do
 * not block promotion.
 */
export async function promoteToHistory(
  paths: InsightsPaths,
): Promise<{ promoted: boolean; ring: InsightsRing; warnings: string[] }> {
  const ring = await readInsights(paths);
  if (!(await fileExists(paths.currentFile))) {
    return { promoted: false, ring, warnings: [] };
  }
  const currentContent = await readFile(paths.currentFile, "utf-8");
  let currentRaw: unknown;
  try {
    currentRaw = JSON.parse(currentContent);
  } catch (err) {
    throw new InsightsParseError(
      `failed to parse ${paths.currentFile}: ${(err as Error).message}`,
    );
  }
  if (!isPlainObject(currentRaw)) {
    throw new InsightsParseError(
      `${paths.currentFile} is not a non-null object`,
    );
  }
  const finishedCycle = currentRaw as CycleInsight;

  const { errors, warnings } = validateAccumulator(finishedCycle);
  if (errors.length > 0) {
    throw new InsightsAccumulatorError(
      `${paths.currentFile} is not a promotable cycle accumulator: ${errors.join("; ")}`,
    );
  }

  const nextRing = promote(ring, finishedCycle);
  await writeInsights(paths, nextRing);
  return { promoted: true, ring: nextRing, warnings };
}
