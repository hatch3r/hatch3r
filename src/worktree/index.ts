import { readFile, mkdir, copyFile, symlink, lstat, unlink, writeFile, appendFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import {
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
  WORKTREE_INCLUDE_FILE,
  HatchError,
  type HatchManifest,
} from "../types.js";
import type { WorktreeEntry, WorktreeSetupResult } from "./types.js";
import { resolvePatterns, findMainWorktree } from "./resolve.js";
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
  rootDir: string,
): Promise<string> {
  const lines: string[] = [];
  const entries: { pattern: string; strategy: "copy" | "symlink"; reason: string }[] = [];

  // Always include env files (copy — they contain secrets)
  entries.push({ pattern: ".env", strategy: "copy", reason: "environment variables" });
  entries.push({ pattern: ".env.*", strategy: "copy", reason: "environment variables (includes .env.mcp)" });

  // .hatch3r/ — Wave 6: state-tier footprint (manifest + overrides + learnings + handoffs + mcp).
  entries.push({ pattern: ".hatch3r/", strategy: "symlink", reason: "shared hatch3r state (manifest, overrides, mcp)" });
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
    errors: [],
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

  const patterns: string[] = [];
  for (const entry of entries) {
    patterns.push(entry.pattern);
  }

  // Resolve patterns to actual files
  const resolvedPaths = await resolvePatterns(mainRoot, patterns);

  for (const relPath of resolvedPaths) {
    const srcPath = join(mainRoot, relPath);
    const destPath = join(worktreeRoot, relPath);

    // Determine strategy: find the most specific matching pattern.
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
        // Don't break — later entries can override (e.g., .agents/learnings/ overrides .agents/)
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
      };

      const first = await writeOnce();
      if (first.outcome === "created") {
        recordCreated(first.actualStrategy);
        continue;
      }

      // first.outcome === "exists": destination already present. Honor
      // --force by unlinking and retrying; otherwise treat as skipped.
      if (!options.force) {
        result.skipped.push(relPath);
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
        result.skipped.push(relPath);
      }
    } catch (err) {
      result.errors.push(`${relPath}: ${(err as Error).message}`);
    }
  }

  return result;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Removes symlinks and copied files that were created by `setupWorktree`.
 * Reads the `.worktreeinclude` from the worktree root (it may have been
 * symlinked or copied in), falling back to the main worktree if not found.
 *
 * #110: Handles both symlink and copy strategy entries. Symlinks are always
 * removed; copied files are only removed if they are exact matches of the
 * source (not user-modified).
 */
export async function cleanupWorktree(worktreeRoot: string): Promise<void> {
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
 * Runs `git -C <mainRoot> worktree add -b <name> <targetPath>` to create a new
 * worktree on a fresh branch off the current HEAD of the main repo.
 *
 * Throws HatchError(VALIDATION_ERROR) on existing-branch collision so the CLI
 * can offer a name change; throws FS_ERROR for any other git failure (path
 * collision, missing parent, permission, etc.) with git's stderr verbatim.
 */
export function addGitWorktree(
  mainRoot: string,
  name: string,
  targetPath: string,
): void {
  try {
    execFileSync(
      "git",
      ["-C", mainRoot, "worktree", "add", "-b", name, targetPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const stderr = e.stderr?.toString() ?? "";
    if (/already exists/i.test(stderr) && /branch/i.test(stderr)) {
      throw new HatchError(
        `Branch '${name}' already exists. Pick a different name or delete the branch first.`,
        1,
        "VALIDATION_ERROR",
      );
    }
    throw new HatchError(
      `git worktree add failed: ${stderr.trim() || (err as Error).message}`,
      1,
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
      1,
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
    // repos or oddly-initialized clones may lack it. Create with empty body.
    await mkdir(dirname(excludePath), { recursive: true });
    await writeFile(excludePath, "", "utf-8");
  }

  if (existing.includes(EXCLUDE_BLOCK_START)) return false;

  const block = [
    "",
    EXCLUDE_BLOCK_START,
    `${WORKTREES_DIR}/`,
    EXCLUDE_BLOCK_END,
    "",
  ].join("\n");
  await appendFile(excludePath, block, "utf-8");
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
