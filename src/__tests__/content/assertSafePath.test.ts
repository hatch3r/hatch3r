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

  // ── Adversarial paths (D3-M6) ───────────────────────────────────
  //
  // D3-M6 (Cycle 10 Wave-3 Medium rollover): the original suite covered the
  // classic `..` and absolute-path cases but missed several adversarial
  // shapes attackers commonly try against path-traversal guards. These tests
  // pin the documented behaviour for each:
  //   - Windows UNC paths (`\\server\share`) — `normalize` treats backslash
  //     as a literal on POSIX, so the normalized form does NOT start with
  //     `..` and the absolute-path check on POSIX returns false. Document
  //     the limitation explicitly (POSIX runners are the only CI targets
  //     that exercise this branch).
  //   - `file:///` URLs — `normalize` keeps the scheme literally; the
  //     resulting string starts with `file:` which is not `..` and not
  //     absolute under POSIX semantics. Document the behaviour so a
  //     follow-up that adds explicit URL rejection has a baseline.
  //   - Doubled backslashes (`foo\\\\bar`) — same POSIX-literal handling;
  //     document.
  //   - Symlink-style indirection (path strings only) — assertSafePath does
  //     not touch the filesystem, so a symlink that resolves outside the
  //     project root is NOT this function's concern. Confirm the contract.
  //
  // These are FALSIFIABLE assertions — if a future change starts rejecting
  // any of these inputs on POSIX, the corresponding test fails and the
  // change author has to update the contract documentation.

  describe("adversarial path inputs (D3-M6)", () => {
    it.skipIf(process.platform === "win32")(
      "documents that UNC-style paths pass on POSIX (backslash is literal)",
      () => {
        // On Windows, `\\server\share\file` is absolute; on POSIX it is a
        // literal string with no separator semantics, so it passes.
        // assertSafePath therefore is NOT a sufficient guard against UNC
        // inputs that reach Windows-targeted code — Windows-only checks
        // belong in the caller.
        expect(() => assertSafePath("\\\\server\\share\\file", LABEL)).not.toThrow();
      },
    );

    it.skipIf(process.platform === "win32")(
      "documents that `file:///` URL inputs pass on POSIX",
      () => {
        // `normalize("file:///etc/passwd")` returns the string verbatim on
        // POSIX, and the first three chars are `fil` — not `..` and not
        // absolute. Callers expecting URL inputs must validate the scheme
        // before calling assertSafePath.
        expect(() => assertSafePath("file:///etc/passwd", LABEL)).not.toThrow();
      },
    );

    it.skipIf(process.platform === "win32")(
      "documents that doubled backslashes pass on POSIX",
      () => {
        // Mirrors the windows-style-traversal block above: on POSIX,
        // backslashes are not separators so the normalized form does not
        // start with `..` and the path passes.
        expect(() => assertSafePath("foo\\\\..\\\\..\\\\bar", LABEL)).not.toThrow();
      },
    );

    it("rejects mixed slash traversal `foo/../../bar`", () => {
      // `normalize("foo/../../bar")` → `../bar` (one level above CWD).
      // Confirms a multi-segment traversal is caught even when intermediate
      // segments push back into the project root before escaping.
      expect(() => assertSafePath("foo/../../bar", LABEL)).toThrow("Unsafe path");
    });

    it("rejects a null byte after a valid-looking prefix", () => {
      // Null bytes anywhere in the input — not just at the start — are
      // rejected.
      expect(() => assertSafePath("agents/foo\0../../etc/passwd", LABEL)).toThrow("Unsafe path");
    });

    it("rejects a single `..` exactly", () => {
      // Edge: the segment itself, no separators.
      expect(() => assertSafePath("..", LABEL)).toThrow("Unsafe path");
    });

    it("documents that the function never touches the filesystem (symlink-resolution is the caller's job)", () => {
      // assertSafePath is a string check. Even if the named path were a
      // symlink to /etc/passwd, the function would not detect it because
      // it never calls lstat/readlink. This test confirms the contract.
      // A safe-looking relative path passes regardless of any symlink
      // target the filesystem might resolve it to.
      expect(() => assertSafePath("agents/symlink-to-anywhere.md", LABEL)).not.toThrow();
    });
  });
});
