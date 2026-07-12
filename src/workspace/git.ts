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
 * Strip the `.git` suffix, query string, and trailing slash from a single
 * URL path segment so platform parsers don't have to re-do it.
 */
function stripGitSuffix(segment: string): string {
  return segment.replace(/\.git$/i, "").replace(/[?#].*$/, "");
}

/**
 * Pull the path-portion of a git remote URL (after `host:` or `host/`) and
 * split it into segments. Handles both HTTPS forms (`https://host/path`,
 * `https://user@host/path`) and SSH short-form (`git@host:path`).
 * Returns `null` when no path can be extracted.
 */
function extractPathSegments(url: string): string[] | null {
  // SSH short-form `git@host:path/to/repo` — the colon separates host from path.
  const sshMatch = url.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch) {
    return sshMatch[1].split("/").filter(Boolean);
  }
  // HTTPS / ssh:// / git:// — anchor on the first `://` then drop the host.
  const protoMatch = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i);
  if (protoMatch) {
    return protoMatch[1].split("/").filter(Boolean);
  }
  return null;
}

/**
 * Pull the hostname portion of a git remote URL, mirroring the anchors used by
 * `extractPathSegments`. Handles HTTPS forms (`https://host/path`,
 * `https://user@host/path`), the `ssh://`/`git://` schemes, and SSH short-form
 * (`git@host:path`). Strips an optional `user@` credential prefix and a `:port`
 * suffix so callers match on the bare host. Returns `null` when no host can be
 * extracted.
 */
function extractHost(url: string): string | null {
  // SSH short-form `git@host:path` — host sits between `@` and the first `:`.
  const sshMatch = url.match(/^[^@]+@([^:]+):/);
  if (sshMatch) {
    return sshMatch[1];
  }
  // HTTPS / ssh:// / git:// — the authority sits between `://` and the first `/`.
  const protoMatch = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)\//i);
  if (protoMatch) {
    // Drop an optional `user@` credential prefix and any `:port` suffix.
    return protoMatch[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  }
  return null;
}

/**
 * Parse the owner and repo name from the git `origin` remote URL.
 * Returns empty strings on failure. When `warnings` is provided, a descriptive
 * entry is appended on failure (verbose() always fires regardless).
 *
 * D1-M20 (Cycle 10): the prior single regex `/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/`
 * captured only the last two path segments, which silently dropped parent
 * groups on GitLab nested groups (`gitlab.com/group/subgroup/project` →
 * `subgroup/project`) and produced nonsense on Azure DevOps
 * (`dev.azure.com/org/project/_git/repo` → `_git/repo`). We now dispatch
 * to a per-platform parser:
 *
 * - **GitHub** (`github.com`, `git@github.com:`): owner is the first
 *   segment, repo is the second — GitHub does not support nested
 *   subgroups (per https://docs.github.com/en/repositories/creating-and-
 *   managing-repositories/about-repositories, accessed 2026-05-28).
 * - **GitLab** (`gitlab.com`, self-hosted `gitlab.*`): owner is every
 *   segment EXCEPT the last (joined with `/`) so nested subgroups are
 *   preserved — `group/subgroup/...` is canonical GitLab namespace syntax
 *   (per https://docs.gitlab.com/ee/user/group/subgroups/, accessed
 *   2026-05-28). Repo is the trailing segment.
 * - **Azure DevOps** (`dev.azure.com`, `*.visualstudio.com`,
 *   `ssh.dev.azure.com`): URL layout is `org/project/_git/repo` (HTTPS) or
 *   `v3/org/project/repo` (SSH). Owner = `org/project`, repo = the
 *   trailing segment (per https://learn.microsoft.com/en-us/azure/devops/
 *   repos/git/clone, accessed 2026-05-28).
 * - **Unknown host:** fall back to last-two-segments (preserves the
 *   pre-Cycle-10 contract).
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

    const segments = extractPathSegments(url);
    if (!segments || segments.length < 2) {
      verbose(`git: parseGitRemote could not parse remote URL "${url}"`);
      if (warnings) {
        warnings.push(`git remote URL unparseable: "${url}"`);
      }
      return { owner: "", repo: "" };
    }

    // Strip `.git` from the last segment only — middle segments (groups,
    // org, project) never carry the suffix on any of the four supported
    // hosts.
    const lastIdx = segments.length - 1;
    segments[lastIdx] = stripGitSuffix(segments[lastIdx]);

    const platform = detectPlatformFromRemote(url);
    if (platform === "azure-devops") {
      // HTTPS: org/project/_git/repo (4 segments) → owner=org/project
      // SSH:   v3/org/project/repo (4 segments) → owner=org/project
      const gitIdx = segments.indexOf("_git");
      if (gitIdx >= 1 && gitIdx === segments.length - 2) {
        return { owner: segments.slice(0, gitIdx).join("/"), repo: segments[lastIdx] };
      }
      // SSH form starts with `v3/`; drop it then owner=org/project.
      if (segments[0] === "v3" && segments.length >= 4) {
        return { owner: segments.slice(1, lastIdx).join("/"), repo: segments[lastIdx] };
      }
      // Fall through to last-two if the shape doesn't match.
    } else if (platform === "gitlab") {
      // GitLab: every segment except the last belongs to the namespace.
      return { owner: segments.slice(0, lastIdx).join("/"), repo: segments[lastIdx] };
    } else if (platform === "github") {
      // GitHub: owner is the first segment, repo is the second. Extra
      // trailing segments (e.g. blob URLs accidentally set as the remote)
      // are ignored — the canonical clone URL only ever has owner/repo.
      return { owner: segments[0], repo: segments[1] };
    }

    // Unknown host — preserve the pre-Cycle-10 last-two-segments contract.
    return { owner: segments[lastIdx - 1], repo: segments[lastIdx] };
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

/**
 * Infer the hosting platform (github, gitlab, azure-devops) from a remote URL.
 *
 * D1-SA1.10-08 (Cycle 12): the heuristic matches on the HOST only, not the
 * whole URL. Substring-scanning the entire URL mis-classified a GitHub repo
 * whose *name* contained a host token — e.g. `github.com/user/gitlab.mirror`
 * matched `gitlab.` in the path and wrongly persisted platform "gitlab". The
 * `gitlab.` (rather than exact `gitlab.com`) test is retained on the hostname
 * so self-hosted GitLab installs (`gitlab.example.com`) still match, per
 * https://docs.gitlab.com/ee/user/group/subgroups/ (accessed 2026-07-09) and
 * https://learn.microsoft.com/en-us/azure/devops/repos/git/clone (accessed
 * 2026-07-09). When the host can't be extracted (malformed URL), fall back to
 * scanning the whole string for a best-effort guess.
 */
export function detectPlatformFromRemote(remoteUrl: string): Platform {
  const host = extractHost(remoteUrl) ?? remoteUrl;
  if (host.includes("dev.azure.com") || host.includes("visualstudio.com")) return "azure-devops";
  if (host.includes("gitlab.")) return "gitlab";
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
