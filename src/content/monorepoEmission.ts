/**
 * F14.2-H1 (D14): Monorepo per-package adapter-output emission helper.
 *
 * `analyzeRepo` already detects workspace globs and enumerates package
 * directories via `detectMonorepoPackages`. `createManifest` persists the
 * result on `manifest.packages`. This module closes the third leg of the
 * feature — it takes the canonical (root-emitted) `AdapterOutput[]` list and
 * computes a per-package re-target so each `<package>/<rel>` ends up with its
 * own copy of the tool context. Init and sync call this once per adapter after
 * the root-pass `safeWriteFile` loop completes.
 *
 * The function is deliberately read-only: it returns a `PerPackageOutput[]`
 * (a tuple of package + AdapterOutput) but does NOT issue writes. The caller
 * decides whether to apply `safeWriteFile`, dry-run, or diff. This keeps the
 * snapshot, managed-block, and orphan-cleanup contracts in the caller's hands.
 *
 * Pillars: CQ3 (Reliability — deterministic re-target), CQ8
 * (Maintainability — single helper for both init and sync), P6 (Security &
 * Trust — re-uses `assertSafePath` semantics for the per-package re-targets,
 * never escapes the root), P4 (Lean Coverage — D14-6: per-package emission is
 * scoped to the one tool whose load model reads per-directory files; the other
 * two adapters get nothing per-package because copies would be dead weight or
 * double-loads, not capability).
 *
 * ## Tool-scoped emission (D14-6, Cycle 11 Wave 2)
 *
 * Per-package re-targeting is NOT applied uniformly across adapters — each
 * tool's documented load model decides whether a per-package copy adds value:
 *
 * - **cursor** — reads `.cursor/rules/*.mdc` from the nearest ancestor
 *   directory of the edited file, so a `<package>/.cursor/rules/` copy gives a
 *   developer working inside that package its own rule scope. Per-package
 *   emission is ON for cursor.
 * - **claude** — ancestor-loads the nearest `CLAUDE.md` AND every CLAUDE.md up
 *   the directory tree, so a `<package>/CLAUDE.md` copy of the root content
 *   double-loads the same guidance (root + package) for any file under the
 *   package. Per-package emission is OFF.
 * - **copilot** — reads the repo-root `.github/copilot-instructions.md` for
 *   every request PLUS central path-scoped `.github/instructions/*.instructions.md`
 *   files whose `applyTo` glob matches the file being worked on (both surfaces
 *   emitted by `src/adapters/copilot.ts`); a directory-NESTED
 *   `<package>/.github/...` copy is still never read, so per-package emission
 *   is OFF. Central `applyTo: "<pkg>/**"` package targeting is a separate,
 *   unbuilt capability — evaluated 2026-07-12 and HELD (D14-SA14.2-04 CL-2:
 *   a verbatim package-glob duplicate of root content adds no load-model
 *   value, and differentiated content needs the per-package config layer
 *   whose re-entry is CL-1-gated).
 *
 * Emitting verbatim copies for claude/copilot manufactures exactly the
 * duplicate/stale-guidance harm `src/merge/orphanCleanup.ts` exists to clean
 * up (D14-6 / SA14.2-F4), so the helper drops them at the source. All callers
 * (init, sync, status drift parity) inherit the scoping because they pass the
 * producing `tool` and read back only what the helper returns.
 *
 * ## Documented limitation: re-target is a copy, not per-package config (D14-19)
 *
 * For a per-package tool the emission is a VERBATIM re-target: every package
 * receives byte-identical content — the root `AdapterOutput.content` is reused
 * unchanged, only `path` is rewritten to `<package>/<rel>`. hatch3r does NOT
 * differentiate per-package or per-team configuration: it does not run
 * `analyzeRepo` per package, does not compute a per-package content delta, and
 * reads no `.hatch3r/packages/<name>.customize.yaml` layer. A monorepo whose
 * packages use different stacks (e.g. a Python `apps/api` beside a React
 * `packages/web`) gets the same rule corpus in every package's
 * `.cursor/rules/`. This answers D14 §14.2 "can hatch3r manage per-package
 * agent configs?" and "Multi-team configuration" with: no — emission is a
 * mirror of the root context, scoped to the tools that read per-directory
 * files. Per-package customization is a deliberate non-goal here (SA14.2-F6):
 * the D14-6 decision (Cycle 11 Wave 2) found per-package copies are dead weight
 * for two of three adapters, so manufacturing a per-package config layer for
 * the remaining one would add precedence-stack surface for a single tool. If a
 * future cycle decides to make emission config-bearing, the single edit point
 * is here plus a per-package layer in `src/adapters/customization.ts`; this
 * note records that the gap is intentional, not an oversight.
 */

import type { AdapterOutput, PackageEntry, Tool } from "../types.js";

/**
 * D14-6: tools whose load model reads per-directory context files, so a
 * `<package>/<rel>` copy is a capability rather than dead weight. Only `cursor`
 * qualifies today (`.cursor/rules/*.mdc` resolves from the nearest ancestor of
 * the edited file). `claude` (root + ancestor CLAUDE.md load → double-load) and
 * `copilot` (directory-nested copies unread; its path scoping is central
 * `applyTo` globs, not nesting) are intentionally absent — see the module
 * header. Adding a tool here is the single edit needed
 * to opt it into per-package emission across init, sync, and status.
 */
const PER_PACKAGE_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["cursor"]);

/**
 * D14-6: whether per-package emission applies to a given adapter. Exposed so
 * callers can short-circuit the snapshot-path collection and the write batch
 * for tools that emit nothing per-package, instead of calling
 * {@link planPerPackageOutputs} only to get an empty array back.
 */
export function emitsPerPackage(tool: Tool): boolean {
  return PER_PACKAGE_TOOLS.has(tool);
}

/**
 * Per-package re-target of a single adapter output. `output` is a verbatim
 * copy of the root output with only `path` rewritten — content is NOT
 * specialised per package (D14-19; see the "Documented limitation" section in
 * the module header). `path` is the `<package>/<originalPath>` posix-style
 * relative path; `originalPath` is the un-prefixed canonical path.
 * `packageName` and `packagePath` mirror the `PackageEntry` for downstream
 * logging.
 */
export interface PerPackageOutput {
  packageName: string;
  packagePath: string;
  originalPath: string;
  output: AdapterOutput;
}

/**
 * Resolve `manifest.packages` to a deterministic emission target set for one
 * adapter. Returns an empty array for non-monorepo repos (zero packages), for
 * empty output lists, and — D14-6 — for any `tool` whose load model does not
 * read per-directory context files (see {@link PER_PACKAGE_TOOLS}). For a
 * per-package tool the result is a strict superset-by-path of the root
 * emission.
 *
 * Stable sort by `path` matches the order produced by
 * `detectMonorepoPackages` so logs and test fixtures are stable across runs.
 *
 * @param tool   The adapter producing `rootOutputs`. Non-per-package tools
 *               (claude, copilot) yield `[]` so init/sync/status never write or
 *               account for copies that the tool would not read (D14-6).
 */
export function planPerPackageOutputs(
  tool: Tool,
  packages: PackageEntry[] | undefined,
  rootOutputs: readonly AdapterOutput[],
): PerPackageOutput[] {
  // D14-6: skip tools whose load model makes per-package copies dead weight
  // (copilot — nested copies unread; path scoping is central applyTo globs)
  // or double-loads (claude, ancestor-loads root). Only per-directory tools
  // (cursor) re-target.
  if (!emitsPerPackage(tool)) return [];
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
        // D14-19: verbatim copy — spread reuses `content`/`managedContent`/
        // `action` unchanged and rewrites only `path`. No per-package content
        // delta is computed (documented non-goal; see module header).
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
