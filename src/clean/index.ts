import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TOOL_PATH_PREFIXES, collectToolFiles, cleanEmptyDirs } from "../archive/index.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import { readManifest } from "../manifest/hatchJson.js";
import {
  ARCHIVE_DIR,
  HATCH3R_DIR,
  TOOLS,
  WORKTREE_INCLUDE_FILE,
  type HatchManifest,
  type Tool,
} from "../types.js";
import { detectWorkspaceContext } from "../workspace/detect.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record a clean-probe failure: emit a verbose() line to stderr (visible only
 * with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract.
 */
function recordCleanProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`clean: ${operation} — ${message}`);
}

/**
 * Wave 7 clean contract:
 *   - strip managed blocks from every adapter-output file the manifest
 *     tracks (preserving any user-authored content outside the markers);
 *   - delete `.hatch3r/hatch.json`;
 *   - delete `.hatch3r-archive/` (tool-output archive — the copies of a
 *     removed tool's adapter outputs that `archiveToolOutputs` stashes
 *     before deleting the originals; NOT the rollback snapshots, which live
 *     under `.hatch3r/snapshots/` and are out of scope for `clean`);
 *   - preserve user state under `.hatch3r/`:
 *       learnings/, handoffs/, overrides/ (Wave 5), mcp/, plus any
 *       `.customize.yaml` / `.customize.md` files alongside.
 *
 * No canonical `.agents/` tree exists anymore (Wave 3+4), so the previous
 * "remove `.agents/`" branch was deleted. Pre-1.9 installs that still have
 * a `.agents/` directory will see it removed only if the pipeline-time
 * migration shim (`migrateAgentsToHatch3r`) already moved its contents out.
 */
export interface CleanInventory {
  /** Adapter-output files (from `manifest.managedFiles` + prefix scan) that exist on disk. */
  adapterFiles: string[];
  /** `.hatch3r/hatch.json` is present. */
  manifestPresent: boolean;
  /** `.hatch3r-archive/` is present. */
  archiveDir: boolean;
  /** `.hatch3r/` (state + user content + customizations) is present and will be preserved. */
  hatch3rDir: boolean;
  /** `.worktreeinclude` is present. */
  worktreeInclude: boolean;
  /** `.env.mcp` is present (always preserved). */
  envMcp: boolean;
  /** Root `AGENTS.md` has user content above/below the managed block. */
  agentsMdHasUserContent: boolean;
  /** Workspace topology context (informational; influences UX warnings only). */
  isWorkspaceRoot: boolean;
  isWorkspaceMember: boolean;
  workspaceRootPath: string | null;
  /** The full manifest, captured before deletion so reinit can reapply config. */
  manifest: HatchManifest | null;
}

export interface CleanResult {
  removed: string[];
  kept: string[];
  errors: string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    recordCleanProbeFailure(`fileExists(${path}) — not present`, err);
    return false;
  }
}

export async function inventoryArtifacts(rootDir: string): Promise<CleanInventory> {
  const manifest = await readManifest(rootDir);

  // Collect adapter files from manifest tracking + prefix scanning so an
  // orphaned output (renamed adapter target, removed adapter) is still
  // surfaced by clean.
  const adapterFileSet = new Set<string>();
  if (manifest) {
    for (const f of manifest.managedFiles) {
      adapterFileSet.add(f);
    }
  }
  const toolsToScan: Tool[] = manifest ? manifest.tools : [...TOOLS];
  for (const tool of toolsToScan) {
    const files = await collectToolFiles(rootDir, tool);
    for (const f of files) {
      adapterFileSet.add(f);
    }
  }

  // Filter to only files that actually exist, excluding the shared bridge file
  // (AGENTS.md) which gets managed-block-preservation cleanup in `executeClean`.
  const adapterFiles: string[] = [];
  for (const f of adapterFileSet) {
    if (f === "AGENTS.md") continue;
    if (await fileExists(join(rootDir, f))) {
      adapterFiles.push(f);
    }
  }

  // Sibling `.bak` files left behind by the safeWriteFile auto-repair path
  // (managed-block corruption recovery in src/merge/safeWrite.ts).
  for (const f of [...adapterFiles]) {
    const bakRel = f + ".bak";
    if (await fileExists(join(rootDir, bakRel))) {
      adapterFiles.push(bakRel);
    }
  }

  // Root AGENTS.md user-content probe.
  let agentsMdHasUserContent = false;
  const agentsMdPath = join(rootDir, "AGENTS.md");
  if (await fileExists(agentsMdPath)) {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      if (hasManagedBlock(content, agentsMdPath)) {
        const userContent = extractCustomContent(content, agentsMdPath).trim();
        agentsMdHasUserContent = userContent.length > 0;
      }
    } catch (err) {
      recordCleanProbeFailure(
        `inventoryArtifacts: readFile(${agentsMdPath}) — treating as no user content`,
        err,
      );
    }
  }

  const wsContext = await detectWorkspaceContext(rootDir);

  return {
    adapterFiles,
    manifestPresent: await fileExists(join(rootDir, HATCH3R_DIR, "hatch.json")),
    archiveDir: await fileExists(join(rootDir, ARCHIVE_DIR)),
    hatch3rDir: await fileExists(join(rootDir, HATCH3R_DIR)),
    worktreeInclude: await fileExists(join(rootDir, WORKTREE_INCLUDE_FILE)),
    envMcp: await fileExists(join(rootDir, ".env.mcp")),
    agentsMdHasUserContent,
    isWorkspaceRoot: wsContext.type === "workspace-root",
    isWorkspaceMember: wsContext.type === "workspace-member",
    workspaceRootPath: wsContext.type === "workspace-member" ? wsContext.rootPath ?? null : null,
    manifest,
  };
}

export async function executeClean(
  rootDir: string,
  inventory: CleanInventory,
  dryRun: boolean,
): Promise<CleanResult> {
  const removed: string[] = [];
  const kept: string[] = [];
  const errors: string[] = [];

  if (dryRun) {
    for (const f of inventory.adapterFiles) {
      removed.push(f);
    }
    if (inventory.manifestPresent) removed.push(`${HATCH3R_DIR}/hatch.json`);
    if (inventory.worktreeInclude) removed.push(WORKTREE_INCLUDE_FILE);
    if (inventory.archiveDir) removed.push(`${ARCHIVE_DIR}/`);
    if (inventory.envMcp) kept.push(".env.mcp (contains secrets)");
    if (inventory.hatch3rDir) {
      kept.push(
        `${HATCH3R_DIR}/ (learnings/, handoffs/, overrides/, mcp/, customizations preserved)`,
      );
    }
    return { removed, kept, errors };
  }

  // 1. Strip managed blocks from adapter-output files. Files that contain
  //    only the managed block (and nothing user-authored) are removed
  //    outright; files with user content above/below the markers are
  //    rewritten in place with the markers and managed body excised.
  for (const f of inventory.adapterFiles) {
    const absPath = join(rootDir, f);
    try {
      let stripped = false;
      try {
        const content = await readFile(absPath, "utf-8");
        if (hasManagedBlock(content, absPath)) {
          const userContent = extractCustomContent(content, absPath).trim();
          if (userContent.length > 0) {
            await writeFile(absPath, userContent + "\n");
            kept.push(`${f} (user content preserved, managed block stripped)`);
            stripped = true;
          }
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          errors.push(`${f}: ${(err as Error).message}`);
        }
      }
      if (!stripped) {
        await rm(absPath, { force: true });
        removed.push(f);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors.push(`${f}: ${(err as Error).message}`);
      }
    }
  }

  // Clean empty directories left by adapter file removal
  await cleanEmptyDirs(rootDir, inventory.adapterFiles);

  // 2. Root AGENTS.md (shared bridge file) — managed-block-preservation semantics.
  const agentsMdPath = join(rootDir, "AGENTS.md");
  if (await fileExists(agentsMdPath)) {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      if (hasManagedBlock(content, agentsMdPath)) {
        const userContent = extractCustomContent(content, agentsMdPath).trim();
        if (userContent.length > 0) {
          await writeFile(agentsMdPath, userContent + "\n");
          kept.push("AGENTS.md (user content preserved, managed block stripped)");
        } else {
          await rm(agentsMdPath, { force: true });
          removed.push("AGENTS.md");
        }
      } else {
        kept.push("AGENTS.md (no managed block, left untouched)");
      }
    } catch (err) {
      errors.push(`AGENTS.md: ${(err as Error).message}`);
    }
  }

  // 3. Delete `.hatch3r/hatch.json`. Other `.hatch3r/` contents
  //    (learnings, handoffs, overrides, mcp, .customize.* files) are
  //    preserved — they are user state, not hatch3r-generated output.
  if (inventory.manifestPresent) {
    try {
      await rm(join(rootDir, HATCH3R_DIR, "hatch.json"), { force: true });
      removed.push(`${HATCH3R_DIR}/hatch.json`);
    } catch (err) {
      errors.push(`${HATCH3R_DIR}/hatch.json: ${(err as Error).message}`);
    }
  }

  // 4. `.worktreeinclude`
  if (inventory.worktreeInclude) {
    try {
      await rm(join(rootDir, WORKTREE_INCLUDE_FILE), { force: true });
      removed.push(WORKTREE_INCLUDE_FILE);
    } catch (err) {
      errors.push(`${WORKTREE_INCLUDE_FILE}: ${(err as Error).message}`);
    }
  }

  // 5. `.hatch3r-archive/` (tool-output archive — stashed copies of removed
  //    tools' adapter outputs, retention MAX_ARCHIVE_ENTRIES=5 per tool;
  //    distinct from the `.hatch3r/snapshots/` rollback store, which `clean`
  //    leaves untouched). Safe to remove on clean.
  if (inventory.archiveDir) {
    try {
      await rm(join(rootDir, ARCHIVE_DIR), { recursive: true, force: true });
      removed.push(`${ARCHIVE_DIR}/`);
    } catch (err) {
      errors.push(`${ARCHIVE_DIR}/: ${(err as Error).message}`);
    }
  }

  // 6. `.hatch3r/` user state — always preserved beyond the manifest.
  if (inventory.hatch3rDir) {
    kept.push(`${HATCH3R_DIR}/ (learnings, handoffs, overrides, mcp, customizations preserved)`);
  }

  // 7. `.env.mcp` — always preserved.
  if (inventory.envMcp) {
    kept.push(".env.mcp (contains secrets — remove manually if needed)");
  }

  // Silence the unused-import diagnostic for TOOL_PATH_PREFIXES — it is
  // re-exported indirectly via `collectToolFiles` above, but typescript
  // verbose-mode warnings can still trigger.
  void TOOL_PATH_PREFIXES;

  return { removed, kept, errors };
}

/**
 * Wave 7: learnings now live under `.hatch3r/learnings/` (Wave 6) and survive
 * `clean` automatically — they are never removed. `backupLearnings` is kept
 * as a no-op stub so the legacy `clean -> reinit` flow in
 * `src/cli/commands/clean.ts` does not need to be unwound in this wave; the
 * tmpdir-backup detour exists in the old code path only as protection for
 * the pre-Wave-6 contract where `.agents/learnings/` was about to be deleted.
 *
 * Returns null because there is nothing to restore — the directory is
 * already in its final resting place.
 */
export async function backupLearnings(_rootDir: string): Promise<string | null> {
  return null;
}

/**
 * Wave 7 companion to `backupLearnings`: no-op because nothing was backed up.
 * Signature preserved so the `clean` CLI command compiles without a parallel
 * Wave-7 rewrite of the command surface.
 */
export async function restoreLearnings(_rootDir: string, _backupPath: string): Promise<void> {
  // intentionally no-op
}

// Suppress unused-import diagnostics for the legacy helpers retained in
// `clean.ts` (tmpdir/cp/mkdir/readdir). They remain imported here so a
// future re-introduction of staged backups does not need a fresh refactor.
void tmpdir;
void cp;
void mkdir;
void readdir;
