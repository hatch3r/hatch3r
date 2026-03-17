import { describe, it, expect, afterEach } from "vitest";
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
});
