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
import { readWorkspaceManifest } from "./manifest.js";

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
 * D1-31 (Cycle 11 Wave 3, D1): outcome of confirming that `dir` is a
 * *registered* member of the workspace rooted at `root`. Membership is
 * registration-based, not presence-based: a directory is only a member when
 * its rel-path from the root equals — or is nested inside — a `repos[].path`
 * entry in the root's `workspace.json`. `"unverifiable"` is returned when the
 * manifest cannot be read/validated (a concurrent rewrite, malformed JSON, or
 * a race that deletes it between the existence probe and the read): the caller
 * falls back to the legacy presence-based classification so a corrupt manifest
 * degrades to the prior behavior instead of crashing the UI-hint path.
 */
type MembershipCheck = "registered" | "not-registered" | "unverifiable";

/**
 * D1-31 (Cycle 11 Wave 3, D1): confirm `dir` is registered in the workspace
 * manifest at `root`. The bug this fixes: `detectWorkspaceContext` previously
 * returned `workspace-member` for ANY directory under an ancestor that merely
 * *contained* a `workspace.json` — an existence probe with no `repos[]` check.
 * That mis-classified unregistered siblings of real members (and the
 * workspace-suggestion scaffolding before any repo was registered), so
 * consumers (config.ts, sync.ts, clean/index.ts) emitted false
 * "managed / overwritten on sync" warnings.
 *
 * Registration is satisfied when the rel-path from `root` to `dir` equals a
 * registered `repos[].path` OR is nested under one (a file inside a registered
 * member is still within the managed sub-tree that workspace sync writes to via
 * `join(workspaceRoot, repoEntry.path)`). Path separators are normalized to
 * posix because manifest paths are always forward-slash (produced by
 * {@link detectSubRepos}'s `childRelPath` and persisted verbatim by
 * `init`/workspace sync), while `relative()` yields `\` on Windows.
 */
async function confirmRegisteredMember(root: string, dir: string): Promise<MembershipCheck> {
  let manifest: Awaited<ReturnType<typeof readWorkspaceManifest>>;
  try {
    manifest = await readWorkspaceManifest(root);
  } catch (err) {
    // Malformed JSON or schema-invalid manifest. readWorkspaceManifest throws
    // HatchError here; detectWorkspaceContext is a best-effort UI-hint probe
    // that must not crash its callers, so degrade to the legacy presence-based
    // verdict (CONSTITUTION §2 P5 Silent Failure Contract: emit a diagnostic).
    recordProbeFailure(`readWorkspaceManifest(${root}) — manifest unreadable, membership unverifiable`, err);
    return "unverifiable";
  }
  if (manifest === null) {
    // The existence probe saw a `workspace.json` but the read found none — a
    // race (concurrent rm) or the legacy `.agents/` layout that
    // readWorkspaceManifest (which only reads `.hatch3r/`) does not cover. Fall
    // back to presence-based classification rather than dropping a real member.
    return "unverifiable";
  }

  const relFromRoot = relative(root, dir).split("\\").join("/");
  for (const entry of manifest.repos) {
    const repoPath = entry.path.split("\\").join("/");
    if (relFromRoot === repoPath || relFromRoot.startsWith(`${repoPath}/`)) {
      return "registered";
    }
  }
  return "not-registered";
}

/**
 * Detect the workspace context for a given directory.
 *
 * Returns:
 * - "workspace-root" if the dir has .agents/workspace.json
 * - "workspace-member" if an ancestor has a workspace.json AND `dir`'s rel-path
 *   from that ancestor is registered in the manifest's `repos[]` (equals or is
 *   nested under a `repos[].path`). Registration-based, not presence-based
 *   (D1-31): an unregistered directory under a workspace root is `standalone`,
 *   not a false member. When the manifest is unreadable the classifier degrades
 *   to the legacy presence-based verdict so a corrupt file does not crash the
 *   UI-hint path.
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
  // D1-31: track workspace roots whose `repos[]` did NOT register `dir`, so the
  // standalone diagnostic can distinguish "no workspace.json found at all" from
  // "found a workspace root but `dir` is not a registered member of it".
  const unregisteredRoots: string[] = [];
  for (let i = 0; i < MAX_WORKSPACE_PARENT_WALK; i++) {
    visited.push(current);
    if (await accessHatchOrLegacy(current, WORKSPACE_MANIFEST_FILE)) {
      // D1-31: presence of a workspace.json up the tree is necessary but NOT
      // sufficient — confirm `dir` is a registered member of THIS root before
      // returning. `unverifiable` (manifest unreadable/legacy-layout) degrades
      // to the legacy presence-based verdict so a corrupt file does not crash
      // callers and a real member is never silently dropped.
      const membership = await confirmRegisteredMember(current, dir);
      if (membership === "registered" || membership === "unverifiable") {
        return {
          type: "workspace-member",
          workspaceRoot: current,
          rootPath: relative(dir, current),
        };
      }
      // not-registered: `dir` lives under this workspace root but is not one of
      // its `repos[]`. Keep walking — a higher enclosing workspace could still
      // register `dir` (nested workspaces). Record the rejection for the
      // standalone diagnostic.
      unregisteredRoots.push(current);
    } else {
      recordProbeFailure(
        `access(${current}/{${HATCH3R_DIR},${LEGACY_AGENTS_DIR}}/${WORKSPACE_MANIFEST_FILE}) — continuing parent walk`,
        new Error("ENOENT on both new and legacy paths"),
      );
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // F1.9-H2 / D1-31: emit a single verbose() summary of the search path when the
  // walk terminates without a registering workspace root, so an operator who
  // expected a member classification can see how far the walk reached and
  // whether a workspace root was found but rejected for non-registration
  // (Silent Failure Contract, CONSTITUTION §2 P5).
  const rejectionNote =
    unregisteredRoots.length > 0
      ? ` (found workspace root(s) ${unregisteredRoots.join(", ")} but ${dir} is not in their repos[])`
      : "";
  verbose(
    `workspace/detect: ${dir} classified standalone — no ${WORKSPACE_MANIFEST_FILE} ` +
      `registering it found walking ${visited.length} dir(s) up to ${current} ` +
      `(cap ${MAX_WORKSPACE_PARENT_WALK})${rejectionNote}`,
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
