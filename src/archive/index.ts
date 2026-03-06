import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HatchManifest, Tool } from "../types.js";
import { HATCH3R_PREFIX, sanitizeId } from "../types.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import type { CustomizableType } from "../models/customize.js";

const ARCHIVE_DIR = ".hatch3r-archive";

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

const TOOL_PATH_PREFIXES: Record<Tool, string[]> = {
  cursor: [".cursor/"],
  claude: [".claude/", "CLAUDE.md", ".mcp.json"],
  copilot: [".github/copilot-instructions.md", ".github/workflows/copilot-setup-steps.yml", ".vscode/mcp.json"],
  windsurf: [".windsurf/", ".windsurfrules"],
  amp: [".amp/"],
  codex: [".codex/"],
  gemini: [".gemini/", "GEMINI.md"],
  cline: [".roo/", ".roomodes"],
  aider: ["CONVENTIONS.md", ".aider.conf.yml"],
  kiro: [".kiro/"],
  opencode: ["opencode.json"],
  goose: [".goosehints"],
  zed: [".rules"],
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

async function collectToolFiles(rootDir: string, tool: Tool): Promise<string[]> {
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
            const relPath = join(prefix, parent.slice(absPath.length), entry.name);
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
            await writeFile(customizePath, customContent + "\n", "utf-8");
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
    await rm(absPath);
    archivedFiles.push(relPath);
  }

  await cleanEmptyDirs(rootDir, filesToArchive);

  return { archivedFiles, migrations };
}

async function cleanEmptyDirs(rootDir: string, paths: string[]): Promise<void> {
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
