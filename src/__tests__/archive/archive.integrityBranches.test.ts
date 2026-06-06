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
// Both branches gate `await rm(absPath)` — a same-size-corrupted copy that
// slipped past the size check would otherwise delete the user's only good
// source. The prior coverage gap declined these paths citing a "cannot mock
// node:fs/promises" blocker; this file disproves it with the repo's standard
// `vi.doMock("node:fs/promises", importOriginal)` pattern (the same one
// safeWrite.lockBranches.test.ts and orphanCleanup.errorBranches.test.ts use),
// overriding only `cp` so the destination bytes diverge from the source while
// every other fs primitive stays real.
//
// Each test mocks `cp(src, dest)` to write a controlled destination via the
// real `writeFile`, then asserts archiveToolOutputs rejects AND the source
// file still exists (the rm never ran).
// ───────────────────────────────────────────────────────────────────────────

describe("archiveToolOutputs — integrity-violation branches (mocked cp)", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-integ-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("rejects with FS_ERROR on a size mismatch and leaves the source intact", async () => {
    // A no-managed-block file routes straight to the cp + post-copy validation
    // (the migration branch is skipped), isolating the integrity check.
    const relPath = ".cursor/mcp.json";
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    const sourceAbs = join(tempDir, relPath);
    await writeFile(sourceAbs, JSON.stringify({ mcpServers: { a: 1 } }));

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        // Write a destination that is deliberately SHORTER than the source so
        // destStat.size !== srcStat.size fires the size-mismatch throw before
        // the hash is ever computed.
        cp: vi.fn(async (_src: string, dest: string) => {
          await actual.writeFile(dest, "x");
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

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        // Same byte length, different bytes: the size check passes, the SHA-256
        // comparison fails. This is the corruption class size-only validation
        // would silently accept (disk bit-flip, concurrent writer, network FS).
        cp: vi.fn(async (_src: string, dest: string) => {
          await actual.writeFile(dest, "BBBBBBBBBBBBBBBB"); // 16 bytes, divergent
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
