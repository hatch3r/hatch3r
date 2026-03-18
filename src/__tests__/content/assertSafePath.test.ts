import { describe, it, expect } from "vitest";
import { assertSafePath } from "../../content/index.js";

const LABEL = "test";

describe("assertSafePath", () => {
  // ── Path traversal rejection ────────────────────────────────────

  describe("path traversal rejection", () => {
    it("rejects ../secret", () => {
      expect(() => assertSafePath("../secret", LABEL)).toThrow("Unsafe path");
    });

    it("rejects ../../etc/passwd", () => {
      expect(() => assertSafePath("../../etc/passwd", LABEL)).toThrow("Unsafe path");
    });

    it("rejects foo/../../../bar", () => {
      expect(() => assertSafePath("foo/../../../bar", LABEL)).toThrow("Unsafe path");
    });
  });

  // ── Absolute path rejection ─────────────────────────────────────

  describe("absolute path rejection", () => {
    it("rejects /etc/passwd", () => {
      expect(() => assertSafePath("/etc/passwd", LABEL)).toThrow("Unsafe path");
    });

    it("rejects /root/.ssh/id_rsa", () => {
      expect(() => assertSafePath("/root/.ssh/id_rsa", LABEL)).toThrow("Unsafe path");
    });
  });

  // ── Null byte handling ───────────────────────────────────────────
  // Null bytes are stripped before validation and the path is rejected if any were found.
  // This prevents null byte injection bypasses.

  describe("null byte handling", () => {
    it("rejects paths containing null bytes", () => {
      expect(() => assertSafePath("foo\x00bar", LABEL)).toThrow("Unsafe path");
    });

    it("rejects null bytes in extension", () => {
      expect(() => assertSafePath("test\0.md", LABEL)).toThrow("Unsafe path");
    });
  });

  // ── Normalized safe paths ───────────────────────────────────────

  describe("normalized safe paths", () => {
    it("allows foo/bar", () => {
      expect(() => assertSafePath("foo/bar", LABEL)).not.toThrow();
    });

    it("allows agents/test.md", () => {
      expect(() => assertSafePath("agents/test.md", LABEL)).not.toThrow();
    });

    it("allows rules/my-rule.md", () => {
      expect(() => assertSafePath("rules/my-rule.md", LABEL)).not.toThrow();
    });

    it("allows deeply nested safe path", () => {
      expect(() => assertSafePath("skills/hatch3r-feature/SKILL.md", LABEL)).not.toThrow();
    });

    it("allows single filename", () => {
      expect(() => assertSafePath("readme.md", LABEL)).not.toThrow();
    });
  });

  // ── Windows-style traversal ─────────────────────────────────────
  // On POSIX, Node's normalize treats backslashes as literal characters, not separators.
  // "..\\secret" normalizes to a string starting with ".." so it IS caught.
  // "foo\\..\\..\\bar" normalizes to "foo\\..\\..\\bar" (literal) and does NOT start
  // with "..", so it passes. These tests document the platform-dependent behavior.

  describe("windows-style traversal", () => {
    it("rejects ..\\secret (normalize sees leading ..)", () => {
      expect(() => assertSafePath("..\\secret", LABEL)).toThrow("Unsafe path");
    });

    it.skipIf(process.platform === "win32")(
      "does not reject foo\\..\\..\\bar on POSIX (backslash is literal)",
      () => {
        // On Windows this would normalize to "..\\bar" and be caught.
        // On POSIX the backslashes are literal, so the normalized form does not start with "..".
        expect(() => assertSafePath("foo\\..\\..\\bar", LABEL)).not.toThrow();
      },
    );
  });

  // ── Edge cases ──────────────────────────────────────────────────

  describe("edge cases", () => {
    it("allows empty string", () => {
      expect(() => assertSafePath("", LABEL)).not.toThrow();
    });

    it("allows current directory '.'", () => {
      expect(() => assertSafePath(".", LABEL)).not.toThrow();
    });

    it("allows ./foo (relative with dot prefix)", () => {
      expect(() => assertSafePath("./foo", LABEL)).not.toThrow();
    });
  });

  // ── Error message content ───────────────────────────────────────

  describe("error message content", () => {
    it("includes the label in the error message", () => {
      expect(() => assertSafePath("../secret", "copySelectedContent")).toThrow(
        "copySelectedContent",
      );
    });

    it("includes the offending path in the error message", () => {
      expect(() => assertSafePath("../../etc/passwd", LABEL)).toThrow("../../etc/passwd");
    });
  });
});
