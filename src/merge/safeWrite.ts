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
import { dirname, basename, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import * as properLockfile from "proper-lockfile";
import { HATCH3R_PREFIX, HatchError, type MergeResult } from "../types.js";
import {
  insertManagedBlock,
  hasManagedBlock,
  extractCustomContent,
  wouldChangeMarkerVariant,
  splitAtManagedBlock,
  isHealableManagedPrefix,
} from "./managedBlocks.js";
import { scanForDeniedPatterns } from "../adapters/customization.js";
import { mapFsErrno } from "./fsErrors.js";

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
 * D11-12 (Cycle 11 Wave 3, P5): pick a `.bak` path for the managed-block
 * auto-repair backup that does NOT overwrite an existing one. Returns the
 * canonical `<filePath>.bak` when it is free; otherwise a uniquely-suffixed
 * `<filePath>.bak.<8hex>` so a second corruption/recovery cannot clobber the
 * backup the first recovery wrote (the single-rolling-slot data-loss the
 * finding flags). The 8-hex suffix uses the same 4-byte `randomBytes` scheme as
 * the `.tmp.<8hex>` writer; a fresh suffix is drawn on the astronomically-rare
 * collision so the returned path is always free at return time.
 */
async function resolveNonClobberingBakPath(filePath: string): Promise<string> {
  const canonical = filePath + ".bak";
  if (!(await fileExists(canonical))) return canonical;
  for (;;) {
    const candidate = `${filePath}.bak.${randomBytes(4).toString("hex")}`;
    if (!(await fileExists(candidate))) return candidate;
  }
}

/**
 * D8-SA8.2-02 (Cycle 12, CQ4): verify a just-copied `.bak` backup against the
 * in-memory source bytes BEFORE the destructive overwrite proceeds. #242
 * (D8-8.9) + D1-M12 (Cycle 10 Wave 3) established the two-step check on the
 * corruption-repair path: size equality is necessary but not sufficient — a
 * partial copy that lands at the same byte count passes the size check while
 * the bytes diverge, so SHA-256 digests of the in-memory source and the
 * on-disk backup are compared too (`fs.copyFile` makes no atomicity or
 * verification guarantee — nodejs.org/api/fs.html). Extracted to one shared
 * helper because the force-overwrite path backs up IRREPLACEABLE user content
 * (not regenerable from canonical, unlike the repair path's managed file) yet
 * previously skipped this verification entirely — the guard sat on the branch
 * protecting the LESS valuable data. Throws `FS_ERROR` naming `operation` on
 * any divergence, so the original is never destroyed while the only local
 * recovery copy is bad.
 */
async function verifyBackup(
  filePath: string,
  bakPath: string,
  sourceContent: string,
  operation: "auto-repair" | "force overwrite",
): Promise<void> {
  const srcStat = await stat(filePath);
  const bakStat = await stat(bakPath);
  if (bakStat.size !== srcStat.size) {
    throw new HatchError(
      `Backup verification failed for ${filePath}: source=${srcStat.size} bytes, backup=${bakStat.size} bytes. ` +
        `Aborting ${operation} to prevent data loss.`,
      1,
      "FS_ERROR",
    );
  }
  const srcHash = createHash("sha256").update(sourceContent, "utf-8").digest("hex");
  const bakBytes = await readFile(bakPath);
  const bakHash = createHash("sha256").update(bakBytes).digest("hex");
  if (srcHash !== bakHash) {
    throw new HatchError(
      `Backup verification failed for ${filePath}: SHA-256 mismatch (source=${srcHash.slice(0, 12)}…, backup=${bakHash.slice(0, 12)}…). ` +
        `Aborting ${operation} to prevent data loss.`,
      1,
      "FS_ERROR",
    );
  }
}

/**
 * D1-SA1.5.1: cross-process lock-acquisition retry schedule when locking is
 * active. D11-SA11.2-03 (Cycle 12, P1): `proper-lockfile` hands these to
 * node-retry, whose per-attempt wait is
 * `min(minTimeout × factor^attempt, maxTimeout)` with `randomize` off
 * (retry@0.12.0 `createTimeout`), so the five waits are
 * 100 + 200 + 400 + 800 + 1500 = 3000ms — a ~3s total backoff before
 * `LOCK_TIMEOUT`. The pre-Cycle-12 prose here claimed "5 retries × 500ms ≈ 5s";
 * that was stale arithmetic from an earlier constants set (no configured
 * constant is 500ms). {@link LOCK_RETRY_TOTAL_BACKOFF_MS} derives the quoted
 * figure from these constants so the user-facing message cannot drift again.
 */
const LOCK_RETRIES = 5;
const LOCK_RETRY_MIN_MS = 100;
const LOCK_RETRY_MAX_MS = 1500;
const LOCK_RETRY_FACTOR = 2;

/**
 * Total worst-case backoff wait (ms) across the retry schedule above —
 * the figure the `LOCK_TIMEOUT` refusal quotes. Derived from the constants
 * (D11-SA11.2-03) rather than hand-written, so changing the schedule updates
 * the message automatically. Exported for the message-accuracy regression
 * test only; evaluates to 3000 for the current schedule.
 */
export const LOCK_RETRY_TOTAL_BACKOFF_MS = Array.from(
  { length: LOCK_RETRIES },
  (_, attempt) => Math.min(LOCK_RETRY_MIN_MS * LOCK_RETRY_FACTOR ** attempt, LOCK_RETRY_MAX_MS),
).reduce((sum, wait) => sum + wait, 0);
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
 * Who holds an in-process lock entry (D1-SA1.5-03, Cycle 12).
 *
 * - `"external"` — an exported {@link acquireWriteLock} caller holding a
 *   multi-step critical section open (`configCommand`, `mcp`, workspace
 *   manifest/journal writers).
 * - `"internal-write"` — one of this module's own write functions
 *   ({@link atomicWriteFile} or {@link safeWriteFile}) holding the lock for
 *   the duration of a single write (or read-merge-write).
 */
type LockHolderKind = "external" | "internal-write";

interface HeldLockEntry {
  kind: LockHolderKind;
  /** Wake callbacks for same-process acquirers queued on this path (FIFO-ish:
   *  release wakes all; the first to run reserves, the rest re-queue with
   *  their original deadline). */
  waiters: Array<() => void>;
}

/**
 * F1.2-H1 (Cycle 10) / D1-SA1.5-03 (Cycle 12): in-process lock table for
 * paths whose cross-process advisory lock is currently held by THIS Node
 * process.
 *
 * The pre-Cycle-12 form was a bare `Set<string>`: ANY second acquire on a
 * held path — including a concurrent SIBLING task that is not in the
 * holder's call chain — short-circuited to a no-op release. That silently
 * bypassed mutual exclusion in-process, and once the true holder released
 * (deleting the on-disk lock), another process could acquire while the
 * sibling kept writing. Reentrancy is now scoped by holder kind instead of
 * bare path membership:
 *
 * - An EXTERNAL acquire on a held path always QUEUES until release (bounded
 *   by {@link IN_PROCESS_LOCK_WAIT_MS}, then `LOCK_TIMEOUT`) — a sibling
 *   task no longer bypasses the lock.
 * - An INTERNAL-WRITE acquire on a path held by an EXTERNAL holder returns a
 *   no-op release. That is the F1.2-H1 nested-write shape (`configCommand`
 *   holds the manifest lock, then `writeManifest -> atomicWriteFile`
 *   re-enters on the same path): the nested write is awaited inside the
 *   holder's critical section, so the outer holder owns the lifecycle and
 *   no overlap is possible.
 * - An INTERNAL-WRITE acquire on a path held by another INTERNAL-WRITE
 *   holder QUEUES: two concurrent `atomicWriteFile`/`safeWriteFile` calls on
 *   one path now genuinely serialize (the documented "HATCH3R_LOCK=1
 *   serializes same-path writes" contract, previously false in-process).
 *
 * `safeWriteFile` passes its already-held lock to its own internal writes by
 * calling {@link atomicWriteFileUnlocked} directly (explicit lock-handle
 * passing), so the internal-write queue can never deadlock on that nested
 * shape.
 */
const HELD_LOCKS = new Map<string, HeldLockEntry>();

/**
 * Ceiling for a same-process queue wait on a held path. Sits just above the
 * ~3s cross-process retry budget of {@link acquireWriteLock}
 * ({@link LOCK_RETRY_TOTAL_BACKOFF_MS}; D11-SA11.2-03 corrected the budget
 * figure — this in-process ceiling stays 5s) so in-process and
 * cross-process contention surface the same `LOCK_TIMEOUT` disposition —
 * e.g. a sibling task queued behind `configCommand`'s interactive hold times
 * out exactly like a second PROCESS retrying against the on-disk lockfile.
 */
const IN_PROCESS_LOCK_WAIT_MS = 5_000;

/**
 * Wait until `filePath` has no in-process holder, then reserve it for
 * `kind`. The free-check and the reservation happen in one synchronous step
 * (no `await` between them), so two woken waiters cannot both claim the
 * path. Throws a `LOCK_TIMEOUT` {@link HatchError} when the wait exceeds
 * {@link IN_PROCESS_LOCK_WAIT_MS}; re-queued waiters keep their ORIGINAL
 * deadline, so total wait stays bounded.
 */
async function reserveInProcessLock(filePath: string, kind: LockHolderKind): Promise<void> {
  const deadline = Date.now() + IN_PROCESS_LOCK_WAIT_MS;
  for (;;) {
    const held = HELD_LOCKS.get(filePath);
    if (held === undefined) {
      HELD_LOCKS.set(filePath, { kind, waiters: [] });
      return;
    }
    const remainingMs = deadline - Date.now();
    const woken =
      remainingMs > 0 &&
      (await new Promise<boolean>((resolveWake) => {
        const timer = setTimeout(() => resolveWake(false), remainingMs);
        held.waiters.push(() => {
          clearTimeout(timer);
          resolveWake(true);
        });
      }));
    if (!woken) {
      throw new HatchError(
        `Timed out waiting for the in-process write lock on ${filePath} after ~${Math.round(IN_PROCESS_LOCK_WAIT_MS / 1000)}s. ` +
          `Another task in this hatch3r process is writing to the same file. ` +
          `Await same-path writes sequentially, or re-run the command.`,
        1,
        "LOCK_TIMEOUT",
      );
    }
  }
}

/** Drop the in-process reservation for `filePath` and wake every queued
 *  waiter. Called AFTER the on-disk lock is released so a woken waiter's
 *  `proper-lockfile` acquire does not collide with our still-live lockfile. */
function releaseInProcessLock(filePath: string): void {
  const entry = HELD_LOCKS.get(filePath);
  HELD_LOCKS.delete(filePath);
  if (entry) {
    for (const wake of entry.waiters) wake();
  }
}

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
 * the retry budget (~3s — {@link LOCK_RETRY_TOTAL_BACKOFF_MS}).
 *
 * D1-SA1.5-F9 (Cycle 10, P6): a held lock is considered stale (and stealable
 * by another process) after {@link LOCK_STALE_DEFAULT_MS} (15s) by default.
 * That ceiling can be too low for multi-MB writes on slow filesystems; raise
 * it via `HATCH3R_LOCK_STALE_MS=<ms>` (see {@link resolveLockStaleMs}).
 *
 * F1.2-H1 (Cycle 10) / D1-SA1.5-03 (Cycle 12): exported so multi-step
 * read-modify-write critical sections (e.g. `configCommand`) can hold the
 * lock across the full interactive window. A second EXTERNAL acquire on an
 * already-held `filePath` — including a concurrent sibling task in the same
 * process — QUEUES until the holder releases (bounded by
 * {@link IN_PROCESS_LOCK_WAIT_MS}, then `LOCK_TIMEOUT`); it no longer
 * returns a mutual-exclusion-bypassing no-op. Reentrancy is reserved for
 * this module's own nested writes: `atomicWriteFile` invoked INSIDE a held
 * external critical section (`writeManifest -> atomicWriteFile`) still
 * no-ops so the outer holder owns the lifecycle — see {@link HELD_LOCKS}.
 */
export async function acquireWriteLock(filePath: string): Promise<() => Promise<void>> {
  return acquireWriteLockImpl(filePath, "external");
}

/**
 * Shared acquire core. `kind` selects the reentrancy rule documented on
 * {@link HELD_LOCKS}: `"external"` acquires always queue behind a holder;
 * `"internal-write"` acquires no-op when the holder is an external critical
 * section (the F1.2-H1 nested-write shape) and queue behind another
 * internal-write holder (sibling write serialization). Module-private on
 * purpose — the public {@link acquireWriteLock} surface stays option-free so
 * callers cannot opt into the reentrant bypass.
 */
async function acquireWriteLockImpl(
  filePath: string,
  kind: LockHolderKind,
): Promise<() => Promise<void>> {
  if (!isLockingEnabled()) {
    return async () => { /* locking disabled */ };
  }
  const held = HELD_LOCKS.get(filePath);
  if (held !== undefined && kind === "internal-write" && held.kind === "external") {
    // F1.2-H1: nested write inside a held external critical section — the
    // outer holder owns the lifecycle and awaits this write before releasing.
    return async () => { /* outer scope holds the real lock */ };
  }
  // D1-SA1.5-03: queue behind any other in-process holder instead of
  // returning a mutual-exclusion-bypassing no-op release.
  await reserveInProcessLock(filePath, kind);
  // proper-lockfile's `lock()` requires the target to exist; we may be
  // creating a new file, so put the lock file beside it instead.
  const lockfilePath = filePath + ".hatch3r.lock";
  try {
    // Ensure parent directory exists so the lockfile can be created.
    await mkdir(dirname(filePath), { recursive: true });
    const release = await properLockfile.lock(filePath, {
      lockfilePath,
      realpath: false,
      stale: resolveLockStaleMs(),
      retries: {
        retries: LOCK_RETRIES,
        minTimeout: LOCK_RETRY_MIN_MS,
        maxTimeout: LOCK_RETRY_MAX_MS,
        factor: LOCK_RETRY_FACTOR,
      },
    });
    return async () => {
      try {
        await release();
      } finally {
        // Wake queued waiters only after the on-disk lock is gone so their
        // immediate re-acquire cannot collide with our live lockfile.
        releaseInProcessLock(filePath);
      }
    };
  } catch (err) {
    releaseInProcessLock(filePath);
    // proper-lockfile surfaces contention as ELOCKED once retries are exhausted.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOCKED") {
      // D11-SA11.2-03: the quoted wait is DERIVED from the retry constants
      // (100+200+400+800+1500 = 3000ms → "~3s"), so the message stays honest
      // if the schedule changes. The prior hand-written "~5s" overstated the
      // real wait by ~2s.
      throw new HatchError(
        `Timed out acquiring file lock on ${filePath} after ~${Math.round(LOCK_RETRY_TOTAL_BACKOFF_MS / 1000)}s. ` +
          `Another hatch3r process is writing to the same file. ` +
          `Re-run sequentially, or remove a stale ${lockfilePath} if no process is active.`,
        1,
        "LOCK_TIMEOUT",
      );
    }
    throw err;
  }
}

// D8-SA8.2-F8.2.7 / D8-SA8.2-03: the errno → actionable-message table
// (ENOSPC/EACCES/EDQUOT/EROFS/EFBIG/EMFILE/ENFILE/EIO, plus ENOENT per
// D1-SA1.5-10) lives in `./fsErrors.ts` and is applied via {@link mapFsErrno}
// at every write-side call site in this module: the tmp+rename writer's
// catch, the `safeWriteFile` entry `mkdir`, and both `.bak` backup
// `copyFile` calls.

/**
 * Errnos tolerated when fsync-ing the parent directory of a just-renamed file.
 * - EPERM / ENOTSUP / EINVAL: filesystem/OS rejects fdatasync on the directory
 *   fd (FAT32, some network mounts) — matches the tmp-file datasync guard.
 * - EISDIR: a platform that surfaces "this is a directory" rather than honoring
 *   datasync on a directory fd.
 * - EBADF: a platform that opened the directory but does not back a real fd for
 *   datasync.
 * On Windows, `open(dir)` itself rejects (EISDIR/EPERM/EACCES depending on the
 * runtime) and is swallowed at the open call site — the rename is already atomic
 * there, so the directory sync is a no-op upgrade we skip rather than fail on.
 */
const DIR_SYNC_TOLERATED_ERRNOS = new Set(["EPERM", "ENOTSUP", "EINVAL", "EISDIR", "EBADF"]);

/**
 * D11-5 (Cycle 11 Wave 2, P5): persist a directory-entry change (a rename) to
 * stable storage by opening the parent directory and `datasync()`-ing its fd.
 *
 * POSIX makes `rename(2)` atomic but does NOT guarantee the new directory entry
 * is durable until the directory itself is fsync'd. `atomicWriteFile` already
 * datasyncs the tmp file's DATA before the rename; this closes the second half
 * of the durable-replace contract by syncing the DIRECTORY after the rename, so
 * a crash cannot leave the entry pointing at the pre-rename state.
 *
 * Best-effort by design — see {@link DIR_SYNC_TOLERATED_ERRNOS}. Any tolerated
 * errno (and a failure to open the directory at all, e.g. on Windows) is
 * swallowed because the atomic rename already provides complete-or-nothing
 * safety; the directory sync only upgrades durability across a crash. An
 * unrecognised errno re-throws so a genuinely broken filesystem still surfaces.
 *
 * Exported (D8-SA8.2-01, Cycle 12) so capture-side writers outside this module
 * can close the same durability gap: `snapshot.ts::createSnapshot`'s mirror
 * loop writes rollback-store content with plain `writeFile` while the
 * `meta.json` manifest that references it IS durably written — routing the
 * mirror writes through {@link atomicWriteFile}, or `fdatasync`-ing each
 * mirror fd plus one `syncParentDirectory(filesDir)` after the capture loop,
 * makes the referenced bytes at least as durable as the manifest indexing
 * them. Pass the path of a FILE inside the directory to sync (the function
 * syncs `dirname(filePath)`).
 */
export async function syncParentDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  let dh: Awaited<ReturnType<typeof open>>;
  try {
    // A directory fd must be opened read-only ("r"); "r+" is rejected for
    // directories on POSIX. Opening a directory is unsupported on Windows, where
    // this rejects — tolerate that the same way as a rejected datasync.
    dh = await open(dir, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && DIR_SYNC_TOLERATED_ERRNOS.has(code)) return;
    throw err;
  }
  try {
    await dh.datasync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !DIR_SYNC_TOLERATED_ERRNOS.has(code)) throw err;
  } finally {
    await dh.close();
  }
}

/**
 * Write a file via tmp+rename. The guarantee is scoped precisely (D11-13,
 * Cycle 11 Wave 3, P5): atomic VISIBILITY comes from the rename — a reader sees
 * either the old file or the new file's complete bytes, never a torn write. The
 * tmp file's DATA is fdatasync'd before the rename, and the parent directory is
 * fsync'd after it (best-effort — see the **Durability** section and
 * {@link syncParentDirectory}; a platform/filesystem that rejects the directory
 * fdatasync, e.g. Windows or FAT32, downgrades the guarantee from "atomic AND
 * crash-durable" to "atomic"). This is NOT a generic disk-flush of every cached
 * write — only the tmp file and its parent directory are synced.
 *
 * **Concurrency:** By default this function does not use file locking. Two
 * hatch3r processes writing the same target path concurrently can silently
 * clobber one another. Set `HATCH3R_LOCK=1` to opt into cross-process file
 * locking via `proper-lockfile` (D1-SA1.5.1). Locking is gated behind the env
 * var to keep the default behavior unchanged for single-process flows.
 *
 * **Ordering (D3-SA3.4-F9, Cycle 10 Wave 4, P2; D1-SA1.5-03, Cycle 12):**
 * WITHOUT locking, the ordering of CONCURRENT writes to the same path is
 * UNSPECIFIED. POSIX `rename(2)` is atomic per call (no torn content — a
 * reader always sees one writer's complete bytes), but the OS does not
 * guarantee that overlapping `rename` calls land in submission order. With
 * `Promise.all([write(A), write(B)])` the final on-disk content is A or B,
 * not deterministically the last-submitted. Callers that require
 * last-write-wins MUST serialize: either `await` each write before the next,
 * or enable locking (`HATCH3R_LOCK=1`) — with locking enabled, concurrent
 * same-path calls queue on the in-process lock table (and on the on-disk
 * lockfile across processes), so each write completes before the next
 * begins. SEQUENTIALLY-awaited writes always observe submission order.
 *
 * When locking is enabled and contention exceeds ~3s
 * ({@link LOCK_RETRY_TOTAL_BACKOFF_MS}), throws {@link HatchError} with code
 * `LOCK_TIMEOUT`.
 *
 * **Parent directories (D1-SA1.5-10, Cycle 12):** a missing parent directory
 * is created automatically (`mkdir -p` semantics) in EVERY lock mode — on
 * ENOENT the writer creates `dirname(filePath)` and retries the tmp write
 * once. Before this, auto-creation was a side effect of lock acquisition, so
 * it applied only when locking was active.
 *
 * Write-side filesystem failures (ENOSPC, EACCES, EDQUOT, EROFS, EFBIG, EMFILE,
 * ENFILE, EIO, and residual ENOENT) are mapped to actionable `FS_ERROR`
 * HatchErrors via {@link mapFsErrno} (`fsErrors.ts`); unrecognised errnos
 * re-throw unchanged (D8-SA8.2-F8.2.7, P1; extracted per D8-SA8.2-03).
 *
 * **Binary content (D8-3, Cycle 11 Wave 2, CQ4):** `content` accepts a `Buffer`
 * as well as a `string`. A string is encoded UTF-8 (unchanged prior behavior);
 * a Buffer is written verbatim, byte-for-byte. This makes the writer lossless
 * for arbitrary bytes ≥ 0x80, which a `string` re-encode would corrupt into
 * U+FFFD. Callers restoring captured user content — `snapshot.ts` rollback —
 * pass the original Buffer so non-UTF-8 files survive a round-trip intact.
 *
 * **Durability (D11-5, Cycle 11 Wave 2, P5):** the durable complete-or-nothing
 * replace is a two-step fsync. `fh.datasync()` on the tmp file persists the file
 * DATA before the rename. After the rename, {@link syncParentDirectory} opens the
 * parent directory and `datasync()`s it to persist the DIRECTORY ENTRY change
 * (the rename itself). Without the directory sync, a crash between the rename and
 * the next periodic writeback could leave the directory inode pointing at the old
 * name (or no name) even though the file data was synced — the classic
 * rename-without-dir-fsync durability gap (POSIX leaves directory-entry durability
 * to a separate fsync of the directory fd). Both syncs are best-effort: a
 * filesystem or platform that rejects the operation (Windows cannot open a
 * directory as an fd; FAT32/network mounts may reject fdatasync) does not fail the
 * write, because the atomic rename already gives the complete-or-nothing
 * guarantee; the directory sync only upgrades it from "atomic" to "atomic AND
 * durable across a crash". Tolerated errnos: EPERM/ENOTSUP/EINVAL/EISDIR/EBADF.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string | Buffer,
): Promise<void> {
  // D1-SA1.5-03: internal-write acquire — no-ops under an external critical
  // section (writeManifest-under-configCommand), queues behind sibling writes.
  const release = await acquireWriteLockImpl(filePath, "internal-write");
  try {
    await atomicWriteFileUnlocked(filePath, content);
  } finally {
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

/**
 * Core tmp+rename writer WITHOUT lock acquisition — the write body of
 * {@link atomicWriteFile}. Called directly by {@link safeWriteFile}, which
 * already holds the path's write lock across its whole read-merge-write
 * (explicit lock-handle passing, D1-SA1.5-04), so the nested write must not
 * re-acquire — re-acquiring would queue behind the caller's own
 * internal-write hold and deadlock. Every guarantee documented on
 * {@link atomicWriteFile} except locking applies here verbatim.
 */
async function atomicWriteFileUnlocked(
  filePath: string,
  content: string | Buffer,
): Promise<void> {
  const tmpPath = filePath + ".tmp." + randomBytes(4).toString("hex");
  // A Buffer is written verbatim (the "utf-8" encoding arg is ignored for
  // Buffer input by node:fs, but branching keeps the lossless intent
  // explicit); a string is encoded UTF-8 as before.
  const writeTmp = (): Promise<void> =>
    Buffer.isBuffer(content)
      ? writeFile(tmpPath, content)
      : writeFile(tmpPath, content, "utf-8");
  try {
    try {
      await writeTmp();
    } catch (err) {
      // D1-SA1.5-10 (Cycle 12, P2): create a missing parent directory in the
      // WRITE path itself, then retry the tmp write once. Before this, parent
      // creation was a side effect of lock ACQUISITION only —
      // acquireWriteLockImpl short-circuits before its mkdir when locking is
      // disabled — so `atomicWriteFile` auto-created missing parents under
      // HATCH3R_LOCK=1 but surfaced a raw unmapped ENOENT without it: the
      // write contract varied with an unrelated env var. ENOENT-triggered
      // (not an unconditional pre-mkdir) so the existing-parent hot path
      // keeps its syscall count. A second ENOENT (directory removed again
      // mid-write) or an mkdir failure (EACCES, EROFS, …) propagates to the
      // outer catch, which maps it to a guided FS_ERROR via {@link mapFsErrno}.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await mkdir(dirname(filePath), { recursive: true });
      await writeTmp();
    }
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
    // D11-5 (Cycle 11 Wave 2, P5): fsync the parent directory so the rename's
    // directory-entry change is durable, not just atomic. Best-effort — a
    // platform/filesystem that cannot sync a directory fd (Windows, FAT32,
    // some network mounts) is tolerated; the atomic rename already gives
    // complete-or-nothing safety. See {@link syncParentDirectory}.
    await syncParentDirectory(filePath);
  } catch (err) {
    // #239 (D8-8.6) + D8-SA8.2-F8.2.7 (Cycle 10, P1): map known write-side
    // errnos (ENOSPC/EACCES, the EDQUOT/EROFS/EFBIG/EMFILE/ENFILE/EIO family,
    // and residual ENOENT per D1-SA1.5-10) to actionable FS_ERROR messages via
    // {@link mapFsErrno} (fsErrors.ts, extracted per D8-SA8.2-03).
    // Unrecognised errnos re-throw unchanged.
    throw mapFsErrno(err, filePath) ?? err;
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
// D11-SA11.2-02 (Cycle 12): the sweep also reclaims aged `.bak.<8-hex>`
// recovery backups (7-day gate) — the non-clobbering slots both destructive
// recovery paths write, which previously had no cleanup path anywhere.
//
// CALLER CONTRACT (D1-SA1.5-F10, Cycle 10 Wave 4, P6): EVERY CLI command entry
// point that reaches `atomicWriteFile` in-process invokes this at start-of-run
// against the repo root with `{ recursive: true }` and surfaces the returned
// entries via `warn()`. As of Cycle 10 Wave 4 the wiring is COMPLETE for the
// full in-process write surface:
//   - init   (runInitInner)      — safeWriteFile
//   - sync   (syncCommand)       — safeWriteFile (skipped under --dry-run)
//   - update (updateCommand)     — safeWriteFile/atomicWriteFile (skipped under --dry-run)
//   - config (configCommand)     — writeManifest → atomicWriteFile
//   - mcp    (setup/remove)      — writeManifest → atomicWriteFile
//   - cli-tools (cliToolsCommand)— writeManifest → atomicWriteFile
//   - rollback (rollbackCommand) — applyRollback → atomicWriteFile (skipped under --dry-run)
// `clean` reaches `atomicWriteFile` only via `runInit`, which sweeps; `add` is
// a stub that writes nothing; `worktree-setup`/`worktree-cleanup` shell out to
// `npx hatch3r sync` (a child process that sweeps in its own run) rather than
// writing managed files in-process — so none of those needs its own sweep.
// A command that mutates files but never sweeps would let an orphan from a
// prior interrupted run persist indefinitely if the operator never re-runs a
// sweeping command. The sweep is 60s-age-gated ({@link ORPHAN_MIN_AGE_MS}), so
// calling it on entry is safe even when a concurrent write is in flight.
// ──────────────────────────────────────────────────────────────────────────

/** Matches `<basename>.tmp.<exactly-8 hex chars>` — the exact pattern produced
 *  by {@link atomicWriteFile} (`filePath + ".tmp." + randomBytes(4).toString("hex")`,
 *  i.e. 4 bytes → 8 lowercase hex chars). Anchored at end-of-string AND requiring
 *  a non-empty basename before `.tmp.` so a bare `.tmp.deadbeef` (no owning file)
 *  or a 7/9-hex suffix from some other tool is not swept (D8-8 match-tightening). */
const ORPHAN_TMP_SUFFIX_RE = /[^/\\]\.tmp\.[0-9a-f]{8}$/;

/** Minimum age (ms) before a tmp file is treated as an orphan. Younger
 *  files may be in flight from a concurrent atomicWriteFile on another
 *  worker; sweeping them would race and corrupt that write. 60s is
 *  conservative — atomic writes should complete in sub-second on healthy
 *  hardware, so a minute-old tmp file is almost certainly abandoned. */
const ORPHAN_MIN_AGE_MS = 60_000;

/** D11-SA11.2-02 (Cycle 12, P4): matches `<basename>.bak.<exactly-8 hex>` — the
 *  non-clobbering backup slots {@link resolveNonClobberingBakPath} falls back
 *  to when the canonical `<file>.bak` is already taken (both destructive
 *  recovery paths — corruption auto-repair and force-overwrite — produce
 *  them). Same end-anchoring + non-empty-basename + exactly-8-hex tightening
 *  rationale as {@link ORPHAN_TMP_SUFFIX_RE} (D8-8): the canonical
 *  `<file>.bak` deliberately does NOT match — that slot is reclaimed by
 *  `hatch3r clean` and is also a shape users create by hand, so the sweep
 *  touches only the hatch3r-random-suffixed variants that previously had NO
 *  reclamation path at all (clean removes only `f + ".bak"`; the tmp sweep
 *  matched only `.tmp.<8hex>` — every `.bak.<8hex>` leaked permanently). */
const ORPHAN_BAK_SUFFIX_RE = /[^/\\]\.bak\.[0-9a-f]{8}$/;

/** D11-SA11.2-02: minimum age (ms) before a `.bak.<8hex>` recovery backup is
 *  swept — 7 days, deliberately far wider than the 60s tmp gate. These are
 *  convenience copies of a file the operator just recovered (the session
 *  snapshot under `.hatch3r/snapshots` remains the primary recovery path via
 *  `hatch3r rollback`), so the gate must not reclaim a backup an operator is
 *  actively inspecting mid-review; a week covers a review parked over a long
 *  weekend while still bounding the leak. The sweep only runs at the start of
 *  mutating hatch3r commands, so an untouched repo never loses a backup. */
const ORPHAN_BAK_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * D8-8 (Cycle 11 Wave 3, P6): directory names the recursive tmp walk never
 * descends into. The prior implementation handed `{ recursive: true }` straight
 * to `readdir`, which walked the ENTIRE tree from the repo root — including
 * `node_modules/` (tens of thousands of files on a typical repo) on every
 * mutating command, and would have unlinked a by-name `*.tmp.<8hex>` collision
 * anywhere under it (e.g. a dependency's own temp artifact). hatch3r only ever
 * writes tmp files beside its managed outputs (`.cursor/`, `.claude/`, `.github/`,
 * repo-root dotfiles, `.hatch3r/`), none of which live under these directories,
 * so pruning them removes the blast radius AND the per-command full-tree walk
 * cost with zero loss of coverage. `.git`/`.hg`/`.svn` are VCS internals and
 * `dist`/`coverage`/`.next`/`.turbo`/`.cache` are build/test output trees — all
 * off-limits to hatch3r writes. Kept as an internal literal set (not imported
 * from `src/archive/index.ts::TOOL_PATH_PREFIXES`) because that module already
 * imports `atomicWriteFile` from this file; importing back would form a cycle. */
const SWEEP_SKIP_DIRS = new Set<string>([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

/** One candidate discovered by {@link walkTmpCandidates}: an absolute path,
 *  before any age/stat gate is applied. */
interface TmpCandidate {
  fullPath: string;
}

/**
 * Walk `dir` for files whose basename matches one of `suffixPatterns`
 * ({@link ORPHAN_TMP_SUFFIX_RE} and/or {@link ORPHAN_BAK_SUFFIX_RE}),
 * pruning {@link SWEEP_SKIP_DIRS} so noise trees (node_modules, VCS internals,
 * build output) are never entered. Non-recursive by default; `recursive: true`
 * descends via an explicit manual stack rather than `readdir`'s `recursive`
 * option so the prune can skip ENTERING a directory, not merely filter results
 * after the full tree was already read (D8-8).
 *
 * A `readdir` failure on the TOP-LEVEL `dir` rethrows (the caller classifies
 * ENOENT vs. a real error); a failure on a NESTED directory during recursion is
 * swallowed so one unreadable subtree does not abort the whole sweep. Shared by
 * {@link sweepOrphanTmpFiles} and {@link detectConcurrentWriteRisk}.
 */
async function walkTmpCandidates(
  dir: string,
  recursive: boolean,
  suffixPatterns: readonly RegExp[],
): Promise<TmpCandidate[]> {
  const candidates: TmpCandidate[] = [];
  // Manual stack so a skip-dir is never entered. `top` marks the root level:
  // a readdir error there must rethrow for the caller's ENOENT classification,
  // while a nested readdir error is swallowed (one bad subtree ≠ failed sweep).
  const stack: Array<{ path: string; top: boolean }> = [{ path: dir, top: true }];
  while (stack.length > 0) {
    const { path: current, top } = stack.pop()!;
    let dirents;
    try {
      dirents = await readdir(current, { withFileTypes: true });
    } catch (err) {
      if (top) throw err;
      console.error(
        `hatch3r: orphan-tmp sweep could not read ${current}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    for (const ent of dirents) {
      if (ent.isDirectory()) {
        if (!recursive) continue;
        if (SWEEP_SKIP_DIRS.has(ent.name)) continue;
        stack.push({ path: join(current, ent.name), top: false });
        continue;
      }
      if (!ent.isFile()) continue;
      if (!suffixPatterns.some((re) => re.test(ent.name))) continue;
      candidates.push({ fullPath: join(current, ent.name) });
    }
  }
  return candidates;
}

/**
 * One orphan artifact — a `.tmp.<8hex>` writer leftover or an aged
 * `.bak.<8hex>` recovery backup — discovered by {@link sweepOrphanTmpFiles}.
 * Exposed so callers can surface per-file diagnostics, not just a count.
 */
export interface OrphanTmpSweepEntry {
  /** Absolute path to the swept orphan file. */
  path: string;
  /** mtime in ms since epoch when the sweep discovered it. */
  mtimeMs: number;
  /** Whether the sweep succeeded in removing it. */
  removed: boolean;
  /** Populated when `removed === false`. */
  error?: string;
}

/**
 * Sweep orphan write artifacts under a directory tree, removing:
 * - `.tmp.<8-hex>` writer leftovers older than {@link ORPHAN_MIN_AGE_MS}
 *   (60s — a crash between tmp-write and rename orphans them), and
 * - `.bak.<8-hex>` non-clobbering recovery backups older than
 *   {@link ORPHAN_BAK_MIN_AGE_MS} (7 days — D11-SA11.2-02: these previously
 *   leaked forever, since `hatch3r clean` removes only the canonical
 *   `<file>.bak` and this sweep matched only the tmp shape). The canonical
 *   `<file>.bak` is never swept here regardless of age.
 *
 * Returns one entry per swept artifact so the caller can emit a diagnostic
 * per the Silent Failure Contract — the sweep itself is NOT silent.
 *
 * Safe against concurrent in-flight writes: only files past their class's
 * age gate are candidates, so a live atomicWriteFile on another process (or
 * in-flight on this one) — and a recovery backup still inside its operator
 * review window — is never swept.
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
  let candidates: TmpCandidate[];
  try {
    // D8-8: prune SWEEP_SKIP_DIRS during the walk so node_modules/.git/dist are
    // never entered (no full-tree readdir from the repo root, no by-name match
    // on a dependency's own temp file). A top-level readdir failure rethrows
    // from walkTmpCandidates; classify it here.
    candidates = await walkTmpCandidates(dir, options.recursive === true, [
      ORPHAN_TMP_SUFFIX_RE,
      ORPHAN_BAK_SUFFIX_RE,
    ]);
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

  for (const { fullPath } of candidates) {
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      // Disappeared between readdir and stat — treat as already cleaned.
      continue;
    }
    const age = nowMs - fileStat.mtimeMs;
    // D11-SA11.2-02: per-class age gate — a `.bak.<8hex>` recovery backup
    // keeps a 7-day operator review window; a `.tmp.<8hex>` writer leftover
    // is orphaned after 60s. (A path cannot match both suffix shapes.)
    const minAgeMs = ORPHAN_BAK_SUFFIX_RE.test(fullPath)
      ? ORPHAN_BAK_MIN_AGE_MS
      : ORPHAN_MIN_AGE_MS;
    if (age < minAgeMs) continue;
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
 * D11-14 (Cycle 11 Wave 3, P6): detect a likely CONCURRENT in-flight write to a
 * hatch3r-managed tree and return an advisory warning, or `null` when there is
 * no signal. The default single-repo write path takes no cross-process lock
 * ({@link isLockingEnabled} is false unless `HATCH3R_LOCK=1` or a
 * workspace/worktree command enabled the default), so two `hatch3r sync` runs
 * from two shells can last-writer-wins clobber a managed file with no warning.
 * A mutating command calls this at start-of-run; if the warning is non-null it
 * surfaces it via `warn()`.
 *
 * Signal: a `*.tmp.<8hex>` file YOUNGER than {@link ORPHAN_MIN_AGE_MS} — the
 * inverse of the orphan-sweep gate. {@link atomicWriteFile} creates exactly that
 * file immediately before its rename and unlinks it after, so a fresh one means
 * another writer is mid-flight RIGHT NOW (an aged one is a crash orphan the
 * sweep handles, not live contention — those are excluded here). Returns `null`
 * when locking is already active (the lock makes the warning moot) so a
 * workspace run, which serializes internally, stays quiet.
 *
 * Best-effort and never throws: a readdir failure (including ENOENT on a fresh
 * checkout) yields `null`. Shares {@link walkTmpCandidates} with the sweep, so
 * it also prunes {@link SWEEP_SKIP_DIRS} and carries the same near-zero cost.
 */
export async function detectConcurrentWriteRisk(
  dir: string,
  options: { recursive?: boolean; nowMs?: number } = {},
): Promise<string | null> {
  // When a lock is held, overlapping writes serialize — no clobber to warn about.
  if (isLockingEnabled()) return null;
  const nowMs = options.nowMs ?? Date.now();
  let candidates: TmpCandidate[];
  try {
    // Tmp-only on purpose (D11-SA11.2-02): a fresh `.tmp.<8hex>` means a
    // writer is mid-flight RIGHT NOW; a `.bak.<8hex>` recovery backup persists
    // by design inside its review window and is never a contention signal.
    candidates = await walkTmpCandidates(dir, options.recursive === true, [
      ORPHAN_TMP_SUFFIX_RE,
    ]);
  } catch (err) {
    // Best-effort: an unreadable root is not a contention signal, so we return
    // null rather than a false warning. ENOENT (fresh checkout, dir absent) is
    // the expected no-op and stays quiet; any OTHER errno gets a diagnostic per
    // the Silent Failure Contract (CONSTITUTION.md §2 P5) so an operator sees a
    // genuinely broken root rather than a silently-skipped concurrency check.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(
        `hatch3r: concurrency-risk check could not read ${dir}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
  for (const { fullPath } of candidates) {
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }
    const age = nowMs - fileStat.mtimeMs;
    // YOUNG (< gate) ⇒ a live in-flight write. Aged ⇒ a crash orphan the sweep
    // owns; not contention, so it does not raise this warning.
    if (age < ORPHAN_MIN_AGE_MS) {
      return (
        `Another hatch3r write appears to be in flight (fresh temp file ${fullPath}). ` +
        `Concurrent runs against the same repo can clobber managed files last-writer-wins. ` +
        `Pass HATCH3R_LOCK=1 on both runs so each file's read-merge-write serializes under a ` +
        `cross-process lock, or wait for the other run to finish.`
      );
    }
  }
  return null;
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
      `Swept ${removed.length} orphan temp/backup file(s) from prior interrupted runs or old recoveries: ` +
        removed.map((e) => e.path).join(", "),
    );
  }
  if (failed.length > 0) {
    parts.push(
      `Failed to remove ${failed.length} orphan temp/backup file(s); remove manually: ` +
        failed.map((e) => `${e.path} (${e.error ?? "unknown"})`).join(", "),
    );
  }
  return parts.join(". ");
}

/**
 * release/2.6.0 — legacy-generated adoption signatures. hatch3r ≤2.5.x
 * emitted several hook SCRIPTS raw — no HATCH3R:BEGIN/END markers and no
 * `managedContent` (the JS marker variant did not exist yet):
 * `.claude/hooks/pretooluse-allowlist.mjs` plus the Cursor guards
 * (`.cursor/hooks/{subagent,mcp,workdir}-guard.mjs`). Once such an output IS
 * marker-wrapped, the upgrade write reaches the managedContent + no-markers +
 * appendIfNoBlock branch, whose prepend disposition is WRONG for a generated
 * script: splicing the new block above the old copy duplicates the ESM
 * `import` bindings — a SyntaxError on every hook invocation. Every builder in
 * `src/pipeline/agentToolAllowlist.ts` / `src/adapters/cursor.ts` opens with
 * the same two-line header (`#!/usr/bin/env node` + `// hatch3r — <role>`),
 * which no user-authored file legitimately claims, so that header identifies
 * regenerable hatch3r output: replace it wholesale instead of preserving it.
 * The shebang is optional in the signature so a headerless-shebang builder
 * added later still matches; `\r?` tolerates CRLF checkouts.
 */
const LEGACY_GENERATED_NO_MARKER_SIGNATURES: readonly RegExp[] = [
  /^(#!\/usr\/bin\/env node\r?\n)?\/\/ hatch3r — /,
];

/**
 * True when a marker-less existing file is recognizable as hatch3r-generated
 * output from a release that emitted it raw — see
 * {@link LEGACY_GENERATED_NO_MARKER_SIGNATURES}. Consulted by the
 * managedContent + no-markers + appendIfNoBlock branch of
 * {@link safeWriteFile} (and mirrored by {@link predictMergeAction} /
 * {@link predictDenyRefusal}): a match REPLACES the file with the incoming
 * marker-wrapped content instead of prepend-splicing, which would keep a
 * stale duplicate of the script body below the block.
 */
export function isLegacyGeneratedNoMarkerFile(existingContent: string): boolean {
  return LEGACY_GENERATED_NO_MARKER_SIGNATURES.some((re) => re.test(existingContent));
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
 *   - existing has no managed block + `appendIfNoBlock` + recognized legacy
 *     hatch3r-generated file ({@link isLegacyGeneratedNoMarkerFile}) → would
 *     REPLACE wholesale; `unchanged` when the incoming bytes already match,
 *     else `updated`.
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
 * live write (throws) rather than producing an action, and this predictor
 * reports the disposition category, not the security verdict. The
 * security-refusal axis has its own predictor — {@link predictDenyRefusal}
 * (D11-SA11.2-01) — which dry-run callers run alongside this one, rendering
 * its non-null result as a `refused` row instead of the action predicted
 * here. `skipIfUnchanged` defaults to `true` to match {@link safeWriteFile}.
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
    if (!hasManagedBlock(existingContent, filePath)) {
      if (options.appendIfNoBlock) {
        // Mirror the live legacy-generated adoption branch (release/2.6.0):
        // a recognized hatch3r-generated marker-less file is REPLACED, not
        // prepend-spliced, so predict against the full incoming bytes.
        if (isLegacyGeneratedNoMarkerFile(existingContent)) {
          if (skipIfUnchanged && content === existingContent) return "unchanged";
          return "updated";
        }
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
    // Mirror the live branch's slash-picker stub heal (release/2.6.0): a file
    // whose healable prefix (empty or pure-frontmatter stub) differs from the
    // freshly generated prefix is rewritten by the live write, so predicting
    // "unchanged" from the block-only merge would re-open the
    // preview-vs-reality gap this predictor exists to close.
    const incomingSplit = splitAtManagedBlock(content, filePath);
    if (incomingSplit && incomingSplit.prefix.trim() !== "") {
      const mergedSplit = splitAtManagedBlock(merged, filePath);
      if (
        mergedSplit &&
        mergedSplit.prefix !== incomingSplit.prefix &&
        isHealableManagedPrefix(mergedSplit.prefix)
      ) {
        merged = incomingSplit.prefix + mergedSplit.rest;
      }
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

// ──────────────────────────────────────────────────────────────────────────
// D1-SA1.5-07 (Cycle 12): reviewed false-positive escape for the write-time
// deny scan.
//
// The deny patterns include credential- and prose-shaped regexes that the
// framework's own canonical documentation has tripped (see the D1-7-fix
// comment in safeWriteFile's existing-markers branch). Before this escape, a
// benign hit permanently blocked the affected adapter's sync/update with no
// sanctioned path except deleting one's own documentation — and the error
// text advised moving the text INTO the managed block, which the next merge
// deletes (insertManagedBlock replaces the whole block interior).
//
// `.hatch3r/deny-scan-allowlist.json` at the repo root records reviewed
// exceptions: `{ "entries": [{ "file": "<root-relative path>",
// "patternHash": "<16-hex hash printed in the refusal error>",
// "justification": "<non-empty reviewer rationale>" }] }` (a bare top-level
// array is also accepted). An exception is scoped to ONE file AND ONE exact
// finding (the hash covers the pattern class and the matched text), so it
// cannot blanket-disable the scan. Fail-closed at every step: no repo root
// found, missing/unreadable/malformed allowlist, or a non-matching entry all
// leave the refusal in place. Every allowlisted hit is reported loudly on
// the diagnostic channel so the exception stays visible per the Silent
// Failure Contract (CONSTITUTION §2 P5).
// ──────────────────────────────────────────────────────────────────────────

/** Allowlist filename under the repo-root `.hatch3r/` directory. */
const DENY_SCAN_ALLOWLIST_FILE = "deny-scan-allowlist.json";

/** Upper bound on the upward directory walk when locating the repo root. */
const HATCH3R_ROOT_WALK_CAP = 30;

interface DenyScanAllowlistEntry {
  /** Path of the guarded file, relative to the repo root (absolute also accepted). */
  file: string;
  /** 16-hex prefix of sha256(finding string) — printed in the refusal error. */
  patternHash: string;
  /** Reviewer rationale; must be non-empty for the entry to be honored. */
  justification: string;
}

/** Stable identity of one deny-scan finding: 16-hex prefix of its SHA-256.
 *  The finding string embeds both the pattern class and the matched text
 *  (`Denied pattern found: "<match>"`), so the hash pins the exception to
 *  that exact snippet in that file — a different injection never matches a
 *  benign entry's hash. */
function denyFindingHash(finding: string): string {
  return createHash("sha256").update(finding, "utf-8").digest("hex").slice(0, 16);
}

/** Walk upward from the target file looking for `.hatch3r/hatch.json` (the
 *  initialized-repo marker). Returns the repo root or null after
 *  {@link HATCH3R_ROOT_WALK_CAP} levels / filesystem root. */
async function findHatch3rRoot(filePath: string): Promise<string | null> {
  let dir = resolve(dirname(filePath));
  for (let i = 0; i < HATCH3R_ROOT_WALK_CAP; i++) {
    if (await fileExists(join(dir, ".hatch3r", "hatch.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function isValidAllowlistEntry(value: unknown): value is DenyScanAllowlistEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.file === "string" && entry.file.length > 0 &&
    typeof entry.patternHash === "string" && entry.patternHash.length > 0 &&
    typeof entry.justification === "string" && entry.justification.trim().length > 0
  );
}

interface DenyScanDisposition {
  /** Findings with no matching reviewed exception — the write must refuse. */
  blocked: string[];
  /** Findings covered by a reviewed exception, with its justification. */
  allowed: Array<{ finding: string; justification: string }>;
}

/**
 * Split deny-scan findings for `filePath` into blocked vs reviewed-exception
 * sets per `.hatch3r/deny-scan-allowlist.json`. Runs only AFTER a deny hit
 * (zero cost on clean writes). Fail-closed: any lookup failure returns all
 * findings as blocked.
 */
async function applyDenyScanAllowlist(
  filePath: string,
  findings: string[],
): Promise<DenyScanDisposition> {
  const rootDir = await findHatch3rRoot(filePath);
  if (rootDir === null) return { blocked: findings, allowed: [] };
  const allowlistPath = join(rootDir, ".hatch3r", DENY_SCAN_ALLOWLIST_FILE);
  let entries: DenyScanAllowlistEntry[];
  try {
    const parsed: unknown = JSON.parse(await readFile(allowlistPath, "utf-8"));
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(list)) return { blocked: findings, allowed: [] };
    entries = list.filter(isValidAllowlistEntry);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Unreadable/malformed allowlist: fail closed AND say so, per the
      // Silent Failure Contract — a reviewer who wrote an exception needs to
      // know it was not honored.
      console.error(
        `hatch3r: could not read deny-scan allowlist ${allowlistPath}: ` +
          `${err instanceof Error ? err.message : String(err)} — treating it as absent (fail-closed).`,
      );
    }
    return { blocked: findings, allowed: [] };
  }
  const resolvedTarget = resolve(filePath);
  const blocked: string[] = [];
  const allowed: Array<{ finding: string; justification: string }> = [];
  for (const finding of findings) {
    const hash = denyFindingHash(finding);
    const entry = entries.find(
      (e) => e.patternHash === hash && resolve(rootDir, e.file) === resolvedTarget,
    );
    if (entry) allowed.push({ finding, justification: entry.justification });
    else blocked.push(finding);
  }
  return { blocked, allowed };
}

/** Loud per-hit diagnostic for reviewed exceptions — an allowlisted deny
 *  match must never pass silently. */
function reportAllowlistedDenyFindings(
  filePath: string,
  allowed: Array<{ finding: string; justification: string }>,
): void {
  for (const { finding, justification } of allowed) {
    console.error(
      `hatch3r: deny-scan match in ${filePath} permitted by a reviewed allowlist exception ` +
        `(.hatch3r/${DENY_SCAN_ALLOWLIST_FILE}; justification: ${justification}): ${finding}`,
    );
  }
}

/** Format blocked findings for the refusal error, appending the allowlist
 *  hash each finding would need — the printed hash is what a reviewer copies
 *  into `patternHash`. */
function formatBlockedDenyFindings(blocked: string[]): string {
  return blocked
    .map((f) => `${f} (allowlist patternHash: ${denyFindingHash(f)})`)
    .join("; ");
}

/**
 * Shared remediation tail for both write-time deny refusals. The pre-Cycle-12
 * text advised moving a false positive INTO the hatch3r-managed block — advice
 * that destroyed the moved text on the next sync, because insertManagedBlock
 * replaces the entire block interior with canonical content on every merge.
 */
const DENY_REFUSAL_REMEDY =
  `Review the file for prompt-injection or instruction-override content, remove the offending text, then re-run the command. ` +
  `If this is a false positive: rewrite the flagged text so it no longer matches (quote it or break up the key/value shape), ` +
  `or record a reviewed exception in .hatch3r/${DENY_SCAN_ALLOWLIST_FILE} ` +
  `(shape: {"entries":[{"file":"<repo-root-relative path>","patternHash":"<hash printed above>","justification":"<why this is safe>"}]}), ` +
  `or open an issue with the matching snippet. ` +
  `Do NOT move the text inside the HATCH3R:BEGIN/END markers — the managed block is regenerated on every sync, which deletes anything placed inside it.`;

/** Build the appendIfNoBlock (first-splice) deny-refusal message. Single
 *  source for the live throw in `safeWriteFileLocked` AND the preview from
 *  {@link predictDenyRefusal} (D11-SA11.2-01), so a dry-run refusal row is
 *  byte-identical to the live error. */
function spliceDenyRefusalMessage(filePath: string, blocked: string[]): string {
  return (
    `Refusing to splice managed block into ${filePath}: existing file content contains denied pattern(s): ${formatBlockedDenyFindings(blocked)}. ` +
    DENY_REFUSAL_REMEDY
  );
}

/** Build the existing-markers deny-refusal message — same single-sourcing
 *  contract as {@link spliceDenyRefusalMessage}. */
function updateDenyRefusalMessage(filePath: string, blocked: string[]): string {
  return (
    `Refusing to update ${filePath}: content outside the hatch3r-managed block contains denied pattern(s): ${formatBlockedDenyFindings(blocked)}. ` +
    DENY_REFUSAL_REMEDY
  );
}

/**
 * D11-SA11.2-01 (Cycle 12, P1): predict whether {@link safeWriteFile} would
 * REFUSE the write outright — throw `VALIDATION_ERROR` on a deny-pattern hit —
 * for these inputs, WITHOUT writing anything. Returns the exact refusal
 * message the live write would throw, or `null` when no refusal would occur.
 *
 * Companion to {@link predictMergeAction}: that predictor is pure over the
 * merge-DISPOSITION axis (created/updated/skipped/unchanged) and is
 * deliberately deny-blind, so `sync --dry-run` previewed `updated` for a file
 * the live sync then hard-failed on — the exact preview-vs-reality divergence
 * the predictor exists to eliminate, surviving for the security-refusal case.
 * Dry-run callers run BOTH: a non-null result here renders as a distinct
 * `refused` row instead of the predicted merge action.
 *
 * Mirrors `safeWriteFileLocked` branch-for-branch, including the reviewed
 * allowlist consultation (read-only disk I/O — hence async), so a repo whose
 * `.hatch3r/deny-scan-allowlist.json` covers the hit previews as writable,
 * not refused:
 * - file absent, or no `managedContent` → the live write never deny-scans
 *   (the force path guards with a `.bak`, not a scan) → `null`.
 * - `managedContent` + no markers + `appendIfNoBlock` → the live path scans
 *   the ENTIRE existing body before splicing (C9-H41) — except a recognized
 *   legacy hatch3r-generated file ({@link isLegacyGeneratedNoMarkerFile}),
 *   which the live path replaces wholesale without preserving (or scanning)
 *   any existing byte → `null`.
 * - `managedContent` + no markers, no `appendIfNoBlock` → live returns
 *   `skipped` without scanning → `null`.
 * - `managedContent` + markers present → the live path scans the
 *   out-of-block slice (`extractCustomContent`, D1-7).
 *
 * Unlike the live path this predictor does NOT emit the loud per-hit
 * allowlist diagnostics — the live run reports them when it executes.
 */
export async function predictDenyRefusal(
  existingContent: string | null,
  filePath: string,
  options: { managedContent?: string; appendIfNoBlock?: boolean } = {},
): Promise<string | null> {
  if (existingContent === null || !options.managedContent) return null;
  if (!hasManagedBlock(existingContent, filePath)) {
    if (!options.appendIfNoBlock) return null;
    // Mirror the live legacy-generated adoption branch (release/2.6.0): a
    // recognized hatch3r-generated marker-less file is replaced wholesale —
    // nothing from it is preserved, so the live path never deny-scans it.
    if (isLegacyGeneratedNoMarkerFile(existingContent)) return null;
    const denied = scanForDeniedPatterns(existingContent);
    if (denied.length === 0) return null;
    const disposition = await applyDenyScanAllowlist(filePath, denied);
    if (disposition.blocked.length === 0) return null;
    return spliceDenyRefusalMessage(filePath, disposition.blocked);
  }
  const customContent = extractCustomContent(existingContent, filePath);
  const denied = customContent ? scanForDeniedPatterns(customContent) : [];
  if (denied.length === 0) return null;
  const disposition = await applyDenyScanAllowlist(filePath, denied);
  if (disposition.blocked.length === 0) return null;
  return updateDenyRefusalMessage(filePath, disposition.blocked);
}

/** Options accepted by {@link safeWriteFile}. */
export interface SafeWriteFileOptions {
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
}

/**
 * Safely write or merge a file, preserving user content outside managed blocks.
 *
 * **Concurrency + locking scope (D1-SA1.5-04, Cycle 12):** when locking is
 * enabled (`HATCH3R_LOCK=1` or a workspace/worktree default), the lock is
 * acquired at FUNCTION ENTRY and held across the FULL read-merge-write — not
 * just the final write — so the merge decision is never computed from a
 * pre-lock stale read. Two concurrent runs with locking enabled therefore
 * serialize each file's whole read-merge-write, and content written by one
 * run (or a third writer) between the other's read and write is no longer
 * silently clobbered. Internal writes go through the already-held lock
 * (explicit lock-handle passing to {@link atomicWriteFileUnlocked}). A path
 * already held by an EXTERNAL critical section (e.g. `configCommand`) is
 * entered without re-acquiring — the outer holder owns the lifecycle. By
 * default (no locking), no cross-process lock is taken — running multiple
 * hatch3r processes against the same target is unsupported and may clobber
 * output. Workspace sync already processes repos sequentially internally, so
 * a single `hatch3r sync --repos` invocation is safe without the opt-in.
 *
 * **Ordering (D3-SA3.4-F9, Cycle 10 Wave 4, P2; D1-SA1.5-03, Cycle 12):**
 * without locking, inherits the unspecified concurrent-write ordering of
 * {@link atomicWriteFile}. With locking enabled, concurrent same-path
 * `safeWriteFile` calls queue in submission order (in-process lock table +
 * on-disk lockfile), so each read-merge-write completes before the next
 * begins. Serialize (await each write, or enable locking) when
 * last-write-wins matters.
 */
export async function safeWriteFile(
  filePath: string,
  content: string,
  options: SafeWriteFileOptions = {},
): Promise<MergeResult> {
  const skipIfUnchanged = options.skipIfUnchanged ?? true;
  // D8-SA8.2-03 (Cycle 12, P1): this mkdir runs BEFORE any atomicWriteFile,
  // so a parent-directory-creation failure (EACCES on the parent, EROFS on a
  // read-only mount, ENOSPC/EDQUOT) previously surfaced as a raw Node error
  // while the identical root condition one step later got a guided message.
  // Map it through the same actionable-error table.
  try {
    await mkdir(dirname(filePath), { recursive: true });
  } catch (err) {
    throw mapFsErrno(err, filePath) ?? err;
  }

  // D1-SA1.5-04: take the write lock BEFORE the existence check and content
  // read so the whole read-merge-write is one critical section. No-op when
  // locking is disabled; no-op (without re-acquiring) when an external
  // critical section already holds this path.
  const release = await acquireWriteLockImpl(filePath, "internal-write");
  try {
    return await safeWriteFileLocked(filePath, content, options, skipIfUnchanged);
  } finally {
    // Silent Failure Contract: log if release throws; do not mask the original error.
    try {
      await release();
    } catch (releaseErr) {
      if (isLockingEnabled()) {
        console.error(
          `hatch3r: failed to release write lock for ${filePath}: ` +
            `${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
        );
      }
    }
  }
}

/** Body of {@link safeWriteFile}, executed with the path's write lock held
 *  (or with locking inactive). Writes MUST use
 *  {@link atomicWriteFileUnlocked} — the lock is already held. */
async function safeWriteFileLocked(
  filePath: string,
  content: string,
  options: SafeWriteFileOptions,
  skipIfUnchanged: boolean,
): Promise<MergeResult> {
  const exists = await fileExists(filePath);

  if (!exists) {
    await atomicWriteFileUnlocked(filePath, content);
    return { path: filePath, action: "created" };
  }

  const existingContent = await readFile(filePath, "utf-8");

  if (options.managedContent) {
    if (!hasManagedBlock(existingContent, filePath)) {
      if (options.appendIfNoBlock) {
        // release/2.6.0 — legacy-generated adoption. When the marker-less
        // existing file is recognizable as raw hatch3r-generated output from
        // a pre-marker release (see LEGACY_GENERATED_NO_MARKER_SIGNATURES:
        // the `.claude/hooks/pretooluse-allowlist.mjs` script and the Cursor
        // guard scripts), REPLACE it with the incoming marker-wrapped bytes
        // instead of prepend-splicing. The prepend disposition below exists
        // to preserve USER content beneath the new block; for a generated
        // script it would instead keep a full stale copy of the body whose
        // duplicate ESM `import` bindings are a SyntaxError on every hook
        // invocation. The C9-H41 deny scan is deliberately not run on this
        // branch: its threat model is attacker-controlled existing text being
        // PRESERVED next to the managed block, and this branch preserves
        // nothing — every existing byte is discarded. No `.bak` either: the
        // file is regenerable from canonical content, matching the managed-
        // filename fast path's no-backup contract. The warning is a one-time
        // migration notice — the next sync finds markers and merges normally.
        if (isLegacyGeneratedNoMarkerFile(existingContent)) {
          if (skipIfUnchanged && content === existingContent) {
            return { path: filePath, action: "unchanged" };
          }
          await atomicWriteFileUnlocked(filePath, content);
          return {
            path: filePath,
            action: "updated",
            warning: `Adopted ${filePath}: this hatch3r-generated file predates managed-block markers (HATCH3R:BEGIN/END), so it was regenerated with markers added. No action required.`,
          };
        }
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
          // D1-SA1.5-07 (Cycle 12): consult the reviewed allowlist before
          // refusing, and never advise moving text into the managed block
          // (the next merge deletes the block interior). Fail-closed: any
          // finding without a matching reviewed exception still refuses.
          const disposition = await applyDenyScanAllowlist(filePath, deniedExisting);
          if (disposition.blocked.length > 0) {
            // Message built by the shared builder so predictDenyRefusal's
            // dry-run preview matches this throw byte-for-byte (D11-SA11.2-01).
            throw new HatchError(
              spliceDenyRefusalMessage(filePath, disposition.blocked),
              1,
              "VALIDATION_ERROR",
            );
          }
          reportAllowlistedDenyFindings(filePath, disposition.allowed);
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
        await atomicWriteFileUnlocked(filePath, prepended);
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
        warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or run \`hatch3r sync\` to re-splice the managed block while preserving your content below it, or move your custom content elsewhere and re-run the command.`,
      };
    }
    // D1-7 (Cycle 11 Wave 2, D1, P6+CQ8): scan the USER-authored slice — the
    // content OUTSIDE the line-anchored markers — for denied patterns. That
    // out-of-block text is the only surface an attacker controls on a
    // subsequent sync; the managed-block body is hatch3r-authored canonical
    // content the adapter just regenerated, so it is trusted by construction
    // and is NOT the deny-scan's target. detectMarkers/extractCustomContent are
    // line-anchored (managedBlocks.ts), which closes the original truncation
    // bypass at the root: a user line that merely QUOTES a marker token no
    // longer collapses the slice, so every out-of-block byte reaches the scan.
    //
    // D1-7-fix (scope-narrow): the prior form scanned the FULL existingContent
    // (canonical body included). Several canonical floor rules legitimately
    // contain text that matches a deny pattern as documentation — e.g.
    // rules/hatch3r-secrets-management.md documents emergency-rotation steps
    // ("...the new secret...") that match the `secret[:=]…` credential pattern.
    // Re-writing that canonical file on re-init/re-sync (existing markers
    // present) then tripped the throw below on the framework's own trusted
    // output. Scanning only the user slice removes that false positive while
    // preserving the security intent: malicious out-of-block user text still
    // refuses the splice, and the managed body is deny-clean by authorship.
    const customContent = extractCustomContent(existingContent, filePath);
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
      // D1-SA1.5-07 (Cycle 12): same reviewed-exception escape + rewritten
      // remedy as the appendIfNoBlock branch above — the two refusal flows
      // stay symmetric (F15.1-H1) including their recovery path.
      const disposition = await applyDenyScanAllowlist(filePath, deniedFindings);
      if (disposition.blocked.length > 0) {
        // Message built by the shared builder so predictDenyRefusal's
        // dry-run preview matches this throw byte-for-byte (D11-SA11.2-01).
        throw new HatchError(
          updateDenyRefusalMessage(filePath, disposition.blocked),
          1,
          "VALIDATION_ERROR",
        );
      }
      reportAllowlistedDenyFindings(filePath, disposition.allowed);
    }
    // D11-SA11.2-F11 (Cycle 10 Wave 4, D11, P5): detect the issue #76
    // legacy-state auto-repair BEFORE the merge so we can attribute the
    // on-disk marker rewrite (HTML `<!-- -->` → YAML `#` in a `.yml` file)
    // on the MergeResult.warning channel. Without this the variant flip lands
    // in the user's `git diff` with no signal that hatch3r rewrote the syntax.
    const variantChanged = wouldChangeMarkerVariant(existingContent, filePath);
    let merged: string;
    let mergeFailure: unknown;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent, filePath);
    } catch (err) {
      mergeFailure = err;
      // Managed block is structurally corrupted (a duplicated or misordered
      // HATCH3R:BEGIN/END marker line). D1-7/D11-4 (Cycle 11 Wave 2): marker
      // detection and duplicate-counting are now line-anchored, so a marker
      // token merely QUOTED in out-of-block user content no longer reaches this
      // branch — when we land here the structural markers really are broken, so
      // the warning below can name that cause honestly.
      // Create a .bak backup before overwriting so user content is not lost.
      // #242 (D8-8.9) + D1-M12: the backup is integrity-verified (size +
      // SHA-256) via {@link verifyBackup} before the overwrite proceeds.
      // Auto-repair always writes through — skipIfUnchanged does not apply
      // here because the file shape on disk is broken even when bytes
      // happen to match.
      //
      // D11-12 (Cycle 11 Wave 3, P5): do NOT clobber an existing `.bak`. The
      // prior code copied unconditionally to a fixed `<target>.bak`, so a
      // SECOND corruption/recovery overwrote the ONLY off-file copy of the
      // user's original from the FIRST recovery — silent loss of the earlier
      // backup. Use the canonical `<target>.bak` only when it is free; if it is
      // already taken, fall back to a uniquely-suffixed `<target>.bak.<8hex>`
      // (same 4-byte randomBytes convention as the `.tmp.<8hex>` writer) so each
      // recovery keeps its own backup. The session snapshot under `.hatch3r/`
      // remains the primary, complete recovery path (`hatch3r rollback`); these
      // `.bak*` files are the convenience copy the warning still points at.
      const bakPath = await resolveNonClobberingBakPath(filePath);
      try {
        await copyFile(filePath, bakPath);
      } catch (copyErr) {
        // D8-SA8.2-03: a failed backup copy (ENOSPC/EDQUOT/EACCES/…) aborts
        // BEFORE the overwrite — with the same guided message the atomic
        // writer produces, not a raw Node errno. The original is intact.
        throw mapFsErrno(copyErr, bakPath) ?? copyErr;
      }
      // existingContent was read above as the file's pre-repair bytes;
      // verifyBackup compares size AND SHA-256 against the on-disk backup so
      // partial-write / fs-corruption cases the size check misses abort the
      // repair (D1-M12) — see the helper for the full rationale.
      await verifyBackup(filePath, bakPath, existingContent, "auto-repair");
      await atomicWriteFileUnlocked(filePath, content);
      const failureReason =
        mergeFailure instanceof Error ? mergeFailure.message : String(mergeFailure);
      return {
        path: filePath,
        action: "updated",
        // D11-4 (Cycle 11 Wave 2): name the real cause (structurally corrupted
        // markers) instead of the prior bare "Auto-repaired corrupted managed
        // block", state that out-of-block content was rewritten, and point at
        // the recoverable backup + `hatch3r rollback` for full restoration.
        warning: `Rebuilt the managed block in ${filePath}: its HATCH3R:BEGIN/END markers were structurally corrupted (${failureReason}), so hatch3r regenerated the file from canonical content. Your previous file (including any content outside the markers) was preserved at ${bakPath}; to restore it, copy that file back or run \`hatch3r rollback --session=<id>\` (\`hatch3r rollback list\` shows session ids).`,
      };
    }
    // Slash-picker stub heal (release/2.6.0): `insertManagedBlock` above
    // re-splices ONLY the block interior and preserves the existing
    // out-of-block prefix verbatim — so the freshly generated byte-0 YAML
    // stub in `content` (whose `description:` the slash-command picker reads)
    // never reached files written before the stub existed: their BEGIN marker
    // sat at byte 0 forever, and the picker rendered the marker instead of
    // the description. Heal the prefix when, and only when, the existing
    // prefix carries no user-authored content per
    // {@link isHealableManagedPrefix}: (i) whitespace-only, or (ii) exactly
    // one YAML frontmatter block (a stale generated stub — description
    // overrides belong in `.hatch3r/{type}/{id}.customize.yaml`, which the
    // regeneration already folded into the incoming prefix). Any other prefix
    // is user content outside the block and stays untouched (pre-heal
    // behavior). Ordering note: the deny scan above runs on the USER-authored
    // slice of the PRE-merge file — the healed-in prefix is hatch3r-generated
    // output from the same trusted generation as `options.managedContent`, so
    // it is deny-clean by authorship exactly like the managed body (see the
    // D1-7-fix scope-narrow rationale above).
    let stubHealed: "missing" | "stale" | null = null;
    const stubFieldChanges: string[] = [];
    const incomingSplit = splitAtManagedBlock(content, filePath);
    if (incomingSplit && incomingSplit.prefix.trim() !== "") {
      const mergedSplit = splitAtManagedBlock(merged, filePath);
      if (
        mergedSplit &&
        mergedSplit.prefix !== incomingSplit.prefix &&
        isHealableManagedPrefix(mergedSplit.prefix)
      ) {
        stubHealed = mergedSplit.prefix.trim() === "" ? "missing" : "stale";
        // release/2.7.0: the stale-stub replacement silently discards any
        // edit to the hatch3r-owned `model:`/`effort:` lines in the old
        // prefix. Record each changed field so the warning below makes the
        // discard visible. Wording stays neutral by design: with no baseline
        // here, a diff fires both for a user hand-edit AND when hatch3r's own
        // model mapping moved (an expected one-time burst across migrated
        // agents on the first post-upgrade sync). `status` owns the
        // attribution (it compares against the provenance baseline).
        if (stubHealed === "stale") {
          for (const field of ["model", "effort"] as const) {
            const oldValue = readPrefixFrontmatterField(mergedSplit.prefix, field);
            const newValue = readPrefixFrontmatterField(incomingSplit.prefix, field);
            if (oldValue !== newValue) {
              stubFieldChanges.push(
                `${field}: ${oldValue ?? "(absent)"} → ${newValue ?? "(absent)"}`,
              );
            }
          }
        }
        merged = incomingSplit.prefix + mergedSplit.rest;
      }
    }
    // F15.1-H1: any denied finding already threw above (fail-closed), so by
    // here `deniedFindings` is empty — no warning branch is reachable.
    // G3: skipIfUnchanged compares the FINAL (post-heal) bytes, so a repeat
    // write after a heal returns "unchanged" — the heal is idempotent.
    if (skipIfUnchanged && merged === existingContent) {
      return { path: filePath, action: "unchanged" };
    }
    await atomicWriteFileUnlocked(filePath, merged);
    // D11-SA11.2-F11: surface the issue #76 marker-syntax auto-repair on the
    // existing warning channel (callers aggregate MergeResult.warning into the
    // sync-completion summary) so the operator can attribute the rewrite.
    // The stub heal reports on the same channel; when both fire, the parts
    // are joined into one warning so the MergeResult shape stays single-warning.
    const warningParts: string[] = [];
    if (variantChanged) {
      warningParts.push(
        `Auto-repaired marker syntax in ${filePath}: legacy HATCH3R:BEGIN/END markers used the wrong comment style for this file type and were rewritten to match (issue #76 legacy state). No action required.`,
      );
    }
    if (stubHealed) {
      warningParts.push(
        `Restored the byte-0 frontmatter stub in ${filePath} (previous prefix was ${stubHealed === "missing" ? "empty" : "a stale generated stub"}): slash-command pickers read the \`description:\` field before the HATCH3R:BEGIN marker. To customize the description, use \`.hatch3r/<type>/<id>.customize.yaml\` — sync regenerates the stub itself.`,
      );
      // release/2.7.0: make a model/effort discard visible (neutral wording —
      // see the capture site above for why no hand-edit attribution is made).
      if (stubFieldChanges.length > 0) {
        warningParts.push(
          `${filePath}: frontmatter model/effort changed on regeneration (${stubFieldChanges.join(", ")}). Durable per-agent overrides: \`.hatch3r/<type>/<id>.customize.yaml\` (model:/effort:) or \`hatch.json\` models.*.`,
        );
      }
    }
    if (warningParts.length > 0) {
      return { path: filePath, action: "updated", warning: warningParts.join(" ") };
    }
    return { path: filePath, action: "updated" };
  }

  const fileName = basename(filePath) ?? "";
  const isManagedFile = isManagedFileName(fileName);

  if (isManagedFile || options.force) {
    if (skipIfUnchanged && content === existingContent) {
      return { path: filePath, action: "unchanged" };
    }
    // D1-SA1.5-F90 (Cycle 11 Wave 4, CQ4): when `force` is the ONLY reason we are
    // overwriting (the file is NOT hatch3r-managed, so it is genuine user
    // content) and the bytes actually change, copy the original to a
    // non-clobbering `.bak` FIRST so a forced overwrite is locally recoverable —
    // mirroring the corruption-repair UX above ({@link resolveNonClobberingBakPath}).
    // A hatch3r-managed file is regenerable from canonical content, so it keeps
    // the no-backup fast path (matching "overwrites a managed file without
    // creating backups"). The backup uses the same non-clobbering slot scheme so
    // a pre-existing user `.bak` is never overwritten (the D11-12 invariant).
    if (options.force && !isManagedFile) {
      const bakPath = await resolveNonClobberingBakPath(filePath);
      try {
        await copyFile(filePath, bakPath);
      } catch (copyErr) {
        // D8-SA8.2-03: same guided FS_ERROR mapping as the repair-branch
        // backup copy — a raw errno here left the operator unguided on the
        // exact path that protects irreplaceable content.
        throw mapFsErrno(copyErr, bakPath) ?? copyErr;
      }
      // D8-SA8.2-02 (Cycle 12): this branch backs up GENUINE user content
      // (irreplaceable — not regenerable from canonical), so it verifies the
      // backup exactly like the corruption-repair branch above before
      // destroying the original. Previously only the repair branch — whose
      // backed-up file IS regenerable — verified; the guard was missing where
      // it mattered most.
      await verifyBackup(filePath, bakPath, existingContent, "force overwrite");
      await atomicWriteFileUnlocked(filePath, content);
      return {
        path: filePath,
        action: "updated",
        warning: `Force-overwrote unmanaged file ${filePath}: it has no HATCH3R:BEGIN/END markers, so --force replaced your content with hatch3r output. Your previous file was backed up to ${bakPath}; to restore it, copy that file back or run \`hatch3r rollback --session=<id>\` (\`hatch3r rollback list\` shows session ids).`,
      };
    }
    await atomicWriteFileUnlocked(filePath, content);
    return { path: filePath, action: "updated" };
  }

  // #144 (D19-15): Improved recovery guidance — avoid suggesting init --force
  return {
    path: filePath,
    action: "skipped",
    warning: `Skipped ${filePath}: managed block markers (HATCH3R:BEGIN/END) missing. To fix: restore the markers around hatch3r content, or run \`hatch3r sync\` to re-splice the managed block while preserving your content below it, or move your custom content elsewhere and re-run the command.`,
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

/**
 * release/2.7.0: read a single scalar frontmatter field (`model:` or
 * `effort:`) out of an out-of-block PREFIX — the slice before the
 * HATCH3R:BEGIN marker (`splitAtManagedBlock().prefix`).
 *
 * Line-anchored scan between the first `---` fence pair, using the same fence
 * walk as `isHealableManagedPrefix` (managedBlocks.ts) — heal-path callers
 * pass prefixes that helper already validated as exactly one YAML frontmatter
 * block or whitespace. Returns the trimmed value; `undefined` when the prefix
 * has no complete fence pair or the field is absent/value-less.
 *
 * Three consumers read this ONE parse so they agree byte-for-byte on what was
 * emitted: the stub-heal warning above (old vs new prefix), the provenance
 * writer's `emittedModel`/`emittedEffort` scalars (src/manifest/provenance.ts),
 * and the `status` stub-drift attribution (src/cli/commands/status.ts).
 */
export function readPrefixFrontmatterField(
  prefix: string,
  field: "model" | "effort",
): string | undefined {
  const lines = prefix.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  if (i >= lines.length || (lines[i] ?? "").trim() !== "---") return undefined;
  let close = i + 1;
  while (close < lines.length && (lines[close] ?? "").trim() !== "---") close++;
  if (close >= lines.length) return undefined; // unterminated fence — no frontmatter block
  const fieldRe = new RegExp(`^${field}:\\s*(.+)$`);
  for (let k = i + 1; k < close; k++) {
    // Strip a CRLF checkout's trailing \r BEFORE matching: `.` excludes line
    // terminators (\r included), so `(.+)$` would otherwise never match the
    // line at all. The fence checks above are already CRLF-safe via trim().
    const match = fieldRe.exec((lines[k] ?? "").replace(/\r$/, ""));
    if (match) {
      const value = (match[1] ?? "").trim();
      if (value !== "") return value;
    }
  }
  return undefined;
}
