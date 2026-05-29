/**
 * SessionStart registry summarizer.
 *
 * Reads `governance/audit/finding-registry.json` and produces a one-line
 * summary printed by the SessionStart hook in `.claude/settings.json`.
 *
 * Background — C9-H77 (D19-SA19.1-F03)
 * ------------------------------------
 * The previous inline Python in `.claude/settings.json` assumed the v1
 * flat-array shape (`for e in data`). The v2 schema (registry
 * `schema_version: "2.0.0"`) wraps entries in a top-level object:
 *
 *   { schema_version, generated_at, pillar_revisions, entries: [...] }
 *
 * Iterating the dict produced an `AttributeError` which was swallowed by
 * the `|| echo` fallback, so every session printed "Registry not found"
 * regardless of registry state. This module is the v2-aware replacement
 * and is unit-tested against fixture registries.
 *
 * Pillars: P5 (Governance Self-Quality), P1 (CLI UX — actionable status)
 */

import { readFile } from "node:fs/promises";

/** Severity buckets emitted by audit findings. */
export type FindingSeverity =
  | "Critical"
  | "High"
  | "Medium"
  | "Low"
  | "Info"
  | string;

/** Execution state machine values used by the registry. */
export type ExecutionStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "partial"
  | "deferred"
  | "rolled_back"
  | "already_resolved"
  | "never_attempted"
  | string;

/** Single registry entry (only fields this summarizer reads). */
export interface RegistryEntry {
  finding_id?: string;
  severity?: FindingSeverity;
  execution_status?: ExecutionStatus;
  wave?: number | null;
  cycle?: number | null;
}

/** Top-level v2 registry shape. */
export interface RegistryV2 {
  schema_version: string;
  entries: RegistryEntry[];
}

/** Numeric summary the hook prints, plus a derived display string. */
export interface RegistrySummary {
  /** Detected schema version (e.g. "2.0.0") or "unknown" if missing. */
  schemaVersion: string;
  /** Total entries across all cycles. */
  totalEntries: number;
  /** Entries with `execution_status === "pending"`. */
  pendingTotal: number;
  /** Entries belonging to the current (highest) cycle. */
  currentCycle: number | null;
  /** Pending entries scoped to `currentCycle`. */
  pendingCurrentCycle: number;
  /** Critical-severity entries scoped to `currentCycle` regardless of status. */
  criticalCurrentCycle: number;
  /**
   * F8 (D1-SA1.7, cycle 10 wave 4): count of structurally malformed rows — an
   * entry that is not an object, or whose `finding_id` is missing or not a
   * string. Such rows cannot be bucketed by cycle and therefore drop out of the
   * cycle-scoped counters (`pendingCurrentCycle`, `criticalCurrentCycle`); a
   * malformed row carrying an unresolved Critical would otherwise hide from the
   * session-start banner. The summarizer counts them and {@link formatSummary}
   * surfaces the count so the tolerance is no longer silent (P5 Silent Failure
   * Contract). Optional so pre-existing `RegistrySummary` literals stay valid;
   * {@link summarizeRegistry} always populates it.
   *
   * NOTE: a *legitimate* non-cycle id (legacy `#1` from C1–C6, or the
   * domain/finding-prefixed `D…`/`F…`/`SA…` ids that `extractCycle` returns
   * `null` for by design) is NOT malformed — only a missing/non-string id is.
   * Keying off "`extractCycle` returned null" would false-positive on the
   * hundreds of legitimate non-`C<n>` ids in the registry.
   */
  malformedRowCount?: number;
}

/**
 * Extract a cycle number from an entry. Prefers the explicit `cycle` field
 * (present on Cycle 9+ entries); falls back to parsing the `finding_id`
 * prefix (`C9-...`, `C7.5-...`) for legacy entries that were migrated from
 * v1 without a `cycle` field.
 *
 * Returns `null` when no cycle can be determined (e.g. `#1` style legacy
 * finding ids from C1-C6).
 */
export function extractCycle(entry: RegistryEntry): number | null {
  if (typeof entry.cycle === "number" && Number.isFinite(entry.cycle)) {
    return entry.cycle;
  }
  const id = entry.finding_id;
  if (typeof id !== "string") return null;
  // Match leading "C<digits>" optionally followed by ".<digits>".
  // We intentionally ignore the fractional part for cycle bucketing
  // (C7.5 belongs to "wave 7" series, but the current-cycle filter only
  // cares about the integer part because the registry produces one
  // integer cycle per audit run).
  const m = /^C(\d+)(?:\.\d+)?-/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the summary from a parsed registry object. Tolerant to unexpected
 * top-level shapes — if `entries` is missing or not an array, returns a
 * zeroed summary with `schemaVersion="unknown"` so the hook still prints a
 * useful line rather than throwing.
 *
 * `currentCycle` is the highest integer cycle observed across all entries.
 * If no entry has a cycle, it is `null` and per-cycle counters are 0.
 */
export function summarizeRegistry(registry: unknown): RegistrySummary {
  const reg = registry as Partial<RegistryV2> | null | undefined;
  const entries: RegistryEntry[] = Array.isArray(reg?.entries)
    ? (reg!.entries as RegistryEntry[])
    : [];

  let currentCycle: number | null = null;
  for (const e of entries) {
    const c = extractCycle(e);
    if (c !== null && (currentCycle === null || c > currentCycle)) {
      currentCycle = c;
    }
  }

  let pendingTotal = 0;
  let pendingCurrentCycle = 0;
  let criticalCurrentCycle = 0;
  let malformedRowCount = 0;
  for (const e of entries) {
    // F8: a row with a missing/non-string finding_id (or a non-object entry)
    // cannot be cycle-bucketed and silently drops out of the cycle-scoped
    // counters below. Count it so the tolerance is surfaced, not hidden.
    if (typeof e !== "object" || e === null || typeof e.finding_id !== "string") {
      malformedRowCount += 1;
    }
    const isPending = e?.execution_status === "pending";
    if (isPending) pendingTotal += 1;
    if (currentCycle !== null && extractCycle(e ?? {}) === currentCycle) {
      if (isPending) pendingCurrentCycle += 1;
      if (e?.severity === "Critical") criticalCurrentCycle += 1;
    }
  }

  return {
    schemaVersion:
      typeof reg?.schema_version === "string" ? reg.schema_version : "unknown",
    totalEntries: entries.length,
    pendingTotal,
    currentCycle,
    pendingCurrentCycle,
    criticalCurrentCycle,
    malformedRowCount,
  };
}

/**
 * Render a one-line status string suitable for printing inside the
 * SessionStart hook. Format intentionally compact — the hook also prints
 * the CONSTITUTION head, so this stays to a single line.
 *
 * Example output:
 *   "Audit registry v2.0.0: 415 entries, 82 pending (Cycle 9: 80 pending, 0 critical)"
 *
 * When malformed rows are present (F8), a trailing note is appended so the
 * operator sees the count rather than having those rows silently drop out of
 * the cycle-scoped counters:
 *   "... (Cycle 9: 80 pending, 0 critical) (2 malformed rows)"
 */
export function formatSummary(s: RegistrySummary): string {
  const head = `Audit registry v${s.schemaVersion}: ${s.totalEntries} entries, ${s.pendingTotal} pending`;
  const malformed = s.malformedRowCount ?? 0;
  const malformedSuffix = malformed > 0 ? ` (${malformed} malformed row${malformed === 1 ? "" : "s"})` : "";
  if (s.currentCycle === null) return head + malformedSuffix;
  return `${head} (Cycle ${s.currentCycle}: ${s.pendingCurrentCycle} pending, ${s.criticalCurrentCycle} critical)${malformedSuffix}`;
}

/**
 * Read the registry from disk and produce the summary line. Throws when
 * the file is missing or the JSON is malformed; callers are expected to
 * catch and fall back to a friendly "Registry not found" message.
 */
export async function readAndSummarize(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return formatSummary(summarizeRegistry(parsed));
}
