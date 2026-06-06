import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readdir,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ARCHIVE_DIR } from "../../types.js";

// ───────────────────────────────────────────────────────────────────────────
// D2-22 (archive retention bound) + D2-23 (archive collision), Cycle 11 Wave 3.
//
// D2-22: HATCH3R_MAX_ARCHIVE_ENTRIES is clamped to MAX_ARCHIVE_ENTRIES_CEILING
//   (50) so a large override cannot disable pruning, and pruneArchives enforces
//   an aggregate-byte ceiling (MAX_ARCHIVE_BYTES, 100 MB) mirroring the snapshot
//   store. The byte cap is provoked by a `stat` mock that inflates reported file
//   sizes — the same technique snapshot.errorPaths.test.ts uses — so the test
//   does not write 100 MB to disk.
// D2-23: two same-millisecond archive runs of the SAME tool land in DISTINCT
//   directories (timestamp + `-<pid>-<counter>` suffix), so the second run's
//   overwrite-by-default `cp` cannot clobber the first run's stashed bytes. A
//   Date mock pins both runs to one millisecond.
// ───────────────────────────────────────────────────────────────────────────

describe("pruneArchives — entry-count clamp (D2-22)", () => {
  const origEnv = process.env.HATCH3R_MAX_ARCHIVE_ENTRIES;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-clamp-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origEnv === undefined) delete process.env.HATCH3R_MAX_ARCHIVE_ENTRIES;
    else process.env.HATCH3R_MAX_ARCHIVE_ENTRIES = origEnv;
    vi.resetModules();
  });

  async function seedEntries(tool: string, count: number): Promise<void> {
    const toolPath = join(tempDir, ARCHIVE_DIR, tool);
    await mkdir(toolPath, { recursive: true });
    for (let i = 0; i < count; i++) {
      // Distinct ISO-style timestamps; index encoded so lexical sort is stable.
      const ts = `2026-04-01T00-00-${String(i).padStart(2, "0")}-000Z`;
      await mkdir(join(toolPath, ts), { recursive: true });
      await writeFile(join(toolPath, ts, "snapshot.txt"), `entry-${i}`);
    }
  }

  it("clamps an over-ceiling HATCH3R_MAX_ARCHIVE_ENTRIES to 50 so pruning still runs", async () => {
    // Without the clamp, a value of 100000 makes entries.slice(N) empty and
    // pruning never fires — the unbounded-growth bug. With the clamp the
    // effective retention is 50, so 52 seeded entries leave 50 and prune 2.
    process.env.HATCH3R_MAX_ARCHIVE_ENTRIES = "100000";
    const { pruneArchives, MAX_ARCHIVE_ENTRIES_CEILING } = await import(
      "../../archive/index.js"
    );
    expect(MAX_ARCHIVE_ENTRIES_CEILING).toBe(50);

    await seedEntries("cursor", MAX_ARCHIVE_ENTRIES_CEILING + 2);
    const pruned = await pruneArchives(tempDir);

    expect(pruned).toHaveLength(2);
    const remaining = await readdir(join(tempDir, ARCHIVE_DIR, "cursor"));
    expect(remaining).toHaveLength(MAX_ARCHIVE_ENTRIES_CEILING);
  });

  it("honors a sub-ceiling override (lowers retention)", async () => {
    process.env.HATCH3R_MAX_ARCHIVE_ENTRIES = "3";
    const { pruneArchives } = await import("../../archive/index.js");

    await seedEntries("cursor", 5);
    const pruned = await pruneArchives(tempDir);

    expect(pruned).toHaveLength(2);
    const remaining = await readdir(join(tempDir, ARCHIVE_DIR, "cursor"));
    expect(remaining).toHaveLength(3);
  });
});

describe("pruneArchives — aggregate-byte ceiling (D2-22)", () => {
  let tempDir: string;
  const mockStat = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-bytes-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
    mockStat.mockReset();
  });

  async function seedEntries(tool: string, timestamps: string[]): Promise<void> {
    const realFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const toolPath = join(tempDir, ARCHIVE_DIR, tool);
    await realFs.mkdir(toolPath, { recursive: true });
    for (const ts of timestamps) {
      await realFs.mkdir(join(toolPath, ts), { recursive: true });
      await realFs.writeFile(join(toolPath, ts, "snapshot.txt"), `bytes-${ts}`);
    }
  }

  it("evicts oldest entries until the per-tool total fits under MAX_ARCHIVE_BYTES (count under cap)", async () => {
    // 3 entries (< the default 5-entry cap) each reported as 60 MB -> aggregate
    // 180 MB breaches the 100 MB ceiling. Evicting the 2 oldest drops the
    // survivor total to 60 MB, under the cap. The count cap never fires (3 < 5),
    // proving the byte-cap branch is the one doing the work.
    await seedEntries("cursor", [
      "2026-04-10T00-00-00-000Z",
      "2026-04-11T00-00-00-000Z",
      "2026-04-12T00-00-00-000Z",
    ]);

    const realFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    mockStat.mockImplementation(async (p: string, ...rest: unknown[]) => {
      const real = await realFs.stat(p, ...(rest as []));
      if (real.isFile()) {
        (real as unknown as { size: number }).size = 60_000_000;
      }
      return real;
    });
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return { ...actual, stat: mockStat };
    });

    const { pruneArchives, MAX_ARCHIVE_BYTES } = await import(
      "../../archive/index.js"
    );
    expect(MAX_ARCHIVE_BYTES).toBe(100_000_000);

    const pruned = await pruneArchives(tempDir);

    // Two oldest evicted under the byte ceiling; the newest single entry stays.
    expect(pruned).toContain("cursor/2026-04-10T00-00-00-000Z");
    expect(pruned).toContain("cursor/2026-04-11T00-00-00-000Z");
    expect(pruned).toHaveLength(2);
    const remaining = await readdir(join(tempDir, ARCHIVE_DIR, "cursor"));
    expect(remaining).toEqual(["2026-04-12T00-00-00-000Z"]);
  });

  it("never evicts the single most-recent entry even when it alone exceeds the byte ceiling", async () => {
    // One entry reported as 200 MB — over the cap — but the byte loop stops
    // before index 0, so the newest (only) entry survives. Mirrors
    // pruneSnapshots' last-session guarantee: dropping the rollback a sync run
    // just produced would silently void the recovery promise.
    await seedEntries("cursor", ["2026-04-10T00-00-00-000Z"]);

    const realFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    mockStat.mockImplementation(async (p: string, ...rest: unknown[]) => {
      const real = await realFs.stat(p, ...(rest as []));
      if (real.isFile()) {
        (real as unknown as { size: number }).size = 200_000_000;
      }
      return real;
    });
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return { ...actual, stat: mockStat };
    });

    const { pruneArchives } = await import("../../archive/index.js");
    const pruned = await pruneArchives(tempDir);

    expect(pruned).toEqual([]);
    const remaining = await readdir(join(tempDir, ARCHIVE_DIR, "cursor"));
    expect(remaining).toEqual(["2026-04-10T00-00-00-000Z"]);
  });
});

describe("archiveToolOutputs — same-millisecond collision (D2-23)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-archive-collide-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("two same-tool runs in one millisecond produce distinct archive dirs (no clobber)", async () => {
    // Pin the clock so both runs derive the SAME ISO timestamp; only the
    // `-<pid>-<counter>` suffix distinguishes them. The file is recreated
    // between runs (the first archive removes the source), so each run archives
    // a DIFFERENT payload — proving the second did not overwrite the first.
    // Fake timers keep `new Date()` a real constructor while freezing the clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T00:00:00.000Z"));

    const { archiveToolOutputs } = await import("../../archive/index.js");

    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    await writeFile(join(tempDir, ".cursor", "mcp.json"), "first-run-bytes");
    const r1 = await archiveToolOutputs(tempDir, "cursor");
    expect(r1.archivedFiles).toContain(".cursor/mcp.json");

    // Recreate the source with different content for the second run.
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    await writeFile(join(tempDir, ".cursor", "mcp.json"), "second-run-bytes");
    const r2 = await archiveToolOutputs(tempDir, "cursor");
    expect(r2.archivedFiles).toContain(".cursor/mcp.json");

    // Two distinct archive directories under the same (mocked) timestamp.
    const cursorArchiveRoot = join(tempDir, ARCHIVE_DIR, "cursor");
    const dirs = await readdir(cursorArchiveRoot);
    expect(dirs).toHaveLength(2);
    expect(new Set(dirs).size).toBe(2); // distinct names

    // Each run's distinct bytes survive — the first was NOT clobbered.
    const realFs = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const contents = await Promise.all(
      dirs.map((d) =>
        realFs.readFile(
          join(cursorArchiveRoot, d, ".cursor", "mcp.json"),
          "utf-8",
        ),
      ),
    );
    expect(contents.sort()).toEqual(["first-run-bytes", "second-run-bytes"]);
    // Both archived files exist (no EEXIST, no silent overwrite).
    for (const d of dirs) {
      await expect(
        access(join(cursorArchiveRoot, d, ".cursor", "mcp.json")),
      ).resolves.toBeUndefined();
    }
  });
});
