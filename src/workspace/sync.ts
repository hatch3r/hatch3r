import { createHash } from "node:crypto";
import { access, readFile, appendFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import pLimit from "p-limit";
import { getAdapter } from "../adapters/index.js";
import {
  buildContentIndex,
  getAllContentIds,
  getAllItemsById,
} from "../content/index.js";
import { resolveBundledContentRoot } from "../content/contentRoot.js";
import {
  createManifest,
  readManifest,
  writeManifest,
  addManagedFile,
} from "../manifest/hatchJson.js";
import { safeWriteFile } from "../merge/safeWrite.js";
import { HATCH3R_DIR } from "../types.js";
import { migrateAgentsToHatch3r } from "../migration/agentsToHatch3r.js";
import { HATCH3R_VERSION } from "../version.js";
import { findPackageRoot } from "../cli/shared/paths.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { analyzeRepo } from "../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry } from "../env/mcpEnv.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "./manifest.js";
import { resolveRepoConfig, buildSelectionFromIds, applyMemberCliToolsOverrides } from "./resolve.js";
import { detectRepoGitIdentity } from "./git.js";
import { CHARS_PER_TOKEN } from "../pipeline/observability.js";
import { verbose } from "../cli/shared/ui.js";
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
      } catch (err) {
        // Token estimate is best-effort; missing content drops out of the
        // estimate but the sync is unaffected. Surface under --verbose so
        // unexpected read failures (e.g., permission errors) remain visible.
        const message = err instanceof Error ? err.message : String(err);
        verbose(`workspace/sync: estimateTokensForContent(${item.id}) skipped — ${message}`);
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
  /**
   * D14-SA14.2-H01: Override the parallel-sync concurrency limit.
   * Defaults to `Math.min(os.cpus().length, 8)`. Useful for tests that need
   * deterministic concurrency (e.g. asserting peak active count) and for
   * operators tuning sync throughput on constrained CI runners.
   */
  concurrency?: number;
}

/** Default sync concurrency: bound to CPU count with a hard ceiling of 8. */
export function defaultSyncConcurrency(): number {
  return Math.min(cpus().length, 8);
}

/**
 * Sync journal filename written under `<workspaceRoot>/.agents/`. The journal
 * is an append-only JSONL log; each line records one sub-repo's terminal
 * sync state for the run. On crash-recovery, the next run can scan the
 * journal to identify in-flight repos whose `.agents/hatch.json` may be
 * partially written. Older runs' lines are preserved.
 */
export const WORKSPACE_SYNC_JOURNAL_FILE = ".workspace-sync-journal.jsonl";

interface WorkspaceSyncJournalEntry {
  /** ISO-8601 timestamp the entry was appended. */
  ts: string;
  /** Sub-repo path (workspace-relative). */
  repo: string;
  /** Terminal action for this run. */
  action: "synced" | "dry-run" | "skipped" | "error";
  /** Workspace manifest checksum captured at the start of the run. */
  workspaceChecksum: string;
  /** Truncated error message when action = "error" (≤200 chars). */
  error?: string;
}

/**
 * Append a single JSONL line to the sync journal. Writes are best-effort;
 * a journal-write failure surfaces via `onWarn` but does not abort the
 * sync (the per-repo sync itself already succeeded on disk).
 */
async function appendJournalEntry(
  workspaceRoot: string,
  entry: WorkspaceSyncJournalEntry,
  onWarn?: (message: string) => void,
): Promise<void> {
  // Wave 6: journal lives in `.hatch3r/` alongside the rest of workspace state.
  const journalPath = join(workspaceRoot, HATCH3R_DIR, WORKSPACE_SYNC_JOURNAL_FILE);
  try {
    await appendFile(journalPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    onWarn?.(
      `Failed to append sync-journal entry for ${entry.repo}: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
  // Wave 6: relocate any pre-1.9 `.agents/` state at the workspace root before
  // reading the workspace manifest — keeps legacy installs hot-syncing without
  // a manual `hatch3r init` first.
  await migrateAgentsToHatch3r(workspaceRoot);
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

  // Wave 7: workspace canonical-content integrity check removed alongside
  // the integrity subsystem. Canonical content is sourced from the bundled
  // package (read-only) in every sub-repo, so the workspace root no longer
  // has a `.agents/` tree to verify before propagation.

  // Select target repos
  const targetRepos = options.repos?.length
    ? wsManifest.repos.filter((r) => options.repos!.includes(r.path))
    : wsManifest.repos.filter((r) => r.sync);

  // D14-SA14.2-H01 (High): Sub-repo syncs are independent at the canonical-
  // content level — each writes to a distinct `<workspace>/<repo>/.agents/`
  // tree. Bound parallel execution by CPU count (ceiling 8) using p-limit
  // so large workspaces (>10 repos) scale with available cores without
  // saturating disk I/O. The two shared mutable resources (`wsManifest`
  // and the workspace-root sync journal) are serialized via a single-slot
  // in-process mutex (`workspaceWriteMutex`) below; the per-repo work
  // itself runs in parallel within the concurrency cap.
  const concurrency = Math.max(1, options.concurrency ?? defaultSyncConcurrency());
  const limit = pLimit(concurrency);

  // Single-slot mutex queue: every workspace-level write (manifest update +
  // journal append) chains onto the previous one so concurrent sub-repo
  // syncs cannot race on the in-memory `wsManifest.repos[].lastSync` field
  // or interleave journal lines mid-write. Operations are awaited in their
  // enqueue order, preserving the same persistence guarantee as the prior
  // sequential implementation.
  let workspaceWriteMutex: Promise<void> = Promise.resolve();
  const runSerialized = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = workspaceWriteMutex.then(fn, fn);
    // Swallow the value/error for the chain so a single failure does not
    // poison subsequent mutex slots; per-call result/error is still
    // returned to the caller through `next`.
    workspaceWriteMutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const results = await Promise.all(
    targetRepos.map((repoEntry) =>
      limit(async (): Promise<WorkspaceRepoSyncResult> => {
        let result: WorkspaceRepoSyncResult;
        try {
          result = await syncSingleRepo(
            workspaceRoot,
            wsManifest,
            wsChecksum,
            repoEntry,
            index,
            protectedIds,
            options,
          );
        } catch (err) {
          result = {
            path: repoEntry.path,
            added: [],
            removed: [],
            toolsSynced: [],
            action: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }

        // D1-SA1.9.1 (High): Persist lastSync incrementally per successful
        // sub-repo so that a SIGINT/SIGTERM (or process crash) mid-run does
        // not lose the timestamp of already-completed repos. The serialized
        // mutex below preserves this guarantee under parallel execution.
        if (!options.dryRun && result.action === "synced") {
          await runSerialized(async () => {
            const entry = wsManifest.repos.find((r) => r.path === result.path);
            if (entry) {
              entry.lastSync = new Date().toISOString();
              try {
                await writeWorkspaceManifest(workspaceRoot, wsManifest);
              } catch (err) {
                // Silent Failure Contract: surface the incremental write
                // failure via the warn callback so the user sees that a
                // timestamp may have been missed, but do not abort the
                // remaining repo loop (the per-repo sync itself already
                // succeeded on disk).
                options.onWarn?.(
                  `Failed to persist lastSync for ${result.path}: ` +
                  `${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          });
        }

        // D14-SA14.2-H01 (High): Append a journal entry per repo so that a
        // crash mid-run leaves a recoverable trace of which sub-repos
        // completed. Skipped in dry-run mode to keep dry-run side-effect-
        // free; serialized through the workspace mutex to prevent
        // interleaved JSONL lines under parallel execution.
        if (!options.dryRun) {
          await runSerialized(() =>
            appendJournalEntry(
              workspaceRoot,
              {
                ts: new Date().toISOString(),
                repo: result.path,
                action: result.action,
                workspaceChecksum: wsChecksum,
                error: result.error
                  ? result.error.slice(0, 200)
                  : undefined,
              },
              options.onWarn,
            ),
          );
        }

        return result;
      }),
    ),
  );

  // Drain any outstanding mutex work so callers see all writes flushed
  // before `syncWorkspaceRepos` resolves. Promise.all already waits on
  // each per-repo task's awaited mutex chain, but draining here is an
  // explicit barrier for clarity and for future call sites that may
  // enqueue post-task work into the same mutex.
  await workspaceWriteMutex;

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

  // Verify repo directory exists
  try {
    await access(repoDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    verbose(`workspace/sync: access(${repoDir}) failed — ${message}`);
    return {
      path: repoEntry.path,
      added: [],
      removed: [],
      toolsSynced: [],
      action: "error",
      error: `Directory not found: ${repoEntry.path}`,
    };
  }

  // Wave 6: relocate any pre-1.9 `.agents/` state in this sub-repo before
  // reading its manifest. Idempotent — no-op on already-migrated repos.
  await migrateAgentsToHatch3r(repoDir);

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

  // Wave 3: no `.agents/` materialization in sub-repos; adapters read
  // canonical content from the bundled package via resolveBundledContentRoot.
  // No canonical AGENTS.md emission. Wave 6 will reintroduce per-member
  // `.hatch3r/` seeding (manifest, learnings, handoffs).

  // Write sub-repo manifest — resolve per-repo git identity
  const repoInfo = await analyzeRepo(repoDir);

  // 1. Per-repo identity from workspace.json
  let gitOwner = repoEntry.owner ?? "";
  let gitRepo = repoEntry.repo ?? "";
  let gitBranch = repoEntry.defaultBranch ?? "";
  let gitPlatform = repoEntry.platform;

  // 2. Fallback: auto-detect from sub-repo's git remote
  if (!gitOwner && !gitRepo) {
    // F1.9-H3 (Cycle 10 D1): thread a warnings accumulator into
    // detectRepoGitIdentity. Previously this call discarded the function's
    // optional `warnings` channel, so when git remote/origin was missing the
    // helper silently returned `{ owner: "", repo: "" }` and the empty strings
    // were persisted to the manifest with no operator signal — board/PR
    // features then emit broken links. Forward each git-detection warning to
    // the caller's onWarn so the failure is audible (Silent Failure Contract,
    // CONSTITUTION §2 P5).
    const identityWarnings: string[] = [];
    const identity = detectRepoGitIdentity(repoDir, identityWarnings);
    gitOwner = identity.owner;
    gitRepo = identity.repo;
    gitBranch = gitBranch || identity.defaultBranch;
    gitPlatform = gitPlatform ?? identity.platform;
    for (const w of identityWarnings) {
      options.onWarn?.(`[${repoEntry.path}] ${w}`);
    }
  }

  // 3. Fallback: existing manifest values
  if (!gitOwner && !gitRepo && existingManifest) {
    gitOwner = existingManifest.owner;
    gitRepo = existingManifest.repo;
  }

  // F1.9-H3 (Cycle 10 D1): after ALL three fallback tiers (workspace.json
  // entry, git remote, existing manifest) — when owner AND repo are still
  // empty — surface one consolidated, sub-repo-scoped warning. Emitting here
  // (not inside the git-detect block) avoids a false warning when tier 3
  // recovers the identity from an existing manifest. Without this the empty
  // strings are persisted silently and board/PR features emit broken links
  // (Silent Failure Contract, CONSTITUTION §2 P5).
  if (!gitOwner && !gitRepo) {
    options.onWarn?.(
      `[${repoEntry.path}] could not detect git owner/repo (no remote, unparseable origin, ` +
        `and no prior manifest identity); manifest will carry empty owner/repo and board/PR ` +
        `links for this repo will be broken. ` +
        `Set owner/repo for this repo in .hatch3r/workspace.json or add a git origin remote.`,
    );
  }

  if (!gitBranch) gitBranch = "main";

  // CLI-tooling pivot (plan §4.8): apply workspace defaults + member
  // local/excluded overrides so a member who excludes `rtk` keeps its
  // exclusion across syncs. Local + excluded lists ride on the member
  // manifest's `workspace.localCliTools` / `workspace.excludedCliTools`.
  const effectiveCliTools = applyMemberCliToolsOverrides(
    resolved.cliTools,
    existingManifest?.workspace?.localCliTools,
    existingManifest?.workspace?.excludedCliTools,
  );

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
    // C9-H47 (D14-SA14.4-H01): persist detected toolchain so adapter
    // sync resolves `${HATCH3R:LINTER}` etc. tokens from the manifest.
    detected: {
      linters: repoInfo.linters,
      testFrameworks: repoInfo.testFrameworks,
      ciProviders: repoInfo.ciProviders,
    },
    cliTools: effectiveCliTools,
  });

  // Add workspace provenance
  manifest.workspace = {
    rootPath: relative(repoDir, workspaceRoot),
    lastSync: new Date().toISOString(),
    syncVersion: HATCH3R_VERSION,
    workspaceChecksum: wsChecksum,
    excludedContent: resolved.excludedContent.length > 0 ? resolved.excludedContent : undefined,
    localContent: existingManifest?.workspace?.localContent,
    localCliTools: existingManifest?.workspace?.localCliTools,
    excludedCliTools: existingManifest?.workspace?.excludedCliTools,
  };

  if (resolved.models) {
    manifest.models = resolved.models;
  }

  await writeManifest(repoDir, manifest);

  // Wave 3: no root AGENTS.md emission (per blueprint v2 decision #3).

  // Run adapter generation
  const canonicalContentRoot = resolveBundledContentRoot();
  const toolsSynced: string[] = [];
  for (const tool of resolved.tools) {
    try {
      const adapter = getAdapter(tool);
      // Wave 5: each workspace member's repoDir is its user-repo root for the
      // purposes of D20 overrides under .hatch3r/overrides/.
      const outputs = await adapter.generate(canonicalContentRoot, manifest, repoDir);
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

  // Wave 3: integrity manifest writes removed; Wave 7 will reintroduce a
  // bundled-content integrity model. Surface partial-adapter outcomes via
  // existing onWarn channel only.
  if (toolsSynced.length !== resolved.tools.length) {
    options.onWarn?.(
      `Adapter outputs for ${repoEntry.path}: ` +
      `${toolsSynced.length}/${resolved.tools.length} adapters successful. ` +
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
