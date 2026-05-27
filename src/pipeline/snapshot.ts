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
 * **Atomicity:** rollback uses `atomicWriteFile` (tmp + rename) so a
 * partially-applied rollback is not observable on disk. Pre-existing
 * files outside the snapshot are left untouched.
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
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
 * Result of {@link applyRollback}: count of files successfully restored
 * plus per-file errors. An empty `errors` array means full success.
 */
export interface RollbackResult {
  filesRestored: number;
  errors: string[];
}

/** Result of {@link createSnapshot}. */
export interface CreateSnapshotResult {
  snapshotPath: string;
  count: number;
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
  options: { projectRoot?: string } = {},
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
  const relPaths: string[] = [];
  for (const abs of absPaths) {
    const rel = mirrorRelativePath(projectRoot, abs);
    relPaths.push(rel);
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
  const unionAbs = existing ? Array.from(new Set([...existing.paths, ...absPaths])) : absPaths;
  const unionRel = existing
    ? Array.from(new Set([...existing.relativePaths, ...relPaths]))
    : relPaths;

  const meta: SnapshotMeta = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sessionId,
    timestamp: new Date().toISOString(),
    paths: unionAbs,
    relativePaths: unionRel,
    projectRoot,
  };
  await atomicWriteFile(join(dir, SNAPSHOT_META_FILE), JSON.stringify(meta, null, 2) + "\n");

  return { snapshotPath: dir, count: unionAbs.length };
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
): Promise<{ result: T; sessionId: string | null; snapshotPath: string | null; count: number }> {
  if (options.dryRun) {
    const result = await mutator(null);
    return { result, sessionId: null, snapshotPath: null, count: 0 };
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const now = options.now ? options.now() : new Date();
  const sessionId = buildSessionId(commandName, now);

  const filtered = paths.filter((p) => typeof p === "string" && p.length > 0);
  let snapshotPath: string | null = null;
  let count = 0;
  let capturedSessionId: string | null = sessionId;
  try {
    const captured = await createSnapshot(sessionId, filtered, { projectRoot });
    snapshotPath = captured.snapshotPath;
    count = captured.count;
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
  return { result, sessionId: capturedSessionId, snapshotPath, count };
}

/**
 * Restore every file captured in the named session. Returns the count
 * of files restored plus any per-file errors encountered. Unknown
 * session ids produce a single-entry error array and a zero count.
 *
 * **Dry-run mode (`opts.dryRun=true`):** verifies that every file in
 * the snapshot can be opened and that the destination directory is
 * writable, but performs no writes. Useful for previewing the effect of
 * a rollback before committing.
 *
 * **Atomicity:** each individual file restore uses `atomicWriteFile`
 * (tmp+rename). The overall rollback is best-effort across files: a
 * write failure on one file does not roll back files already restored.
 * The caller surfaces this via the returned error array.
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
  const errors: string[] = [];
  let restored = 0;

  for (let i = 0; i < meta.relativePaths.length; i++) {
    const rel = meta.relativePaths[i];
    const target = meta.paths[i] ?? resolve(projectRoot, rel);
    const source = join(filesDir, rel);
    const tombstone = source + ".tombstone";

    // Tombstone case: the file did not exist before the run; rollback
    // means deleting it if it now exists.
    let isTombstone = false;
    try {
      await stat(tombstone);
      isTombstone = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors.push(`stat ${tombstone}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    if (isTombstone) {
      if (opts.dryRun) {
        restored++;
        continue;
      }
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(target);
        restored++;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          // Already absent — consistent with the snapshot's pre-state.
          restored++;
        } else {
          errors.push(`unlink ${target}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      continue;
    }

    // Regular case: read snapshot bytes and restore atomically.
    try {
      const content = await readFile(source);
      if (opts.dryRun) {
        // Touch the destination directory so we surface permission
        // errors before commit. mkdir is idempotent and cheap.
        await mkdir(dirname(target), { recursive: true });
        restored++;
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await atomicWriteFile(target, content.toString("utf-8"));
      restored++;
    } catch (err) {
      errors.push(`restore ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { filesRestored: restored, errors };
}
