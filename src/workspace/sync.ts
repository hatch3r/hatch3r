import { createHash } from "node:crypto";
import { mkdir, access, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getAdapter } from "../adapters/index.js";
import {
  buildContentIndex,
  copySelectedContent,
  getAllContentIds,
  getAllItemsById,
  removeContentItem,
} from "../content/index.js";
import { generateIntegrityManifest, writeIntegrityManifest, verifyIntegrity } from "../integrity/index.js";
import {
  createManifest,
  readManifest,
  writeManifest,
  addManagedFile,
} from "../manifest/hatchJson.js";
import { safeWriteFile } from "../merge/safeWrite.js";
import { AGENTS_DIR } from "../types.js";
import { HATCH3R_VERSION } from "../version.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../cli/shared/agentsContent.js";
import { findPackageRoot } from "../cli/shared/paths.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { analyzeRepo } from "../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry } from "../env/mcpEnv.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "./manifest.js";
import { resolveRepoConfig, buildSelectionFromIds } from "./resolve.js";
import { detectRepoGitIdentity } from "./git.js";
import { CHARS_PER_TOKEN } from "../pipeline/observability.js";
import type { WorkspaceManifest, WorkspaceRepoEntry, WorkspaceSyncResult, WorkspaceRepoSyncResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = findPackageRoot(__dirname);

/**
 * Estimate total tokens for a set of content IDs by summing the character
 * length of their source files and dividing by the chars-per-token ratio.
 */
async function estimateTokensForContent(
  contentIds: Set<string>,
  index: Awaited<ReturnType<typeof buildContentIndex>>,
): Promise<number> {
  let totalChars = 0;
  for (const id of contentIds) {
    // Use getAllItemsById to handle cross-type collisions (e.g., command + skill with same ID)
    const items = getAllItemsById(index, id);
    for (const item of items) {
      try {
        if (item.type === "skill") {
          // For skills, read the SKILL.md file
          const skillPath = join(CONTENT_ROOT, item.relativePath, "SKILL.md");
          const content = await readFile(skillPath, "utf-8");
          totalChars += content.length;
        } else {
          const filePath = join(CONTENT_ROOT, item.relativePath);
          const content = await readFile(filePath, "utf-8");
          totalChars += content.length;
        }
      } catch {
        // File not readable; skip
      }
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

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

  // D15 Medium (#15.24): Pre-sync integrity check — warn if workspace
  // canonical content has been tampered with before propagating to sub-repos.
  const wsAgentsDir = join(workspaceRoot, AGENTS_DIR);
  const integrityResults = await verifyIntegrity(wsAgentsDir);
  const tampered = integrityResults.filter(
    (r) => r.status === "modified" || r.status === "tampered",
  );
  if (tampered.length > 0 && !options.force) {
    for (const r of tampered) {
      options.onWarn?.(
        `Integrity issue in workspace content: ${r.file} (${r.status}). ` +
        `Use --force to sync anyway, or run hatch3r verify to inspect.`,
      );
    }
  }

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
    const estimatedTokens = await estimateTokensForContent(resolved.contentIds, index);
    return {
      path: repoEntry.path,
      added: toAdd,
      removed: toRemove,
      toolsSynced: resolved.tools,
      action: "dry-run",
      estimatedTokens,
    };
  }

  options.onProgress?.(`Syncing ${repoEntry.name ?? repoEntry.path}...`);

  // Ensure .agents/ exists
  await mkdir(repoAgentsDir, { recursive: true });

  // Copy selected content to sub-repo
  await copySelectedContent(CONTENT_ROOT, repoAgentsDir, effectiveSelection, index);

  // Remove stale content (handle cross-type collisions)
  for (const id of toRemove) {
    const items = getAllItemsById(index, id);
    for (const item of items) {
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

  // Generate root AGENTS.md for sub-repo with inline agent/skill/command rosters
  const rootAgentsMd = await generateRootAgentsMd(repoAgentsDir);
  await safeWriteFile(join(repoDir, "AGENTS.md"), rootAgentsMd.full, {
    managedContent: rootAgentsMd.inner,
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

  // C7-H13 (D11): Only refresh the integrity manifest when every adapter
  // succeeded. With partial adapter failure the freshly written outputs of
  // the successful adapters would be certified alongside stale outputs of
  // the failed ones, causing later `verify` to falsely flag clean files as
  // "modified".
  const allAdaptersSucceeded = toolsSynced.length === resolved.tools.length;
  if (allAdaptersSucceeded) {
    const integrityManifest = await generateIntegrityManifest(repoAgentsDir, HATCH3R_VERSION);
    await writeIntegrityManifest(repoAgentsDir, integrityManifest);
  } else {
    options.onWarn?.(
      `Integrity manifest not updated for ${repoEntry.path} due to adapter failures. ` +
      `Re-run sync after resolving errors.`,
    );
  }

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
