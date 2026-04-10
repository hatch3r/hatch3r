import { access, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { HatchManifest, Tool } from "../types.js";
import { ARCHIVE_DIR, HATCH3R_PREFIX, sanitizeId } from "../types.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type { CustomizableType } from "../models/customize.js";

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

// #255 (D9-9.26): Added "AGENTS.md" to amp prefixes so archive cleanup catches amp's root-level output.
// #256 (D9-9.27): Added ".aider/" to aider prefixes so archive cleanup catches aider's skills subdirectory.
export const TOOL_PATH_PREFIXES: Record<Tool, string[]> = {
  cursor: [".cursor/"],
  claude: [".claude/", "CLAUDE.md", ".mcp.json"],
  copilot: [".github/copilot-instructions.md", ".github/workflows/copilot-setup-steps.yml", ".vscode/mcp.json", ".github/instructions/", ".github/agents/", ".github/prompts/", ".github/skills/"],
  windsurf: [".windsurf/", ".windsurfrules"],
  amp: [".amp/", "AGENTS.md"],
  codex: [".codex/"],
  gemini: [".gemini/", "GEMINI.md"],
  cline: [".cline/", ".clinerules/", ".roo/", ".roomodes"],
  aider: ["CONVENTIONS.md", ".aider.conf.yml", ".aider/"],
  kiro: [".kiro/"],
  opencode: ["opencode.json", ".opencode/"],
  goose: [".goosehints", ".goose/"],
  zed: [".rules"],
  "amazon-q": [".amazonq/"],
  antigravity: [".antigravity/"],
  "agents-md": ["AGENTS.md"],
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

function fileMatchesTool(filePath: string, tool: Tool): boolean {
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
  } catch {
    return false;
  }
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
      } catch {
        // directory doesn't exist
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

    if (hasManagedBlock(content)) {
      const customContent = stripFrontmatter(extractCustomContent(content));
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
    // Verify the copy succeeded before removing the original
    const srcStat = await stat(absPath);
    const destStat = await stat(archiveDest);
    if (destStat.size !== srcStat.size) {
      throw new Error(`Archive copy size mismatch for ${relPath}: source=${srcStat.size}, dest=${destStat.size}`);
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
    } catch {
      // directory may not exist or already removed
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

const MAX_ARCHIVE_ENTRIES = 5;

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
