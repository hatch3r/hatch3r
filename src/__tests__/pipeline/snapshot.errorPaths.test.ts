import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Error-path + defensive-branch coverage for src/pipeline/snapshot.ts, mirroring
// the node:fs/promises mock approach in
// src/__tests__/audit/archive.coldpack.errorPaths.test.ts.
//
// Every mocked fs call delegates to the REAL implementation by default (so the
// function runs against a real tmpdir), and each test surgically overrides one
// call to inject the fault that drives a specific defensive branch. The
// real-fs round-trip and happy-path behavior is exercised in the sibling
// snapshot.test.ts; this file pins the branches a clean real-fs run cannot
// reach:
//   - pruneSnapshots count-cap / byte-cap eviction + corrupt-meta onPrune +
//     prune-failure routing (createSnapshot retention sweep, D6-SA6.4-F5)
//   - removeSessionDir / dirSizeBytes recursion + mid-walk vanish skip
//   - mirrorRelativePath defensive ".." traversal HatchError
//   - withSnapshot environmental-failure downgrade (mutator still runs,
//     sessionId null) vs programming-bug propagation
//   - listSnapshots DEBUG diagnostic on an unreadable meta
//   - applyRollback prepare-phase stat/EACCES/read branches
//   - applyRollback commit-phase failure + roll-forward (rolled-forward,
//     unknown dispositions, roll-forward write failure)
// ---------------------------------------------------------------------------

function mkErrno(code: string, message = ""): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message || code);
  err.code = code;
  return err;
}

// Real modules captured once; the mock factories delegate to them.
const realFs = await vi.importActual<typeof import("node:fs/promises")>(
  "node:fs/promises",
);
const realPath = await vi.importActual<typeof import("node:path")>("node:path");

const mockStat = vi.fn<typeof realFs.stat>();
const mockReadFile = vi.fn<typeof realFs.readFile>();
const mockUnlink = vi.fn<typeof realFs.unlink>();
const mockRmdir = vi.fn<typeof realFs.rmdir>();
const mockAccess = vi.fn<typeof realFs.access>();
const mockMkdir = vi.fn<typeof realFs.mkdir>();
const mockRename = vi.fn<typeof realFs.rename>();
const mockReaddir = vi.fn<typeof realFs.readdir>();
const mockRelative = vi.fn<typeof realPath.relative>();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: (...a: Parameters<typeof actual.stat>) => mockStat(...a),
    readFile: (...a: Parameters<typeof actual.readFile>) => mockReadFile(...a),
    unlink: (...a: Parameters<typeof actual.unlink>) => mockUnlink(...a),
    rmdir: (...a: Parameters<typeof actual.rmdir>) => mockRmdir(...a),
    access: (...a: Parameters<typeof actual.access>) => mockAccess(...a),
    mkdir: (...a: Parameters<typeof actual.mkdir>) => mockMkdir(...a),
    rename: (...a: Parameters<typeof actual.rename>) => mockRename(...a),
    readdir: (...a: Parameters<typeof actual.readdir>) => mockReaddir(...a),
  };
});

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    relative: (...a: Parameters<typeof actual.relative>) => mockRelative(...a),
  };
});

const {
  applyRollback,
  createSnapshot,
  listSnapshots,
  withSnapshot,
  sessionDir,
  snapshotsRoot,
  SNAPSHOT_FILES_DIR,
  SNAPSHOT_META_FILE,
  SNAPSHOT_SCHEMA_VERSION,
  MAX_SNAPSHOT_COUNT,
} = await import("../../pipeline/snapshot.js");

/* eslint-disable silent-failure/no-silent-catch -- test existence probe. */
async function exists(p: string): Promise<boolean> {
  try {
    await realFs.stat(p);
    return true;
  } catch {
    return false;
  }
}
/* eslint-enable silent-failure/no-silent-catch */

/** Write a minimal-but-valid meta.json into a hand-seeded session dir. */
async function seedSession(
  projectRoot: string,
  sessionId: string,
  timestamp: string,
  opts: { paths?: string[]; relativePaths?: string[]; rawMeta?: string } = {},
): Promise<string> {
  const dir = sessionDir(sessionId, projectRoot);
  await realFs.mkdir(join(dir, SNAPSHOT_FILES_DIR), { recursive: true });
  const raw =
    opts.rawMeta ??
    JSON.stringify({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      timestamp,
      paths: opts.paths ?? [],
      relativePaths: opts.relativePaths ?? [],
      projectRoot,
    });
  await realFs.writeFile(join(dir, SNAPSHOT_META_FILE), raw);
  return dir;
}

describe("pipeline/snapshot — error paths and defensive branches", () => {
  let projectRoot: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Default: delegate every mocked call to the real implementation.
    mockStat.mockImplementation((...a) => realFs.stat(...a));
    mockReadFile.mockImplementation((...a) => realFs.readFile(...a));
    mockUnlink.mockImplementation((...a) => realFs.unlink(...a));
    mockRmdir.mockImplementation((...a) => realFs.rmdir(...a));
    mockAccess.mockImplementation((...a) => realFs.access(...a));
    mockMkdir.mockImplementation((...a) => realFs.mkdir(...a));
    mockRename.mockImplementation((...a) => realFs.rename(...a));
    mockReaddir.mockImplementation((...a) => realFs.readdir(...a));
    mockRelative.mockImplementation((...a) => realPath.relative(...a));
    delete process.env.DEBUG;
    projectRoot = await realFs.mkdtemp(join(tmpdir(), "hatch3r-snap-err-"));
  });

  /* eslint-disable silent-failure/no-silent-catch -- tmpdir reap is best-effort. */
  afterEach(async () => {
    delete process.env.DEBUG;
    try {
      await realFs.rm(projectRoot, { recursive: true, force: true });
    } catch {
      // OS reaps tmpdir eventually.
    }
  });
  /* eslint-enable silent-failure/no-silent-catch */

  // ── pruneSnapshots: count cap (D6-SA6.4-F5) ──────────────────────────
  describe("retention prune — count cap", () => {
    it("evicts the oldest sessions over MAX_SNAPSHOT_COUNT and routes a count-cap prune message", async () => {
      // Seed exactly MAX_SNAPSHOT_COUNT pre-existing sessions, oldest→newest by
      // ISO timestamp. A fresh createSnapshot then pushes the store to
      // MAX_SNAPSHOT_COUNT + 1, so the single oldest seeded session is pruned.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const ts = `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(
          i,
        ).padStart(3, "0")}Z`;
        await seedSession(projectRoot, `seed-${String(i).padStart(3, "0")}`, ts);
      }
      const oldest = sessionDir("seed-000", projectRoot);
      expect(await exists(oldest)).toBe(true);

      const fileA = join(projectRoot, "fresh.txt");
      await realFs.writeFile(fileA, "fresh");
      const prunes: string[] = [];
      const result = await createSnapshot("fresh-capture", [fileA], {
        projectRoot,
        onWarn: (m) => prunes.push(m),
      });

      // The capture itself succeeds.
      expect(result.count).toBe(1);
      // The oldest seeded session was removed (removeSessionDir ran).
      expect(await exists(oldest)).toBe(false);
      // The just-captured session is never pruned.
      expect(await exists(result.snapshotPath)).toBe(true);
      // Exactly one count-cap prune message routed through onWarn.
      const countCap = prunes.filter((m) => m.includes(`count cap ${MAX_SNAPSHOT_COUNT}`));
      expect(countCap).toHaveLength(1);
      expect(countCap[0]).toContain("Pruned old snapshot session seed-000");
      expect(countCap[0]).toContain("rollback --session=seed-000");
    });

    it("sorts an unparseable-meta session oldest and surfaces a corrupt-meta diagnostic before pruning it", async () => {
      // One corrupt session (empty timestamp → sorts oldest) plus enough valid
      // sessions to breach the count cap so the prune loop actually runs.
      await seedSession(projectRoot, "corrupt-001", "ignored", {
        rawMeta: "{not valid json",
      });
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        await seedSession(
          projectRoot,
          `ok-${String(i).padStart(3, "0")}`,
          `2027-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        );
      }
      const fileA = join(projectRoot, "x.txt");
      await realFs.writeFile(fileA, "x");
      const msgs: string[] = [];
      await createSnapshot("cap-trigger", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });

      // The corrupt session sorted oldest and was reclaimed first.
      expect(await exists(sessionDir("corrupt-001", projectRoot))).toBe(false);
      // Its unreadable-meta diagnostic was surfaced (not swallowed).
      expect(
        msgs.some(
          (m) =>
            m.includes("corrupt-001") && m.includes("unreadable meta.json"),
        ),
      ).toBe(true);
    });

    it("routes a prune-failure diagnostic (not a throw) when removeSessionDir cannot delete a session", async () => {
      // Breach the count cap, then make rmdir reject for the oldest session so
      // its removal fails. The capture must still succeed — a janitorial
      // failure never downgrades a snapshot-capture success.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        await seedSession(
          projectRoot,
          `s-${String(i).padStart(3, "0")}`,
          `2026-03-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(
            i,
          ).padStart(3, "0")}Z`,
        );
      }
      const oldestDir = sessionDir("s-000", projectRoot);
      mockRmdir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(oldestDir)) {
          return Promise.reject(mkErrno("EACCES", "rmdir denied"));
        }
        return realFs.rmdir(p, ...rest);
      });
      // unlink would empty the dir before rmdir; let it proceed normally so the
      // failure is isolated to the rmdir call the prune relies on.
      const fileA = join(projectRoot, "y.txt");
      await realFs.writeFile(fileA, "y");
      const msgs: string[] = [];
      const result = await createSnapshot("prune-fail", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });

      expect(result.count).toBe(1);
      expect(
        msgs.some(
          (m) => m.includes("Failed to prune snapshot session s-000") && m.includes("rmdir denied"),
        ),
      ).toBe(true);
    });
  });

  // ── pruneSnapshots: byte cap (D6-SA6.4-F5) ───────────────────────────
  describe("retention prune — byte cap", () => {
    it("evicts the oldest session for the size ceiling and routes a size-cap prune message", async () => {
      // Two seeded sessions, well under the count cap. A stat mock reports each
      // captured/seeded file as 60 MB so the aggregate (>120 MB) breaches
      // MAX_SNAPSHOT_BYTES (100 MB) while count stays at 3 (< 50). The oldest
      // seeded session is evicted; the byte-cap reason wins because count is OK.
      await seedSession(projectRoot, "big-old", "2026-04-01T00:00:00.000Z", {
        relativePaths: ["old.txt"],
      });
      await realFs.writeFile(
        join(sessionDir("big-old", projectRoot), SNAPSHOT_FILES_DIR, "old.txt"),
        "old-bytes",
      );
      await seedSession(projectRoot, "big-mid", "2026-04-02T00:00:00.000Z", {
        relativePaths: ["mid.txt"],
      });
      await realFs.writeFile(
        join(sessionDir("big-mid", projectRoot), SNAPSHOT_FILES_DIR, "mid.txt"),
        "mid-bytes",
      );

      // Report every regular file as 60 MB so the byte ceiling is breached.
      mockStat.mockImplementation(async (p, ...rest) => {
        const real = await realFs.stat(p, ...(rest as []));
        if (real.isFile()) {
          (real as unknown as { size: number }).size = 60_000_000;
        }
        return real;
      });

      const fileA = join(projectRoot, "z.txt");
      await realFs.writeFile(fileA, "z");
      const msgs: string[] = [];
      const result = await createSnapshot("byte-cap", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });

      expect(result.count).toBe(1);
      // The oldest seeded session was evicted under the byte ceiling.
      expect(await exists(sessionDir("big-old", projectRoot))).toBe(false);
      const sizeCap = msgs.filter((m) => m.includes("size cap") && m.includes("bytes"));
      expect(sizeCap.length).toBeGreaterThanOrEqual(1);
      expect(sizeCap[0]).toContain("Pruned old snapshot session big-old");
    });

    it("never prunes the single most-recent session even when it alone exceeds the byte ceiling", async () => {
      // Only the just-captured session exists. dirSizeBytes (via the stat mock)
      // reports it as 200 MB — over the cap — but the prune loop's
      // `aged.length - 1` upper bound protects the last (only) session.
      mockStat.mockImplementation(async (p, ...rest) => {
        const real = await realFs.stat(p, ...(rest as []));
        if (real.isFile()) {
          (real as unknown as { size: number }).size = 200_000_000;
        }
        return real;
      });
      const fileA = join(projectRoot, "lonely.txt");
      await realFs.writeFile(fileA, "lonely");
      const msgs: string[] = [];
      const result = await createSnapshot("lonely-cap", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });
      expect(result.count).toBe(1);
      // The just-captured (and only) session survives.
      expect(await exists(result.snapshotPath)).toBe(true);
      expect(msgs.filter((m) => m.includes("Pruned old snapshot session"))).toEqual([]);
    });
  });

  // ── dirSizeBytes / removeSessionDir recursion + vanish skip ──────────
  describe("recursive helpers (dirSizeBytes / removeSessionDir)", () => {
    it("sums nested files and tolerates a file vanishing mid-walk during size accounting", async () => {
      // Breach the count cap with sessions that contain NESTED files so
      // dirSizeBytes recurses into a subdirectory. For the oldest session, make
      // stat reject ENOENT for the nested file (vanished mid-walk) — the sweep
      // must skip it (not abort) and still prune the session.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `nest-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        const nestedDir = join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "sub");
        await realFs.mkdir(nestedDir, { recursive: true });
        await realFs.writeFile(join(nestedDir, "deep.txt"), "deep");
      }
      const vanishingFile = join(
        sessionDir("nest-000", projectRoot),
        SNAPSHOT_FILES_DIR,
        "sub",
        "deep.txt",
      );
      mockStat.mockImplementation((p, ...rest) => {
        if (p === vanishingFile) return Promise.reject(mkErrno("ENOENT"));
        return realFs.stat(p, ...rest);
      });

      const fileA = join(projectRoot, "trigger.txt");
      await realFs.writeFile(fileA, "trigger");
      const result = await createSnapshot("nest-trigger", [fileA], { projectRoot });

      expect(result.count).toBe(1);
      // The oldest nested session was fully removed despite the mid-walk vanish.
      expect(await exists(sessionDir("nest-000", projectRoot))).toBe(false);
    });

    it("rethrows a non-ENOENT stat error encountered while sizing a session", async () => {
      // A hard stat failure (EACCES) during dirSizeBytes is not benign — it must
      // propagate out of createSnapshot rather than be swallowed as a 0-byte dir.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `acc-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2026-06-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        await realFs.writeFile(
          join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "f.txt"),
          "f",
        );
      }
      const blockedFile = join(
        sessionDir("acc-000", projectRoot),
        SNAPSHOT_FILES_DIR,
        "f.txt",
      );
      mockStat.mockImplementation((p, ...rest) => {
        if (p === blockedFile) return Promise.reject(mkErrno("EACCES", "stat blocked"));
        return realFs.stat(p, ...rest);
      });
      const fileA = join(projectRoot, "boom.txt");
      await realFs.writeFile(fileA, "boom");
      await expect(
        createSnapshot("boom-capture", [fileA], { projectRoot }),
      ).rejects.toThrow("stat blocked");
    });

    it("tolerates an ENOENT unlink (file vanished mid-remove) while pruning a session", async () => {
      // Breach the count cap, then make unlink of the oldest session's files
      // reject ENOENT (a concurrent cleanup removed them first). removeSessionDir
      // must swallow ENOENT and still rmdir the now-empty session — the capture
      // succeeds and the session is gone.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `unl-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2025-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        await realFs.writeFile(
          join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "f.txt"),
          "f",
        );
      }
      const oldestDir = sessionDir("unl-000", projectRoot);
      mockUnlink.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(oldestDir)) {
          // Remove for real, THEN report ENOENT so the post-real-delete rmdir of
          // the (now-empty) dir still succeeds and the catch's ENOENT arm runs.
          return realFs
            .unlink(p, ...rest)
            .then(() => Promise.reject(mkErrno("ENOENT")));
        }
        return realFs.unlink(p, ...rest);
      });
      const fileA = join(projectRoot, "u.txt");
      await realFs.writeFile(fileA, "u");
      const result = await createSnapshot("unl-trigger", [fileA], { projectRoot });
      expect(result.count).toBe(1);
      expect(await exists(oldestDir)).toBe(false);
    });

    it("routes a prune-failure diagnostic when a session-file unlink fails with a non-ENOENT error", async () => {
      // A non-ENOENT unlink failure inside removeSessionDir is NOT benign: it
      // rethrows out of removeSessionDir, the prune() try/catch converts it to a
      // routed diagnostic, and the capture still succeeds.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `unf-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2025-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        await realFs.writeFile(
          join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "f.txt"),
          "f",
        );
      }
      const oldestDir = sessionDir("unf-000", projectRoot);
      mockUnlink.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(oldestDir)) {
          return Promise.reject(mkErrno("EPERM", "unlink locked"));
        }
        return realFs.unlink(p, ...rest);
      });
      const fileA = join(projectRoot, "uf.txt");
      await realFs.writeFile(fileA, "uf");
      const msgs: string[] = [];
      const result = await createSnapshot("unf-trigger", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });
      expect(result.count).toBe(1);
      expect(
        msgs.some(
          (m) =>
            m.includes("Failed to prune snapshot session unf-000") && m.includes("unlink locked"),
        ),
      ).toBe(true);
    });

    it("tolerates an ENOENT readdir (session vanished after enumeration) without aborting the sweep", async () => {
      // listSessionDirs enumerates the sessions at the root, then a concurrent
      // cleanup removes the oldest session dir before dirSizeBytes /
      // removeSessionDir walk into it. Both helpers' readdir-ENOENT arms must
      // treat it as 0 bytes / a no-op removal rather than throwing, so the
      // capture still lands and no prune-failure diagnostic is emitted for it.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        await seedSession(
          projectRoot,
          `rd-${String(i).padStart(3, "0")}`,
          `2025-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
      }
      const oldestDir = sessionDir("rd-000", projectRoot);
      // The ROOT readdir (listSessionDirs) still enumerates rd-000, but every
      // readdir of the rd-000 session dir (and below) reports ENOENT — the
      // dir vanished between enumeration and the walk. This drives the
      // readdir-ENOENT arm in dirSizeBytes AND removeSessionDir.
      mockReaddir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(oldestDir)) {
          return Promise.reject(mkErrno("ENOENT")) as ReturnType<typeof realFs.readdir>;
        }
        return realFs.readdir(p, ...rest);
      });
      const fileA = join(projectRoot, "rd.txt");
      await realFs.writeFile(fileA, "rd");
      const msgs: string[] = [];
      const result = await createSnapshot("rd-trigger", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });
      // Capture succeeded; the vanished session did not abort the sweep.
      expect(result.count).toBe(1);
      // No prune-FAILURE diagnostic for rd-000 (the ENOENT was benign, not an error).
      expect(msgs.some((m) => m.includes("Failed to prune snapshot session rd-000"))).toBe(false);
    });

    it("rethrows a non-ENOENT readdir error while sizing a session subdir", async () => {
      // A hard (non-ENOENT) readdir failure inside dirSizeBytes is NOT benign:
      // it must propagate out of the capture rather than be treated as a 0-byte
      // dir. Reject readdir of the oldest session's files/ subdir with EACCES.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `szx-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2025-11-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        await realFs.writeFile(
          join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "f.txt"),
          "f",
        );
      }
      const oldestFilesDir = join(sessionDir("szx-000", projectRoot), SNAPSHOT_FILES_DIR);
      mockReaddir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p === oldestFilesDir) {
          return Promise.reject(mkErrno("EACCES", "readdir size denied")) as ReturnType<
            typeof realFs.readdir
          >;
        }
        return realFs.readdir(p, ...rest);
      });
      const fileA = join(projectRoot, "szx.txt");
      await realFs.writeFile(fileA, "szx");
      await expect(
        createSnapshot("szx-trigger", [fileA], { projectRoot }),
      ).rejects.toThrow("readdir size denied");
    });

    it("routes a prune-failure diagnostic when removeSessionDir's readdir fails with a non-ENOENT error", async () => {
      // removeSessionDir's readdir throwing a non-ENOENT error rethrows out of
      // removeSessionDir; prune()'s try/catch converts it to a routed failure
      // diagnostic and the capture still succeeds. dirSizeBytes is left intact
      // (stat-based on the files), so only the removal readdir is faulted.
      for (let i = 0; i < MAX_SNAPSHOT_COUNT; i++) {
        const sid = `rmx-${String(i).padStart(3, "0")}`;
        await seedSession(
          projectRoot,
          sid,
          `2025-12-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.${String(i).padStart(3, "0")}Z`,
        );
        await realFs.writeFile(
          join(sessionDir(sid, projectRoot), SNAPSHOT_FILES_DIR, "f.txt"),
          "f",
        );
      }
      const oldestDir = sessionDir("rmx-000", projectRoot);
      const oldestFilesDir = join(oldestDir, SNAPSHOT_FILES_DIR);
      // dirSizeBytes also calls readdir(oldestDir)/readdir(oldestFilesDir); to
      // isolate the FAILURE to removeSessionDir we reject ONLY after the first
      // (sizing) pass. dirSizeBytes(oldestDir) reads oldestDir then oldestFilesDir;
      // removeSessionDir(oldestDir) reads them again. Fault the 3rd+ readdir of
      // the oldest dir (the removal pass) with EACCES.
      let oldestDirReads = 0;
      mockReaddir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && (p === oldestDir || p === oldestFilesDir)) {
          oldestDirReads += 1;
          // First two reads (dirSizeBytes: dir + files/) succeed; the removal
          // pass (read #3 onward) fails non-ENOENT.
          if (oldestDirReads > 2) {
            return Promise.reject(mkErrno("EACCES", "readdir rm denied")) as ReturnType<
              typeof realFs.readdir
            >;
          }
        }
        return realFs.readdir(p, ...rest);
      });
      const fileA = join(projectRoot, "rmx.txt");
      await realFs.writeFile(fileA, "rmx");
      const msgs: string[] = [];
      const result = await createSnapshot("rmx-trigger", [fileA], {
        projectRoot,
        onWarn: (m) => msgs.push(m),
      });
      expect(result.count).toBe(1);
      expect(
        msgs.some(
          (m) => m.includes("Failed to prune snapshot session rmx-000") && m.includes("readdir rm denied"),
        ),
      ).toBe(true);
    });
  });

  // ── listSnapshots / listSessionDirs root readdir failure ─────────────
  describe("listSessionDirs root readdir failure", () => {
    it("propagates a non-ENOENT readdir error on the snapshot root out of listSnapshots", async () => {
      // listSessionDirs returns [] on ENOENT (first-run), but a hard readdir
      // failure of the root (EACCES) is not first-run — it must propagate so the
      // caller sees the real I/O fault instead of an empty list.
      const root = snapshotsRoot(projectRoot);
      await realFs.mkdir(root, { recursive: true });
      mockReaddir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p === root) {
          return Promise.reject(mkErrno("EACCES", "root readdir denied")) as ReturnType<
            typeof realFs.readdir
          >;
        }
        return realFs.readdir(p, ...rest);
      });
      await expect(listSnapshots({ projectRoot })).rejects.toThrow("root readdir denied");
    });
  });

  // ── mirrorRelativePath defensive ".." traversal guard ────────────────
  describe("mirrorRelativePath traversal guard", () => {
    it("throws a VALIDATION_ERROR HatchError when relative() yields an interior '..' segment", async () => {
      // `relative()` collapses traversal on a real fs, so the defensive in-tree
      // ".." check is unreachable without forcing the function to return a path
      // that does NOT start with ".." yet contains an interior ".." segment.
      const fileA = join(projectRoot, "trap.txt");
      await realFs.writeFile(fileA, "trap");
      mockRelative.mockImplementation((from, to) => {
        // A literal interior ".." segment that does NOT start with ".." and is
        // not absolute — the exact shape the in-tree defensive guard catches.
        // Built with the real path.sep so it splits into a "../" segment.
        if (to === fileA) return ["inside", "..", "escape.txt"].join(realPath.sep);
        return realPath.relative(from, to);
      });
      const err = await createSnapshot("traversal", [fileA], { projectRoot }).then(
        () => {
          throw new Error("expected createSnapshot to reject with a traversal HatchError");
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/refusing to snapshot path with traversal/);
      expect((err as { errorCode?: string }).errorCode).toBe("VALIDATION_ERROR");
    });
  });

  // ── withSnapshot environmental downgrade vs programming-bug propagate ─
  describe("withSnapshot snapshot-capture failure handling", () => {
    it("downgrades an environmental capture failure to a warning, still runs the mutator, and returns null sessionId", async () => {
      // Force createSnapshot's first disk write to fail with a non-validation
      // (environmental) error. Per the doc contract this downgrades to a
      // warning, the mutator still runs, and the returned sessionId is null so
      // the caller suppresses its "revert with: …" line.
      const fileA = join(projectRoot, "wire-env.txt");
      await realFs.writeFile(fileA, "env-original");
      // mkdir(filesDir) is the first write createSnapshot performs; reject it
      // with an environmental (non-VALIDATION) errno.
      const filesPrefix = snapshotsRoot(projectRoot);
      mockMkdir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(filesPrefix)) {
          return Promise.reject(mkErrno("EACCES", "snapshot dir not writable"));
        }
        return realFs.mkdir(p, ...rest);
      });

      let mutatorRan = false;
      const warns: string[] = [];
      const out = await withSnapshot(
        "sync",
        [fileA],
        async (sessionId) => {
          mutatorRan = true;
          expect(sessionId).toBeNull();
          return "mutated" as const;
        },
        {
          projectRoot,
          now: () => new Date("2026-07-01T00:00:00.000Z"),
          onWarn: (m) => warns.push(m),
        },
      );

      expect(mutatorRan).toBe(true);
      expect(out.result).toBe("mutated");
      expect(out.sessionId).toBeNull();
      expect(out.snapshotPath).toBeNull();
      expect(out.count).toBe(0);
      expect(
        warns.some(
          (m) => m.includes("Pre-mutation snapshot failed") && m.includes("snapshot dir not writable"),
        ),
      ).toBe(true);
    });

    it("routes the environmental-failure warning through console.warn when no onWarn is supplied", async () => {
      const fileA = join(projectRoot, "wire-env2.txt");
      await realFs.writeFile(fileA, "env2");
      const filesPrefix = snapshotsRoot(projectRoot);
      mockMkdir.mockImplementation((p, ...rest) => {
        if (typeof p === "string" && p.startsWith(filesPrefix)) {
          return Promise.reject(mkErrno("EROFS", "read-only fs"));
        }
        return realFs.mkdir(p, ...rest);
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const out = await withSnapshot(
        "init",
        [fileA],
        async () => "ok" as const,
        { projectRoot, now: () => new Date("2026-07-02T00:00:00.000Z") },
      );

      expect(out.result).toBe("ok");
      expect(out.sessionId).toBeNull();
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes("Pre-mutation snapshot failed")),
      ).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // ── listSnapshots DEBUG diagnostic ───────────────────────────────────
  describe("listSnapshots DEBUG diagnostic", () => {
    it("logs an unreadable-meta diagnostic to console.error when DEBUG is set", async () => {
      const dir = sessionDir("dbg-broken", projectRoot);
      await realFs.mkdir(dir, { recursive: true });
      await realFs.writeFile(join(dir, SNAPSHOT_META_FILE), "{still not json");
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.DEBUG = "1";

      const out = await listSnapshots({ projectRoot });

      expect(out).toEqual([]);
      expect(
        errSpy.mock.calls.some(
          (c) => String(c[0]).includes("dbg-broken") && String(c[0]).includes("meta unreadable"),
        ),
      ).toBe(true);
      errSpy.mockRestore();
    });
  });

  // ── applyRollback prepare-phase branches ─────────────────────────────
  describe("applyRollback prepare-phase error branches", () => {
    it("records a stat error (non-ENOENT) on the tombstone probe as a prepare failure and aborts", async () => {
      const futurePath = join(projectRoot, "ghost.txt");
      const snap = await createSnapshot("rb-stat", [futurePath], { projectRoot });
      const tombstone = join(
        snap.snapshotPath,
        SNAPSHOT_FILES_DIR,
        "ghost.txt.tombstone",
      );
      // stat(tombstone) rejects with EACCES (not ENOENT) → prepare records the
      // error and the live rollback aborts with everything mutated-still.
      mockStat.mockImplementation((p, ...rest) => {
        if (p === tombstone) return Promise.reject(mkErrno("EACCES", "tombstone stat denied"));
        return realFs.stat(p, ...rest);
      });

      const result = await applyRollback("rb-stat", { projectRoot });
      expect(result.filesRestored).toBe(0);
      expect(result.errors.some((e) => /aborted/.test(e))).toBe(true);
      expect(result.errors.some((e) => /tombstone stat denied/.test(e))).toBe(true);
      expect((result.dispositions ?? []).every((d) => d.state === "mutated-still")).toBe(true);
    });

    it("records a tombstone parent-not-writable EACCES as a prepare failure", async () => {
      const futurePath = join(projectRoot, "victim.txt");
      await createSnapshot("rb-tomb-eacces", [futurePath], { projectRoot });
      // access(dirname(target), W_OK) rejects with EACCES (not ENOENT) for the
      // tombstone's parent → entry.error set, live rollback aborts.
      mockAccess.mockImplementation((p, ...rest) => {
        if (p === projectRoot) return Promise.reject(mkErrno("EACCES", "parent ro"));
        return realFs.access(p, ...rest);
      });

      const result = await applyRollback("rb-tomb-eacces", { projectRoot });
      expect(result.filesRestored).toBe(0);
      expect(result.errors.some((e) => /parent not writable/.test(e))).toBe(true);
      expect(result.errors.some((e) => /parent ro/.test(e))).toBe(true);
    });

    it("treats a tombstone parent ENOENT as benign (missing parent = target already absent)", async () => {
      const futurePath = join(projectRoot, "missing-parent", "child.txt");
      await createSnapshot("rb-tomb-enoent", [futurePath], { projectRoot });
      // access(dirname(target)) rejects ENOENT → benign, entry has no error, the
      // tombstone restore is a clean no-op (target already absent).
      const parent = join(projectRoot, "missing-parent");
      mockAccess.mockImplementation((p, ...rest) => {
        if (p === parent) return Promise.reject(mkErrno("ENOENT"));
        return realFs.access(p, ...rest);
      });

      const result = await applyRollback("rb-tomb-enoent", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      expect(result.dispositions?.[0].state).toBe("original-restored");
    });

    it("records a regular-entry destination-not-writable EACCES as a prepare failure", async () => {
      const fileA = join(projectRoot, "reg.txt");
      await realFs.writeFile(fileA, "orig");
      await createSnapshot("rb-dest-eacces", [fileA], { projectRoot });
      await realFs.writeFile(fileA, "mut");
      // The regular entry's mkdir+access(dirname, W_OK) rejects with EACCES.
      mockAccess.mockImplementation((p, ...rest) => {
        if (p === projectRoot) return Promise.reject(mkErrno("EACCES", "dest ro"));
        return realFs.access(p, ...rest);
      });

      const result = await applyRollback("rb-dest-eacces", { projectRoot });
      expect(result.filesRestored).toBe(0);
      expect(result.errors.some((e) => /destination not writable/.test(e))).toBe(true);
      expect(result.errors.some((e) => /dest ro/.test(e))).toBe(true);
      // Disk untouched — still holds the mutation.
      expect(await realFs.readFile(fileA, "utf-8")).toBe("mut");
    });

    it("surfaces a prepare-phase stat error in dry-run mode as a mutated-still disposition", async () => {
      const futurePath = join(projectRoot, "dry-ghost.txt");
      const snap = await createSnapshot("rb-dry-stat", [futurePath], { projectRoot });
      const tombstone = join(
        snap.snapshotPath,
        SNAPSHOT_FILES_DIR,
        "dry-ghost.txt.tombstone",
      );
      mockStat.mockImplementation((p, ...rest) => {
        if (p === tombstone) return Promise.reject(mkErrno("EIO", "io error"));
        return realFs.stat(p, ...rest);
      });

      const result = await applyRollback("rb-dry-stat", { dryRun: true, projectRoot });
      // Dry-run reports zero clean restores and surfaces the prepare error.
      expect(result.filesRestored).toBe(0);
      expect(result.errors.some((e) => /io error/.test(e))).toBe(true);
      expect(result.dispositions?.[0].state).toBe("mutated-still");
      expect(result.dispositions?.[0].error).toMatch(/io error/);
    });
  });

  // ── applyRollback commit-phase failure + roll-forward ────────────────
  describe("applyRollback commit-phase failure and roll-forward (all-or-nothing)", () => {
    it("rolls a successfully-applied entry FORWARD to its pre-rollback bytes when a later commit write fails", async () => {
      // Two regular entries. Both prepare cleanly (mirror readable, parent
      // writable). At commit time entry B's atomicWriteFile fails — we make B's
      // target a non-empty directory so the tmp→target rename throws. That trips
      // commitFailedAt, and the already-restored entry A is rolled forward to
      // its pre-rollback (mutated) bytes — net all-or-nothing.
      const fileA = join(projectRoot, "roll-a.txt");
      const fileB = join(projectRoot, "roll-b.txt");
      await realFs.writeFile(fileA, "orig A");
      await realFs.writeFile(fileB, "orig B");
      await createSnapshot("rb-rollfwd", [fileA, fileB], { projectRoot });
      // Mutate A, then replace B's file with a non-empty directory.
      await realFs.writeFile(fileA, "mut A");
      await realFs.rm(fileB);
      await realFs.mkdir(fileB, { recursive: true });
      await realFs.writeFile(join(fileB, "blocker.txt"), "blocks rename");

      const result = await applyRollback("rb-rollfwd", { projectRoot });

      // Net: the rollback failed all-or-nothing — at least one error, and A was
      // rolled forward (not left restored).
      expect(result.errors.length).toBeGreaterThan(0);
      const dispA = (result.dispositions ?? []).find((d) => d.target === fileA);
      const dispB = (result.dispositions ?? []).find((d) => d.target === fileB);
      expect(dispA?.state).toBe("rolled-forward");
      expect(dispB?.state).toBe("mutated-still");
      // filesRestored decremented back: A was restored then rolled forward.
      expect(result.filesRestored).toBe(0);
      // A is back to its pre-rollback (mutated) bytes on disk.
      expect(await realFs.readFile(fileA, "utf-8")).toBe("mut A");
    });

    it("re-deletes an entry that was absent pre-rollback when rolling forward after a commit failure", async () => {
      // Entry A is a TOMBSTONE for a path that did NOT exist pre-run; at rollback
      // time A exists (created during the run) so the tombstone restore deletes
      // it. Entry B then fails at commit. Roll-forward of A must RE-CREATE it to
      // its pre-rollback bytes (snap.bytes !== null path is the file-present
      // case; here we cover the snap.bytes === null re-delete branch by making A
      // a regular restore of a file that was absent pre-rollback).
      //
      // Concretely: A is a regular entry whose target is ABSENT at rollback time
      // (mutatedSnaps records bytes:null). Restoring A creates the file; the
      // later B failure rolls A forward by re-deleting it (snap.bytes === null).
      const fileA = join(projectRoot, "recreate-a.txt");
      const fileB = join(projectRoot, "recreate-b.txt");
      await realFs.writeFile(fileA, "orig A");
      await realFs.writeFile(fileB, "orig B");
      await createSnapshot("rb-redelete", [fileA, fileB], { projectRoot });
      // A is removed before rollback → at commit, pre-rollback bytes of A are
      // null, so roll-forward re-deletes the file the restore created.
      await realFs.rm(fileA);
      // B becomes a non-empty dir so its commit write fails.
      await realFs.rm(fileB);
      await realFs.mkdir(fileB, { recursive: true });
      await realFs.writeFile(join(fileB, "blocker.txt"), "blocks");

      const result = await applyRollback("rb-redelete", { projectRoot });

      expect(result.errors.length).toBeGreaterThan(0);
      const dispA = (result.dispositions ?? []).find((d) => d.target === fileA);
      expect(dispA?.state).toBe("rolled-forward");
      // A was re-deleted (absent pre-rollback) → still absent after roll-forward.
      expect(await exists(fileA)).toBe(false);
    });

    it("marks an applied entry UNKNOWN when its pre-rollback bytes were unreadable", async () => {
      // Two entries. A restores fine. We make the pre-rollback read of A's target
      // fail with a non-ENOENT error so mutatedSnaps records {unreadable:true}.
      // Then B fails at commit → roll-forward of A cannot proceed → disposition
      // UNKNOWN with the "cannot roll forward" message.
      const fileA = join(projectRoot, "unk-a.txt");
      const fileB = join(projectRoot, "unk-b.txt");
      await realFs.writeFile(fileA, "orig A");
      await realFs.writeFile(fileB, "orig B");
      await createSnapshot("rb-unknown", [fileA, fileB], { projectRoot });
      await realFs.writeFile(fileA, "mut A");
      // B → non-empty dir so its commit write fails.
      await realFs.rm(fileB);
      await realFs.mkdir(fileB, { recursive: true });
      await realFs.writeFile(join(fileB, "blocker.txt"), "blocks");

      // The ONLY readFile of fileA target happens in the commit pre-snapshot
      // loop (prepare reads the snapshot mirror, not the target). Reject that
      // one with EACCES so the pre-rollback bytes are unreadable.
      mockReadFile.mockImplementation((p, ...rest) => {
        if (p === fileA) return Promise.reject(mkErrno("EACCES", "target unreadable"));
        return realFs.readFile(p, ...rest);
      });

      const result = await applyRollback("rb-unknown", { projectRoot });

      const dispA = (result.dispositions ?? []).find((d) => d.target === fileA);
      expect(dispA?.state).toBe("unknown");
      expect(dispA?.error).toMatch(/pre-rollback bytes unreadable; cannot roll forward/);
    });

    it("records UNKNOWN with a roll-forward error when the roll-forward write itself fails", async () => {
      // A restores fine; its pre-rollback bytes are readable (file present). B
      // fails at commit → roll-forward of A runs atomicWriteFile back to A's
      // mutated bytes. We make THAT write fail (rename onto a path turned into a
      // dir between commit and roll-forward) so the disposition is UNKNOWN with a
      // "roll-forward failed" error.
      const fileA = join(projectRoot, "rfw-a.txt");
      const fileB = join(projectRoot, "rfw-b.txt");
      await realFs.writeFile(fileA, "orig A");
      await realFs.writeFile(fileB, "orig B");
      await createSnapshot("rb-rfw-fail", [fileA, fileB], { projectRoot });
      await realFs.writeFile(fileA, "mut A");
      await realFs.rm(fileB);
      await realFs.mkdir(fileB, { recursive: true });
      await realFs.writeFile(join(fileB, "blocker.txt"), "blocks");

      // Let the commit-phase atomicWriteFile to A succeed (restore), then make
      // the roll-forward atomicWriteFile to A fail. atomicWriteFile renames
      // <A>.tmp.<hex> → A. Reject the rename for A after the first successful
      // restore so only the roll-forward write fails.
      let renameCount = 0;
      mockRename.mockImplementation((from, to, ...rest) => {
        if (typeof to === "string" && to === fileA) {
          renameCount += 1;
          // First rename (commit restore of A) succeeds; second (roll-forward) fails.
          if (renameCount >= 2) {
            return Promise.reject(mkErrno("EIO", "roll-forward rename failed"));
          }
        }
        return realFs.rename(from, to, ...rest);
      });

      const result = await applyRollback("rb-rfw-fail", { projectRoot });

      const dispA = (result.dispositions ?? []).find((d) => d.target === fileA);
      expect(dispA?.state).toBe("unknown");
      expect(dispA?.error).toMatch(/roll-forward failed for/);
      expect(result.errors.some((e) => /roll-forward/.test(e))).toBe(true);
    });

    it("swallows an ENOENT during a re-delete roll-forward (target already gone) and reports rolled-forward", async () => {
      // A was absent pre-rollback (snap.bytes === null) → restore creates it,
      // then a B commit failure rolls A forward by re-deleting it. Make that
      // re-delete unlink reject ENOENT (a concurrent process already removed A):
      // the catch's ENOENT arm swallows it, and A's disposition stays
      // rolled-forward (the all-or-nothing intent is satisfied — A is gone).
      const fileA = join(projectRoot, "rd-a.txt");
      const fileB = join(projectRoot, "rd-b.txt");
      await realFs.writeFile(fileA, "orig A");
      await realFs.writeFile(fileB, "orig B");
      await createSnapshot("rb-redelete-enoent", [fileA, fileB], { projectRoot });
      await realFs.rm(fileA); // absent pre-rollback → snap.bytes === null
      await realFs.rm(fileB);
      await realFs.mkdir(fileB, { recursive: true });
      await realFs.writeFile(join(fileB, "blocker.txt"), "blocks");

      // The ONLY direct unlink(fileA) (no .tmp suffix) is the roll-forward
      // re-delete; reject it ENOENT. Tombstone/atomic-write tmp unlinks are
      // unaffected (they carry the .tmp.<hex> suffix or target other paths).
      mockUnlink.mockImplementation((p, ...rest) => {
        if (p === fileA) return Promise.reject(mkErrno("ENOENT"));
        return realFs.unlink(p, ...rest);
      });

      const result = await applyRollback("rb-redelete-enoent", { projectRoot });

      const dispA = (result.dispositions ?? []).find((d) => d.target === fileA);
      expect(dispA?.state).toBe("rolled-forward");
      // No roll-forward error recorded for A — the ENOENT was benign.
      expect(dispA?.error).toBeUndefined();
    });
  });

  // ── createSnapshot capture-time error branches ───────────────────────
  describe("createSnapshot directory input + capture read failure", () => {
    it("rethrows a non-ENOENT error encountered while reading a file to capture it", async () => {
      // A file that exists at capture time but whose readFile fails with a hard
      // (non-ENOENT) error must propagate — it is not a "file absent" tombstone
      // case. ENOENT → tombstone (covered elsewhere); EACCES → throw.
      const fileA = join(projectRoot, "locked.txt");
      await realFs.writeFile(fileA, "secret");
      mockReadFile.mockImplementation((p, ...rest) => {
        if (p === fileA) return Promise.reject(mkErrno("EACCES", "read denied"));
        return realFs.readFile(p, ...rest);
      });
      await expect(
        createSnapshot("cap-read-fail", [fileA], { projectRoot }),
      ).rejects.toThrow("read denied");
    });

    it("records a tombstone (not a byte copy) when an input path is an existing directory", async () => {
      // A path that exists and is a directory must be tombstoned, not copied
      // byte-for-byte — so a later rollback can remove whatever file the
      // orchestrator places at that path without descending the whole tree.
      const subdir = join(projectRoot, "a-real-dir");
      await realFs.mkdir(subdir, { recursive: true });
      await realFs.writeFile(join(subdir, "inner.txt"), "inner");

      const result = await createSnapshot("dir-tomb", [subdir], { projectRoot });
      expect(result.count).toBe(1);
      // A .tombstone sentinel was written for the directory mirror; no byte copy.
      const tombstone = join(result.snapshotPath, SNAPSHOT_FILES_DIR, "a-real-dir.tombstone");
      expect(await exists(tombstone)).toBe(true);
      expect(await exists(join(result.snapshotPath, SNAPSHOT_FILES_DIR, "a-real-dir", "inner.txt"))).toBe(
        false,
      );
    });
  });
});
