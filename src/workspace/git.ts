import { execFileSync } from "node:child_process";
import type { Platform } from "../types.js";

// ── Git Identity ───────────────────────────────────────────────

export interface RepoGitIdentity {
  owner: string;
  repo: string;
  defaultBranch: string;
  platform: Platform;
}

// ── Detection Functions ────────────────────────────────────────

export function parseGitRemote(cwd?: string): { owner: string; repo: string } {
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

    return { owner: "", repo: "" };
  } catch {
    return { owner: "", repo: "" };
  }
}

export function parseGitDefaultBranch(cwd?: string): string {
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
    return "main";
  } catch {
    return "main";
  }
}

export function detectPlatformFromRemote(remoteUrl: string): Platform {
  if (remoteUrl.includes("dev.azure.com") || remoteUrl.includes("visualstudio.com")) return "azure-devops";
  if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab.")) return "gitlab";
  return "github";
}

export function getGitRemoteUrl(cwd?: string): string {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

// ── Composite Detection ────────────────────────────────────────

/**
 * Auto-detect git identity for a repository directory.
 * Returns owner, repo, defaultBranch, and platform by inspecting the git remote.
 */
export function detectRepoGitIdentity(repoDir: string): RepoGitIdentity {
  const remoteUrl = getGitRemoteUrl(repoDir);
  const { owner, repo } = parseGitRemote(repoDir);
  const defaultBranch = parseGitDefaultBranch(repoDir);
  const platform = remoteUrl ? detectPlatformFromRemote(remoteUrl) : "github";

  return { owner, repo, defaultBranch, platform };
}
