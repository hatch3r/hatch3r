import { dirname } from "node:path";
import { HatchError } from "../types.js";

/**
 * D8-SA8.2-F8.2.7 (Cycle 10, P1): errno → actionable-message table for
 * write-side filesystem failures. The catch handler in `atomicWriteFile`
 * previously classified only `ENOSPC` and `EACCES`; every other errno fell
 * through as a bare Node message with no recovery guidance. Linux quota mounts
 * raise `EDQUOT` (not `ENOSPC`) when a user quota is exhausted, so the old
 * "Not enough disk space" message actively misled operators who saw free space
 * in `df`. Read-only mounts (`EROFS`), FAT32 size ceilings (`EFBIG`), fd
 * exhaustion (`EMFILE`), and failing disks (`EIO`) all reach this path too.
 *
 * Each entry returns a complete sentence naming the cause and the operator's
 * next step. `ENOSPC` and `EACCES` keep their original wording verbatim so no
 * existing assertion changes.
 *
 * D8-SA8.2-03 (Cycle 12, P1): extracted from `safeWrite.ts` (where the table
 * was module-local and consumed only by `atomicWriteFile`'s catch) into this
 * shared module — the extraction the table's own header anticipated — so the
 * sibling write-side paths that raise the same errnos (`safeWriteFile`'s
 * parent-directory `mkdir`, the two `.bak` backup `copyFile` calls) map the
 * identical failure to the identical guided message instead of a raw Node
 * error. Consumers apply {@link mapFsErrno} in a catch and re-throw the
 * original error when it returns `null`.
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
 * Map a write-side filesystem error to an actionable `FS_ERROR`
 * {@link HatchError}, or return `null` when the errno is not in
 * {@link FS_ERRNO_MESSAGE} (callers re-throw the original error so
 * unrecognised failures surface unchanged).
 *
 * `filePath` is the path the failed operation was creating or writing — the
 * write target for the tmp+rename writer and the parent-directory `mkdir`,
 * the backup destination for a `.bak` `copyFile` — so the guided message
 * names the file the operator can act on.
 */
export function mapFsErrno(err: unknown, filePath: string): HatchError | null {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  const messageFor = code ? FS_ERRNO_MESSAGE[code] : undefined;
  return messageFor ? new HatchError(messageFor(filePath), 1, "FS_ERROR") : null;
}
