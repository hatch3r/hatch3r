import { mkdtemp, mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  coldPackAuditArchives,
  type ArchivePaths,
} from "../../audit/archive.js";

interface Fixture {
  dir: string;
  paths: ArchivePaths;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "hatch3r-coldpack-"));
  const archiveDir = join(dir, "governance", "audit", "archive");
  await mkdir(archiveDir, { recursive: true });
  await mkdir(join(dir, ".audit-workspace"), { recursive: true });
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

/* eslint-disable silent-failure/no-silent-catch -- test helpers: existence
 * probes and tmpdir reap rely on intentional silent fallback. */
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

/** Write a cycle archive file with deterministic, recognizable content. */
async function writeCycleArchive(
  fx: Fixture,
  cycle: number,
  body = `{"cycle":${cycle},"marker":"content-${cycle}"}`,
): Promise<string> {
  const name = `cycle-${cycle}-finding-registry.json`;
  await writeFile(join(fx.paths.archiveDir, name), body);
  return name;
}

describe("coldPackAuditArchives", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  describe("(a) keep >= file count → no bundle, all kept, originals intact", () => {
    it("keep equal to file count packs nothing", async () => {
      await writeCycleArchive(fx, 5);
      await writeCycleArchive(fx, 6);
      await writeCycleArchive(fx, 7);

      const r = await coldPackAuditArchives(fx.paths, { keep: 3 });

      expect(r.bundlePath).toBeNull();
      expect(r.coldArchived).toEqual([]);
      expect(r.kept).toEqual([
        "cycle-7-finding-registry.json",
        "cycle-6-finding-registry.json",
        "cycle-5-finding-registry.json",
      ]);
      // No cold/ directory was created and every original is still on disk.
      expect(await fileExists(join(fx.paths.archiveDir, "cold"))).toBe(false);
      for (const c of [5, 6, 7]) {
        expect(
          await fileExists(
            join(fx.paths.archiveDir, `cycle-${c}-finding-registry.json`),
          ),
        ).toBe(true);
      }
    });

    it("keep greater than file count packs nothing", async () => {
      await writeCycleArchive(fx, 5);
      const r = await coldPackAuditArchives(fx.paths, { keep: 10 });
      expect(r.bundlePath).toBeNull();
      expect(r.coldArchived).toEqual([]);
      expect(r.kept).toEqual(["cycle-5-finding-registry.json"]);
    });

    it("ignores non-cycle files (index.json) when counting", async () => {
      await writeCycleArchive(fx, 5);
      await writeCycleArchive(fx, 6);
      await writeFile(join(fx.paths.archiveDir, "index.json"), "{}");
      // 2 cycle files, keep 2 → nothing to pack even though 3 files exist.
      const r = await coldPackAuditArchives(fx.paths, { keep: 2 });
      expect(r.bundlePath).toBeNull();
      expect(r.coldArchived).toEqual([]);
    });
  });

  describe("(b) more files than keep → bundle created, older packed, kept loose", () => {
    it("packs the older files into cycle-{A}-{B}.json.gz and removes their originals", async () => {
      await writeCycleArchive(fx, 5);
      await writeCycleArchive(fx, 6);
      await writeCycleArchive(fx, 7);
      await writeCycleArchive(fx, 8);

      const r = await coldPackAuditArchives(fx.paths, { keep: 2 });

      // Kept = 2 newest (descending): 8, 7.
      expect(r.kept).toEqual([
        "cycle-8-finding-registry.json",
        "cycle-7-finding-registry.json",
      ]);
      // Packed = older remainder: 6, 5 (still descending order).
      expect(r.coldArchived).toEqual([
        "cycle-6-finding-registry.json",
        "cycle-5-finding-registry.json",
      ]);

      // Bundle is at cold/cycle-{low}-{high}.json.gz (A = 5, B = 6).
      const expectedBundle = join(
        fx.paths.archiveDir,
        "cold",
        "cycle-5-6.json.gz",
      );
      expect(r.bundlePath).toBe(expectedBundle);
      expect(await fileExists(expectedBundle)).toBe(true);

      // Kept originals remain loose; packed originals were removed.
      expect(
        await fileExists(
          join(fx.paths.archiveDir, "cycle-8-finding-registry.json"),
        ),
      ).toBe(true);
      expect(
        await fileExists(
          join(fx.paths.archiveDir, "cycle-7-finding-registry.json"),
        ),
      ).toBe(true);
      expect(
        await fileExists(
          join(fx.paths.archiveDir, "cycle-6-finding-registry.json"),
        ),
      ).toBe(false);
      expect(
        await fileExists(
          join(fx.paths.archiveDir, "cycle-5-finding-registry.json"),
        ),
      ).toBe(false);
    });

    it("packs a single older file (A === B in the bundle name)", async () => {
      await writeCycleArchive(fx, 4);
      await writeCycleArchive(fx, 8);

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });

      expect(r.kept).toEqual(["cycle-8-finding-registry.json"]);
      expect(r.coldArchived).toEqual(["cycle-4-finding-registry.json"]);
      expect(r.bundlePath).toBe(
        join(fx.paths.archiveDir, "cold", "cycle-4-4.json.gz"),
      );
    });

    it("bundle is valid gzip (0x1f 0x8b magic) and valid JSON after gunzip", async () => {
      await writeCycleArchive(fx, 5);
      await writeCycleArchive(fx, 6);
      await writeCycleArchive(fx, 7);

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.bundlePath).not.toBeNull();

      const raw = await readFile(r.bundlePath as string);
      // gzip magic bytes.
      expect(raw[0]).toBe(0x1f);
      expect(raw[1]).toBe(0x8b);

      // Gunzips to valid JSON with the documented envelope.
      const inflated = gunzipSync(raw).toString("utf-8");
      const parsed = JSON.parse(inflated);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.packedAtCycleLow).toBe(5);
      expect(parsed.packedAtCycleHigh).toBe(6);
      expect(typeof parsed.files).toBe("object");
    });
  });

  describe("(c) round-trip: gunzip + parse matches original content exactly", () => {
    it("every packed file's content survives the bundle losslessly", async () => {
      const body5 = `{"cycle":5,"entries":[{"finding_id":"C5-D1-M1","note":"unicode ☃ and \\"quotes\\""}]}`;
      const body6 = `{"cycle":6,"entries":[{"finding_id":"C6-D2-M9"}]}`;
      await writeFile(
        join(fx.paths.archiveDir, "cycle-5-finding-registry.json"),
        body5,
      );
      await writeFile(
        join(fx.paths.archiveDir, "cycle-6-finding-registry.json"),
        body6,
      );
      await writeCycleArchive(fx, 9); // newest, stays loose

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      const raw = await readFile(r.bundlePath as string);
      const parsed = JSON.parse(gunzipSync(raw).toString("utf-8"));

      expect(parsed.files["cycle-5-finding-registry.json"]).toBe(body5);
      expect(parsed.files["cycle-6-finding-registry.json"]).toBe(body6);
      // The kept (newest) file is NOT in the bundle.
      expect(
        parsed.files["cycle-9-finding-registry.json"],
      ).toBeUndefined();
    });
  });

  describe("(d) ENOENT archive directory → empty result, no throw", () => {
    it("returns empty result when archiveDir does not exist", async () => {
      const { rm } = await import("node:fs/promises");
      await rm(fx.paths.archiveDir, { recursive: true, force: true });

      const r = await coldPackAuditArchives(fx.paths, { keep: 2 });
      expect(r.kept).toEqual([]);
      expect(r.coldArchived).toEqual([]);
      expect(r.bundlePath).toBeNull();
    });
  });

  describe("(e) idempotence + verification gate preserves originals", () => {
    it("second run after a pack has nothing left to pack", async () => {
      await writeCycleArchive(fx, 5);
      await writeCycleArchive(fx, 6);
      await writeCycleArchive(fx, 7);

      const r1 = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r1.coldArchived).toEqual([
        "cycle-6-finding-registry.json",
        "cycle-5-finding-registry.json",
      ]);

      // After the pack only the kept loose file (7) remains; a re-run packs
      // nothing because there is only 1 cycle file and keep === 1.
      const r2 = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r2.bundlePath).toBeNull();
      expect(r2.coldArchived).toEqual([]);
      expect(r2.kept).toEqual(["cycle-7-finding-registry.json"]);
    });

    it("happy-path verification gate confirmed packing before deleting originals", async () => {
      // The gate is preservation-first: if it ever failed, originals would
      // survive and coldArchived would be []. On success, the bundle exists and
      // the originals are gone — proving the unlink ran only after verification.
      await writeCycleArchive(fx, 2);
      await writeCycleArchive(fx, 3);
      await writeCycleArchive(fx, 4);

      const r = await coldPackAuditArchives(fx.paths, { keep: 1 });
      expect(r.bundlePath).not.toBeNull();
      expect(r.coldArchived.length).toBe(2);

      // cold/ holds exactly the one bundle; no stray .tmp.<hex> artifacts.
      const coldEntries = await readdir(join(fx.paths.archiveDir, "cold"));
      expect(coldEntries).toEqual(["cycle-2-3.json.gz"]);
    });
  });
});
