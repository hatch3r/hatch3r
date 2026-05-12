import { readFile } from "node:fs/promises";
import { join, relative, posix, sep } from "node:path";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type { AdapterOutput } from "../types.js";

/**
 * C8-D12-M3: Adapter-source provenance diagnostic record.
 *
 * Persisted to `.agents/.provenance.json` by `hatch3r sync` so operators can
 * answer "which canonical file(s) produced this adapter output?" without
 * re-running generation.
 *
 * **Guarantees:**
 * - Per-adapter, per-output-path mapping of sourceFiles contributing to the
 *   generated artifact (paths are repo-relative with posix `/` separators).
 * - Records adapter name so collisions across adapters writing to the same
 *   output path are attributable (see sync.ts output-path collision warning).
 * - Deterministic key ordering so `.provenance.json` diffs are stable across
 *   runs over the same canonical + adapter inputs.
 *
 * **Limitations:**
 * - Only adapters whose output paths already carry `sourceFiles` are
 *   persisted. Adapters that bypass the BaseAdapter tracking helpers and
 *   read canonical content directly appear with an empty `sourceFiles[]`
 *   until they are migrated (tracked as a follow-up to C8-D12-M3).
 * - No content hashing — provenance answers "where did this output come
 *   from" not "is the output still in sync with the source". For content
 *   integrity see `.agents/.integrity.json`.
 */
export interface ProvenanceEntry {
  /** Adapter that produced the output (e.g. `"cursor"`, `"claude"`). */
  adapter: string;
  /** Repo-relative output path the adapter wrote (posix separators). */
  path: string;
  /**
   * Repo-relative canonical file paths (posix separators) that contributed
   * to this output. Empty when the adapter did not read canonical content
   * through the BaseAdapter tracking helpers.
   */
  sourceFiles: string[];
}

export interface ProvenanceManifest {
  version: number;
  generated: string;
  hatchVersion: string;
  entries: ProvenanceEntry[];
}

const PROVENANCE_FILE = ".provenance.json";

/**
 * Normalize an absolute filesystem path to a repo-relative posix path.
 *
 * The adapter-tracking layer records canonical `sourcePath` values as
 * absolute filesystem paths; persisting those verbatim into
 * `.provenance.json` would leak developer-machine paths into a file that
 * can be committed. Normalizing to repo-relative posix paths keeps the
 * diagnostic portable across machines and diffable in code review.
 */
function normalizeToRepoPath(absPath: string, rootDir: string): string {
  const rel = relative(rootDir, absPath);
  // On Windows, relative() uses backslashes; normalize to posix separators
  // so `.provenance.json` is identical regardless of host OS.
  return sep === "/" ? rel : rel.split(sep).join(posix.sep);
}

/**
 * Build a provenance manifest from a list of per-adapter generation
 * results. Each adapter contributes its outputs in order; the output
 * `sourceFiles` (populated by {@link BaseAdapter.generate}) are normalised
 * to repo-relative posix paths.
 *
 * Entries are sorted by (adapter, path) so re-running `sync` over the
 * same inputs produces a byte-identical `.provenance.json` — important
 * for CI review of provenance drift.
 */
export function buildProvenanceManifest(
  hatchVersion: string,
  rootDir: string,
  perAdapterOutputs: Array<{ adapter: string; outputs: AdapterOutput[] }>,
  previousManifest?: ProvenanceManifest | null,
): ProvenanceManifest {
  const entries: ProvenanceEntry[] = [];
  for (const { adapter, outputs } of perAdapterOutputs) {
    for (const out of outputs) {
      const sources = (out.sourceFiles ?? [])
        .map((s) => normalizeToRepoPath(s, rootDir))
        .sort();
      entries.push({
        adapter,
        path: out.path,
        sourceFiles: sources,
      });
    }
  }
  entries.sort((a, b) => {
    const byAdapter = a.adapter.localeCompare(b.adapter);
    if (byAdapter !== 0) return byAdapter;
    return a.path.localeCompare(b.path);
  });

  // G6 (v1.7.1): mirror the integrity-manifest G4 idempotency invariant.
  // When the new entries are byte-equivalent to the previous manifest's
  // entries (and hatchVersion matches), preserve the previous `generated`
  // timestamp so a redundant sync does not bump the timestamp. Without
  // this, `.provenance.json` always drifts between syncs and users who
  // commit it (or run worktree-setup) see spurious diffs.
  if (
    previousManifest &&
    previousManifest.hatchVersion === hatchVersion &&
    provenanceEntriesEqual(previousManifest.entries, entries)
  ) {
    return previousManifest;
  }

  return {
    version: 1,
    generated: new Date().toISOString(),
    hatchVersion,
    entries,
  };
}

/** Deep equality on sorted ProvenanceEntry arrays. */
function provenanceEntriesEqual(a: ProvenanceEntry[], b: ProvenanceEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ea = a[i];
    const eb = b[i];
    if (ea.adapter !== eb.adapter) return false;
    if (ea.path !== eb.path) return false;
    if (ea.sourceFiles.length !== eb.sourceFiles.length) return false;
    for (let j = 0; j < ea.sourceFiles.length; j++) {
      if (ea.sourceFiles[j] !== eb.sourceFiles[j]) return false;
    }
  }
  return true;
}

/** Atomically write the provenance manifest to `.agents/.provenance.json`. */
export async function writeProvenanceManifest(
  agentsDir: string,
  manifest: ProvenanceManifest,
): Promise<void> {
  const filePath = join(agentsDir, PROVENANCE_FILE);
  await atomicWriteFile(filePath, JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Read and validate the provenance manifest. Returns null when the file
 * is absent (not an error — provenance is produced by `sync`, so a
 * project that has never synced won't have one) or when it fails schema
 * validation.
 */
export async function readProvenanceManifest(
  agentsDir: string,
): Promise<ProvenanceManifest | null> {
  const filePath = join(agentsDir, PROVENANCE_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Malformed JSON is treated as "no trustworthy manifest"; the caller's
    // null branch behaves the same as a missing file. Re-throw anything that
    // is not a JSON syntax error so unexpected faults (e.g. OOM) still
    // propagate — mirrors the integrity manifest reader's contract.
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  if (!isProvenanceManifest(parsed)) return null;
  return parsed;
}

/** Runtime type guard for persisted provenance manifests. */
function isProvenanceManifest(data: unknown): data is ProvenanceManifest {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== "number") return false;
  if (typeof obj.generated !== "string") return false;
  if (typeof obj.hatchVersion !== "string") return false;
  if (!Array.isArray(obj.entries)) return false;
  for (const e of obj.entries as unknown[]) {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.adapter !== "string") return false;
    if (typeof entry.path !== "string") return false;
    if (!Array.isArray(entry.sourceFiles)) return false;
    for (const s of entry.sourceFiles as unknown[]) {
      if (typeof s !== "string") return false;
    }
  }
  return true;
}
