import { readdir, stat, access } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { HATCH3R_DIR } from "../types.js";

/** Legacy `.agents/` directory name retained only for backward-compatible probes. */
const LEGACY_AGENTS_DIR = ".agents";

/**
 * Wave 6/7: probe `.hatch3r/` first (new layout), fall back to `.agents/` so
 * pre-1.9 installs still detect as workspaces / hatch3r repos until the
 * migration shim relocates them on the next pipeline run.
 */
async function accessHatchOrLegacy(rootDir: string, relPath: string): Promise<boolean> {
  for (const dir of [HATCH3R_DIR, LEGACY_AGENTS_DIR]) {
    try {
      await access(join(rootDir, dir, relPath));
      return true;
    } catch (err) {
      // Continue to the legacy probe. Surface the per-probe failure via
      // verbose() so silent fallbacks remain observable per the Silent
      // Failure Contract (CONSTITUTION.md §2 P5).
      const message = err instanceof Error ? err.message : String(err);
      verbose(`workspace/detect: access(${join(rootDir, dir, relPath)}) — ${message}`);
    }
  }
  return false;
}
import { verbose } from "../cli/shared/ui.js";
import { WORKSPACE_MANIFEST_FILE } from "./types.js";

/**
 * Record a filesystem-probe failure: emit a verbose() line to stderr (visible
 * only with --verbose) so silent fallbacks remain observable. Per D8-H8.4.6
 * (C9-H19) the Silent Failure Contract requires every catch to emit a
 * diagnostic; probes for "does X exist?" cannot push to caller warnings (no
 * channel exists), so verbose() is the minimum-viable diagnostic surface.
 */
function recordProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`workspace/detect: ${operation} — ${message}`);
}

/**
 * A git repository discovered during workspace scanning.
 *
 * Returned by `detectSubRepos()` when scanning a directory for
 * potential workspace members.
 */
export interface DetectedRepo {
  /** Relative path from workspace root (same as directory name for top-level repos). */
  path: string;
  /** Directory name (default display name). */
  name: string;
  /** Whether this repo already has a `.agents/hatch.json` setup. */
  hasHatch3r: boolean;
}

/**
 * D14-M3 (Cycle 10 rollover): maximum recursion depth for the sub-repo
 * scan. The legacy `detectSubRepos` only walked one level deep — fine for
 * a textbook `repos/<name>` layout but it missed the `apps/<area>/<name>`
 * monorepo shape that the workspace classifier's upward walk
 * ({@link MAX_WORKSPACE_PARENT_WALK}=10) already supports. The descend cap
 * mirrors the upward walk so workspace suggestion and member
 * classification stay symmetric.
 *
 * Set to 4 (not 10) because the descent fans out: at every level we list
 * the directory and stat each entry, so 4 levels with ~20 entries each is
 * 8000 stat calls in the worst case — still bounded but well below the
 * 10-level upward walk's single-chain cost. Real monorepo layouts
 * (apps/<area>/<name> = 3 levels, packages/<scope>/<name> = 3 levels) fit
 * comfortably under 4.
 */
const MAX_SUBREPO_DESCEND_DEPTH = 4;

/**
 * Scan subdirectories of rootDir for git repositories.
 * Returns directories that contain a .git folder or file (worktree).
 *
 * D14-M3 (Cycle 10): the scan recurses up to {@link MAX_SUBREPO_DESCEND_DEPTH}
 * levels below `rootDir` so deeply-nested monorepo members (apps/web/api,
 * packages/scope/name) are still discovered. Hidden directories and
 * `node_modules` are skipped at every level; a directory that is itself a
 * git repo terminates the recursion at that subtree (we do not list
 * sub-repos OF a sub-repo for the workspace-suggestion banner — that would
 * be confusing UX). The returned `path` is the rel-path from `rootDir`
 * (e.g. `apps/web` rather than `web`), so workspace-init can register the
 * full sub-tree address.
 */
export async function detectSubRepos(rootDir: string): Promise<DetectedRepo[]> {
  const repos: DetectedRepo[] = [];

  async function visit(currentDir: string, relPrefix: string, depth: number): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      recordProbeFailure(`readdir(${currentDir}) failed`, err);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden directories and node_modules at every depth.
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const subDir = join(currentDir, entry.name);
      const gitPath = join(subDir, ".git");
      const childRelPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

      let isGitRepo = false;
      try {
        const gitStat = await stat(gitPath);
        // .git can be a directory (normal repo) or file (worktree)
        isGitRepo = gitStat.isDirectory() || gitStat.isFile();
      } catch (err) {
        // Not a git repo — expected for most subdirectories. Surface under --verbose
        // so unexpected failures (e.g., permission denied) remain observable.
        recordProbeFailure(`stat(${gitPath}) — not a git repo`, err);
      }

      if (isGitRepo) {
        // Wave 6: accept either `.hatch3r/hatch.json` (new layout) or
        // `.agents/hatch.json` (pre-1.9 layout) as a hatch3r-managed repo.
        const hasHatch3r = await accessHatchOrLegacy(subDir, "hatch.json");
        if (!hasHatch3r) {
          // No existing hatch3r setup — expected for repos not yet onboarded.
          // Surface under --verbose so unexpected failures (e.g., permission) remain observable.
          recordProbeFailure(
            `access(${subDir}/{${HATCH3R_DIR},${LEGACY_AGENTS_DIR}}/hatch.json) — no hatch3r setup`,
            new Error("ENOENT on both new and legacy paths"),
          );
        }

        repos.push({
          path: childRelPath,
          name: entry.name,
          hasHatch3r,
        });
        // Terminate the recursion at the first git repo on this subtree —
        // a sub-repo's own sub-tree is its own concern, not the workspace's.
        continue;
      }

      // Not a git repo — descend if we still have depth budget.
      if (depth + 1 < MAX_SUBREPO_DESCEND_DEPTH) {
        await visit(subDir, childRelPath, depth + 1);
      }
    }
  }

  await visit(rootDir, "", 0);

  return repos.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * F1.9-H2 (Cycle 10 D1): maximum number of parent directories to walk when
 * classifying a directory as a workspace member. The prior hard cap of 3 was
 * undocumented and too shallow: a real monorepo layout such as
 * `apps/<area>/<name>/src/` puts a member 4+ levels below the workspace root,
 * so the walk exited early and mis-classified the repo as `standalone`. A
 * value of 10 covers observed nesting depths in pnpm/nx/turborepo layouts
 * (sources in the finding) with margin; the walk still terminates early at the
 * filesystem root (`parent === current`). Raising rather than removing the cap
 * keeps a bounded upper limit on filesystem probes per call.
 */
const MAX_WORKSPACE_PARENT_WALK = 10;

/**
 * Classification of a directory's relationship to a workspace.
 *
 * - `workspace-root`: directory contains `.agents/workspace.json`
 * - `workspace-member`: directory is inside a workspace root (up to
 *   {@link MAX_WORKSPACE_PARENT_WALK} levels up, or the filesystem root,
 *   whichever comes first)
 * - `standalone`: no workspace relationship detected
 */
export interface WorkspaceContext {
  /** How this directory relates to a workspace. */
  type: "workspace-root" | "workspace-member" | "standalone";
  /** Absolute path to the workspace root (if applicable). */
  workspaceRoot?: string;
  /** Relative path from the member directory to the workspace root (if applicable). */
  rootPath?: string;
}

/**
 * Check if the given directory has a .git directory.
 */
async function hasGitDir(dir: string): Promise<boolean> {
  try {
    const gitStat = await stat(join(dir, ".git"));
    return gitStat.isDirectory() || gitStat.isFile();
  } catch (err) {
    recordProbeFailure(`hasGitDir(${dir}) — no .git`, err);
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
  // Check 1: Is this directory a workspace root? (Wave 6: probe new + legacy.)
  if (await accessHatchOrLegacy(dir, WORKSPACE_MANIFEST_FILE)) {
    return { type: "workspace-root", workspaceRoot: dir };
  }
  recordProbeFailure(
    `access(${dir}/{${HATCH3R_DIR},${LEGACY_AGENTS_DIR}}/${WORKSPACE_MANIFEST_FILE}) — not a workspace root`,
    new Error("ENOENT on both new and legacy paths"),
  );

  // Check 2: Walk up toward the filesystem root looking for workspace.json.
  // F1.9-H2: cap raised from 3 to MAX_WORKSPACE_PARENT_WALK so deeply-nested
  // monorepo members (e.g. `apps/<area>/<name>/src/`) are still classified as
  // members instead of falling through to `standalone`.
  let current = dirname(dir);
  const visited: string[] = [dir];
  for (let i = 0; i < MAX_WORKSPACE_PARENT_WALK; i++) {
    visited.push(current);
    if (await accessHatchOrLegacy(current, WORKSPACE_MANIFEST_FILE)) {
      return {
        type: "workspace-member",
        workspaceRoot: current,
        rootPath: relative(dir, current),
      };
    }
    recordProbeFailure(
      `access(${current}/{${HATCH3R_DIR},${LEGACY_AGENTS_DIR}}/${WORKSPACE_MANIFEST_FILE}) — continuing parent walk`,
      new Error("ENOENT on both new and legacy paths"),
    );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // F1.9-H2: emit a single verbose() summary of the search path when the walk
  // terminates without a workspace root, so an operator who expected a member
  // classification can see how far the walk reached (Silent Failure Contract,
  // CONSTITUTION §2 P5).
  verbose(
    `workspace/detect: ${dir} classified standalone — no ${WORKSPACE_MANIFEST_FILE} ` +
      `found walking ${visited.length} dir(s) up to ${current} ` +
      `(cap ${MAX_WORKSPACE_PARENT_WALK})`,
  );
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
  // Wave 6: accept new (`.hatch3r/`) or legacy (`.agents/`) workspace marker.
  if (await accessHatchOrLegacy(dir, WORKSPACE_MANIFEST_FILE)) {
    return true;
  }
  recordProbeFailure(
    `isWorkspaceRoot(${dir}) — no {${HATCH3R_DIR},${LEGACY_AGENTS_DIR}}/${WORKSPACE_MANIFEST_FILE}`,
    new Error("ENOENT on both new and legacy paths"),
  );
  return false;
}
