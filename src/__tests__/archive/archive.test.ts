import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveToolOutputs, removeManagedFilesForPaths, getManagedFilesForTool } from "../../archive/index.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END, type HatchManifest } from "../../types.js";

function wrapManaged(content: string): string {
  return `${MANAGED_BLOCK_START}\n${content}\n${MANAGED_BLOCK_END}`;
}

describe("archive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeManifest(tools: string[]): HatchManifest {
    return createManifest({
      tools: tools as HatchManifest["tools"],
      mcpServers: [],
      features: { mcp: false },
    });
  }

  describe("archiveToolOutputs", () => {
    it("archives generated files to .hatch3r-archive/<tool>/<timestamp>/", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-test.mdc"),
        wrapManaged("managed content"),
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.archivedFiles.length).toBeGreaterThan(0);
      expect(result.archivedFiles).toContain(".cursor/rules/hatch3r-test.mdc");
      await expect(
        access(join(tempDir, ".cursor", "rules", "hatch3r-test.mdc")),
      ).rejects.toThrow();

      const archiveDir = join(tempDir, ".hatch3r-archive", "cursor");
      await expect(access(archiveDir)).resolves.toBeUndefined();
    });

    it("detects custom content outside managed blocks and migrates to .hatch3r/", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });

      const fileContent = `---
description: My rule
alwaysApply: true
---

${MANAGED_BLOCK_START}
Managed content here
${MANAGED_BLOCK_END}

My custom additions that should be preserved`;

      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-my-rule.mdc"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(1);
      expect(result.migrations[0].type).toBe("rules");
      expect(result.migrations[0].id).toBe("my-rule");

      const customizePath = join(tempDir, ".hatch3r", "rules", "my-rule.customize.md");
      const customizeContent = await readFile(customizePath, "utf-8");
      expect(customizeContent).toContain("My custom additions");
      expect(customizeContent).not.toContain("alwaysApply");
    });

    it("does not overwrite existing .hatch3r/ customization files", async () => {
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await mkdir(join(tempDir, ".hatch3r", "rules"), { recursive: true });

      await writeFile(
        join(tempDir, ".hatch3r", "rules", "my-rule.customize.md"),
        "Existing customization\n",
      );

      const fileContent = `${MANAGED_BLOCK_START}\nManaged\n${MANAGED_BLOCK_END}\n\nNew custom content`;
      await writeFile(
        join(tempDir, ".cursor", "rules", "hatch3r-my-rule.mdc"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(0);

      const existing = await readFile(
        join(tempDir, ".hatch3r", "rules", "my-rule.customize.md"),
        "utf-8",
      );
      expect(existing).toBe("Existing customization\n");
    });

    it("archives files without managed blocks without attempting migration", async () => {
      await mkdir(join(tempDir, ".cursor"), { recursive: true });

      await writeFile(
        join(tempDir, ".cursor", "mcp.json"),
        JSON.stringify({ mcpServers: {} }),
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(0);
      expect(result.archivedFiles).toContain(".cursor/mcp.json");
    });

    it("returns empty result for tool with no existing output files", async () => {
      const result = await archiveToolOutputs(tempDir, "windsurf");

      expect(result.archivedFiles).toHaveLength(0);
      expect(result.migrations).toHaveLength(0);
    });

    it("archives claude output including root-level files", async () => {
      await mkdir(join(tempDir, ".claude", "rules"), { recursive: true });

      await writeFile(join(tempDir, "CLAUDE.md"), wrapManaged("claude instructions"));
      await writeFile(join(tempDir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
      await writeFile(join(tempDir, ".claude", "rules", "hatch3r-test.md"), wrapManaged("rule content"));

      const result = await archiveToolOutputs(tempDir, "claude");

      expect(result.archivedFiles).toContain("CLAUDE.md");
      expect(result.archivedFiles).toContain(".mcp.json");
      expect(result.archivedFiles).toContain(".claude/rules/hatch3r-test.md");
    });

    it("migrates agent customizations from file path", async () => {
      await mkdir(join(tempDir, ".cursor", "agents"), { recursive: true });

      const fileContent = `---
name: hatch3r-reviewer
description: Code reviewer
---

${MANAGED_BLOCK_START}
Review code
${MANAGED_BLOCK_END}

Always check for SQL injection`;

      await writeFile(
        join(tempDir, ".cursor", "agents", "hatch3r-reviewer.md"),
        fileContent,
      );

      const result = await archiveToolOutputs(tempDir, "cursor");

      expect(result.migrations.length).toBe(1);
      expect(result.migrations[0].type).toBe("agents");
      expect(result.migrations[0].id).toBe("reviewer");
    });
  });

  describe("removeManagedFilesForPaths", () => {
    it("removes specified paths from managedFiles", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = [
        ".cursor/rules/a.mdc",
        ".cursor/rules/b.mdc",
        "AGENTS.md",
      ];

      removeManagedFilesForPaths(manifest, [".cursor/rules/a.mdc", ".cursor/rules/b.mdc"]);

      expect(manifest.managedFiles).toEqual(["AGENTS.md"]);
    });

    it("handles empty paths array", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["file1.md", "file2.md"];

      removeManagedFilesForPaths(manifest, []);

      expect(manifest.managedFiles).toEqual(["file1.md", "file2.md"]);
    });

    it("handles paths not in managedFiles", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["file1.md"];

      removeManagedFilesForPaths(manifest, ["nonexistent.md"]);

      expect(manifest.managedFiles).toEqual(["file1.md"]);
    });
  });

  describe("getManagedFilesForTool", () => {
    it("returns cursor managed files", () => {
      const manifest = makeManifest(["cursor", "claude"]);
      manifest.managedFiles = [
        ".cursor/rules/test.mdc",
        ".cursor/mcp.json",
        "CLAUDE.md",
        ".claude/settings.json",
        "AGENTS.md",
      ];

      const result = getManagedFilesForTool(manifest, "cursor");

      expect(result).toEqual([".cursor/rules/test.mdc", ".cursor/mcp.json"]);
    });

    it("returns claude managed files including root-level files", () => {
      const manifest = makeManifest(["cursor", "claude"]);
      manifest.managedFiles = [
        ".cursor/rules/test.mdc",
        "CLAUDE.md",
        ".mcp.json",
        ".claude/settings.json",
        "AGENTS.md",
      ];

      const result = getManagedFilesForTool(manifest, "claude");

      expect(result).toEqual(["CLAUDE.md", ".mcp.json", ".claude/settings.json"]);
    });

    it("returns empty for tool with no managed files", () => {
      const manifest = makeManifest(["cursor"]);
      manifest.managedFiles = ["AGENTS.md"];

      const result = getManagedFilesForTool(manifest, "windsurf");

      expect(result).toEqual([]);
    });

    it("returns amp managed files including root AGENTS.md (#255, D9-9.26)", () => {
      const manifest = makeManifest(["amp"]);
      manifest.managedFiles = [
        ".amp/settings.json",
        "AGENTS.md",
        ".cursor/rules/test.mdc",
      ];

      const result = getManagedFilesForTool(manifest, "amp");

      expect(result).toContain("AGENTS.md");
      expect(result).toContain(".amp/settings.json");
      expect(result).not.toContain(".cursor/rules/test.mdc");
    });

    it("returns aider managed files including .aider/ directory (#256, D9-9.27)", () => {
      const manifest = makeManifest(["aider"]);
      manifest.managedFiles = [
        "CONVENTIONS.md",
        ".aider.conf.yml",
        ".aider/skills/hatch3r-test/SKILL.md",
        ".cursor/rules/test.mdc",
      ];

      const result = getManagedFilesForTool(manifest, "aider");

      expect(result).toContain("CONVENTIONS.md");
      expect(result).toContain(".aider.conf.yml");
      expect(result).toContain(".aider/skills/hatch3r-test/SKILL.md");
      expect(result).not.toContain(".cursor/rules/test.mdc");
    });
  });
});
