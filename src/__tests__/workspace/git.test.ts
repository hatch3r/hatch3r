import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  parseGitRemote,
  parseGitDefaultBranch,
  getGitRemoteUrl,
  detectPlatformFromRemote,
  detectRepoGitIdentity,
} from "../../workspace/git.js";
import { setVerbose } from "../../cli/shared/ui.js";

describe("workspace git detection", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function createGitRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  }

  describe("parseGitRemote", () => {
    it("parses HTTPS remote URL", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-https-"));
      await createGitRepo(tempDir);
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme-corp/api-service.git"], { cwd: tempDir, stdio: "pipe" });

      const result = parseGitRemote(tempDir);
      expect(result.owner).toBe("acme-corp");
      expect(result.repo).toBe("api-service");
    });

    it("parses SSH remote URL", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-ssh-"));
      await createGitRepo(tempDir);
      execFileSync("git", ["remote", "add", "origin", "git@github.com:acme-corp/web-app.git"], { cwd: tempDir, stdio: "pipe" });

      const result = parseGitRemote(tempDir);
      expect(result.owner).toBe("acme-corp");
      expect(result.repo).toBe("web-app");
    });

    it("returns empty for repo without remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-noremote-"));
      await createGitRepo(tempDir);

      const result = parseGitRemote(tempDir);
      expect(result.owner).toBe("");
      expect(result.repo).toBe("");
    });

    it("returns empty for non-git directory", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-nogit-"));
      const result = parseGitRemote(tempDir);
      expect(result.owner).toBe("");
      expect(result.repo).toBe("");
    });
  });

  describe("parseGitDefaultBranch", () => {
    it("returns main as fallback for repo without remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-branch-"));
      await createGitRepo(tempDir);

      const result = parseGitDefaultBranch(tempDir);
      expect(result).toBe("main");
    });

    it("returns main for non-git directory", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-nobranch-"));
      const result = parseGitDefaultBranch(tempDir);
      expect(result).toBe("main");
    });
  });

  describe("getGitRemoteUrl", () => {
    it("returns URL for repo with remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-url-"));
      await createGitRepo(tempDir);
      execFileSync("git", ["remote", "add", "origin", "https://github.com/test/repo.git"], { cwd: tempDir, stdio: "pipe" });

      const url = getGitRemoteUrl(tempDir);
      expect(url).toBe("https://github.com/test/repo.git");
    });

    it("returns empty for repo without remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-nourl-"));
      await createGitRepo(tempDir);

      const url = getGitRemoteUrl(tempDir);
      expect(url).toBe("");
    });
  });

  describe("detectPlatformFromRemote", () => {
    it("detects GitHub", () => {
      expect(detectPlatformFromRemote("https://github.com/org/repo.git")).toBe("github");
      expect(detectPlatformFromRemote("git@github.com:org/repo.git")).toBe("github");
    });

    it("detects Azure DevOps", () => {
      expect(detectPlatformFromRemote("https://dev.azure.com/org/project/_git/repo")).toBe("azure-devops");
      expect(detectPlatformFromRemote("https://org.visualstudio.com/project/_git/repo")).toBe("azure-devops");
    });

    it("detects GitLab", () => {
      expect(detectPlatformFromRemote("https://gitlab.com/group/project.git")).toBe("gitlab");
      expect(detectPlatformFromRemote("https://gitlab.example.com/group/project.git")).toBe("gitlab");
    });

    it("defaults to GitHub for unknown URLs", () => {
      expect(detectPlatformFromRemote("https://example.com/repo.git")).toBe("github");
    });

    // D1-SA1.10-08: match the HOST, not the whole URL. A GitHub repo whose
    // *name* contains a host token ("gitlab.", "visualstudio.com") must not
    // flip the platform.
    it("does not mis-classify a GitHub repo whose name contains 'gitlab.'", () => {
      expect(detectPlatformFromRemote("https://github.com/user/gitlab.mirror.git")).toBe("github");
      expect(detectPlatformFromRemote("git@github.com:user/gitlab.ci-tools.git")).toBe("github");
    });

    it("does not mis-classify a GitHub repo whose name contains 'visualstudio.com'", () => {
      expect(detectPlatformFromRemote("https://github.com/user/visualstudio.com-clone.git")).toBe("github");
      expect(detectPlatformFromRemote("git@github.com:user/my.visualstudio.com.git")).toBe("github");
    });

    it("detects self-hosted GitLab over SSH and with a port", () => {
      expect(detectPlatformFromRemote("git@gitlab.example.com:group/project.git")).toBe("gitlab");
      expect(detectPlatformFromRemote("https://gitlab.example.com:8443/group/project.git")).toBe("gitlab");
    });

    it("detects Azure DevOps SSH host even when the repo name contains 'gitlab.'", () => {
      expect(detectPlatformFromRemote("git@ssh.dev.azure.com:v3/org/project/gitlab.mirror")).toBe("azure-devops");
    });

    it("ignores credentials in the authority when matching the host", () => {
      expect(detectPlatformFromRemote("https://token@github.com/user/gitlab.mirror.git")).toBe("github");
    });
  });

  describe("detectRepoGitIdentity", () => {
    it("detects full identity from repo with remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-identity-"));
      await createGitRepo(tempDir);
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme-corp/backend.git"], { cwd: tempDir, stdio: "pipe" });

      const identity = detectRepoGitIdentity(tempDir);
      expect(identity.owner).toBe("acme-corp");
      expect(identity.repo).toBe("backend");
      expect(identity.platform).toBe("github");
      expect(identity.defaultBranch).toBe("main"); // fallback since origin/HEAD isn't set
    });

    it("returns defaults for repo without remote", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-noid-"));
      await createGitRepo(tempDir);

      const identity = detectRepoGitIdentity(tempDir);
      expect(identity.owner).toBe("");
      expect(identity.repo).toBe("");
      expect(identity.platform).toBe("github");
      expect(identity.defaultBranch).toBe("main");
    });

    it("detects GitLab platform from remote URL", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-gitlab-"));
      await createGitRepo(tempDir);
      execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/ops-team/infra.git"], { cwd: tempDir, stdio: "pipe" });

      const identity = detectRepoGitIdentity(tempDir);
      expect(identity.owner).toBe("ops-team");
      expect(identity.repo).toBe("infra");
      expect(identity.platform).toBe("gitlab");
    });
  });

  // C9-H18 (D8-H8.1.2): catch blocks must emit verbose() lines and append
  // descriptive entries to the caller-supplied warnings accumulator. Silent
  // fallbacks (`""`, `"main"`) hid workspace-identity-detection bugs.
  describe("silent-failure surfacing (C9-H18)", () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      setVerbose(false);
    });

    it("parseGitRemote pushes a warning when git is not a repo", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-warn-remote-"));
      const warnings: string[] = [];

      const result = parseGitRemote(tempDir, warnings);

      expect(result.owner).toBe("");
      expect(result.repo).toBe("");
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toMatch(/parseGitRemote/);
    });

    it("parseGitRemote emits verbose() line on failure when --verbose is enabled", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-verbose-remote-"));
      setVerbose(true);

      parseGitRemote(tempDir);

      const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(stderrCalls.some((line: string) => /\[verbose\].*git: parseGitRemote/.test(line))).toBe(true);
    });

    it("parseGitRemote does not push to warnings when accumulator is omitted", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-nopush-remote-"));
      // No warnings array passed — must not throw, must not crash.
      expect(() => parseGitRemote(tempDir)).not.toThrow();
    });

    it("parseGitDefaultBranch pushes a warning when origin/HEAD is missing", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-warn-branch-"));
      await createGitRepo(tempDir);
      const warnings: string[] = [];

      const result = parseGitDefaultBranch(tempDir, warnings);

      expect(result).toBe("main");
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => /parseGitDefaultBranch|default-branch/.test(w))).toBe(true);
    });

    it("parseGitDefaultBranch emits verbose() line on failure when --verbose is enabled", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-verbose-branch-"));
      setVerbose(true);

      parseGitDefaultBranch(tempDir);

      const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(stderrCalls.some((line: string) => /\[verbose\].*git: parseGitDefaultBranch/.test(line))).toBe(true);
    });

    it("getGitRemoteUrl pushes a warning when git is not a repo", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-warn-url-"));
      const warnings: string[] = [];

      const url = getGitRemoteUrl(tempDir, warnings);

      expect(url).toBe("");
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toMatch(/getGitRemoteUrl/);
    });

    it("getGitRemoteUrl emits verbose() line on failure when --verbose is enabled", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-verbose-url-"));
      setVerbose(true);

      getGitRemoteUrl(tempDir);

      const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(stderrCalls.some((line: string) => /\[verbose\].*git: getGitRemoteUrl/.test(line))).toBe(true);
    });

    it("detectRepoGitIdentity threads warnings accumulator into all three helpers", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-warn-identity-"));
      const warnings: string[] = [];

      const identity = detectRepoGitIdentity(tempDir, warnings);

      expect(identity.owner).toBe("");
      expect(identity.repo).toBe("");
      expect(identity.defaultBranch).toBe("main");
      expect(identity.platform).toBe("github");
      // At minimum getGitRemoteUrl + parseGitRemote + parseGitDefaultBranch
      // should each push at least one entry on a fresh non-git directory.
      expect(warnings.length).toBeGreaterThanOrEqual(3);
      expect(warnings.some((w) => /getGitRemoteUrl/.test(w))).toBe(true);
      expect(warnings.some((w) => /parseGitRemote/.test(w))).toBe(true);
      expect(warnings.some((w) => /parseGitDefaultBranch|default-branch/.test(w))).toBe(true);
    });

    it("does not emit verbose() output when --verbose is off", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-git-verbose-off-"));
      setVerbose(false);

      parseGitRemote(tempDir);

      const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(stderrCalls.some((line: string) => /\[verbose\]/.test(line))).toBe(false);
    });
  });
});
