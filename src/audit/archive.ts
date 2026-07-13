/**
 * src/audit/archive.ts
 *
 * Archival tooling for the audit finding-registry. Splits the live registry
 * into "live" (open + cycle ∈ {N, N-1} terminals + active rollover stubs) and
 * "archive" (everything else), writing the archived slice to an immutable
 * cycle file under `governance/audit/archive/cycle-{N}-finding-registry.json`
 * and updating a sha256-anchored manifest at `governance/audit/archive/index.json`.
 *
 * Pillars: P4 (Lean Coverage — bounded live registry),
 *          P5 (Governance Self-Quality — code-enforced archival contract),
 *          P7 (Speed & Token Efficiency — Phase-1 read shrinks ~88%).
 *
 * Exposed so the archival logic is testable under vitest with temp paths,
 * separate from the `scripts/audit-archive.ts` CLI wrapper which binds it
 * to canonical repo paths.
 *
 * Refuses v1 input — Phase 2 (`audit:migrate`) must run first. This is shipped
 * behavior, not a defect: archival assumes the v2 envelope so live/archive
 * splits are deterministic against `schema_version`.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  open,
  stat,
  unlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join, basename } from "node:path";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { promoteToHistory, readInsights } from "./insights.js";
import {
  CURRENT_REGISTRY_VERSION,
  parseRegistry,
  validateRegistry,
  type Finding,
  type Registry,
} from "./registry-schema.js";

export interface ArchivePaths {
  /** Path to the live registry: `governance/audit/finding-registry.json`. */
  registry: string;
  /** Directory holding cycle archives: `governance/audit/archive/`. */
  archiveDir: string;
  /** Manifest path: `governance/audit/archive/index.json`. */
  archiveIndex: string;
  /** Live anchor log: `.audit-workspace/registry-anchor-log.jsonl`. */
  anchorLog: string;
  /** Directory where rotated anchor logs land. Typically equals `archiveDir`. */
  anchorArchiveDir: string;
  /**
   * Optional path to the on-disk insights ring buffer. When set together with
   * `currentInsightsFile`, `archiveCycle` calls `promoteToHistory` after the
   * registry split lands. Omitting either is the documented opt-out (used by
   * unit tests that don't care about insights, and by callers that drive the
   * promotion separately).
   */
  insightsFile?: string;
  /**
   * Optional path to the ephemeral current-cycle insights file. When absent
   * at promotion time, `archiveCycle` records `insightsPromoted: false` and
   * leaves the ring buffer unchanged.
   */
  currentInsightsFile?: string;
}

export interface ArchiveCycleOptions {
  paths: ArchivePaths;
  /** Current cycle number; entries with `cycle ∈ {N, N-1}` stay live. */
  cycle: number;
  /** When true, produce a result without writing any files. */
  dryRun?: boolean;
  /** ISO timestamp; defaults to `new Date().toISOString()`. Override for deterministic tests. */
  generatedAt?: string;
  /** Optional commit metadata stamped into the index entry. */
  baselineCommit?: string;
  /** Optional commit metadata stamped into the index entry. */
  headCommit?: string;
  /**
   * When true, a real (non-dry-run) close that has both insights paths wired
   * but whose `currentInsightsFile` accumulator is ABSENT on disk fails with a
   * loud `ArchiveError` BEFORE any file mutation — instead of a silent
   * `insightsPromoted: false` skip (D16-SA16.2-01). A missing accumulator at
   * close is the exact mechanism that lost a cycle's telemetry: promotion
   * silently no-ops, the ring goes stale, and the loss is discovered a cycle
   * late. Off by default so unit tests and out-of-band callers that
   * legitimately omit the accumulator keep the lenient behavior; the
   * `scripts/audit-archive.ts` CLI sets it on the `--in-place` close path.
   */
  strictAccumulator?: boolean;
}

export interface ArchiveIndexEntry {
  cycle: number;
  file: string;
  entry_count: number;
  sha256: string;
  archived_at: string;
  baseline_commit?: string;
  head_commit?: string;
}

export interface ArchiveCycleResult {
  archivedCount: number;
  livedCount: number;
  /** Absolute path to the new archive file (whether or not it was written). */
  archivePath: string;
  /** sha256 of the archive file content (same whether dry-run or applied). */
  archiveSha256: string;
  /** sha256 of the new live-registry content. */
  liveSha256: string;
  archivedEntries: Finding[];
  livedEntries: Finding[];
  /**
   * True when `archiveCycle` called `promoteToHistory` and it successfully
   * pushed a finished-cycle snapshot into the insights ring. False when:
   *   - `dryRun` was true (no I/O performed),
   *   - `insightsFile` or `currentInsightsFile` was not set on `ArchivePaths`,
   *   - the ephemeral current-cycle insights file did not exist on disk,
   *   - or promotion threw and the failure was captured in `warnings`.
   */
  insightsPromoted?: boolean;
  /**
   * Diagnostics surfaced by side-effect steps that do not gate the registry
   * split (currently: insights promotion). Empty/absent on the happy path.
   */
  warnings?: string[];
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

function sha256(buf: string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * True when `path` exists (any stat succeeds), false on ENOENT. Other stat
 * errors (permission, I/O) rethrow — a strict close gate must not treat an
 * unreadable accumulator as "present". Used by the strict-accumulator gate.
 */
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
 * Coerce the `cycle` field — which may legitimately be a number or a numeric
 * string like `"7.5"` — to a number. Non-numeric values become NaN, which
 * fails the equality check so such entries fall into the archive bucket
 * (they cannot be claimed as belonging to the current/previous cycle).
 */
function coerceCycle(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * True when an entry should remain in the live registry.
 *
 * Rule of thumb (matches plan §Phase 3):
 *   - "open" entries stay live (execution_status undefined or "pending").
 *   - terminal entries with `cycle ∈ {currentCycle, currentCycle - 1}` stay
 *     live so Phase 1 of the next cycle still sees last-cycle prior context.
 *   - active rollover stubs stay live (`disposition === "rollover"`, or
 *     `disposition === "partially_promoted"` with non-deferred status).
 */
export function isLiveEntry(f: Finding, currentCycle: number): boolean {
  // Open: explicit undefined or "pending". Anything else is terminal.
  const status = f.execution_status;
  const isOpen = status === undefined || status === "pending";
  if (isOpen) return true;

  // Active rollover stub (rolls forward across cycles until terminal).
  if (f.disposition === "rollover") return true;
  if (
    f.disposition === "partially_promoted" &&
    f.execution_status !== "deferred"
  ) {
    return true;
  }

  // Terminal: keep if cycle ∈ {N, N-1}. Otherwise archive.
  const cycle = coerceCycle(f.cycle);
  if (Number.isFinite(cycle)) {
    if (cycle === currentCycle || cycle === currentCycle - 1) return true;
  }
  return false;
}

interface ArchiveIndexFile {
  schema_version: string;
  generated_at: string;
  archives: ArchiveIndexEntry[];
}

const INDEX_SCHEMA_VERSION = "1.0.0";

async function readIndex(path: string): Promise<ArchiveIndexFile> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ArchiveIndexFile>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.archives)) {
      throw new ArchiveError(
        `archive index at ${path} is not a valid {schema_version, generated_at, archives[]} object`,
      );
    }
    return {
      schema_version: parsed.schema_version ?? INDEX_SCHEMA_VERSION,
      generated_at: parsed.generated_at ?? "",
      archives: parsed.archives,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        schema_version: INDEX_SCHEMA_VERSION,
        generated_at: "",
        archives: [],
      };
    }
    throw err;
  }
}

/**
 * Verify a just-written file's size matches the source content via fd-based
 * stat (mirrors the pattern at `src/archive/index.ts:179-197`). Catches the
 * narrow window between rename completion and any subsequent I/O.
 */
async function verifyWrittenSize(
  path: string,
  expectedBytes: number,
): Promise<void> {
  const fh = await open(path, "r");
  try {
    const s = await fh.stat();
    if (s.size !== expectedBytes) {
      throw new ArchiveError(
        `archive write verification failed for ${path}: expected ${expectedBytes} bytes, got ${s.size}`,
      );
    }
  } finally {
    await fh.close();
  }
}

/**
 * Write binary content atomically via tmp + fdatasync + rename, mirroring the
 * UTF-8 string path in `src/merge/safeWrite.ts::atomicWriteFile`. A separate
 * helper is required because `atomicWriteFile` re-encodes its `content` as
 * UTF-8, which is lossy for arbitrary bytes (gzip output contains bytes ≥
 * 0x80). This writer takes a Buffer and writes it verbatim, so the cold-pack
 * bundle on disk is genuine gzip (starts with 0x1f 0x8b), not a re-encoded
 * string. The caller owns the parent-directory mkdir.
 */
async function atomicWriteBinary(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  try {
    await writeFile(tmpPath, data);
    const fh = await open(tmpPath, "r+");
    try {
      await fh.datasync();
    } catch (err) {
      // Some filesystems reject fdatasync (FAT32, network mounts). The atomic
      // rename provides the safety guarantee; datasync is best-effort durability.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EINVAL") throw err;
    } finally {
      await fh.close();
    }
    await rename(tmpPath, filePath);
  } finally {
    // Silent Failure Contract (P5): surface a diagnostic when tmp cleanup fails
    // for any reason other than "already renamed away" (ENOENT).
    try {
      await unlink(tmpPath);
    } catch (unlinkErr) {
      const code = (unlinkErr as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(
          `hatch3r: failed to remove temp file ${tmpPath}: ` +
            `${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}.`,
        );
      }
    }
  }
}

/**
 * Run the archival pipeline. When `dryRun` is true, returns a result without
 * writing anything. Throws ArchiveError on v1 input, validation drift, or I/O
 * failure during the write phase.
 *
 * Write order (when not dry-run):
 *   1. atomicWriteFile archive cycle file
 *   2. verify written size via fd-based stat
 *   3. atomicWriteFile new live registry
 *   4. atomicWriteFile updated index manifest
 *
 * Crash safety: a crash between (1) and (3) leaves the archive file present
 * but the live registry intact (since atomicWriteFile is tmp+rename). A re-run
 * is idempotent — the second pass produces an empty archive (every "should
 * archive" entry already moved out on the first pass).
 */
export async function archiveCycle(
  opts: ArchiveCycleOptions,
): Promise<ArchiveCycleResult> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const { paths, cycle, dryRun = false } = opts;

  // 1. Read + parse the live registry.
  let liveContent: string;
  try {
    liveContent = await readFile(paths.registry, "utf-8");
  } catch (err) {
    throw new ArchiveError(
      `failed to read registry at ${paths.registry}: ${(err as Error).message}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(liveContent);
  } catch (err) {
    throw new ArchiveError(
      `failed to parse registry at ${paths.registry}: ${(err as Error).message}`,
    );
  }
  const parsed = parseRegistry(raw);
  if (parsed.kind === "legacy-v1") {
    throw new ArchiveError(
      "registry is v1; run `npm run audit:migrate -- --in-place` first",
    );
  }

  // 2. Refuse if validation drifts. List first 5 reasons for actionability.
  const drifts = validateRegistry(parsed);
  if (drifts.length > 0) {
    const sample = drifts
      .slice(0, 5)
      .map((d) => `${d.finding_id}: ${d.reason}`)
      .join("; ");
    throw new ArchiveError(
      `registry validation found ${drifts.length} drift items; refusing to archive. ` +
        `First 5: ${sample}${drifts.length > 5 ? ` (+${drifts.length - 5} more)` : ""}`,
    );
  }

  const allEntries: Finding[] = parsed.registry.entries;

  // 3. Split entries by predicate.
  const livedEntries: Finding[] = [];
  const archivedEntries: Finding[] = [];
  for (const e of allEntries) {
    if (isLiveEntry(e, cycle)) {
      livedEntries.push(e);
    } else {
      archivedEntries.push(e);
    }
  }

  // 4. Build archive content + new live registry content.
  const archiveContentObj = {
    schema_version: CURRENT_REGISTRY_VERSION,
    generated_at: generatedAt,
    archived_at_cycle: cycle,
    entries: archivedEntries,
  };
  const archiveFileName = `cycle-${cycle}-finding-registry.json`;
  const archivePath = join(paths.archiveDir, archiveFileName);
  const archiveContent = JSON.stringify(archiveContentObj, null, 2) + "\n";
  const archiveSha = sha256(archiveContent);

  const newLiveRegistry: Registry = {
    schema_version: CURRENT_REGISTRY_VERSION,
    generated_at: generatedAt,
    entries: livedEntries,
  };
  const liveContentNew = JSON.stringify(newLiveRegistry, null, 2) + "\n";
  const liveSha = sha256(liveContentNew);

  const result: ArchiveCycleResult = {
    archivedCount: archivedEntries.length,
    livedCount: livedEntries.length,
    archivePath,
    archiveSha256: archiveSha,
    liveSha256: liveSha,
    archivedEntries,
    livedEntries,
  };

  if (dryRun) return result;

  // 4b. Strict-accumulator close gate (D16-SA16.2-01). When the caller wired
  // both insights paths for a real close and asked for strict mode, a missing
  // accumulator is a LOUD failure BEFORE any file mutation — not a silent
  // promotion no-op. This is the mechanism that lost Cycle-11's telemetry: the
  // accumulator was absent at close, `promoteToHistory` silently returned
  // `promoted: false`, and the ring went stale (discovered a cycle late).
  // Aborting here (pre-write) lets the operator recover the accumulator and
  // re-run cleanly rather than closing on a half-written telemetry lane.
  if (
    opts.strictAccumulator &&
    paths.insightsFile &&
    paths.currentInsightsFile &&
    !(await fileExists(paths.currentInsightsFile))
  ) {
    throw new ArchiveError(
      `insights accumulator absent at cycle ${cycle} close: ` +
        `${paths.currentInsightsFile} does not exist, so the ring cannot be ` +
        `promoted and this cycle's telemetry would be silently lost. Recover or ` +
        `regenerate the current-cycle accumulator before archiving ` +
        `(D16-SA16.2-01), or pass --allow-missing-accumulator to archive without ` +
        `promotion.`,
    );
  }

  // 5. Apply: write archive file → verify → write live → update index.
  await mkdir(paths.archiveDir, { recursive: true });
  await mkdir(dirname(paths.registry), { recursive: true });

  const archiveBytes = Buffer.byteLength(archiveContent, "utf-8");
  await atomicWriteFile(archivePath, archiveContent);
  await verifyWrittenSize(archivePath, archiveBytes);

  await atomicWriteFile(paths.registry, liveContentNew);

  // 6. Update manifest. Read-modify-write. Append a new entry; do not
  // overwrite an existing entry for the same cycle (caller intent: re-running
  // an already-archived cycle is a no-op archive, but the manifest is an
  // append-only log of cycle-archive events; keep all entries for audit).
  const index = await readIndex(paths.archiveIndex);
  const newEntry: ArchiveIndexEntry = {
    cycle,
    file: archiveFileName,
    entry_count: archivedEntries.length,
    sha256: archiveSha,
    archived_at: generatedAt,
  };
  if (opts.baselineCommit !== undefined) {
    newEntry.baseline_commit = opts.baselineCommit;
  }
  if (opts.headCommit !== undefined) {
    newEntry.head_commit = opts.headCommit;
  }
  index.archives.push(newEntry);
  index.schema_version = INDEX_SCHEMA_VERSION;
  index.generated_at = generatedAt;
  await atomicWriteFile(
    paths.archiveIndex,
    JSON.stringify(index, null, 2) + "\n",
  );

  // 7. Insights ring-buffer promotion. Skip in dry-run mode (handled by the
  // earlier early-return). Skip when the caller didn't wire either path —
  // unit tests typically omit them, and CLI callers that drive promotion
  // out-of-band do too. Failures are non-fatal: the archive split has
  // already landed atomically, so a promotion error is recorded as a
  // warning but does not roll back the archive.
  if (paths.insightsFile && paths.currentInsightsFile) {
    // The registry split has already landed atomically before we reach this
    // point; surfacing promotion failures via `warnings` (rather than throwing)
    // keeps archive state consistent even when the insights module is
    // misconfigured. Failures push to `result.warnings` per the Silent Failure
    // Contract — they are diagnosed, not swallowed.
    try {
      const promo = await promoteToHistory({
        insightsFile: paths.insightsFile,
        currentFile: paths.currentInsightsFile,
      });
      result.insightsPromoted = promo.promoted;
      // Soft gaps from accumulator validation (e.g. an absent
      // cl2_artifact_closure) propagate as archive warnings — surfaced, not
      // swallowed (Silent Failure Contract, P5).
      if (promo.warnings.length > 0) {
        result.warnings = [
          ...(result.warnings ?? []),
          ...promo.warnings.map((w) => `insights accumulator: ${w}`),
        ];
      }
    } catch (err) {
      result.insightsPromoted = false;
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings = [
        ...(result.warnings ?? []),
        `insights promotion failed: ${msg}`,
      ];
    }
  }

  return result;
}

/** Matches a cycle archive file name: `cycle-<N>-finding-registry.json`. */
const CYCLE_ARCHIVE_NAME_RE = /^cycle-\d+(?:\.\d+)?-finding-registry\.json$/;

/** Extract the cycle number from a `cycle-<N>-...` file name; NaN when absent. */
function cycleNumberOf(fileName: string): number {
  const m = fileName.match(/^cycle-(\d+(?:\.\d+)?)-/);
  return m ? Number(m[1]) : NaN;
}

/**
 * Read the archive directory and return the cycle archive file names sorted
 * descending by cycle number (newest first). Returns `null` when the directory
 * does not exist (ENOENT) so callers can distinguish "no directory" from
 * "directory with no cycle files" ([]). Shared by `enumerateAuditArchives` and
 * `coldPackAuditArchives` so both apply the identical filter + sort.
 */
async function listCycleArchivesDescending(
  archiveDir: string,
): Promise<string[] | null> {
  let entries: string[];
  try {
    entries = await readdir(archiveDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
  // `CYCLE_ARCHIVE_NAME_RE` guarantees a numeric `cycle-<N>-` segment, so
  // `cycleNumberOf` is always finite for the filtered names — descending sort.
  return entries
    .filter((n) => CYCLE_ARCHIVE_NAME_RE.test(n))
    .sort((a, b) => cycleNumberOf(b) - cycleNumberOf(a));
}

/**
 * Lists existing cycle-N archive files (sorted descending by cycle) but does
 * not delete or cold-pack any of them — enumerate-only, preservation-first.
 * Cold-packing is implemented in `coldPackAuditArchives` (gzipped JSON bundle,
 * stdlib-only — no tar dependency).
 *
 * Returns `{ kept: [archive file names sorted descending by cycle],
 *            coldArchived: [] }`. `opts.keep` is accepted but advisory only
 * here; nothing is removed.
 *
 * Named `enumerateAuditArchives` (not `pruneArchives`) to avoid the symbol
 * collision with `src/archive/index.ts::pruneArchives`, which is a distinct
 * production function that actually deletes tool-output archives. This function
 * only enumerates; the descriptive name reflects its real behavior (D2-SA2.7
 * F2).
 */
export async function enumerateAuditArchives(
  paths: ArchivePaths,
  opts: { keep?: number } = {},
): Promise<{ kept: string[]; coldArchived: string[] }> {
  void opts.keep;
  const cycleFiles = await listCycleArchivesDescending(paths.archiveDir);
  if (cycleFiles === null) return { kept: [], coldArchived: [] };
  return { kept: cycleFiles, coldArchived: [] };
}

/** Inner (pre-gzip) shape of a cold-pack bundle. */
interface ColdPackBundle {
  schemaVersion: 1;
  packedAtCycleLow: number;
  packedAtCycleHigh: number;
  /** Map of original archive file name → its raw file content string. */
  files: Record<string, string>;
}

const COLD_PACK_SCHEMA_VERSION = 1 as const;

/**
 * Cold-pack the older cycle archive files into a single gzipped JSON bundle
 * under `<archiveDir>/cold/`, preservation-first: the bundle is written +
 * verified BEFORE the loose originals are removed. Keeps the `keep` newest
 * cycle archives loose. Returns the kept (loose) filenames, the coldArchived
 * (bundled) filenames, and the bundle path (or null when nothing was packed).
 *
 * stdlib only (`node:zlib` gzip — stdlib ships no tar), so this adds no
 * dependency. The bundle is reversible: gunzip the file and JSON.parse the
 * result to recover `{ schemaVersion, packedAtCycleLow, packedAtCycleHigh,
 * files: { "<name>": "<content>" } }`.
 *
 * Write order (preservation-first):
 *   1. mkdir `<archiveDir>/cold/` recursive.
 *   2. atomicWriteFile the gzipped bundle (tmp + rename).
 *   3. Verify: re-read the bundle, gunzip, JSON.parse, and confirm every packed
 *      file name is present with byte-identical content.
 *   4. Only AFTER step 3 passes, unlink the loose originals that were packed.
 *
 * If the verification round-trip fails, the loose originals are left intact
 * (never deleted before the bundle is confirmed), the partial bundle is removed,
 * and the call returns `coldArchived: []` so no data is lost.
 *
 * Distinct from `enumerateAuditArchives` (enumerate-only) and from
 * `src/archive/index.ts::pruneArchives` (deletes tool-output archives).
 */
export async function coldPackAuditArchives(
  paths: ArchivePaths,
  opts: { keep: number },
): Promise<{ kept: string[]; coldArchived: string[]; bundlePath: string | null }> {
  const cycleFiles = await listCycleArchivesDescending(paths.archiveDir);
  if (cycleFiles === null) {
    return { kept: [], coldArchived: [], bundlePath: null };
  }
  // Nothing to pack when there are no more files than we keep loose.
  if (cycleFiles.length <= opts.keep) {
    return { kept: cycleFiles, coldArchived: [], bundlePath: null };
  }

  // `kept` = the `keep` newest (descending order ⇒ slice from the front).
  // `toPack` = the older remainder.
  const kept = cycleFiles.slice(0, opts.keep);
  const toPack = cycleFiles.slice(opts.keep);

  // Read each file to pack; record raw content keyed by original file name.
  // Every name in `toPack` came through the `CYCLE_ARCHIVE_NAME_RE` filter in
  // listCycleArchivesDescending, so `cycleNumberOf` is always finite here — no
  // NaN guard needed. `toPack` is non-empty here (cycleFiles.length > keep).
  const files: Record<string, string> = {};
  const packCycles: number[] = [];
  for (const name of toPack) {
    files[name] = await readFile(join(paths.archiveDir, name), "utf-8");
    packCycles.push(cycleNumberOf(name));
  }
  const low = Math.min(...packCycles);
  const high = Math.max(...packCycles);

  const bundle: ColdPackBundle = {
    schemaVersion: COLD_PACK_SCHEMA_VERSION,
    packedAtCycleLow: low,
    packedAtCycleHigh: high,
    files,
  };
  const gzipped = gzipSync(Buffer.from(JSON.stringify(bundle), "utf-8"));

  const coldDir = join(paths.archiveDir, "cold");
  const bundleName = `cycle-${low}-${high}.json.gz`;
  const bundlePath = join(coldDir, bundleName);

  await mkdir(coldDir, { recursive: true });
  // Write the raw gzip bytes verbatim (atomicWriteFile is UTF-8-only and would
  // corrupt bytes ≥ 0x80), then size-verify the rename landed.
  await atomicWriteBinary(bundlePath, gzipped);
  await verifyWrittenSize(bundlePath, gzipped.length);

  // Preservation-first verification: re-read + gunzip + parse, then confirm
  // every packed file is present with byte-identical content before deleting
  // any original. On any mismatch, remove the partial bundle and bail without
  // touching the loose originals.
  let verified = false;
  try {
    const onDisk = await readFile(bundlePath);
    const inflated = gunzipSync(onDisk).toString("utf-8");
    const parsed = JSON.parse(inflated) as ColdPackBundle;
    verified =
      parsed.schemaVersion === COLD_PACK_SCHEMA_VERSION &&
      toPack.every(
        (name) =>
          Object.prototype.hasOwnProperty.call(parsed.files, name) &&
          parsed.files[name] === files[name],
      );
  } catch {
    verified = false;
  }

  if (!verified) {
    // Remove the partial/corrupt bundle so a re-run starts clean; never delete
    // an original when the bundle is unverified.
    try {
      await unlink(bundlePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(
          `hatch3r: cold-pack verification failed for ${bundlePath} and the ` +
            `partial bundle could not be removed: ` +
            `${err instanceof Error ? err.message : String(err)}. Remove it manually.`,
        );
      }
    }
    return { kept: cycleFiles, coldArchived: [], bundlePath: null };
  }

  // Bundle confirmed lossless — now (and only now) remove the loose originals.
  const coldArchived: string[] = [];
  for (const name of toPack) {
    await unlink(join(paths.archiveDir, name));
    coldArchived.push(name);
  }

  return { kept, coldArchived, bundlePath };
}

interface AnchorLine {
  phase?: string;
  timestamp?: string;
  sha256?: string;
  entry_count?: number;
  cycle?: number | string;
  // Forward-compatible: tolerate extra fields silently.
  [extra: string]: unknown;
}

/* eslint-disable silent-failure/no-silent-catch -- pure parsing helper:
 * malformed JSON lines are a known input class (handwritten edits, partial
 * writes pre-rotation) and the caller's contract — preserve unrecognized
 * lines on the live side — already covers them. The null return is the
 * diagnostic signal.
 */
function parseAnchorLine(line: string): AnchorLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as AnchorLine;
  } catch {
    return null;
  }
}
/* eslint-enable silent-failure/no-silent-catch */

/**
 * Rotate the registry-anchor-log: keep entries with `cycle >= currentCycle - 2`
 * (last 3 cycles) live; copy older entries to a single rolled file under
 * `paths.anchorArchiveDir + /anchor-log-cycle-{minOlder}-{maxOlder}.jsonl`.
 *
 * Atomically rewrites the live anchor log with kept entries. When the live
 * log doesn't exist, this is a no-op returning `{ rotatedTo: "", keptCount: 0 }`.
 *
 * Entries without a parseable `cycle` field are kept (chain-of-custody —
 * unattributed migration anchors must not be silently archived).
 */
export async function rotateAnchorLog(
  paths: ArchivePaths,
  currentCycle: number,
): Promise<{ rotatedTo: string; keptCount: number }> {
  let content: string;
  try {
    content = await readFile(paths.anchorLog, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { rotatedTo: "", keptCount: 0 };
    throw err;
  }
  const lines = content.split("\n");
  const kept: string[] = [];
  const rolled: AnchorLine[] = [];
  for (const line of lines) {
    const parsed = parseAnchorLine(line);
    if (parsed === null) {
      // Preserve blank lines / unparseable lines on the live side. They were
      // there before; rotation should not lose data we cannot classify.
      if (line.length > 0) kept.push(line);
      continue;
    }
    const cycle = coerceCycle(parsed.cycle);
    if (!Number.isFinite(cycle)) {
      // Unattributed entries (e.g. migration anchors without a cycle stamp)
      // stay live — they're the chain-of-custody root and must not roll off.
      kept.push(line);
      continue;
    }
    if (cycle >= currentCycle - 2) {
      kept.push(line);
    } else {
      rolled.push(parsed);
    }
  }

  let rotatedTo = "";
  if (rolled.length > 0) {
    const cycles = rolled
      .map((r) => coerceCycle(r.cycle))
      .filter((n) => Number.isFinite(n));
    const minC = Math.min(...cycles);
    const maxC = Math.max(...cycles);
    const fileName =
      minC === maxC
        ? `anchor-log-cycle-${minC}.jsonl`
        : `anchor-log-cycle-${minC}-${maxC}.jsonl`;
    rotatedTo = join(paths.anchorArchiveDir, fileName);
    await mkdir(paths.anchorArchiveDir, { recursive: true });
    const rolledContent =
      rolled.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await atomicWriteFile(rotatedTo, rolledContent);
  }

  // Always rewrite the live log atomically — even when nothing rolled — so
  // line endings and trailing-newline normalization land deterministically.
  const liveContent =
    kept.length === 0 ? "" : kept.filter((l) => l.length > 0).join("\n") + "\n";
  await atomicWriteFile(paths.anchorLog, liveContent);

  return { rotatedTo, keptCount: kept.filter((l) => l.length > 0).length };
}

export interface HistoryCurrencyResult {
  /** True when `history[last].cycle_number === currentCycle - 1`. */
  current: boolean;
  /** The cycle number on the newest history entry, or null when history is empty / un-numbered. */
  lastCycle: number | null;
  /** The cycle number this close expected on the newest history entry (currentCycle - 1). */
  expectedCycle: number;
  /** Human-readable reason when `current === false`; empty string when current. */
  reason: string;
}

/**
 * Cycle-close gate (D16-8 / SA16.2-F3): assert the insights ring's newest
 * history entry belongs to the cycle that just closed, i.e.
 * `history[last].cycle_number === currentCycle - 1`.
 *
 * The promotion step (`promoteToHistory`, driven by `archiveCycle`) appends the
 * finished cycle's accumulator to `history[]` before the NEXT cycle starts —
 * so at the close of cycle N (which seeds cycle N+1), the newest entry must be
 * cycle N. When promotion silently no-ops (missing accumulator) or never ran,
 * the ring goes stale and the next cycle's Phase-1 / Phase-6 reads operate on
 * an old or single-entry buffer (the failure this finding records: a
 * cycle-7-only ring after cycles 9 and 10 had executed). This gate makes that
 * drift a hard, loud failure at cycle close instead of a 2-cycle-late
 * discovery.
 *
 * Pure read — never mutates the ring. Returns a structured result; the CLI
 * wrapper turns `current === false` into a non-zero exit.
 */
export async function assertHistoryCurrent(
  insightsFile: string,
  currentCycle: number,
): Promise<HistoryCurrencyResult> {
  const expectedCycle = currentCycle - 1;
  const ring = await readInsights({
    insightsFile,
    // currentFile is unused by readInsights; supply the same path to satisfy
    // the InsightsPaths shape without reading an ephemeral accumulator here.
    currentFile: insightsFile,
  });

  if (ring.history.length === 0) {
    return {
      current: false,
      lastCycle: null,
      expectedCycle,
      reason: `insights history is empty; expected newest entry cycle_number ${expectedCycle} after cycle ${currentCycle} close`,
    };
  }

  const last = ring.history[ring.history.length - 1];
  const lastCycle = coerceCycle(last.cycle_number);
  if (!Number.isFinite(lastCycle)) {
    return {
      current: false,
      lastCycle: null,
      expectedCycle,
      reason: `newest insights history entry has no numeric cycle_number (got ${JSON.stringify(last.cycle_number)}); expected ${expectedCycle}`,
    };
  }

  if (lastCycle !== expectedCycle) {
    return {
      current: false,
      lastCycle,
      expectedCycle,
      reason: `insights history is stale: newest entry is cycle ${lastCycle}, expected ${expectedCycle} after cycle ${currentCycle} close — run \`npm run audit:archive -- --cycle ${currentCycle} --in-place\` to promote the accumulator`,
    };
  }

  return { current: true, lastCycle, expectedCycle, reason: "" };
}

/** Internal export used by tests + the CLI for sane error message derivation. */
export const __internal = {
  coerceCycle,
  parseAnchorLine,
  readIndex,
  basenameForCycle: (cycle: number): string =>
    basename(`cycle-${cycle}-finding-registry.json`),
};
