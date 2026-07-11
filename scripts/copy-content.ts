#!/usr/bin/env tsx
/**
 * postbuild: copy canonical content directories into `dist/content/` so the
 * published npm tarball can ship a single `dist/` tree containing both the
 * compiled CLI (`dist/cli/`) and the canonical content (`dist/content/`).
 *
 * Runs after `tsup` via the `postbuild` npm script. Resolved at runtime by
 * `src/content/contentRoot.ts::resolveBundledContentRoot`.
 *
 * Pure stdlib (Node 22+): `node:fs/promises`, `node:path`, `node:url`.
 */
import { cp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { READER_CONFIG_DIRS } from "../src/adapters/canonical.js";

// D9-SA9.4-01 (Cycle 12): `prompts` and `policy` are RESERVED source dirs — no
// such directory exists at the repo root today, so `main()`'s `exists(src)` guard
// skips them and nothing ships in `dist/content/` for either (verified: the
// published bundle carries agents/checks/commands/github-agents/hooks/mcp/rules/
// skills only). They stay listed so a future `prompts/` or `policy/` dir ships
// automatically once populated. `docs/adapter-capability-matrix.md` documents
// both as reserved-not-shipped; keep that doc and this list in agreement.
const SOURCE_DIRS = [
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "prompts",
  "github-agents",
  "mcp",
  "checks",
  "policy",
] as const;

/**
 * D11-11 (Cycle 11 Wave 3): canonical-reader directories that the published
 * tarball intentionally does NOT ship. Every {@link READER_CONFIG_DIRS} entry
 * must appear in {@link SOURCE_DIRS} OR here, or the build fails (see
 * {@link assertSourceDirsCoverReaders}). Each exclusion needs a reason so the
 * allowlist cannot quietly grow to hide a real packaging gap:
 *
 *   - `learnings`: project-specific entries seeded by `hatch3r init` into the
 *     user's repo (`.hatch3r/learnings/`, see `src/cli/commands/init.ts`). The
 *     npm package ships none; the reader enumerates the per-project directory
 *     at runtime, not bundled content. Shipping a `learnings/` dir here would
 *     be wrong, so it is excluded by design rather than missing by accident.
 */
const PACKAGING_EXCLUDED_READER_DIRS: ReadonlySet<string> = new Set(["learnings"]);

/**
 * D11-11: fail the build (exit 1) when a canonical-reader directory
 * ({@link READER_CONFIG_DIRS}, the single source of truth in
 * `src/adapters/canonical.ts`) is neither copied into the tarball
 * ({@link SOURCE_DIRS}) nor explicitly excluded
 * ({@link PACKAGING_EXCLUDED_READER_DIRS}).
 *
 * Without this gate, adding a new `READER_CONFIGS` entry (a new content type)
 * without also adding it to `SOURCE_DIRS` shipped nothing for that type; the
 * runtime reader then hit ENOENT on the bundled root and returned an empty list
 * with no warning, silently publishing an empty content type. The assertion
 * runs before any copy so the packaging mismatch surfaces at build time.
 */
function assertSourceDirsCoverReaders(): void {
  const shipped = new Set<string>(SOURCE_DIRS);
  const missing = READER_CONFIG_DIRS.filter(
    (dir) => !shipped.has(dir) && !PACKAGING_EXCLUDED_READER_DIRS.has(dir),
  );
  if (missing.length > 0) {
    console.error(
      `[copy-content] packaging drift: canonical reader dir(s) ${missing
        .map((d) => `"${d}"`)
        .join(", ")} are not in SOURCE_DIRS and not on the ` +
        `PACKAGING_EXCLUDED_READER_DIRS allowlist. Add them to SOURCE_DIRS in ` +
        `scripts/copy-content.ts (so the published tarball ships them) or, if a ` +
        `dir is intentionally not shipped, add it to the allowlist with a reason. ` +
        `Source of truth: READER_CONFIG_DIRS in src/adapters/canonical.ts.`,
    );
    process.exit(1);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(full);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

async function main(): Promise<void> {
  // D11-11: surface packaging↔reader drift before doing any work, so a missing
  // SOURCE_DIRS entry breaks the build loudly instead of shipping an empty type.
  assertSourceDirsCoverReaders();

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const destRoot = join(repoRoot, "dist", "content");

  if (await exists(destRoot)) {
    await rm(destRoot, { recursive: true, force: true });
  }

  const copied: string[] = [];
  let totalFiles = 0;

  for (const name of SOURCE_DIRS) {
    const src = join(repoRoot, name);
    if (!(await exists(src))) {
      continue;
    }
    const dest = join(destRoot, name);
    await cp(src, dest, { recursive: true });
    const fileCount = await countFiles(dest);
    copied.push(`${name} (${fileCount})`);
    totalFiles += fileCount;
  }

  console.log(
    `[copy-content] copied ${copied.length} dirs (${totalFiles} files) -> dist/content/`,
  );
  for (const entry of copied) {
    console.log(`  - ${entry}`);
  }
}

main().catch((err: unknown) => {
  console.error("[copy-content] failed:", err);
  process.exit(1);
});
