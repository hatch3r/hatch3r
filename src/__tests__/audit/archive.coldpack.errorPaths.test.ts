import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Error-path + defensive-branch coverage for coldPackAuditArchives, mirroring
// the node:fs/promises mock approach in
// src/__tests__/merge/safeWrite.errorPaths.test.ts.
//
// Every mock delegates to the REAL implementation by default (so the function
// runs against a real tmpdir), and each test surgically overrides one call to
// inject the fault that drives a specific defensive branch:
//   - fdatasync EPERM tolerated / non-EPERM rethrow (atomicWriteBinary)
//   - tmp-file unlink non-ENOENT diagnostic (atomicWriteBinary finally)
//   - verification round-trip failure (gunzip throw) → originals preserved
//   - partial-bundle unlink failure during the !verified cleanup
// ---------------------------------------------------------------------------

function mkErrno(code: string, message = ""): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message || code);
  err.code = code;
  return err;
}

// Real module captured once; the mock factory delegates to it.
const realFs = await vi.importActual<typeof import("node:fs/promises")>(
  "node:fs/promises",
);
const realZlib = await vi.importActual<typeof import("node:zlib")>("node:zlib");

const mockUnlink = vi.fn<typeof realFs.unlink>();
const mockOpen = vi.fn<typeof realFs.open>();
const mockReadFile = vi.fn<typeof realFs.readFile>();
const mockGunzipSync = vi.fn<typeof realZlib.gunzipSync>();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: (...a: Parameters<typeof actual.unlink>) => mockUnlink(...a),
    open: (...a: Parameters<typeof actual.open>) => mockOpen(...a),
    readFile: (...a: Parameters<typeof actual.readFile>) => mockReadFile(...a),
  };
});

vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return {
    ...actual,
    gunzipSync: (...a: Parameters<typeof actual.gunzipSync>) =>
      mockGunzipSync(...a),
  };
});

import {
  coldPackAuditArchives,
  type ArchivePaths,
} from "../../audit/archive.js";

interface Fixture {
  dir: string;
  paths: ArchivePaths;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await realFs.mkdtemp(join(tmpdir(), "hatch3r-coldpack-err-"));
  const archiveDir = join(dir, "governance", "audit", "archive");
  await realFs.mkdir(archiveDir, { recursive: true });
  return {
    dir,
    paths: {
      registry: join(dir, "governance", "audit", "finding-registry.json"),
      archiveDir,
      archiveIndex: join(archiveDir, "index.json"),
      anchorLog: join(dir, ".audit-workspace", "registry-anchor-log.jsonl"),
      anchorArchiveDir: archiveDir,
    },
  };
}

async function writeCycle(fx: Fixture, cycle: number): Promise<void> {
  await realFs.writeFile(
    join(fx.paths.archiveDir, `cycle-${cycle}-finding-registry.json`),
    `{"cycle":${cycle}}`,
  );
}

/* eslint-disable silent-failure/no-silent-catch -- test existence probe. */
async function exists(path: string): Promise<boolean> {
  try {
    await realFs.stat(path);
    return true;
  } catch {
    return false;
  }
}
/* eslint-enable silent-failure/no-silent-catch */

describe("coldPackAuditArchives — error paths and defensive branches", () => {
  let fx: Fixture;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Default: delegate every mocked call to the real implementation.
    mockUnlink.mockImplementation((...a) => realFs.unlink(...a));
    mockOpen.mockImplementation((...a) => realFs.open(...a));
    mockReadFile.mockImplementation((...a) => realFs.readFile(...a));
    mockGunzipSync.mockImplementation((...a) => realZlib.gunzipSync(...a));
    fx = await makeFixture();
    await writeCycle(fx, 5);
    await writeCycle(fx, 6);
    await writeCycle(fx, 7);
  });

  /* eslint-disable silent-failure/no-silent-catch -- tmpdir reap is best-effort;
   * the OS reclaims the temp dir eventually, so a failed rm needs no diagnostic. */
  afterEach(async () => {
    try {
      await realFs.rm(fx.dir, { recursive: true, force: true });
    } catch {
      // OS reaps tmpdir eventually.
    }
  });
  /* eslint-enable silent-failure/no-silent-catch */

  // ── fdatasync fallback (atomicWriteBinary) ──────────────────────────
  describe("fdatasync fallback inside atomicWriteBinary", () => {
    it("tolerates EPERM from datasync and still packs (best-effort durability)", async () => {
      mockOpen.mockImplementation(async (...a) => {
        const fh = await realFs.open(...(a as Parameters<typeof realFs.open>));
        // Override datasync on the real handle to reject with EPERM.
        (fh as unknown as { datasync: () => Promise<void> }).datasync = () =>
          Promise.reject(mkErrno("EPERM"));
        return fh;
      });

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.bundlePath).not.toBeNull();
      expect(r.coldArchived).toEqual([
        "cycle-6-finding-registry.json",
        "cycle-5-finding-registry.json",
      ]);
    });

    it("rethrows a non-EPERM/ENOTSUP/EINVAL datasync error (e.g. EIO)", async () => {
      mockOpen.mockImplementation(async (...a) => {
        const fh = await realFs.open(...(a as Parameters<typeof realFs.open>));
        (fh as unknown as { datasync: () => Promise<void> }).datasync = () =>
          Promise.reject(mkErrno("EIO", "disk failure"));
        return fh;
      });

      await expect(
        coldPackAuditArchives(fx.paths, { keep: 1 }),
      ).rejects.toThrow("disk failure");
    });
  });

  // ── tmp-file cleanup diagnostic (atomicWriteBinary finally) ─────────
  describe("tmp-file cleanup diagnostic", () => {
    it("emits a console.error when the tmp-file unlink fails with non-ENOENT", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Reject unlink of the `.tmp.<hex>` working file with EPERM; let every
      // other unlink (the packed originals) proceed normally.
      mockUnlink.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && /\.tmp\.[0-9a-f]{8}$/.test(p)) {
          return Promise.reject(mkErrno("EPERM", "tmp locked"));
        }
        return realFs.unlink(p, ...rest);
      });

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      // The pack still succeeds (rename already moved the tmp into place; the
      // failed cleanup is a leftover-tmp diagnostic, not a write failure).
      expect(r.bundlePath).not.toBeNull();
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes("failed to remove temp file"),
        ),
      ).toBe(true);
    });

    it("does NOT emit a diagnostic when the tmp-file unlink fails with ENOENT", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockUnlink.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && /\.tmp\.[0-9a-f]{8}$/.test(p)) {
          return Promise.reject(mkErrno("ENOENT"));
        }
        return realFs.unlink(p, ...rest);
      });

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.bundlePath).not.toBeNull();
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes("failed to remove temp file"),
        ),
      ).toBe(false);
    });
  });

  // ── verification failure → preservation-first ───────────────────────
  describe("verification round-trip failure preserves originals", () => {
    it("leaves all originals intact and removes the partial bundle when gunzip throws", async () => {
      mockGunzipSync.mockImplementation(() => {
        throw new Error("simulated gunzip corruption");
      });

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.coldArchived).toEqual([]);
      expect(r.bundlePath).toBeNull();
      expect(r.kept).toEqual([
        "cycle-7-finding-registry.json",
        "cycle-6-finding-registry.json",
        "cycle-5-finding-registry.json",
      ]);
      // Originals survive; partial bundle was removed.
      for (const c of [5, 6, 7]) {
        expect(
          await exists(
            join(fx.paths.archiveDir, `cycle-${c}-finding-registry.json`),
          ),
        ).toBe(true);
      }
      expect(
        await exists(join(fx.paths.archiveDir, "cold", "cycle-5-6.json.gz")),
      ).toBe(false);
    });

    it("fails verification (no throw) when the bundle content does not round-trip to the originals", async () => {
      // gunzip returns a structurally valid bundle whose `files` omit the
      // packed names → the `toPack.every(...)` check returns false.
      mockGunzipSync.mockImplementation(() =>
        Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            packedAtCycleLow: 5,
            packedAtCycleHigh: 6,
            files: {},
          }),
          "utf-8",
        ),
      );

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.coldArchived).toEqual([]);
      expect(r.bundlePath).toBeNull();
      // Originals preserved.
      expect(
        await exists(
          join(fx.paths.archiveDir, "cycle-5-finding-registry.json"),
        ),
      ).toBe(true);
    });

    it("emits a console.error when the partial-bundle unlink also fails (non-ENOENT)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockGunzipSync.mockImplementation(() => {
        throw new Error("simulated gunzip corruption");
      });
      // Reject the bundle (.json.gz) unlink with EPERM so the verification-fail
      // cleanup hits its diagnostic branch. Originals are never unlinked on this
      // path, so routing by suffix is sufficient.
      mockUnlink.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.endsWith(".json.gz")) {
          return Promise.reject(mkErrno("EPERM", "bundle locked"));
        }
        return realFs.unlink(p, ...rest);
      });

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.coldArchived).toEqual([]);
      expect(r.bundlePath).toBeNull();
      expect(
        errorSpy.mock.calls.some((c) =>
          String(c[0]).includes("partial bundle could not be removed"),
        ),
      ).toBe(true);
      // Originals still intact despite the cleanup hiccup.
      expect(
        await exists(
          join(fx.paths.archiveDir, "cycle-5-finding-registry.json"),
        ),
      ).toBe(true);
    });
  });
});
