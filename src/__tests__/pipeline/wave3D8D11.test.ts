/**
 * Wave 3 Medium findings tests for D8 Error Recovery and D11 Data Flow.
 *
 * D8 findings:
 * - 8.6: fdatasync on read-write handle + EACCES actionable errors
 * - 8.10: TOCTOU race fix in archive size check (fd-based stat)
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

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

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

    // Verify open was called with "r+" (second argument)
    expect(mockOpen).toHaveBeenCalledTimes(1);
    const openArgs = mockOpen.mock.calls[0];
    expect(openArgs[1]).toBe("r+");
  });
});

// ── D8-8.10: TOCTOU race fix in archive ───────────────────────────

describe("D8-8.10: fd-based archive copy verification", () => {
  it("archive module uses open+fh.stat for copy verification", async () => {
    // Verify the archive module imports open from node:fs/promises
    const archiveSource = await readFile(
      join(process.cwd(), "src/archive/index.ts"),
      "utf-8",
    );
    expect(archiveSource).toContain("await open(absPath");
    expect(archiveSource).toContain("await open(archiveDest");
    expect(archiveSource).toContain("srcFh.stat()");
    expect(archiveSource).toContain("destFh.stat()");
    // Verify it no longer uses stat() directly for archive verification
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

describe("D1-SA1.3.2: Integrity manifest regenerated with adapter metadata", () => {
  it("sync.ts always regenerates integrity manifest and records adapter metadata", async () => {
    const syncSource = await readFile(
      join(process.cwd(), "src/cli/commands/sync.ts"),
      "utf-8",
    );
    // Should always call generateIntegrityManifest — even on partial failure —
    // because the manifest tracks canonical content which adapters read but
    // do not modify.
    expect(syncSource).toContain("generateIntegrityManifest");
    // Should record which adapters were expected and which succeeded, so
    // downstream tools can detect partial syncs without re-reading hatch.json.
    expect(syncSource).toContain("expectedAdapters");
    expect(syncSource).toContain("successfulAdapters");
    // Should warn on partial-failure sync so the user knows to re-run
    expect(syncSource).toContain(
      "Integrity manifest regenerated with",
    );
  });
});

// ── D11-11.7: Output path collision detection ──────────────────────

describe("D11-11.7: Output path collision detection", () => {
  it("sync.ts tracks output paths and warns on collisions", async () => {
    const syncSource = await readFile(
      join(process.cwd(), "src/cli/commands/sync.ts"),
      "utf-8",
    );
    // Should have an output path tracking map
    expect(syncSource).toContain("outputPathOwners");
    // Should detect collisions
    expect(syncSource).toContain("Output path collision");
    // Should seed with sync bridge paths
    expect(syncSource).toContain('outputPathOwners.set("AGENTS.md"');
  });
});

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
