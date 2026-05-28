/**
 * F14.2-H1 (D14): Monorepo per-package adapter-output emission helper.
 *
 * `analyzeRepo` already detects workspace globs and enumerates package
 * directories via `detectMonorepoPackages`. `createManifest` persists the
 * result on `manifest.packages`. This module closes the third leg of the
 * feature — it takes the canonical (root-emitted) `AdapterOutput[]` list and
 * computes a per-package re-target so each `<package>/.hatch3r/<rel>` ends up
 * with its own copy of the same tool context. Init and sync call this once
 * per adapter after the root-pass `safeWriteFile` loop completes.
 *
 * The function is deliberately read-only: it returns a `PerPackageOutput[]`
 * (a tuple of package + AdapterOutput) but does NOT issue writes. The caller
 * decides whether to apply `safeWriteFile`, dry-run, or diff. This keeps the
 * snapshot, managed-block, and orphan-cleanup contracts in the caller's hands.
 *
 * Pillars: CQ3 (Reliability — deterministic re-target), CQ8
 * (Maintainability — single helper for both init and sync), P6 (Security &
 * Trust — re-uses `assertSafePath` semantics for the per-package re-targets,
 * never escapes the root).
 *
 * Decision (Cycle 10 Phase B Wave 1B): in addition (not replacement). The
 * root `<rootDir>/.hatch3r/` continues to receive the primary tool context;
 * each `<package>/.hatch3r/` receives a parallel copy so a developer working
 * inside a package sub-directory still gets adapter output materialised
 * adjacent to the package they are editing.
 */

import type { AdapterOutput, PackageEntry } from "../types.js";

/**
 * Per-package re-target of a single adapter output. `path` is the
 * `<package>/<originalPath>` posix-style relative path; `originalPath` is the
 * un-prefixed canonical path. `packageName` and `packagePath` mirror the
 * `PackageEntry` for downstream logging.
 */
export interface PerPackageOutput {
  packageName: string;
  packagePath: string;
  originalPath: string;
  output: AdapterOutput;
}

/**
 * Resolve `manifest.packages` to a deterministic emission target set. Returns
 * an empty array for non-monorepo repos (zero packages) — callers can treat
 * the result as a strict superset of the root emission.
 *
 * Stable sort by `path` matches the order produced by
 * `detectMonorepoPackages` so logs and test fixtures are stable across runs.
 */
export function planPerPackageOutputs(
  packages: PackageEntry[] | undefined,
  rootOutputs: readonly AdapterOutput[],
): PerPackageOutput[] {
  if (!packages || packages.length === 0) return [];
  if (rootOutputs.length === 0) return [];

  const sorted = [...packages].sort((a, b) => a.path.localeCompare(b.path));
  const planned: PerPackageOutput[] = [];

  for (const pkg of sorted) {
    const prefix = normalizePackagePath(pkg.path);
    if (prefix === null) continue; // unsafe path — skip silently per CQ3
    for (const out of rootOutputs) {
      // Reject any output whose path is already absolute or escapes the
      // package root via `..`. `assertSafePath` semantics are duplicated here
      // because the helper is sync — calling the async fs guard would force
      // the entire emission pipeline async without payoff.
      if (out.path.startsWith("/") || out.path.includes("..")) continue;
      // F14.2-H1: skip the manifest write — the canonical `.hatch3r/hatch.json`
      // lives at the root and per-package copies would diverge on the next
      // sync. Adapter outputs never include the manifest path today, but the
      // explicit guard documents the intent.
      if (out.path === ".hatch3r/hatch.json") continue;
      planned.push({
        packageName: pkg.name,
        packagePath: pkg.path,
        originalPath: out.path,
        output: {
          ...out,
          path: `${prefix}/${out.path}`,
        },
      });
    }
  }

  return planned;
}

/**
 * Validate that a workspace-derived package path is safe to use as an output
 * prefix. Rejects absolute paths, `..` traversal, and empty strings. Returns
 * the posix-normalised path or `null` when unsafe.
 */
function normalizePackagePath(path: string): string | null {
  if (!path || typeof path !== "string") return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) return null;
  if (normalized.startsWith("/")) return null;
  if (normalized.startsWith("..") || normalized.includes("/..")) return null;
  return normalized;
}
