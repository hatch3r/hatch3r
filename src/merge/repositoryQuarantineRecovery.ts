import { lstat, rename } from "node:fs/promises";
import type { SafeRepositoryPath } from "./repositoryPathSafety.js";
import { UnsafeRepositoryPathError } from "./repositoryPathValidation.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function quarantinedEntryKind(
  path: string,
  quarantine: SafeRepositoryPath,
  inspectionError: unknown,
): Promise<string> {
  try {
    const moved = await lstat(quarantine.absolutePath, { bigint: true });
    if (moved.isSymbolicLink()) return "symbolic link";
    if (moved.isDirectory()) return "directory";
    if (moved.isFile()) return "regular file";
    return "non-regular entry";
  } catch (lstatError) {
    if ((lstatError as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UnsafeRepositoryPathError(
        path,
        "changed",
        `the quarantined entry vanished before no-follow inspection (${errorMessage(inspectionError)})`,
      );
    }
    return `entry whose no-follow inspection failed (${errorMessage(lstatError)})`;
  }
}

async function originalPathOccupied(
  path: string,
  original: SafeRepositoryPath,
  quarantine: SafeRepositoryPath,
  movedKind: string,
): Promise<boolean> {
  try {
    await lstat(original.absolutePath, { bigint: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new UnsafeRepositoryPathError(
      path,
      "changed",
      `the raced ${movedKind} remains recoverable at ${quarantine.relativePath}; the original path could not be inspected without following links (${errorMessage(error)})`,
    );
  }
}

async function restoreQuarantinedEntry(
  path: string,
  original: SafeRepositoryPath,
  quarantine: SafeRepositoryPath,
  movedKind: string,
): Promise<void> {
  try {
    await rename(quarantine.absolutePath, original.absolutePath);
  } catch (restoreError) {
    throw new UnsafeRepositoryPathError(
      path,
      "changed",
      `the raced ${movedKind} remains recoverable at ${quarantine.relativePath}; exact-entry restoration failed (${errorMessage(restoreError)})`,
    );
  }
}

export async function recoverRacedQuarantineEntry(
  path: string,
  original: SafeRepositoryPath,
  quarantine: SafeRepositoryPath,
  inspectionError: unknown,
): Promise<never> {
  const movedKind = await quarantinedEntryKind(path, quarantine, inspectionError);
  const originalOccupied = await originalPathOccupied(path, original, quarantine, movedKind);
  if (!originalOccupied) {
    await restoreQuarantinedEntry(path, original, quarantine, movedKind);
    throw new UnsafeRepositoryPathError(
      path,
      "changed",
      `the pathname was replaced by a ${movedKind} after quarantine rename; the exact entry was restored without following it (${errorMessage(inspectionError)})`,
    );
  }
  throw new UnsafeRepositoryPathError(
    path,
    "changed",
    `the pathname was replaced by a ${movedKind}; the original path is occupied, so the exact entry remains recoverable at ${quarantine.relativePath} (${errorMessage(inspectionError)})`,
  );
}
