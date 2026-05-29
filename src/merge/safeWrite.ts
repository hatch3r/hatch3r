import {
  readFile,
  writeFile,
  mkdir,
  access,
  rename,
  unlink,
  open,
  copyFile,
  stat,
  readdir,
} from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import * as properLockfile from "proper-lockfile";
import { HATCH3R_PREFIX, HatchError, type MergeResult } from "../types.js";
import {
  insertManagedBlock,
  hasManagedBlock,
  extractCustomContent,
  wouldChangeMarkerVariant,
} from "./managedBlocks.js";
import { scanForDeniedPatterns } from "../adapters/customization.js";

/** Check whether a file exists. Returns false for ENOENT, throws for other errors. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return false;
  }
}

/**
 * D1-SA1.5.1: Default timeout in ms for cross-process file lock acquisition
 * when HATCH3R_LOCK=1 is set. 5 retries × 500ms ≈ 5s ceiling.
 */
const LOCK_RETRIES = 5;
const LOCK_RETRY_MIN_MS = 100;
const LOCK_RETRY_MAX_MS = 1500;
/**
 * Default lock staleness threshold: a lock older than this is treated as
 * abandoned and may be stolen by another process. 15s is `proper-lockfile`'s
 * sweet spot for hatch3r's typical 1-50KB managed-file writes, which complete
 * in sub-second on healthy hardware.
 *
 * D1-SA1.5-F9 (Cycle 10, P6): this is an UPPER BOUND, not a guarantee. A
 * multi-MB write (a large `CLAUDE.md` after heavy customization) to a slow
 * filesystem (USB 2.0, NFS over WAN, a throttled CI volume) can exceed 15s for
 * the `writeFile` + `fdatasync` + `rename` pipeline. `proper-lockfile` refreshes
 * the lock mtime on an internal interval, but an event loop starved by heavy
 * synchronous I/O may miss a refresh, after which a second process can see the
 * lock as stale and acquire it — producing a last-writer-wins rename race.
 * Operators on slow filesystems can raise the ceiling via the
 * `HATCH3R_LOCK_STALE_MS` env var (see {@link resolveLockStaleMs}).
 */
const LOCK_STALE_DEFAULT_MS = 15_000;
/** Floor for an operator-supplied {@link HATCH3R_LOCK_STALE_MS} override. Below
 *  this, `proper-lockfile`'s own refresh interval cannot keep the lock alive,
 *  so values under the floor are clamped up to it. */
const LOCK_STALE_MIN_MS = 2_000;

/**
 * D1-SA1.5-F9 (Cycle 10, P6): resolve the lock staleness threshold. Defaults to
 * {@link LOCK_STALE_DEFAULT_MS}; an operator on a slow filesystem can raise it
 * via `HATCH3R_LOCK_STALE_MS=<milliseconds>`. A non-numeric, non-finite, or
 * sub-{@link LOCK_STALE_MIN_MS} value falls back to the default (or the floor)
 * rather than silently disabling stale detection.
 */
function resolveLockStaleMs(): number {
  const raw = process.env.HATCH3R_LOCK_STALE_MS;
  if (raw === undefined || raw.trim() === "") return LOCK_STALE_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return LOCK_STALE_DEFAULT_MS;
  return Math.max(Math.trunc(parsed), LOCK_STALE_MIN_MS);
}

/**
 * F1.2-H1 (Cycle 10): Tracks file paths whose cross-process advisory lock is
 * currently held by THIS Node process. When `acquireWriteLock` is called for
 * a path already in the set, it short-circuits to a no-op release so the
 * outer holder owns the lifecycle. Makes the lock reentrant within a single
 * process (e.g. `configCommand` holds the manifest lock, then `writeManifest
 * -> atomicWriteFile -> acquireWriteLock` re-enters on the same path) while
 * still serializing across processes via the on-disk lockfile.
 */
const HELD_LOCKS = new Set<string>();

/**
 * D8-M3 (Cycle 10 rollover): default-on cross-process file locking for
 * workspace and worktree contexts. The `HATCH3R_LOCK=1` env var was the only
 * way to opt in, and it was undiscoverable — operators running `hatch3r sync`
 * against a workspace from two shells silently raced manifest writes. The
 * workspace and worktree command entry points now call
 * `enableDefaultCrossProcessLocking()` at startup so cross-process safety is
 * default-on for those contexts. The env var still works for single-repo
 * flows where the operator explicitly wants locking (e.g. CI matrix runs in
 * `hatch3r init`).
 *
 * To force-disable in a context where the default would otherwise enable
 * locking (advanced/test only), set `HATCH3R_LOCK=0`.
 */
let defaultCrossProcessLockingEnabled = false;

/**
 * Enable default cross-process locking for the current process. Called by
 * workspace and worktree command entry points so concurrent invocations from
 * two shells (or two CI matrix runners) do not race manifest writes. Idempotent.
 *
 * After this is called, {@link acquireWriteLock} takes the on-disk advisory
 * lock unless the operator has explicitly set `HATCH3R_LOCK=0` to opt out.
 */
export function enableDefaultCrossProcessLocking(): void {
  defaultCrossProcessLockingEnabled = true;
}

/**
 * Reset default-on state. Used by tests so each test starts from the
 * single-process default. Not part of the public CLI surface.
 */
export function resetDefaultCrossProcessLocking(): void {
  defaultCrossProcessLockingEnabled = false;
}

/**
 * D8-M3: returns true when {@link acquireWriteLock} should actually take an
 * on-disk lock for this process. Precedence:
 *   1. `HATCH3R_LOCK=0` → explicit opt-out wins, even when default is enabled.
 *   2. `HATCH3R_LOCK=1` → explicit opt-in.
 *   3. {@link defaultCrossProcessLockingEnabled} → default-on for
 *      workspace/worktree contexts.
 *   4. Otherwise → no-op (single-repo default unchanged).
 */
function isLockingEnabled(): boolean {
  const envVal = process.env.HATCH3R_LOCK;
  if (envVal === "0") return false;
  if (envVal === "1") return true;
  return defaultCrossProcessLockingEnabled;
}

/**
 * D1-SA1.5.1: Acquire a cross-process advisory lock for {@link filePath}.
 *
 * Locking activates when either:
 *  - `HATCH3R_LOCK=1` is set explicitly, OR
 *  - the process is running a workspace/worktree command that called
 *    {@link enableDefaultCrossProcessLocking} (D8-M3).
 *
 * Set `HATCH3R_LOCK=0` to force-disable when the default would otherwise
 * enable locking. The default (no env var, no command-level enable) is a
 * no-op so existing single-process behavior is preserved.
 *
 * Returns a release function. Callers MUST invoke release in a finally block
 * — even when the wrapped write throws — to prevent stale locks.
 *
 * Throws {@link HatchError} with code `LOCK_TIMEOUT` when contention exceeds
 * the retry budget (~5s).
 *
 * D1-SA1.5-F9 (Cycle 10, P6): a held lock is considered stale (and stealable
 * by another process) after {@link LOCK_STALE_DEFAULT_MS} (15s) by default.
 * That ceiling can be too low for multi-MB writes on slow filesystems; raise
 * it via `HATCH3R_LOCK_STALE_MS=<ms>` (see {@link resolveLockStaleMs}).
 *
 * F1.2-H1 (Cycle 10): exported so multi-step read-modify-write critical
 * sections (e.g. `configCommand`) can hold the lock across the full
 * interactive window. Reentrant within a single process: a nested acquire
 * for an already-held `filePath` returns a no-op release so the outer
 * holder owns the lifecycle.
 */
export async function acquireWriteLock(filePath: string): Promise<() => Promise<void>> {
  if (!isLockingEnabled()) {
    return async () => { /* locking disabled */ };
  }
  if (HELD_LOCKS.has(filePath)) {
    return async () => { /* outer scope holds the real lock */ };
  }
  // proper-lockfile's `lock()` requires the target to exist; we may be
  // creating a new file, so put the lock file beside it instead.
  const lockfilePath = filePath + ".hatch3r.lock";
  // Ensure parent directory exists so the lockfile can be created.
  await mkdir(dirname(filePath), { recursive: true });
  try {
    const release = await properLockfile.lock(filePath, {
      lockfilePath,
      realpath: false,
      stale: resolveLockStaleMs(),
      retries: {
        retries: LOCK_RETRIES,
        minTimeout: LOCK_RETRY_MIN_MS,
        maxTimeout: LOCK_RETRY_MAX_MS,
        factor: 2,
      },
    });
    HELD_LOCKS.add(filePath);
    return async () => {
      try {
        await release();
      } finally {
        HELD_LOCKS.delete(filePath);
      }
    };
  } catch (err) {
    // proper-lockfile surfaces contention as ELOCKED once retries are exhausted.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOCKED") {
      throw new HatchError(
        `Timed out acquiring file lock on ${filePath} after ~5s. ` +
          `Another hatch3r process is writing to the same file. ` +
          `Re-run sequentially, or remove a stale ${lockfilePath} if no process is active.`,
        1,
        "LOCK_TIMEOUT",
      );
    }
    throw err;
  }
}

/**
 * D8-SA8.2-F8.2.7 (Cycle 10, P1): errno → actionable-message table for
 * write-side filesystem failures. The catch handler in {@link atomicWriteFile}
 * previously classified only `ENOSPC` and `EACCES`; every other errno fell
 * through as a bare Node message with no recovery guidance. Linux quota mounts
 * raise `EDQUOT` (not `ENOSPC`) when a user quota is exhausted, so the old
 * "Not enough disk space" message actively misled operators who saw free space
 * in `df`. Read-only mounts (`EROFS`), FAT32 size ceilings (`EFBIG`), fd
 * exhaustion (`EMFILE`), and failing disks (`EIO`) all reach this path too.
 *
 * Each entry returns a complete sentence naming the cause and the operator's
 * next step. `ENOSPC` and `EACCES` keep their prior wording verbatim so no
 * existing assertion changes. The table is module-local rather than hoisted to
 * a shared `fsErrors.ts` because the other proposed consumers
 * (`archiveToolOutputs`, `applyRollback`) are out of this finding's file scope;
 * a future refactor can extract it.
 */
const FS_ERRNO_MESSAGE: Record<string, (filePath: string) => string> = {
  ENOSPC: (p) => `Not enough disk space to write ${p}. Free up space and re-run the command.`,
  EACCES: (p) =>
    `Permission denied writing ${p}. Check file/directory permissions and ensure the current user has write access.`,
  EDQUOT: (p) =>
    `Filesystem quota exceeded writing ${p}. Free space under your quota or ask an admin to raise it, then re-run.`,
  EROFS: (p) =>
    `Read-only filesystem at ${p}. The mount may be in recovery/snapshot mode — remount read-write and re-run.`,
  EFBIG: (p) =>
    `File too large for the filesystem at ${p}. Move ${dirname(p)} to a filesystem that supports larger files (ext4/APFS/NTFS instead of FAT32).`,
  EMFILE: (p) =>
    `Too many open files writing ${p}. Raise the file-descriptor limit (\`ulimit -n\`) or close other tools holding descriptors, then re-run.`,
  ENFILE: (p) =>
    `System-wide open-file limit reached writing ${p}. Close other processes or raise the system fd limit, then re-run.`,
  EIO: (p) =>
    `Low-level I/O error writing ${p}. The disk may be failing — check kernel logs (dmesg / Console.app) and consider running fsck.`,
};

/**
 * Write a file atomically via tmp+rename with fsync.
 *
 * **Concurrency:** By default this function does not use file locking. Two
 * hatch3r processes writing the same target path concurrently can silently
 * clobber one another. Set `HATCH3R_LOCK=1` to opt into cross-process file
 * locking via `proper-lockfile` (D1-SA1.5.1). Locking is gated behind the env
 * var to keep the default behavior unchanged for single-process flows.
 *
 * **Ordering (D3-SA3.4-F9, Cycle 10 Wave 4, P2):** the ordering of CONCURRENT
 * writes to the same path is UNSPECIFIED. POSIX `rename(2)` is atomic per call
 * (no torn content — a reader always sees one writer's complete bytes), but the
 * OS does not guarantee that overlapping `rename` calls land in submission
 * order. With `Promise.all([write(A), write(B)])` the final on-disk content is
 * A or B, not deterministically the last-submitted. Callers that require
 * last-write-wins MUST serialize: either `await` each write before the next, or
 * acquire the cross-process lock (`HATCH3R_LOCK=1`). SEQUENTIALLY-awaited writes
 * DO observe submission order — the last awaited write is the final content —
 * because each `rename` completes before the next begins.
 *
 * When locking is enabled and contention exceeds ~5s, throws {@link HatchError}
 * with code `LOCK_TIMEOUT`.
 *
 * Write-side filesystem failures (ENOSPC, EACCES, EDQUOT, EROFS, EFBIG, EMFILE,
 * ENFILE, EIO) are mapped to actionable `FS_ERROR` HatchErrors via
 * {@link FS_ERRNO_MESSAGE}; unrecognised errnos re-throw unchanged
 * (D8-SA8.2-F8.2.7, P1).
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const release = await acquireWriteLock(filePath);
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  try {
    await writeFile(tmpPath, content, "utf-8");
    // #239 (D8-8.6): Open with "r+" instead of "r" so fdatasync operates on a
    // writable file descriptor. Read-only descriptors cause EPERM/EBADF on some
    // platforms (Windows, certain Linux configurations).
    const fh = await open(tmpPath, "r+");
    try {
      await fh.datasync();
    } catch (err) {
      // Some filesystems or OS configurations still reject fdatasync (e.g. FAT32,
      // network mounts). The atomic rename provides the safety guarantee; datasync
      // is best-effort durability.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EINVAL") throw err;
    } finally {
      await fh.close();
    }
    // Retry with exponential backoff for Windows file-lock contention (EBUSY/EPERM)
    const MAX_RENAME_RETRIES = 4;
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmpPath, filePath);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if ((code === "EBUSY" || code === "EPERM") && attempt < MAX_RENAME_RETRIES) {
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    // #239 (D8-8.6) + D8-SA8.2-F8.2.7 (Cycle 10, P1): map known write-side
    // errnos (ENOSPC/EACCES and the EDQUOT/EROFS/EFBIG/EMFILE/ENFILE/EIO family)
    // to actionable FS_ERROR messages via {@link FS_ERRNO_MESSAGE}. ENOSPC and
    // EACCES keep their prior wording verbatim. Unrecognised errnos re-throw.
    const code = (err as NodeJS.ErrnoException).code;
    const messageFor = code ? FS_ERRNO_MESSAGE[code] : undefined;
    if (messageFor) {
      throw new HatchError(messageFor(filePath), 1, "FS_ERROR");
    }
    throw err;
  } finally {
    // Silent Failure Contract (P5): emit a diagnostic when tmp-file cleanup
    // fails for any reason other than "already renamed away" (ENOENT).
    // Mid-stream exceptions can leave orphan .tmp.<hex> files on disk; if we
    // cannot clean them up here, operators need to know so they can invoke
    // sweepOrphanTmpFiles() or remove them manually. Silently swallowing all
    // errors violates the Silent Failure Contract per governance/CONSTITUTION.md.
    try {
      await unlink(tmpPath);
    } catch (unlinkErr) {
      const code = (unlinkErr as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(
          `hatch3r: failed to remove temp file ${tmpPath}: ` +
            `${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}. ` +
            `Run 'hatch3r sync' or 'hatch3r update' to trigger orphan-tmp sweep.`,
        );
      }
    }
    // Silent Failure Contract: log if release throws; do not mask the original error.
    try {
      await release();
    } catch (releaseErr) {
      // D8-M3: emit the diagnostic when locking was active for this call —
      // either via explicit env-var opt-in OR the workspace/worktree default.
      // Without the broader gate, a lock taken by default-on (no env var set)
      // would still fail silently on release.
      if (isLockingEnabled()) {
        console.error(
          `hatch3r: failed to release write lock for ${filePath}: ` +
            `${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
        );
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// D11-SA11.2-01 (C7.5-W2B2-H37): Orphan tmp-file sweep
//
// `atomicWriteFile` writes to `<target>.tmp.<8-hex>` then renames. If the
// process is killed mid-stream (SIGKILL, crash, power loss) the `finally`
// unlink does not run and the orphan accumulates across runs. This sweep
// finds such orphans, removes them, and returns a diagnostic list so the
// caller can emit a warning per the Silent Failure Contract.
//
// CALLER CONTRACT (D1-SA1.5-F10, Cycle 10, P6): EVERY CLI command entry point
// that can reach `atomicWriteFile` — init, sync, update, clean, config,
// worktree-setup, worktree-cleanup, rollback, mcp, cli-tools — should invoke
// this at start-of-run against the repo root (and `.hatch3r/` /
// `{ recursive: true }` where adapters write nested layouts) and surface the
// returned entries via `warn()` / observability. A command that mutates files
// but never sweeps lets an orphan from a prior interrupted run persist
// indefinitely if the operator never re-runs a sweeping command. The sweep is
// 60s-age-gated ({@link ORPHAN_MIN_AGE_MS}), so calling it on entry is safe
// even when a concurrent write is in flight. Wiring the call into each command
// entry point lives in those command files (outside this module's scope); this
// contract names the required coverage so a future change can complete it.
// ──────────────────────────────────────────────────────────────────────────

/** Matches `<anything>.tmp.<8 hex chars>` — the exact pattern produced by atomicWriteFile. */
const ORPHAN_TMP_SUFFIX_RE = /\.tmp\.[0-9a-f]{8}$/;

/** Minimum age (ms) before a tmp file is treated as an orphan. Younger
 *  files may be in flight from a concurrent atomicWriteFile on another
 *  worker; sweeping them would race and corrupt that write. 60s is
 *  conservative — atomic writes should complete in sub-second on healthy
 *  hardware, so a minute-old tmp file is almost certainly abandoned. */
const ORPHAN_MIN_AGE_MS = 60_000;

/**
 * One orphan tmp file discovered by {@link sweepOrphanTmpFiles}.
 * Exposed so callers can surface per-file diagnostics, not just a count.
 */
export interface OrphanTmpSweepEntry {
  /** Absolute path to the orphan tmp file. */
  path: string;
  /** mtime in ms since epoch when the sweep discovered it. */
  mtimeMs: number;
  /** Whether the sweep succeeded in removing it. */
  removed: boolean;
  /** Populated when `removed === false`. */
  error?: string;
}

/**
 * Sweep orphan `.tmp.<8-hex>` files under a directory tree, removing any
 * older than {@link ORPHAN_MIN_AGE_MS}. Returns one entry per orphan so the
 * caller can emit a diagnostic per the Silent Failure Contract — the sweep
 * itself is NOT silent.
 *
 * Safe against concurrent in-flight writes: only files older than
 * {@link ORPHAN_MIN_AGE_MS} are candidates, so a live atomicWriteFile on
 * another process (or in-flight on this one) is never swept.
 *
 * Non-recursive by default; pass `{ recursive: true }` to walk subtrees
 * (e.g. `.agents/` which contains tool-specific nested layouts).
 */
export async function sweepOrphanTmpFiles(
  dir: string,
  options: { recursive?: boolean; nowMs?: number } = {},
): Promise<OrphanTmpSweepEntry[]> {
  const nowMs = options.nowMs ?? Date.now();
  const results: OrphanTmpSweepEntry[] = [];
  let entries: Array<{ name: string; isFile: boolean; parent: string }> = [];
  try {
    const raw = await readdir(dir, {
      withFileTypes: true,
      recursive: options.recursive === true,
    });
    entries = raw.map((e) => {
      const parent =
        (e as unknown as { parentPath?: string }).parentPath ??
        (e as unknown as { path?: string }).path ??
        dir;
      return { name: e.name, isFile: e.isFile(), parent };
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is expected on fresh checkouts before .agents/ is created.
    // Any other failure deserves a diagnostic so operators see it.
    if (code !== "ENOENT") {
      console.error(
        `hatch3r: orphan-tmp sweep could not read ${dir}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (!ORPHAN_TMP_SUFFIX_RE.test(entry.name)) continue;
    const fullPath = join(entry.parent, entry.name);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      // Disappeared between readdir and stat — treat as already cleaned.
      continue;
    }
    const age = nowMs - fileStat.mtimeMs;
    if (age < ORPHAN_MIN_AGE_MS) continue;
    try {
      await unlink(fullPath);
      results.push({ path: fullPath, mtimeMs: fileStat.mtimeMs, removed: true });
    } catch (unlinkErr) {
      results.push({
        path: fullPath,
        mtimeMs: fileStat.mtimeMs,
        removed: false,
        error: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr),
      });
    }
  }

  return results;
}

/**
 * Format a sweep result list as a human-readable diagnostic string.
 * Returns `null` when the list is empty so callers can suppress the warning
 * in the common case.
 */
export function formatOrphanTmpSweepDiagnostic(
  entries: OrphanTmpSweepEntry[],
): string | null {
  if (entries.length === 0) return null;
  const removed = entries.filter((e) => e.removed);
  const failed = entries.filter((e) => !e.removed);
  const parts: string[] = [];
  if (removed.length > 0) {
    parts.push(
      `Swept ${removed.length} orphan temp file(s) from prior interrupted runs: ` +
        removed.map((e) => e.path).join(", "),
    );
  }
  if (failed.length > 0) {
    parts.push(
      `Failed to remove ${failed.length} orphan temp file(s); remove manually: ` +
        failed.map((e) => `${e.path} (${e.error ?? "unknown"})`).join(", "),
    );
  }
  return parts.join(". ");
}

/**
 * Predict the {@link MergeResult.action} a {@link safeWriteFile} call would
 * return for the given inputs — WITHOUT any disk I/O, throwing, deny-pattern
 * scan, or auto-repair side effect. Pure: depends only on its arguments.
 *
 * D11-SA11.2-F9 (Cycle 10 Wave 4, D11, P1): `hatch3r sync --dry-run` recorded
 * a generic `"dry-run"` row per output and never exercised the marker-merge
 * decision, so a file whose `HATCH3R:BEGIN/END` markers were stripped showed
 * `~ modified` in the dry-run summary while a live sync then reported a
 * different disposition. This predictor lets the dry-run branch report the
 * same action vocabulary the live write produces, closing the
 * preview-vs-reality gap (Terraform `plan`-fidelity analogue).
 *
 * Decision logic mirrors {@link safeWriteFile} branch-for-branch:
 * - `existingContent === null` (file absent) → `created`.
 * - With `managedContent`:
 *   - existing has no managed block + `appendIfNoBlock` → would prepend; if the
 *     prepended bytes equal the existing file → `unchanged`, else `updated`.
 *   - existing has no managed block + no `appendIfNoBlock` → `skipped`
 *     (the would-be-skip case this finding is about).
 *   - existing has a managed block → would merge; if the merged bytes equal the
 *     existing file → `unchanged`, else `updated`. A corrupted block (the live
 *     path auto-repairs) is reported as `updated`.
 * - Without `managedContent`:
 *   - hatch3r-managed filename OR `force` → `unchanged` when bytes match, else
 *     `updated`.
 *   - otherwise → `skipped`.
 *
 * The deny-pattern scan is intentionally NOT run here: a deny hit aborts the
 * live write (throws) rather than producing an action, and the dry-run preview
 * reports the disposition category, not the security verdict. `skipIfUnchanged`
 * defaults to `true` to match {@link safeWriteFile}.
 */
export function predictMergeAction(
  existingContent: string | null,
  content: string,
  filePath: string,
  options: {
    managedContent?: string;
    appendIfNoBlock?: boolean;
    force?: boolean;
    skipIfUnchanged?: boolean;
  } = {},
): MergeResult["action"] {
  const skipIfUnchanged = options.skipIfUnchanged ?? true;

  if (existingContent === null) return "created";

  if (options.managedContent) {
    if (!hasManagedBlock(existingContent)) {
      if (options.appendIfNoBlock) {
        // Mirror the G6 trailing-\n parity the live appendIfNoBlock branch
        // applies so an unchanged prediction matches an unchanged write.
        let prepended = [content.trim(), "", existingContent.trimStart()].join("\n");
        if (!prepended.endsWith("\n")) prepended += "\n";
        if (skipIfUnchanged && prepended === existingContent) return "unchanged";
        return "updated";
      }
      return "skipped";
    }
    let merged: string;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent, filePath);
    } catch (mergeErr) {
      // Corrupted/duplicate markers: the live path auto-repairs by rewriting,
      // i.e. it returns "updated". Predict the same — but surface the corrupt
      // block per the Silent Failure Contract (CONSTITUTION.md §2 P5) using the
      // file's standard non-fatal IO diagnostic channel, so a dry-run preview
      // names the file the live sync would auto-repair rather than swallowing it.
      console.error(
        `hatch3r: managed-block merge prediction for ${filePath} hit a corrupted/duplicate ` +
          `marker (${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}); ` +
          `predicting 'updated' — the live write auto-repairs the block.`,
      );
      return "updated";
    }
    if (skipIfUnchanged && merged === existingContent) return "unchanged";
    return "updated";
  }

  const fileName = basename(filePath) ?? "";
  if (isManagedFileName(fileName) || options.force) {
    if (skipIfUnchanged && content === existingContent) return "unchanged";
    return "updated";
  }
  return "skipped";
}

/**
 * Safely write or merge a file, preserving user content outside managed blocks.
 *
 * **Concurrency:** Delegates atomic writes to {@link atomicWriteFile}. By
 * default, no cross-process lock is taken — running multiple hatch3r processes
 * against the same target is unsupported and may clobber output. Set
 * `HATCH3R_LOCK=1` to opt into file locking for scenarios like CI matrix runs
 * (D1-SA1.5.1). Workspace sync already processes repos sequentially internally,
 * so a single `hatch3r sync --repos` invocation is safe without the opt-in.
 *
 * **Ordering (D3-SA3.4-F9, Cycle 10 Wave 4, P2):** inherits the unspecified
 * concurrent-write ordering of {@link atomicWriteFile} — overlapping writes to
 * the same path resolve to one writer's complete bytes, but not deterministically
 * the last-submitted. Serialize (await each write, or `HATCH3R_LOCK=1`) when
 * last-write-wins matters.
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  options: {
    managedContent?: string;
    /** When true, prepend managed block to existing content if file has no markers (init flow). */
    appendIfNoBlock?: boolean;
    /** When true, always write through regardless of filename prefix. */
    force?: boolean;
    /**
     * G3: When true (default), skip the underlying atomic write when the
     * computed/merged bytes are identical to what is already on disk.
     * Returns `{ action: "unchanged" }` instead of `"updated"`. This makes
     * `status` ↔ `sync` idempotent: a redundant sync no longer bumps mtimes
     * (or, downstream, the integrity manifest's `generated` timestamp) when
     * nothing actually changed.
     */
    skipIfUnchanged?: boolean;
  } = {},
): Promise<MergeResult> {
  const skipIfUnchanged = options.skipIfUnchanged ?? true;
  await mkdir(dirname(filePath), { recursive: true });

  const exists = await fileExists(filePath);

  if (!exists) {
    await atomicWriteFile(filePath, content);
    return { path: filePath, action: "created" };
  }

  const existingContent = await readFile(filePath, "utf-8");

  if (options.managedContent) {
    if (!hasManagedBlock(existingContent)) {
      if (options.appendIfNoBlock) {
        // C9-H41 (D11-SA11.2-01, P6): Scan existing user content for denied
        // patterns BEFORE splicing the managed block in front of it. The
        // companion `existing-markers` branch (below) scans `customContent`
        // extracted from inside markers, but on first sync — when no markers
        // exist yet — the entire file body is user-owned untrusted content
        // about to be preserved verbatim alongside the new managed block.
        // Refusing the splice on a deny hit is the correct disposition:
        // proceeding would smuggle attacker-controlled tokens into the
        // hatch3r-managed file, defeating the purpose of the pipeline deny
        // scan. See governance/audit/finding-registry.json#C9-H41.
        const deniedExisting = scanForDeniedPatterns(existingContent);
        if (deniedExisting.length > 0) {
          throw new HatchError(
            `Refusing to splice managed block into ${filePath}: existing file content contains denied pattern(s): ${deniedExisting.join("; ")}. ` +
              `Review the file for prompt-injection or instruction-override content, remove the offending text, then re-run the command. ` +
              `If this is a false positive, move the suspect text into a hatch3r-managed block manually or open an issue with the matching snippet.`,
            1,
            "VALIDATION_ERROR",
          );
        }
        // G6 (v1.7.1): trailing \n parity with insertManagedBlock so the
        // first write through this branch and the second write through the
        // existing-markers branch produce byte-identical output. Without
        // this, the second sync regenerates with an added \n and drift
        // appears in the user's git status.
        let prepended = [content.trim(), "", existingContent.trimStart()].join("\n");
        if (!prepended.endsWith("\n")) prepended += "\n";
        if (skipIfUnchanged && prepended === existingContent) {
          return { path: filePath, action: "unchanged" };
        }
        await atomicWriteFile(filePath, prepended);
        // D10-M13 (Cycle 10): the prior implementation prepended the managed
        // block to an existing file silently, so a user who deleted the
        // HATCH3R:BEGIN/END markers (intentionally or by mistake) saw a
        // mysterious re-injection on the next sync with no signal that
        // marker recovery had run. Surface a warning so the operator can
        // distinguish "block was missing — I am restoring it" from "block
        // was present — I merged the update."
        return {
          path: filePath,
          action: "updated",
          warning: `Recovered missing managed-block markers in ${filePath}: HATCH3R:BEGIN/END were absent, so the managed content was prepended and your existing content preserved below it. If you intended to permanently detach this file from hatch3r, remove it from the manifest or move it outside the managed paths.`,
        };
      }
      // #144 (D19-15): Improved recovery guidance — avoid suggesting init --force
      return {
        path: filePath,
        action: "skipped",
        warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or move your custom content and re-run hatch3r update.`,
      };
    }
    const customContent = extractCustomContent(existingContent);
    const deniedFindings = customContent ? scanForDeniedPatterns(customContent) : [];
    // F15.1-H1 (Cycle 10 D15-SA15.1, Pillar P6): symmetric fail-closed
    // disposition with the appendIfNoBlock branch above. Refusing the
    // write is the correct disposition: user-side text outside the
    // markers is the surface an attacker controls on subsequent syncs.
    // The error message mirrors the first-sync branch verbatim so
    // operators see one consistent remediation flow. OWASP ASI 2025
    // LLM01 / 2026-12-09 AAI04 untrusted-input guidance + CONSTITUTION
    // §2 P5 Silent Failure Contract.
    if (deniedFindings.length > 0) {
      throw new HatchError(
        `Refusing to update ${filePath}: content outside the hatch3r-managed block contains denied pattern(s): ${deniedFindings.join("; ")}. ` +
          `Review the file for prompt-injection or instruction-override content, remove the offending text, then re-run the command. ` +
          `If this is a false positive, move the suspect text into the hatch3r-managed block manually or open an issue with the matching snippet.`,
        1,
        "VALIDATION_ERROR",
      );
    }
    // D11-SA11.2-F11 (Cycle 10 Wave 4, D11, P5): detect the issue #76
    // legacy-state auto-repair BEFORE the merge so we can attribute the
    // on-disk marker rewrite (HTML `<!-- -->` → YAML `#` in a `.yml` file)
    // on the MergeResult.warning channel. Without this the variant flip lands
    // in the user's `git diff` with no signal that hatch3r rewrote the syntax.
    const variantChanged = wouldChangeMarkerVariant(existingContent, filePath);
    let merged: string;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent, filePath);
    } catch {
      // Managed block is corrupted (duplicate markers, wrong order, etc.).
      // Create a .bak backup before overwriting so user content is not lost.
      // #242 (D8-8.9): Verify backup integrity before proceeding with overwrite.
      // D1-M12 (Cycle 10 Wave-3): file-size equality is necessary but not
      // sufficient — a partial copy that happened to land at the same byte
      // count would pass the size check while the bytes diverged. Compare
      // SHA-256 digests of the in-memory source and the on-disk backup so
      // we abort auto-repair on any byte-level divergence.
      // Auto-repair always writes through — skipIfUnchanged does not apply
      // here because the file shape on disk is broken even when bytes
      // happen to match.
      const bakPath = filePath + ".bak";
      await copyFile(filePath, bakPath);
      const srcStat = await stat(filePath);
      const bakStat = await stat(bakPath);
      if (bakStat.size !== srcStat.size) {
        throw new HatchError(
          `Backup verification failed for ${filePath}: source=${srcStat.size} bytes, backup=${bakStat.size} bytes. ` +
          `Aborting auto-repair to prevent data loss.`,
          1,
          "FS_ERROR",
        );
      }
      // existingContent was read above as the file's pre-repair bytes. Hash
      // it directly and compare with the just-written backup so we detect
      // partial-write or fs-corruption cases the size check misses.
      const srcHash = createHash("sha256").update(existingContent, "utf-8").digest("hex");
      const bakBytes = await readFile(bakPath);
      const bakHash = createHash("sha256").update(bakBytes).digest("hex");
      if (srcHash !== bakHash) {
        throw new HatchError(
          `Backup verification failed for ${filePath}: SHA-256 mismatch (source=${srcHash.slice(0, 12)}…, backup=${bakHash.slice(0, 12)}…). ` +
          `Aborting auto-repair to prevent data loss.`,
          1,
          "FS_ERROR",
        );
      }
      await atomicWriteFile(filePath, content);
      return {
        path: filePath,
        action: "updated",
        warning: `Auto-repaired corrupted managed block in ${filePath} (backup saved to ${bakPath})`,
      };
    }
    // F15.1-H1: any denied finding already threw above (fail-closed), so by
    // here `deniedFindings` is empty — no warning branch is reachable.
    if (skipIfUnchanged && merged === existingContent) {
      return { path: filePath, action: "unchanged" };
    }
    await atomicWriteFile(filePath, merged);
    // D11-SA11.2-F11: surface the issue #76 marker-syntax auto-repair on the
    // existing warning channel (callers aggregate MergeResult.warning into the
    // sync-completion summary) so the operator can attribute the rewrite.
    if (variantChanged) {
      return {
        path: filePath,
        action: "updated",
        warning: `Auto-repaired marker syntax in ${filePath}: legacy HATCH3R:BEGIN/END markers used the wrong comment style for this file type and were rewritten to match (issue #76 legacy state). No action required.`,
      };
    }
    return { path: filePath, action: "updated" };
  }

  const fileName = basename(filePath) ?? "";
  const isManagedFile = isManagedFileName(fileName);

  if (isManagedFile || options.force) {
    if (skipIfUnchanged && content === existingContent) {
      return { path: filePath, action: "unchanged" };
    }
    await atomicWriteFile(filePath, content);
    return { path: filePath, action: "updated" };
  }

  // #144 (D19-15): Improved recovery guidance — avoid suggesting init --force
  return {
    path: filePath,
    action: "skipped",
    warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or move your custom content and re-run hatch3r update.`,
  };
}

/**
 * Wave B3: Match both the legacy `hatch3r-*` naming and the precedence-
 * prefixed `NN-hatch3r-*` naming emitted by the per-file rule adapters
 * (cursor, windsurf, copilot, claude, cline). The prefix is 2 decimal digits
 * (10/30/50/70 for critical/high/normal/low) followed by a hyphen.
 */
const NN_HATCH3R_PREFIX_RE = /^\d{2}-hatch3r-/;

/** True when a filename basename represents a hatch3r-managed output. */
function isManagedFileName(fileName: string): boolean {
  return fileName.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(fileName);
}

/**
 * Check whether a file path's basename identifies a hatch3r-managed output.
 *
 * Recognises two naming shapes:
 * - `hatch3r-<id>.<ext>` — the legacy shape used by agents, commands, skills,
 *   inlined bridge files, and rule outputs emitted by adapters that inline
 *   all rules into a single file.
 * - `NN-hatch3r-<id>.<ext>` — the Wave B3 precedence-prefixed shape emitted
 *   by per-file rule adapters (cursor, windsurf, copilot-scoped, claude,
 *   cline) where `NN` is a 2-digit rank (10/30/50/70).
 */
export function isManagedPath(filePath: string): boolean {
  const fileName = basename(filePath) ?? "";
  return isManagedFileName(fileName);
}
