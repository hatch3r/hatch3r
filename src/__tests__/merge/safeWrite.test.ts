import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isManagedPath, safeWriteFile } from "../../merge/safeWrite.js";

describe("safeWrite", () => {
  describe("isManagedPath", () => {
    it("returns true for hatch3r-prefixed files", () => {
      expect(isManagedPath(".cursor/rules/hatch3r-code-standards.mdc")).toBe(true);
    });

    it("returns true for deeply nested hatch3r-prefixed files", () => {
      expect(isManagedPath(".cursor/skills/hatch3r-test/SKILL.md")).toBe(false);
      expect(isManagedPath("some/deep/path/hatch3r-file.md")).toBe(true);
    });

    it("returns false for non-prefixed files", () => {
      expect(isManagedPath(".cursor/rules/my-custom-rule.mdc")).toBe(false);
    });

    it("returns false for shared files like AGENTS.md", () => {
      expect(isManagedPath("AGENTS.md")).toBe(false);
    });

    it("returns false for CLAUDE.md", () => {
      expect(isManagedPath("CLAUDE.md")).toBe(false);
    });

    it("returns false for files containing hatch3r in directory but not filename", () => {
      expect(isManagedPath("hatch3r/rules/some-rule.md")).toBe(false);
    });

    it("returns true when filename starts with hatch3r- regardless of path", () => {
      expect(isManagedPath("hatch3r-bridge.mdc")).toBe(true);
      expect(isManagedPath("/absolute/path/hatch3r-rule.md")).toBe(true);
    });
  });

  describe("safeWriteFile", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function createTempDir(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-test-"));
      return tempDir;
    }

    it("creates a new file when it does not exist", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "new-file.md");

      const result = await safeWriteFile(filePath, "hello world");

      expect(result.action).toBe("created");
      expect(result.path).toBe(filePath);
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });

    it("overwrites a managed file (hatch3r- prefix)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "hatch3r-rule.md");
      await writeFile(filePath, "old content", "utf-8");

      const result = await safeWriteFile(filePath, "new content");

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new content");
    });

    it("skips file without managed block markers when managedContent provided", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      const original = "# My Custom Section\n\nCustom content here.";
      await writeFile(filePath, original, "utf-8");

      const result = await safeWriteFile(filePath, "", {
        managedContent: "managed stuff",
      });

      expect(result.action).toBe("skipped");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("replaces managed block in file with existing markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      const existing = [
        "<!-- HATCH3R:BEGIN -->",
        "old managed content",
        "<!-- HATCH3R:END -->",
        "",
        "# Custom Section",
      ].join("\n");
      await writeFile(filePath, existing, "utf-8");

      const result = await safeWriteFile(filePath, "", {
        managedContent: "new managed content",
      });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("new managed content");
      expect(content).not.toContain("old managed content");
      expect(content).toContain("# Custom Section");
    });

    it("skips unmanaged file without managedContent", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "custom-file.md");
      await writeFile(filePath, "user content", "utf-8");

      const result = await safeWriteFile(filePath, "new content");

      expect(result.action).toBe("skipped");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("user content");
    });

    it("skips file without managed block markers even when backup requested", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      const original = "original content";
      await writeFile(filePath, original, "utf-8");

      const result = await safeWriteFile(filePath, "", {
        managedContent: "managed stuff",
        backup: true,
      });

      expect(result.action).toBe("skipped");
      expect(result.backup).toBeUndefined();
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe(original);
    });

    it("prepends managed block when appendIfNoBlock and file has no markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      const userContent = "# My Custom Section\n\nCustom content here.";
      await writeFile(filePath, userContent, "utf-8");

      const managedBlock = "<!-- HATCH3R:BEGIN -->\nhatch3r content\n<!-- HATCH3R:END -->";
      const result = await safeWriteFile(filePath, managedBlock, {
        managedContent: "hatch3r content",
        appendIfNoBlock: true,
      });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain(userContent);
      expect(content).toContain("hatch3r content");
      expect(content.indexOf("hatch3r content")).toBeLessThan(content.indexOf(userContent));
    });

    it("creates backup when overwriting a managed file", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "hatch3r-code-standards.md");
      await writeFile(filePath, "old rule content", "utf-8");

      const result = await safeWriteFile(filePath, "new rule content", {
        backup: true,
      });

      expect(result.action).toBe("backed-up");
      expect(result.backup).toBeDefined();
      const backupContent = await readFile(result.backup!, "utf-8");
      expect(backupContent).toBe("old rule content");
    });

    it("uses managedContent merge for hatch3r-prefixed file when managedContent is provided", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "hatch3r-bridge.mdc");
      const existing = [
        "---",
        "description: user-customized description",
        "---",
        "",
        "<!-- HATCH3R:BEGIN -->",
        "old body",
        "<!-- HATCH3R:END -->",
        "",
        "User custom additions",
      ].join("\n");
      await writeFile(filePath, existing, "utf-8");

      const result = await safeWriteFile(filePath, "ignored full content", {
        managedContent: "new body",
      });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("new body");
      expect(content).not.toContain("old body");
      expect(content).toContain("user-customized description");
      expect(content).toContain("User custom additions");
    });

    it("creates nested directories for new files", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "deep", "nested", "dir", "file.md");

      const result = await safeWriteFile(filePath, "deep content");

      expect(result.action).toBe("created");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("deep content");
    });
  });
});
