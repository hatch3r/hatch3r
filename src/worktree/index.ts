import { readFile, mkdir, copyFile, symlink, lstat, unlink, writeFile, appendFile } from "node:fs/promises";
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

// Gitignore-syntax managed-block markers for .git/info/exclude. Distinct from
// MANAGED_BLOCK_{START,END} (which are HTML-comment-style and would parse as
// literal ignore patterns here).
const EXCLUDE_BLOCK_START = "# HATCH3R:BEGIN — managed by `hatch3r worktree-setup`";
const EXCLUDE_BLOCK_END = "# HATCH3R:END";

/** Subdirectory of the main repo where hatch3r-managed worktrees live. */
export const WORKTREES_DIR = ".worktrees";

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
  gemini: [
    { pattern: "GEMINI.md", strategy: "copy", reason: "Gemini main instructions" },
    { pattern: ".gemini/", strategy: "copy", reason: "Gemini adapter output (settings, commands, skills)" },
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
  windsurf: [
    { pattern: ".windsurfrules", strategy: "copy", reason: "Windsurf main instructions" },
    { pattern: ".windsurf/", strategy: "copy", reason: "Windsurf adapter output (rules, skills, workflows, MCP)" },
  ],
  cline: [
    { pattern: ".roomodes", strategy: "copy", reason: "Roo Code custom modes" },
    { pattern: ".roo/", strategy: "copy", reason: "Roo Code rules and MCP" },
    { pattern: ".cline/", strategy: "copy", reason: "Cline skills" },
    { pattern: ".clinerules/", strategy: "copy", reason: "Cline workflows" },
  ],
  amp: [
    { pattern: ".amp/", strategy: "copy", reason: "Amp adapter output (agents, settings, skills)" },
  ],
  codex: [
    { pattern: ".codex/", strategy: "copy", reason: "Codex adapter output (config, skills)" },
  ],
  opencode: [
    { pattern: "opencode.json", strategy: "copy", reason: "OpenCode config" },
    { pattern: ".opencode/", strategy: "copy", reason: "OpenCode adapter output (agents, skills, commands)" },
  ],
  kiro: [
    { pattern: ".kiro/", strategy: "copy", reason: "Kiro adapter output (steering, settings)" },
  ],
  aider: [
    { pattern: "CONVENTIONS.md", strategy: "copy", reason: "Aider conventions" },
    { pattern: ".aider.conf.yml", strategy: "copy", reason: "Aider config" },
    { pattern: ".aider/", strategy: "copy", reason: "Aider skills" },
  ],
  goose: [
    { pattern: ".goosehints", strategy: "copy", reason: "Goose instructions" },
    { pattern: ".goose/", strategy: "copy", reason: "Goose MCP config" },
  ],
  zed: [
    { pattern: ".rules", strategy: "copy", reason: "Zed rules" },
  ],
  "amazon-q": [
    { pattern: ".amazonq/", strategy: "copy", reason: "Amazon Q adapter output (rules, settings)" },
  ],
  antigravity: [
    { pattern: ".antigravity/", strategy: "copy", reason: "Antigravity adapter output (rules, skills, settings)" },
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

  // .agents/ — always include (no-op if tracked by git)
  entries.push({ pattern: ".agents/", strategy: "symlink", reason: "shared agent definitions" });
  entries.push({
    pattern: ".agents/learnings/",
    strategy: "copy",
    reason: "per-worktree learnings (diverge across branches)",
  });

  // AGENTS.md — public agent documentation
  entries.push({ pattern: "AGENTS.md", strategy: "copy", reason: "public agent documentation" });

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

  const patterns: string[] = [];
  for (const entry of entries) {
    patterns.push(entry.pattern);
  }

  // Resolve patterns to actual files
  const resolvedPaths = await resolvePatterns(mainRoot, patterns);

  for (const relPath of resolvedPaths) {
    const srcPath = join(mainRoot, relPath);
    const destPath = join(worktreeRoot, relPath);

    // Determine strategy: find the most specific matching pattern
    let strategy: "copy" | "symlink" = "copy";
    for (const entry of entries) {
      const pat = entry.pattern.replace(/\/$/, "");
      if (relPath === pat || relPath.startsWith(pat + "/") || relPath === entry.pattern) {
        strategy = entry.strategy;
        // Don't break — later entries can override (e.g., .agents/learnings/ overrides .agents/)
      }
    }

    try {
      // Skip if destination already exists (idempotent re-run), unless --force
      let destExists = false;
      try {
        await lstat(destPath);
        destExists = true;
      } catch {
        // Doesn't exist — proceed
      }
      if (destExists && !options.force) {
        result.skipped.push(relPath);
        continue;
      }
      if (destExists && options.force) {
        // Remove existing file/symlink before overwriting
        await unlink(destPath);
      }

      await mkdir(dirname(destPath), { recursive: true });

      if (strategy === "symlink") {
        const relTarget = relative(dirname(destPath), srcPath);
        try {
          await symlink(relTarget, destPath);
          result.symlinked.push(relPath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "EPERM") {
            // Fall back to copy on permission errors (e.g., Windows without dev mode)
            await copyFile(srcPath, destPath);
            result.copied.push(relPath);
          } else if (code === "EEXIST") {
            result.skipped.push(relPath);
          } else {
            throw err;
          }
        }
      } else {
        await copyFile(srcPath, destPath);
        result.copied.push(relPath);
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
  } catch {
    // Not found locally — try the main worktree
    try {
      mainRoot = findMainWorktree(worktreeRoot);
      content = await readFile(join(mainRoot, WORKTREE_INCLUDE_FILE), "utf-8");
    } catch {
      // Can't find include file anywhere — nothing to clean up
      return;
    }
  }

  if (!content) return;
  if (!mainRoot) {
    try { mainRoot = findMainWorktree(worktreeRoot); } catch { /* no main root */ }
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
        } catch {
          // Source not readable or target not readable — skip
        }
      }
    } catch {
      // Path doesn't exist or can't be stat'd — skip
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
