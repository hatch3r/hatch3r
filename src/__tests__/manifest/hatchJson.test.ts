import { describe, it, expect } from "vitest";
import { createManifest, addManagedFile } from "../../manifest/hatchJson.js";

describe("hatchJson", () => {
  describe("createManifest", () => {
    it("creates manifest with defaults", () => {
      const manifest = createManifest({
        tools: ["cursor"],
  
      });
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.hatch3rVersion).toBe("1.0.0");
      expect(manifest.tools).toEqual(["cursor"]);
      expect(manifest.features.agents).toBe(true);
      expect(manifest.features.skills).toBe(true);
      expect(manifest.features.rules).toBe(true);
      expect(manifest.features.prompts).toBe(true);
      expect(manifest.features.commands).toBe(true);
      expect(manifest.features.mcp).toBe(true);
      expect(manifest.features.guardrails).toBe(false);
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
