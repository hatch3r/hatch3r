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
