import { execFileSync } from "node:child_process";
import { verbose } from "../cli/shared/ui.js";
import type { Platform } from "../types.js";

// ── Git Identity ───────────────────────────────────────────────

export interface RepoGitIdentity {
  owner: string;
  repo: string;
  defaultBranch: string;
  platform: Platform;
}

// ── Internal Helpers ───────────────────────────────────────────

/**
 * Record a git-detection failure: emit a verbose() line to stderr (visible
 * only with --verbose) and append a descriptive entry to the caller-supplied
 * `warnings` accumulator (when provided).
 *
 * Per D8-H8.1.2 (C9-H18): catch blocks in this module previously swallowed
 * errors entirely, yielding silent fallbacks (`""`, `"main"`) that masked
 * real git-detection problems. This helper makes failures observable without
 * forcing callers to handle a thrown error.
 */
function recordGitFailure(
  operation: string,
  err: unknown,
  warnings: string[] | undefined,
  cwd: string | undefined,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const cwdSuffix = cwd ? ` (cwd: ${cwd})` : "";
  verbose(`git: ${operation} failed${cwdSuffix} — ${message}`);
  if (warnings) {
    warnings.push(`git ${operation} failed${cwdSuffix}: ${message}`);
  }
}

// ── Detection Functions ────────────────────────────────────────

/**
 * Parse the owner and repo name from the git `origin` remote URL.
 * Returns empty strings on failure. When `warnings` is provided, a descriptive
 * entry is appended on failure (verbose() always fires regardless).
 */
export function parseGitRemote(
  cwd?: string,
  warnings?: string[],
): { owner: string; repo: string } {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();

    const sshMatch = url.match(/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    verbose(`git: parseGitRemote could not parse remote URL "${url}"`);
    if (warnings) {
      warnings.push(`git remote URL unparseable: "${url}"`);
    }
    return { owner: "", repo: "" };
  } catch (err) {
    recordGitFailure("parseGitRemote (git remote get-url origin)", err, warnings, cwd);
    return { owner: "", repo: "" };
  }
}

/**
 * Detect the default branch name from `origin/HEAD`. Falls back to `"main"`.
 * When `warnings` is provided, a descriptive entry is appended on failure
 * (verbose() always fires regardless).
 */
export function parseGitDefaultBranch(
  cwd?: string,
  warnings?: string[],
): string {
  try {
    const ref = execFileSync("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (ref && ref.startsWith("origin/")) {
      return ref.replace(/^origin\//, "");
    }
    verbose(`git: parseGitDefaultBranch returned unexpected ref "${ref}"; falling back to "main"`);
    if (warnings) {
      warnings.push(`git default-branch detection returned unexpected ref "${ref}"; using fallback "main"`);
    }
    return "main";
  } catch (err) {
    recordGitFailure(
      "parseGitDefaultBranch (git rev-parse --abbrev-ref origin/HEAD)",
      err,
      warnings,
      cwd,
    );
    return "main";
  }
}

/** Infer the hosting platform (github, gitlab, azure-devops) from a remote URL. */
export function detectPlatformFromRemote(remoteUrl: string): Platform {
  if (remoteUrl.includes("dev.azure.com") || remoteUrl.includes("visualstudio.com")) return "azure-devops";
  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab.")) return "gitlab";
  return "github";
}

/**
 * Get the raw URL of the `origin` remote. Returns empty string on failure.
 * When `warnings` is provided, a descriptive entry is appended on failure
 * (verbose() always fires regardless).
 */
export function getGitRemoteUrl(cwd?: string, warnings?: string[]): string {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { cwd, stdio: "pipe" }).toString().trim();
  } catch (err) {
    recordGitFailure("getGitRemoteUrl (git remote get-url origin)", err, warnings, cwd);
    return "";
  }
}

// ── Composite Detection ────────────────────────────────────────

/**
 * Auto-detect git identity for a repository directory.
 * Returns owner, repo, defaultBranch, and platform by inspecting the git remote.
 * When `warnings` is provided, descriptive entries are appended on detection
 * failures (verbose() always fires regardless).
 */
export function detectRepoGitIdentity(
  repoDir: string,
  warnings?: string[],
): RepoGitIdentity {
  const remoteUrl = getGitRemoteUrl(repoDir, warnings);
  const { owner, repo } = parseGitRemote(repoDir, warnings);
  const defaultBranch = parseGitDefaultBranch(repoDir, warnings);
  const platform = remoteUrl ? detectPlatformFromRemote(remoteUrl) : "github";

  return { owner, repo, defaultBranch, platform };
}
