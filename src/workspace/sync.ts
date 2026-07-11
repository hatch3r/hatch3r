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
import { admitsUnconditionally } from "../content/tags.js";
import { resolveBundledContentRoot } from "../content/contentRoot.js";
import {
  createManifest,
  readManifest,
  writeManifest,
  addManagedFile,
} from "../manifest/hatchJson.js";
import { safeWriteFile, acquireWriteLock } from "../merge/safeWrite.js";
import { sweepOrphansForAdapter, formatOrphanCleanupDiagnostic, type OrphanCleanupEntry } from "../merge/orphanCleanup.js";
import { HATCH3R_DIR } from "../types.js";
import { migrateAgentsToHatch3r } from "../migration/agentsToHatch3r.js";
import { HATCH3R_VERSION } from "../version.js";
import { analyzeRepo } from "../detect/repoAnalyzer.js";
import { ensureEnvMcp, ensureGitignoreEntry } from "../env/mcpEnv.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "./manifest.js";
import { resolveRepoConfig, buildSelectionFromIds, applyMemberCliToolsOverrides } from "./resolve.js";
import { detectRepoGitIdentity } from "./git.js";
import { CHARS_PER_TOKEN } from "../pipeline/observability.js";
import { verbose } from "../cli/shared/ui.js";
import type { WorkspaceManifest, WorkspaceRepoEntry, WorkspaceSyncResult, WorkspaceRepoSyncResult, WorkspaceGroupDelta } from "./types.js";

/**
 * Estimate total tokens for a set of content IDs by summing the character
 * length of their source files and dividing by the chars-per-token ratio.
 */
async function estimateTokensForContent(
  contentIds: Set<string>,
  index: Awaited<ReturnType<typeof buildContentIndex>>,
): Promise<number> {
  // D1-SA1.10-01 (Cycle 12): item.relativePath values are relative to the
  // bundled content root the index was built from (see syncWorkspaceRepos),
  // so resolve the same root here. Process-cached — cheap per call.
  const contentRoot = resolveBundledContentRoot();
  let totalChars = 0;
  for (const id of contentIds) {
    // Use getAllItemsById to handle cross-type collisions (e.g., command + skill with same ID)
    const items = getAllItemsById(index, id);
    for (const item of items) {
      try {
        if (item.type === "skill") {
          // For skills, read the SKILL.md file
          const skillPath = join(contentRoot, item.relativePath, "SKILL.md");
          const content = await readFile(skillPath, "utf-8");
          totalChars += content.length;
        } else {
          const filePath = join(contentRoot, item.relativePath);
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

/**
 * Default sync concurrency: bound to CPU count with a hard ceiling of 8.
 *
 * D14-SA14.2-F4 (Low, CQ6): the ceiling of 8 is a deliberate disk-bound
 * default, not an arbitrary magic number. Each sub-repo sync is write-heavy
 * (manifest + per-adapter managed files under `<repo>/.hatch3r/` and the
 * adapter output trees), so the bottleneck on a multi-repo sync is small-file
 * write throughput, not CPU. Capping at 8 keeps a 32-core CI runner from
 * issuing 32 concurrent write fans that contend on the same volume's I/O queue
 * and journal, where measured throughput plateaus and tail latency rises once
 * concurrent writers exceed single-digit counts on shared CI storage
 * (per the p-limit concurrency-bounding rationale,
 * https://github.com/sindresorhus/p-limit, accessed 2026-05-28). Operators on
 * SSD-bound runners that can sustain more parallel writes raise the cap via
 * the documented `WorkspaceSyncOptions.concurrency` override (wired to
 * `hatch3r sync` by the CLI layer); this default favours predictable behaviour
 * across the Ubuntu/macOS/Windows CI matrix over peak throughput on the
 * fastest storage.
 */
export function defaultSyncConcurrency(): number {
  return Math.min(cpus().length, 8);
}

/**
 * Sync journal filename written under `<workspaceRoot>/.hatch3r/` (see
 * `appendJournalEntry`, which joins on `HATCH3R_DIR`). The journal is an
 * append-only JSONL log; each line records one sub-repo's terminal sync state
 * for the run. On crash-recovery, the next run can scan the journal to identify
 * in-flight repos whose `.hatch3r/hatch.json` may be partially written. Older
 * runs' lines are preserved.
 *
 * D1-SA1.9-F8 (Low, P4) — growth contract: this log is append-only with no
 * rotation or sweep. One line is written per opted-in sub-repo per non-dry-run
 * `hatch3r sync`, so a CI pipeline that runs sync per-push accumulates entries
 * indefinitely (an N-repo workspace synced K times holds N×K lines). The file
 * is gitignored under `.hatch3r/` and bounded only by the operator's retention
 * choice — deleting it is safe between runs (it is read for crash-recovery
 * only, never required). A soft cap (retain the last ~5000 lines on append)
 * is deferred as a CL-2 follow-up; until it lands, large long-lived workspaces
 * may want to truncate this file periodically. The path stays under
 * `.hatch3r/` so a `.hatch3r/` cleanup also clears it.
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
 *
 * D8-SA8.2-F8.2.8 (Low, P5) — concurrency contract: the append is serialized
 * on TWO axes. (1) In-process: within a single `syncWorkspaceRepos` invocation
 * every call chains through the in-process `workspaceWriteMutex`
 * (see {@link syncWorkspaceRepos}), so per-process the JSONL is written one
 * line at a time. (2) Cross-process: the `appendFile` is wrapped in
 * `acquireWriteLock(journalPath)` — the same advisory `proper-lockfile` lock
 * `writeWorkspaceManifest` already holds on the manifest path, the other shared
 * workspace-root resource serialized through this mutex. Workspace and worktree
 * command entry points call `enableDefaultCrossProcessLocking()`
 * (`src/cli/commands/sync.ts`, `worktreeSetup.ts`, `worktreeCleanup.ts`), so a
 * SECOND concurrent `hatch3r sync` (or a worktree sync) against the same
 * workspace root blocks on the lock instead of racing the file, removing the
 * prior reliance on POSIX O_APPEND/PIPE_BUF atomicity (which is not guaranteed
 * on macOS/Windows for lines that exceed the bound). The lock is reentrant
 * within a process (no-op if a caller already holds `journalPath`) and a no-op
 * when locking is disabled (single-repo / non-workspace context, or
 * `HATCH3R_LOCK=0`), so single-process behaviour is unchanged. This is the
 * `properLockfile`-lock option from the finding recommendation; it does NOT
 * depend on the F8.2.2 global lock-default flip (that flips the default for
 * `atomicWriteFile`; this call site takes the lock explicitly regardless). A
 * `LOCK_TIMEOUT` HatchError from lock contention is caught and surfaced via
 * `onWarn` like any other journal-write failure — the per-repo sync has already
 * succeeded on disk, so a missed journal line does not abort the run.
 */
async function appendJournalEntry(
  workspaceRoot: string,
  entry: WorkspaceSyncJournalEntry,
  onWarn?: (message: string) => void,
): Promise<void> {
  // Wave 6: journal lives in `.hatch3r/` alongside the rest of workspace state.
  const journalPath = join(workspaceRoot, HATCH3R_DIR, WORKSPACE_SYNC_JOURNAL_FILE);
  try {
    // F8.2.8: take the cross-process advisory lock around the append so two
    // concurrent workspace syncs cannot interleave JSONL lines. Mirrors the
    // acquire/finally pattern in `writeWorkspaceManifest`; reentrant + no-op
    // when locking is disabled (acquireWriteLock returns a no-op release).
    const release = await acquireWriteLock(journalPath);
    try {
      await appendFile(journalPath, JSON.stringify(entry) + "\n", "utf-8");
    } finally {
      await release();
    }
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
 * 2. Write sub-repo `.hatch3r/hatch.json` with workspace provenance
 * 3. Run adapter generation for the sub-repo (adapters read canonical content
 *    from the bundled package via resolveBundledContentRoot — Wave 3 removed
 *    the per-repo `.agents/` content materialization, so nothing is copied
 *    into the sub-repo content tree)
 * 4. Persist managedFiles back into the manifest
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

  // Build the content index from the bundled content root. Wave 3 removed the
  // workspace `.agents/` canonical tree; canonical content now ships read-only
  // inside the npm package. D1-SA1.10-01 (Cycle 12, Critical): this must be
  // resolveBundledContentRoot() — the installed layout keeps content under
  // `<pkgRoot>/dist/content` (package.json `files: ["dist/", ...]` since
  // 1.9.0), so the previous `findPackageRoot(__dirname)` scanned the bare
  // package root and built an EMPTY index in every installed execution
  // (empty member selections, universal-floor invariant off, 0-token
  // dry-run estimates). Only the dev checkout masked it.
  const index = await buildContentIndex(resolveBundledContentRoot());
  // D16-2 (Cycle 11): the workspace exclude path must honour the full
  // universal-floor invariant, not just `protected`. Build the
  // not-excludable set from `admitsUnconditionally` (protected OR any
  // `floor:*` tag) so a per-repo `exclude` cannot strip a floor-tagged
  // security / UI/UX artifact — matching the selection-layer behaviour.
  const unconditionalIds = new Set(
    index.items.filter((item) => admitsUnconditionally(item)).map((item) => item.id),
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
            unconditionalIds,
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

/**
 * Resolve a repo's `groups[]` membership names to their `WorkspaceGroupDelta`
 * bundles from `defaults.groups`, preserving the repo's declared order.
 *
 * D1-10 (Cycle 11): wires the D14-M4 group layer into resolution. A name with
 * no matching key in `defaults.groups` is dropped with a `verbose()` warning
 * (per the `WorkspaceRepoEntry.groups` JSDoc contract) so a typo'd group
 * reference does not silently broaden — or silently no-op — a member's
 * effective selection.
 */
function resolveGroupDeltas(
  defined: Record<string, WorkspaceGroupDelta> | undefined,
  memberships: string[] | undefined,
  repoPath: string,
): WorkspaceGroupDelta[] {
  if (!memberships || memberships.length === 0) return [];
  const deltas: WorkspaceGroupDelta[] = [];
  for (const name of memberships) {
    const delta = defined?.[name];
    if (!delta) {
      verbose(`workspace/sync: repo "${repoPath}" references unknown group "${name}" — skipped`);
      continue;
    }
    deltas.push(delta);
  }
  return deltas;
}

async function syncSingleRepo(
  workspaceRoot: string,
  wsManifest: WorkspaceManifest,
  wsChecksum: string,
  repoEntry: WorkspaceRepoEntry,
  index: Awaited<ReturnType<typeof buildContentIndex>>,
  unconditionalIds: Set<string>,
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

  // Resolve effective config. D1-10 (Cycle 11): resolve this repo's group
  // memberships (`repoEntry.groups[]` names) to their `defaults.groups[name]`
  // deltas, in declared order, and feed them into the layered merge. Unknown
  // group names are dropped with a verbose() warning per the
  // WorkspaceRepoEntry.groups contract — a typo must not silently broaden a
  // member's selection. Before this the group layer was validated + persisted
  // but never applied at resolution time.
  const groupDeltas = resolveGroupDeltas(wsManifest.defaults.groups, repoEntry.groups, repoEntry.path);
  const resolved = resolveRepoConfig(wsManifest.defaults, repoEntry.overrides, unconditionalIds, groupDeltas);
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

  // D1-SA1.10-05 (Cycle 12, D1): snapshot the member's prior per-adapter
  // output paths BEFORE createManifest rebuilds a fresh manifest (whose
  // managedFilesByAdapter starts empty). The adapter loop below diffs the
  // current emission against this baseline and sweeps files a shrunk selection
  // (excluded rule, removed tool/group) no longer emits — otherwise the member
  // repo keeps loading a "ghost" adapter output the workspace lead believes is
  // gone, and the fresh per-run manifest drops it from tracking so
  // `hatch3r clean` can never reclaim it. Mirrors src/cli/commands/sync.ts.
  const previousManagedByAdapter: Record<string, string[]> = existingManifest?.managedFilesByAdapter
    ? { ...existingManifest.managedFilesByAdapter }
    : {};

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
  // D1-SA1.10-05 (Cycle 12, D1): assemble the new per-adapter path map as
  // adapters succeed, and collect orphan-sweep entries to surface after the
  // loop. Mirrors the single-repo collectors in src/cli/commands/sync.ts.
  const newManagedByAdapter: Record<string, string[]> = {};
  const orphanEntries: OrphanCleanupEntry[] = [];
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
        // D11-H-1 (Cycle 10 D11): thread the workspace-cascade `force` flag
        // into the per-write call. `WorkspaceSyncOptions.force` ("Overwrite
        // locally modified canonical files in sub-repos") is set by `hatch3r
        // sync --force` (src/cli/commands/sync.ts passes `force: opts.force`
        // into syncWorkspaceRepos) but was previously dropped here — the flag
        // was dead on the user-content side. Passing it through makes the
        // documented contract real: with --force, a sub-repo managed file whose
        // HATCH3R:BEGIN/END markers were stripped is regenerated rather than
        // skipped (safeWriteFile honours `force` regardless of marker presence).
        await safeWriteFile(join(repoDir, out.path), out.content, {
          managedContent: out.managedContent,
          appendIfNoBlock: true,
          force: options.force,
        });
        addManagedFile(manifest, out.path);
      }
      // D1-SA1.10-05 (Cycle 12, D1): record this adapter's emitted paths and
      // sweep the member's stale outputs. `previousManagedByAdapter[tool]` is
      // the prior-run baseline; a path in it this run no longer emits is
      // unlinked (subject to the user-wrapped / adapter-root safety checks in
      // sweepOrphansForAdapter). Root-only containment (no packageRoots
      // argument): workspace members do not emit monorepo per-package copies.
      const currentPaths = outputs.map((o) => o.path);
      newManagedByAdapter[tool] = currentPaths;
      const priorPaths = previousManagedByAdapter[tool];
      if (priorPaths && priorPaths.length > 0) {
        const entries = await sweepOrphansForAdapter(tool, repoDir, priorPaths, currentPaths);
        orphanEntries.push(...entries);
      }
      toolsSynced.push(tool);
    } catch (err) {
      options.onWarn?.(
        `Failed to generate ${tool} output for ${repoEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // D1-SA1.10-05 (Cycle 12, D1): persist managedFilesByAdapter so the NEXT
  // sync has a per-adapter history to diff against — createManifest above built
  // a fresh manifest with none. Merge: a failed adapter keeps its prior paths
  // (its outputs were not re-verified this run); a successful adapter
  // overwrites with the fresh list. Mirrors the end-of-run merge in
  // src/cli/commands/sync.ts.
  const mergedByAdapter: Record<string, string[]> = { ...previousManagedByAdapter };
  for (const [tool, paths] of Object.entries(newManagedByAdapter)) {
    mergedByAdapter[tool] = [...paths];
  }
  manifest.managedFilesByAdapter = mergedByAdapter;

  // Write manifest again with managedFiles + managedFilesByAdapter populated
  await writeManifest(repoDir, manifest);

  // D1-SA1.10-05 (Cycle 12, D1): surface swept/skipped orphan outputs so the
  // workspace operator sees which stale member files were reclaimed (or refused
  // for safety) this run.
  const orphanDiag = formatOrphanCleanupDiagnostic(orphanEntries);
  if (orphanDiag) options.onWarn?.(orphanDiag);

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
