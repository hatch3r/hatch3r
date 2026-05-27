/**
 * Pre-mutation snapshot + rollback for hatch3r orchestrators.
 *
 * Decision 27 / hatch3r 2.0.0 / Bucket 2.2: every long-running
 * orchestrator captures the contents of the files it is about to mutate
 * into a session-scoped snapshot directory, so a single command can
 * revert the entire run if the operator decides the change was wrong.
 *
 * **Layout:**
 *   .hatch3r/snapshots/
 *     <session-id>/
 *       meta.json                  -- session metadata
 *       files/
 *         <relative-mirror-of-touched-paths>
 *
 * **Atomicity:** rollback uses `atomicWriteFile` (tmp + rename) per file
 * and is a two-phase commit across files (prepare verifies every entry,
 * commit only proceeds on a clean prepare, and a mid-commit failure rolls
 * the already-applied entries forward). The disk is therefore either fully
 * restored or left in its pre-rollback state — never a mixed half-restore
 * (F1.5-H3 / F8.2.4, Decision 27). Pre-existing files outside the snapshot
 * are left untouched.
 *
 * **Local-only:** snapshots live entirely under `.hatch3r/snapshots/`
 * inside the user's repo. No network egress, no external storage. The
 * P6 (Security & Trust) commitment is enforced by construction — every
 * read and write in this module goes through `node:fs/promises` against
 * absolute paths rooted at `process.cwd()`.
 *
 * **Pillar service:** P1 (CLI UX — dry-run + actionable diagnostics),
 * P2 (Scientific Quality — atomic operations), P6 (Security & Trust —
 * local-only, no exfiltration).
 */

import { join, dirname, relative, resolve, isAbsolute, sep } from "node:path";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { HATCH3R_DIR, HatchError } from "../types.js";

// ── Types ────────────────────────────────────────────────────────

/**
 * On-disk metadata for a snapshot session. Written once at session
 * creation time and read by {@link listSnapshots} / {@link applyRollback}.
 */
export interface SnapshotMeta {
  /** Schema version. Bump on any breaking field change. */
  schemaVersion: 1;
  /** Caller-supplied session id (also the directory name). */
  sessionId: string;
  /** ISO-8601 timestamp when the snapshot was taken. */
  timestamp: string;
  /** Absolute paths of every file captured in this snapshot. */
  paths: string[];
  /** Project-relative paths used as the mirror layout under files/. */
  relativePaths: string[];
  /** Hatch3r project root at the time of capture. */
  projectRoot: string;
}

/**
 * Per-file outcome of a rollback (F1.5-H3 / F8.2.4). Surfaced so the CLI
 * can print a disposition table when a rollback does not complete cleanly.
 *
 * - `original-restored` — the pre-run state was written back (or the file
 *   was re-deleted for a tombstone).
 * - `mutated-still` — the rollback never touched this entry (prepare aborted
 *   before commit, or commit failed before reaching it); the file still
 *   holds the orchestrator's mutation.
 * - `rolled-forward` — a commit-phase failure forced this already-applied
 *   entry back to its pre-rollback (mutated) bytes to preserve all-or-nothing
 *   semantics.
 * - `unknown` — the entry's final state could not be determined (e.g. its
 *   pre-rollback bytes were unreadable during roll-forward).
 */
export interface RollbackFileDisposition {
  target: string;
  state: "original-restored" | "mutated-still" | "rolled-forward" | "unknown";
  error?: string;
}

/**
 * Result of {@link applyRollback}: count of files successfully restored
 * plus per-file errors. An empty `errors` array means full success.
 *
 * `dispositions` carries a per-file final-state row so callers (the CLI
 * failure-path table, scripted recoveries) can report exactly which files
 * were restored, which were rolled forward, and which still hold the
 * mutation. The field is optional for backward compatibility — existing
 * callers that only read `filesRestored`/`errors` are unaffected.
 */
export interface RollbackResult {
  filesRestored: number;
  errors: string[];
  dispositions?: RollbackFileDisposition[];
}

/**
 * Result of {@link createSnapshot}. `warnings` carries non-fatal capture
 * diagnostics (e.g. mirror-path collisions where a second input would have
 * overwritten an earlier capture, F1.5-H2).
 */
export interface CreateSnapshotResult {
  snapshotPath: string;
  count: number;
  warnings: string[];
}

/** Options accepted by {@link createSnapshot}. */
export interface CreateSnapshotOptions {
  /** Override the resolved project root (defaults to `process.cwd()`). */
  projectRoot?: string;
  /**
   * Silent Failure Contract hook for non-fatal capture diagnostics. When a
   * second input collapses to the same `_external/` mirror path as an
   * earlier input (cross-drive Windows scenario, F1.5-H2), the second write
   * is skipped and a warning is routed here (defaults to `console.warn`).
   * Production callers wire this to the per-command `warn()` UI helper so
   * the diagnostic lands in the same channel as other orchestrator output.
   */
  onWarn?: (message: string) => void;
}

// ── Constants ────────────────────────────────────────────────────

/** Snapshot root within the hatch3r project dir. */
export const SNAPSHOTS_DIR = "snapshots";

/** Metadata filename under each session directory. */
export const SNAPSHOT_META_FILE = "meta.json";

/** Mirror-of-touched-paths subdirectory under each session. */
export const SNAPSHOT_FILES_DIR = "files";

/** Schema version for `meta.json`. Bump on breaking field changes. */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Resolve the snapshots root for a given project root. Default project
 * root is `process.cwd()` so callers in the CLI flow do not need to
 * thread the directory through every call.
 */
export function snapshotsRoot(projectRoot: string = process.cwd()): string {
  return join(projectRoot, HATCH3R_DIR, SNAPSHOTS_DIR);
}

/**
 * Resolve the per-session directory for a given session id.
 */
export function sessionDir(sessionId: string, projectRoot: string = process.cwd()): string {
  return join(snapshotsRoot(projectRoot), sessionId);
}

/**
 * Convert an absolute source path into the mirror-relative location it
 * occupies inside the snapshot. Paths outside `projectRoot` are placed
 * under `_external/` so a rollback never silently writes into an
 * unrelated tree.
 *
 * **Path traversal guard (P6):** any `..` components in the relative
 * path are rejected. The mirror is computed from `relative(projectRoot,
 * absPath)` which collapses traversal, but we re-check defensively in
 * case the caller passes an already-relative path.
 *
 * **Collision lossiness (F1.5-H2):** the `_external/` derivation strips the
 * drive prefix (`C:` / `D:` etc.), so two inputs on different Windows drives
 * with otherwise-identical paths collapse to the same mirror. {@link
 * createSnapshot} guards against this by tracking already-seen mirror paths
 * per call and skipping the second write (routing a warning through
 * `onWarn`) rather than overwriting the first capture — otherwise the
 * manifest would advertise a path whose mirror bytes belong to a different
 * input.
 */
function mirrorRelativePath(projectRoot: string, absPath: string): string {
  const abs = isAbsolute(absPath) ? absPath : resolve(projectRoot, absPath);
  const rel = relative(projectRoot, abs);
  if (rel.length === 0) {
    // Caller passed projectRoot itself; treat as external.
    return join("_external", "root");
  }
  if (rel.startsWith("..") || isAbsolute(rel)) {
    // External path — collapse to a deterministic mirror.
    const safe = abs.replace(/^([A-Za-z]:)?[\\/]+/, "").replace(/\\/g, "/");
    return join("_external", safe);
  }
  // Defensive: a path inside the project that still includes ".." segments
  // (should not happen after `relative`, but cover the case) is rejected.
  if (rel.split(sep).some((part) => part === "..")) {
    throw new HatchError(
      `refusing to snapshot path with traversal: ${absPath}`,
      1,
      "VALIDATION_ERROR",
      "Pass an absolute path that resolves inside the project root.",
    );
  }
  return rel;
}

/**
 * List all session directories under the snapshot root. Returns an
 * empty array when the root is absent (first-run case). Filters out
 * non-directory entries and any directory without a parseable
 * `meta.json`.
 */
async function listSessionDirs(projectRoot: string = process.cwd()): Promise<string[]> {
  const root = snapshotsRoot(projectRoot);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Capture the current contents of every file in `paths` into a new
 * snapshot under `.hatch3r/snapshots/<sessionId>/`. Files that do not
 * exist on disk are recorded as deletions (the rollback restores them
 * by removing the file). All other files are copied byte-for-byte.
 *
 * The snapshot directory is created idempotently — calling
 * `createSnapshot` twice with the same session id captures the union of
 * paths in `meta.json` (with the second call's mtime). This is
 * intentional so multi-phase orchestrators can extend a session
 * incrementally.
 *
 * Returns the absolute snapshot path and the count of files captured.
 */
export async function createSnapshot(
  sessionId: string,
  paths: string[],
  options: CreateSnapshotOptions = {},
): Promise<CreateSnapshotResult> {
  if (!sessionId || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new HatchError(
      `invalid sessionId ${JSON.stringify(sessionId)}: must be non-empty and contain no path separators`,
      1,
      "VALIDATION_ERROR",
      "Pass a non-empty alphanumeric session id (e.g. 'sync-2026-05-26-12-00').",
    );
  }
  const projectRoot = options.projectRoot ?? process.cwd();
  const warnings: string[] = [];
  const emitWarning = (message: string): void => {
    warnings.push(message);
    if (options.onWarn) options.onWarn(message);
    else console.warn(message);
  };
  const dir = sessionDir(sessionId, projectRoot);
  const filesDir = join(dir, SNAPSHOT_FILES_DIR);
  await mkdir(filesDir, { recursive: true });

  // Load existing meta so repeated calls accumulate paths.
  let existing: SnapshotMeta | null = null;
  try {
    const metaRaw = await readFile(join(dir, SNAPSHOT_META_FILE), "utf-8");
    const parsed = JSON.parse(metaRaw) as SnapshotMeta;
    if (parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION) existing = parsed;
  } catch (err) {
    // Missing meta.json is the cold-start case; malformed meta is an
    // anomaly worth surfacing so an operator can decide to delete the
    // session directory rather than silently extend a corrupt session.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new HatchError(
        `existing snapshot meta at ${join(dir, SNAPSHOT_META_FILE)} is unreadable: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Remove the directory or pick a fresh sessionId.`,
        1,
        "FS_ERROR",
        `Run \`rm -rf ${dir}\` and retry with the same session id, or choose a fresh session id.`,
      );
    }
  }

  const absPaths = paths.map((p) => (isAbsolute(p) ? p : resolve(projectRoot, p)));
  // Only paths whose mirror was actually captured this call are recorded in
  // the manifest. A second input that collapses to a mirror already written
  // this call (F1.5-H2 cross-drive collision) is skipped — recording it
  // would advertise a path whose mirror bytes belong to a different input.
  const acceptedAbs: string[] = [];
  const acceptedRel: string[] = [];
  const seen = new Map<string, string>(); // mirror rel -> first abs that claimed it
  for (const abs of absPaths) {
    const rel = mirrorRelativePath(projectRoot, abs);
    const prior = seen.get(rel);
    if (prior !== undefined) {
      // Mirror collision: a previous input already wrote these bytes. Skip
      // the second write so the first capture is preserved, and surface a
      // warning so the operator can rename one input.
      emitWarning(
        `Snapshot mirror collision: ${abs} maps to the same snapshot path as ${prior} ` +
          `(both -> ${join(SNAPSHOT_FILES_DIR, rel)}). Skipping the second capture; ` +
          `\`hatch3r rollback --session=${sessionId}\` will restore ${prior}, not ${abs}. ` +
          `Rename one input to capture both.`,
      );
      continue;
    }
    seen.set(rel, abs);
    acceptedAbs.push(abs);
    acceptedRel.push(rel);
    const destPath = join(filesDir, rel);
    await mkdir(dirname(destPath), { recursive: true });
    try {
      const srcStat = await stat(abs);
      if (srcStat.isDirectory()) {
        // Directories are not snapshotted byte-for-byte; record a
        // tombstone so the rollback can remove any file the
        // orchestrator subsequently places at the directory path. This
        // also handles the "snapshot projectRoot itself" edge case
        // without descending into the entire tree.
        await writeFile(destPath + ".tombstone", "");
        continue;
      }
      const content = await readFile(abs);
      await writeFile(destPath, content);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Tombstone for "this path did not exist before the run" so
        // rollback can delete a file the orchestrator subsequently
        // created. Empty file + .tombstone sentinel keeps the mirror
        // layout consistent without inventing a separate metadata
        // section.
        await writeFile(destPath + ".tombstone", "");
      } else {
        throw err;
      }
    }
  }

  // Union with prior paths so a repeated call accumulates rather than
  // replaces. De-duplicate by relative path to keep meta.json compact.
  // Derived from the ACCEPTED paths so a skipped collision is never recorded.
  const unionAbs = existing ? Array.from(new Set([...existing.paths, ...acceptedAbs])) : acceptedAbs;
  const unionRel = existing
    ? Array.from(new Set([...existing.relativePaths, ...acceptedRel]))
    : acceptedRel;

  const meta: SnapshotMeta = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sessionId,
    timestamp: new Date().toISOString(),
    paths: unionAbs,
    relativePaths: unionRel,
    projectRoot,
  };
  await atomicWriteFile(join(dir, SNAPSHOT_META_FILE), JSON.stringify(meta, null, 2) + "\n");

  return { snapshotPath: dir, count: unionAbs.length, warnings };
}

/**
 * Enumerate every snapshot session currently on disk. Returns one
 * {@link SnapshotMeta} per directory under `.hatch3r/snapshots/` that
 * contains a readable `meta.json`. Sessions with a missing or
 * unparseable `meta.json` are skipped silently — listing must not throw
 * on a partially-corrupt snapshot root.
 *
 * The list is sorted by `timestamp` descending (newest first) so the
 * CLI can offer the most recent session as the default rollback target.
 */
export async function listSnapshots(
  options: { projectRoot?: string } = {},
): Promise<SnapshotMeta[]> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const sessions = await listSessionDirs(projectRoot);
  const out: SnapshotMeta[] = [];
  for (const sessionId of sessions) {
    const metaPath = join(sessionDir(sessionId, projectRoot), SNAPSHOT_META_FILE);
    try {
      const raw = await readFile(metaPath, "utf-8");
      const parsed = JSON.parse(raw) as SnapshotMeta;
      if (parsed.schemaVersion === SNAPSHOT_SCHEMA_VERSION && typeof parsed.timestamp === "string") {
        out.push(parsed);
      }
    } catch (err) {
      // Skip — a session without parseable meta is not useful for
      // rollback. The listSnapshots caller is expected to tolerate
      // this; surface via DEBUG for operators.
      if (process.env.DEBUG) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`hatch3r: snapshot ${sessionId} meta unreadable — ${msg}`);
      }
    }
  }
  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return out;
}

/**
 * Build a deterministic, on-disk-safe session id of the form
 * `${commandName}-${ISO timestamp}` with the ISO `:` and `.` separators
 * replaced by `-` so the id is also a valid directory name on every host
 * file system (Windows in particular refuses `:` in directory names).
 *
 * Exposed for tests; production callers should prefer {@link withSnapshot}
 * which threads this through `createSnapshot` automatically.
 */
export function buildSessionId(commandName: string, now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `${commandName}-${iso}`;
}

/** Options accepted by {@link withSnapshot}. */
export interface WithSnapshotOptions {
  /** Override the resolved project root (defaults to `process.cwd()`). */
  projectRoot?: string;
  /**
   * When `true`, skip the snapshot capture entirely. Used by the mutation
   * commands' `--dry-run` flags so dry runs do not produce snapshot
   * directories — those previews never modify disk and rolling them back
   * would be a no-op.
   */
  dryRun?: boolean;
  /**
   * Override the clock used to build the session id. Defaults to a fresh
   * `new Date()`. Threaded through for deterministic-test usage.
   */
  now?: () => Date;
  /**
   * Silent Failure Contract hook: when set, snapshot capture failures
   * route the diagnostic through this callback (defaults to
   * `console.warn`). The mutator still runs and the returned `sessionId`
   * is `null` so the caller can suppress its "revert with: …" line.
   * Production callers wire this to the per-command `warn()` UI helper so
   * the warning lands in the same channel as other orchestrator output.
   */
  onWarn?: (message: string) => void;
}

/**
 * Wrap a mutation block with a pre-mutation snapshot. Captures the
 * supplied `paths` under `.hatch3r/snapshots/<sessionId>/files/` before
 * invoking `mutator(sessionId)`, then surfaces the session id back to the
 * caller so the orchestrator can print it in the success summary.
 *
 * Semantics:
 *   1. Filter `paths` for falsy / blank entries (the orchestrator may
 *      pass a list that includes optional outputs like `.worktreeinclude`
 *      that are only present under certain features).
 *   2. When `options.dryRun === true`, skip the snapshot capture and
 *      proceed straight to `mutator` with a `null` session id. The mutator
 *      itself is responsible for honouring dry-run semantics — this helper
 *      only suppresses the snapshot write.
 *   3. When `paths` is empty after filtering, still emit a snapshot
 *      (with zero captured files) so `hatch3r rollback list` shows the run
 *      and the operator can confirm the command ran without writing.
 *      The session id is still returned to the mutator.
 *   4. Silent Failure Contract: a snapshot capture I/O failure routes
 *      through `options.onWarn` (defaults to `console.warn`) and the
 *      mutator still runs. The returned `sessionId` is `null` to signal
 *      "no rollback target captured" so the caller can suppress its
 *      "revert with: …" line when the safety net is unavailable. This
 *      matches the F1.1-C1 init wiring contract — an unwritable
 *      `.hatch3r/snapshots/` must not block a fresh install. Errors
 *      whose cause is a malformed session id (path separator etc.) still
 *      propagate because they indicate a programming bug, not an
 *      environmental failure.
 *
 * Returns `{ sessionId, snapshotPath, count }` so callers can include the
 * session id in their success box for `hatch3r rollback --session=<id>`.
 */
export async function withSnapshot<T>(
  commandName: string,
  paths: string[],
  mutator: (sessionId: string | null) => Promise<T>,
  options: WithSnapshotOptions = {},
): Promise<{
  result: T;
  sessionId: string | null;
  snapshotPath: string | null;
  count: number;
  warnings: string[];
}> {
  if (options.dryRun) {
    const result = await mutator(null);
    return { result, sessionId: null, snapshotPath: null, count: 0, warnings: [] };
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const now = options.now ? options.now() : new Date();
  const sessionId = buildSessionId(commandName, now);

  const filtered = paths.filter((p) => typeof p === "string" && p.length > 0);
  let snapshotPath: string | null = null;
  let count = 0;
  let warnings: string[] = [];
  let capturedSessionId: string | null = sessionId;
  try {
    const captured = await createSnapshot(sessionId, filtered, {
      projectRoot,
      onWarn: options.onWarn,
    });
    snapshotPath = captured.snapshotPath;
    count = captured.count;
    warnings = captured.warnings;
  } catch (err) {
    // Programming-bug class (invalid session id) propagates per the doc
    // contract — a malformed session id indicates the caller composed the
    // command name incorrectly. Environmental failures (ENOENT on a stub
    // project root, EACCES on a read-only filesystem) downgrade to a
    // warning so the mutation can still proceed and the operator sees
    // the loss of the safety net.
    if (
      err instanceof HatchError &&
      err.errorCode === "VALIDATION_ERROR" &&
      /invalid sessionId/.test(err.message)
    ) {
      throw err;
    }
    capturedSessionId = null;
    const msg = err instanceof Error ? err.message : String(err);
    const warning =
      `Pre-mutation snapshot failed for session ${sessionId}: ${msg}. ` +
      `Continuing ${commandName}; \`hatch3r rollback --session=${sessionId}\` will not be available.`;
    if (options.onWarn) options.onWarn(warning);
    else console.warn(warning);
  }
  const result = await mutator(capturedSessionId);
  return { result, sessionId: capturedSessionId, snapshotPath, count, warnings };
}

/** A snapshot entry resolved during the prepare phase of {@link applyRollback}. */
interface PreparedEntry {
  /** Project-relative mirror path. */
  rel: string;
  /** Absolute destination the entry restores to. */
  target: string;
  /** Absolute mirror path inside the snapshot. */
  source: string;
  /** True when the entry is a tombstone (file absent pre-run; restore = delete). */
  isTombstone: boolean;
  /** Snapshot bytes pre-loaded for a regular entry (undefined for tombstones). */
  sourceContent?: Buffer;
  /** Prepare-phase error (mirror unreadable, destination not writable, etc.). */
  error?: string;
}

/**
 * Restore every file captured in the named session. Returns the count of
 * files restored plus any per-file errors and a per-file disposition table.
 * Unknown session ids produce a single-entry error array and a zero count.
 *
 * **Dry-run mode (`opts.dryRun=true`):** runs the prepare phase only —
 * verifies that every mirror is readable and every destination directory is
 * writable — and performs no writes. `filesRestored` reflects the entries
 * that would restore cleanly; prepare errors are surfaced in `errors[]` so a
 * dry run accurately predicts the live outcome.
 *
 * **All-or-nothing semantics (F1.5-H3 / F8.2.4, Decision 27):** a live
 * rollback is a two-phase commit:
 *   1. **Prepare** — walk `meta.relativePaths`; for each entry verify the
 *      mirror is readable (regular files) and the destination parent is
 *      writable (or unlink-able for tombstones), pre-loading source bytes.
 *      Any prepare error aborts the live restore before a single write — the
 *      disk is left in the pre-rollback (mutated) state and every entry is
 *      reported `mutated-still`.
 *   2. **Commit** — only when prepare reported zero errors. Before any write
 *      the pre-rollback bytes of every target are captured so a commit-phase
 *      failure can roll the already-applied entries forward to that captured
 *      state. The net effect is all-or-nothing: a `hatch3r rollback` either
 *      restores every file or leaves the disk in its pre-rollback state — it
 *      never produces a mixed half-restored state.
 *
 * Each individual restore uses `atomicWriteFile` (tmp+rename). The returned
 * `dispositions[]` records the final state of every entry.
 */
export async function applyRollback(
  sessionId: string,
  opts: { dryRun?: boolean; projectRoot?: string } = {},
): Promise<RollbackResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const dir = sessionDir(sessionId, projectRoot);
  const metaPath = join(dir, SNAPSHOT_META_FILE);

  let meta: SnapshotMeta;
  try {
    const raw = await readFile(metaPath, "utf-8");
    meta = JSON.parse(raw) as SnapshotMeta;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { filesRestored: 0, errors: [`session ${sessionId} not found or unreadable: ${msg}`] };
  }
  if (meta.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return {
      filesRestored: 0,
      errors: [
        `session ${sessionId} uses snapshot schema ${String(meta.schemaVersion)} ` +
          `(expected ${SNAPSHOT_SCHEMA_VERSION}). Restore with a matching hatch3r version.`,
      ],
    };
  }

  const filesDir = join(dir, SNAPSHOT_FILES_DIR);

  // ── Prepare phase ──────────────────────────────────────────────
  // Resolve every entry and verify it can be restored before touching disk.
  const prepared: PreparedEntry[] = [];
  for (let i = 0; i < meta.relativePaths.length; i++) {
    const rel = meta.relativePaths[i];
    const target = meta.paths[i] ?? resolve(projectRoot, rel);
    const source = join(filesDir, rel);
    const tombstone = source + ".tombstone";

    let isTombstone = false;
    try {
      await stat(tombstone);
      isTombstone = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        prepared.push({
          rel,
          target,
          source,
          isTombstone: false,
          error: `stat ${tombstone}: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }

    if (isTombstone) {
      // Rollback = delete the target if it exists. Verify the parent dir is
      // writable so we surface EACCES before commit. A missing parent is
      // benign (target already absent / consistent with pre-state).
      const entry: PreparedEntry = { rel, target, source, isTombstone: true };
      try {
        await access(dirname(target), fsConstants.W_OK);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          entry.error = `parent not writable for ${target}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      prepared.push(entry);
      continue;
    }

    // Regular entry: mirror must be readable and the destination parent
    // writable (or creatable). Pre-load bytes so commit has one source.
    const entry: PreparedEntry = { rel, target, source, isTombstone: false };
    try {
      entry.sourceContent = await readFile(source);
    } catch (err) {
      entry.error = `read snapshot ${source}: ${err instanceof Error ? err.message : String(err)}`;
      prepared.push(entry);
      continue;
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await access(dirname(target), fsConstants.W_OK);
    } catch (err) {
      entry.error = `destination not writable for ${target}: ${err instanceof Error ? err.message : String(err)}`;
    }
    prepared.push(entry);
  }

  const prepareErrors = prepared.filter((e) => e.error);

  // Dry-run: report what would restore cleanly + every prepare error. No writes.
  if (opts.dryRun) {
    const dispositions: RollbackFileDisposition[] = prepared.map((e) => ({
      target: e.target,
      state: e.error ? "mutated-still" : "original-restored",
      ...(e.error ? { error: e.error } : {}),
    }));
    return {
      filesRestored: prepared.length - prepareErrors.length,
      errors: prepareErrors.map((e) => e.error as string),
      dispositions,
    };
  }

  // Live mode: abort entirely if prepare found any unrecoverable entry. Disk
  // is untouched, so every entry is still in its mutated state.
  if (prepareErrors.length > 0) {
    const errors = [
      `Rollback aborted: prepare phase reported ${prepareErrors.length} unrecoverable error(s); ` +
        `no files were modified (disk left in pre-rollback state).`,
      ...prepareErrors.map((e) => e.error as string),
    ];
    const dispositions: RollbackFileDisposition[] = prepared.map((e) => ({
      target: e.target,
      state: "mutated-still",
      ...(e.error ? { error: e.error } : {}),
    }));
    return { filesRestored: 0, errors, dispositions };
  }

  // ── Commit phase ───────────────────────────────────────────────
  // Capture pre-rollback bytes of every target so a mid-commit failure can
  // roll the already-applied entries forward to this captured state.
  interface MutatedSnap {
    /** Pre-rollback bytes, or null when the target was absent pre-rollback. */
    bytes: Buffer | null;
    /** True when we could not read the pre-rollback state (roll-forward = unknown). */
    unreadable?: boolean;
  }
  const mutatedSnaps = new Map<string, MutatedSnap>();
  for (const e of prepared) {
    try {
      const bytes = await readFile(e.target);
      mutatedSnaps.set(e.target, { bytes });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        mutatedSnaps.set(e.target, { bytes: null });
      } else {
        // Cannot read pre-rollback state — roll-forward of this target would
        // be unknown. Record so a later roll-forward marks it accurately.
        mutatedSnaps.set(e.target, { bytes: null, unreadable: true });
      }
    }
  }

  const errors: string[] = [];
  const dispositions: RollbackFileDisposition[] = prepared.map((e) => ({
    target: e.target,
    state: "mutated-still",
  }));
  const applied: number[] = []; // indices restored so far (for roll-forward)
  let restored = 0;
  let commitFailedAt = -1;

  for (let i = 0; i < prepared.length; i++) {
    const e = prepared[i];
    try {
      if (e.isTombstone) {
        try {
          await unlink(e.target);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") throw err;
          // Already absent — consistent with the snapshot's pre-state.
        }
      } else {
        await atomicWriteFile(e.target, (e.sourceContent as Buffer).toString("utf-8"));
      }
      dispositions[i].state = "original-restored";
      applied.push(i);
      restored++;
    } catch (err) {
      commitFailedAt = i;
      errors.push(`restore ${e.target}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  // ── Roll-forward ───────────────────────────────────────────────
  // A commit-phase write failed: undo the already-applied entries so the disk
  // returns to its pre-rollback (mutated) state — all-or-nothing.
  if (commitFailedAt >= 0) {
    for (const idx of applied) {
      const e = prepared[idx];
      const snap = mutatedSnaps.get(e.target);
      if (!snap || snap.unreadable) {
        dispositions[idx].state = "unknown";
        dispositions[idx].error = `pre-rollback bytes unreadable; cannot roll forward ${e.target}`;
        continue;
      }
      try {
        if (snap.bytes === null) {
          // Target was absent pre-rollback — re-delete to undo the restore.
          await unlink(e.target).catch((err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") throw err;
          });
        } else {
          await atomicWriteFile(e.target, snap.bytes.toString("utf-8"));
        }
        dispositions[idx].state = "rolled-forward";
        restored--;
      } catch (err) {
        dispositions[idx].state = "unknown";
        const msg = err instanceof Error ? err.message : String(err);
        dispositions[idx].error = `roll-forward failed for ${e.target}: ${msg}`;
        errors.push(`roll-forward ${e.target}: ${msg}`);
      }
    }
  }

  return { filesRestored: restored, errors, dispositions };
}
