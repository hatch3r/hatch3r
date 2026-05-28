import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readWorkspaceManifest,
  writeWorkspaceManifest,
  createWorkspaceManifest,
  isUnsafeRepoPath,
} from "../../workspace/manifest.js";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";

// Wave 6: manifest moved from `.agents/` to `.hatch3r/`. The workspace
// manifest tracks `workspace.json` under the same directory.
const AGENTS_DIR = HATCH3R_DIR;

describe("workspace manifest", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    return tempDir;
  }

  const minimalDefaults = {
    platform: "github" as const,
    tools: ["cursor" as const],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: ["github"] },
    content: {
      preset: "standard" as const,
      projectType: "brownfield" as const,
      teamSize: "solo" as const,
      items: {
        agents: ["hatch3r-researcher"],
        skills: [],
        rules: [],
        commands: [],
        prompts: [],
        hooks: [],
        githubAgents: [],
      },
    },
  };

  describe("createWorkspaceManifest", () => {
    it("creates manifest with correct version", () => {
      const manifest = createWorkspaceManifest("test-ws", minimalDefaults, [], "manual");
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.name).toBe("test-ws");
      expect(manifest.repos).toEqual([]);
      expect(manifest.syncStrategy).toBe("manual");
    });

    it("includes repos and defaults", () => {
      const repos = [
        { path: "api", name: "api", sync: true },
        { path: "web", name: "web", sync: false },
      ];
      const manifest = createWorkspaceManifest("my-project", minimalDefaults, repos, "on-sync");
      expect(manifest.repos).toHaveLength(2);
      expect(manifest.repos[0].sync).toBe(true);
      expect(manifest.repos[1].sync).toBe(false);
      expect(manifest.syncStrategy).toBe("on-sync");
      expect(manifest.defaults.tools).toEqual(["cursor"]);
    });
  });

  describe("writeWorkspaceManifest / readWorkspaceManifest", () => {
    it("round-trips manifest to disk", async () => {
      const dir = await setup();
      const original = createWorkspaceManifest("round-trip", minimalDefaults, [
        { path: "repo-a", name: "repo-a", sync: true },
      ], "manual");

      await writeWorkspaceManifest(dir, original);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.name).toBe("round-trip");
      expect(read!.repos).toHaveLength(1);
      expect(read!.repos[0].path).toBe("repo-a");
      expect(read!.defaults.tools).toEqual(["cursor"]);
    });

    it("returns null when no manifest exists", async () => {
      const dir = await setup();
      const result = await readWorkspaceManifest(dir);
      expect(result).toBeNull();
    });

    it("writes valid JSON", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("json-check", minimalDefaults, [], "manual");
      await writeWorkspaceManifest(dir, manifest);

      const raw = await readFile(join(dir, AGENTS_DIR, "workspace.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("preserves repo overrides", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("overrides", minimalDefaults, [
        {
          path: "api",
          name: "api",
          sync: true,
          overrides: {
            tools: ["claude"],
            contentOverrides: {
              include: ["hatch3r-security"],
              exclude: ["hatch3r-researcher"],
            },
          },
        },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read!.repos[0].overrides?.tools).toEqual(["claude"]);
      expect(read!.repos[0].overrides?.contentOverrides?.include).toEqual(["hatch3r-security"]);
      expect(read!.repos[0].overrides?.contentOverrides?.exclude).toEqual(["hatch3r-researcher"]);
    });

    it("round-trips manifest with per-repo git identity", async () => {
      const dir = await setup();
      const manifest = createWorkspaceManifest("identity-test", minimalDefaults, [
        {
          path: "api",
          name: "api",
          sync: true,
          owner: "acme-corp",
          repo: "api-service",
          defaultBranch: "develop",
          platform: "github",
        },
        {
          path: "infra",
          name: "infra",
          sync: false,
          owner: "ops-team",
          repo: "infra",
          defaultBranch: "main",
          platform: "gitlab",
        },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.repos[0].owner).toBe("acme-corp");
      expect(read!.repos[0].repo).toBe("api-service");
      expect(read!.repos[0].defaultBranch).toBe("develop");
      expect(read!.repos[0].platform).toBe("github");
      expect(read!.repos[1].owner).toBe("ops-team");
      expect(read!.repos[1].repo).toBe("infra");
      expect(read!.repos[1].platform).toBe("gitlab");
    });

    it("validates old-format manifests without git identity fields", async () => {
      const dir = await setup();
      // Create manifest without per-repo identity (old format)
      const manifest = createWorkspaceManifest("old-format", minimalDefaults, [
        { path: "api", name: "api", sync: true },
      ], "manual");

      await writeWorkspaceManifest(dir, manifest);
      const read = await readWorkspaceManifest(dir);

      expect(read).not.toBeNull();
      expect(read!.repos[0].owner).toBeUndefined();
      expect(read!.repos[0].repo).toBeUndefined();
      expect(read!.repos[0].defaultBranch).toBeUndefined();
      expect(read!.repos[0].platform).toBeUndefined();
    });

    it("rejects manifest with path traversal in repo path", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "evil-workspace",
        repos: [{ path: "../../etc/passwd", sync: true }],
        defaults: minimalDefaults,
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects manifest with absolute repo path", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "evil-workspace",
        repos: [{ path: "/etc/passwd", sync: true }],
        defaults: minimalDefaults,
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    // D3-M8 (Cycle 10 Wave-3 Medium rollover): workspace/manifest.ts measured
    // 66.3% statements — three error-handling branches in
    // `readWorkspaceManifest` and the schema validator had no direct test.
    // Cover each so a future schema-tightening change fails loudly instead
    // of silently dropping rejection.

    it("throws a HatchError with `Malformed JSON` when the manifest file is not valid JSON", async () => {
      const dir = await setup();
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), "{ not valid");
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Malformed JSON");
    });

    it("rejects a manifest with the wrong syncStrategy value", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "bad-sync",
        repos: [],
        defaults: minimalDefaults,
        syncStrategy: "auto", // not in the allowed list ("manual" | "on-sync")
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects a manifest with malformed cliTools selected entries", async () => {
      // Force the cliTools sub-schema's per-element string check to fire.
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.7.5",
        name: "bad-cli",
        repos: [],
        defaults: {
          ...minimalDefaults,
          cliTools: { enabled: true, selected: [123, "ripgrep"] },
        },
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });

    it("rejects a manifest missing the required defaults block", async () => {
      const dir = await setup();
      const raw = JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "no-defaults",
        repos: [],
        // defaults intentionally omitted
        syncStrategy: "manual",
      });
      await writeFile(join(dir, AGENTS_DIR, "workspace.json"), raw);
      await expect(readWorkspaceManifest(dir)).rejects.toThrow("Invalid workspace manifest");
    });
  });

  describe("isUnsafeRepoPath", () => {
    it("rejects path traversal with ..", () => {
      expect(isUnsafeRepoPath("../secret")).toBe(true);
      expect(isUnsafeRepoPath("../../etc/passwd")).toBe(true);
      expect(isUnsafeRepoPath("foo/../../../bar")).toBe(true);
    });

    it("rejects absolute paths", () => {
      expect(isUnsafeRepoPath("/etc/passwd")).toBe(true);
      expect(isUnsafeRepoPath("/root/.ssh/id_rsa")).toBe(true);
    });

    it("rejects paths with null bytes", () => {
      expect(isUnsafeRepoPath("foo\0bar")).toBe(true);
    });

    it("allows safe relative paths", () => {
      expect(isUnsafeRepoPath("api")).toBe(false);
      expect(isUnsafeRepoPath("services/api")).toBe(false);
      expect(isUnsafeRepoPath("web-app")).toBe(false);
    });
  });
});
