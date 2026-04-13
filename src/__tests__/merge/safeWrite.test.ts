import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile, rm, access } from "node:fs/promises";
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

    it("skips file without managed block markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      const original = "original content";
      await writeFile(filePath, original, "utf-8");

      const result = await safeWriteFile(filePath, "", {
        managedContent: "managed stuff",
      });

      expect(result.action).toBe("skipped");
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

    it("overwrites a managed file without creating backups", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "hatch3r-code-standards.md");
      await writeFile(filePath, "old rule content", "utf-8");

      const result = await safeWriteFile(filePath, "new rule content");

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new rule content");
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

    // ── Force mode tests (#101) ───────────────────────────────

    it("force mode overwrites an existing non-managed file", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "custom-file.md");
      await writeFile(filePath, "user content", "utf-8");

      const result = await safeWriteFile(filePath, "forced content", { force: true });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("forced content");
    });

    it("force mode writes through even without managed block markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      await writeFile(filePath, "original user content", "utf-8");

      const result = await safeWriteFile(filePath, "forced overwrite", { force: true });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("forced overwrite");
    });

    it("force mode creates file when it does not exist", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "new-forced.md");

      const result = await safeWriteFile(filePath, "new forced content", { force: true });

      expect(result.action).toBe("created");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new forced content");
    });

    // ── Corruption recovery (.bak) tests (#101) ──────────────

    it("creates .bak backup when managed block is corrupted (duplicate markers)", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "AGENTS.md");
      // Corrupted: duplicate BEGIN markers
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "first block",
        "<!-- HATCH3R:BEGIN -->",
        "duplicate begin",
        "<!-- HATCH3R:END -->",
        "",
        "User content below",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "full replacement content", {
        managedContent: "new managed content",
      });

      expect(result.action).toBe("updated");
      expect(result.warning).toContain("Auto-repaired");
      expect(result.warning).toContain(".bak");

      // Verify .bak file was created with original corrupt content
      const bakPath = filePath + ".bak";
      const bakExists = await access(bakPath).then(() => true).catch(() => false);
      expect(bakExists).toBe(true);
      const bakContent = await readFile(bakPath, "utf-8");
      expect(bakContent).toBe(corrupted);

      // Verify file was overwritten with full replacement content
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("full replacement content");
    });

    it("creates .bak backup when managed block has wrong marker order", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "CLAUDE.md");
      // Corrupted: END before BEGIN
      const corrupted = [
        "<!-- HATCH3R:END -->",
        "content",
        "<!-- HATCH3R:BEGIN -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "repaired content", {
        managedContent: "new managed",
      });

      expect(result.action).toBe("updated");
      expect(result.warning).toContain("Auto-repaired");

      const bakContent = await readFile(filePath + ".bak", "utf-8");
      expect(bakContent).toBe(corrupted);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("repaired content");
    });

    it("corruption recovery warning includes file path and backup path", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "test-corrupt.md");
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "block one",
        "<!-- HATCH3R:END -->",
        "<!-- HATCH3R:BEGIN -->",
        "block two",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "replacement", {
        managedContent: "new content",
      });

      expect(result.warning).toContain(filePath);
      expect(result.warning).toContain(filePath + ".bak");
    });

    // ── Additional .bak corruption recovery tests (Finding #59) ──

    it("creates .bak backup when managed block has duplicate END markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "dup-end.md");
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "content here",
        "<!-- HATCH3R:END -->",
        "some text",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "replacement content", {
        managedContent: "new managed",
      });

      expect(result.action).toBe("updated");
      expect(result.warning).toContain("Auto-repaired");
      expect(result.warning).toContain(".bak");

      const bakContent = await readFile(filePath + ".bak", "utf-8");
      expect(bakContent).toBe(corrupted);
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("replacement content");
    });

    it(".bak file preserves exact corrupted content including whitespace", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "whitespace-corrupt.md");
      const corrupted = [
        "  \t",
        "<!-- HATCH3R:END -->",
        "",
        "<!-- HATCH3R:BEGIN -->",
        "  indented content  ",
        "",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "clean content", {
        managedContent: "managed",
      });

      expect(result.action).toBe("updated");
      expect(result.warning).toContain("Auto-repaired");

      const bakContent = await readFile(filePath + ".bak", "utf-8");
      expect(bakContent).toBe(corrupted);
    });

    it("overwrites existing .bak file on repeated corruption recovery", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "repeat-corrupt.md");
      const bakPath = filePath + ".bak";

      // First corruption
      const corrupted1 = [
        "<!-- HATCH3R:BEGIN -->",
        "first corruption",
        "<!-- HATCH3R:BEGIN -->",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted1, "utf-8");

      await safeWriteFile(filePath, "repair1", { managedContent: "m1" });
      const bak1 = await readFile(bakPath, "utf-8");
      expect(bak1).toBe(corrupted1);

      // Second corruption: write a new corrupted file
      const corrupted2 = [
        "<!-- HATCH3R:END -->",
        "second corruption",
        "<!-- HATCH3R:BEGIN -->",
      ].join("\n");
      await writeFile(filePath, corrupted2, "utf-8");

      await safeWriteFile(filePath, "repair2", { managedContent: "m2" });
      const bak2 = await readFile(bakPath, "utf-8");
      // .bak should now contain the second corruption
      expect(bak2).toBe(corrupted2);
    });

    it("recovery replaces file with full content parameter, not managedContent", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "content-check.md");
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "ok content",
        "<!-- HATCH3R:BEGIN -->",
        "duplicate",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const fullContent = "<!-- HATCH3R:BEGIN -->\nnew managed\n<!-- HATCH3R:END -->\n\nUser notes";
      const result = await safeWriteFile(filePath, fullContent, {
        managedContent: "new managed",
      });

      expect(result.action).toBe("updated");
      const content = await readFile(filePath, "utf-8");
      // File should contain the full content, not just managed content
      expect(content).toBe(fullContent);
      expect(content).toContain("User notes");
    });

    it("corruption recovery action is 'updated' not 'created'", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "action-check.md");
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "a",
        "<!-- HATCH3R:END -->",
        "<!-- HATCH3R:BEGIN -->",
        "b",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "fixed", {
        managedContent: "fixed",
      });

      expect(result.action).toBe("updated");
      expect(result.action).not.toBe("created");
    });

    it(".bak file contains all user content outside corrupted markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "user-content-bak.md");
      const userHeader = "# My Custom Header\n\nImportant user notes.";
      const userFooter = "\n\n## My Custom Footer\n\nMore user content.";
      const corrupted = [
        userHeader,
        "<!-- HATCH3R:BEGIN -->",
        "managed",
        "<!-- HATCH3R:BEGIN -->",
        "duplicate",
        "<!-- HATCH3R:END -->",
        userFooter,
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      await safeWriteFile(filePath, "replacement", {
        managedContent: "new managed",
      });

      const bakContent = await readFile(filePath + ".bak", "utf-8");
      // The backup must contain the user content so nothing is lost
      expect(bakContent).toContain(userHeader);
      expect(bakContent).toContain(userFooter);
    });

    it("corruption recovery handles empty file content between markers", async () => {
      const dir = await createTempDir();
      const filePath = join(dir, "empty-between.md");
      const corrupted = [
        "<!-- HATCH3R:BEGIN -->",
        "",
        "<!-- HATCH3R:BEGIN -->",
        "<!-- HATCH3R:END -->",
      ].join("\n");
      await writeFile(filePath, corrupted, "utf-8");

      const result = await safeWriteFile(filePath, "fresh content", {
        managedContent: "inner",
      });

      expect(result.action).toBe("updated");
      expect(result.warning).toContain("Auto-repaired");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("fresh content");
    });
  });
});
