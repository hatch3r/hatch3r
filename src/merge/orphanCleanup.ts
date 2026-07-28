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
 *    {@link src/archive/index.TOOL_PATH_PREFIXES}). In a monorepo (D14-5) the
 *    per-package roots `<pkg>/<prefix>` are also accepted so a removed
 *    package's outputs can be reclaimed; the candidate is still re-validated
 *    against the repo root so this never escapes the project tree.
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
import { extractCustomContent, hasManagedBlock } from "./managedBlocks.js";
import { TOOL_PATH_PREFIXES } from "../archive/index.js";
import { verbose } from "../cli/shared/ui.js";

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
 *
 * CLI-tooling pivot (plan §4.7 / Wave 3 item 21): when a user deselects
 * a CLI tool, the adapter's `readCliFilteredSkills` returns a smaller
 * skill set, so the next sync emits a smaller `managedFilesByAdapter`
 * list. The diff against the previous (larger) list naturally surfaces
 * the dropped `hatch3r-cli-{id}` skill paths as orphans — no special
 * case is needed here.
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
 * Match a posix path against a single adapter prefix. A trailing-slash
 * prefix (`.cursor/`) is a directory and matches any strictly-deeper path;
 * a bare prefix (`CLAUDE.md`) is an exact-file entry and matches only itself.
 */
function posixMatchesPrefix(posix: string, prefix: string): boolean {
  if (prefix.endsWith("/")) {
    return posix.startsWith(prefix) && posix.length > prefix.length;
  }
  return posix === prefix;
}

/**
 * Build the list of accepted adapter-root prefixes for the containment
 * check. Always includes the repo-root prefixes from {@link TOOL_PATH_PREFIXES}.
 * When `packageRoots` is supplied (monorepo `manifest.packages` paths), each
 * `<pkg>/<prefix>` is also accepted so a per-package adapter output —
 * e.g. `packages/api/.cursor/rules/50-hatch3r-testing.mdc` — passes
 * containment instead of being classified `outside-adapter-root` (D14-5).
 *
 * `packageRoots` entries are posix-normalised and trailing-slash-trimmed;
 * an entry that is empty, absolute, or escapes the root via `..` is dropped
 * (it could never be a legitimate package subdirectory and re-admitting it
 * would weaken the path-traversal defense).
 */
function buildAcceptedPrefixes(packageRoots?: readonly string[]): string[] {
  const prefixes: string[] = [];
  for (const list of Object.values(TOOL_PATH_PREFIXES)) {
    for (const prefix of list) prefixes.push(prefix);
  }
  if (packageRoots) {
    for (const root of packageRoots) {
      const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
      if (normalized.length === 0) continue;
      if (normalized.startsWith("/")) continue;
      if (normalized.startsWith("..") || normalized.includes("/..")) continue;
      for (const list of Object.values(TOOL_PATH_PREFIXES)) {
        for (const prefix of list) prefixes.push(`${normalized}/${prefix}`);
      }
    }
  }
  return prefixes;
}

/**
 * Derive per-package roots from the orphan candidate set itself (D14-5).
 *
 * The literal source named in the finding — `manifest.packages` — lists only
 * packages the workspace STILL has. The orphan case is the opposite: a package
 * was removed from the workspace globs, so its outputs must be reclaimed even
 * though it is gone from `manifest.packages`. A candidate path written by a
 * prior sync has the shape `<pkg>/<adapter-prefix>…`; stripping a known adapter
 * prefix recovers `<pkg>`. We union these structurally-recovered roots with the
 * explicit `manifest.packages` roots so removed packages are still covered.
 *
 * This does not weaken the path-traversal defense: a recovered root only widens
 * the accepted-prefix set, and every candidate is still re-validated by
 * {@link isPathInKnownAdapterRoot}'s `resolve`/`relative` normalisation before
 * any unlink — a `..`-bearing candidate is rejected there regardless of what
 * roots were recovered.
 */
function derivePackageRootsFromCandidates(candidates: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const candidate of candidates) {
    const posix = candidate.replace(/\\/g, "/");
    for (const list of Object.values(TOOL_PATH_PREFIXES)) {
      for (const prefix of list) {
        // Match `<pkg>/<prefix>` where `<pkg>` is a non-empty, non-traversing
        // path segment chain. The prefix is anchored by a `/` separator so a
        // root-level `.cursor/…` path (no package) does not yield a phantom root.
        const idx = posix.indexOf(`/${prefix}`);
        if (idx <= 0) continue;
        const pkg = posix.slice(0, idx);
        if (pkg.length === 0) continue;
        if (pkg.startsWith("..") || pkg.includes("/..") || pkg.startsWith("/")) continue;
        roots.add(pkg);
      }
    }
  }
  return [...roots];
}

/**
 * Check whether a repo-relative path lives inside a declared adapter
 * output root. Used to reject manifest entries pointing outside the
 * adapter surface (path-traversal defense).
 *
 * Normalises the path so `../../../secret` or an absolute path cannot
 * escape the adapter roots. Matches either a file prefix (exact-file
 * entry like `CLAUDE.md`) or a directory prefix (`.cursor/`).
 *
 * `acceptedPrefixes` is the precomputed prefix list from
 * {@link buildAcceptedPrefixes} — root prefixes plus, in a monorepo, the
 * per-package `<pkg>/<prefix>` variants (D14-5).
 */
function isPathInKnownAdapterRoot(
  relPath: string,
  rootDir: string,
  acceptedPrefixes: readonly string[],
): boolean {
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
  for (const prefix of acceptedPrefixes) {
    if (posixMatchesPrefix(posix, prefix)) return true;
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
    if (!hasManagedBlock(content, absPath)) {
      // No block at all => file is fully managed (or fully user with no
      // block, but that case is covered by the basename filter upstream).
      return { wrapped: false };
    }
    // Block present. If anything outside the block is non-whitespace, it
    // is user-authored content we must not touch. `extractCustomContent`
    // handles any known marker variant (issue #76: YAML `#` markers in
    // `.github/workflows/*.yml`), so we don't hard-code HTML markers here.
    // D11-6 (Cycle 11 Wave 2): pass absPath so detection is line-anchored and
    // path-variant-aware — a `.yml` orphan whose body merely mentions a marker
    // token is no longer mis-read as user-wrapped (which would wrongly veto the
    // unlink) or mis-truncated (which would wrongly clear the veto).
    const userOutside = extractCustomContent(content, absPath).trim();
    return { wrapped: userOutside.length > 0 };
  } catch (err) {
    // Caller (sweepOrphansForAdapter) surfaces wrapCheck.error as a "read-failed"
    // diagnostic in the result list. Also emit under --verbose so operators see
    // the underlying cause without grepping the structured result.
    const message = err instanceof Error ? err.message : String(err);
    verbose(`orphanCleanup: fileIsUserWrapped(${absPath}) read failed — ${message}`);
    return { wrapped: false, error: message };
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
 * @param currentPaths Paths emitted by the current adapter run. In a monorepo
 *                     this MUST include both root and per-package paths so a
 *                     still-emitted per-package file is not mistaken for an
 *                     orphan (the diff baseline).
 * @param packageRoots Optional monorepo `manifest.packages` paths. When
 *                     present, per-package adapter roots (`<pkg>/<prefix>`) are
 *                     accepted in the containment check so a removed package's
 *                     outputs can be reclaimed (D14-5). Omit / pass `undefined`
 *                     for single-package repos.
 * @param options release/2.8.5 (BUG-3 secondary): `trustedExactPaths` — repo-
 *                relative posix paths allowed to bypass ONLY the
 *                hatch3r-basename filter (filter 2). Callers pass the exact
 *                paths the manifest's `managedFilesByAdapter` recorded for a
 *                DESELECTED adapter, after explicit user consent: provenance
 *                is manifest-recorded, not inferred, so a non-`hatch3r-*`
 *                managed artifact like `CLAUDE.md` can be reclaimed. Every
 *                other safety filter still applies unconditionally — adapter-
 *                root containment (filters 1 + the symlink re-check) and the
 *                user-wrapped veto (filter 4), so a `CLAUDE.md` carrying user
 *                content outside the HATCH3R markers is still refused and
 *                disclosed. The default sync/update sweeps pass no option and
 *                keep the strict basename filter.
 * @returns One entry per candidate, including skipped entries. Empty when
 *          `previousPaths` is undefined/empty.
 */
export async function sweepOrphansForAdapter(
  adapter: string,
  rootDir: string,
  previousPaths: string[] | undefined,
  currentPaths: Iterable<string>,
  packageRoots?: readonly string[],
  options?: { trustedExactPaths?: ReadonlySet<string> },
): Promise<OrphanCleanupEntry[]> {
  const candidates = diffOrphanCandidates(previousPaths, currentPaths);
  if (candidates.length === 0) return [];

  // D14-5: per-package containment is opt-in via the presence of the
  // `packageRoots` argument. A monorepo-aware caller (sync.ts) passes the
  // current `manifest.packages` paths (possibly empty for a non-monorepo
  // repo); a root-only caller that does not emit per-package outputs (update.ts)
  // passes `undefined` and keeps the pre-D14-5 root-only containment so it never
  // deletes a per-package file it did not write. When opted in, we accept BOTH
  // the explicit `manifest.packages` roots and the roots structurally recovered
  // from the candidate set — the latter covers a package removed from the
  // workspace globs (gone from `manifest.packages` but still recorded in the
  // prior per-adapter path list). Every candidate is re-validated against the
  // repo root in `isPathInKnownAdapterRoot` below, so widening the prefix set
  // never bypasses the path-traversal defense.
  const allPackageRoots =
    packageRoots === undefined
      ? undefined
      : [...packageRoots, ...derivePackageRootsFromCandidates(candidates)];
  const acceptedPrefixes = buildAcceptedPrefixes(allPackageRoots);
  const results: OrphanCleanupEntry[] = [];
  for (const relPath of candidates) {
    // Filter 1 (security-critical): path must lie inside a known adapter
    // output root. This is the path-traversal defense — a manifest
    // tampered to point at `/etc/hosts` or `../../../secret` is rejected
    // before we touch disk, regardless of basename. Root check runs BEFORE
    // the basename check so a tampered entry with a benign-looking name
    // (e.g. `../hatch3r-evil.mdc`) cannot bypass containment.
    if (!isPathInKnownAdapterRoot(relPath, rootDir, acceptedPrefixes)) {
      results.push({ adapter, path: relPath, removed: false, reason: "outside-adapter-root" });
      continue;
    }
    // Filter 2: basename must be hatch3r-* or NN-hatch3r-*. A path inside
    // an adapter root but with a non-hatch3r basename is one we never
    // emitted; refuse the unlink. release/2.8.5: a caller-supplied
    // `trustedExactPaths` entry (manifest-recorded output of a deselected
    // adapter, swept under explicit consent) bypasses ONLY this filter —
    // containment already passed above and the user-wrapped veto below still
    // protects files carrying user content outside the managed markers.
    const name = basename(relPath);
    const trusted = options?.trustedExactPaths?.has(relPath.replace(/\\/g, "/")) === true;
    if (!isManagedOutputBasename(name) && !trusted) {
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
