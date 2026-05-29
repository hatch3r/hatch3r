import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../cli/shared/paths.js";
import { HatchError } from "../types.js";

let cached: string | null = null;

/**
 * Resolve the root directory that contains the bundled canonical content
 * (agents/, skills/, rules/, commands/, hooks/, prompts/, github-agents/,
 * mcp/, checks/, policy/).
 *
 * Resolution order:
 *   1. Production layout: `<pkgRoot>/dist/content/agents` exists → return
 *      `<pkgRoot>/dist/content`. This is what `npm run build` (postbuild)
 *      stages and what ships in the published npm tarball.
 *   2. Dev layout: `<pkgRoot>/agents` AND `<pkgRoot>/skills` both exist →
 *      return `<pkgRoot>`. This supports running the CLI directly from a
 *      source checkout without a build step.
 *   3. Throw with an actionable error pointing at both candidates.
 *
 * The result is cached for the lifetime of the process.
 */
export function resolveBundledContentRoot(): string {
  if (cached !== null) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = findPackageRoot(here);

  const distContent = join(pkgRoot, "dist", "content");
  if (existsSync(join(distContent, "agents"))) {
    cached = distContent;
    return cached;
  }

  if (
    existsSync(join(pkgRoot, "agents")) &&
    existsSync(join(pkgRoot, "skills"))
  ) {
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
