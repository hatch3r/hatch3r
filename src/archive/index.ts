import { access, readdir, rmdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { HatchManifest, Tool } from "../types.js";
import {
  ARCHIVE_DIR,
  HATCH3R_PREFIX,
  HatchError,
  sanitizeId,
} from "../types.js";
import {
  extractCustomContent,
  hasManagedBlock,
} from "../merge/managedBlocks.js";
import { acquireWriteLock, atomicWriteFile } from "../merge/safeWrite.js";
import {
  assertRepositoryPathIdentity,
  ensureSafeRepositoryDirectory,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  readRepositoryFileSnapshot,
  readRepositoryPathIdentity,
  removeRepositoryFileIfUnchanged,
  replaceRepositoryFileIfUnchanged,
  type RepositoryFileSnapshot,
} from "../merge/repositoryPathSafety.js";
import {
  fileMatchesTool,
  isCodexSharedPath,
  planCodexRemoval,
  type CodexRemovalPlan,
} from "../merge/codexOwnership.js";
import type { CustomizableType } from "../models/customize.js";
import { collectToolFiles, isRegularFileNotSymlink } from "./collect.js";
import { recordArchiveProbeFailure } from "./diagnostics.js";

export { collectToolFiles } from "./collect.js";
export { pruneArchives, MAX_ARCHIVE_BYTES, MAX_ARCHIVE_ENTRIES_CEILING } from "./retention.js";
export { fileMatchesTool, TOOL_PATH_PREFIXES } from "../codex/surfacePaths.js";

function toPosixPath(p: string): string {
  return sep === "\\" ? p.replaceAll("\\", "/") : p;
}

// ARCHIVE_DIR imported from types.ts

/**
 * D2-23 (D2 Medium, Cycle 11 Wave 3): process-local monotonic counter that
 * disambiguates two archive runs of the SAME tool inside one millisecond. The
 * archive directory was derived solely from `new Date().toISOString()`
 * (millisecond resolution), so back-to-back `archiveToolOutputs(root, tool)`
 * calls in the same tick produced an identical `archiveBase`; the subsequent
 * `cp(absPath, archiveDest)` (overwrite-by-default) silently clobbered the
 * first run's stashed bytes. The suffix appends `-<pid>-<counter>` so each call
 * lands in its own directory even when timestamps collide. `pid` guards against
 * two concurrent processes archiving the same tool into a shared repo within
 * the same millisecond (each process has its own counter starting at 0).
 */
let archiveRunCounter = 0;

export interface MigrationNotice {
  from: string;
  to: string;
  type: string;
  id: string;
}

interface ParsedOutputPath {
  type: CustomizableType;
  id: string;
}

const PATH_PATTERNS: Array<{ pattern: RegExp; type: CustomizableType }> = [
  { pattern: /\/rules\/([^/]+)\.(mdc|md)$/, type: "rules" },
  { pattern: /\/agents\/([^/]+)\.md$/, type: "agents" },
  { pattern: /\/skills\/([^/]+)\/SKILL\.md$/, type: "skills" },
  { pattern: /\/commands\/([^/]+)\.md$/, type: "commands" },
];

function parseOutputPath(filePath: string): ParsedOutputPath | null {
  for (const { pattern, type } of PATH_PATTERNS) {
    const match = filePath.match(pattern);
    if (match) {
      let id = match[1];
      if (id.startsWith(HATCH3R_PREFIX)) {
        id = id.slice(HATCH3R_PREFIX.length);
      }
      id = sanitizeId(id);
      if (id.length > 0) return { type, id };
    }
  }
  return null;
}

function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("---")) {
    const endIdx = trimmed.indexOf("\n---", 3);
    if (endIdx !== -1) {
      return trimmed.slice(endIdx + 4).trim();
    }
  }
  return content.trim();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    recordArchiveProbeFailure(`fileExists(${path}) — not present`, err);
    return false;
  }
}

async function archiveCandidates(
  rootDir: string,
  tool: Tool,
  recorded: ReadonlySet<string>,
): Promise<string[]> {
  let filesToArchive = (await collectToolFiles(rootDir, tool)).map(normalizeRepositoryRelativePath);
  if (tool !== "codex") return filesToArchive;
  for (const path of recorded) {
    if (fileMatchesTool(path, tool) && await isRegularFileNotSymlink(join(rootDir, path))) {
      filesToArchive.push(path);
    }
  }
  filesToArchive = [...new Set(filesToArchive)].sort();
  return filesToArchive.filter((path) => isCodexSharedPath(path) || recorded.has(path));
}

async function migrateArchivedCustomization(
  rootDir: string,
  relPath: string,
  absPath: string,
  content: string,
): Promise<MigrationNotice | null> {
  if (!hasManagedBlock(content, absPath)) return null;
  const customContent = stripFrontmatter(extractCustomContent(content, absPath));
  const parsed = customContent.length > 0 ? parseOutputPath(relPath) : null;
  if (!parsed) return null;
  const customizeRel = `.hatch3r/${parsed.type}/${parsed.id}.customize.md`;
  if (await fileExists(join(rootDir, customizeRel))) return null;
  await ensureSafeRepositoryDirectory(rootDir, dirname(customizeRel).replace(/\\/g, "/"));
  await inspectRepositoryPath(rootDir, customizeRel, { allowMissing: true });
  await atomicWriteFile(join(rootDir, customizeRel), customContent + "\n");
  return { from: relPath, to: customizeRel, type: parsed.type, id: parsed.id };
}

async function writeVerifiedArchiveCopy(
  rootDir: string,
  archiveBase: string,
  relPath: string,
  source: RepositoryFileSnapshot,
): Promise<void> {
  const archiveRel = toPosixPath(relative(rootDir, join(archiveBase, relPath)));
  await ensureSafeRepositoryDirectory(rootDir, dirname(archiveRel).replace(/\\/g, "/"));
  await inspectRepositoryPath(rootDir, archiveRel, { allowMissing: true });
  await atomicWriteFile(join(rootDir, archiveRel), source.content);
  const archived = await readRepositoryFileSnapshot(rootDir, archiveRel);
  if (archived.identity.size !== source.identity.size) {
    throw new HatchError(
      `Archive copy size mismatch for ${relPath}: source=${source.identity.size}, dest=${archived.identity.size}. Source NOT removed; investigate the destination at ${archived.absolutePath}.`,
      1,
      "FS_ERROR",
    );
  }
  if (archived.identity.sha256 === source.identity.sha256) return;
  throw new HatchError(
    `Archive copy content mismatch for ${relPath}: source SHA-256=${source.identity.sha256}, dest SHA-256=${archived.identity.sha256}. Source NOT removed; investigate the destination at ${archived.absolutePath}.`,
    1,
    "FS_ERROR",
  );
}

interface ArchiveOneResult {
  archived: boolean;
  migration: MigrationNotice | null;
}

async function archiveOneToolOutput(
  rootDir: string,
  tool: Tool,
  relPath: string,
  archiveBase: string,
  recorded: ReadonlySet<string>,
): Promise<ArchiveOneResult> {
  let initial: RepositoryFileSnapshot;
  try {
    initial = await readRepositoryFileSnapshot(rootDir, relPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      recordArchiveProbeFailure(`archiveToolOutputs: inspect(${relPath})`, err);
    }
    return { archived: false, migration: null };
  }
  const release = await acquireWriteLock(initial.absolutePath);
  try {
    const source = await readRepositoryFileSnapshot(rootDir, relPath);
    const content = source.content.toString("utf-8");
    const plan: CodexRemovalPlan | undefined = tool === "codex"
      ? planCodexRemoval(relPath, source.absolutePath, content, recorded.has(relPath))
      : undefined;
    if (plan?.disposition === "foreign") return { archived: false, migration: null };
    const migration = await migrateArchivedCustomization(
      rootDir, relPath, source.absolutePath, content,
    );
    await writeVerifiedArchiveCopy(rootDir, archiveBase, relPath, source);
    if (plan?.disposition === "preserve") {
      await replaceRepositoryFileIfUnchanged(rootDir, relPath, source.identity, plan.content);
    } else {
      await removeRepositoryFileIfUnchanged(rootDir, relPath, source.identity);
    }
    return { archived: true, migration };
  } finally {
    await release();
  }
}

export async function archiveToolOutputs(
  rootDir: string,
  tool: Tool,
  options?: { recordedPaths?: readonly string[] },
): Promise<{ archivedFiles: string[]; migrations: MigrationNotice[] }> {
  const recorded = new Set((options?.recordedPaths ?? []).map(normalizeRepositoryRelativePath));
  const filesToArchive = await archiveCandidates(rootDir, tool, recorded);
  if (filesToArchive.length === 0) return { archivedFiles: [], migrations: [] };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${process.pid}-${archiveRunCounter++}`;
  const archiveBase = join(rootDir, ARCHIVE_DIR, tool, `${timestamp}-${runId}`);
  const archivedFiles: string[] = [];
  const migrations: MigrationNotice[] = [];
  for (const relPath of filesToArchive) {
    const result = await archiveOneToolOutput(rootDir, tool, relPath, archiveBase, recorded);
    if (result.archived) archivedFiles.push(relPath);
    if (result.migration) migrations.push(result.migration);
  }
  await cleanEmptyDirs(rootDir, filesToArchive);
  return { archivedFiles, migrations };
}

export async function cleanEmptyDirs(rootDir: string, paths: string[]): Promise<void> {
  const dirs = new Set<string>();
  for (const p of paths) {
    let dir = dirname(normalizeRepositoryRelativePath(p)).replace(/\\/g, "/");
    while (dir !== "." && dir.length > 0) {
      dirs.add(dir);
      dir = dirname(dir).replace(/\\/g, "/");
    }
  }

  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const relDir of sorted) {
    try {
      const inspected = await inspectRepositoryPath(rootDir, relDir);
      const identity = await readRepositoryPathIdentity(rootDir, relDir);
      const entries = await readdir(inspected.absolutePath);
      if (entries.length === 0) {
        await assertRepositoryPathIdentity(rootDir, relDir, identity);
        await rmdir(inspected.absolutePath);
      }
    } catch (err) {
      recordArchiveProbeFailure(
        `cleanEmptyDirs: readdir/rmdir(${relDir}) — unsafe, changed, or missing`,
        err,
      );
    }
  }
}

export function removeManagedFilesForPaths(
  manifest: HatchManifest,
  paths: string[],
): void {
  const pathSet = new Set(paths);
  manifest.managedFiles = manifest.managedFiles.filter((f) => !pathSet.has(f));
}

export function getManagedFilesForTool(
  manifest: HatchManifest,
  tool: Tool,
): string[] {
  return manifest.managedFiles.filter((f) => fileMatchesTool(f, tool));
}
