import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ARCHIVE_DIR } from "../types.js";
import {
  assertRepositoryPathIdentity,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  readRepositoryPathIdentity,
} from "../merge/repositoryPathSafety.js";
import { recordArchiveProbeFailure } from "./diagnostics.js";

export const MAX_ARCHIVE_ENTRIES_CEILING = 50;
export const MAX_ARCHIVE_BYTES = 100_000_000;

const MAX_ARCHIVE_ENTRIES = ((): number => {
  const envVal = process.env.HATCH3R_MAX_ARCHIVE_ENTRIES;
  if (!envVal) return 5;
  const parsed = parseInt(envVal, 10);
  return !Number.isNaN(parsed) && parsed > 0
    ? Math.min(parsed, MAX_ARCHIVE_ENTRIES_CEILING)
    : 5;
})();

async function archiveDirSizeBytes(dir: string): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  let total = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await archiveDirSizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }
  return total;
}

async function readArchiveToolDirs(rootDir: string): Promise<string[]> {
  const archiveRoot = join(rootDir, ARCHIVE_DIR);
  try {
    await inspectRepositoryPath(rootDir, ARCHIVE_DIR);
    return await readdir(archiveRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readToolArchiveEntries(rootDir: string, toolDir: string): Promise<string[] | null> {
  try {
    const toolRel = normalizeRepositoryRelativePath(`${ARCHIVE_DIR}/${toolDir}`);
    const inspected = await inspectRepositoryPath(rootDir, toolRel);
    if (!(await stat(inspected.absolutePath)).isDirectory()) return null;
    return (await readdir(inspected.absolutePath)).sort((a, b) => b.localeCompare(a));
  } catch (err) {
    recordArchiveProbeFailure(`pruneArchives: unavailable tool directory ${toolDir}`, err);
    return null;
  }
}

async function evictArchiveEntry(
  rootDir: string,
  toolDir: string,
  entry: string,
  pruned: string[],
): Promise<void> {
  const entryRel = normalizeRepositoryRelativePath(`${ARCHIVE_DIR}/${toolDir}/${entry}`);
  const inspected = await inspectRepositoryPath(rootDir, entryRel);
  const identity = await readRepositoryPathIdentity(rootDir, entryRel);
  await assertRepositoryPathIdentity(rootDir, entryRel, identity);
  await rm(inspected.absolutePath, { recursive: true });
  pruned.push(`${toolDir}/${entry}`);
}

async function pruneArchiveTool(rootDir: string, toolDir: string, pruned: string[]): Promise<void> {
  if (toolDir === "customize") return;
  const entries = await readToolArchiveEntries(rootDir, toolDir);
  if (!entries) return;
  for (const entry of entries.slice(MAX_ARCHIVE_ENTRIES)) {
    await evictArchiveEntry(rootDir, toolDir, entry, pruned);
  }
  const survivors = entries.slice(0, MAX_ARCHIVE_ENTRIES);
  if (survivors.length <= 1) return;
  const toolPath = join(rootDir, ARCHIVE_DIR, toolDir);
  const sized = await Promise.all(survivors.map(async (entry) => ({
    entry,
    bytes: await archiveDirSizeBytes(join(toolPath, entry)),
  })));
  let total = sized.reduce((sum, item) => sum + item.bytes, 0);
  for (let index = sized.length - 1; index >= 1 && total > MAX_ARCHIVE_BYTES; index--) {
    const item = sized[index]!;
    await evictArchiveEntry(rootDir, toolDir, item.entry, pruned);
    total -= item.bytes;
  }
}

export async function pruneArchives(rootDir: string): Promise<string[]> {
  const pruned: string[] = [];
  for (const toolDir of await readArchiveToolDirs(rootDir)) {
    await pruneArchiveTool(rootDir, toolDir, pruned);
  }
  return pruned;
}
