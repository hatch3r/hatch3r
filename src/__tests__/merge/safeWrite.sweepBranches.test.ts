import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";

// ───────────────────────────────────────────────────────────────────────────
// Remaining branch coverage for src/merge/safeWrite.ts:
//   - safeWriteFile fileExists() non-ENOENT rethrow (line 31 catch in fileExists)
//   - sweepOrphanTmpFiles Dirent parent-path fallbacks (parentPath ?? path ?? dir)
//   - sweepOrphanTmpFiles readdir/unlink non-Error rejection String() branches
//   - formatOrphanTmpSweepDiagnostic `error ?? "unknown"` fallback
// ───────────────────────────────────────────────────────────────────────────

describe("safeWriteFile — fileExists non-ENOENT propagation (mocked access)", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-existserr-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("propagates a non-ENOENT error from access() (e.g. EACCES) instead of treating the file as absent", async () => {
    // fileExists() returns false only for ENOENT; any other errno rethrows.
    // safeWriteFile then surfaces that error rather than silently proceeding
    // down the create path against an inaccessible target.
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        // mkdir must still succeed (called before fileExists in safeWriteFile).
        access: vi.fn().mockRejectedValue(
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        ),
      };
    });

    const { safeWriteFile } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "inaccessible.md");

    await expect(safeWriteFile(filePath, "content")).rejects.toMatchObject({
      code: "EACCES",
    });
  });
});

describe("sweepOrphanTmpFiles — Dirent parent fallbacks + non-Error rejections (mocked node:fs/promises)", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-sweepb-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("falls back to `dir` for the parent when a Dirent exposes neither parentPath nor path", async () => {
    // The parent resolution is `parentPath ?? path ?? dir`. Older Node Dirent
    // shapes (or non-standard fs impls) may expose neither field; the sweep
    // must then join against the scanned `dir`. We hand readdir a synthetic
    // Dirent lacking both, plus a real aged orphan reachable at `dir`.
    const orphanName = "target.md.tmp.deadbeef";

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readdir: vi.fn().mockResolvedValue([
          // No parentPath, no path — forces the `?? dir` fallback.
          { name: orphanName, isFile: () => true },
        ]),
        // stat returns an aged mtime so the orphan passes the 60s gate.
        stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() - 600_000 }),
        unlink: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { sweepOrphanTmpFiles } = await import("../../merge/safeWrite.js");
    const result = await sweepOrphanTmpFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].removed).toBe(true);
    // Parent fell back to `dir`, so the reported path is dir/orphanName.
    expect(result[0].path).toBe(join(tempDir, orphanName));
  });

  it("uses a Dirent `path` field as the parent when parentPath is absent", async () => {
    // The middle fallback: `parentPath ?? path`. Provide only `path`.
    const orphanName = "x.md.tmp.0badf00d";
    const customParent = join(tempDir, "nested");

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readdir: vi.fn().mockResolvedValue([
          { name: orphanName, isFile: () => true, path: customParent },
        ]),
        stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() - 600_000 }),
        unlink: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { sweepOrphanTmpFiles } = await import("../../merge/safeWrite.js");
    const result = await sweepOrphanTmpFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(join(customParent, orphanName));
  });

  it("stringifies a NON-Error readdir rejection in the diagnostic (String() branch) and returns []", async () => {
    // readdir catch: `err instanceof Error ? err.message : String(err)`.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        // Plain object (no .code → not ENOENT, not an Error) → diagnostic via String().
        readdir: vi.fn().mockRejectedValue({ toString: () => "weird-readdir-failure" }),
      };
    });

    try {
      const { sweepOrphanTmpFiles } = await import("../../merge/safeWrite.js");
      const result = await sweepOrphanTmpFiles(tempDir);
      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();
      const msg = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(msg).toContain("orphan-tmp sweep could not read");
      expect(msg).toContain("weird-readdir-failure");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stringifies a NON-Error unlink rejection in the sweep entry error (String() branch)", async () => {
    // unlink catch in the per-file loop: `unlinkErr instanceof Error ? .message : String(...)`.
    const orphanName = "stuck.md.tmp.cafebabe";

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        readdir: vi.fn().mockResolvedValue([
          { name: orphanName, isFile: () => true, parentPath: tempDir },
        ]),
        stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() - 600_000 }),
        unlink: vi.fn().mockRejectedValue({ toString: () => "non-error-unlink" }),
      };
    });

    const { sweepOrphanTmpFiles } = await import("../../merge/safeWrite.js");
    const result = await sweepOrphanTmpFiles(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].removed).toBe(false);
    expect(result[0].error).toBe("non-error-unlink");
  });
});

describe("formatOrphanTmpSweepDiagnostic — unknown-error fallback", () => {
  it("renders 'unknown' for a failed entry that carries no error string", async () => {
    // The failed-section formatter uses `${e.error ?? "unknown"}`.
    const msg = formatOrphanTmpSweepDiagnostic([
      { path: "/tmp/x.md.tmp.ffffffff", mtimeMs: 0, removed: false },
    ]);
    expect(msg).toContain("Failed to remove 1 orphan temp file");
    expect(msg).toContain("/tmp/x.md.tmp.ffffffff");
    expect(msg).toContain("unknown");
  });
});
