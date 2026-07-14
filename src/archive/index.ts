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

/**
 * Recursively sum the byte size of every regular file under `dir`. Returns 0
 * when the directory is absent. D2-22: used by {@link pruneArchives} to enforce
 * the {@link MAX_ARCHIVE_BYTES} per-tool ceiling. Symlinks are not followed —
 * only entries reported as regular files by `withFileTypes` are `stat`-ed, so a
 * symlink cannot inflate the count or escape the archive root. A file vanishing
 * mid-walk (concurrent prune / external cleanup) is skipped rather than aborting
 * the sweep, because a size estimate must not be downgraded to a hard failure.
 * Mirrors the snapshot store's `dirSizeBytes` (src/pipeline/snapshot.ts), kept
 * local rather than exported to avoid widening that module's public surface.
 */
async function archiveDirSizeBytes(dir: string): Promise<number> {
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
      total += await archiveDirSizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
  }
  return total;
}

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
  // D2-23: suffix the millisecond timestamp with `-<pid>-<counter>` so two
  // same-tool runs in the same tick get distinct directories; without it the
  // overwrite-by-default `cp` below would silently clobber the earlier run's
  // bytes. `pid` separates concurrent processes sharing one repo.
  const runId = `${process.pid}-${archiveRunCounter++}`;
  const archiveBase = join(rootDir, ARCHIVE_DIR, tool, `${timestamp}-${runId}`);

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
 * Hard upper bound on the per-tool entry count, regardless of the
 * HATCH3R_MAX_ARCHIVE_ENTRIES override.
 *
 * D2-22 (D2 Medium, Cycle 11 Wave 3): the override accepted any positive
 * integer, so `HATCH3R_MAX_ARCHIVE_ENTRIES=100000` effectively disabled
 * pruning (`entries.slice(MAX_ARCHIVE_ENTRIES)` in pruneArchives yields an
 * empty slice) and `.hatch3r-archive/` grew without bound — unlike the
 * snapshot store, which carries both a count cap (MAX_SNAPSHOT_COUNT — now 150
 * via DEFAULT_LEARNING_FILE_COUNT) and a byte ceiling (MAX_SNAPSHOT_BYTES).
 * This ceiling keeps the 50 the snapshot store carried when the guard landed,
 * so the override can lower retention but never lift it past 50.
 */
export const MAX_ARCHIVE_ENTRIES_CEILING = 50;

/**
 * Aggregate-byte ceiling for a single tool's archive directory.
 *
 * D2-22: count alone does not bound disk footprint — a handful of entries each
 * holding a large generated corpus can still grow `.hatch3r-archive/<tool>/`
 * past acceptable size. Mirror the snapshot store's 100 MB byte cap
 * (MAX_SNAPSHOT_BYTES, src/pipeline/snapshot.ts) so pruneArchives evicts oldest
 * entries until the per-tool total fits, even when the count is under the
 * entry cap. The single most-recent entry is never evicted (it is the rollback
 * a sync run just promised), matching pruneSnapshots' last-entry guarantee.
 */
export const MAX_ARCHIVE_BYTES = 100_000_000;

/**
 * Maximum archive entries retained per tool before pruning.
 *
 * Source: D2-SA2.7 retention contract — five entries balances local
 * rollback coverage (one entry per recent sync run) against disk-footprint
 * growth on long-lived projects. Override with HATCH3R_MAX_ARCHIVE_ENTRIES
 * env var (positive integer; default: 5). D2-22: the override is clamped to
 * {@link MAX_ARCHIVE_ENTRIES_CEILING} (50) so it can only lower retention.
 */
const MAX_ARCHIVE_ENTRIES = ((): number => {
  const envVal = process.env.HATCH3R_MAX_ARCHIVE_ENTRIES;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_ARCHIVE_ENTRIES_CEILING);
    }
  }
  return 5;
})();

/**
 * Prune old archive entries per tool. Enforces two retention caps, mirroring
 * the snapshot store (src/pipeline/snapshot.ts → pruneSnapshots):
 *
 * 1. Count cap — keep at most {@link MAX_ARCHIVE_ENTRIES} newest entries.
 * 2. Byte ceiling (D2-22) — after the count cap, evict remaining oldest entries
 *    until the per-tool directory total fits under {@link MAX_ARCHIVE_BYTES}.
 *
 * The single most-recent entry per tool is never evicted by either cap: it is
 * the rollback the latest sync run just produced, so dropping it would silently
 * void the recovery the user was promised — even if that one entry alone
 * exceeds the byte ceiling. This matches pruneSnapshots' last-session guard.
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
    // D2-SA2.7-02 (Cycle 12 Wave 3, D2, P6): `customize` is NOT a tool
    // run-dir. `archiveCustomizeOverrides` (src/content/index.ts) deposits the
    // "never hard-delete" user-override rescue store at
    // `.hatch3r-archive/customize/<type>/` under this same ARCHIVE_DIR root —
    // stable per-type directories, not timestamped run dirs. The count/byte
    // caps below would evict those type dirs (destroying the only copy of a
    // hand-authored override) once their number exceeds the retention cap,
    // reachable today via HATCH3R_MAX_ARCHIVE_ENTRIES set below the type-dir
    // count. Skipping the reserved `customize` child keeps the rescue store out
    // of the prune blast radius, honoring the D10-35 archive-never-hard-delete
    // contract. (Relocating the store out of ARCHIVE_DIR and surfacing pruned
    // entries at the sync/update call sites are the follow-on items in the
    // finding's recommendation, tracked separately — content/index.ts,
    // sync.ts, update.ts are outside this change's scope.)
    if (toolDir === "customize") continue;
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

    const evict = async (entry: string): Promise<void> => {
      await rm(join(toolPath, entry), { recursive: true, force: true });
      pruned.push(`${toolDir}/${entry}`);
    };

    // Cap 1: count. Remove everything past the Nth-newest entry.
    for (const entry of entries.slice(MAX_ARCHIVE_ENTRIES)) {
      await evict(entry);
    }

    // Cap 2: aggregate bytes (D2-22). Walk the survivors oldest→newest and
    // evict until the per-tool total is under the ceiling, but always keep the
    // single newest entry (index 0 after the descending sort).
    const survivors = entries.slice(0, MAX_ARCHIVE_ENTRIES);
    if (survivors.length > 1) {
      const sized = await Promise.all(
        survivors.map(async (entry) => ({
          entry,
          bytes: await archiveDirSizeBytes(join(toolPath, entry)),
        })),
      );
      let total = sized.reduce((sum, s) => sum + s.bytes, 0);
      // Oldest is the last element (descending sort); stop before index 0 so the
      // newest survivor is never evicted by the byte cap.
      for (let i = sized.length - 1; i >= 1 && total > MAX_ARCHIVE_BYTES; i--) {
        await evict(sized[i].entry);
        total -= sized[i].bytes;
      }
    }
  }

  return pruned;
}
