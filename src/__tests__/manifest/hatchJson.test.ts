import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManifest, addManagedFile, removeManagedFile, migrateManifest, readManifest, writeManifest } from "../../manifest/hatchJson.js";

describe("hatchJson", () => {
  describe("createManifest", () => {
    it("creates manifest with defaults", () => {
      const manifest = createManifest({
        tools: ["cursor"],
      });
      expect(manifest.version).toBe("2.0.0");
      expect(manifest.hatch3rVersion).toBe("1.5.0");
      expect(manifest.platform).toBe("github");
      expect(manifest.tools).toEqual(["cursor"]);
      expect(manifest.features.agents).toBe(true);
      expect(manifest.features.skills).toBe(true);
      expect(manifest.features.rules).toBe(true);
      expect(manifest.features.prompts).toBe(true);
      expect(manifest.features.commands).toBe(true);
      expect(manifest.features.mcp).toBe(true);
      expect(manifest.features.githubAgents).toBe(true);
      expect(manifest.managedFiles).toEqual([]);
    });

    it("accepts custom features as partial overrides", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        features: { agents: false },
      });
      expect(manifest.features.agents).toBe(false);
      expect(manifest.features.rules).toBe(true);
      expect(manifest.features.skills).toBe(true);
    });

    it("accepts multiple disabled features", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        features: { agents: false, skills: false, mcp: false },
      });
      expect(manifest.features.agents).toBe(false);
      expect(manifest.features.skills).toBe(false);
      expect(manifest.features.mcp).toBe(false);
      expect(manifest.features.rules).toBe(true);
    });

    it("accepts MCP servers", () => {
      const manifest = createManifest({
        tools: ["cursor"],
        mcpServers: ["github", "context7"],
      });
      expect(manifest.mcp.servers).toEqual(["github", "context7"]);
    });

    it("defaults MCP servers to empty array", () => {
      const manifest = createManifest({
        tools: ["cursor"],
      });
      expect(manifest.mcp.servers).toEqual([]);
    });

    it("accepts multiple tools", () => {
      const manifest = createManifest({
        tools: ["cursor", "copilot", "claude"],
      });
      expect(manifest.tools).toEqual(["cursor", "copilot", "claude"]);
    });

    it("sets platform to github by default", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      expect(manifest.platform).toBe("github");
    });

    it("accepts azure-devops platform", () => {
      const manifest = createManifest({
        platform: "azure-devops",
        owner: "my-org",
        repo: "my-repo",
        namespace: "my-org",
        project: "my-project",
        tools: ["cursor"],
      });
      expect(manifest.platform).toBe("azure-devops");
      expect(manifest.namespace).toBe("my-org");
      expect(manifest.project).toBe("my-project");
    });

    it("accepts gitlab platform", () => {
      const manifest = createManifest({
        platform: "gitlab",
        owner: "my-group",
        repo: "my-project",
        tools: ["cursor"],
      });
      expect(manifest.platform).toBe("gitlab");
      expect(manifest.namespace).toBe("my-group");
      expect(manifest.project).toBe("my-project");
    });

    it("derives namespace from owner and project from repo when not specified", () => {
      const manifest = createManifest({
        owner: "acme",
        repo: "webapp",
        tools: ["cursor"],
      });
      expect(manifest.namespace).toBe("acme");
      expect(manifest.project).toBe("webapp");
    });
  });

  describe("migrateManifest", () => {
    it("leaves platform undefined when missing so migration checkpoint can prompt", () => {
      const result = migrateManifest({
        version: "1.0.0",
        hatch3rVersion: "0.9.0",
        owner: "acme",
        repo: "app",
        tools: ["cursor"],
        features: {},
        mcp: { servers: [] },
        managedFiles: [],
      });
      expect(result.platform).toBeUndefined();
    });

    it("derives namespace from owner when missing", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      expect(result.namespace).toBe("acme");
    });

    it("derives project from repo when missing", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      expect(result.project).toBe("app");
    });

    it("bumps version from 1.0.0 to 2.0.0", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
      });
      expect(result.version).toBe("2.0.0");
    });

    it("does not overwrite existing platform", () => {
      const result = migrateManifest({
        version: "2.0.0",
        platform: "gitlab",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
      });
      expect(result.platform).toBe("gitlab");
    });

    it("does not overwrite existing namespace", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
        namespace: "custom-ns",
      });
      expect(result.namespace).toBe("custom-ns");
    });

    it("does not overwrite existing project", () => {
      const result = migrateManifest({
        version: "1.0.0",
        owner: "acme",
        repo: "app",
        project: "custom-proj",
      });
      expect(result.project).toBe("custom-proj");
    });

    it("does not downgrade version from 2.0.0", () => {
      const result = migrateManifest({
        version: "2.0.0",
        platform: "github",
        owner: "acme",
        repo: "app",
      });
      expect(result.version).toBe("2.0.0");
    });

    it("handles empty manifest gracefully", () => {
      const result = migrateManifest({});
      expect(result.platform).toBeUndefined();
      expect(result.namespace).toBe("");
      expect(result.project).toBe("");
    });
  });

  describe("addManagedFile", () => {
    it("adds file to managed list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, ".cursor/rules/test.mdc");
      expect(manifest.managedFiles).toContain(".cursor/rules/test.mdc");
    });

    it("does not duplicate entries", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "test.md");
      addManagedFile(manifest, "test.md");
      expect(manifest.managedFiles.filter((f) => f === "test.md")).toHaveLength(1);
    });

    it("can add multiple different files", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      addManagedFile(manifest, "file2.md");
      addManagedFile(manifest, "file3.md");
      expect(manifest.managedFiles).toHaveLength(3);
      expect(manifest.managedFiles).toEqual(["file1.md", "file2.md", "file3.md"]);
    });

    it("mutates manifest in place", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      const ref = manifest.managedFiles;
      addManagedFile(manifest, "new-file.md");
      expect(ref).toContain("new-file.md");
    });
  });

  describe("removeManagedFile", () => {
    it("removes a file from managed list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      addManagedFile(manifest, "file2.md");
      removeManagedFile(manifest, "file1.md");
      expect(manifest.managedFiles).toEqual(["file2.md"]);
    });

    it("is a no-op when file is not in list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      addManagedFile(manifest, "file1.md");
      removeManagedFile(manifest, "nonexistent.md");
      expect(manifest.managedFiles).toEqual(["file1.md"]);
    });

    it("handles empty managed files list", () => {
      const manifest = createManifest({ tools: ["cursor"] });
      removeManagedFile(manifest, "file.md");
      expect(manifest.managedFiles).toEqual([]);
    });
  });

  describe("readManifest", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-manifest-"));
      await mkdir(join(tempDir, ".agents"), { recursive: true });
      return tempDir;
    }

    async function writeManifestJson(rootDir: string, data: unknown): Promise<void> {
      await writeFile(
        join(rootDir, ".agents", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }

    it("returns null when manifest file does not exist", async () => {
      const rootDir = await setup();
      const result = await readManifest(rootDir);
      expect(result).toBeNull();
    });

    it("throws on malformed JSON", async () => {
      const rootDir = await setup();
      await writeFile(
        join(rootDir, ".agents", "hatch.json"),
        "{ not valid json }}}",
        "utf-8",
      );
      await expect(readManifest(rootDir)).rejects.toThrow("Malformed JSON");
    });

    it("throws with descriptive message when required field 'tools' is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        // tools: missing
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("throws with descriptive message when required field 'version' is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        // version: missing
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("throws when tools is a string instead of an array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: "cursor",
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("throws when managedFiles is missing", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        // managedFiles: missing
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("throws when features is null instead of an object", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: null,
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("preserves extra unexpected fields in the manifest", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        customField: "should be preserved",
        extraNumber: 42,
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      // Extra fields should pass through validation and be preserved on the returned object
      const raw = result as unknown as Record<string, unknown>;
      expect(raw.customField).toBe("should be preserved");
      expect(raw.extraNumber).toBe(42);
    });

    it("reads a valid manifest successfully", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe("2.0.0");
      expect(result!.tools).toEqual(["cursor"]);
    });

    it("migrates v1.0.0 manifest and validates successfully", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "1.0.0",
        hatch3rVersion: "0.9.0",
        owner: "acme",
        repo: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe("2.0.0");
      expect(result!.namespace).toBe("acme");
      expect(result!.project).toBe("app");
    });

    it("throws descriptive error suggesting hatch3r init to regenerate", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, { invalid: true });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Run hatch3r init to regenerate/,
      );
    });

    it("validates content sub-schema: rejects non-string preset", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: 123,
          projectType: "brownfield",
          teamSize: "solo",
          items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("validates content sub-schema: rejects missing items", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: "standard",
          projectType: "brownfield",
          teamSize: "solo",
          // items is missing
        },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(
        /Invalid manifest.*required fields missing or malformed/,
      );
    });

    it("accepts valid content sub-schema", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        content: {
          preset: "standard",
          projectType: "brownfield",
          teamSize: "solo",
          items: { agents: ["hatch3r-researcher"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        },
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.content?.preset).toBe("standard");
      expect(result!.content?.items.agents).toContain("hatch3r-researcher");
    });
  });

  describe("writeManifest", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("writes a manifest that can be read back", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".agents"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"], mcpServers: ["github"] });
      await writeManifest(tempDir, manifest);

      const result = await readManifest(tempDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor"]);
      expect(result!.mcp.servers).toEqual(["github"]);
    });

    it("writes valid JSON with trailing newline", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".agents"), { recursive: true });

      const manifest = createManifest({ tools: ["cursor"] });
      await writeManifest(tempDir, manifest);

      const raw = await readFile(join(tempDir, ".agents", "hatch.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("overwrites existing manifest", async () => {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-write-"));
      await mkdir(join(tempDir, ".agents"), { recursive: true });

      const original = createManifest({ tools: ["cursor"] });
      await writeManifest(tempDir, original);

      const updated = createManifest({ tools: ["claude", "cursor"] });
      await writeManifest(tempDir, updated);

      const result = await readManifest(tempDir);
      expect(result!.tools).toEqual(["claude", "cursor"]);
    });
  });

  describe("manifest validation (#108)", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-validate-"));
      await mkdir(join(tempDir, ".agents"), { recursive: true });
      return tempDir;
    }

    async function writeManifestJson(rootDir: string, data: unknown): Promise<void> {
      await writeFile(
        join(rootDir, ".agents", "hatch.json"),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }

    it("rejects invalid tool names in tools array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["invalid-tool"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("rejects non-string tool entries", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: [123, "cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("accepts all known tool names", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor", "claude", "copilot"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.tools).toEqual(["cursor", "claude", "copilot"]);
    });

    it("validates board sub-schema", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        board: { owner: 123 },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("validates worktree.extraPatterns must be string array", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        worktree: { enabled: true, extraPatterns: [123] },
      });
      await expect(readManifest(rootDir)).rejects.toThrow(/Invalid manifest/);
    });

    it("accepts valid worktree.extraPatterns", async () => {
      const rootDir = await setup();
      await writeManifestJson(rootDir, {
        version: "2.0.0",
        hatch3rVersion: "1.5.0",
        owner: "acme",
        repo: "app",
        namespace: "acme",
        project: "app",
        tools: ["cursor"],
        features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true },
        mcp: { servers: [] },
        managedFiles: [],
        worktree: { enabled: true, extraPatterns: [".custom-dir/"] },
      });
      const result = await readManifest(rootDir);
      expect(result).not.toBeNull();
      expect(result!.worktree?.extraPatterns).toEqual([".custom-dir/"]);
    });
  });
});
