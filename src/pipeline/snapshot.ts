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

import { basename, join, dirname, relative, resolve, isAbsolute, sep } from "node:path";
import { access, mkdir, readFile, readdir, realpath, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { atomicWriteFile } from "../merge/safeWrite.js";
import {
  ensureSafeRepositoryDirectory,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  UnsafeRepositoryPathError,
} from "../merge/repositoryPathSafety.js";
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
 * DD-C (release/2.8.5): full shape validation for a parsed `meta.json` —
 * replaces the four trusting `JSON.parse(raw) as SnapshotMeta` casts in this
 * module, which accepted any JSON value and let the rollback path index
 * `meta.paths[i]` / `meta.relativePaths[i]` on undefined arrays. Checks the
 * schema version pin plus every field the readers rely on, including the
 * paths↔relativePaths pairing the mirror layout depends on. Exported for
 * direct unit coverage.
 */
export function isSnapshotMeta(v: unknown): v is SnapshotMeta {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    o.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    typeof o.sessionId === "string" &&
    typeof o.timestamp === "string" &&
    typeof o.projectRoot === "string" &&
    Array.isArray(o.paths) &&
    o.paths.every((p) => typeof p === "string") &&
    Array.isArray(o.relativePaths) &&
    o.relativePaths.every((p) => typeof p === "string") &&
    o.paths.length === o.relativePaths.length
  );
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
  /**
   * Explicitly permit absolute source paths outside `projectRoot`. Repository
   * lifecycle callers must never enable this; it exists only for standalone
   * API consumers that intentionally snapshot and restore an external file.
   */
  allowExternalPaths?: boolean;
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
 * occupies inside the snapshot. Explicitly opted-in standalone API paths
 * outside `projectRoot` are placed under `_external/`; repository lifecycle
 * callers reject those paths before this helper is reached.
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

interface ResolvedSnapshotInput {
  absolutePath: string;
  relativePath: string;
  external: boolean;
}

async function resolveThroughExistingAncestor(path: string): Promise<string> {
  const missing: string[] = [];
  let cursor = path;
  while (true) {
    try {
      const canonicalAncestor = await realpath(cursor);
      return resolve(canonicalAncestor, ...missing.reverse());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = dirname(cursor);
      if (parent === cursor) throw err;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

function isOutsideSnapshotRoot(relativePath: string): boolean {
  return relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath);
}

function initialSnapshotCoordinates(
  requestedRoot: string,
  canonicalRoot: string,
  inputPath: string,
): { absolutePath: string; relativePath: string } {
  if (isAbsolute(inputPath)) {
    const absolutePath = resolve(inputPath);
    return { absolutePath, relativePath: relative(requestedRoot, absolutePath) };
  }
  const relativePath = normalizeRepositoryRelativePath(inputPath);
  return {
    absolutePath: resolve(canonicalRoot, ...relativePath.split("/")),
    relativePath,
  };
}

async function reconcileCanonicalSnapshotPath(
  canonicalRoot: string,
  coordinates: { absolutePath: string; relativePath: string },
): Promise<{ relativePath: string; outside: boolean }> {
  if (!isOutsideSnapshotRoot(coordinates.relativePath) || coordinates.relativePath === "") {
    return { relativePath: coordinates.relativePath, outside: isOutsideSnapshotRoot(coordinates.relativePath) };
  }
  const canonicalCandidate = await resolveThroughExistingAncestor(coordinates.absolutePath);
  const canonicalRelative = relative(canonicalRoot, canonicalCandidate);
  return {
    relativePath: isOutsideSnapshotRoot(canonicalRelative)
      ? coordinates.relativePath
      : canonicalRelative,
    outside: isOutsideSnapshotRoot(canonicalRelative),
  };
}

function externalSnapshotInput(
  canonicalRoot: string,
  absolutePath: string,
): ResolvedSnapshotInput {
  return {
    absolutePath,
    relativePath: mirrorRelativePath(canonicalRoot, absolutePath),
    external: true,
  };
}

async function resolveSnapshotInput(
  projectRoot: string,
  inputPath: string,
  allowExternalPaths: boolean,
): Promise<ResolvedSnapshotInput> {
  const requestedRoot = resolve(projectRoot);
  const canonicalRoot = await realpath(projectRoot);
  const coordinates = initialSnapshotCoordinates(requestedRoot, canonicalRoot, inputPath);
  const canonical = await reconcileCanonicalSnapshotPath(canonicalRoot, coordinates);
  if (canonical.outside) {
    if (allowExternalPaths && isAbsolute(inputPath)) {
      return externalSnapshotInput(canonicalRoot, coordinates.absolutePath);
    }
    throw new UnsafeRepositoryPathError(
      inputPath,
      "outside-root",
      "repository lifecycle snapshots may only contain paths below the project root",
    );
  }

  const normalizedRelative = normalizeRepositoryRelativePath(canonical.relativePath);
  await inspectRepositoryPath(canonicalRoot, normalizedRelative, {
    allowMissing: true,
  });
  return {
    absolutePath: coordinates.absolutePath,
    relativePath: normalizedRelative,
    external: false,
  };
}

async function validateSnapshotMetaEntries(
  meta: SnapshotMeta,
  projectRoot: string,
  allowExternalPaths: boolean,
): Promise<ResolvedSnapshotInput[]> {
  const canonicalRoot = await realpath(projectRoot);
  const recordedRoot = await realpath(meta.projectRoot).catch(() => resolve(meta.projectRoot));
  if (!allowExternalPaths && recordedRoot !== canonicalRoot) {
    throw new UnsafeRepositoryPathError(
      meta.projectRoot,
      "outside-root",
      "the snapshot was recorded for a different project root",
    );
  }

  const entries: ResolvedSnapshotInput[] = [];
  for (let index = 0; index < meta.paths.length; index++) {
    const entry = await resolveSnapshotInput(
      projectRoot,
      meta.paths[index],
      allowExternalPaths,
    );
    const recordedRelative = normalizeRepositoryRelativePath(meta.relativePaths[index]);
    if (recordedRelative !== entry.relativePath.replace(/\\/g, "/")) {
      throw new UnsafeRepositoryPathError(
        meta.paths[index],
        "changed",
        `snapshot path metadata does not match relativePaths[${index}]`,
      );
    }
    entries.push(entry);
  }
  return entries;
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
      // DD-C: validated parse (was a trusting `as SnapshotMeta` cast). A
      // parseable-but-wrong-shape meta keeps the empty timestamp, sorting the
      // corrupt session oldest for prune-first reclaim — same disposition as
      // the unreadable case below.
      const parsed: unknown = JSON.parse(raw);
      if (isSnapshotMeta(parsed)) timestamp = parsed.timestamp;
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

type SnapshotWarningEmitter = (message: string) => void;

interface SnapshotCaptureContext {
  projectRoot: string;
  dir: string;
  filesDir: string;
  resolvedInputs: ResolvedSnapshotInput[];
}

interface SnapshotCaptureState {
  acceptedAbs: string[];
  acceptedRel: string[];
  seen: Map<string, string>;
  seededRels: Set<string>;
}

function assertValidSnapshotSessionId(sessionId: string): void {
  const invalid =
    !sessionId ||
    sessionId === "." ||
    sessionId === ".." ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(sessionId);
  if (!invalid) return;
  throw new HatchError(
    `invalid sessionId ${JSON.stringify(sessionId)}: must be non-empty and contain no path separators`,
    1,
    "VALIDATION_ERROR",
    "Pass a non-empty alphanumeric session id (e.g. 'sync-2026-05-26-12-00').",
  );
}

function createSnapshotWarningEmitter(
  warnings: string[],
  onWarn?: (message: string) => void,
): SnapshotWarningEmitter {
  return (message): void => {
    warnings.push(message);
    if (onWarn) onWarn(message);
    else console.warn(message);
  };
}

async function initializeSnapshotCapture(
  sessionId: string,
  paths: string[],
  options: CreateSnapshotOptions,
): Promise<SnapshotCaptureContext> {
  const requestedProjectRoot = options.projectRoot ?? process.cwd();
  await realpath(requestedProjectRoot);
  const projectRoot = resolve(requestedProjectRoot);
  const resolvedInputs = await Promise.all(
    paths.map((path) =>
      resolveSnapshotInput(requestedProjectRoot, path, options.allowExternalPaths === true),
    ),
  );
  const dir = sessionDir(sessionId, projectRoot);
  const filesDir = join(dir, SNAPSHOT_FILES_DIR);
  await ensureSafeRepositoryDirectory(
    projectRoot,
    `${HATCH3R_DIR}/${SNAPSHOTS_DIR}/${sessionId}/${SNAPSHOT_FILES_DIR}`,
  );
  await inspectRepositoryPath(
    projectRoot,
    `${HATCH3R_DIR}/${SNAPSHOTS_DIR}/${sessionId}/${SNAPSHOT_META_FILE}`,
    { allowMissing: true },
  );
  return { projectRoot, dir, filesDir, resolvedInputs };
}

async function readExistingSnapshotMeta(
  context: SnapshotCaptureContext,
  allowExternalPaths: boolean,
): Promise<SnapshotMeta | null> {
  const metaPath = join(context.dir, SNAPSHOT_META_FILE);
  try {
    const parsed: unknown = JSON.parse(await readFile(metaPath, "utf-8"));
    if (!isSnapshotMeta(parsed)) return null;
    await validateSnapshotMetaEntries(parsed, context.projectRoot, allowExternalPaths);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new HatchError(
      `existing snapshot meta at ${metaPath} is unreadable: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Remove the directory or pick a fresh sessionId.`,
      1,
      "FS_ERROR",
      `Run \`rm -rf ${context.dir}\` and retry with the same session id, or choose a fresh session id.`,
    );
  }
}

function initializeSnapshotCaptureState(existing: SnapshotMeta | null): SnapshotCaptureState {
  const state: SnapshotCaptureState = {
    acceptedAbs: [],
    acceptedRel: [],
    seen: new Map<string, string>(),
    seededRels: new Set<string>(),
  };
  if (!existing) return state;
  for (let index = 0; index < existing.relativePaths.length; index++) {
    const rel = existing.relativePaths[index];
    if (state.seen.has(rel)) continue;
    state.seen.set(rel, existing.paths[index] ?? rel);
    state.seededRels.add(rel);
  }
  return state;
}

function snapshotCollisionWarning(
  sessionId: string,
  absolutePath: string,
  relativePath: string,
  priorPath: string,
): string {
  return (
    `Snapshot mirror collision: ${absolutePath} maps to the same snapshot path as ${priorPath} ` +
    `(both -> ${join(SNAPSHOT_FILES_DIR, relativePath)}). Skipping the second capture; ` +
    `\`hatch3r rollback --session=${sessionId}\` will restore ${priorPath}, not ${absolutePath}. ` +
    `Rename one input to capture both.`
  );
}

async function writeSnapshotTombstone(projectRoot: string, destPath: string): Promise<void> {
  await inspectRepositoryPath(projectRoot, relative(projectRoot, destPath + ".tombstone"), {
    allowMissing: true,
  });
  await writeFile(destPath + ".tombstone", "");
}

async function captureSnapshotInput(
  context: SnapshotCaptureContext,
  sessionId: string,
  input: ResolvedSnapshotInput,
): Promise<void> {
  const destPath = join(context.filesDir, input.relativePath);
  const destinationParent = dirname(
    `${HATCH3R_DIR}/${SNAPSHOTS_DIR}/${sessionId}/${SNAPSHOT_FILES_DIR}/${input.relativePath}`,
  ).replace(/\\/g, "/");
  await ensureSafeRepositoryDirectory(context.projectRoot, destinationParent);
  await inspectRepositoryPath(context.projectRoot, relative(context.projectRoot, destPath), {
    allowMissing: true,
  });
  try {
    if (!input.external) await inspectRepositoryPath(context.projectRoot, input.relativePath);
    const sourceStat = await stat(input.absolutePath);
    if (sourceStat.isDirectory()) return writeSnapshotTombstone(context.projectRoot, destPath);
    await writeFile(destPath, await readFile(input.absolutePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await writeSnapshotTombstone(context.projectRoot, destPath);
  }
}

async function captureSnapshotInputs(
  context: SnapshotCaptureContext,
  sessionId: string,
  state: SnapshotCaptureState,
  emitWarning: SnapshotWarningEmitter,
): Promise<void> {
  for (const input of context.resolvedInputs) {
    const prior = state.seen.get(input.relativePath);
    if (prior === input.absolutePath && state.seededRels.has(input.relativePath)) continue;
    if (prior !== undefined) {
      emitWarning(snapshotCollisionWarning(sessionId, input.absolutePath, input.relativePath, prior));
      continue;
    }
    state.seen.set(input.relativePath, input.absolutePath);
    state.acceptedAbs.push(input.absolutePath);
    state.acceptedRel.push(input.relativePath);
    await captureSnapshotInput(context, sessionId, input);
  }
}

function mergeSnapshotEntries(
  existing: SnapshotMeta | null,
  state: SnapshotCaptureState,
): { paths: string[]; relativePaths: string[] } {
  const paths: string[] = [];
  const relativePaths: string[] = [];
  const seen = new Set<string>();
  const append = (absolutePath: string, relativePath: string): void => {
    if (seen.has(relativePath)) return;
    seen.add(relativePath);
    paths.push(absolutePath);
    relativePaths.push(relativePath);
  };
  existing?.relativePaths.forEach((rel, index) => append(existing.paths[index] ?? rel, rel));
  state.acceptedRel.forEach((rel, index) => append(state.acceptedAbs[index], rel));
  return { paths, relativePaths };
}

async function writeSnapshotMetadata(
  context: SnapshotCaptureContext,
  sessionId: string,
  entries: { paths: string[]; relativePaths: string[] },
): Promise<void> {
  const meta: SnapshotMeta = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sessionId,
    timestamp: new Date().toISOString(),
    paths: entries.paths,
    relativePaths: entries.relativePaths,
    projectRoot: context.projectRoot,
  };
  await inspectRepositoryPath(
    context.projectRoot,
    `${HATCH3R_DIR}/${SNAPSHOTS_DIR}/${sessionId}/${SNAPSHOT_META_FILE}`,
    { allowMissing: true },
  );
  await atomicWriteFile(
    join(context.dir, SNAPSHOT_META_FILE),
    JSON.stringify(meta, null, 2) + "\n",
  );
}

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
 * By default every input must be a symlink-free path below `projectRoot`.
 * Standalone API callers may deliberately opt in to external absolute paths
 * with `allowExternalPaths`; CLI lifecycle callers do not expose that option.
 */
export async function createSnapshot(
  sessionId: string,
  paths: string[],
  options: CreateSnapshotOptions = {},
): Promise<CreateSnapshotResult> {
  assertValidSnapshotSessionId(sessionId);
  const context = await initializeSnapshotCapture(sessionId, paths, options);
  const warnings: string[] = [];
  const emitWarning = createSnapshotWarningEmitter(warnings, options.onWarn);

  const existing = await readExistingSnapshotMeta(
    context,
    options.allowExternalPaths === true,
  );
  const state = initializeSnapshotCaptureState(existing);

  await captureSnapshotInputs(context, sessionId, state, emitWarning);

  const entries = mergeSnapshotEntries(existing, state);
  await writeSnapshotMetadata(context, sessionId, entries);
  await pruneSnapshots(context.projectRoot, emitWarning);
  return { snapshotPath: context.dir, count: entries.paths.length, warnings };
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
      // DD-C: validated parse (was schemaVersion+timestamp spot checks on a
      // trusting cast) — a wrong-shape meta is skipped like an unreadable one.
      const parsed: unknown = JSON.parse(raw);
      if (isSnapshotMeta(parsed)) {
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
 *      carrying a validation error still propagate because unsafe paths and
 *      malformed session ids are programming/configuration faults, not an
 *      environmental loss of snapshot availability.
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
    // Validation faults propagate: lifecycle callers must never continue a
    // mutation after supplying an unsafe repository path or malformed session
    // id. Environmental failures (EACCES on a read-only filesystem, etc.)
    // still downgrade to a warning so the operator sees the safety-net loss.
    if (
      err instanceof HatchError &&
      err.errorCode === "VALIDATION_ERROR"
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
  /** Explicit standalone API entry outside projectRoot. Never true for CLI lifecycle snapshots. */
  external: boolean;
  /** True when the entry is a tombstone (file absent pre-run; restore = delete). */
  isTombstone: boolean;
  /** Snapshot bytes pre-loaded for a regular entry (undefined for tombstones). */
  sourceContent?: Buffer;
  /** Prepare-phase error (mirror unreadable, destination not writable, etc.). */
  error?: string;
}

interface RollbackOptions {
  dryRun?: boolean;
  projectRoot?: string;
  allowExternalPaths?: boolean;
}

interface RollbackContext {
  projectRoot: string;
  dir: string;
  meta: SnapshotMeta;
  resolvedEntries: ResolvedSnapshotInput[];
}

type RollbackFailure = { ok: false; result: RollbackResult };
type RollbackContextResult = { ok: true; value: RollbackContext } | RollbackFailure;

interface MutatedSnapshot {
  bytes: Buffer | null;
  unreadable?: boolean;
}

interface RollbackCommitState {
  restored: number;
  applied: number[];
  errors: string[];
  dispositions: RollbackFileDisposition[];
  failed: boolean;
}

function rollbackError(message: string): RollbackFailure {
  return { ok: false, result: { filesRestored: 0, errors: [message] } };
}

async function resolveRollbackProjectRoot(
  sessionId: string,
  requestedRoot: string,
): Promise<string> {
  const projectRoot = resolve(requestedRoot);
  await realpath(projectRoot);
  const metaRelativePath = `${HATCH3R_DIR}/${SNAPSHOTS_DIR}/${sessionId}/${SNAPSHOT_META_FILE}`;
  normalizeRepositoryRelativePath(metaRelativePath);
  await inspectRepositoryPath(projectRoot, metaRelativePath);
  return projectRoot;
}

async function readRollbackMeta(
  sessionId: string,
  metaPath: string,
): Promise<SnapshotMeta | RollbackFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metaPath, "utf-8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return rollbackError(`session ${sessionId} not found or unreadable: ${message}`);
  }
  const schemaVersion =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>).schemaVersion
      : undefined;
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return rollbackError(
      `session ${sessionId} uses snapshot schema ${String(schemaVersion)} ` +
        `(expected ${SNAPSHOT_SCHEMA_VERSION}). Restore with a matching hatch3r version.`,
    );
  }
  if (isSnapshotMeta(parsed)) return parsed;
  return rollbackError(
    `session ${sessionId} has a malformed meta.json (missing or mismatched ` +
      `sessionId/timestamp/projectRoot/paths/relativePaths). Delete the session directory or ` +
      `restore meta.json from backup before rolling back.`,
  );
}

function isRollbackContextFailure(
  value: SnapshotMeta | RollbackFailure,
): value is RollbackFailure {
  return !isSnapshotMeta(value);
}

async function loadRollbackContext(
  sessionId: string,
  opts: RollbackOptions,
): Promise<RollbackContextResult> {
  let projectRoot: string;
  try {
    projectRoot = await resolveRollbackProjectRoot(
      sessionId,
      opts.projectRoot ?? process.cwd(),
    );
  // eslint-disable-next-line silent-failure/no-silent-catch -- returned errors[] is applyRollback's public diagnostic channel.
  } catch (err) {
    return rollbackError(
      `session ${sessionId} not found, unreadable, or unsafe: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const dir = sessionDir(sessionId, projectRoot);
  const meta = await readRollbackMeta(sessionId, join(dir, SNAPSHOT_META_FILE));
  if (isRollbackContextFailure(meta)) return meta;
  try {
    const resolvedEntries = await validateSnapshotMetaEntries(
      meta,
      projectRoot,
      opts.allowExternalPaths === true,
    );
    return { ok: true, value: { projectRoot, dir, meta, resolvedEntries } };
  // eslint-disable-next-line silent-failure/no-silent-catch -- returned errors[] is applyRollback's public diagnostic channel.
  } catch (err) {
    return rollbackError(
      `session ${sessionId} contains an unsafe snapshot path: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function inspectRollbackTombstone(
  projectRoot: string,
  tombstone: string,
): Promise<{ found: boolean; error?: string }> {
  try {
    await stat(tombstone);
    await inspectRepositoryPath(projectRoot, relative(projectRoot, tombstone));
    return { found: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
    return { found: false, error: `stat ${tombstone}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function prepareTombstoneEntry(
  projectRoot: string,
  entry: PreparedEntry,
): Promise<PreparedEntry> {
  try {
    if (!entry.external) {
      await inspectRepositoryPath(projectRoot, entry.rel, { allowMissing: true });
    }
    await access(dirname(entry.target), fsConstants.W_OK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      entry.error = `parent not writable for ${entry.target}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return entry;
}

async function prepareRegularEntry(
  projectRoot: string,
  entry: PreparedEntry,
): Promise<PreparedEntry> {
  try {
    await inspectRepositoryPath(projectRoot, relative(projectRoot, entry.source));
    entry.sourceContent = await readFile(entry.source);
  } catch (err) {
    entry.error = `read snapshot ${entry.source}: ${err instanceof Error ? err.message : String(err)}`;
    return entry;
  }
  try {
    if (entry.external) await mkdir(dirname(entry.target), { recursive: true });
    else {
      const parentRel = dirname(entry.rel).replace(/\\/g, "/");
      if (parentRel !== ".") await ensureSafeRepositoryDirectory(projectRoot, parentRel);
      await inspectRepositoryPath(projectRoot, entry.rel, { allowMissing: true });
    }
    await access(dirname(entry.target), fsConstants.W_OK);
  } catch (err) {
    entry.error = `destination not writable for ${entry.target}: ${err instanceof Error ? err.message : String(err)}`;
  }
  return entry;
}

async function prepareRollbackEntry(
  context: RollbackContext,
  index: number,
): Promise<PreparedEntry> {
  const resolved = context.resolvedEntries[index];
  const source = join(context.dir, SNAPSHOT_FILES_DIR, resolved.relativePath);
  const tombstone = await inspectRollbackTombstone(context.projectRoot, source + ".tombstone");
  const entry: PreparedEntry = {
    rel: resolved.relativePath,
    target: resolved.absolutePath,
    source,
    external: resolved.external,
    isTombstone: tombstone.found,
    ...(tombstone.error ? { error: tombstone.error } : {}),
  };
  if (entry.error) return entry;
  return entry.isTombstone
    ? prepareTombstoneEntry(context.projectRoot, entry)
    : prepareRegularEntry(context.projectRoot, entry);
}

async function prepareRollbackEntries(context: RollbackContext): Promise<PreparedEntry[]> {
  const prepared: PreparedEntry[] = [];
  for (let index = 0; index < context.meta.relativePaths.length; index++) {
    prepared.push(await prepareRollbackEntry(context, index));
  }
  return prepared;
}

function preparedRollbackResult(
  prepared: PreparedEntry[],
  dryRun: boolean,
): RollbackResult | null {
  const failed = prepared.filter((entry) => entry.error);
  if (!dryRun && failed.length === 0) return null;
  const dispositions: RollbackFileDisposition[] = prepared.map((entry) => ({
    target: entry.target,
    state: dryRun && !entry.error ? "original-restored" : "mutated-still",
    ...(entry.error ? { error: entry.error } : {}),
  }));
  if (dryRun) {
    return {
      filesRestored: prepared.length - failed.length,
      errors: failed.map((entry) => entry.error as string),
      dispositions,
    };
  }
  return {
    filesRestored: 0,
    errors: [
      `Rollback aborted: prepare phase reported ${failed.length} unrecoverable error(s); ` +
        `no files were modified (disk left in pre-rollback state).`,
      ...failed.map((entry) => entry.error as string),
    ],
    dispositions,
  };
}

async function captureMutatedSnapshots(
  projectRoot: string,
  prepared: PreparedEntry[],
): Promise<Map<string, MutatedSnapshot>> {
  const snapshots = new Map<string, MutatedSnapshot>();
  for (const entry of prepared) {
    try {
      if (!entry.external) {
        await inspectRepositoryPath(projectRoot, entry.rel, { allowMissing: true });
      }
      snapshots.set(entry.target, { bytes: await readFile(entry.target) });
    } catch (err) {
      snapshots.set(
        entry.target,
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? { bytes: null }
          : { bytes: null, unreadable: true },
      );
    }
  }
  return snapshots;
}

async function removeRollbackTarget(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

async function applyPreparedEntry(projectRoot: string, entry: PreparedEntry): Promise<void> {
  if (!entry.external) {
    await inspectRepositoryPath(projectRoot, entry.rel, { allowMissing: true });
  }
  if (entry.isTombstone) await removeRollbackTarget(entry.target);
  else await atomicWriteFile(entry.target, entry.sourceContent as Buffer);
}

async function commitPreparedEntries(
  projectRoot: string,
  prepared: PreparedEntry[],
): Promise<RollbackCommitState> {
  const state: RollbackCommitState = {
    restored: 0,
    applied: [],
    errors: [],
    dispositions: prepared.map((entry) => ({ target: entry.target, state: "mutated-still" })),
    failed: false,
  };
  for (let index = 0; index < prepared.length; index++) {
    try {
      await applyPreparedEntry(projectRoot, prepared[index]);
      state.dispositions[index].state = "original-restored";
      state.applied.push(index);
      state.restored++;
    } catch (err) {
      state.failed = true;
      state.errors.push(`restore ${prepared[index].target}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }
  return state;
}

async function restoreMutatedSnapshot(
  projectRoot: string,
  entry: PreparedEntry,
  snapshot: MutatedSnapshot,
): Promise<void> {
  if (!entry.external) {
    await inspectRepositoryPath(projectRoot, entry.rel, { allowMissing: true });
  }
  if (snapshot.bytes === null) await removeRollbackTarget(entry.target);
  else await atomicWriteFile(entry.target, snapshot.bytes);
}

async function rollForwardEntry(
  projectRoot: string,
  entry: PreparedEntry,
  snapshot: MutatedSnapshot | undefined,
  disposition: RollbackFileDisposition,
  errors: string[],
): Promise<boolean> {
  if (!snapshot || snapshot.unreadable) {
    disposition.state = "unknown";
    disposition.error = `pre-rollback bytes unreadable; cannot roll forward ${entry.target}`;
    return false;
  }
  try {
    await restoreMutatedSnapshot(projectRoot, entry, snapshot);
    disposition.state = "rolled-forward";
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    disposition.state = "unknown";
    disposition.error = `roll-forward failed for ${entry.target}: ${message}`;
    errors.push(`roll-forward ${entry.target}: ${message}`);
    return false;
  }
}

async function rollForwardAppliedEntries(
  projectRoot: string,
  prepared: PreparedEntry[],
  snapshots: Map<string, MutatedSnapshot>,
  state: RollbackCommitState,
): Promise<void> {
  if (!state.failed) return;
  for (const index of state.applied) {
    const entry = prepared[index];
    const rolledForward = await rollForwardEntry(
      projectRoot,
      entry,
      snapshots.get(entry.target),
      state.dispositions[index],
      state.errors,
    );
    if (rolledForward) state.restored--;
  }
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
 * Repository rollback is the default and rejects external or symlinked
 * targets. Standalone callers restoring an intentionally external snapshot
 * must explicitly pass `allowExternalPaths: true`.
 */
export async function applyRollback(
  sessionId: string,
  opts: RollbackOptions = {},
): Promise<RollbackResult> {
  const loaded = await loadRollbackContext(sessionId, opts);
  if (!loaded.ok) return loaded.result;
  const context = loaded.value;

  // ── Prepare phase ──────────────────────────────────────────────
  // Resolve every entry and verify it can be restored before touching disk.
  const prepared = await prepareRollbackEntries(context);

  const prepareResult = preparedRollbackResult(prepared, opts.dryRun === true);
  if (prepareResult) return prepareResult;

  // ── Commit phase ───────────────────────────────────────────────
  // Capture pre-rollback bytes of every target so a mid-commit failure can
  // roll the already-applied entries forward to this captured state.
  const mutatedSnapshots = await captureMutatedSnapshots(context.projectRoot, prepared);
  const commitState = await commitPreparedEntries(context.projectRoot, prepared);

  // ── Roll-forward ───────────────────────────────────────────────
  // A commit-phase write failed: undo the already-applied entries so the disk
  // returns to its pre-rollback (mutated) state — all-or-nothing.
  await rollForwardAppliedEntries(
    context.projectRoot,
    prepared,
    mutatedSnapshots,
    commitState,
  );
  return {
    filesRestored: commitState.restored,
    errors: commitState.errors,
    dispositions: commitState.dispositions,
  };
}
