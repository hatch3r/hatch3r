/**
 * src/audit/cleanup.ts
 *
 * Workspace cleanup enforcer for `.audit-workspace/`. Code-enforces the
 * cleanup contract that lives in `governance/AUDIT.md:108` today as a
 * prompt instruction with no enforcement. Stale-cycle markers are
 * detected via baseline-commit time comparison; preserve list keeps
 * `registry-anchor-log.jsonl`, `verified-inventory.json`, and
 * `current-insights.json` regardless of mtime.
 *
 * Pillars: P5 (Governance Self-Quality — code-enforced cleanup contract),
 *          P4 (Lean Coverage — bounded workspace state).
 *
 * Pure-vs-IO split (mirrors registry-schema.ts / archive.ts pattern):
 *   - `checkWorkspace`  → produces a CleanupReport without mutating state.
 *   - `cleanWorkspace`  → calls `checkWorkspace`, then unlinks per options.
 *   - `readBaselineCommitTime` → resolves baseline.json -> ms-epoch with
 *     `git log -1 --format=%ct <sha>` fallback; returns null on any failure.
 *
 * The CLI shim (`scripts/clean-audit-workspace.ts`) binds these to the
 * canonical repo paths and exit-code semantics.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { join, basename } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Files that always stay in the workspace root regardless of mtime.
 * Mirrors the prompt-only contract at `governance/AUDIT.md:108`.
 *
 * - `registry-anchor-log.jsonl`: chain-of-custody for registry writes;
 *   rotation handled by `npm run audit:archive` (Phase 3 / 4).
 * - `verified-inventory.json`: per-cycle inventory baseline used by D16.
 * - `current-insights.json`: ephemeral in-flight cycle insights;
 *   `archiveCycle` promotes this into the ring buffer at end-of-cycle.
 */
export const PRESERVE_LIST: ReadonlyArray<string> = [
  "registry-anchor-log.jsonl",
  "verified-inventory.json",
  "current-insights.json",
];

/**
 * Subdirectories that are managed by the archive layer rather than the
 * cleanup enforcer. `cold/` is the long-term archive tarball location.
 * Cleanup never traverses these; the archive subsystem owns lifecycle.
 */
const PRESERVED_SUBDIRS: ReadonlySet<string> = new Set(["cold"]);

/** Default staleness window when no baseline-commit time is available: 7 days. */
const DEFAULT_STALENESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupReport {
  /** Total non-preserved files inspected. */
  scanned: number;
  /** Files older than the staleness threshold (will be removed by clean()). */
  stale: string[];
  /** Files in the workspace root that are in PRESERVE_LIST. Always retained. */
  preserved: string[];
  /** Files non-preserved but newer than threshold; retained by --check, removed by --strict. */
  fresh: string[];
  /** The staleness cutoff (ms epoch) used for the report. */
  cutoffMs: number;
}

export interface CheckOptions {
  workspaceDir: string;
  /** ms epoch; if omitted, falls back to "7 days ago". */
  baselineCommitTime?: number;
  /** Default PRESERVE_LIST. */
  preserveList?: ReadonlyArray<string>;
}

export interface CleanOptions extends CheckOptions {
  /** When true, removes BOTH stale and fresh non-preserved files. */
  strict?: boolean;
  /** When true, returns the would-remove list without unlinking. */
  dryRun?: boolean;
}

export class CleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupError";
  }
}

/**
 * Resolve baseline.json into an ms-epoch commit time. Returns null when:
 *  - the file does not exist,
 *  - the JSON is malformed,
 *  - no recognized field carries the time and `git log` cannot resolve a sha,
 *  - any underlying I/O or git invocation throws.
 *
 * Field-resolution order:
 *   1. `commit_time_ms`   (number; ms epoch)
 *   2. `committedAtMs`    (number; ms epoch)
 *   3. `commitTime`       (number; seconds epoch — multiplied by 1000)
 *   4. `commit_sha`       (string; resolved via `git log -1 --format=%ct`)
 *   5. `baselineCommit`   (string; resolved via `git log -1 --format=%ct`)
 *
 * Uses `execFile` (not `exec`) with safe argv to avoid shell interpolation
 * across the user-controlled sha string.
 */
/* eslint-disable silent-failure/no-silent-catch -- documented null-fallback:
 * the caller (`checkWorkspace`) treats null as "no baseline available, fall
 * back to 7-day window". Diagnostics surface through the CLI report rather
 * than through exceptions; preserving the silent fallback keeps the CLI
 * happy on first-run / fresh-clone scenarios.
 */
export async function readBaselineCommitTime(
  baselineJsonPath: string,
): Promise<number | null> {
  let content: string;
  try {
    content = await readFile(baselineJsonPath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.commit_time_ms === "number" && Number.isFinite(obj.commit_time_ms)) {
    return obj.commit_time_ms;
  }
  if (typeof obj.committedAtMs === "number" && Number.isFinite(obj.committedAtMs)) {
    return obj.committedAtMs;
  }
  if (typeof obj.commitTime === "number" && Number.isFinite(obj.commitTime)) {
    // commitTime is conventionally seconds-epoch (matches `git log %ct`).
    return obj.commitTime * 1000;
  }

  // Sha-based resolution. Try commit_sha then baselineCommit.
  const shaCandidates: string[] = [];
  if (typeof obj.commit_sha === "string" && obj.commit_sha.length > 0) {
    shaCandidates.push(obj.commit_sha);
  }
  if (typeof obj.baselineCommit === "string" && obj.baselineCommit.length > 0) {
    shaCandidates.push(obj.baselineCommit);
  }
  // Some baselines wrap the sha under `commit` (e.g. our own baseline.json).
  if (typeof obj.commit === "string" && obj.commit.length > 0) {
    shaCandidates.push(obj.commit);
  }

  for (const sha of shaCandidates) {
    // Defensive: refuse anything that doesn't look like a hex sha so a
    // surprise field can't pivot into git-arg injection.
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) continue;
    try {
      const { stdout } = await execFileAsync("git", [
        "log",
        "-1",
        "--format=%ct",
        sha,
      ]);
      const seconds = Number(stdout.trim());
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    } catch {
      // Fall through to the next candidate; `git log` returns non-zero for
      // unknown shas, missing .git, etc.
    }
  }

  return null;
}
/* eslint-enable silent-failure/no-silent-catch */

interface ScannedEntry {
  /** Absolute path to the entry on disk. */
  absolutePath: string;
  /** Path used in the report (basename for root files, `<dir>/<basename>` for nested). */
  reportPath: string;
  /** Workspace-root basename for preserve-list comparison. Empty for nested files. */
  rootBasename: string;
  /** True when this entry lives in a non-preserved subdirectory. */
  isNested: boolean;
  /** True when the entire entry is itself a directory we plan to recursively remove. */
  isDirectory: boolean;
  /** mtime in ms epoch. */
  mtimeMs: number;
}

/**
 * Walk one level into the workspace. Workspace files are typically flat or in
 * known subdirs (e.g. `wave-3/`, `cold/`). Nested files are reported as
 * `<dir>/<basename>` for inspection. Whole subdirectories are surfaced as
 * single `ScannedEntry` rows with `isDirectory: true` so callers can rm-rf
 * them rather than having to walk every leaf file individually.
 *
 * `cold/` (and any other entry in PRESERVED_SUBDIRS) is skipped entirely —
 * the archive subsystem manages its lifecycle.
 */
async function scanOneLevel(
  workspaceDir: string,
  preserveSet: ReadonlySet<string>,
): Promise<{ entries: ScannedEntry[]; preservedRoots: string[] }> {
  const entries: ScannedEntry[] = [];
  const preservedRoots: string[] = [];

  let dirEntries: string[];
  try {
    dirEntries = await readdir(workspaceDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { entries, preservedRoots };
    throw err;
  }

  for (const name of dirEntries) {
    const abs = join(workspaceDir, name);
    let entryStat;
    try {
      entryStat = await stat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }

    if (entryStat.isDirectory()) {
      if (PRESERVED_SUBDIRS.has(name)) {
        // Owned by the archive layer; never inspected by cleanup.
        continue;
      }
      // Whole-subdir removal target. Use the directory's own mtime to
      // classify stale-vs-fresh; recursive rm happens at clean() time.
      entries.push({
        absolutePath: abs,
        reportPath: name,
        rootBasename: name,
        isNested: false,
        isDirectory: true,
        mtimeMs: entryStat.mtimeMs,
      });
      continue;
    }

    if (preserveSet.has(name)) {
      preservedRoots.push(name);
      continue;
    }

    entries.push({
      absolutePath: abs,
      reportPath: name,
      rootBasename: name,
      isNested: false,
      isDirectory: false,
      mtimeMs: entryStat.mtimeMs,
    });
  }

  return { entries, preservedRoots };
}

/**
 * Inspect `workspaceDir` and produce a CleanupReport. Does not mutate.
 *
 * Algorithm:
 *   1. Resolve cutoff: `baselineCommitTime ?? Date.now() - 7d`.
 *   2. Walk one level:
 *      - Files matching `preserveList` at the root → `preserved`.
 *      - Subdirs in `PRESERVED_SUBDIRS` (e.g. `cold/`) → ignored.
 *      - Other root files + non-preserved subdirs → classified.
 *   3. Each remaining entry is `stale` if its mtime < cutoff, else `fresh`.
 *
 * Subdirectories are reported as a single entry (the dir itself) using its
 * own mtime; clean() recursively removes the tree. Mirrors the documented
 * test cases ("removes empty subdirs and recursive cleans non-preserved
 * subdir trees").
 */
export async function checkWorkspace(opts: CheckOptions): Promise<CleanupReport> {
  const preserveList = opts.preserveList ?? PRESERVE_LIST;
  const preserveSet = new Set(preserveList);
  const cutoffMs =
    opts.baselineCommitTime ?? Date.now() - DEFAULT_STALENESS_WINDOW_MS;

  const { entries, preservedRoots } = await scanOneLevel(
    opts.workspaceDir,
    preserveSet,
  );

  const stale: string[] = [];
  const fresh: string[] = [];

  for (const e of entries) {
    if (e.mtimeMs < cutoffMs) {
      stale.push(e.reportPath);
    } else {
      fresh.push(e.reportPath);
    }
  }

  return {
    scanned: entries.length,
    stale,
    preserved: preservedRoots,
    fresh,
    cutoffMs,
  };
}

/**
 * Run cleanup. Calls checkWorkspace to build the report, then removes either
 * stale-only (default) or stale + fresh (strict). Preserved files and
 * preserved subdirs (e.g. `cold/`) are never touched.
 *
 * `dryRun` returns the report with `removed: []`. Useful for previewing the
 * action plan in --check mode.
 *
 * Removal semantics:
 *   - Plain files: `unlink`.
 *   - Subdirectories (other than preserved): `rm` recursive + force.
 *
 * Throws CleanupError when an unlink/rm fails for a target the report listed
 * — this is a substantive failure, not transient (the file was there at scan
 * time and has been picked for removal). Re-running is safe by construction:
 * the second pass produces an empty report.
 */
export async function cleanWorkspace(
  opts: CleanOptions,
): Promise<{ report: CleanupReport; removed: string[] }> {
  const report = await checkWorkspace(opts);

  if (opts.dryRun) {
    return { report, removed: [] };
  }

  const targets = new Set(report.stale);
  if (opts.strict) {
    for (const f of report.fresh) targets.add(f);
  }

  const removed: string[] = [];
  for (const reportPath of targets) {
    const abs = join(opts.workspaceDir, reportPath);
    let entryStat;
    try {
      entryStat = await stat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw new CleanupError(
        `failed to stat ${reportPath} during cleanup: ${(err as Error).message}`,
      );
    }
    try {
      if (entryStat.isDirectory()) {
        await rm(abs, { recursive: true, force: true });
      } else {
        await unlink(abs);
      }
      removed.push(reportPath);
    } catch (err) {
      throw new CleanupError(
        `failed to remove ${reportPath}: ${(err as Error).message}`,
      );
    }
  }

  return { report, removed };
}

/** Internal export for the CLI/test harness. */
export const __internal = {
  PRESERVED_SUBDIRS,
  DEFAULT_STALENESS_WINDOW_MS,
  basename,
};
