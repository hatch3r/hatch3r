import { readFile, mkdir, copyFile, symlink, lstat, unlink, readdir, rmdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import {
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
  WORKTREE_INCLUDE_FILE,
  HATCH3R_DIR,
  MANIFEST_FILE,
  HatchError,
  type HatchManifest,
} from "../types.js";
// D1-12 (Cycle 11 Wave 2): the per-worktree copy overrides reference these two
// state-file names so the `.worktreeinclude` entries stay in lock-step with the
// constants the writers use, rather than hard-coding the literals here.
import { PROVENANCE_FILE } from "../manifest/provenance.js";
import { BREAKER_STATE_FILE } from "../pipeline/circuitBreaker.js";
import { atomicWriteFile } from "../merge/safeWrite.js";
import type {
  WorktreeAddMode,
  WorktreeBranchPlan,
  WorktreeEntry,
  WorktreeSetupResult,
  WorktreeSkipReason,
} from "./types.js";
import { resolvePatterns, findMainWorktree, listWorktrees } from "./resolve.js";
import { verbose } from "../cli/shared/ui.js";

/**
 * Record a worktree-probe failure: emit a verbose() line to stderr (visible
 * only with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract — probes
 * for "does X exist?" or "is X a symlink?" cannot push to caller warnings
 * channels (none are wired through worktree cleanup), so verbose() is the
 * minimum-viable diagnostic surface.
 */
function recordWorktreeProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`worktree: ${operation} — ${message}`);
}

// Gitignore-syntax managed-block markers for .git/info/exclude. Distinct from
// MANAGED_BLOCK_{START,END} (which are HTML-comment-style and would parse as
// literal ignore patterns here).
const EXCLUDE_BLOCK_START = "# HATCH3R:BEGIN — managed by `hatch3r worktree-setup`";
const EXCLUDE_BLOCK_END = "# HATCH3R:END";

/** Subdirectory of the main repo where hatch3r-managed worktrees live. */
export const WORKTREES_DIR = ".worktrees";

/**
 * Detects whether a `.worktreeinclude` pattern uses gitignore-style glob
 * syntax (`*`, `?`, `[...]`). Per git-scm.com/docs/gitignore (accessed
 * 2026-05-27) the include-file format honours these wildcards, but
 * `setupWorktree`'s strategy lookup only supports literal-prefix matching.
 * A glob entry tagged `# hatch3r:symlink` therefore falls through silently
 * to the default `copy` strategy (F1.10-H2, D1, audit cycle 10 wave 2).
 *
 * Backslash-escaped wildcards (per gitignore syntax) are treated as literals.
 */
function hasGlobChars(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1; // skip escaped literal
      continue;
    }
    if (ch === "*" || ch === "?" || ch === "[") return true;
  }
  return false;
}

// ─── Adapter worktree patterns ───────────────────────────────────────────────

/**
 * Per-tool adapter output patterns that should be present in worktrees.
 * All use "copy" strategy so worktrees can run `hatch3r sync` independently
 * without cross-worktree contamination via symlinks.
 *
 * Including patterns for files that are tracked by git is harmless —
 * `resolvePatterns` uses `git ls-files --others --ignored` which only matches
 * untracked+gitignored files, so tracked patterns are a no-op safety net.
 */
export const ADAPTER_WORKTREE_PATTERNS: Record<
  string,
  { pattern: string; strategy: "copy" | "symlink"; reason: string }[]
> = {
  claude: [
    { pattern: "CLAUDE.md", strategy: "copy", reason: "Claude main instructions" },
    { pattern: ".claude/", strategy: "copy", reason: "Claude adapter output (settings, rules, agents, skills, commands)" },
    { pattern: ".mcp.json", strategy: "copy", reason: "MCP server config" },
  ],
  cursor: [
    { pattern: ".cursor/", strategy: "copy", reason: "Cursor adapter output (rules, agents, skills, commands, MCP)" },
  ],
  copilot: [
    { pattern: ".github/copilot-instructions.md", strategy: "copy", reason: "Copilot instructions" },
    { pattern: ".github/instructions/", strategy: "copy", reason: "Copilot scoped instructions" },
    { pattern: ".github/agents/", strategy: "copy", reason: "Copilot agents" },
    { pattern: ".github/prompts/", strategy: "copy", reason: "Copilot prompts" },
    { pattern: ".github/skills/", strategy: "copy", reason: "Copilot skills" },
    { pattern: ".vscode/mcp.json", strategy: "copy", reason: "VS Code MCP config" },
  ],
};

// ─── Generate ────────────────────────────────────────────────────────────────

/**
 * Builds the `.worktreeinclude` file content with managed blocks.
 * Each entry is annotated with a strategy suffix (`# hatch3r:symlink` or
 * implicit copy) so that `parseWorktreeInclude` can reconstruct the plan.
 */
export async function generateWorktreeInclude(
  manifest: HatchManifest,
  _rootDir: string,
): Promise<string> {
  const lines: string[] = [];
  const entries: { pattern: string; strategy: "copy" | "symlink"; reason: string }[] = [];

  // Always include env files (copy — they contain secrets)
  entries.push({ pattern: ".env", strategy: "copy", reason: "environment variables" });
  entries.push({ pattern: ".env.*", strategy: "copy", reason: "environment variables (includes .env.mcp)" });

  // .hatch3r/ — Wave 6: state-tier footprint (overrides + mcp + per-tool managed-file index).
  entries.push({ pattern: ".hatch3r/", strategy: "symlink", reason: "shared hatch3r state (overrides, mcp)" });
  // D1-12 (Cycle 11 Wave 2, D1, P2): override the `.hatch3r/` symlink for the
  // per-worktree state files that the worktree-setup flow's own auto-sync
  // (`npx hatch3r sync` inside the new worktree) mutates. Those writes go through
  // `atomicWriteFile` (temp + rename); a rename onto a symlinked path replaces the
  // symlink with a fresh regular file (de-linking it) OR — when the symlink target
  // is followed — overwrites the MAIN repo's copy from the worktree. Either way the
  // symlinked-manifest invariant the `.hatch3r/` symlink implied is corrupted on the
  // very first post-setup sync. Declaring these three as literal `copy` entries AFTER
  // the directory symlink makes the most-specific-match resolver (`setupWorktree`)
  // give each its own regular-file copy, so the worktree's manifest/provenance/breaker
  // state evolve independently and the main repo's files are untouched. The remaining
  // `.hatch3r/` subtree (overrides, mcp) stays symlinked and genuinely shared.
  entries.push({
    pattern: `${HATCH3R_DIR}/${MANIFEST_FILE}`,
    strategy: "copy",
    reason: "per-worktree manifest (auto-sync rewrites it; symlink would de-link or clobber the main repo)",
  });
  entries.push({
    pattern: `${HATCH3R_DIR}/${PROVENANCE_FILE}`,
    strategy: "copy",
    reason: "per-worktree provenance baseline (rewritten by sync)",
  });
  entries.push({
    pattern: `${HATCH3R_DIR}/${BREAKER_STATE_FILE}`,
    strategy: "copy",
    reason: "per-worktree circuit-breaker state (rewritten by sync)",
  });
  entries.push({
    pattern: ".hatch3r/learnings/",
    strategy: "copy",
    reason: "per-worktree learnings (diverge across branches)",
  });
  entries.push({
    pattern: ".hatch3r/handoffs/",
    strategy: "copy",
    reason: "per-worktree handoffs (diverge across branches)",
  });

  // docs/specs/ — project specifications (read by agents during implementation and review)
  entries.push({ pattern: "docs/specs/", strategy: "copy", reason: "project specifications for agent context" });

  // Tool-specific adapter output patterns
  for (const tool of manifest.tools) {
    const toolPatterns = ADAPTER_WORKTREE_PATTERNS[tool];
    if (toolPatterns) {
      entries.push(...toolPatterns);
    }
  }

  // node_modules
  if (manifest.worktree?.nodeModules !== "skip") {
    entries.push({
      pattern: "node_modules/",
      strategy: "symlink",
      reason: "shared dependencies (saves disk space)",
    });
  }

  // Extra user-specified patterns
  if (manifest.worktree?.extraPatterns) {
    for (const p of manifest.worktree.extraPatterns) {
      entries.push({ pattern: p, strategy: "copy", reason: "user-specified" });
    }
  }

  // Build file content
  lines.push("# hatch3r worktree include file");
  lines.push("# Defines which gitignored files should be present in worktrees.");
  lines.push("# Lines with '# hatch3r:symlink' are symlinked; others are copied.");
  lines.push("");
  lines.push(MANAGED_BLOCK_START);

  for (const entry of entries) {
    lines.push(`# ${entry.reason}`);
    if (entry.strategy === "symlink") {
      lines.push(`${entry.pattern}  # hatch3r:symlink`);
    } else {
      lines.push(entry.pattern);
    }
  }

  lines.push(MANAGED_BLOCK_END);
  lines.push("");

  return lines.join("\n");
}

// ─── Parse ───────────────────────────────────────────────────────────────────

/**
 * Parses a `.worktreeinclude` file into structured entries.
 * - Skips blank lines and comment-only lines.
 * - Detects `# hatch3r:symlink` suffix to determine strategy.
 */
export function parseWorktreeInclude(content: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const lines = content.split("\n");

  let lastComment = "";

  for (const raw of lines) {
    const line = raw.trim();

    // Skip empty lines
    if (!line) {
      lastComment = "";
      continue;
    }

    // Track comments as potential reasons for the next entry
    if (line.startsWith("#") && !line.includes("hatch3r:")) {
      // Skip managed block markers
      if (line === MANAGED_BLOCK_START || line === MANAGED_BLOCK_END) {
        continue;
      }
      lastComment = line.slice(1).trim();
      continue;
    }

    // Also skip raw managed block markers (they don't start with #)
    if (line === MANAGED_BLOCK_START || line === MANAGED_BLOCK_END) {
      continue;
    }

    // Parse entry line
    const symlinkSuffix = "# hatch3r:symlink";
    const isSymlink = line.includes(symlinkSuffix);
    const pattern = line
      .replace(symlinkSuffix, "")
      .trim();

    if (pattern) {
      entries.push({
        pattern,
        strategy: isSymlink ? "symlink" : "copy",
        reason: lastComment || undefined,
      });
    }

    lastComment = "";
  }

  return entries;
}

// ─── Setup receipt (D1-SA1.10-02) ────────────────────────────────────────────

/**
 * D1-SA1.10-02 (D1, P6): the setup receipt — ground truth of exactly what
 * `setupWorktree` materialized, written into the worktree so `cleanupWorktree`
 * can INVERT setup precisely.
 *
 * The pre-receipt cleanup re-derived targets by `lstat`-ing each raw
 * `.worktreeinclude` pattern string. That could not invert two shapes setup
 * routinely produces: (1) a glob copy pattern (`.env.*`) lstats to ENOENT, so
 * the concrete files it copied (a plaintext `.env.mcp` secret) were unreachable
 * and survived cleanup; (2) a symlink-strategy DIRECTORY whose contents setup
 * materialized as per-file symlinks lstats to a real directory, matching none
 * of cleanup's symlink/copy-file/copy-dir branches, so the per-file symlink tree
 * survived. A receipt of concrete created paths removes both leaks (CWE-459).
 */
const WORKTREE_RECEIPT_PATH = join(HATCH3R_DIR, "worktree-receipt.json");

interface WorktreeReceiptEntry {
  /** Path relative to the worktree root. */
  relPath: string;
  /** What setup materialized (or intended) at `relPath`. */
  strategy: "copy" | "symlink";
}

interface WorktreeReceipt {
  version: 1;
  createdAt: string;
  entries: WorktreeReceiptEntry[];
}

/**
 * Persist the setup receipt inside the worktree. Non-fatal on failure: a missing
 * receipt only degrades `cleanupWorktree` to the legacy pattern-based inversion.
 */
async function writeWorktreeReceipt(
  worktreeRoot: string,
  entries: WorktreeReceiptEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const receipt: WorktreeReceipt = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  };
  const receiptPath = join(worktreeRoot, WORKTREE_RECEIPT_PATH);
  try {
    await mkdir(dirname(receiptPath), { recursive: true });
    await atomicWriteFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (err) {
    recordWorktreeProbeFailure(
      `writeWorktreeReceipt(${receiptPath}) — cleanup will fall back to pattern inversion`,
      err,
    );
  }
}

/** Read + validate the setup receipt; null when absent or malformed. */
async function readWorktreeReceipt(
  worktreeRoot: string,
): Promise<WorktreeReceipt | null> {
  const receiptPath = join(worktreeRoot, WORKTREE_RECEIPT_PATH);
  let raw: string;
  try {
    raw = await readFile(receiptPath, "utf-8");
  } catch (err) {
    recordWorktreeProbeFailure(
      `readWorktreeReceipt(${receiptPath}) — none found, using pattern fallback`,
      err,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorktreeReceipt>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return null;
    }
    const entries = parsed.entries.filter(
      (e): e is WorktreeReceiptEntry =>
        !!e &&
        typeof (e as WorktreeReceiptEntry).relPath === "string" &&
        ((e as WorktreeReceiptEntry).strategy === "copy" ||
          (e as WorktreeReceiptEntry).strategy === "symlink"),
    );
    return { version: 1, createdAt: parsed.createdAt ?? "", entries };
  } catch (err) {
    recordWorktreeProbeFailure(
      `readWorktreeReceipt(${receiptPath}) — malformed JSON, using pattern fallback`,
      err,
    );
    return null;
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

/**
 * Sets up a worktree by reading `.worktreeinclude` from the main root,
 * resolving patterns against the working tree, and copying or symlinking
 * each matched file into the worktree root.
 */
export async function setupWorktree(
  mainRoot: string,
  worktreeRoot: string,
  options: { force?: boolean } = {},
): Promise<WorktreeSetupResult> {
  const result: WorktreeSetupResult = {
    copied: [],
    symlinked: [],
    skipped: [],
    skippedDetails: [],
    errors: [],
  };

  // D1-SA1.10-02: the concrete paths setup is responsible for (created OR
  // already-present matching the plan), recorded into the receipt so cleanup
  // inverts setup exactly.
  const receiptEntries: WorktreeReceiptEntry[] = [];

  // F-1.10.12 (D1 cycle 10 wave 4): record a skip in both the flat `skipped`
  // list (back-compat) and the annotated `skippedDetails` list so consumers
  // can tell an idempotent re-run skip apart from a TOCTOU race outcome.
  const recordSkipped = (relPath: string, reason: WorktreeSkipReason): void => {
    result.skipped.push(relPath);
    result.skippedDetails.push({ path: relPath, reason });
  };

  const includePath = join(mainRoot, WORKTREE_INCLUDE_FILE);
  let content: string;
  try {
    content = await readFile(includePath, "utf-8");
  } catch {
    result.errors.push(`Could not read ${WORKTREE_INCLUDE_FILE} from ${mainRoot}`);
    return result;
  }

  const entries = parseWorktreeInclude(content);
  if (entries.length === 0) return result;

  // F1.10-H2 (D1, audit cycle 10 wave 2): glob patterns are unsupported by
  // the symlink-strategy lookup. The strategy resolver below uses
  // literal-prefix matching only, so an entry like `.cache/*.log
  // # hatch3r:symlink` would silently fall through to the default `copy`
  // strategy with no signal to the user. Reject glob+symlink combinations
  // at parse time by recording a structured error and forcing matches
  // against the offending entry to use the default `copy` strategy.
  // Reference: https://git-scm.com/docs/gitignore (accessed 2026-05-27).
  const symlinkGlobOffenders = new Set<string>();
  for (const entry of entries) {
    if (entry.strategy === "symlink" && hasGlobChars(entry.pattern)) {
      symlinkGlobOffenders.add(entry.pattern);
      result.errors.push(
        `${entry.pattern}: glob patterns are unsupported with the symlink strategy — split into literal subpaths or change to copy strategy`,
      );
    }
  }

  // D1-SA1.10-03 (D1, P2): resolve each include pattern in its OWN
  // `git ls-files` call and union the matches, instead of one call for all
  // patterns. A single over-broad pattern (e.g. a large node_modules/) can
  // overrun the 10 MiB stdout buffer; per-pattern resolution isolates that
  // failure to the offending pattern instead of returning [] for EVERY pattern
  // (which silently zeroed the whole worktree population — .env / adapter
  // configs included). Each hard failure is pushed into result.errors so the
  // command's warn loop + non-zero exit see it. The union feeds the SAME
  // most-specific-match strategy loop below, so the resolved set and the
  // copy/symlink override semantics (D1-12) are unchanged.
  const resolvedSet = new Set<string>();
  for (const entry of entries) {
    const resolution = await resolvePatterns(mainRoot, [entry.pattern]);
    if (resolution.error) {
      result.errors.push(`${entry.pattern}: ${resolution.error}`);
    }
    for (const p of resolution.paths) resolvedSet.add(p);
  }
  const resolvedPaths = [...resolvedSet];

  for (const relPath of resolvedPaths) {
    const srcPath = join(mainRoot, relPath);
    const destPath = join(worktreeRoot, relPath);

    // Determine strategy: the LAST matching entry wins (not most-specific).
    // generateWorktreeInclude emits the specific copy overrides AFTER the broad
    // symlink patterns, so entry order in `.worktreeinclude` is the resolution
    // signal — the D1-12 override block (`.hatch3r/hatch.json` copy after the
    // `.hatch3r/` symlink) depends on that ordering, not on pattern specificity.
    // Symlink-glob offenders (F1.10-H2) are skipped — the literal-prefix
    // matcher cannot reliably correlate `relPath` against a glob pattern, so
    // any match against an offender entry falls back to the default `copy`
    // strategy. The per-pattern error recorded above informs the user.
    let strategy: "copy" | "symlink" = "copy";
    for (const entry of entries) {
      const pat = entry.pattern.replace(/\/$/, "");
      if (relPath === pat || relPath.startsWith(pat + "/") || relPath === entry.pattern) {
        if (entry.strategy === "symlink" && symlinkGlobOffenders.has(entry.pattern)) {
          continue;
        }
        strategy = entry.strategy;
        // Don't break — a later entry overrides an earlier one (e.g., the
        // `.hatch3r/hatch.json` copy override, emitted after the `.hatch3r/`
        // symlink, wins for that path).
      }
    }

    try {
      // F1.10-H3 (D1, audit cycle 10 wave 2): close the TOCTOU window
      // between the legacy `lstat` probe and the subsequent
      // `unlink`/`symlink`/`copyFile`. Rely on syscall-level atomicity:
      // `symlink()` throws EEXIST natively, and `copyFile()` does the same
      // when called with the `COPYFILE_EXCL` flag. Per OWASP race-conditions
      // and SEI CERT FIO45-C (both accessed 2026-05-27), removing the check
      // entirely is the recommended fix — "no check means no TOCTOU window."
      await mkdir(dirname(destPath), { recursive: true });

      type WriteResult =
        | { outcome: "created"; actualStrategy: "symlink" | "copy" }
        | { outcome: "exists" };
      const writeOnce = async (): Promise<WriteResult> => {
        if (strategy === "symlink") {
          const relTarget = relative(dirname(destPath), srcPath);
          try {
            await symlink(relTarget, destPath);
            return { outcome: "created", actualStrategy: "symlink" };
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "EPERM") {
              // Fall back to copy on permission errors (e.g., Windows without
              // dev mode). Use COPYFILE_EXCL so the fallback is itself
              // atomic-on-existence — no TOCTOU window per F1.10-H3.
              try {
                await copyFile(srcPath, destPath, fsConstants.COPYFILE_EXCL);
                return { outcome: "created", actualStrategy: "copy" };
              } catch (innerErr) {
                const innerCode = (innerErr as NodeJS.ErrnoException).code;
                if (innerCode === "EEXIST") return { outcome: "exists" };
                throw innerErr;
              }
            }
            if (code === "EEXIST") return { outcome: "exists" };
            throw err;
          }
        }
        try {
          await copyFile(srcPath, destPath, fsConstants.COPYFILE_EXCL);
          return { outcome: "created", actualStrategy: "copy" };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EEXIST") return { outcome: "exists" };
          throw err;
        }
      };

      const recordCreated = (actualStrategy: "symlink" | "copy"): void => {
        if (actualStrategy === "symlink") result.symlinked.push(relPath);
        else result.copied.push(relPath);
        // D1-SA1.10-02: record the ACTUAL on-disk strategy so cleanup inverts
        // it with the right guard (byte-equal for copy, isSymbolicLink for
        // symlink).
        receiptEntries.push({ relPath, strategy: actualStrategy });
      };

      const first = await writeOnce();
      if (first.outcome === "created") {
        recordCreated(first.actualStrategy);
        continue;
      }

      // first.outcome === "exists": destination already present. Honor
      // --force by unlinking and retrying; otherwise treat as skipped.
      if (!options.force) {
        recordSkipped(relPath, "exists");
        // D1-SA1.10-02: the target already matches the plan — record it (with
        // the intended strategy) so cleanup considers it. The byte-equal /
        // isSymbolicLink guards in cleanup protect user-modified content.
        receiptEntries.push({ relPath, strategy });
        continue;
      }
      try {
        await unlink(destPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
        // Raced with another process that already cleared it — proceed to retry.
      }
      const retry = await writeOnce();
      if (retry.outcome === "created") {
        recordCreated(retry.actualStrategy);
      } else {
        // Another writer beat us to it after the unlink — accept the
        // existing entry and record as skipped rather than overwriting blindly.
        // This is the TOCTOU race outcome (F-1.10.3 / F-1.10.12), distinct
        // from the idempotent "exists" skip above.
        recordSkipped(relPath, "eexist-race");
        receiptEntries.push({ relPath, strategy });
      }
    } catch (err) {
      result.errors.push(`${relPath}: ${(err as Error).message}`);
    }
  }

  // D1-SA1.10-02: persist the receipt so `cleanupWorktree` can invert setup
  // exactly. No-op when nothing was materialized (receiptEntries empty).
  await writeWorktreeReceipt(worktreeRoot, receiptEntries);

  return result;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Recursively removes the worktree copy of a copy-strategy directory entry.
 *
 * D1-33 (Cycle 11 Wave 3, D1, P2): `cleanupWorktree`'s per-entry branch only
 * removed byte-equal regular FILES (`lstat(...).isFile()`). Every copy-strategy
 * DIRECTORY entry (`.claude/`, `.cursor/`, `.github/*`, `docs/specs/`,
 * `.hatch3r/learnings|handoffs`) resolves to `isDirectory()`, fell through both
 * the symlink and file branches, and leaked on cleanup. `setupWorktree`
 * materializes those directories as per-file copies (one regular file per
 * resolved path), so the inverse of setup is a per-file removal walk: unlink
 * each worktree file that is byte-equal to its `mainRoot` counterpart, then
 * remove any directory that becomes empty (bottom-up). User-added files and
 * files the user edited (no longer byte-equal to source) are preserved, and a
 * directory that still holds a preserved file is left in place — matching the
 * file branch's "exact matches of the source (not user-modified)" contract.
 *
 * `worktreeDir` and `sourceDir` are absolute paths to the same relative
 * subtree in the worktree and the main repo respectively. Returns true when the
 * directory was removed (became empty), false when at least one entry survived.
 * Probe failures (unreadable file, races) are recorded via verbose() and treated
 * as "preserve" so cleanup never deletes a path it could not prove is a
 * byte-equal source copy.
 */
async function cleanupCopyDirectory(
  worktreeDir: string,
  sourceDir: string,
): Promise<boolean> {
  let dirEntries: import("node:fs").Dirent[];
  try {
    dirEntries = await readdir(worktreeDir, { withFileTypes: true });
  } catch (err) {
    recordWorktreeProbeFailure(`cleanupWorktree: readdir(${worktreeDir}) failed — skipping`, err);
    return false;
  }

  let allRemoved = true;
  for (const dirent of dirEntries) {
    const childWorktree = join(worktreeDir, dirent.name);
    const childSource = join(sourceDir, dirent.name);

    if (dirent.isSymbolicLink()) {
      // A symlink inside a copy directory was not created by the copy walk
      // (setup copies regular files only). Leave it for the user.
      allRemoved = false;
      continue;
    }

    if (dirent.isDirectory()) {
      const childEmptied = await cleanupCopyDirectory(childWorktree, childSource);
      if (!childEmptied) allRemoved = false;
      continue;
    }

    if (dirent.isFile()) {
      try {
        const sourceContent = await readFile(childSource, "utf-8");
        const targetContent = await readFile(childWorktree, "utf-8");
        if (sourceContent === targetContent) {
          await unlink(childWorktree);
        } else {
          // User-modified (diverged from source) — preserve.
          allRemoved = false;
        }
      } catch (err) {
        // Source missing (user-added file) or unreadable — preserve.
        recordWorktreeProbeFailure(
          `cleanupWorktree: preserved ${childWorktree} (source/target unreadable or user-added)`,
          err,
        );
        allRemoved = false;
      }
      continue;
    }

    // FIFO, socket, block/char device — not a setup artifact. Preserve.
    allRemoved = false;
  }

  if (allRemoved) {
    try {
      await rmdir(worktreeDir);
    } catch (err) {
      // Lost a race or a non-empty residue appeared — leave it; the next run
      // is idempotent. Record the probe so --verbose surfaces it.
      recordWorktreeProbeFailure(`cleanupWorktree: rmdir(${worktreeDir}) failed — leaving in place`, err);
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Removes what `setupWorktree` created, returning the worktree toward its
 * pre-setup state (the inverse property the D01 checklist names).
 *
 * D1-SA1.10-02 (D1, P6): prefer the setup RECEIPT (ground truth of the concrete
 * paths setup materialized) so cleanup inverts setup exactly — including glob
 * copies (`.env.*` → `.env.mcp`, a plaintext secret) and per-file symlink trees
 * that the raw-pattern fallback could not reach (CWE-459). When no receipt
 * exists (worktree set up by an older hatch3r, or an unreadable/legacy
 * receipt), fall back to the pattern-based inversion.
 */
export async function cleanupWorktree(worktreeRoot: string): Promise<void> {
  const receipt = await readWorktreeReceipt(worktreeRoot);
  if (receipt) {
    await cleanupFromReceipt(worktreeRoot, receipt);
    return;
  }
  await cleanupFromPatterns(worktreeRoot);
}

/**
 * D1-SA1.10-02: invert setup from the receipt. Symlinks are removed when still
 * symlinks; copies are removed only when byte-equal to their main-repo source
 * (user-modified copies preserved); emptied ancestor directories are pruned
 * bottom-up. Requires the main repo for the copy byte-equal check — when it is
 * unreachable, copies are preserved (never blind-deleted).
 */
async function cleanupFromReceipt(
  worktreeRoot: string,
  receipt: WorktreeReceipt,
): Promise<void> {
  let mainRoot: string | null = null;
  try {
    mainRoot = findMainWorktree(worktreeRoot);
  } catch (err) {
    recordWorktreeProbeFailure(
      "cleanupFromReceipt: findMainWorktree failed — copy entries preserved (no byte-equal check)",
      err,
    );
  }

  // Deepest paths first so a directory's children are gone before we prune it.
  const sorted = [...receipt.entries].sort(
    (a, b) => b.relPath.length - a.relPath.length,
  );
  const touchedDirs = new Set<string>();
  const addAncestors = (childPath: string): void => {
    let d = dirname(childPath);
    while (d.startsWith(worktreeRoot) && d !== worktreeRoot) {
      touchedDirs.add(d);
      d = dirname(d);
    }
  };

  for (const entry of sorted) {
    const targetPath = join(worktreeRoot, entry.relPath);
    addAncestors(targetPath);
    let stat: import("node:fs").Stats;
    try {
      stat = await lstat(targetPath);
    } catch (err) {
      recordWorktreeProbeFailure(
        `cleanupFromReceipt: lstat(${targetPath}) — already removed`,
        err,
      );
      continue;
    }

    if (entry.strategy === "symlink") {
      if (stat.isSymbolicLink()) {
        try {
          await unlink(targetPath);
        } catch (err) {
          recordWorktreeProbeFailure(`cleanupFromReceipt: unlink(${targetPath})`, err);
        }
      } else {
        // User replaced the symlink with real content — preserve.
        recordWorktreeProbeFailure(
          `cleanupFromReceipt: preserved ${targetPath} (no longer a symlink)`,
          new Error("not a symlink"),
        );
      }
      continue;
    }

    // copy: remove only a byte-equal, non-user-modified file.
    if (stat.isFile() && mainRoot) {
      const sourcePath = join(mainRoot, entry.relPath);
      try {
        const [src, tgt] = await Promise.all([
          readFile(sourcePath, "utf-8"),
          readFile(targetPath, "utf-8"),
        ]);
        if (src === tgt) {
          await unlink(targetPath);
        } else {
          recordWorktreeProbeFailure(
            `cleanupFromReceipt: preserved ${targetPath} (user-modified — diverged from source)`,
            new Error("diverged"),
          );
        }
      } catch (err) {
        recordWorktreeProbeFailure(
          `cleanupFromReceipt: preserved ${targetPath} (source/target unreadable or user-added)`,
          err,
        );
      }
    }
  }

  // Prune now-empty directories bottom-up (deepest first). rmdir throws on a
  // non-empty dir (preserved user/edited files) — leave those in place.
  const dirsDeepestFirst = [...touchedDirs].sort((a, b) => b.length - a.length);
  for (const dir of dirsDeepestFirst) {
    try {
      await rmdir(dir);
    } catch (err) {
      recordWorktreeProbeFailure(
        `cleanupFromReceipt: rmdir(${dir}) — not empty or already gone`,
        err,
      );
    }
  }

  // Remove the receipt itself, then prune its (now possibly empty) directory.
  const receiptPath = join(worktreeRoot, WORKTREE_RECEIPT_PATH);
  try {
    await unlink(receiptPath);
  } catch (err) {
    recordWorktreeProbeFailure(`cleanupFromReceipt: receipt already removed`, err);
  }
  try {
    await rmdir(dirname(receiptPath));
  } catch (err) {
    recordWorktreeProbeFailure(
      `cleanupFromReceipt: rmdir(${dirname(receiptPath)}) — not empty or gone`,
      err,
    );
  }
}

/**
 * Legacy pattern-based inversion — the D1-SA1.10-02 fallback for receiptless
 * worktrees. Reads the `.worktreeinclude` from the worktree root (it may have
 * been symlinked or copied in), falling back to the main worktree if not found.
 *
 * #110: Handles both symlink and copy strategy entries. Symlinks are always
 * removed; copied files are only removed if they are exact matches of the
 * source (not user-modified). D1-33: copy-strategy directory entries are
 * recursed into via `cleanupCopyDirectory` so they no longer leak.
 */
async function cleanupFromPatterns(worktreeRoot: string): Promise<void> {
  let content: string | null = null;
  let mainRoot: string | null = null;

  // Try reading from the worktree itself first
  const localPath = join(worktreeRoot, WORKTREE_INCLUDE_FILE);
  try {
    content = await readFile(localPath, "utf-8");
  } catch (localErr) {
    recordWorktreeProbeFailure(
      `readFile(${localPath}) — falling back to main worktree`,
      localErr,
    );
    // Not found locally — try the main worktree
    try {
      mainRoot = findMainWorktree(worktreeRoot);
      content = await readFile(join(mainRoot, WORKTREE_INCLUDE_FILE), "utf-8");
    } catch (mainErr) {
      recordWorktreeProbeFailure(
        `cleanupWorktree: include file unreadable in worktree and main — nothing to clean`,
        mainErr,
      );
      return;
    }
  }

  if (!content) return;
  if (!mainRoot) {
    try { mainRoot = findMainWorktree(worktreeRoot); }
    catch (err) { recordWorktreeProbeFailure("findMainWorktree fallback failed", err); }
  }

  const entries = parseWorktreeInclude(content);

  for (const entry of entries) {
    const targetPath = join(worktreeRoot, entry.pattern.replace(/\/$/, ""));
    try {
      const stat = await lstat(targetPath);
      if (stat.isSymbolicLink()) {
        await unlink(targetPath);
      } else if (entry.strategy === "copy" && stat.isFile() && mainRoot) {
        // Only remove copied files that match the source (not user-modified)
        const sourcePath = join(mainRoot, entry.pattern.replace(/\/$/, ""));
        try {
          const sourceContent = await readFile(sourcePath, "utf-8");
          const targetContent = await readFile(targetPath, "utf-8");
          if (sourceContent === targetContent) {
            await unlink(targetPath);
          }
        } catch (err) {
          recordWorktreeProbeFailure(
            `cleanupWorktree: skipped ${targetPath} (source/target unreadable)`,
            err,
          );
        }
      } else if (entry.strategy === "copy" && stat.isDirectory() && mainRoot) {
        // D1-33: copy-strategy directory entry — recurse, removing byte-equal
        // source copies and pruning emptied directories bottom-up while
        // preserving user-added or user-modified files.
        const sourcePath = join(mainRoot, entry.pattern.replace(/\/$/, ""));
        await cleanupCopyDirectory(targetPath, sourcePath);
      }
    } catch (err) {
      recordWorktreeProbeFailure(
        `cleanupWorktree: lstat(${targetPath}) failed — skipping`,
        err,
      );
    }
  }
}

// ─── Git worktree wrappers ───────────────────────────────────────────────────

/**
 * Probes `git rev-parse --verify --quiet refs/heads/<name>` — exit 0 means the
 * local branch exists. Non-zero exit IS the "absent" signal; does not throw.
 */
export function localBranchExists(mainRoot: string, name: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", mainRoot, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch (err) {
    recordWorktreeProbeFailure(`localBranchExists(${name}) — no local ref`, err);
    return false;
  }
}

/**
 * Probes `git rev-parse --verify --quiet refs/remotes/origin/<name>` — exit 0
 * means a remote-tracking ref for origin exists (fetched at some point).
 * Non-zero exit IS the "absent" signal; does not throw.
 */
export function remoteBranchExists(mainRoot: string, name: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", mainRoot, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch (err) {
    recordWorktreeProbeFailure(`remoteBranchExists(${name}) — no origin ref`, err);
    return false;
  }
}

/**
 * True when a remote named `origin` is configured (`git remote get-url origin`
 * exits 0). Gates the fetch in {@link resolveWorktreeBranchPlan} so a repo
 * without an origin never pays a fetch attempt — and never hits the ambiguous
 * "'origin' does not appear to be a git repository" fetch stderr.
 */
export function hasOriginRemote(mainRoot: string): boolean {
  try {
    execFileSync("git", ["-C", mainRoot, "remote", "get-url", "origin"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (err) {
    recordWorktreeProbeFailure("hasOriginRemote — no origin remote", err);
    return false;
  }
}

/**
 * Runs `git -C <mainRoot> fetch origin <name>` so the remote-only-branch probe
 * ({@link remoteBranchExists}) sees a current `refs/remotes/origin/<name>`.
 *
 * Failure contract (release/2.8.0 attach mode):
 * - "couldn't find remote ref" — the branch is absent upstream. Soft: returns
 *   normally; the caller's rev-parse probe then routes to the plain-create path.
 * - Any other fetch failure (unresolvable host, unreachable/broken origin URL,
 *   refused connection) throws HatchError(NETWORK_ERROR) → exit 75 EX_TEMPFAIL
 *   via ERROR_CODE_TO_EXIT_CODE, with git's stderr verbatim — never an
 *   unclassified crash.
 */
export function fetchOriginBranch(mainRoot: string, name: string): void {
  try {
    execFileSync("git", ["-C", mainRoot, "fetch", "origin", name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? "";
    if (/couldn'?t find remote ref/i.test(stderr)) {
      recordWorktreeProbeFailure(
        `fetchOriginBranch(${name}) — branch absent on origin, create path stays open`,
        err,
      );
      return;
    }
    throw new HatchError(
      `git fetch origin ${name} failed: ${stderr.trim() || (err as Error).message}`,
      undefined,
      "NETWORK_ERROR",
      "Check connectivity and the origin URL (`git remote -v`), then re-run worktree-setup.",
    );
  }
}

/**
 * Resolves how `worktree-setup <name>` should materialize the branch, BEFORE
 * any `git worktree add` runs:
 *
 * 1. `refs/heads/<name>` exists → `attach` (reuse the local branch, no `-b`).
 * 2. Otherwise, when `allowFetch` (default true) and an `origin` remote is
 *    configured: `git fetch origin <name>` (missing upstream ref is soft;
 *    transport failure throws NETWORK_ERROR per {@link fetchOriginBranch}),
 *    then `refs/remotes/origin/<name>` exists → `track`.
 * 3. Otherwise → `create` (fresh branch off HEAD).
 *
 * `allowFetch: false` is the `--dry-run` shape: the preview stays offline and
 * derives the plan from local refs only (an already-fetched
 * `refs/remotes/origin/<name>` still yields `track`).
 */
export function resolveWorktreeBranchPlan(
  mainRoot: string,
  name: string,
  options: { allowFetch?: boolean } = {},
): WorktreeBranchPlan {
  if (localBranchExists(mainRoot, name)) return { mode: "attach" };
  const allowFetch = options.allowFetch ?? true;
  if (allowFetch) {
    if (!hasOriginRemote(mainRoot)) return { mode: "create" };
    fetchOriginBranch(mainRoot, name);
  }
  return remoteBranchExists(mainRoot, name) ? { mode: "track" } : { mode: "create" };
}

/**
 * Names the worktree that has `refs/heads/<name>` checked out, by parsing
 * `git worktree list --porcelain` (via {@link listWorktrees}). Returns
 * undefined when no worktree holds the branch or the porcelain probe fails —
 * the caller then falls back to the path quoted in git's own stderr.
 */
function findWorktreePathForBranch(mainRoot: string, name: string): string | undefined {
  try {
    return listWorktrees(mainRoot).find((w) => w.branch === `refs/heads/${name}`)?.path;
  } catch (err) {
    recordWorktreeProbeFailure(
      `findWorktreePathForBranch(${name}) — porcelain lookup failed`,
      err,
    );
    return undefined;
  }
}

/**
 * Runs `git -C <mainRoot> worktree add ...` to create a worktree, with the
 * branch materialized per `options.mode` ({@link WorktreeAddMode}):
 * - `"create"` (default): `worktree add -b <name> <targetPath>` — new branch off HEAD.
 * - `"attach"`: `worktree add <targetPath> <name>` — reuse the existing local branch.
 * - `"track"`: `worktree add --track -b <name> <targetPath> origin/<name>` —
 *   local branch tracking the remote-only `origin/<name>`.
 *
 * Failure classification (exit codes govern via ERROR_CODE_TO_EXIT_CODE — no
 * hard-coded exit 1):
 * - Branch checked out in another worktree (git: "already used by worktree" /
 *   "already checked out") → VALIDATION_ERROR (64) naming the other worktree's
 *   path from `git worktree list --porcelain`, recoveryHint offering
 *   `hatch3r worktree-cleanup` or cd-ing there.
 * - Existing-branch collision in create mode → VALIDATION_ERROR (64) with a
 *   `--use-existing` attach hint.
 * - Any other git failure (path collision, missing parent, permission) →
 *   FS_ERROR (74) with git's stderr verbatim.
 */
export function addGitWorktree(
  mainRoot: string,
  name: string,
  targetPath: string,
  options: { mode?: WorktreeAddMode } = {},
): void {
  const mode = options.mode ?? "create";
  const args = ["-C", mainRoot, "worktree", "add"];
  if (mode === "attach") {
    args.push(targetPath, name);
  } else if (mode === "track") {
    args.push("--track", "-b", name, targetPath, `origin/${name}`);
  } else {
    args.push("-b", name, targetPath);
  }
  try {
    execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? "";
    // git refuses to attach a branch that another worktree already holds.
    // Phrasing varies by git version: "is already checked out at '<path>'"
    // (git-worktree(1)) vs "is already used by worktree at '<path>'".
    if (/is already (?:used by worktree|checked out) at/i.test(stderr)) {
      const otherPath =
        findWorktreePathForBranch(mainRoot, name) ??
        stderr.match(/at '([^']+)'/)?.[1] ??
        "another worktree";
      throw new HatchError(
        `Branch '${name}' is already checked out in another worktree at '${otherPath}' — git allows a branch in only one worktree at a time.`,
        undefined,
        "VALIDATION_ERROR",
        `cd '${otherPath}' to work there, or run \`hatch3r worktree-cleanup\` to remove that worktree first.`,
      );
    }
    if (/already exists/i.test(stderr) && /branch/i.test(stderr)) {
      throw new HatchError(
        `Branch '${name}' already exists. Attach it with --use-existing, or pick a different name.`,
        undefined,
        "VALIDATION_ERROR",
        `Attach the existing branch: \`hatch3r worktree-setup ${name} --use-existing\`.`,
      );
    }
    throw new HatchError(
      `git worktree add failed: ${stderr.trim() || (err as Error).message}`,
      undefined,
      "FS_ERROR",
    );
  }
}

/**
 * Runs `git -C <mainRoot> worktree remove [--force] <path>` to detach a
 * worktree from git and remove its directory. Branch is preserved.
 *
 * Pass `prune: true` instead for worktrees flagged `prunable` by
 * `git worktree list --porcelain`; that runs `git worktree prune` which is the
 * correct verb for stale worktree records.
 */
export function removeGitWorktree(
  mainRoot: string,
  worktreePath: string,
  options: { force?: boolean; prune?: boolean } = {},
): void {
  try {
    if (options.prune) {
      execFileSync("git", ["-C", mainRoot, "worktree", "prune"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      return;
    }
    const args = ["-C", mainRoot, "worktree", "remove"];
    if (options.force) args.push("--force");
    args.push(worktreePath);
    execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? "";
    throw new HatchError(
      `git worktree remove failed for ${worktreePath}: ${stderr.trim() || (err as Error).message}`,
      undefined,
      "FS_ERROR",
    );
  }
}

/**
 * Validates a name as a git ref via `git check-ref-format --branch <name>`.
 * Returns true on valid, false on invalid. Does not throw.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length === 0) return false;
  let valid = false;
  try {
    execFileSync("git", ["check-ref-format", "--branch", name], {
      stdio: "ignore",
    });
    valid = true;
  } catch {
    // Non-zero exit IS the validation signal — `git check-ref-format` exits
    // non-zero precisely when the name is malformed. The caller renders an
    // actionable error from the boolean return; no diagnostic is dropped.
    valid = false;
  }
  return valid;
}

// ─── .git/info/exclude management ────────────────────────────────────────────

/**
 * Idempotently appends a managed block to `<mainRoot>/.git/info/exclude` that
 * adds `<WORKTREES_DIR>/` to the per-clone exclude list. Per-clone (untracked,
 * not committed), so no PR diff and no team coordination needed.
 *
 * If the managed block is already present, returns false; otherwise appends
 * and returns true. Caller can use the return value to decide whether to log.
 */
export async function ensureWorktreesIgnored(mainRoot: string): Promise<boolean> {
  const excludePath = join(mainRoot, ".git", "info", "exclude");
  let existing = "";
  try {
    existing = await readFile(excludePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    // No exclude file yet — git creates it on `git init` by default, but bare
    // repos or oddly-initialized clones may lack it. Ensure the parent dir
    // exists; the atomic write below materializes the file body.
    await mkdir(dirname(excludePath), { recursive: true });
  }

  if (existing.includes(EXCLUDE_BLOCK_START)) return false;

  const block = [
    "",
    EXCLUDE_BLOCK_START,
    `${WORKTREES_DIR}/`,
    EXCLUDE_BLOCK_END,
    "",
  ].join("\n");
  // F-1.10.11 (D1, audit cycle 10 wave 4): build the full content in memory and
  // write via the temp-file + atomic-rename path (atomicWriteFile) instead of a
  // non-atomic appendFile. A crash mid-append previously left a partial managed
  // block whose missing EXCLUDE_BLOCK_END went undetected on the next run
  // (the START-marker presence check short-circuits). The atomic rename makes
  // the block all-or-nothing, matching the framework's safe-write invariant
  // (CLAUDE.md key-patterns; src/merge/safeWrite.ts).
  await atomicWriteFile(excludePath, existing + block);
  return true;
}

// ─── Managed content ─────────────────────────────────────────────────────────

/**
 * Extracts the inner content between `MANAGED_BLOCK_START` and
 * `MANAGED_BLOCK_END` markers. Used by `safeWriteFile` for merge operations.
 */
export function extractManagedContent(fullContent: string): string {
  const startIdx = fullContent.indexOf(MANAGED_BLOCK_START);
  const endIdx = fullContent.indexOf(MANAGED_BLOCK_END);

  if (startIdx === -1 || endIdx === -1) {
    return "";
  }

  return fullContent
    .substring(startIdx + MANAGED_BLOCK_START.length, endIdx)
    .trim();
}
