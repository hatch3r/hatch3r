/**
 * Orphan adapter-output cleanup.
 *
 * Wave B3 landed `NN-hatch3r-*` precedence-prefixed filenames for per-file
 * rule adapters (cursor, windsurf, copilot, claude, cline). End-user repos
 * upgrading from a pre-B3 hatch3r pick up the new path on `hatch3r sync`,
 * but the old `hatch3r-*.mdc` file remains on disk. Both files then load
 * concurrently in Cursor/Windsurf/Claude/Roo, producing duplicate guidance
 * and (worse) stale guidance.
 *
 * This module provides a deterministic, safety-filtered sweep that unlinks
 * files previously emitted by hatch3r but not emitted by the current
 * adapter set.
 *
 * ## Safety constraints
 *
 * A candidate path is deleted only when ALL of the following hold:
 * 1. The file still exists on disk.
 * 2. Its basename matches `hatch3r-*` or `^\d{2}-hatch3r-*` (the same
 *    dual-prefix recognition used by {@link src/merge/safeWrite.isManagedPath}).
 * 3. It lives inside a known adapter output root (see
 *    {@link src/archive/index.TOOL_PATH_PREFIXES}).
 * 4. It does NOT carry a `HATCH3R:BEGIN ... END` managed block that wraps
 *    user-authored content mid-file — if only a block is managed, we do
 *    not own the file and we must not unlink it.
 *
 * ## First-run behaviour
 *
 * When `manifest.managedFilesByAdapter[adapter]` is absent, cleanup is a
 * no-op for that adapter: no history means no inferrable orphans. We do
 * NOT attempt to guess orphans from disk alone (that would risk deleting
 * files a prior version of hatch3r never owned).
 *
 * ## Silent Failure Contract
 *
 * Every catch block emits either a structured diagnostic via the returned
 * `OrphanCleanupEntry[]` (with `removed: false` and `error`) or a console
 * warning when the error occurs before per-file bookkeeping is possible
 * (e.g. path-traversal rejection). Callers surface these diagnostics via
 * `warn()` per governance/CONSTITUTION.md §Silent Failure Contract.
 */

import { access, readFile, unlink } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { HATCH3R_PREFIX } from "../types.js";
import { hasManagedBlock } from "./managedBlocks.js";
import { TOOL_PATH_PREFIXES } from "../archive/index.js";

/**
 * Wave B3: Match the precedence-prefixed `NN-hatch3r-*` naming emitted by
 * per-file rule adapters (cursor, windsurf, copilot, claude, cline). The
 * prefix is 2 decimal digits (10/30/50/70 for critical/high/normal/low)
 * followed by a hyphen. Mirrors the pattern in `src/merge/safeWrite.ts`.
 */
const NN_HATCH3R_PREFIX_RE = /^\d{2}-hatch3r-/;

/** True when a filename basename represents a hatch3r-managed output. */
function isManagedOutputBasename(fileName: string): boolean {
  return fileName.startsWith(HATCH3R_PREFIX) || NN_HATCH3R_PREFIX_RE.test(fileName);
}

/**
 * Per-candidate disposition. Exposed so callers can log per-orphan
 * diagnostics instead of a bare count — preserves the Silent Failure
 * Contract when e.g. unlink fails with EACCES.
 */
export interface OrphanCleanupEntry {
  /** The adapter tool name that previously owned the path. */
  adapter: string;
  /** Repo-relative path as recorded in `managedFilesByAdapter`. */
  path: string;
  /** Whether the sweep actually unlinked the file. */
  removed: boolean;
  /**
   * Why the sweep handled this path the way it did. One of:
   *  - `"unlinked"` — removed successfully (`removed: true`).
   *  - `"missing"` — already absent on disk; skipped silently.
   *  - `"not-managed-basename"` — basename does not match hatch3r-* or NN-hatch3r-*; skipped.
   *  - `"outside-adapter-root"` — path lives outside any known adapter output root; skipped (path-traversal defense).
   *  - `"user-wrapped"` — file exists with a managed block wrapping user content; skipped (we do not own it).
   *  - `"unlink-failed"` — unlink threw; entry carries `error`.
   *  - `"read-failed"` — stat/read failed before a safety check could complete; entry carries `error`.
   */
  reason:
    | "unlinked"
    | "missing"
    | "not-managed-basename"
    | "outside-adapter-root"
    | "user-wrapped"
    | "unlink-failed"
    | "read-failed";
  /** Populated when `reason === "unlink-failed"` or `"read-failed"`. */
  error?: string;
}

/**
 * Compute set difference: paths recorded by the previous sync that the
 * current adapter run did NOT re-emit. Returned paths are repo-relative.
 */
export function diffOrphanCandidates(
  previousPaths: string[] | undefined,
  currentPaths: Iterable<string>,
): string[] {
  if (!previousPaths || previousPaths.length === 0) return [];
  const current = new Set<string>(currentPaths);
  const orphans: string[] = [];
  for (const p of previousPaths) {
    if (!current.has(p)) orphans.push(p);
  }
  return orphans;
}

/**
 * Check whether a repo-relative path lives inside a declared adapter
 * output root. Used to reject manifest entries pointing outside the
 * adapter surface (path-traversal defense).
 *
 * Normalises the path so `../../../secret` or an absolute path cannot
 * escape the adapter roots. Matches either a file prefix (exact-file
 * entry like `CLAUDE.md`) or a directory prefix (`.cursor/`).
 */
function isPathInKnownAdapterRoot(relPath: string, rootDir: string): boolean {
  // Reject absolute paths and any path that normalizes to outside rootDir.
  // resolve() from a relative path joined with rootDir gives the canonical
  // absolute path; if it does not stay under rootDir the candidate is
  // rejected unconditionally.
  const abs = resolve(rootDir, relPath);
  const rel = relative(rootDir, abs);
  if (rel.startsWith("..") || resolve(rootDir, rel) !== abs) return false;
  // Empty relative ("./") is not a file path.
  if (rel === "" || rel === ".") return false;
  // Normalise to posix-style for prefix comparison with TOOL_PATH_PREFIXES.
  const posix = rel.split(/[\\/]/).join("/");
  for (const prefixes of Object.values(TOOL_PATH_PREFIXES)) {
    for (const prefix of prefixes) {
      if (prefix.endsWith("/")) {
        if (posix.startsWith(prefix) && posix.length > prefix.length) return true;
      } else if (posix === prefix) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Read a file and determine whether it contains a managed block whose
 * surrounding content has user-authored text. Returns true only when we
 * can prove the file belongs (partly) to the user. Read/access errors
 * are surfaced via the returned tuple so callers can emit a diagnostic.
 */
async function fileIsUserWrapped(
  absPath: string,
): Promise<{ wrapped: boolean; error?: string }> {
  try {
    const content = await readFile(absPath, "utf-8");
    if (!hasManagedBlock(content)) {
      // No block at all => file is fully managed (or fully user with no
      // block, but that case is covered by the basename filter upstream).
      return { wrapped: false };
    }
    // Block present. If anything outside the block is non-whitespace, it
    // is user-authored content we must not touch.
    const before = content.slice(0, content.indexOf("<!-- HATCH3R:BEGIN -->"));
    const endMarker = "<!-- HATCH3R:END -->";
    const endIdx = content.indexOf(endMarker);
    const after = endIdx === -1 ? "" : content.slice(endIdx + endMarker.length);
    const userBefore = before.trim();
    const userAfter = after.trim();
    return { wrapped: userBefore.length > 0 || userAfter.length > 0 };
  } catch (err) {
    return { wrapped: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Sweep orphan adapter outputs for one adapter.
 *
 * @param adapter      The adapter tool name (e.g. `"cursor"`).
 * @param rootDir      Absolute path to the repo root.
 * @param previousPaths Paths recorded under `managedFilesByAdapter[adapter]`
 *                     from the prior successful run. Pass `undefined` to
 *                     short-circuit (no history => no orphans).
 * @param currentPaths Paths emitted by the current adapter run.
 * @returns One entry per candidate, including skipped entries. Empty when
 *          `previousPaths` is undefined/empty.
 */
export async function sweepOrphansForAdapter(
  adapter: string,
  rootDir: string,
  previousPaths: string[] | undefined,
  currentPaths: Iterable<string>,
): Promise<OrphanCleanupEntry[]> {
  const candidates = diffOrphanCandidates(previousPaths, currentPaths);
  if (candidates.length === 0) return [];

  const results: OrphanCleanupEntry[] = [];
  for (const relPath of candidates) {
    // Filter 1 (security-critical): path must lie inside a known adapter
    // output root. This is the path-traversal defense — a manifest
    // tampered to point at `/etc/hosts` or `../../../secret` is rejected
    // before we touch disk, regardless of basename. Root check runs BEFORE
    // the basename check so a tampered entry with a benign-looking name
    // (e.g. `../hatch3r-evil.mdc`) cannot bypass containment.
    if (!isPathInKnownAdapterRoot(relPath, rootDir)) {
      results.push({ adapter, path: relPath, removed: false, reason: "outside-adapter-root" });
      continue;
    }
    // Filter 2: basename must be hatch3r-* or NN-hatch3r-*. A path inside
    // an adapter root but with a non-hatch3r basename is one we never
    // emitted; refuse the unlink.
    const name = basename(relPath);
    if (!isManagedOutputBasename(name)) {
      results.push({ adapter, path: relPath, removed: false, reason: "not-managed-basename" });
      continue;
    }
    // Resolve to absolute and re-check containment to defeat symlink
    // games: if the file has been replaced by a symlink pointing outside
    // rootDir, resolve() still normalises the manifest-recorded path
    // (not the symlink target). unlink() removes the symlink itself, not
    // the target, so this is safe.
    const absPath = resolve(rootDir, relPath);
    if (!absPath.startsWith(resolve(rootDir) + (absPath.includes("\\") ? "\\" : "/")) &&
        absPath !== resolve(rootDir)) {
      // Should already be caught by isPathInKnownAdapterRoot, but belt-
      // and-suspenders for path-traversal.
      results.push({ adapter, path: relPath, removed: false, reason: "outside-adapter-root" });
      continue;
    }
    // Filter 3: file must still exist. Missing files are already gone.
    let exists = false;
    try {
      exists = await fileExists(absPath);
    } catch (err) {
      results.push({
        adapter,
        path: relPath,
        removed: false,
        reason: "read-failed",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!exists) {
      results.push({ adapter, path: relPath, removed: false, reason: "missing" });
      continue;
    }
    // Filter 4: file must not carry a managed block wrapping user content.
    const wrapCheck = await fileIsUserWrapped(absPath);
    if (wrapCheck.error) {
      results.push({
        adapter,
        path: relPath,
        removed: false,
        reason: "read-failed",
        error: wrapCheck.error,
      });
      continue;
    }
    if (wrapCheck.wrapped) {
      results.push({ adapter, path: relPath, removed: false, reason: "user-wrapped" });
      continue;
    }
    // All filters passed — unlink.
    try {
      await unlink(absPath);
      results.push({ adapter, path: relPath, removed: true, reason: "unlinked" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Raced with another process; treat as missing.
        results.push({ adapter, path: relPath, removed: false, reason: "missing" });
      } else {
        results.push({
          adapter,
          path: relPath,
          removed: false,
          reason: "unlink-failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Silent Failure Contract note: caller receives the full list (including
  // skipped/failed entries) and MUST surface at least the failed entries
  // via warn() / observability.
  return results;
}

/**
 * Format a list of orphan cleanup entries as a human-readable diagnostic
 * suitable for `warn()`. Returns `null` when no diagnostic is warranted
 * (all entries were either `unlinked` or uneventful skips like `missing`).
 * We do surface `user-wrapped` skips — operators should know a planned
 * delete was refused for safety.
 */
export function formatOrphanCleanupDiagnostic(
  entries: OrphanCleanupEntry[],
): string | null {
  if (entries.length === 0) return null;
  const unlinked = entries.filter((e) => e.reason === "unlinked");
  const failed = entries.filter((e) => e.reason === "unlink-failed" || e.reason === "read-failed");
  const safetySkips = entries.filter(
    (e) => e.reason === "user-wrapped" || e.reason === "outside-adapter-root" || e.reason === "not-managed-basename",
  );
  const parts: string[] = [];
  if (unlinked.length > 0) {
    parts.push(
      `Unlinked ${unlinked.length} orphaned adapter output(s) from prior runs: ` +
        unlinked.map((e) => `${e.path} (${e.adapter})`).join(", "),
    );
  }
  if (safetySkips.length > 0) {
    parts.push(
      `Skipped ${safetySkips.length} orphan candidate(s) for safety: ` +
        safetySkips.map((e) => `${e.path} (${e.reason})`).join(", "),
    );
  }
  if (failed.length > 0) {
    parts.push(
      `Failed to remove ${failed.length} orphan candidate(s); remove manually: ` +
        failed.map((e) => `${e.path} (${e.error ?? e.reason})`).join(", "),
    );
  }
  if (parts.length === 0) return null;
  return parts.join(". ");
}

/**
 * Internal helper re-exported for the dirname of relative paths in tests.
 * No runtime consumer outside the cleanup module uses it.
 */
export const _internals = { dirname };
