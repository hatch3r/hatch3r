import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildReport,
  MigrationError,
  runMigration,
  summarizeStats,
  type MigrationPaths,
} from "../../audit/migrate.js";
import {
  CURRENT_REGISTRY_VERSION,
  RegistryParseError,
  type Finding,
} from "../../audit/registry-schema.js";

const FIXED_DATE = "2026-04-28T00:00:00.000Z";

interface Fixture {
  dir: string;
  paths: MigrationPaths;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "hatch3r-migrate-"));
  await mkdir(join(dir, "governance", "audit"), { recursive: true });
  await mkdir(join(dir, ".audit-workspace"), { recursive: true });
  return {
    dir,
    paths: {
      registry: join(dir, "governance", "audit", "finding-registry.json"),
      legacyPreserve: join(
        dir,
        "governance",
        "audit",
        "finding-registry.legacy.json",
      ),
      anchorLog: join(dir, ".audit-workspace", "registry-anchor-log.jsonl"),
      report: join(dir, ".audit-workspace", "registry-migration-report.md"),
    },
  };
}

function legacyEntry(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "#1",
    domain: "D1: Core",
    severity: "Medium",
    description: "legacy entry",
    disposition: "targeted",
    execution_status: "done",
    ...overrides,
  };
}

function modernEntry(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "C8-D1-M1",
    domain: "D1: Core",
    severity: "High",
    description: "modern entry",
    disposition: "targeted",
    execution_status: "pending",
    confidence: "high",
    causal_chain_depth: 4,
    sources: [],
    execution_tier: 3,
    central_path: false,
    ...overrides,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("runMigration", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    // Best-effort cleanup; tmpdir is fine to leave in test failure cases.
    const { rm } = await import("node:fs/promises");
    try {
      await rm(fx.dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors; OS reaps tmpdir eventually.
    }
  });

  describe("dry-run mode", () => {
    it("returns a result without mutating files", async () => {
      const legacy = [legacyEntry(), modernEntry()];
      await writeFile(fx.paths.registry, JSON.stringify(legacy, null, 2));

      const result = await runMigration({
        paths: fx.paths,
        inPlace: false,
        generatedAt: FIXED_DATE,
      });

      expect(result).not.toBeNull();
      expect(result?.preCount).toBe(2);
      expect(result?.postCount).toBe(2);
      expect(result?.postRegistry.schema_version).toBe(
        CURRENT_REGISTRY_VERSION,
      );
      expect(await fileExists(fx.paths.legacyPreserve)).toBe(false);
      expect(await fileExists(fx.paths.anchorLog)).toBe(false);
      expect(await fileExists(fx.paths.report)).toBe(false);
    });

    it("backfills pre-rigor entries with disposition_note", async () => {
      await writeFile(
        fx.paths.registry,
        JSON.stringify([legacyEntry()], null, 2),
      );
      const result = await runMigration({
        paths: fx.paths,
        inPlace: false,
        generatedAt: FIXED_DATE,
      });
      const entry = result?.postRegistry.entries[0];
      expect(entry?.disposition_note).toBe("pre-rigor-contract");
      expect(entry?.confidence).toBe("medium");
      expect(result?.stats.preRigorBackfilled).toBe(1);
    });
  });

  describe("in-place mode", () => {
    it("preserves the original at the legacy path before overwriting", async () => {
      const legacy = [legacyEntry(), legacyEntry({ finding_id: "#2" })];
      const originalContent = JSON.stringify(legacy, null, 2);
      await writeFile(fx.paths.registry, originalContent);

      await runMigration({
        paths: fx.paths,
        inPlace: true,
        generatedAt: FIXED_DATE,
      });

      const preserved = await readFile(fx.paths.legacyPreserve, "utf-8");
      expect(preserved).toBe(originalContent);
    });

    it("writes a v2 envelope to the registry path atomically", async () => {
      await writeFile(
        fx.paths.registry,
        JSON.stringify([legacyEntry()], null, 2),
      );
      await runMigration({
        paths: fx.paths,
        inPlace: true,
        generatedAt: FIXED_DATE,
      });
      const written = JSON.parse(await readFile(fx.paths.registry, "utf-8"));
      expect(written.schema_version).toBe(CURRENT_REGISTRY_VERSION);
      expect(written.generated_at).toBe(FIXED_DATE);
      expect(written.entries).toHaveLength(1);
    });

    it("appends both pre and post anchor entries to the chain log", async () => {
      await writeFile(
        fx.paths.registry,
        JSON.stringify([legacyEntry()], null, 2),
      );
      await runMigration({
        paths: fx.paths,
        inPlace: true,
        generatedAt: FIXED_DATE,
      });
      const anchorContent = await readFile(fx.paths.anchorLog, "utf-8");
      const lines = anchorContent
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
      expect(lines).toHaveLength(2);
      expect(lines[0].phase).toBe("migration:pre");
      expect(lines[1].phase).toBe("migration:post");
      expect(lines[0].sha256).not.toBe(lines[1].sha256);
      expect(lines[0].entry_count).toBe(1);
      expect(lines[1].entry_count).toBe(1);
      expect(lines[0].timestamp).toBe(FIXED_DATE);
    });

    it("writes a migration report with checksums and stats", async () => {
      await writeFile(
        fx.paths.registry,
        JSON.stringify([legacyEntry()], null, 2),
      );
      await runMigration({
        paths: fx.paths,
        inPlace: true,
        generatedAt: FIXED_DATE,
      });
      const report = await readFile(fx.paths.report, "utf-8");
      expect(report).toContain("# Registry Migration Report");
      expect(report).toContain("pre-migration  (v1)");
      expect(report).toContain("post-migration (v2)");
      expect(report).toContain("pre-rigor backfilled:     1");
    });
  });

  describe("idempotency", () => {
    it("returns null when the registry is already v2", async () => {
      const v2 = {
        schema_version: CURRENT_REGISTRY_VERSION,
        generated_at: FIXED_DATE,
        entries: [modernEntry()],
      };
      await writeFile(fx.paths.registry, JSON.stringify(v2, null, 2));

      const result = await runMigration({
        paths: fx.paths,
        inPlace: true, // even in-place is a no-op
        generatedAt: FIXED_DATE,
      });

      expect(result).toBeNull();
      expect(await fileExists(fx.paths.legacyPreserve)).toBe(false);
      expect(await fileExists(fx.paths.anchorLog)).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws MigrationError on invalid JSON", async () => {
      await writeFile(fx.paths.registry, "{not json");
      await expect(
        runMigration({
          paths: fx.paths,
          inPlace: false,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(MigrationError);
    });

    it("throws RegistryParseError on a non-array, non-envelope root", async () => {
      await writeFile(fx.paths.registry, JSON.stringify({ notARegistry: 1 }));
      await expect(
        runMigration({
          paths: fx.paths,
          inPlace: false,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(RegistryParseError);
    });

    it("does not write any files when validation fails", async () => {
      // Construct a legacy entry that will fail post-migration validation:
      // a tier=1 entry without a tier1_pattern. The migrator does not synthesize
      // tier1_pattern (correctly — no safe default); validation refuses the
      // result; no writes happen.
      const bad = [legacyEntry({ execution_tier: 1, tier1_pattern: null })];
      await writeFile(fx.paths.registry, JSON.stringify(bad, null, 2));

      await expect(
        runMigration({
          paths: fx.paths,
          inPlace: true,
          generatedAt: FIXED_DATE,
        }),
      ).rejects.toThrow(MigrationError);

      expect(await fileExists(fx.paths.legacyPreserve)).toBe(false);
      // Original still intact.
      const original = JSON.parse(await readFile(fx.paths.registry, "utf-8"));
      expect(Array.isArray(original)).toBe(true);
    });
  });

  describe("real-fixture migration round-trip", () => {
    it("end-to-end: migrate a mixed legacy+modern array, validate, re-parse passes", async () => {
      const mixed = [
        legacyEntry({ finding_id: "#1" }),
        legacyEntry({ finding_id: "#2", severity: "High" }),
        modernEntry({ finding_id: "C8-D1-M1" }),
      ];
      await writeFile(fx.paths.registry, JSON.stringify(mixed, null, 2));

      await runMigration({
        paths: fx.paths,
        inPlace: true,
        generatedAt: FIXED_DATE,
      });

      const written = JSON.parse(await readFile(fx.paths.registry, "utf-8"));
      expect(written.schema_version).toBe(CURRENT_REGISTRY_VERSION);
      expect(written.entries).toHaveLength(3);

      // Legacy entries got the grandfather marker.
      const legacyEntries = written.entries.filter(
        (e: Finding) => e.disposition_note === "pre-rigor-contract",
      );
      expect(legacyEntries).toHaveLength(2);

      // Modern entry untouched.
      const modern = written.entries.find(
        (e: Finding) => e.finding_id === "C8-D1-M1",
      );
      expect(modern.disposition_note).toBeUndefined();
      expect(modern.confidence).toBe("high");
    });
  });
});

describe("buildReport / summarizeStats", () => {
  it("buildReport contains both checksums and the legacy-restore command", () => {
    const out = buildReport({
      preSha: "PRE",
      postSha: "POST",
      preCount: 5,
      postCount: 5,
      stats: {
        total: 5,
        preRigorBackfilled: 3,
        tierBackfilled: 5,
        centralPathBackfilled: 5,
        falsePositiveBackfilled: 5,
      },
      generatedAt: FIXED_DATE,
      preEntries: [],
      postEntries: [],
      legacyPreservePath: "/tmp/legacy.json",
      anchorLogPath: "/tmp/anchor.jsonl",
    });
    expect(out).toContain("`PRE`");
    expect(out).toContain("`POST`");
    expect(out).toContain("/tmp/legacy.json");
    expect(out).toContain("Rollback");
  });

  it("summarizeStats reports each backfill class on its own line", () => {
    const out = summarizeStats({
      total: 10,
      preRigorBackfilled: 3,
      tierBackfilled: 7,
      centralPathBackfilled: 2,
      falsePositiveBackfilled: 1,
    });
    expect(out.split("\n")).toHaveLength(5);
    expect(out).toContain("total entries:");
    expect(out).toContain("pre-rigor backfilled:     3");
  });
});
