import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../cli/shared/paths.js";
import { HatchError } from "../types.js";

let cached: string | null = null;

/**
 * Published content classes that MUST be present under any resolved bundled
 * content root. Mirrors the `requiredDirs` floor that
 * `src/cli/commands/validate.ts::validateDirectories` enforces — agents/,
 * skills/, and rules/ are the three classes every adapter depends on, so a
 * root that carries some but not all of them is a partial or corrupted install
 * that would otherwise emit a silently degraded setup (D2-SA2.2-10). The
 * remaining published classes (commands/, hooks/, checks/, prompts/, mcp/,
 * policy/, github-agents/) are optional: their directory-level absence is
 * benign per the readGlobMd ENOENT contract in `src/adapters/canonical.ts`, so
 * they are intentionally excluded from this floor.
 */
const REQUIRED_CONTENT_DIRS = ["agents", "skills", "rules"] as const;

/**
 * Return the {@link REQUIRED_CONTENT_DIRS} that are absent under `root`, in
 * declaration order. An empty result means the required floor holds.
 */
function missingRequiredDirs(root: string): string[] {
  return REQUIRED_CONTENT_DIRS.filter((dir) => !existsSync(join(root, dir)));
}

/**
 * Fail loud when a resolved content root is missing any required published
 * directory. Closes the runtime half of the D11-11 failure mode: the sentinel
 * in {@link resolveBundledContentRoot} identifies a root by a single probe dir
 * (agents/), so a partially-extracted or tampered install missing e.g. rules/
 * used to resolve successfully and then generate adapter output with zero rules
 * and zero warnings. Throwing here — the single chokepoint every adapter read
 * flows through — turns that silent degradation into an actionable error before
 * any setup is written (D2-SA2.2-10). The throw is not cached, so a retry after
 * reinstalling re-runs resolution.
 */
function assertContentFloor(root: string): void {
  const missing = missingRequiredDirs(root);
  if (missing.length === 0) return;
  const noun = missing.length === 1 ? "directory" : "directories";
  throw new HatchError(
    `Bundled content at ${root} is incomplete: missing required published ${noun} ${missing.join(", ")}. ` +
      `This indicates a partial or corrupted hatch3r install — continuing would omit these content classes from the generated setup.`,
    1,
    "FS_ERROR",
    "Reinstall hatch3r (`npm i -g hatch3r`) to restore the full bundled content, or run `npm run build` in the source checkout to re-stage `dist/content/`.",
  );
}

/**
 * Resolve the root directory that contains the bundled canonical content
 * (agents/, skills/, rules/, commands/, hooks/, prompts/, github-agents/,
 * mcp/, checks/, policy/).
 *
 * Resolution order:
 *   1. Production layout: `<pkgRoot>/dist/content/agents` exists → the root is
 *      `<pkgRoot>/dist/content`. This is what `npm run build` (postbuild)
 *      stages and what ships in the published npm tarball.
 *   2. Dev layout: `<pkgRoot>/agents` AND `<pkgRoot>/skills` both exist → the
 *      root is `<pkgRoot>`. This supports running the CLI directly from a
 *      source checkout without a build step.
 *   3. Throw with an actionable error pointing at both candidates.
 *
 * A root identified by step 1 or 2 must additionally carry the full required
 * floor (agents/, skills/, rules/): {@link assertContentFloor} throws a
 * distinct actionable error when it does not, so a partial or corrupted install
 * fails loud instead of generating a silently degraded setup (D2-SA2.2-10).
 * Neither the not-found throw nor the floor throw is cached, so a retry after
 * reinstalling re-runs resolution.
 *
 * The successfully resolved root is cached for the lifetime of the process.
 */
export function resolveBundledContentRoot(): string {
  if (cached !== null) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = findPackageRoot(here);

  const distContent = join(pkgRoot, "dist", "content");
  if (existsSync(join(distContent, "agents"))) {
    assertContentFloor(distContent);
    cached = distContent;
    return cached;
  }

  if (
    existsSync(join(pkgRoot, "agents")) &&
    existsSync(join(pkgRoot, "skills"))
  ) {
    assertContentFloor(pkgRoot);
    cached = pkgRoot;
    return cached;
  }

  throw new HatchError(
    `Bundled content not found. Looked in ${distContent} and ${pkgRoot}. ` +
      `Reinstall hatch3r (npm i -g hatch3r) or run 'npm run build' in development.`,
    1,
    "FS_ERROR",
    "Reinstall hatch3r (`npm i -g hatch3r`) or run `npm run build` in the source checkout to stage the bundled content under `dist/content/`.",
  );
}

/**
 * Reset the module-level resolution cache. Test-only (Node `__`-prefix
 * convention marks a non-production export).
 *
 * 2.2-F8 (Cycle 10 Wave 4, D2, P2): {@link resolveBundledContentRoot} caches
 * the first successful resolution for the process lifetime. A test that mocks
 * `existsSync` or changes the layout AFTER the first resolution would
 * otherwise observe the stale cached value (the resolver short-circuits at
 * `if (cached !== null) return cached`). Call this in a `beforeEach` hook so
 * each resolution-branch test starts from a clean cache, decoupling test
 * correctness from vitest's `isolate` default.
 */
export function __resetCacheForTests(): void {
  cached = null;
}
