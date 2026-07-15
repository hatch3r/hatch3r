import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveCycle,
  ArchiveError,
  assertHistoryCurrent,
  classifyArchiveArtifact,
  isLiveEntry,
  enumerateAuditArchives,
  rotateAnchorLog,
  type ArchivePaths,
} from "../../audit/archive.js";
import {
  CURRENT_REGISTRY_VERSION,
  type Finding,
  type Registry,
} from "../../audit/registry-schema.js";

const FIXED_DATE = "2026-04-28T00:00:00.000Z";

interface Fixture {
  dir: string;
  paths: ArchivePaths;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "hatch3r-archive-"));
  await mkdir(join(dir, "governance", "audit", "archive"), { recursive: true });
  await mkdir(join(dir, ".audit-workspace"), { recursive: true });
  const archiveDir = join(dir, "governance", "audit", "archive");
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

function modernEntry(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "C8-D1-M1",
    domain: "D1: Core",
    severity: "Medium",
    description: "modern entry",
    disposition: "targeted",
    execution_status: "pending",
    confidence: "medium",
    causal_chain_depth: 4,
    sources: [],
    execution_tier: 3,
    central_path: false,
    cycle: 8,
    ...overrides,
  };
}

function v2Registry(entries: Finding[]): Registry {
  return {
    schema_version: CURRENT_REGISTRY_VERSION,
    generated_at: FIXED_DATE,
    entries,
  };
}

async function writeRegistry(path: string, registry: Registry): Promise<void> {
  await writeFile(path, JSON.stringify(registry, null, 2) + "\n");
}

/* eslint-disable silent-failure/no-silent-catch -- test-helpers: existence
 * probes and tmpdir reap rely on intentional silent fallback. Surfacing
 * diagnostics on every absent-file check or stale-tmpdir reap floods output.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanupFixture(fx: Fixture): Promise<void> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(fx.dir, { recursive: true, force: true });
  } catch {
    // OS reaps tmpdir eventually.
  }
}
/* eslint-enable silent-failure/no-silent-catch */

describe("isLiveEntry — split predicate", () => {
  it("keeps entries with no execution_status (open)", () => {
    const e = modernEntry({ cycle: 1 });
    delete (e as { execution_status?: unknown }).execution_status;
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("keeps entries with execution_status=pending", () => {
    const e = modernEntry({ cycle: 1, execution_status: "pending" });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("keeps terminal entries from the current cycle", () => {
    const e = modernEntry({ cycle: 8, execution_status: "done" });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("keeps terminal entries from the previous cycle", () => {
    const e = modernEntry({ cycle: 7, execution_status: "done" });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("archives terminal entries from older cycles", () => {
    const e = modernEntry({ cycle: 6, execution_status: "done" });
    expect(isLiveEntry(e, 8)).toBe(false);
  });

  it("keeps active rollover stubs across cycles", () => {
    const e = modernEntry({
      cycle: 5,
      execution_status: "done",
      disposition: "rollover",
    });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("keeps partially_promoted with non-deferred status", () => {
    const e = modernEntry({
      cycle: 5,
      execution_status: "done",
      disposition: "partially_promoted",
    });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("archives partially_promoted with deferred status outside window", () => {
    const e = modernEntry({
      cycle: 5,
      execution_status: "deferred",
      disposition: "partially_promoted",
    });
    expect(isLiveEntry(e, 8)).toBe(false);
  });

  it("treats numeric-string cycle (e.g. \"7\") as a number for window comparison", () => {
    // Cycle compared as numeric string "7" with currentCycle 8 → in window {7,8}.
    const e = modernEntry({
      cycle: "7" as unknown as number,
      execution_status: "done",
    });
    expect(isLiveEntry(e, 8)).toBe(true);
  });

  it("archives a numeric-string cycle that falls outside the {N, N-1} window", () => {
    const e = modernEntry({
      cycle: "5" as unknown as number,
      execution_status: "done",
    });
    expect(isLiveEntry(e, 8)).toBe(false);
  });
});

describe("archiveCycle", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  describe("happy path", () => {
    it("splits a v2 registry, writes archive + new live, updates index", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
        modernEntry({ finding_id: "C7-D1-M1", cycle: 7, execution_status: "done" }),
        modernEntry({ finding_id: "C8-D1-M1", cycle: 8, execution_status: "done" }),
        modernEntry({ finding_id: "C8-D1-M2", cycle: 8, execution_status: "pending" }),
      ]);
      await writeRegistry(fx.paths.registry, reg);

      const result = await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
      });

      // C5 archived; C7 (last cycle), C8 (current) stay live.
      expect(result.archivedCount).toBe(1);
      expect(result.livedCount).toBe(3);
      expect(result.archivedEntries[0].finding_id).toBe("C5-D1-M1");

      // Archive file written + content matches sha.
      const archiveContent = await readFile(result.archivePath, "utf-8");
      expect(archiveContent).toContain("\"archived_at_cycle\": 8");
      const archiveJson = JSON.parse(archiveContent);
      expect(archiveJson.entries).toHaveLength(1);
      expect(archiveJson.schema_version).toBe(CURRENT_REGISTRY_VERSION);

      // Live registry shrunk.
      const newLive = JSON.parse(await readFile(fx.paths.registry, "utf-8"));
      expect(newLive.entries).toHaveLength(3);
      expect(
        newLive.entries.map((e: Finding) => e.finding_id).sort(),
      ).toEqual(["C7-D1-M1", "C8-D1-M1", "C8-D1-M2"]);

      // Index manifest updated with sha256.
      const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
      expect(index.archives).toHaveLength(1);
      expect(index.archives[0].cycle).toBe(8);
      expect(index.archives[0].entry_count).toBe(1);
      expect(index.archives[0].sha256).toBe(result.archiveSha256);
      expect(index.archives[0].file).toBe("cycle-8-finding-registry.json");
    });

    it("includes baseline_commit + head_commit in the index entry when provided", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
      ]);
      await writeRegistry(fx.paths.registry, reg);

      await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
        baselineCommit: "abc123",
        headCommit: "def456",
      });
      const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
      expect(index.archives[0].baseline_commit).toBe("abc123");
      expect(index.archives[0].head_commit).toBe("def456");
    });
  });

  describe("dry-run mode", () => {
    it("returns a result without mutating any files", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
      ]);
      const original = JSON.stringify(reg, null, 2) + "\n";
      await writeFile(fx.paths.registry, original);

      const result = await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        dryRun: true,
        generatedAt: FIXED_DATE,
      });

      expect(result.archivedCount).toBe(1);
      expect(await fileExists(result.archivePath)).toBe(false);
      expect(await fileExists(fx.paths.archiveIndex)).toBe(false);

      // Live registry untouched.
      const after = await readFile(fx.paths.registry, "utf-8");
      expect(after).toBe(original);
    });
  });

  describe("input validation", () => {
    it("refuses v1 input with ArchiveError", async () => {
      // v1 = bare array.
      await writeFile(
        fx.paths.registry,
        JSON.stringify([modernEntry()], null, 2),
      );
      await expect(
        archiveCycle({
          paths: fx.paths,
          cycle: 8,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(/v1.*audit:migrate/);
    });

    it("refuses v2 input that fails validation", async () => {
      // tier=1 without tier1_pattern triggers a drift report.
      const bad = modernEntry({ execution_tier: 1, tier1_pattern: null });
      await writeRegistry(fx.paths.registry, v2Registry([bad]));
      await expect(
        archiveCycle({
          paths: fx.paths,
          cycle: 8,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(ArchiveError);
    });

    it("does not write any files when validation fails", async () => {
      const bad = modernEntry({ execution_tier: 1, tier1_pattern: null });
      await writeRegistry(fx.paths.registry, v2Registry([bad]));
      await expect(
        archiveCycle({
          paths: fx.paths,
          cycle: 8,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(ArchiveError);
      expect(await fileExists(fx.paths.archiveIndex)).toBe(false);
      // Live registry intact.
      const stillThere = JSON.parse(
        await readFile(fx.paths.registry, "utf-8"),
      );
      expect(stillThere.entries).toHaveLength(1);
    });
  });

  describe("idempotency", () => {
    it("re-running on already-archived state produces an empty archive", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
        modernEntry({ finding_id: "C8-D1-M1", cycle: 8, execution_status: "done" }),
      ]);
      await writeRegistry(fx.paths.registry, reg);

      const r1 = await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
      });
      expect(r1.archivedCount).toBe(1);
      expect(r1.livedCount).toBe(1);

      const r2 = await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
      });
      expect(r2.archivedCount).toBe(0);
      expect(r2.livedCount).toBe(1);

      // Second run still appends to the index (manifest is append-only audit log).
      const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
      expect(index.archives).toHaveLength(2);
    });

    it("appending second cycle archive does not lose first entry", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
        modernEntry({ finding_id: "C6-D1-M1", cycle: 6, execution_status: "done" }),
      ]);
      await writeRegistry(fx.paths.registry, reg);

      // Archive cycle 7 first (drops C5; keeps C6 as cycle-N-1=6).
      await archiveCycle({
        paths: fx.paths,
        cycle: 7,
        generatedAt: FIXED_DATE,
      });
      // Then cycle 8 (drops C6).
      await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
      });

      const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
      expect(index.archives).toHaveLength(2);
      expect(index.archives[0].cycle).toBe(7);
      expect(index.archives[1].cycle).toBe(8);

      // Each archive file's sha256 in the manifest matches the file content.
      for (const a of index.archives as Array<{ file: string; sha256: string }>) {
        const content = await readFile(
          join(fx.paths.archiveDir, a.file),
          "utf-8",
        );
        const { createHash } = await import("node:crypto");
        const computed = createHash("sha256").update(content).digest("hex");
        expect(computed).toBe(a.sha256);
      }
    });

    it("archive sha256 in result matches the archive file's actual sha256", async () => {
      const reg = v2Registry([
        modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
      ]);
      await writeRegistry(fx.paths.registry, reg);

      const r = await archiveCycle({
        paths: fx.paths,
        cycle: 8,
        generatedAt: FIXED_DATE,
      });
      const content = await readFile(r.archivePath, "utf-8");
      const { createHash } = await import("node:crypto");
      const computed = createHash("sha256").update(content).digest("hex");
      expect(computed).toBe(r.archiveSha256);
    });
  });
});

describe("rotateAnchorLog", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("no-ops when the anchor log does not exist", async () => {
    const r = await rotateAnchorLog(fx.paths, 8);
    expect(r.rotatedTo).toBe("");
    expect(r.keptCount).toBe(0);
  });

  it("keeps last 3 cycles of entries; older entries roll to archive file", async () => {
    const lines = [
      JSON.stringify({ phase: "wave-end", cycle: 3, sha256: "a", entry_count: 1 }),
      JSON.stringify({ phase: "wave-end", cycle: 4, sha256: "b", entry_count: 2 }),
      JSON.stringify({ phase: "wave-end", cycle: 5, sha256: "c", entry_count: 3 }),
      JSON.stringify({ phase: "wave-end", cycle: 6, sha256: "d", entry_count: 4 }),
      JSON.stringify({ phase: "wave-end", cycle: 7, sha256: "e", entry_count: 5 }),
      JSON.stringify({ phase: "wave-end", cycle: 8, sha256: "f", entry_count: 6 }),
    ].join("\n") + "\n";
    await writeFile(fx.paths.anchorLog, lines);

    const r = await rotateAnchorLog(fx.paths, 8);
    // Keep cycle >= 6 (8-2). Live: 6, 7, 8.
    expect(r.keptCount).toBe(3);
    expect(r.rotatedTo).not.toBe("");

    const live = await readFile(fx.paths.anchorLog, "utf-8");
    const liveLines = live.trim().split("\n").map((l) => JSON.parse(l));
    expect(liveLines.map((l) => l.cycle)).toEqual([6, 7, 8]);

    const rolled = await readFile(r.rotatedTo, "utf-8");
    const rolledLines = rolled.trim().split("\n").map((l) => JSON.parse(l));
    expect(rolledLines.map((l) => l.cycle)).toEqual([3, 4, 5]);
  });

  it("preserves entries lacking a parseable cycle (chain-of-custody)", async () => {
    const lines = [
      JSON.stringify({ phase: "migration:pre", sha256: "abc", entry_count: 315 }),
      JSON.stringify({ phase: "migration:post", sha256: "def", entry_count: 315 }),
      JSON.stringify({ phase: "wave-end", cycle: 4, sha256: "ghi", entry_count: 1 }),
      JSON.stringify({ phase: "wave-end", cycle: 8, sha256: "jkl", entry_count: 2 }),
    ].join("\n") + "\n";
    await writeFile(fx.paths.anchorLog, lines);

    await rotateAnchorLog(fx.paths, 8);
    const live = await readFile(fx.paths.anchorLog, "utf-8");
    const liveLines = live.trim().split("\n").map((l) => JSON.parse(l));
    // 2 migration entries (no cycle, kept) + cycle-8 entry.
    expect(liveLines).toHaveLength(3);
    expect(liveLines.map((l) => l.phase)).toContain("migration:pre");
    expect(liveLines.map((l) => l.phase)).toContain("migration:post");
  });

  it("does not roll when no entries are old enough", async () => {
    const lines =
      [
        JSON.stringify({ phase: "wave-end", cycle: 7, sha256: "a", entry_count: 1 }),
        JSON.stringify({ phase: "wave-end", cycle: 8, sha256: "b", entry_count: 2 }),
      ].join("\n") + "\n";
    await writeFile(fx.paths.anchorLog, lines);

    const r = await rotateAnchorLog(fx.paths, 8);
    expect(r.rotatedTo).toBe("");
    expect(r.keptCount).toBe(2);
  });
});

describe("enumerateAuditArchives", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("returns kept files sorted descending by cycle and never cold-archives in Phase 3", async () => {
    // Write a few archive files.
    await writeFile(
      join(fx.paths.archiveDir, "cycle-5-finding-registry.json"),
      "{}",
    );
    await writeFile(
      join(fx.paths.archiveDir, "cycle-7-finding-registry.json"),
      "{}",
    );
    await writeFile(
      join(fx.paths.archiveDir, "cycle-8-finding-registry.json"),
      "{}",
    );
    // A non-cycle file should be ignored.
    await writeFile(join(fx.paths.archiveDir, "index.json"), "{}");

    const r = await enumerateAuditArchives(fx.paths, { keep: 10 });
    expect(r.kept).toEqual([
      "cycle-8-finding-registry.json",
      "cycle-7-finding-registry.json",
      "cycle-5-finding-registry.json",
    ]);
    expect(r.coldArchived).toEqual([]);
  });

  it("returns empty arrays when archive directory does not exist", async () => {
    const { rm } = await import("node:fs/promises");
    await rm(fx.paths.archiveDir, { recursive: true, force: true });

    const r = await enumerateAuditArchives(fx.paths);
    expect(r.kept).toEqual([]);
    expect(r.coldArchived).toEqual([]);
  });
});

describe("archiveCycle — insights ring-buffer integration (Phase 4)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("calls promoteToHistory when insights paths are wired and currentFile exists", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );

    // Pre-existing legacy snapshot (one-cycle shape) — promotion should
    // re-parse it as history[0] and append the just-finished cycle. The
    // current-cycle accumulator carries the required fields validated by
    // promoteToHistory (cycle id, cycle_date, fix_success_rate).
    await writeFile(
      insightsFile,
      JSON.stringify(
        {
          cycle_number: 7,
          cycle_date: "2026-04-19",
          fix_success_rate: { overall: { rate: 1.0 } },
        },
        null,
        2,
      ),
    );
    await writeFile(
      currentInsightsFile,
      JSON.stringify({
        cycle_number: 8,
        cycle_date: FIXED_DATE,
        fix_success_rate: { overall: { rate: 0.9 } },
      }),
    );

    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
      modernEntry({ finding_id: "C8-D1-M1", cycle: 8, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    const result = await archiveCycle({
      paths: { ...fx.paths, insightsFile, currentInsightsFile },
      cycle: 8,
      generatedAt: FIXED_DATE,
    });

    expect(result.insightsPromoted).toBe(true);
    const ring = JSON.parse(await readFile(insightsFile, "utf-8"));
    expect(ring.schema_version).toBe("2.0.0");
    expect(ring.history).toHaveLength(2);
    expect(ring.history[0].cycle_number).toBe(7);
    expect(ring.history[1].cycle_number).toBe(8);
    expect(ring.current).toBeNull();
  });

  it("skips promotion when insights paths are not wired (backward-compat)", async () => {
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    // No insightsFile/currentInsightsFile in the paths — happy-path archive
    // call should record insightsPromoted as undefined and not try to read
    // any insights files.
    const result = await archiveCycle({
      paths: fx.paths,
      cycle: 8,
      generatedAt: FIXED_DATE,
    });
    expect(result.insightsPromoted).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("does NOT call promoteToHistory in dryRun mode even when insights paths are wired", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    await writeFile(
      currentInsightsFile,
      JSON.stringify({ cycle_number: 8, cycle_date: FIXED_DATE }),
    );

    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    const result = await archiveCycle({
      paths: { ...fx.paths, insightsFile, currentInsightsFile },
      cycle: 8,
      dryRun: true,
      generatedAt: FIXED_DATE,
    });
    expect(result.insightsPromoted).toBeUndefined();
    expect(await fileExists(insightsFile)).toBe(false);
  });

  it("records promoted=false (and no warnings) when currentFile is absent", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    // Neither insights file nor currentFile exists — promoteToHistory's
    // documented no-op branch.
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    const result = await archiveCycle({
      paths: { ...fx.paths, insightsFile, currentInsightsFile },
      cycle: 8,
      generatedAt: FIXED_DATE,
    });
    expect(result.insightsPromoted).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it("throws a loud ArchiveError at a real close when strictAccumulator is set and the accumulator is absent (D16-SA16.2-01)", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    // currentInsightsFile deliberately NOT written — the exact cycle-close
    // condition that silently lost telemetry before this gate.
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await expect(
      archiveCycle({
        paths: { ...fx.paths, insightsFile, currentInsightsFile },
        cycle: 8,
        strictAccumulator: true,
        generatedAt: FIXED_DATE,
      }),
    ).rejects.toThrow(ArchiveError);

    // Pre-write abort: the archive file was never written (no partial close).
    expect(
      await fileExists(join(fx.paths.archiveDir, "cycle-8-finding-registry.json")),
    ).toBe(false);
  });

  it("does NOT throw in dryRun even when strictAccumulator is set and the accumulator is absent", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    // A dry-run preview must not fail on a missing accumulator.
    const result = await archiveCycle({
      paths: { ...fx.paths, insightsFile, currentInsightsFile },
      cycle: 8,
      dryRun: true,
      strictAccumulator: true,
      generatedAt: FIXED_DATE,
    });
    expect(result.insightsPromoted).toBeUndefined();
  });
});

describe("archive + finder round-trip", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("entry that leaves live can still be located in the archive file", async () => {
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M3", cycle: 5, execution_status: "done" }),
      modernEntry({ finding_id: "C8-D1-M1", cycle: 8, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await archiveCycle({
      paths: fx.paths,
      cycle: 8,
      generatedAt: FIXED_DATE,
    });

    // Entry no longer in live.
    const live = JSON.parse(await readFile(fx.paths.registry, "utf-8"));
    expect(live.entries.find((e: Finding) => e.finding_id === "C5-D1-M3")).toBeUndefined();

    // But present in the archive file referenced by the manifest.
    const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
    const archiveFile = index.archives[0].file;
    const archive = JSON.parse(
      await readFile(join(fx.paths.archiveDir, archiveFile), "utf-8"),
    );
    expect(
      archive.entries.find((e: Finding) => e.finding_id === "C5-D1-M3"),
    ).toBeDefined();
  });
});

describe("assertHistoryCurrent — cycle-close currency gate", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  function insightsPath(): string {
    return join(fx.dir, "governance", "audit", "execution-insights.json");
  }

  async function writeRing(historyCycles: number[]): Promise<void> {
    const ring = {
      schema_version: "2.0.0",
      current: null,
      history: historyCycles.map((n) => ({
        cycle_number: n,
        cycle_date: "2026-05-29",
        fix_success_rate: { overall: { rate: 1.0 } },
      })),
    };
    await writeFile(insightsPath(), JSON.stringify(ring, null, 2) + "\n");
  }

  it("passes when the newest history entry is current-1", async () => {
    await writeRing([7, 9, 10]);
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(true);
    expect(r.lastCycle).toBe(10);
    expect(r.expectedCycle).toBe(10);
    expect(r.reason).toBe("");
  });

  it("fails (stale) when the newest entry is older than current-1", async () => {
    await writeRing([7]);
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(false);
    expect(r.lastCycle).toBe(7);
    expect(r.expectedCycle).toBe(10);
    expect(r.reason).toMatch(/stale/);
    expect(r.reason).toMatch(/--cycle 11 --in-place/);
  });

  it("fails when history is empty", async () => {
    await writeRing([]);
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(false);
    expect(r.lastCycle).toBeNull();
    expect(r.reason).toMatch(/empty/);
  });

  it("fails when the insights file does not exist (empty ring)", async () => {
    // readInsights returns a fresh empty ring on ENOENT → empty-history branch.
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(false);
    expect(r.lastCycle).toBeNull();
  });

  it("fails when the newest entry has no numeric cycle_number", async () => {
    const ring = {
      schema_version: "2.0.0",
      current: null,
      history: [
        {
          cycle_date: "2026-05-29",
          fix_success_rate: { overall: { rate: 1.0 } },
        },
      ],
    };
    await writeFile(insightsPath(), JSON.stringify(ring, null, 2) + "\n");
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(false);
    expect(r.lastCycle).toBeNull();
    expect(r.reason).toMatch(/no numeric cycle_number/);
  });

  it("accepts a numeric-string cycle_number (e.g. \"10\")", async () => {
    const ring = {
      schema_version: "2.0.0",
      current: null,
      history: [
        {
          cycle_number: "10",
          cycle_date: "2026-05-29",
          fix_success_rate: { overall: { rate: 1.0 } },
        },
      ],
    };
    await writeFile(insightsPath(), JSON.stringify(ring, null, 2) + "\n");
    const r = await assertHistoryCurrent(insightsPath(), 11);
    expect(r.current).toBe(true);
    expect(r.lastCycle).toBe(10);
  });
});

// ── S12-F9: artifact_type enrollment + index round-trip passthrough ──────

describe("classifyArchiveArtifact (S12-F9 vocabulary)", () => {
  it("classifies every archive filename class from the on-disk corpus", () => {
    expect(classifyArchiveArtifact("cycle-12-finding-registry.json")).toBe(
      "finding-registry",
    );
    expect(classifyArchiveArtifact("cycle-7.5-finding-registry.json")).toBe(
      "finding-registry",
    );
    expect(classifyArchiveArtifact("anchor-log-cycle-9.jsonl")).toBe("anchor-log");
    expect(classifyArchiveArtifact("anchor-log-cycle-5-7.jsonl")).toBe("anchor-log");
    expect(classifyArchiveArtifact("cycle-5-8.json.gz")).toBe("cold-pack");
    expect(classifyArchiveArtifact("AUDIT-REPORT-cycle11-backup.md")).toBe("report");
    expect(classifyArchiveArtifact("EVOLVE-REPORT.md")).toBe("report");
    expect(classifyArchiveArtifact("execution-history.md")).toBe("report");
    expect(classifyArchiveArtifact("run-ledger.jsonl")).toBe("ledger");
    expect(classifyArchiveArtifact("verdict-ledger.jsonl")).toBe("ledger");
    expect(classifyArchiveArtifact("evolve-runs.log")).toBe("ledger");
    expect(classifyArchiveArtifact("evolve-b911d8f5")).toBe("evolve-run");
    expect(classifyArchiveArtifact("CL3-edge-case-coverage-cq4-cq5.md")).toBe(
      "proposal",
    );
    expect(classifyArchiveArtifact(".audit-workspace")).toBe("workspace");
    expect(classifyArchiveArtifact("wave-2")).toBe("workspace");
  });

  it("classifies a path by its basename", () => {
    expect(
      classifyArchiveArtifact(
        "governance/audit/archive/cycle-11-finding-registry.json",
      ),
    ).toBe("finding-registry");
  });

  it("falls back to \"other\" for unrecognized names (never invents a class)", () => {
    expect(classifyArchiveArtifact("notes.txt")).toBe("other");
    expect(classifyArchiveArtifact("index.json")).toBe("other");
  });
});

describe("archiveCycle — index artifact_type enrollment + passthrough", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("stamps artifact_type on every NEW index entry (S12-F9)", async () => {
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await archiveCycle({ paths: fx.paths, cycle: 8, generatedAt: FIXED_DATE });

    const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
    expect(index.archives).toHaveLength(1);
    expect(index.archives[0].artifact_type).toBe("finding-registry");
    expect(index.archives[0].file).toBe("cycle-8-finding-registry.json");
  });

  it("preserves legacy UNTYPED entries verbatim while typing the new entry", async () => {
    // Pre-enrollment manifest: an entry without artifact_type (the on-disk
    // shape before S12-F9). The append must not rewrite or backfill it.
    const legacyEntry = {
      cycle: 7,
      file: "cycle-7-finding-registry.json",
      entry_count: 42,
      sha256: "f".repeat(64),
      archived_at: "2026-05-01T00:00:00.000Z",
    };
    await writeFile(
      fx.paths.archiveIndex,
      JSON.stringify(
        {
          schema_version: "1.0.0",
          generated_at: "2026-05-01T00:00:00.000Z",
          archives: [legacyEntry],
        },
        null,
        2,
      ) + "\n",
    );
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await archiveCycle({ paths: fx.paths, cycle: 8, generatedAt: FIXED_DATE });

    const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
    expect(index.archives).toHaveLength(2);
    expect(index.archives[0]).toEqual(legacyEntry);
    expect("artifact_type" in index.archives[0]).toBe(false);
    expect(index.archives[1].artifact_type).toBe("finding-registry");
  });

  it("round-trips unknown top-level index keys (maintainer_relocations) through a cycle close", async () => {
    // Out-of-band maintainer tooling appends top-level keys this module does
    // not model; the cycle-close read→write must not drop them.
    const relocations = [
      { file: "CL3-2026-07-14-model-ladder-effort.md", moved_to: "proposals/" },
    ];
    await writeFile(
      fx.paths.archiveIndex,
      JSON.stringify(
        {
          schema_version: "1.0.0",
          generated_at: "2026-05-01T00:00:00.000Z",
          archives: [],
          maintainer_relocations: relocations,
          future_unknown_key: { keep: true },
        },
        null,
        2,
      ) + "\n",
    );
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await archiveCycle({ paths: fx.paths, cycle: 8, generatedAt: FIXED_DATE });

    const index = JSON.parse(await readFile(fx.paths.archiveIndex, "utf-8"));
    expect(index.maintainer_relocations).toEqual(relocations);
    expect(index.future_unknown_key).toEqual({ keep: true });
    expect(index.archives).toHaveLength(1);
    expect(index.schema_version).toBe("1.0.0");
    expect(index.generated_at).toBe(FIXED_DATE);
  });
});

// ── S12-F1: strict-accumulator close gate regressions ────────────────────

describe("archiveCycle — strict-accumulator positive path (S12-F1)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("completes a strict close when the accumulator IS present (promotion runs)", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    await writeFile(
      currentInsightsFile,
      JSON.stringify({
        cycle_number: 8,
        cycle_date: FIXED_DATE,
        fix_success_rate: { overall: { rate: 0.9 } },
      }),
    );
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    const result = await archiveCycle({
      paths: { ...fx.paths, insightsFile, currentInsightsFile },
      cycle: 8,
      strictAccumulator: true,
      generatedAt: FIXED_DATE,
    });

    expect(result.insightsPromoted).toBe(true);
    expect(
      await fileExists(join(fx.paths.archiveDir, "cycle-8-finding-registry.json")),
    ).toBe(true);
  });

  it("names the --allow-missing-accumulator escape hatch in the strict-gate error", async () => {
    const insightsFile = join(
      fx.dir,
      "governance",
      "audit",
      "execution-insights.json",
    );
    const currentInsightsFile = join(
      fx.dir,
      ".audit-workspace",
      "current-insights.json",
    );
    // Accumulator deliberately absent.
    const reg = v2Registry([
      modernEntry({ finding_id: "C5-D1-M1", cycle: 5, execution_status: "done" }),
    ]);
    await writeRegistry(fx.paths.registry, reg);

    await expect(
      archiveCycle({
        paths: { ...fx.paths, insightsFile, currentInsightsFile },
        cycle: 8,
        strictAccumulator: true,
        generatedAt: FIXED_DATE,
      }),
    ).rejects.toThrow(/--allow-missing-accumulator/);
  });
});
