import { createHash } from "node:crypto";
import { mkdir, access } from "node:fs/promises";
import { join, relative } from "node:path";
import { getAdapter } from "../adapters/index.js";
import {
  buildContentIndex,
  copySelectedContent,
  getAllContentIds,
  removeContentItem,
} from "../content/index.js";
import { generateIntegrityManifest, writeIntegrityManifest } from "../integrity/index.js";
import {
  createManifest,
  readManifest,
  writeManifest,
  addManagedFile,
} from "../manifest/hatchJson.js";
import { safeWriteFile } from "../merge/safeWrite.js";
import { AGENTS_DIR } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { AGENTS_MD_INNER, AGENTS_MD_FULL, generateCanonicalAgentsMd } from "../cli/shared/agentsContent.js";
import { findPackageRoot } from "../cli/shared/paths.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { analyzeRepo } from "../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry } from "../env/mcpEnv.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "./manifest.js";
import { resolveRepoConfig, buildSelectionFromIds } from "./resolve.js";
import { detectRepoGitIdentity } from "./git.js";
import type { WorkspaceManifest, WorkspaceRepoEntry, WorkspaceSyncResult, WorkspaceRepoSyncResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);

export interface WorkspaceSyncOptions {
  /** Only sync these repo paths (sync all opted-in repos if empty/undefined). */
  repos?: string[];
  /** Show what would change without modifying files. */
  dryRun?: boolean;
  /** Overwrite locally modified canonical files in sub-repos. */
  force?: boolean;
  /** Log callback for progress reporting. */
  onProgress?: (message: string) => void;
  /** Warning callback. */
  onWarn?: (message: string) => void;
}

/**
 * Sync workspace content to all (or selected) opted-in sub-repos.
 *
 * For each repo with sync=true:
 * 1. Resolve effective config (workspace defaults + repo overrides)
 * 2. Copy canonical content from workspace .agents/ to sub-repo .agents/
 * 3. Write sub-repo hatch.json with workspace provenance
 * 4. Run adapter generation for the sub-repo
 * 5. Generate integrity manifest
 */
export async function syncWorkspaceRepos(
  workspaceRoot: string,
  options: WorkspaceSyncOptions = {},
): Promise<WorkspaceSyncResult> {
  const wsManifest = await readWorkspaceManifest(workspaceRoot);
  if (!wsManifest) {
    return { repos: [] };
  }

  const wsChecksum = createHash("sha256")
    .update(JSON.stringify(wsManifest))
    .digest("hex");

  // Build content index from workspace .agents/ (which has the canonical content)
  const index = await buildContentIndex(CONTENT_ROOT);
  const protectedIds = new Set(
    index.items.filter((item) => item.protected).map((item) => item.id),
  );

  // Select target repos
  const targetRepos = options.repos?.length
    ? wsManifest.repos.filter((r) => options.repos!.includes(r.path))
    : wsManifest.repos.filter((r) => r.sync);

  const results: WorkspaceRepoSyncResult[] = [];

  for (const repoEntry of targetRepos) {
    try {
      const result = await syncSingleRepo(
        workspaceRoot,
        wsManifest,
        wsChecksum,
        repoEntry,
        index,
        protectedIds,
        options,
      );
      results.push(result);
    } catch (err) {
      results.push({
        path: repoEntry.path,
        added: [],
        removed: [],
        toolsSynced: [],
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update workspace manifest with lastSync timestamps (unless dry-run)
  if (!options.dryRun) {
    const now = new Date().toISOString();
    for (const result of results) {
      if (result.action === "synced") {
        const entry = wsManifest.repos.find((r) => r.path === result.path);
        if (entry) entry.lastSync = now;
      }
    }
    await writeWorkspaceManifest(workspaceRoot, wsManifest);
  }

  return { repos: results };
}

async function syncSingleRepo(
  workspaceRoot: string,
  wsManifest: WorkspaceManifest,
  wsChecksum: string,
  repoEntry: WorkspaceRepoEntry,
  index: Awaited<ReturnType<typeof buildContentIndex>>,
  protectedIds: Set<string>,
  options: WorkspaceSyncOptions,
): Promise<WorkspaceRepoSyncResult> {
  const repoDir = join(workspaceRoot, repoEntry.path);
  const repoAgentsDir = join(repoDir, AGENTS_DIR);

  // Verify repo directory exists
  try {
    await access(repoDir);
  } catch {
    return {
      path: repoEntry.path,
      added: [],
      removed: [],
      toolsSynced: [],
      action: "error",
      error: `Directory not found: ${repoEntry.path}`,
    };
  }

  // Resolve effective config
  const resolved = resolveRepoConfig(wsManifest.defaults, repoEntry.overrides, protectedIds);
  const effectiveSelection = buildSelectionFromIds(resolved.contentIds, wsManifest.defaults.content, index.items);

  // Compute diff
  const existingManifest = await readManifest(repoDir);
  const previousIds = existingManifest?.content
    ? getAllContentIds(existingManifest.content)
    : new Set<string>();

  const toAdd = [...resolved.contentIds].filter((id) => !previousIds.has(id));
  const toRemove = [...previousIds].filter(
    (id) =>
      !resolved.contentIds.has(id) &&
      !existingManifest?.workspace?.localContent?.includes(id),
  );

  if (options.dryRun) {
    return {
      path: repoEntry.path,
      added: toAdd,
      removed: toRemove,
      toolsSynced: resolved.tools,
      action: "dry-run",
    };
  }

  options.onProgress?.(`Syncing ${repoEntry.name ?? repoEntry.path}...`);

  // Ensure .agents/ exists
  await mkdir(repoAgentsDir, { recursive: true });

  // Copy selected content to sub-repo
  await copySelectedContent(CONTENT_ROOT, repoAgentsDir, effectiveSelection, index);

  // Remove stale content
  for (const id of toRemove) {
    const item = index.byId.get(id);
    if (item) {
      await removeContentItem(repoAgentsDir, item, { rootDir: repoDir });
    }
  }

  // Generate AGENTS.md for sub-repo
  const canonicalAgentsMd = await generateCanonicalAgentsMd(repoAgentsDir);
  await safeWriteFile(join(repoAgentsDir, "AGENTS.md"), canonicalAgentsMd, { force: true });

  // Write sub-repo manifest — resolve per-repo git identity
  const repoInfo = await analyzeRepo(repoDir);

  // 1. Per-repo identity from workspace.json
  let gitOwner = repoEntry.owner ?? "";
  let gitRepo = repoEntry.repo ?? "";
  let gitBranch = repoEntry.defaultBranch ?? "";
  let gitPlatform = repoEntry.platform;

  // 2. Fallback: auto-detect from sub-repo's git remote
  if (!gitOwner && !gitRepo) {
    const identity = detectRepoGitIdentity(repoDir);
    gitOwner = identity.owner;
    gitRepo = identity.repo;
    gitBranch = gitBranch || identity.defaultBranch;
    gitPlatform = gitPlatform ?? identity.platform;
  }

  // 3. Fallback: existing manifest values
  if (!gitOwner && !gitRepo && existingManifest) {
    gitOwner = existingManifest.owner;
    gitRepo = existingManifest.repo;
  }

  if (!gitBranch) gitBranch = "main";

  const manifest = createManifest({
    platform: gitPlatform ?? resolved.platform,
    owner: gitOwner,
    repo: gitRepo,
    namespace: gitOwner,
    project: gitRepo,
    defaultBranch: gitBranch,
    tools: resolved.tools,
    features: resolved.features,
    mcpServers: resolved.mcp.servers,
    content: effectiveSelection,
    languages: repoInfo.languages,
  });

  // Add workspace provenance
  manifest.workspace = {
    rootPath: relative(repoDir, workspaceRoot),
    lastSync: new Date().toISOString(),
    syncVersion: HATCH3R_VERSION,
    workspaceChecksum: wsChecksum,
    excludedContent: resolved.excludedContent.length > 0 ? resolved.excludedContent : undefined,
    localContent: existingManifest?.workspace?.localContent,
  };

  if (resolved.models) {
    manifest.models = resolved.models;
  }

  await writeManifest(repoDir, manifest);

  // Generate root AGENTS.md for sub-repo
  await safeWriteFile(join(repoDir, "AGENTS.md"), AGENTS_MD_FULL, {
    managedContent: AGENTS_MD_INNER,
    appendIfNoBlock: true,
  });
  addManagedFile(manifest, "AGENTS.md");

  // Run adapter generation
  const toolsSynced: string[] = [];
  for (const tool of resolved.tools) {
    try {
      const adapter = getAdapter(tool);
      const outputs = await adapter.generate(repoAgentsDir, manifest);
      for (const w of adapter.warnings) {
        options.onWarn?.(w);
      }
      for (const out of outputs) {
        await safeWriteFile(join(repoDir, out.path), out.content, {
          managedContent: out.managedContent,
          appendIfNoBlock: true,
        });
        addManagedFile(manifest, out.path);
      }
      toolsSynced.push(tool);
    } catch (err) {
      options.onWarn?.(
        `Failed to generate ${tool} output for ${repoEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Write manifest again with managedFiles populated
  await writeManifest(repoDir, manifest);

  // Generate integrity manifest
  const integrityManifest = await generateIntegrityManifest(repoAgentsDir, HATCH3R_VERSION);
  await writeIntegrityManifest(repoAgentsDir, integrityManifest);

  // Ensure .env.mcp for MCP servers
  if (manifest.features.mcp && manifest.mcp.servers.length > 0) {
    await ensureEnvMcp(repoDir, manifest.mcp.servers);
    await ensureGitignoreEntry(repoDir);
  }

  return {
    path: repoEntry.path,
    added: toAdd,
    removed: toRemove,
    toolsSynced,
    action: "synced",
  };
}
