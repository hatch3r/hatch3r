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
import { randomBytes } from "node:crypto";
import * as properLockfile from "proper-lockfile";
import { HATCH3R_PREFIX, HatchError, type MergeResult } from "../types.js";
import { insertManagedBlock, hasManagedBlock, extractCustomContent } from "./managedBlocks.js";
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
/** Lock staleness threshold: a lock older than this is treated as abandoned. */
const LOCK_STALE_MS = 15_000;

/**
 * D1-SA1.5.1: Acquire a cross-process advisory lock for {@link filePath} when
 * the `HATCH3R_LOCK=1` opt-in env var is set. Default (unset) is a no-op so
 * existing behavior is preserved.
 *
 * Returns a release function. Callers MUST invoke release in a finally block
 * — even when the wrapped write throws — to prevent stale locks.
 *
 * Throws {@link HatchError} with code `LOCK_TIMEOUT` when contention exceeds
 * the retry budget (~5s).
 */
async function acquireWriteLock(filePath: string): Promise<() => Promise<void>> {
  if (process.env.HATCH3R_LOCK !== "1") {
    return async () => { /* locking disabled */ };
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
      stale: LOCK_STALE_MS,
      retries: {
        retries: LOCK_RETRIES,
        minTimeout: LOCK_RETRY_MIN_MS,
        maxTimeout: LOCK_RETRY_MAX_MS,
        factor: 2,
      },
    });
    return release;
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
 * Write a file atomically via tmp+rename with fsync.
 *
 * **Concurrency:** By default this function does not use file locking. Two
 * hatch3r processes writing the same target path concurrently can silently
 * clobber one another. Set `HATCH3R_LOCK=1` to opt into cross-process file
 * locking via `proper-lockfile` (D1-SA1.5.1). Locking is gated behind the env
 * var to keep the default behavior unchanged for single-process flows.
 *
 * When locking is enabled and contention exceeds ~5s, throws {@link HatchError}
 * with code `LOCK_TIMEOUT`.
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
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") {
      throw new HatchError(
        `Not enough disk space to write ${filePath}. Free up space and re-run the command.`,
        1,
        "FS_ERROR",
      );
    }
    // #239 (D8-8.6): Actionable error for EACCES/permission-denied failures.
    if (code === "EACCES") {
      throw new HatchError(
        `Permission denied writing ${filePath}. Check file/directory permissions and ensure the current user has write access.`,
        1,
        "FS_ERROR",
      );
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
      if (process.env.HATCH3R_LOCK === "1") {
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
// Callers (sync.ts, update.ts command entry points) should invoke this at
// start-of-run and surface the returned entries via `warn()` / observability.
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
 * Safely write or merge a file, preserving user content outside managed blocks.
 *
 * **Concurrency:** Delegates atomic writes to {@link atomicWriteFile}. By
 * default, no cross-process lock is taken — running multiple hatch3r processes
 * against the same target is unsupported and may clobber output. Set
 * `HATCH3R_LOCK=1` to opt into file locking for scenarios like CI matrix runs
 * (D1-SA1.5.1). Workspace sync already processes repos sequentially internally,
 * so a single `hatch3r sync --repos` invocation is safe without the opt-in.
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
        const prepended = [content.trim(), "", existingContent.trimStart()].join("\n");
        if (skipIfUnchanged && prepended === existingContent) {
          return { path: filePath, action: "unchanged" };
        }
        await atomicWriteFile(filePath, prepended);
        return { path: filePath, action: "updated" };
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
    let merged: string;
    try {
      merged = insertManagedBlock(existingContent, options.managedContent);
    } catch {
      // Managed block is corrupted (duplicate markers, wrong order, etc.).
      // Create a .bak backup before overwriting so user content is not lost.
      // #242 (D8-8.9): Verify backup integrity before proceeding with overwrite.
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
      await atomicWriteFile(filePath, content);
      return {
        path: filePath,
        action: "updated",
        warning: `Auto-repaired corrupted managed block in ${filePath} (backup saved to ${bakPath})`,
      };
    }
    if (skipIfUnchanged && merged === existingContent) {
      const result: MergeResult = { path: filePath, action: "unchanged" };
      if (deniedFindings.length > 0) {
        result.warning = `Content outside managed block in ${filePath} contains suspicious patterns: ${deniedFindings.join("; ")}`;
      }
      return result;
    }
    await atomicWriteFile(filePath, merged);
    const result: MergeResult = { path: filePath, action: "updated" };
    if (deniedFindings.length > 0) {
      result.warning = `Content outside managed block in ${filePath} contains suspicious patterns: ${deniedFindings.join("; ")}`;
    }
    return result;
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
