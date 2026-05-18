import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TOOL_PATH_PREFIXES, collectToolFiles, cleanEmptyDirs } from "../archive/index.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import { readManifest } from "../manifest/hatchJson.js";
import { AGENTS_DIR, ARCHIVE_DIR, CUSTOMIZE_DIR, TOOLS, WORKTREE_INCLUDE_FILE, type HatchManifest, type Tool } from "../types.js";
import { detectWorkspaceContext } from "../workspace/detect.js";
import { discoverUserContent } from "../content/userContent.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record a clean-probe failure: emit a verbose() line to stderr (visible only
 * with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract.
 */
function recordCleanProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`clean: ${operation} — ${message}`);
}

export interface CleanInventory {
  adapterFiles: string[];
  canonicalDir: boolean;
  archiveDir: boolean;
  customizeDir: boolean;
  worktreeInclude: boolean;
  envMcp: boolean;
  agentsMdHasUserContent: boolean;
  learnings: string[];
  /**
   * Count of user-authored artifacts under `.agents/user/`. Always preserved
   * by clean — never deleted, regardless of `--yes`. Reported in the
   * inventory as a "kept" item so the user knows their work is safe.
   * Optional for backward compatibility with pre-D20 callers building
   * inventories programmatically; treat absence as 0.
   */
  userContentCount?: number;
  isWorkspaceRoot: boolean;
  isWorkspaceMember: boolean;
  workspaceRootPath: string | null;
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

async function dirEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (err) {
    recordCleanProbeFailure(`dirEntries(${path}) — directory missing`, err);
    return [];
  }
}

export async function inventoryArtifacts(rootDir: string): Promise<CleanInventory> {
  const manifest = await readManifest(rootDir);

  // Collect adapter files from both manifest tracking and prefix scanning
  const adapterFileSet = new Set<string>();

  // Source 1: manifest.managedFiles (authoritative when available)
  if (manifest) {
    for (const f of manifest.managedFiles) {
      adapterFileSet.add(f);
    }
  }

  // Source 2: prefix scanning for all known tools (catches orphaned files)
  const toolsToScan: Tool[] = manifest ? manifest.tools : [...TOOLS];
  for (const tool of toolsToScan) {
    const files = await collectToolFiles(rootDir, tool);
    for (const f of files) {
      adapterFileSet.add(f);
    }
  }

  // toolsToScan already covers all TOOLS when manifest is absent (line above),
  // so no additional scanning needed.

  // Filter to only files that actually exist, excluding shared bridge files.
  // C9-H31 (D10-SA10.5-F1): shared bridge files (e.g. root AGENTS.md) are
  // tracked under `manifest.managedFilesByAdapter._shared` (SHARED_ADAPTER_KEY
  // in `src/adapters/index.ts`) — multiple adapters consume them, so they get
  // managed-block-preservation cleanup (see step 2 in `executeClean` below).
  // AGENTS.md remains the sole entry today (SHARED_BRIDGE_FILES); when adding
  // a new bridge file, append it to SHARED_BRIDGE_FILES and extend the
  // managed-block-preserving branch in step 2.
  const adapterFiles: string[] = [];
  for (const f of adapterFileSet) {
    if (f === "AGENTS.md") continue;
    if (await fileExists(join(rootDir, f))) {
      adapterFiles.push(f);
    }
  }

  // 1.7.0 (Phase E): sweep sibling `.bak` files left behind by the
  // safeWriteFile auto-repair path (managed-block corruption recovery in
  // src/merge/safeWrite.ts ~L398). These pile up across runs and are not
  // tracked in the manifest, so without this sweep they survive `clean`.
  // We only enqueue `<adapter-file>.bak` when both the adapter file path
  // is in our inventory AND the `.bak` file actually exists on disk.
  for (const f of [...adapterFiles]) {
    const bakRel = f + ".bak";
    if (await fileExists(join(rootDir, bakRel))) {
      adapterFiles.push(bakRel);
    }
  }

  // Check root AGENTS.md for user content
  let agentsMdHasUserContent = false;
  const agentsMdPath = join(rootDir, "AGENTS.md");
  if (await fileExists(agentsMdPath)) {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      if (hasManagedBlock(content)) {
        const userContent = extractCustomContent(content).trim();
        agentsMdHasUserContent = userContent.length > 0;
      }
    } catch (err) {
      // Can't read, treat as no user content. Surface under --verbose so
      // unexpected read errors (e.g., permission denied) remain observable.
      recordCleanProbeFailure(
        `inventoryArtifacts: readFile(${agentsMdPath}) — treating as no user content`,
        err,
      );
    }
  }

  // Check learnings
  const learningsDir = join(rootDir, AGENTS_DIR, "learnings");
  const learnings = await dirEntries(learningsDir);

  // D20: count user-authored artifacts so the inventory can surface them as
  // a kept item before the destructive operations. Discovery is best-effort
  // — a failure here must not block a legitimate clean of canonical state.
  let userContentCount = 0;
  try {
    const discovered = await discoverUserContent(rootDir);
    userContentCount = discovered.length;
  } catch (err) {
    // Surface via console.warn so the failure is visible but does not
    // block the clean. The kept-set still includes `.agents/user/` below.
    console.warn(
      `[hatch3r] inventoryArtifacts: user-content scan skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Check workspace context
  const wsContext = await detectWorkspaceContext(rootDir);

  return {
    adapterFiles,
    canonicalDir: await fileExists(join(rootDir, AGENTS_DIR)),
    archiveDir: await fileExists(join(rootDir, ARCHIVE_DIR)),
    customizeDir: await fileExists(join(rootDir, CUSTOMIZE_DIR)),
    worktreeInclude: await fileExists(join(rootDir, WORKTREE_INCLUDE_FILE)),
    envMcp: await fileExists(join(rootDir, ".env.mcp")),
    agentsMdHasUserContent,
    learnings,
    userContentCount,
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
    // Just report what would happen
    for (const f of inventory.adapterFiles) {
      removed.push(f);
    }
    if (inventory.canonicalDir) removed.push(`${AGENTS_DIR}/`);
    if (inventory.worktreeInclude) removed.push(WORKTREE_INCLUDE_FILE);
    if (inventory.archiveDir) removed.push(`${ARCHIVE_DIR}/`);
    if (inventory.envMcp) kept.push(".env.mcp (contains secrets)");
    if (inventory.customizeDir) kept.push(`${CUSTOMIZE_DIR}/ (customizations)`);
    if ((inventory.userContentCount ?? 0) > 0) {
      kept.push(`${AGENTS_DIR}/user/ (${inventory.userContentCount} user artifact(s) — preserved)`);
    }
    return { removed, kept, errors };
  }

  // 1. Remove adapter output files
  for (const f of inventory.adapterFiles) {
    const absPath = join(rootDir, f);
    try {
      await rm(absPath, { force: true });
      removed.push(f);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors.push(`${f}: ${(err as Error).message}`);
      }
    }
  }

  // Clean empty directories left by adapter file removal
  await cleanEmptyDirs(rootDir, inventory.adapterFiles);

  // 2. Handle shared bridge files (C9-H31 / D10-SA10.5-F1).
  // Files tracked under `manifest.managedFilesByAdapter._shared` (today: just
  // root `AGENTS.md`, see `SHARED_BRIDGE_FILES` in `src/adapters/index.ts`)
  // use managed-block-preservation semantics: strip the hatch3r managed
  // block, keep any user content above/below it, and remove the file only
  // when nothing user-authored remains. This is the documented `hatch3r
  // clean` cleanup contract for files written outside any one adapter's
  // `doGenerate()` (e.g. `generateRootAgentsMd()` callers in init/sync).
  const agentsMdPath = join(rootDir, "AGENTS.md");
  if (await fileExists(agentsMdPath)) {
    try {
      const content = await readFile(agentsMdPath, "utf-8");
      if (hasManagedBlock(content)) {
        const userContent = extractCustomContent(content).trim();
        if (userContent.length > 0) {
          await writeFile(agentsMdPath, userContent + "\n");
          kept.push("AGENTS.md (user content preserved, managed block stripped)");
        } else {
          await rm(agentsMdPath, { force: true });
          removed.push("AGENTS.md");
        }
      } else {
        // No managed block — leave it alone, it's entirely user content
        kept.push("AGENTS.md (no managed block, left untouched)");
      }
    } catch (err) {
      errors.push(`AGENTS.md: ${(err as Error).message}`);
    }
  }

  // 3. Remove .agents/ directory — preserving the user/ subtree (D20).
  // When user content is present we walk the .agents/ children and unlink
  // each one except `user/`, leaving `.agents/user/` and the `.agents/`
  // directory itself in place. When no user content is present we fall
  // through to the simple recursive remove.
  if (inventory.canonicalDir) {
    const agentsAbs = join(rootDir, AGENTS_DIR);
    try {
      if ((inventory.userContentCount ?? 0) > 0) {
        const children = await readdir(agentsAbs);
        let removedAny = false;
        for (const child of children) {
          if (child === "user") continue; // preserve user-authored content
          try {
            await rm(join(agentsAbs, child), { recursive: true, force: true });
            removedAny = true;
          } catch (err) {
            errors.push(`${AGENTS_DIR}/${child}: ${(err as Error).message}`);
          }
        }
        if (removedAny) {
          removed.push(`${AGENTS_DIR}/ (preserved ${AGENTS_DIR}/user/)`);
        }
      } else {
        await rm(agentsAbs, { recursive: true, force: true });
        removed.push(`${AGENTS_DIR}/`);
      }
    } catch (err) {
      errors.push(`${AGENTS_DIR}/: ${(err as Error).message}`);
    }
  }

  // 4. Remove .worktreeinclude
  if (inventory.worktreeInclude) {
    try {
      await rm(join(rootDir, WORKTREE_INCLUDE_FILE), { force: true });
      removed.push(WORKTREE_INCLUDE_FILE);
    } catch (err) {
      errors.push(`${WORKTREE_INCLUDE_FILE}: ${(err as Error).message}`);
    }
  }

  // 5. Remove .hatch3r-archive/
  if (inventory.archiveDir) {
    try {
      await rm(join(rootDir, ARCHIVE_DIR), { recursive: true, force: true });
      removed.push(`${ARCHIVE_DIR}/`);
    } catch (err) {
      errors.push(`${ARCHIVE_DIR}/: ${(err as Error).message}`);
    }
  }

  // 6. .hatch3r/ customizations — always preserved
  if (inventory.customizeDir) {
    kept.push(`${CUSTOMIZE_DIR}/ (customizations preserved)`);
  }

  // 7. .env.mcp — always preserved
  if (inventory.envMcp) {
    kept.push(".env.mcp (contains secrets — remove manually if needed)");
  }

  // 8. .agents/user/ — always preserved (D20). User-authored artifacts are
  // never owned by hatch3r and never appear in canonical or adapter sweeps.
  if ((inventory.userContentCount ?? 0) > 0) {
    kept.push(
      `${AGENTS_DIR}/user/ (${inventory.userContentCount} user artifact(s) — user-authored content preserved)`,
    );
  }

  return { removed, kept, errors };
}

export async function backupLearnings(rootDir: string): Promise<string | null> {
  const learningsDir = join(rootDir, AGENTS_DIR, "learnings");
  const entries = await dirEntries(learningsDir);
  if (entries.length === 0) return null;

  const backupDir = join(tmpdir(), `hatch3r-learnings-${Date.now()}`);
  await mkdir(backupDir, { recursive: true });
  await cp(learningsDir, backupDir, { recursive: true });
  return backupDir;
}

export async function restoreLearnings(rootDir: string, backupPath: string): Promise<void> {
  const learningsDir = join(rootDir, AGENTS_DIR, "learnings");
  await mkdir(learningsDir, { recursive: true });
  await cp(backupPath, learningsDir, { recursive: true });
  await rm(backupPath, { recursive: true, force: true });
}
