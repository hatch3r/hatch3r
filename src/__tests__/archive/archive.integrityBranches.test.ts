import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ───────────────────────────────────────────────────────────────────────────
// D3-16 (D3 Medium, Cycle 11 Wave 3): post-copy integrity-violation branch
// coverage for src/archive/index.ts::archiveToolOutputs that the real-fs
// suite cannot reach deterministically:
//   - size-mismatch throw  (destStat.size !== srcStat.size)
//   - content-mismatch throw (sizes equal, SHA-256 digests differ)
// Both branches gate verified source removal — a same-size-corrupted copy that
// slipped past the size check would otherwise delete the user's only good
// source. The tests use the repo's standard `vi.doMock(..., importOriginal)`
// pattern, overriding only the archive
// destination snapshot metadata while every filesystem primitive stays real.
//
// Each test asserts archiveToolOutputs rejects AND the source file still exists.
// ───────────────────────────────────────────────────────────────────────────

describe("archiveToolOutputs — integrity-violation branches", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-integ-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("../../merge/repositoryPathSafety.js");
    vi.resetModules();
  });

  it("rejects with FS_ERROR on a size mismatch and leaves the source intact", async () => {
    // A no-managed-block file routes straight to the archive + validation
    // (the migration branch is skipped), isolating the integrity check.
    const relPath = ".cursor/mcp.json";
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    const sourceAbs = join(tempDir, relPath);
    await writeFile(sourceAbs, JSON.stringify({ mcpServers: { a: 1 } }));

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        readRepositoryFileSnapshot: vi.fn(async (rootDir: string, path: string) => {
          const snapshot = await actual.readRepositoryFileSnapshot(rootDir, path);
          return path.startsWith(".hatch3r-archive/")
            ? { ...snapshot, identity: { ...snapshot.identity, size: snapshot.identity.size + 1 } }
            : snapshot;
        }),
      };
    });

    const { archiveToolOutputs } = await import("../../archive/index.js");

    await expect(archiveToolOutputs(tempDir, "cursor")).rejects.toMatchObject({
      errorCode: "FS_ERROR",
      message: expect.stringContaining("size mismatch"),
    });

    // The source must NOT have been removed — `rm(absPath)` sits after the
    // integrity gate, so a failed validation must preserve the user's copy.
    await expect(access(sourceAbs)).resolves.toBeUndefined();
  });

  it("rejects with FS_ERROR on a same-size content mismatch and leaves the source intact", async () => {
    const relPath = ".cursor/mcp.json";
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    const sourceAbs = join(tempDir, relPath);
    const sourceBytes = "AAAAAAAAAAAAAAAA"; // 16 bytes
    await writeFile(sourceAbs, sourceBytes);

    vi.doMock("../../merge/repositoryPathSafety.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../merge/repositoryPathSafety.js")>();
      return {
        ...actual,
        readRepositoryFileSnapshot: vi.fn(async (rootDir: string, path: string) => {
          const snapshot = await actual.readRepositoryFileSnapshot(rootDir, path);
          return path.startsWith(".hatch3r-archive/")
            ? { ...snapshot, identity: { ...snapshot.identity, sha256: "0".repeat(64) } }
            : snapshot;
        }),
      };
    });

    const { archiveToolOutputs } = await import("../../archive/index.js");

    await expect(archiveToolOutputs(tempDir, "cursor")).rejects.toMatchObject({
      errorCode: "FS_ERROR",
      message: expect.stringContaining("content mismatch"),
    });

    // Source preserved, and its bytes are untouched (not the corrupted copy).
    await expect(access(sourceAbs)).resolves.toBeUndefined();
    expect(await readFile(sourceAbs, "utf-8")).toBe(sourceBytes);
  });
});
