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
} from "node:fs/promises";
import { dirname, basename } from "node:path";
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
    try {
      await unlink(tmpPath);
    } catch {
      // Temp file already renamed or doesn't exist
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
  } = {},
): Promise<MergeResult> {
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
    await atomicWriteFile(filePath, merged);
    const result: MergeResult = { path: filePath, action: "updated" };
    if (deniedFindings.length > 0) {
      result.warning = `Content outside managed block in ${filePath} contains suspicious patterns: ${deniedFindings.join("; ")}`;
    }
    return result;
  }

  const fileName = basename(filePath) ?? "";
  const isManagedFile = fileName.startsWith(HATCH3R_PREFIX);

  if (isManagedFile || options.force) {
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

/** Check whether a file path's basename starts with the hatch3r- prefix. */
export function isManagedPath(filePath: string): boolean {
  const fileName = basename(filePath) ?? "";
  return fileName.startsWith(HATCH3R_PREFIX);
}
