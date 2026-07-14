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
import { access, mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { atomicWriteFile } from "../merge/safeWrite.js";
import { DEFAULT_LEARNING_FILE_COUNT } from "../content/learningsValidation.js";
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

/**
 * Retention cap on the number of snapshot sessions kept under
 * `.hatch3r/snapshots/`. When a fresh `createSnapshot` pushes the directory
 * past this count, the oldest sessions (by `meta.timestamp`) are pruned so a
 * long-lived repo cannot accumulate unbounded rollback state (D6-SA6.4-F5).
 * Imports `DEFAULT_LEARNING_FILE_COUNT` (one physical home,
 * `src/content/learningsValidation.ts`) so both durable on-disk stores share a
 * single bounding discipline. 2.6.0: the learnings cap became per-project
 * configurable via `learnings.maxCount` in `.hatch3r/hatch.json`; snapshots
 * follow the fixed DEFAULT (150), not the per-project value — the byte cap
 * below stays the binding envelope either way.
 */
export const MAX_SNAPSHOT_COUNT = DEFAULT_LEARNING_FILE_COUNT;

/**
 * Retention cap on the total bytes occupied by snapshot session directories
 * under `.hatch3r/snapshots/`. When the aggregate size exceeds this ceiling
 * after a capture, the oldest sessions are pruned until the total falls back
 * under it (D6-SA6.4-F5). 100 MB bounds the worst case (large repeated mutated
 * payloads across many sessions) without truncating a realistic recent-history
 * window of 1–50 KB-per-file captures.
 */
export const MAX_SNAPSHOT_BYTES = 100_000_000;

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

/**
 * Recursively sum the byte size of every regular file under `dir`. Returns 0
 * when the directory is absent. Used by {@link pruneSnapshots} to enforce the
 * {@link MAX_SNAPSHOT_BYTES} ceiling. Symlinks are not followed — `stat` on a
 * symlink target is intentional only for regular file entries discovered via
 * `withFileTypes`, so a malicious symlink cannot inflate the count or escape
 * the snapshot root.
 */
async function dirSizeBytes(dir: string): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return 0;
    throw err;
  }
  let total = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch (err) {
        // A file vanishing mid-walk (concurrent prune / external cleanup) is
        // benign for a size estimate — skip it rather than abort the sweep.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
  }
  return total;
}

/** Recursively remove a session directory and everything under it. */
async function removeSessionDir(dir: string): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeSessionDir(full);
    } else {
      await unlink(full).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
    }
  }
  await rmdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

/**
 * Enforce the snapshot-store retention caps ({@link MAX_SNAPSHOT_COUNT} and
 * {@link MAX_SNAPSHOT_BYTES}) by deleting the oldest sessions first (D6-SA6.4-F5).
 *
 * Ordering is by `meta.timestamp` ascending (oldest pruned first); sessions
 * with an unparseable `meta.json` sort oldest so a corrupt directory is
 * reclaimed ahead of a valid recent one. The most-recent session is never
 * pruned even if it alone exceeds the byte ceiling — dropping the snapshot a
 * caller just captured would silently void the rollback it was promised. Each
 * pruned session is routed through `onPrune` (Silent Failure Contract) so the
 * caller can surface "N old snapshot(s) pruned" without re-walking the root.
 *
 * Pruning never throws on a single-session removal failure; the error is
 * routed to `onPrune` and the sweep continues, because a snapshot-capture
 * success must not be downgraded to a failure by a janitorial side-effect.
 */
async function pruneSnapshots(
  projectRoot: string,
  onPrune?: (message: string) => void,
): Promise<void> {
  const sessions = await listSessionDirs(projectRoot);
  if (sessions.length === 0) return;

  interface Aged {
    sessionId: string;
    dir: string;
    timestamp: string;
    bytes: number;
  }
  const aged: Aged[] = [];
  for (const sessionId of sessions) {
    const dir = sessionDir(sessionId, projectRoot);
    let timestamp = ""; // empty sorts oldest → corrupt sessions pruned first
    try {
      const raw = await readFile(join(dir, SNAPSHOT_META_FILE), "utf-8");
      const parsed = JSON.parse(raw) as SnapshotMeta;
      if (typeof parsed.timestamp === "string") timestamp = parsed.timestamp;
    } catch (metaErr) {
      // Unparseable / missing meta — leave timestamp empty so it prunes first.
      // Surface the corrupt session per the Silent Failure Contract
      // (CONSTITUTION.md §2 P5) via the in-scope onPrune channel rather than
      // swallowing it; pruning continues regardless (best-effort cleanup).
      if (onPrune) {
        onPrune(
          `Snapshot session ${sessionId} has unreadable meta.json ` +
            `(${metaErr instanceof Error ? metaErr.message : String(metaErr)}); ` +
            `sorting it oldest for prune-first reclaim.`,
        );
      }
    }
    aged.push({ sessionId, dir, timestamp, bytes: await dirSizeBytes(dir) });
  }

  // Oldest first. localeCompare matches listSnapshots' UTC ISO-8601 ordering.
  aged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let totalBytes = aged.reduce((sum, s) => sum + s.bytes, 0);
  let count = aged.length;

  const prune = async (entry: Aged, reason: string): Promise<void> => {
    try {
      await removeSessionDir(entry.dir);
      count--;
      totalBytes -= entry.bytes;
      const msg =
        `Pruned old snapshot session ${entry.sessionId} (${reason}). ` +
        `\`hatch3r rollback --session=${entry.sessionId}\` is no longer available.`;
      if (onPrune) onPrune(msg);
    } catch (err) {
      const msg =
        `Failed to prune snapshot session ${entry.sessionId}: ` +
        `${err instanceof Error ? err.message : String(err)}.`;
      if (onPrune) onPrune(msg);
    }
  };

  // Walk oldest→newest, but never prune the single most-recent session (the
  // last element after the ascending sort) so a just-captured snapshot stays.
  for (let i = 0; i < aged.length - 1; i++) {
    if (count <= MAX_SNAPSHOT_COUNT && totalBytes <= MAX_SNAPSHOT_BYTES) break;
    const reason =
      count > MAX_SNAPSHOT_COUNT
        ? `count cap ${MAX_SNAPSHOT_COUNT}`
        : `size cap ${MAX_SNAPSHOT_BYTES} bytes`;
    await prune(aged[i], reason);
  }
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
  // Seed the dedup guard from the EXISTING manifest so a same-session
  // incremental call that collides with a mirror captured by a *prior* call is
  // detected too (D8-9). Without this seed the per-call guard only catches
  // collisions within a single call: two cross-drive inputs split across two
  // createSnapshot calls would each pass their own fresh guard, append a second
  // `abs` to `paths` while the union dedup collapses the duplicate `rel`,
  // desyncing the `paths`/`relativePaths` index pairing that applyRollback
  // relies on (`meta.paths[i]` <-> `meta.relativePaths[i]`). `seededRels`
  // remembers which mirrors came from a prior call so a benign idempotent
  // re-pass of the *same* path is skipped silently, while a genuine cross-call
  // cross-drive collision (different abs, same mirror) still warns.
  const seededRels = new Set<string>();
  if (existing) {
    for (let i = 0; i < existing.relativePaths.length; i++) {
      const priorRel = existing.relativePaths[i];
      if (!seen.has(priorRel)) {
        // Map back to the abs the prior call recorded for this mirror so the
        // collision warning names the original input, not just the mirror.
        seen.set(priorRel, existing.paths[i] ?? priorRel);
        seededRels.add(priorRel);
      }
    }
  }
  for (const abs of absPaths) {
    const rel = mirrorRelativePath(projectRoot, abs);
    const prior = seen.get(rel);
    if (prior !== undefined) {
      if (prior === abs && seededRels.has(rel)) {
        // Idempotent re-snapshot: a prior same-session call already captured
        // this exact path under this mirror. The mirror bytes and the
        // (abs, rel) manifest pair are already present, so skip silently — this
        // is the documented "extend a session incrementally" contract, not a
        // collision. (A within-call exact duplicate still warns below, matching
        // the F1.5-H2 cross-drive reproduction the dedup guard was authored for.)
        continue;
      }
      // Mirror collision: a different input already wrote these bytes. Skip
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
  // replaces. De-duplicate by relative path (the mirror identity applyRollback
  // pairs on) and build `paths`/`relativePaths` as ONE paired walk so the two
  // arrays can never drift out of index alignment (D8-9). The previous code ran
  // two independent `Set` dedups — `Set(existing.paths + acceptedAbs)` and
  // `Set(existing.relativePaths + acceptedRel)` — which produce different
  // lengths whenever two distinct abs share a mirror rel, silently corrupting
  // the index pairing. Keying the dedup on `rel` keeps the pair atomic: each
  // mirror contributes exactly one (abs, rel) row, in first-seen order.
  const unionAbs: string[] = [];
  const unionRel: string[] = [];
  const unionSeen = new Set<string>();
  const pushPair = (abs: string, rel: string): void => {
    if (unionSeen.has(rel)) return;
    unionSeen.add(rel);
    unionAbs.push(abs);
    unionRel.push(rel);
  };
  if (existing) {
    for (let i = 0; i < existing.relativePaths.length; i++) {
      const rel = existing.relativePaths[i];
      // Pair with the abs the prior manifest recorded at the same index; fall
      // back to the rel itself if a legacy manifest is shorter on `paths` (the
      // same `?? rel` defensive default applyRollback uses).
      pushPair(existing.paths[i] ?? rel, rel);
    }
  }
  for (let i = 0; i < acceptedRel.length; i++) {
    pushPair(acceptedAbs[i], acceptedRel[i]);
  }

  const meta: SnapshotMeta = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sessionId,
    timestamp: new Date().toISOString(),
    paths: unionAbs,
    relativePaths: unionRel,
    projectRoot,
  };
  await atomicWriteFile(join(dir, SNAPSHOT_META_FILE), JSON.stringify(meta, null, 2) + "\n");

  // Enforce the retention caps after the capture lands so the store cannot
  // grow without bound across sessions (D6-SA6.4-F5). Prune diagnostics route
  // through the same warning channel as collision diagnostics; a prune failure
  // never downgrades the capture's success.
  await pruneSnapshots(projectRoot, emitWarning);

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
 *
 * **Sort assumption (D1-SA1.5-F11):** the ordering is a lexicographic
 * `localeCompare` on the raw `timestamp` string. This is correct only because
 * every `meta.timestamp` is emitted by `new Date().toISOString()`, which is
 * always UTC (`Z`-suffixed) ISO-8601 at fixed millisecond precision — a format
 * whose lexicographic order equals its chronological order. A future
 * `schemaVersion: 2` that changes the timestamp source (local offsets,
 * variable fractional-second precision, or a non-ISO format) MUST switch this
 * comparison to `Date.parse(b.timestamp) - Date.parse(a.timestamp)`, because
 * string-sort would no longer track chronology.
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
        // D8-3 (Cycle 11 Wave 2, CQ4): write the captured Buffer verbatim.
        // The prior `.toString("utf-8")` round-tripped non-UTF-8 user bytes
        // through U+FFFD, corrupting any binary or non-UTF-8 file on restore;
        // atomicWriteFile now accepts a Buffer and preserves bytes exactly.
        await atomicWriteFile(e.target, e.sourceContent as Buffer);
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
          // D8-3 (Cycle 11 Wave 2, CQ4): roll the pre-rollback bytes forward
          // verbatim. As with the commit-phase restore above, a UTF-8
          // re-encode here would corrupt non-UTF-8 content; pass the Buffer.
          await atomicWriteFile(e.target, snap.bytes);
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
