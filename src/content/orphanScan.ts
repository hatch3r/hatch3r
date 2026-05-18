/**
 * C9-M26 (D11-SA11.4-01): Orphan-file scan for the `.agents/` canonical
 * subtree.
 *
 * Detects files that landed in `.agents/{agents,commands,rules,skills,hooks,
 * prompts,github-agents,mcp,checks}/` but are NOT part of the canonical
 * inventory (i.e. do NOT start with the `hatch3r-` prefix, do NOT live under
 * a `hatch3r-*` parent directory, and do NOT match `ALWAYS_COPY_FILES` like
 * `mcp.json`). These leftovers typically come from:
 *
 *   1. A canonical artifact rename or removal where the previous on-disk
 *      file lingered (e.g. `hatch3r-old-name.md` after the artifact was
 *      renamed to `hatch3r-new-name.md`).
 *   2. A hand-authored file dropped into a canonical-content subtree by
 *      mistake (e.g. `notes.md` in `.agents/agents/`).
 *   3. Stale per-rule `.mdc` companions left behind by a pre-B3 sync.
 *
 * Reports orphans via `info()` (informational, not error). When the caller
 * passes `cleanOrphans: true`, the scan unlinks them after a safety check
 * (file must still live under `agentsDir`, must be a regular file).
 *
 * Excluded paths (never flagged as orphan):
 *
 *   - `.agents/user/...`        — D20 user-authored content
 *   - `.agents/policy/...`      — project policy overrides
 *   - `.agents/learnings/...`   — generated learnings cache
 *   - `.agents/hatch.json`      — manifest
 *   - `.agents/.integrity.json` — integrity seal
 *   - `.agents/.provenance.json`— per-output provenance
 *   - `.agents/.failure-log.jsonl` — operational failure log
 *   - `.agents/AGENTS.md`       — generated canonical AGENTS.md
 *
 * Pillars: P1 (CLI UX — informational diagnostic with actionable cleanup
 * suggestion), P2 (Scientific Quality — measurable detection criterion,
 * no false positives on user content).
 */

import { readdir, stat, unlink } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { HATCH3R_PREFIX } from "../types.js";

/**
 * Subdirectories under `.agents/` that hatch3r ships canonical content into.
 * Mirrors `CONTENT_DIRS` in `src/cli/commands/update.ts` — kept in sync via
 * the explicit list here rather than imported so the orphan-scan module
 * stays decoupled from the CLI command layer.
 */
const CANONICAL_SUBDIRS = [
  "agents",
  "commands",
  "rules",
  "skills",
  "hooks",
  "prompts",
  "github-agents",
  "mcp",
  "checks",
] as const;

/**
 * Filenames under `.agents/<canonical-subdir>/` whose canonical-file
 * convention exemption is part of the canonical inventory (i.e. they ship
 * from the package without the `hatch3r-` prefix). Mirrors
 * `ALWAYS_COPY_FILES` in `src/cli/commands/update.ts`.
 */
const ALWAYS_CANONICAL_BASENAMES = new Set<string>(["mcp.json"]);

/**
 * Top-level `.agents/` files that are framework-emitted metadata, not
 * canonical inventory items. Never flagged as orphans.
 */
const RESERVED_TOP_LEVEL_FILES = new Set<string>([
  "hatch.json",
  ".integrity.json",
  ".provenance.json",
  ".failure-log.jsonl",
  "AGENTS.md",
]);

/**
 * Per-orphan disposition. Returned to callers so the CLI can both surface
 * a one-line summary and emit the action taken on each file when the
 * `cleanOrphans` flag is set.
 */
export interface OrphanFileEntry {
  /** Project-relative POSIX path of the orphan file (e.g. `.agents/agents/notes.md`). */
  relativePath: string;
  /** Which canonical-content subdir the file was found in. */
  subdir: (typeof CANONICAL_SUBDIRS)[number];
  /** Whether the scan removed the file (true only when `cleanOrphans` was set). */
  removed: boolean;
  /** Populated when an unlink attempt failed. */
  error?: string;
}

/**
 * Result of the orphan scan. `entries` carries every orphan detected
 * (including those left in place when `cleanOrphans=false`). `errors`
 * captures structural failures that prevented a complete scan (e.g.
 * permission denied on `.agents/agents`).
 */
export interface OrphanScanResult {
  entries: OrphanFileEntry[];
  errors: string[];
}

/**
 * Walk `.agents/<canonical-subdir>/` recursively and flag every file that
 * does NOT fit the canonical-inventory naming convention.
 *
 * Canonical-inventory naming convention:
 *
 *   - File basename starts with `hatch3r-`, OR
 *   - File's parent directory chain (relative to the canonical subdir)
 *     contains a `hatch3r-*` segment (i.e. inside a `hatch3r-foo/` skill
 *     directory we accept any inner filename — the skill itself is the
 *     canonical unit), OR
 *   - File basename is in `ALWAYS_CANONICAL_BASENAMES` (`mcp.json`).
 *
 * Files outside the canonical subdirs (e.g. `.agents/user/...`,
 * `.agents/policy/...`, `.agents/learnings/...`, top-level
 * `hatch.json`/`.integrity.json`/etc.) are never visited and therefore
 * never flagged.
 *
 * When `cleanOrphans=true`, each detected orphan is `unlink()`-ed
 * immediately after detection. The unlink target is resolved against the
 * scanned subdir root (not a caller-supplied path) so a symlink trick
 * cannot redirect the unlink elsewhere.
 *
 * Returns the full list of orphans even when `cleanOrphans=true` so the
 * caller can render one summary line per removed file.
 */
export async function scanOrphanFiles(
  agentsDir: string,
  options: { cleanOrphans?: boolean } = {},
): Promise<OrphanScanResult> {
  const cleanOrphans = !!options.cleanOrphans;
  const entries: OrphanFileEntry[] = [];
  const errors: string[] = [];
  const agentsDirResolved = resolve(agentsDir);

  for (const subdir of CANONICAL_SUBDIRS) {
    const subdirAbs = join(agentsDirResolved, subdir);
    let exists = true;
    try {
      await stat(subdirAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        exists = false;
      } else {
        errors.push(
          `orphan-scan: cannot stat ${subdir}/: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }
    if (!exists) continue;

    await walkSubdir(agentsDirResolved, subdirAbs, subdir, entries, errors, cleanOrphans);
  }

  return { entries, errors };
}

async function walkSubdir(
  agentsDirResolved: string,
  currentDir: string,
  subdir: (typeof CANONICAL_SUBDIRS)[number],
  entries: OrphanFileEntry[],
  errors: string[],
  cleanOrphans: boolean,
  insideHatch3rDir = false,
): Promise<void> {
  let dirents: { name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }[];
  try {
    dirents = await readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    errors.push(
      `orphan-scan: readdir(${relPosix(agentsDirResolved, currentDir)}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  for (const d of dirents) {
    // Skip symlinks — path-traversal defense matches integrity scan.
    if (d.isSymbolicLink()) continue;
    const fullPath = join(currentDir, d.name);
    if (d.isDirectory()) {
      // A `hatch3r-*` subdirectory marks a canonical unit (e.g. a skill
      // directory). Every file beneath it is canonical-by-association.
      const nestedInHatch3r = insideHatch3rDir || d.name.startsWith(HATCH3R_PREFIX);
      await walkSubdir(agentsDirResolved, fullPath, subdir, entries, errors, cleanOrphans, nestedInHatch3r);
      continue;
    }
    if (!d.isFile()) continue;

    // Decide whether the file qualifies as canonical inventory.
    if (insideHatch3rDir) continue;
    if (d.name.startsWith(HATCH3R_PREFIX)) continue;
    if (ALWAYS_CANONICAL_BASENAMES.has(d.name)) continue;

    // The file is an orphan. Surface it (and optionally unlink it).
    const entry: OrphanFileEntry = {
      relativePath: relPosix(agentsDirResolved, fullPath),
      subdir,
      removed: false,
    };

    if (cleanOrphans) {
      // Containment check: re-resolve and verify the target remains under
      // agentsDirResolved before unlinking. Defends against any race that
      // would let a symlink dangle into a wider directory.
      const fullResolved = resolve(fullPath);
      const relCheck = relative(agentsDirResolved, fullResolved);
      const escapes = !relCheck || relCheck.startsWith("..") || (sep !== "/" && relCheck.split(sep).some((s) => s === ".."));
      if (escapes) {
        entry.error = `refusing to unlink path outside agents dir: ${entry.relativePath}`;
      } else {
        try {
          await unlink(fullResolved);
          entry.removed = true;
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
        }
      }
    }

    entries.push(entry);
  }
}

/** Project-relative POSIX-normalized path under `agentsDirResolved`. */
function relPosix(agentsDirResolved: string, abs: string): string {
  const rel = relative(resolve(agentsDirResolved, ".."), abs);
  return rel.split(sep).join(posix.sep);
}

/**
 * Build a human-readable summary of an orphan scan suitable for `info()`.
 * Returns `null` when the scan found zero orphans (caller skips emission).
 *
 * Format:
 *
 *   Detected N orphan file(s) in .agents/ (not part of canonical inventory):
 *     .agents/agents/notes.md
 *     .agents/commands/scratch.md
 *   Run with --clean-orphans to remove them.
 *
 * When `cleanOrphans=true` the trailing hint switches to a removed-count
 * summary so the caller communicates the action taken.
 */
export function formatOrphanScanDiagnostic(
  result: OrphanScanResult,
  options: { cleanOrphans?: boolean } = {},
): string | null {
  if (result.entries.length === 0 && result.errors.length === 0) return null;

  const lines: string[] = [];
  const cleanOrphans = !!options.cleanOrphans;

  if (result.entries.length > 0) {
    const noun = result.entries.length === 1 ? "orphan file" : "orphan files";
    if (cleanOrphans) {
      const removed = result.entries.filter((e) => e.removed).length;
      const kept = result.entries.length - removed;
      lines.push(`Cleaned ${removed} of ${result.entries.length} ${noun} in .agents/:`);
    } else {
      lines.push(`Detected ${result.entries.length} ${noun} in .agents/ (not part of canonical inventory):`);
    }
    for (const e of result.entries) {
      const tag = cleanOrphans
        ? e.removed
          ? "removed"
          : e.error
            ? `kept (unlink failed: ${e.error})`
            : "kept"
        : "orphan";
      lines.push(`  ${tag}: ${e.relativePath}`);
    }
    if (!cleanOrphans) {
      lines.push("Run with --clean-orphans to remove them, or rename them under `hatch3r-*` if intentional.");
    }
  }

  for (const err of result.errors) {
    lines.push(`  ${err}`);
  }

  return lines.join("\n");
}
