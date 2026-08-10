import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  collectToolFiles,
  cleanEmptyDirs,
} from "../archive/index.js";
import {
  fileMatchesTool,
  isCodexSharedPath,
  planCodexRemoval,
  type CodexRemovalPlan,
} from "../merge/codexOwnership.js";
import { extractCustomContent, hasManagedBlock } from "../merge/managedBlocks.js";
import { acquireWriteLock } from "../merge/safeWrite.js";
import {
  assertRepositoryPathIdentity,
  inspectRepositoryPath,
  normalizeRepositoryRelativePath,
  readRepositoryFileSnapshot,
  readRepositoryPathIdentity,
  removeRepositoryFileIfUnchanged,
  replaceRepositoryFileIfUnchanged,
  UnsafeRepositoryPathError,
} from "../merge/repositoryPathSafety.js";
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
import { fileExists, rootAgentsMdHasUserContent } from "./support.js";

export { backupLearnings, restoreLearnings } from "./support.js";

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

async function inspectCodexRemoval(
  rootDir: string,
  relPath: string,
  exactRecorded: boolean,
): Promise<CodexRemovalPlan | { disposition: "symlink" }> {
  try {
    const snapshot = await readRepositoryFileSnapshot(rootDir, relPath);
    return planCodexRemoval(
      snapshot.relativePath,
      snapshot.absolutePath,
      snapshot.content.toString("utf-8"),
      exactRecorded,
    );
  } catch (err) {
    if (err instanceof UnsafeRepositoryPathError && err.reason === "symlink") {
      return { disposition: "symlink" };
    }
    throw err;
  }
}

function codexKeptMessage(path: string, disposition: "foreign" | "preserve" | "symlink"): string {
  if (disposition === "preserve") {
    return `${path} (user content preserved, managed content removed)`;
  }
  if (disposition === "symlink") return `${path} (symlink left untouched)`;
  return `${path} (no provable hatch3r-owned content, left untouched)`;
}

async function collectInventoryFileSet(
  rootDir: string,
  manifest: HatchManifest | null,
): Promise<Set<string>> {
  const adapterFileSet = new Set<string>();
  for (const file of manifest?.managedFiles ?? []) {
    adapterFileSet.add(normalizeRepositoryRelativePath(file));
  }
  for (const paths of Object.values(manifest?.managedFilesByAdapter ?? {})) {
    for (const path of paths) normalizeRepositoryRelativePath(path);
  }
  const toolsToScan: Tool[] = manifest ? manifest.tools : [...TOOLS];
  for (const tool of toolsToScan) {
    await addScannedToolFiles(rootDir, tool, adapterFileSet);
  }
  return adapterFileSet;
}

async function addScannedToolFiles(rootDir: string, tool: Tool, files: Set<string>): Promise<void> {
  for (const path of await collectToolFiles(rootDir, tool)) {
    if (tool !== "codex" || isCodexSharedPath(path)) {
      files.add(normalizeRepositoryRelativePath(path));
    }
  }
}

async function existingInventoryFiles(rootDir: string, candidates: Iterable<string>): Promise<string[]> {
  const adapterFiles: string[] = [];
  for (const f of candidates) {
    if (f === "AGENTS.md") continue;
    if (await fileExists(join(rootDir, f))) adapterFiles.push(f);
  }
  for (const f of [...adapterFiles]) {
    const bakRel = f + ".bak";
    if (await fileExists(join(rootDir, bakRel))) adapterFiles.push(bakRel);
  }
  return adapterFiles;
}

export async function inventoryArtifacts(rootDir: string): Promise<CleanInventory> {
  const manifest = await readManifest(rootDir);
  const adapterFileSet = await collectInventoryFileSet(rootDir, manifest);
  const adapterFiles = await existingInventoryFiles(rootDir, adapterFileSet);
  const wsContext = await detectWorkspaceContext(rootDir);
  return {
    adapterFiles,
    manifestPresent: await fileExists(join(rootDir, HATCH3R_DIR, "hatch.json")),
    archiveDir: await fileExists(join(rootDir, ARCHIVE_DIR)),
    hatch3rDir: await fileExists(join(rootDir, HATCH3R_DIR)),
    worktreeInclude: await fileExists(join(rootDir, WORKTREE_INCLUDE_FILE)),
    envMcp: await fileExists(join(rootDir, ".env.mcp")),
    agentsMdHasUserContent: await rootAgentsMdHasUserContent(rootDir),
    isWorkspaceRoot: wsContext.type === "workspace-root",
    isWorkspaceMember: wsContext.type === "workspace-member",
    workspaceRootPath: wsContext.type === "workspace-member" ? wsContext.rootPath ?? null : null,
    manifest,
  };
}

interface CleanContext {
  rootDir: string;
  inventory: CleanInventory;
  adapterFiles: string[];
  codexRecordedPaths: ReadonlySet<string>;
  result: CleanResult;
}

function appendCleanError(context: CleanContext, path: string, err: unknown): void {
  context.result.errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
}

async function previewCodexFile(context: CleanContext, path: string): Promise<void> {
  try {
    const plan = await inspectCodexRemoval(
      context.rootDir, path, context.codexRecordedPaths.has(path.replace(/\\/g, "/")),
    );
    if (plan.disposition === "remove") context.result.removed.push(path);
    else context.result.kept.push(codexKeptMessage(path, plan.disposition));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") appendCleanError(context, path, err);
  }
}

async function previewGenericFile(context: CleanContext, path: string): Promise<void> {
  try {
    const snapshot = await readRepositoryFileSnapshot(context.rootDir, path);
    const content = snapshot.content.toString("utf-8");
    const userContent = hasManagedBlock(content, snapshot.absolutePath)
      ? extractCustomContent(content, snapshot.absolutePath).trim()
      : "";
    if (userContent.length > 0) {
      context.result.kept.push(`${path} (user content preserved, managed block stripped)`);
    } else {
      context.result.removed.push(path);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") appendCleanError(context, path, err);
  }
}

async function previewTrackedFile(context: CleanContext, present: boolean, path: string): Promise<void> {
  if (!present) return;
  try {
    await readRepositoryFileSnapshot(context.rootDir, path);
    context.result.removed.push(path);
  } catch (err) {
    appendCleanError(context, path, err);
  }
}

async function executeDryRun(context: CleanContext): Promise<CleanResult> {
  for (const path of context.adapterFiles) {
    if (fileMatchesTool(path.replace(/\\/g, "/"), "codex")) {
      await previewCodexFile(context, path);
    } else {
      await previewGenericFile(context, path);
    }
  }
  if (await fileExists(join(context.rootDir, "AGENTS.md"))) {
    await previewCodexFile(context, "AGENTS.md");
  }
  await previewTrackedFile(context, context.inventory.manifestPresent, `${HATCH3R_DIR}/hatch.json`);
  await previewTrackedFile(context, context.inventory.worktreeInclude, WORKTREE_INCLUDE_FILE);
  if (context.inventory.archiveDir) {
    try {
      await inspectRepositoryPath(context.rootDir, ARCHIVE_DIR);
      context.result.removed.push(`${ARCHIVE_DIR}/`);
    } catch (err) {
      appendCleanError(context, `${ARCHIVE_DIR}/`, err);
    }
  }
  if (context.inventory.envMcp) context.result.kept.push(".env.mcp (contains secrets)");
  if (context.inventory.hatch3rDir) {
    context.result.kept.push(
      `${HATCH3R_DIR}/ (learnings/, handoffs/, overrides/, mcp/, customizations preserved)`,
    );
  }
  return context.result;
}

async function mutateCodexFile(context: CleanContext, path: string, exactRecorded: boolean): Promise<void> {
  let initial;
  try {
    initial = await readRepositoryFileSnapshot(context.rootDir, path);
  } catch (err) {
    if (err instanceof UnsafeRepositoryPathError && err.reason === "symlink") {
      context.result.kept.push(codexKeptMessage(path, "symlink"));
      return;
    }
    throw err;
  }
  const release = await acquireWriteLock(initial.absolutePath);
  try {
    const snapshot = await readRepositoryFileSnapshot(context.rootDir, path);
    const plan = planCodexRemoval(
      path, snapshot.absolutePath, snapshot.content.toString("utf-8"), exactRecorded,
    );
    if (plan.disposition === "remove") {
      await removeRepositoryFileIfUnchanged(context.rootDir, path, snapshot.identity);
      context.result.removed.push(path);
    } else if (plan.disposition === "preserve") {
      await replaceRepositoryFileIfUnchanged(context.rootDir, path, snapshot.identity, plan.content);
      context.result.kept.push(codexKeptMessage(path, plan.disposition));
    } else {
      context.result.kept.push(codexKeptMessage(path, plan.disposition));
    }
  } finally {
    await release();
  }
}

async function mutateGenericFile(context: CleanContext, path: string): Promise<void> {
  const initial = await readRepositoryFileSnapshot(context.rootDir, path);
  const release = await acquireWriteLock(initial.absolutePath);
  try {
    const snapshot = await readRepositoryFileSnapshot(context.rootDir, path);
    const content = snapshot.content.toString("utf-8");
    const userContent = hasManagedBlock(content, snapshot.absolutePath)
      ? extractCustomContent(content, snapshot.absolutePath).trim()
      : "";
    if (userContent.length > 0) {
      await replaceRepositoryFileIfUnchanged(context.rootDir, path, snapshot.identity, userContent + "\n");
      context.result.kept.push(`${path} (user content preserved, managed block stripped)`);
    } else {
      await removeRepositoryFileIfUnchanged(context.rootDir, path, snapshot.identity);
      context.result.removed.push(path);
    }
  } finally {
    await release();
  }
}

async function cleanAdapterFiles(context: CleanContext): Promise<void> {
  for (const path of context.adapterFiles) {
    try {
      if (fileMatchesTool(path.replace(/\\/g, "/"), "codex")) {
        await mutateCodexFile(context, path, context.codexRecordedPaths.has(path));
      } else {
        await mutateGenericFile(context, path);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") appendCleanError(context, path, err);
    }
  }
  await cleanEmptyDirs(context.rootDir, context.adapterFiles);
}

async function cleanRootAgentsMd(context: CleanContext): Promise<void> {
  if (!(await fileExists(join(context.rootDir, "AGENTS.md")))) return;
  try {
    await mutateCodexFile(context, "AGENTS.md", false);
  } catch (err) {
    appendCleanError(context, "AGENTS.md", err);
  }
}

async function removeLockedFile(rootDir: string, path: string): Promise<void> {
  const snapshot = await readRepositoryFileSnapshot(rootDir, path);
  const release = await acquireWriteLock(snapshot.absolutePath);
  try {
    const locked = await readRepositoryFileSnapshot(rootDir, path);
    await removeRepositoryFileIfUnchanged(rootDir, path, locked.identity);
  } finally {
    await release();
  }
}

async function cleanTrackedFile(context: CleanContext, present: boolean, path: string): Promise<void> {
  if (!present) return;
  try {
    await removeLockedFile(context.rootDir, path);
    context.result.removed.push(path);
  } catch (err) {
    appendCleanError(context, path, err);
  }
}

async function cleanArchiveDirectory(context: CleanContext): Promise<void> {
  if (!context.inventory.archiveDir) return;
  try {
    const inspected = await inspectRepositoryPath(context.rootDir, ARCHIVE_DIR);
    const identity = await readRepositoryPathIdentity(context.rootDir, ARCHIVE_DIR);
    await assertRepositoryPathIdentity(context.rootDir, ARCHIVE_DIR, identity);
    await rm(inspected.absolutePath, { recursive: true });
    context.result.removed.push(`${ARCHIVE_DIR}/`);
  } catch (err) {
    appendCleanError(context, `${ARCHIVE_DIR}/`, err);
  }
}

async function executeLiveClean(context: CleanContext): Promise<CleanResult> {
  await cleanAdapterFiles(context);
  await cleanRootAgentsMd(context);
  await cleanTrackedFile(context, context.inventory.manifestPresent, `${HATCH3R_DIR}/hatch.json`);
  await cleanTrackedFile(context, context.inventory.worktreeInclude, WORKTREE_INCLUDE_FILE);
  await cleanArchiveDirectory(context);
  if (context.inventory.hatch3rDir) {
    context.result.kept.push(
      `${HATCH3R_DIR}/ (learnings, handoffs, overrides, mcp, customizations preserved)`,
    );
  }
  if (context.inventory.envMcp) {
    context.result.kept.push(".env.mcp (contains secrets — remove manually if needed)");
  }
  return context.result;
}

export async function executeClean(
  rootDir: string,
  inventory: CleanInventory,
  dryRun: boolean,
): Promise<CleanResult> {
  const context: CleanContext = {
    rootDir,
    inventory,
    adapterFiles: inventory.adapterFiles.map(normalizeRepositoryRelativePath),
    codexRecordedPaths: new Set(
      (inventory.manifest?.managedFilesByAdapter?.codex ?? []).map(normalizeRepositoryRelativePath),
    ),
    result: { removed: [], kept: [], errors: [] },
  };
  return dryRun ? executeDryRun(context) : executeLiveClean(context);
}
