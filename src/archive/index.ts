import { access, cp, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, sep } from "node:path";
import type { HatchManifest, Tool } from "../types.js";
import { ARCHIVE_DIR, HATCH3R_PREFIX, HatchError, sanitizeId } from "../types.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type { CustomizableType } from "../models/customize.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record an archive-probe failure: emit a verbose() line to stderr (visible
 * only with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract.
 */
function recordArchiveProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`archive: ${operation} — ${message}`);
}

function toPosixPath(p: string): string {
  return sep === "\\" ? p.replaceAll("\\", "/") : p;
}

// ARCHIVE_DIR imported from types.ts

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

// Wave 7: trimmed to the 3 retained adapters (cursor, claude, copilot).
// Pre-1.9 tools (windsurf/codex/amp/gemini/cline/aider/kiro/opencode/goose/
// zed/amazon-q/antigravity) were removed in Wave 1; their archive prefixes
// are no longer needed because `inventoryArtifacts` only enumerates `Tool`.
export const TOOL_PATH_PREFIXES: Record<Tool, string[]> = {
  cursor: [".cursor/"],
  claude: [".claude/", "CLAUDE.md", ".mcp.json"],
  copilot: [
    ".github/copilot-instructions.md",
    ".github/workflows/copilot-setup-steps.yml",
    ".vscode/mcp.json",
    ".github/instructions/",
    ".github/agents/",
    ".github/prompts/",
    ".github/skills/",
    // D10-11 (Cycle 11 Wave 2, D10, P1): copilot.ts:442 emits the `checks/`
    // companion subdir to `.github/checks/{name}.md`, but this prefix list
    // omitted it — so config tool-removal (which previews from
    // `managedFilesByAdapter` yet archives via `collectToolFiles`/these
    // prefixes) left the 6 canonical checks/ files orphaned on disk after a
    // copilot removal. Adding the prefix lets `collectToolFiles` sweep them.
    // The structural test in archive.test.ts asserts no adapter omits a
    // top-level output dir from its prefix entry, so a future emit gap fails
    // CI instead of leaking files.
    ".github/checks/",
  ],
};

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

/**
 * True when `filePath` (repo-relative, posix-style) is covered by `tool`'s
 * {@link TOOL_PATH_PREFIXES} entry — a directory prefix (`endsWith("/")`)
 * matches by `startsWith`, an exact-file prefix matches by equality. This is
 * the same coverage predicate {@link collectToolFiles} archives against, so
 * any adapter output path it returns `false` for would be orphaned on tool
 * removal (the D10-11 leak). Exported so the archive structural test in
 * `src/__tests__/archive/archive.test.ts` can assert every adapter's emitted
 * output path is covered by its prefix entry.
 */
export function fileMatchesTool(filePath: string, tool: Tool): boolean {
  const prefixes = TOOL_PATH_PREFIXES[tool];
  if (!prefixes) return false;
  return prefixes.some((prefix) =>
    prefix.endsWith("/") ? filePath.startsWith(prefix) : filePath === prefix,
  );
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

/**
 * D2-M14 (D2 Medium, Cycle 10 Wave 3 rollover): SHA-256 hash a file's bytes
 * via an already-open FileHandle. Streams in 64 KiB chunks so memory stays
 * bounded on large files, and reads from the same inode the caller's stat
 * was taken against — avoiding the TOCTOU window of a fresh path-based
 * read. Returns the lowercase hex digest. Resets the handle position before
 * hashing so the caller's previous reads do not affect the digest.
 */
async function hashFileHandle(fh: { read: (opts: {
  buffer: Buffer;
  offset: number;
  length: number;
  position: number;
}) => Promise<{ bytesRead: number }> }): Promise<string> {
  const hash = createHash("sha256");
  const CHUNK = 64 * 1024;
  const buf = Buffer.alloc(CHUNK);
  let position = 0;
  // Loop until read returns bytesRead === 0 (EOF). Explicit position-based
  // read so the FileHandle's internal cursor is not consulted (the caller
  // may have done a stat() / read() before us).
  while (true) {
    const { bytesRead } = await fh.read({
      buffer: buf,
      offset: 0,
      length: CHUNK,
      position,
    });
    if (bytesRead === 0) break;
    hash.update(buf.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

export async function collectToolFiles(rootDir: string, tool: Tool): Promise<string[]> {
  const prefixes = TOOL_PATH_PREFIXES[tool];
  if (!prefixes) return [];

  const files: string[] = [];

  for (const prefix of prefixes) {
    const absPath = join(rootDir, prefix);
    if (prefix.endsWith("/")) {
      try {
        const entries = await readdir(absPath, { recursive: true, withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const parent = entry.parentPath ?? (entry as unknown as { path: string }).path ?? absPath;
            const relPath = toPosixPath(join(prefix, parent.slice(absPath.length), entry.name));
            files.push(relPath);
          }
        }
      } catch (err) {
        recordArchiveProbeFailure(
          `collectToolFiles: readdir(${absPath}) — directory missing for ${tool}`,
          err,
        );
      }
    } else if (await fileExists(absPath)) {
      files.push(prefix);
    }
  }

  return files;
}

export async function archiveToolOutputs(
  rootDir: string,
  tool: Tool,
): Promise<{ archivedFiles: string[]; migrations: MigrationNotice[] }> {
  const filesToArchive = await collectToolFiles(rootDir, tool);
  if (filesToArchive.length === 0) {
    return { archivedFiles: [], migrations: [] };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveBase = join(rootDir, ARCHIVE_DIR, tool, timestamp);

  const archivedFiles: string[] = [];
  const migrations: MigrationNotice[] = [];

  for (const relPath of filesToArchive) {
    const absPath = join(rootDir, relPath);
    if (!(await fileExists(absPath))) continue;

    let content: string;
    try {
      content = await readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    if (hasManagedBlock(content, absPath)) {
      const customContent = stripFrontmatter(extractCustomContent(content, absPath));
      if (customContent.length > 0) {
        const parsed = parseOutputPath(relPath);
        if (parsed) {
          const customizePath = join(rootDir, ".hatch3r", parsed.type, `${parsed.id}.customize.md`);
          if (!(await fileExists(customizePath))) {
            await mkdir(dirname(customizePath), { recursive: true });
            // #241 (D8-8.8): Route through atomicWriteFile for crash-safe migration writes
            await atomicWriteFile(customizePath, customContent + "\n");
            migrations.push({
              from: relPath,
              to: `.hatch3r/${parsed.type}/${parsed.id}.customize.md`,
              type: parsed.type,
              id: parsed.id,
            });
          }
        }
      }
    }

    const archiveDest = join(archiveBase, relPath);
    await mkdir(dirname(archiveDest), { recursive: true });
    await cp(absPath, archiveDest);
    // #243 (D8-8.10): Use fd-based stat to avoid TOCTOU race between stat
    // calls. Opening both files and using fh.stat() ensures we read sizes
    // atomically from the same inodes we just wrote/read.
    //
    // D2-M14 (D2 Medium, Cycle 10 Wave 3 rollover): size-only validation
    // is insufficient — a bit flip from disk corruption, an intermediate
    // network filesystem hiccup, or a concurrent writer hitting the source
    // mid-copy could yield a same-size-different-content destination. The
    // post-copy validation now SHA-256 hashes both inodes from the open
    // file descriptors and compares the digests; size mismatch is still
    // reported first (cheap fast-path) while a same-size-content-divergent
    // copy fails with an explicit hash-mismatch HatchError that names both
    // hashes for forensic comparison.
    const srcFh = await open(absPath, "r");
    try {
      const destFh = await open(archiveDest, "r");
      try {
        const srcStat = await srcFh.stat();
        const destStat = await destFh.stat();
        if (destStat.size !== srcStat.size) {
          throw new HatchError(
            `Archive copy size mismatch for ${relPath}: source=${srcStat.size}, dest=${destStat.size}`,
            1,
            "FS_ERROR",
          );
        }
        // D2-M14: hash both fds and compare. We read via the open fds (not
        // a fresh path-based read) so the bytes hashed come from the same
        // inodes whose size we just validated — closing the residual
        // TOCTOU window where a swap-rename could replace either file
        // between size check and content check.
        const [srcHash, destHash] = await Promise.all([
          hashFileHandle(srcFh),
          hashFileHandle(destFh),
        ]);
        if (srcHash !== destHash) {
          throw new HatchError(
            `Archive copy content mismatch for ${relPath}: source SHA-256=${srcHash}, dest SHA-256=${destHash}. ` +
              `Sizes matched but bytes diverged — likely disk corruption, concurrent writer, or network filesystem inconsistency. ` +
              `Source NOT removed; investigate the destination at ${archiveDest}.`,
            1,
            "FS_ERROR",
          );
        }
      } finally {
        await destFh.close();
      }
    } finally {
      await srcFh.close();
    }
    await rm(absPath);
    archivedFiles.push(relPath);
  }

  await cleanEmptyDirs(rootDir, filesToArchive);

  return { archivedFiles, migrations };
}

export async function cleanEmptyDirs(rootDir: string, paths: string[]): Promise<void> {
  const dirs = new Set<string>();
  for (const p of paths) {
    let dir = dirname(join(rootDir, p));
    while (dir !== rootDir && dir.length > rootDir.length) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }

  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const dir of sorted) {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) {
        await rm(dir, { recursive: true });
      }
    } catch (err) {
      recordArchiveProbeFailure(
        `cleanEmptyDirs: readdir/rm(${dir}) — already removed or missing`,
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

/**
 * Maximum archive entries retained per tool before pruning.
 *
 * Source: D2-SA2.7 retention contract — five entries balances local
 * rollback coverage (one entry per recent sync run) against disk-footprint
 * growth on long-lived projects. Override with HATCH3R_MAX_ARCHIVE_ENTRIES
 * env var (positive integer; default: 5).
 */
const MAX_ARCHIVE_ENTRIES = ((): number => {
  const envVal = process.env.HATCH3R_MAX_ARCHIVE_ENTRIES;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 5;
})();

/**
 * Prune old archive entries, keeping only the most recent MAX_ARCHIVE_ENTRIES per tool.
 */
export async function pruneArchives(rootDir: string): Promise<string[]> {
  const archiveRoot = join(rootDir, ARCHIVE_DIR);
  const pruned: string[] = [];

  let toolDirs: string[];
  try {
    toolDirs = await readdir(archiveRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  for (const toolDir of toolDirs) {
    const toolPath = join(archiveRoot, toolDir);
    let entries: string[];
    try {
      const s = await stat(toolPath);
      if (!s.isDirectory()) continue;
      entries = await readdir(toolPath);
    } catch {
      continue;
    }

    // Sort descending (newest first) — timestamps are ISO-formatted
    entries.sort((a, b) => b.localeCompare(a));

    for (const entry of entries.slice(MAX_ARCHIVE_ENTRIES)) {
      const entryPath = join(toolPath, entry);
      await rm(entryPath, { recursive: true, force: true });
      pruned.push(`${toolDir}/${entry}`);
    }
  }

  return pruned;
}
