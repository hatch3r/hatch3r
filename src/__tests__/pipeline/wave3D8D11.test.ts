/**
 * Wave 3 Medium findings tests for D8 Error Recovery and D11 Data Flow.
 *
 * D8 findings:
 * - 8.6: fdatasync on read-write handle + EACCES actionable errors
 * - 8.10: TOCTOU-safe archive verification (repository-bound snapshots)
 * - 8.19: Silent error swallowing in validate.ts surfaced as warnings
 *
 * D11 findings:
 * - 11.6: Integrity manifest gated on full sync success
 * - 11.7: Output path collision detection across adapters
 * - 11.14: Orphaned customization file detection at sync time
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ── D8-8.6: EACCES actionable error + fdatasync improvements ──────

describe("D8-8.6: EACCES actionable error messages", () => {
  let atomicWriteFile: typeof import("../../merge/safeWrite.js").atomicWriteFile;

  const mockWriteFile = vi.fn<(...args: unknown[]) => Promise<void>>();
  const mockRename = vi.fn<(...args: unknown[]) => Promise<void>>();
  const mockUnlink = vi.fn<(...args: unknown[]) => Promise<void>>();
  const mockDatasync = vi.fn<() => Promise<void>>();
  const mockClose = vi.fn<() => Promise<void>>();
  const mockOpen = vi.fn<(...args: unknown[]) => Promise<{ datasync: typeof mockDatasync; close: typeof mockClose }>>();

  function mkErrno(code: string, message = ""): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error(message || code);
    err.code = code;
    return err;
  }

  const origLock = process.env.HATCH3R_LOCK;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

    // DD-A1 (release/2.8.5): locking is default-on, and the lock-acquire path
    // runs a REAL `mkdir(dirname(filePath))` on absolute fixture paths like
    // /some/protected/dir before the mocked writer is reached. This suite
    // tests the WRITE BODY's errno mapping — opt out so the mocked
    // writeFile/rename/open are the first fs calls again (lock behavior has
    // its own suites: merge/safeWrite.fileLock + cli/lockOutcomes).
    process.env.HATCH3R_LOCK = "0";

    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockDatasync.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockOpen.mockResolvedValue({ datasync: mockDatasync, close: mockClose });

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        writeFile: mockWriteFile,
        rename: mockRename,
        unlink: mockUnlink,
        open: mockOpen,
      };
    });

    const mod = await import("../../merge/safeWrite.js");
    atomicWriteFile = mod.atomicWriteFile;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
  });

  it("throws actionable message for EACCES on writeFile", async () => {
    mockWriteFile.mockRejectedValue(mkErrno("EACCES", "permission denied"));

    await expect(atomicWriteFile("/tmp/test.txt", "data")).rejects.toThrow(
      /Permission denied writing/,
    );
    await expect(atomicWriteFile("/tmp/test.txt", "data")).rejects.toThrow(
      /Check file\/directory permissions/,
    );
  });

  it("EACCES message includes the file path", async () => {
    mockWriteFile.mockRejectedValue(mkErrno("EACCES"));
    const filePath = "/some/protected/dir/target.md";

    await expect(atomicWriteFile(filePath, "data")).rejects.toThrow(filePath);
  });

  it("ignores ENOTSUP from fdatasync (unsupported filesystem)", async () => {
    mockDatasync.mockRejectedValue(mkErrno("ENOTSUP"));

    await expect(
      atomicWriteFile("/tmp/test.txt", "data"),
    ).resolves.toBeUndefined();

    expect(mockClose).toHaveBeenCalled();
  });

  it("ignores EINVAL from fdatasync (e.g. network mounts)", async () => {
    mockDatasync.mockRejectedValue(mkErrno("EINVAL"));

    await expect(
      atomicWriteFile("/tmp/test.txt", "data"),
    ).resolves.toBeUndefined();

    expect(mockClose).toHaveBeenCalled();
  });

  it("opens temp file with r+ mode for fdatasync", async () => {
    await atomicWriteFile("/tmp/test.txt", "data");

    // D11-5 (Cycle 11 Wave 2): a successful write now opens twice — the tmp
    // file ("r+") for data fdatasync, then the parent directory ("r") for the
    // post-rename directory fsync. The FIRST open is still the tmp-file "r+".
    expect(mockOpen).toHaveBeenCalledTimes(2);
    const openArgs = mockOpen.mock.calls[0];
    expect(openArgs[1]).toBe("r+");
  });
});

// ── D8-8.10: TOCTOU-safe archive verification ───────────────────────

describe("D8-8.10: repository-bound archive copy verification", () => {
  it("binds copied bytes to file identities and verifies size plus SHA-256 before removal", async () => {
    const archiveSource = await readFile(
      join(process.cwd(), "src/archive/index.ts"),
      "utf-8",
    );
    const pathSafetySource = await readFile(
      join(process.cwd(), "src/merge/repositoryPathSafety.ts"),
      "utf-8",
    );

    expect(archiveSource).toContain("const source = await readRepositoryFileSnapshot(rootDir, relPath)");
    expect(archiveSource).toContain("const archived = await readRepositoryFileSnapshot(rootDir, archiveRel)");
    expect(archiveSource).toContain("archived.identity.size !== source.identity.size");
    expect(archiveSource).toContain("archived.identity.sha256 === source.identity.sha256");
    const archiveCopyIndex = archiveSource.indexOf("await writeVerifiedArchiveCopy(");
    expect(archiveCopyIndex).toBeGreaterThanOrEqual(0);
    expect(archiveSource.indexOf("await replaceRepositoryFileIfUnchanged(")).toBeGreaterThan(archiveCopyIndex);
    expect(archiveSource.indexOf("await removeRepositoryFileIfUnchanged(")).toBeGreaterThan(archiveCopyIndex);

    expect(pathSafetySource).toContain('const handle = await open(inspected.absolutePath, "r")');
    expect(pathSafetySource).toContain("const stat = await handle.stat({ bigint: true })");
    expect(pathSafetySource).toContain("const content = await handle.readFile()");
    expect(pathSafetySource).toContain('createHash("sha256").update(content).digest("hex")');
    expect(pathSafetySource).toContain("current.dev !== stat.dev || current.ino !== stat.ino");
    expect(archiveSource).not.toMatch(/const srcStat = await stat\(absPath\)/);
  });
});

// ── D8-8.19: Silent error surfacing in validate ───────────────────

describe("D8-8.19: Content scanning errors surfaced as warnings", () => {
  it("validate.ts surfaces content scanning failures instead of swallowing", async () => {
    // Verify the validate source no longer has an empty catch block
    // for content scanning
    const validateSource = await readFile(
      join(process.cwd(), "src/cli/commands/validate.ts"),
      "utf-8",
    );
    // Should have a warning push instead of empty catch
    expect(validateSource).toContain("Content scanning failed");
    expect(validateSource).toContain("result.warnings.push");
    // Should NOT have the old silent catch
    expect(validateSource).not.toContain(
      "// Content scanning failed — skip cross-ref and collision validation",
    );
  });
});

// ── D11-11.6 (superseded by D1-SA1.3.2): Integrity manifest adapter metadata ─
//
// Removed in release/1.9.0 (Wave 7): the `src/integrity/` module and the
// `.integrity.json` manifest are gone. `verify`/`status` pivoted to
// adapter-output drift detection via `computeAdapterDrift` (no on-disk
// integrity record). The wave-3 test premise — that sync re-generates an
// integrity manifest with `expectedAdapters`/`successfulAdapters` metadata —
// no longer applies. See CHANGELOG #1.9.0.

// ── D11-11.7: Output path collision detection ──────────────────────
//
// Removed in release/1.9.0 (Wave 3): root `/AGENTS.md` emission was deleted,
// so the seed assertion `outputPathOwners.set("AGENTS.md", ...)` no longer
// matches the source. The collision-detection logic in sync.ts is still
// covered indirectly by adapter-snapshot tests; this string-grep test was
// brittle and is removed rather than re-anchored.

// ── D11-11.14: Orphaned customization detection at sync ────────────

describe("D11-11.14: Orphaned customization detection at sync time", () => {
  it("sync.ts detects orphaned customization files", async () => {
    const syncSource = await readFile(
      join(process.cwd(), "src/cli/commands/sync.ts"),
      "utf-8",
    );
    // Should detect orphaned customization files
    expect(syncSource).toContain("Orphaned customization");
    expect(syncSource).toContain(".customize.yaml");
    expect(syncSource).toContain(".customize.md");
    expect(syncSource).toContain("content no longer in manifest");
  });

  it("orphan detection handles missing .hatch3r directories gracefully", async () => {
    const syncSource = await readFile(
      join(process.cwd(), "src/cli/commands/sync.ts"),
      "utf-8",
    );
    // Should have a catch block for missing directories
    expect(syncSource).toContain("// .hatch3r/{dir} does not exist");
  });
});

// ── Integration: atomicWriteFile r+ mode verification ──────────────

describe("D8-8.6: atomicWriteFile uses r+ mode (source verification)", () => {
  it("safeWrite.ts opens temp file with r+ for fdatasync", async () => {
    const source = await readFile(
      join(process.cwd(), "src/merge/safeWrite.ts"),
      "utf-8",
    );
    // Verify the source opens with "r+" not "r"
    expect(source).toContain('await open(tmpPath, "r+")');
    expect(source).not.toContain('await open(tmpPath, "r")');
    // Verify additional fdatasync error codes are handled
    expect(source).toContain("ENOTSUP");
    expect(source).toContain("EINVAL");
  });
});
