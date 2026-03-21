import { readdir, stat, access } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { AGENTS_DIR } from "../types.js";
import { WORKSPACE_MANIFEST_FILE } from "./types.js";

export interface DetectedRepo {
  /** Relative path from workspace root. */
  path: string;
  /** Directory name (default display name). */
  name: string;
  /** Whether this repo already has a hatch3r setup. */
  hasHatch3r: boolean;
}

/**
 * Scan immediate subdirectories of rootDir for git repositories.
 * Returns directories that contain a .git folder or file (worktree).
 */
export async function detectSubRepos(rootDir: string): Promise<DetectedRepo[]> {
  const repos: DetectedRepo[] = [];

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return repos;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip hidden directories and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const subDir = join(rootDir, entry.name);
    const gitPath = join(subDir, ".git");

    let isGitRepo = false;
    try {
      const gitStat = await stat(gitPath);
      // .git can be a directory (normal repo) or file (worktree)
      isGitRepo = gitStat.isDirectory() || gitStat.isFile();
    } catch {
      // Not a git repo
    }

    if (!isGitRepo) continue;

    let hasHatch3r = false;
    try {
      await access(join(subDir, AGENTS_DIR, "hatch.json"));
      hasHatch3r = true;
    } catch {
      // No existing hatch3r setup
    }

    repos.push({
      path: entry.name,
      name: entry.name,
      hasHatch3r,
    });
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

export interface WorkspaceContext {
  type: "workspace-root" | "workspace-member" | "standalone";
  workspaceRoot?: string;
  rootPath?: string;
}

/**
 * Check if the given directory has a .git directory.
 */
async function hasGitDir(dir: string): Promise<boolean> {
  try {
    const gitStat = await stat(join(dir, ".git"));
    return gitStat.isDirectory() || gitStat.isFile();
  } catch {
    return false;
  }
}

/**
 * Detect the workspace context for a given directory.
 *
 * Returns:
 * - "workspace-root" if the dir has .agents/workspace.json
 * - "workspace-member" if the dir's hatch.json has a workspace.rootPath
 *   pointing to a valid workspace root
 * - "standalone" otherwise
 */
export async function detectWorkspaceContext(dir: string): Promise<WorkspaceContext> {
  // Check 1: Is this directory a workspace root?
  try {
    await access(join(dir, AGENTS_DIR, WORKSPACE_MANIFEST_FILE));
    return { type: "workspace-root", workspaceRoot: dir };
  } catch {
    // Not a workspace root
  }

  // Check 2: Walk up to 3 levels looking for workspace.json
  let current = dirname(dir);
  for (let i = 0; i < 3; i++) {
    try {
      await access(join(current, AGENTS_DIR, WORKSPACE_MANIFEST_FILE));
      return {
        type: "workspace-member",
        workspaceRoot: current,
        rootPath: relative(dir, current),
      };
    } catch {
      // Continue
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { type: "standalone" };
}

/**
 * Determine if CWD looks like it should be a workspace root:
 * - No .git directory
 * - Has subdirectories with .git
 */
export async function shouldSuggestWorkspace(dir: string): Promise<boolean> {
  if (await hasGitDir(dir)) return false;

  const repos = await detectSubRepos(dir);
  return repos.length > 0;
}

/**
 * Check if a directory is a workspace root (has workspace.json).
 */
export async function isWorkspaceRoot(dir: string): Promise<boolean> {
  try {
    await access(join(dir, AGENTS_DIR, WORKSPACE_MANIFEST_FILE));
    return true;
  } catch {
    return false;
  }
}
