import { lstat, readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Tool } from "../types.js";
import { hasManagedBlock } from "../merge/managedBlocks.js";
import { inspectRepositoryPath } from "../merge/repositoryPathSafety.js";
import { isCodexSharedPath, TOOL_PATH_PREFIXES } from "../codex/surfacePaths.js";
import { planCodexRemoval } from "../merge/codexOwnership.js";
import { recordArchiveProbeFailure } from "./diagnostics.js";

function toPosixPath(p: string): string {
  return sep === "\\" ? p.replaceAll("\\", "/") : p;
}

export async function isRegularFileNotSymlink(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

interface WildcardParts {
  parentRel: string;
  entryPrefix: string;
  suffix: string;
}

function wildcardEntryMatches(entry: import("node:fs").Dirent, parts: WildcardParts): boolean {
  if (!entry.name.startsWith(parts.entryPrefix)) return false;
  if (parts.suffix === "/") return entry.isDirectory();
  return entry.isFile() && entry.name.endsWith(parts.suffix) &&
    entry.name.length >= parts.entryPrefix.length + parts.suffix.length;
}

function parseWildcardPrefix(prefix: string): WildcardParts {
  const wildcard = prefix.indexOf("*");
  const literal = prefix.slice(0, wildcard);
  const slash = literal.lastIndexOf("/");
  return {
    parentRel: literal.slice(0, slash + 1),
    entryPrefix: literal.slice(slash + 1),
    suffix: prefix.slice(wildcard + 1),
  };
}

async function collectWildcardEntry(
  rootDir: string,
  tool: Tool,
  entry: import("node:fs").Dirent,
  parts: WildcardParts,
): Promise<string | null> {
  if (!wildcardEntryMatches(entry, parts)) return null;
  const entryRel = toPosixPath(join(parts.parentRel, entry.name));
  const entryAbs = join(rootDir, entryRel);
  const ownershipPath = parts.suffix === "/" ? join(entryAbs, "SKILL.md") : entryAbs;
  try {
    const content = await readFile(ownershipPath, "utf-8");
    if (!hasManagedBlock(content, ownershipPath)) return null;
    return parts.suffix === "/" ? toPosixPath(join(entryRel, "SKILL.md")) : entryRel;
  } catch (err) {
    recordArchiveProbeFailure(
      `collectToolFiles: inspect(${ownershipPath}) — wildcard candidate unavailable for ${tool}`,
      err,
    );
    return null;
  }
}

async function collectWildcardFiles(rootDir: string, tool: Tool, prefix: string): Promise<string[]> {
  const parts = parseWildcardPrefix(prefix);
  const absParent = join(rootDir, parts.parentRel);
  try {
    await inspectRepositoryPath(rootDir, parts.parentRel.replace(/\/+$/, ""));
    const entries = await readdir(absParent, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = await collectWildcardEntry(rootDir, tool, entry, parts);
      if (file) files.push(file);
    }
    return files;
  } catch (err) {
    recordArchiveProbeFailure(
      `collectToolFiles: readdir(${absParent}) — wildcard parent missing for ${tool}`,
      err,
    );
    return [];
  }
}

async function collectDirectoryFiles(rootDir: string, tool: Tool, prefix: string): Promise<string[]> {
  const absPath = join(rootDir, prefix);
  try {
    await inspectRepositoryPath(rootDir, prefix.replace(/\/+$/, ""));
    const entries = await readdir(absPath, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => {
      const parent = entry.parentPath ?? (entry as unknown as { path: string }).path ?? absPath;
      return toPosixPath(join(prefix, parent.slice(absPath.length), entry.name));
    });
  } catch (err) {
    recordArchiveProbeFailure(`collectToolFiles: readdir(${absPath}) — directory missing for ${tool}`, err);
    return [];
  }
}

async function collectExactFile(rootDir: string, tool: Tool, prefix: string): Promise<string[]> {
  const absPath = join(rootDir, prefix);
  if (!(await isRegularFileNotSymlink(absPath))) return [];
  try {
    await inspectRepositoryPath(rootDir, prefix);
    if (tool !== "codex" || !isCodexSharedPath(prefix)) return [prefix];
    const content = await readFile(absPath, "utf-8");
    return planCodexRemoval(prefix, absPath, content, false).disposition === "foreign" ? [] : [prefix];
  } catch (err) {
    recordArchiveProbeFailure(`collectToolFiles: inspect(${absPath}) — exact path unavailable for ${tool}`, err);
    return [];
  }
}

export async function collectToolFiles(rootDir: string, tool: Tool): Promise<string[]> {
  const files: string[] = [];
  for (const prefix of TOOL_PATH_PREFIXES[tool]) {
    const found = prefix.includes("*")
      ? await collectWildcardFiles(rootDir, tool, prefix)
      : prefix.endsWith("/")
        ? await collectDirectoryFiles(rootDir, tool, prefix)
        : await collectExactFile(rootDir, tool, prefix);
    files.push(...found);
  }
  return files;
}
