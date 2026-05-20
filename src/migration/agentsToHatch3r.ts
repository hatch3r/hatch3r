import { access, mkdir, readdir, rename, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HATCH3R_DIR, MANIFEST_FILE } from "../types.js";

/**
 * Legacy `.agents/` directory name retained ONLY in this migration shim.
 * Every other call site has been moved to `HATCH3R_DIR`; do not import this
 * constant from outside `src/migration/`.
 */
const AGENTS_DIR = ".agents";

/**
 * Wave 6 + Wave 5 — one-shot relocation of the legacy `.agents/` footprint
 * to `.hatch3r/`. Called from `runInit`/`runSync`/`runUpdate`/`runRegenerate`/
 * `syncWorkspaceRepos` so every user-facing pipeline migrates pre-1.9
 * installs before doing any new work.
 *
 * Scope (Wave 6 + Wave 5 ownership):
 *   - `.agents/hatch.json`      -> `.hatch3r/hatch.json`        (Wave 6)
 *   - `.agents/learnings/`      -> `.hatch3r/learnings/`        (Wave 6)
 *   - `.agents/handoffs/`       -> `.hatch3r/handoffs/`         (Wave 6)
 *   - `.agents/mcp/mcp.json`    -> `.hatch3r/mcp/mcp.json`      (Wave 6)
 *   - `.agents/user/`           -> `.hatch3r/overrides/`        (Wave 5)
 *
 * Out of scope (left for other waves):
 *   - `.integrity.json` / etc.  -> Wave 7 (integrity + clean rewrites)
 *
 * The shim is idempotent: every move first checks that the source exists and
 * the destination does NOT. On a fully migrated tree every call is a no-op.
 * After moves, `.agents/` is only removed when it is completely empty —
 * surviving entries (e.g. Wave 7 not yet run, or unrelated user files)
 * keep the directory in place.
 *
 * Returns the list of repo-relative paths that moved so callers can surface
 * a single consolidated warning to the operator.
 */
export interface AgentsToHatch3rMigrationResult {
  /** Repo-relative paths that were moved from `.agents/` to `.hatch3r/`. */
  moved: string[];
  /** True when the now-empty `.agents/` directory was removed. */
  removedLegacyDir: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function moveFileIfPossible(
  oldPath: string,
  newPath: string,
): Promise<boolean> {
  if (!(await exists(oldPath))) return false;
  if (await exists(newPath)) return false;
  await mkdir(dirname(newPath), { recursive: true });
  await rename(oldPath, newPath);
  return true;
}

async function moveDirIfPossible(
  oldDir: string,
  newDir: string,
): Promise<boolean> {
  if (!(await exists(oldDir))) return false;
  if (await exists(newDir)) return false;
  const oldStat = await stat(oldDir);
  if (!oldStat.isDirectory()) return false;
  await mkdir(dirname(newDir), { recursive: true });
  await rename(oldDir, newDir);
  return true;
}

/**
 * One-shot relocation of `.agents/` -> `.hatch3r/`. Safe to call on every
 * pipeline entry — idempotent and silent when nothing needs to move.
 *
 * The legacy `.agents/` directory is only removed when it ends up empty after
 * moves. When Wave 7 (integrity) has not yet migrated its own subtrees,
 * leftover entries keep `.agents/` on disk so those waves still have something
 * to act on.
 */
export async function migrateAgentsToHatch3r(
  rootDir: string,
): Promise<AgentsToHatch3rMigrationResult> {
  const moved: string[] = [];
  const oldRoot = join(rootDir, AGENTS_DIR);

  // Fast path: no legacy directory at all.
  if (!(await exists(oldRoot))) {
    return { moved, removedLegacyDir: false };
  }

  // hatch.json
  if (
    await moveFileIfPossible(
      join(oldRoot, MANIFEST_FILE),
      join(rootDir, HATCH3R_DIR, MANIFEST_FILE),
    )
  ) {
    moved.push(`${AGENTS_DIR}/${MANIFEST_FILE} -> ${HATCH3R_DIR}/${MANIFEST_FILE}`);
  }

  // learnings/ (whole subtree)
  if (
    await moveDirIfPossible(
      join(oldRoot, "learnings"),
      join(rootDir, HATCH3R_DIR, "learnings"),
    )
  ) {
    moved.push(`${AGENTS_DIR}/learnings/ -> ${HATCH3R_DIR}/learnings/`);
  }

  // handoffs/ (whole subtree)
  if (
    await moveDirIfPossible(
      join(oldRoot, "handoffs"),
      join(rootDir, HATCH3R_DIR, "handoffs"),
    )
  ) {
    moved.push(`${AGENTS_DIR}/handoffs/ -> ${HATCH3R_DIR}/handoffs/`);
  }

  // mcp/mcp.json (single file under mcp/)
  if (
    await moveFileIfPossible(
      join(oldRoot, "mcp", "mcp.json"),
      join(rootDir, HATCH3R_DIR, "mcp", "mcp.json"),
    )
  ) {
    moved.push(`${AGENTS_DIR}/mcp/mcp.json -> ${HATCH3R_DIR}/mcp/mcp.json`);
  }
  // If `.agents/mcp/` is now empty (we just moved its only file), drop it
  // so the legacy-dir emptiness check below has a chance to clear `.agents/`.
  try {
    const mcpDir = join(oldRoot, "mcp");
    if (await exists(mcpDir)) {
      const entries = await readdir(mcpDir);
      if (entries.length === 0) await rmdir(mcpDir);
    }
  } catch (err) {
    // Best-effort cleanup; the legacy `.agents/mcp/` removal is purely a
    // tidiness step. Surface the failure on stderr only when the runtime
    // is in a verbose mode (process.env.HATCH3R_VERBOSE) so silent
    // fallbacks remain observable per the Silent Failure Contract.
    if (process.env.HATCH3R_VERBOSE) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[hatch3r] migration: legacy .agents/mcp/ cleanup skipped — ${message}`);
    }
  }

  // user/ (Wave 5) — D20 user-authored content moves to `.hatch3r/overrides/`.
  // The whole `.agents/user/` subtree relocates wholesale; `resolveUserContentRoot`
  // now resolves to `.hatch3r/overrides/` so adapter reads + saveUserContent
  // follow the new path automatically.
  if (
    await moveDirIfPossible(
      join(oldRoot, "user"),
      join(rootDir, HATCH3R_DIR, "overrides"),
    )
  ) {
    moved.push(`${AGENTS_DIR}/user/ -> ${HATCH3R_DIR}/overrides/`);
  }

  // Attempt to remove the now-empty `.agents/` shell. Anything left behind
  // (e.g. `.agents/.integrity.json` until Wave 7) keeps the directory.
  let removedLegacyDir = false;
  try {
    const remaining = await readdir(oldRoot);
    if (remaining.length === 0) {
      await rmdir(oldRoot);
      removedLegacyDir = true;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (moved.length > 0) {
    const summary = moved.map((m) => `  - ${m}`).join("\n");
    const tail = removedLegacyDir
      ? `\n  Legacy ${AGENTS_DIR}/ removed (was empty after moves).`
      : `\n  Legacy ${AGENTS_DIR}/ kept (other artifacts still present).`;
    // One consolidated console warning; entry-point pipelines decide whether
    // to suppress in --quiet/--json modes by funnelling this through a logger.
    console.warn(
      `[hatch3r] Relocated legacy ${AGENTS_DIR}/ state to ${HATCH3R_DIR}/:\n${summary}${tail}`,
    );
  }

  return { moved, removedLegacyDir };
}
