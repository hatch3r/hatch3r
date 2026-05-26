import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackageRoot } from "../cli/shared/paths.js";

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

  throw new Error(
    `Bundled content not found. Looked in ${distContent} and ${pkgRoot}. ` +
      `Reinstall hatch3r (npm i -g hatch3r) or run 'npm run build' in development.`,
  );
}
