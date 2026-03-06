import { describe, it, expect } from "vitest";
import { createManifest, addManagedFile, migrateManifest } from "../../manifest/hatchJson.js";

describe("hatchJson", () => {
  describe("createManifest", () => {
    it("creates manifest with defaults", () => {
      const manifest = createManifest({
        tools: ["cursor"],
      });
      expect(manifest.version).toBe("2.0.0");
      expect(manifest.hatch3rVersion).toBe("1.1.0");
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
});
