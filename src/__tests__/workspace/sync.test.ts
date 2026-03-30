import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { AGENTS_DIR, DEFAULT_FEATURES } from "../../types.js";
import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
  readWorkspaceManifest,
} from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { detectSubRepos, shouldSuggestWorkspace, detectWorkspaceContext } from "../../workspace/detect.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults } from "../../workspace/types.js";

describe("workspace detect", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-detect-"));
    return tempDir;
  }

  async function createGitRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  }

  describe("detectSubRepos", () => {
    it("detects git subdirectories", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));
      await createGitRepo(join(dir, "web"));
      await mkdir(join(dir, "docs")); // not a git repo

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name)).toContain("api");
      expect(repos.map((r) => r.name)).toContain("web");
    });

    it("returns empty for directory with no git repos", async () => {
      const dir = await setup();
      await mkdir(join(dir, "folder1"));
      await mkdir(join(dir, "folder2"));

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(0);
    });

    it("detects existing hatch3r setups", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));
      await mkdir(join(dir, "api", AGENTS_DIR), { recursive: true });
      await writeFile(join(dir, "api", AGENTS_DIR, "hatch.json"), "{}");

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(1);
      expect(repos[0].hasHatch3r).toBe(true);
    });

    it("skips hidden directories", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, ".hidden-repo"));
      await createGitRepo(join(dir, "visible-repo"));

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("visible-repo");
    });
  });

  describe("shouldSuggestWorkspace", () => {
    it("returns true for non-git dir with git subdirs", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));

      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(true);
    });

    it("returns false for git repo", async () => {
      const dir = await setup();
      await createGitRepo(dir);
      await createGitRepo(join(dir, "sub"));

      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(false);
    });

    it("returns false for empty dir", async () => {
      const dir = await setup();
      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(false);
    });
  });

  describe("detectWorkspaceContext", () => {
    it("detects standalone repo", async () => {
      const dir = await setup();
      await createGitRepo(dir);

      const ctx = await detectWorkspaceContext(dir);
      expect(ctx.type).toBe("standalone");
    });

    it("detects workspace root", async () => {
      const dir = await setup();
      await mkdir(join(dir, AGENTS_DIR), { recursive: true });
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({
          version: "1.0.0",
          hatch3rVersion: "1.4.0",
          name: "test",
          repos: [],
          defaults: { tools: [], features: DEFAULT_FEATURES, mcp: { servers: [] }, content: { preset: "standard", projectType: "brownfield", teamSize: "solo", items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] } } },
          syncStrategy: "manual",
        }),
      );

      const ctx = await detectWorkspaceContext(dir);
      expect(ctx.type).toBe("workspace-root");
      expect(ctx.workspaceRoot).toBe(dir);
    });

    it("detects workspace member by walking up", async () => {
      const dir = await setup();
      // Create workspace root
      await mkdir(join(dir, AGENTS_DIR), { recursive: true });
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({
          version: "1.0.0",
          hatch3rVersion: "1.4.0",
          name: "test",
          repos: [],
          defaults: { tools: [], features: DEFAULT_FEATURES, mcp: { servers: [] }, content: { preset: "standard", projectType: "brownfield", teamSize: "solo", items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] } } },
          syncStrategy: "manual",
        }),
      );
      // Create sub-repo dir
      const subDir = join(dir, "api");
      await createGitRepo(subDir);

      const ctx = await detectWorkspaceContext(subDir);
      expect(ctx.type).toBe("workspace-member");
      expect(ctx.workspaceRoot).toBe(dir);
    });
  });
});

describe("workspace sync", () => {
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

  const baseContent: ContentSelection = {
    preset: "minimal",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: ["hatch3r-researcher", "hatch3r-implementer", "hatch3r-reviewer", "hatch3r-test-writer", "hatch3r-security-auditor"],
      skills: [],
      rules: ["hatch3r-agent-orchestration"],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
  };

  const defaults: WorkspaceDefaults = {
    platform: "github",
    tools: ["cursor"],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: [] },
    content: baseContent,
  };

  it("syncs content to opted-in sub-repos", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-sync-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    // Create sub-repos
    await createGitRepo(join(tempDir, "api"));
    await createGitRepo(join(tempDir, "web"));

    // Create workspace manifest with one repo opted in
    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: false },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Sync
    const result = await syncWorkspaceRepos(tempDir);

    // Only api should be synced
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].path).toBe("api");
    expect(result.repos[0].action).toBe("synced");

    // api should have .agents/hatch.json with workspace provenance
    const apiManifestRaw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const apiManifest = JSON.parse(apiManifestRaw);
    expect(apiManifest.workspace).toBeDefined();
    expect(apiManifest.workspace.rootPath).toBe("..");
    expect(apiManifest.tools).toEqual(["cursor"]);

    // web should NOT have .agents/
    try {
      await access(join(tempDir, "web", AGENTS_DIR, "hatch.json"));
      expect.fail("web should not have hatch.json");
    } catch {
      // Expected — web is not synced
    }
  });

  it("respects --dry-run flag", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-dry-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir, { dryRun: true });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("dry-run");

    // dry-run should include estimated token count
    expect(typeof result.repos[0].estimatedTokens).toBe("number");
    expect(result.repos[0].estimatedTokens).toBeGreaterThan(0);

    // api should NOT have .agents/ because it was dry-run
    try {
      await access(join(tempDir, "api", AGENTS_DIR, "hatch.json"));
      expect.fail("api should not have hatch.json in dry-run mode");
    } catch {
      // Expected
    }
  });

  it("reports error for missing repo directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-missing-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "nonexistent", name: "nonexistent", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("error");
    expect(result.repos[0].error).toContain("not found");
  });

  it("syncs specific repos via repos option", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-specific-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));
    await createGitRepo(join(tempDir, "web"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Only sync api
    const result = await syncWorkspaceRepos(tempDir, { repos: ["api"] });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].path).toBe("api");
  });

  it("updates lastSync in workspace manifest after sync", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-ts-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const updated = await readWorkspaceManifest(tempDir);
    expect(updated!.repos[0].lastSync).toBeDefined();
    expect(new Date(updated!.repos[0].lastSync!).getTime()).toBeGreaterThan(0);
  });

  it("populates complete workspace provenance in sub-repo manifest", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-prov-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);

    // Verify all workspace provenance fields
    expect(manifest.workspace).toBeDefined();
    expect(manifest.workspace.rootPath).toBe("..");
    expect(typeof manifest.workspace.lastSync).toBe("string");
    expect(new Date(manifest.workspace.lastSync).getTime()).toBeGreaterThan(0);
    expect(typeof manifest.workspace.syncVersion).toBe("string");
    expect(typeof manifest.workspace.workspaceChecksum).toBe("string");
    expect(manifest.workspace.workspaceChecksum.length).toBe(64); // SHA-256 hex
  });

  it("syncs with per-repo tool overrides", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-override-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        overrides: { tools: ["claude"] },
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.tools).toEqual(["claude"]);
  });

  it("syncs with content exclude overrides", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-exclude-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        overrides: {
          contentOverrides: {
            exclude: ["hatch3r-agent-orchestration"],
          },
        },
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    // The excluded rule should not be in the content selection
    expect(manifest.content.items.rules).not.toContain("hatch3r-agent-orchestration");
    // Workspace provenance should track the exclusion
    expect(manifest.workspace.excludedContent).toContain("hatch3r-agent-orchestration");
  });

  it("uses per-repo owner/repo/branch when syncing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-identity-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        owner: "team-a",
        repo: "backend",
        defaultBranch: "develop",
        platform: "gitlab",
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.owner).toBe("team-a");
    expect(manifest.repo).toBe("backend");
    expect(manifest.platform).toBe("gitlab");
    expect(manifest.board?.defaultBranch).toBe("develop");
  });

  it("falls back gracefully when per-repo identity is absent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-noid-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    // No per-repo identity fields, repo has no remote either
    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    // Should still create a valid manifest with empty/default values
    expect(manifest.owner).toBe("");
    expect(manifest.repo).toBe("");
    expect(manifest.board?.defaultBranch).toBe("main");
  });

  it("returns empty result when no repos are eligible", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-norepos-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: false },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(0);
  });
});
