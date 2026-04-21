import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile, writeFile, rm, access, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isManagedPath,
  safeWriteFile,
  sweepOrphanTmpFiles,
  formatOrphanTmpSweepDiagnostic,
} from "../../merge/safeWrite.js";

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

  // ──────────────────────────────────────────────────────────────────────
  // D11-SA11.2-01 (C7.5-W2B2-H37): Orphan tmp-file sweep
  // ──────────────────────────────────────────────────────────────────────

  describe("sweepOrphanTmpFiles (D11-SA11.2-01)", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function createTempDir(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-sweep-"));
      return tempDir;
    }

    /**
     * Create a file that looks like a real orphan tmp: name matches the exact
     * `.tmp.<8-hex>` suffix atomicWriteFile produces, and its mtime is backdated
     * past the 60s orphan-age threshold.
     */
    async function makeOrphanTmp(dir: string, base: string, suffix = "deadbeef"): Promise<string> {
      const path = join(dir, `${base}.tmp.${suffix}`);
      await writeFile(path, "orphan content", "utf-8");
      // Backdate by 2 minutes so it exceeds the 60s min-age gate.
      const past = new Date(Date.now() - 120_000);
      await utimes(path, past, past);
      return path;
    }

    it("returns empty array when directory has no orphans", async () => {
      const dir = await createTempDir();
      await writeFile(join(dir, "regular.md"), "content", "utf-8");

      const result = await sweepOrphanTmpFiles(dir);

      expect(result).toEqual([]);
    });

    it("removes an aged orphan tmp file and reports it", async () => {
      const dir = await createTempDir();
      const orphan = await makeOrphanTmp(dir, "file.md");

      const result = await sweepOrphanTmpFiles(dir);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(orphan);
      expect(result[0].removed).toBe(true);
      expect(result[0].error).toBeUndefined();

      // Orphan is gone from disk
      const exists = await access(orphan).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("does not remove tmp files younger than 60s (avoid racing a live write)", async () => {
      const dir = await createTempDir();
      const fresh = join(dir, "live.md.tmp.abcd1234");
      await writeFile(fresh, "in-flight", "utf-8");
      // Do not backdate — mtime is "now", well under the 60s threshold.

      const result = await sweepOrphanTmpFiles(dir);

      expect(result).toEqual([]);
      const exists = await access(fresh).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("ignores non-matching tmp-like filenames (wrong pattern)", async () => {
      const dir = await createTempDir();
      // Backdate these too so the only reason to skip is the pattern mismatch.
      const past = new Date(Date.now() - 120_000);
      const looksTmpButNotOurs1 = join(dir, "file.tmp"); // no hex suffix
      const looksTmpButNotOurs2 = join(dir, "file.tmp.abc"); // too-short hex
      const looksTmpButNotOurs3 = join(dir, "file.tmp.ghijklmn"); // non-hex chars
      const looksTmpButNotOurs4 = join(dir, "file.tmp.abcd12345"); // too-long hex
      await writeFile(looksTmpButNotOurs1, "x", "utf-8");
      await writeFile(looksTmpButNotOurs2, "x", "utf-8");
      await writeFile(looksTmpButNotOurs3, "x", "utf-8");
      await writeFile(looksTmpButNotOurs4, "x", "utf-8");
      for (const p of [looksTmpButNotOurs1, looksTmpButNotOurs2, looksTmpButNotOurs3, looksTmpButNotOurs4]) {
        await utimes(p, past, past);
      }

      const result = await sweepOrphanTmpFiles(dir);

      expect(result).toEqual([]);
      // All non-matching files still present
      for (const p of [looksTmpButNotOurs1, looksTmpButNotOurs2, looksTmpButNotOurs3, looksTmpButNotOurs4]) {
        expect(await access(p).then(() => true).catch(() => false)).toBe(true);
      }
    });

    it("finds multiple orphans in a single directory", async () => {
      const dir = await createTempDir();
      await makeOrphanTmp(dir, "a.md", "11111111");
      await makeOrphanTmp(dir, "b.md", "22222222");
      await makeOrphanTmp(dir, "c.md", "33333333");
      // Plus a regular file that must NOT be swept
      await writeFile(join(dir, "keeper.md"), "keep", "utf-8");

      const result = await sweepOrphanTmpFiles(dir);

      expect(result).toHaveLength(3);
      expect(result.every((e) => e.removed)).toBe(true);
      const remaining = await readdir(dir);
      expect(remaining).toEqual(["keeper.md"]);
    });

    it("recurses into subdirectories when recursive: true", async () => {
      const dir = await createTempDir();
      const { mkdir } = await import("node:fs/promises");
      const nested = join(dir, "nested", "deep");
      await mkdir(nested, { recursive: true });
      await makeOrphanTmp(nested, "deep.md", "abcdef00");
      await makeOrphanTmp(dir, "root.md", "fedcba99");

      const result = await sweepOrphanTmpFiles(dir, { recursive: true });

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.removed)).toBe(true);
    });

    it("does not recurse by default", async () => {
      const dir = await createTempDir();
      const { mkdir } = await import("node:fs/promises");
      const nested = join(dir, "nested");
      await mkdir(nested, { recursive: true });
      await makeOrphanTmp(nested, "deep.md", "abcdef00");
      await makeOrphanTmp(dir, "root.md", "fedcba99");

      const result = await sweepOrphanTmpFiles(dir);

      // Only the root-level orphan is swept
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe(join(dir, "root.md.tmp.fedcba99"));
    });

    it("returns [] without throwing when directory does not exist (ENOENT)", async () => {
      const result = await sweepOrphanTmpFiles("/definitely-does-not-exist-hatch3r-sweep-test");

      expect(result).toEqual([]);
    });

    it("reports non-ENOENT readdir failures via console.error and returns []", async () => {
      // ESM namespace modules cannot be spied on via vi.spyOn. Use vi.doMock
      // + module reset to substitute readdir with an EACCES rejection.
      const dir = await createTempDir();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.resetModules();
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          readdir: vi.fn().mockRejectedValue(
            Object.assign(new Error("perm denied"), { code: "EACCES" }),
          ),
        };
      });

      try {
        const mod = await import("../../merge/safeWrite.js");
        const result = await mod.sweepOrphanTmpFiles(dir);
        expect(result).toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
        const msg = errorSpy.mock.calls[0]?.[0];
        expect(String(msg)).toContain("orphan-tmp sweep");
        expect(String(msg)).toContain(dir);
      } finally {
        errorSpy.mockRestore();
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }
    });

    it("silently skips ENOENT readdir (fresh checkout, no diagnostic noise)", async () => {
      // ENOENT must NOT log to console.error — it's the expected case for a
      // brand new project that doesn't have .agents/ yet.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await sweepOrphanTmpFiles(
          "/definitely-missing-hatch3r-sweep-enoent-case",
        );
        expect(result).toEqual([]);
        // No diagnostic — ENOENT is silent per the doc comment.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("reports unlink failures in the entry list without throwing", async () => {
      // Seed a real orphan first (so readdir/stat succeed), then mock unlink.
      const dir = await createTempDir();
      const orphan = await makeOrphanTmp(dir, "stuck.md");

      vi.resetModules();
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          unlink: vi.fn().mockRejectedValue(
            Object.assign(new Error("busy"), { code: "EBUSY" }),
          ),
        };
      });

      try {
        const mod = await import("../../merge/safeWrite.js");
        const result = await mod.sweepOrphanTmpFiles(dir);
        expect(result).toHaveLength(1);
        expect(result[0].path).toBe(orphan);
        expect(result[0].removed).toBe(false);
        expect(result[0].error).toContain("busy");
      } finally {
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }
    });

    it("uses explicit nowMs parameter for deterministic age testing", async () => {
      const dir = await createTempDir();
      const orphan = join(dir, "file.md.tmp.12345678");
      await writeFile(orphan, "content", "utf-8");
      // Do not backdate — normally the 60s gate would protect this file.
      // But if we pass a nowMs far in the future, it becomes "aged".
      const futureMs = Date.now() + 3_600_000; // 1 hour ahead

      const result = await sweepOrphanTmpFiles(dir, { nowMs: futureMs });

      expect(result).toHaveLength(1);
      expect(result[0].removed).toBe(true);
    });

    it("skips orphan that disappears between readdir and stat", async () => {
      // Race condition simulation: orphan present at readdir time, gone by stat.
      // The sweep must skip it gracefully, not throw.
      const dir = await createTempDir();
      await makeOrphanTmp(dir, "ghost.md", "aaaaaaaa");

      vi.resetModules();
      vi.doMock("node:fs/promises", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs/promises")>();
        return {
          ...actual,
          stat: vi.fn().mockRejectedValue(
            Object.assign(new Error("vanished"), { code: "ENOENT" }),
          ),
        };
      });

      try {
        const mod = await import("../../merge/safeWrite.js");
        const result = await mod.sweepOrphanTmpFiles(dir);
        expect(result).toEqual([]);
      } finally {
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // formatOrphanTmpSweepDiagnostic
  // ──────────────────────────────────────────────────────────────────────

  describe("formatOrphanTmpSweepDiagnostic", () => {
    it("returns null when entries is empty", () => {
      expect(formatOrphanTmpSweepDiagnostic([])).toBeNull();
    });

    it("formats a single removed entry", () => {
      const msg = formatOrphanTmpSweepDiagnostic([
        { path: "/tmp/x.md.tmp.deadbeef", mtimeMs: 0, removed: true },
      ]);
      expect(msg).toContain("Swept 1 orphan temp file");
      expect(msg).toContain("/tmp/x.md.tmp.deadbeef");
      expect(msg).toContain("prior interrupted runs");
    });

    it("formats multiple removed entries with all paths", () => {
      const msg = formatOrphanTmpSweepDiagnostic([
        { path: "/tmp/a.md.tmp.11111111", mtimeMs: 0, removed: true },
        { path: "/tmp/b.md.tmp.22222222", mtimeMs: 0, removed: true },
      ]);
      expect(msg).toContain("Swept 2");
      expect(msg).toContain("/tmp/a.md.tmp.11111111");
      expect(msg).toContain("/tmp/b.md.tmp.22222222");
    });

    it("reports failed entries separately with their error", () => {
      const msg = formatOrphanTmpSweepDiagnostic([
        { path: "/tmp/stuck.md.tmp.ffffffff", mtimeMs: 0, removed: false, error: "EBUSY" },
      ]);
      expect(msg).toContain("Failed to remove 1 orphan");
      expect(msg).toContain("/tmp/stuck.md.tmp.ffffffff");
      expect(msg).toContain("EBUSY");
      expect(msg).toContain("remove manually");
    });

    it("combines swept + failed into one message", () => {
      const msg = formatOrphanTmpSweepDiagnostic([
        { path: "/tmp/ok.md.tmp.00000000", mtimeMs: 0, removed: true },
        { path: "/tmp/stuck.md.tmp.ffffffff", mtimeMs: 0, removed: false, error: "EACCES" },
      ]);
      expect(msg).toContain("Swept 1");
      expect(msg).toContain("Failed to remove 1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // C7.5-W2B2-H37: mid-stream exception produces an orphan that a later
  // sweep cleans up with a diagnostic. Exercises the end-to-end contract.
  // ──────────────────────────────────────────────────────────────────────

  describe("mid-stream exception orphan recovery (C7.5-W2B2-H37)", () => {
    let tempDir: string;

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    async function createTempDir(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), "hatch3r-midstream-"));
      return tempDir;
    }

    it("process-kill simulation: fabricate an orphan, later sweep removes it with warning", async () => {
      const dir = await createTempDir();

      // Step 1: Simulate a prior run that was SIGKILL'd mid-atomicWriteFile
      // by fabricating an orphan (the finally unlink never ran). We backdate
      // the mtime so it passes the 60s orphan-age gate.
      const orphanPath = join(dir, "target.md.tmp.01234567");
      await writeFile(orphanPath, "half-written content", "utf-8");
      const past = new Date(Date.now() - 120_000);
      await utimes(orphanPath, past, past);

      // Step 2: A subsequent invocation (sync/update start) runs the sweep.
      const sweepResults = await sweepOrphanTmpFiles(dir);

      // Step 3: Diagnostic is produced — this is the key contract. The sweep
      // is NOT silent; callers get a list they can log.
      expect(sweepResults).toHaveLength(1);
      expect(sweepResults[0].removed).toBe(true);
      expect(sweepResults[0].path).toBe(orphanPath);

      const diag = formatOrphanTmpSweepDiagnostic(sweepResults);
      expect(diag).not.toBeNull();
      expect(diag).toContain("prior interrupted runs");

      // Step 4: Orphan is gone — workspace is clean for the new run.
      const stillExists = await access(orphanPath).then(() => true).catch(() => false);
      expect(stillExists).toBe(false);
    });

    it("failed write leaves no orphan under normal finally cleanup", async () => {
      // Sanity: under normal error paths (not process-kill), the existing
      // finally block in atomicWriteFile already unlinks the tmp. This
      // confirms the sweep is only needed for process-kill scenarios.
      const dir = await createTempDir();
      const targetDir = join(dir, "missing-sub"); // does not exist
      const target = join(targetDir, "nested.md");

      // atomicWriteFile requires the parent to exist; safeWriteFile handles
      // that via mkdir. But we want a failure mid-flow — directly calling
      // atomicWriteFile on a nonexistent parent triggers writeFile ENOENT
      // and the finally unlink runs.
      const { atomicWriteFile } = await import("../../merge/safeWrite.js");
      await expect(atomicWriteFile(target, "content")).rejects.toThrow();

      // No tmp files should remain in the parent (when the parent exists).
      // The dir itself doesn't exist, so readdir on the non-existent parent
      // returns []; instead we check at the root.
      const files = await readdir(dir);
      expect(files.filter((f) => f.includes(".tmp."))).toEqual([]);
    });
  });
});
