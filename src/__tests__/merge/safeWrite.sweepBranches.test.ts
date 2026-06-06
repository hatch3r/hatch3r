import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatOrphanTmpSweepDiagnostic } from "../../merge/safeWrite.js";

// ───────────────────────────────────────────────────────────────────────────
// Remaining branch coverage for src/merge/safeWrite.ts:
//   - safeWriteFile fileExists() non-ENOENT rethrow (line 31 catch in fileExists)
//   - sweepOrphanTmpFiles manual-walk parent derivation (root dir + nested subpath)
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

describe("sweepOrphanTmpFiles — manual-walk parent derivation + non-Error rejections (mocked node:fs/promises)", () => {
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

  // D8-8 (Cycle 11 Wave 3): the sweep walks via an explicit manual stack
  // (`walkTmpCandidates`) that derives a candidate's parent from the directory
  // it is walking, not from Dirent `parentPath`/`path` fields (the prior
  // `readdir({recursive:true})` shape). The parent of a root-level orphan is
  // therefore the scanned `dir`; a nested orphan's parent is the joined subpath.
  it("derives a root-level orphan's parent from the scanned dir (manual-walk, no Dirent.parentPath)", async () => {
    const orphanName = "target.md.tmp.deadbeef";

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        // Synthetic Dirent: a plain file (isDirectory false, isFile true). The
        // walker derives the parent from the dir it is reading, so no parentPath
        // field is consulted.
        readdir: vi.fn().mockResolvedValue([
          { name: orphanName, isDirectory: () => false, isFile: () => true },
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
    expect(result[0].path).toBe(join(tempDir, orphanName));
  });

  it("derives a nested orphan's parent from the joined subdirectory path (recursive manual walk)", async () => {
    const orphanName = "x.md.tmp.0badf00d";
    const subdirName = "nested";

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      const readdirMock = vi.fn(async (path: string) => {
        if (path === tempDir) {
          // Root level: one subdirectory to descend into.
          return [{ name: subdirName, isDirectory: () => true, isFile: () => false }];
        }
        // Inside the subdirectory: the orphan tmp file.
        return [{ name: orphanName, isDirectory: () => false, isFile: () => true }];
      });
      return {
        ...actual,
        readdir: readdirMock as unknown as typeof actual.readdir,
        stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() - 600_000 }),
        unlink: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { sweepOrphanTmpFiles } = await import("../../merge/safeWrite.js");
    const result = await sweepOrphanTmpFiles(tempDir, { recursive: true });

    expect(result).toHaveLength(1);
    // Parent is the joined subdir path the walker descended into.
    expect(result[0].path).toBe(join(tempDir, subdirName, orphanName));
  });

  it("stringifies a NON-Error readdir rejection in the diagnostic (String() branch) and returns []", async () => {
    // Top-level readdir rejects → walkTmpCandidates rethrows → sweepOrphanTmpFiles
    // catch logs `err instanceof Error ? err.message : String(err)` and returns [].
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
          { name: orphanName, isDirectory: () => false, isFile: () => true },
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
