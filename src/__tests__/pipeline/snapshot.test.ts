import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  applyRollback,
  buildSessionId,
  createSnapshot,
  listSnapshots,
  sessionDir,
  snapshotsRoot,
  withSnapshot,
  SNAPSHOT_FILES_DIR,
  SNAPSHOT_META_FILE,
  SNAPSHOT_SCHEMA_VERSION,
} from "../../pipeline/snapshot.js";

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch (err) {
    // Silent Failure Contract: surface non-ENOENT errors so a permission
    // problem in a test fixture does not masquerade as "file absent".
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`fileExists(${p}) — non-ENOENT error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

describe("pipeline/snapshot", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "hatch3r-snapshot-test-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("path helpers", () => {
    it("snapshotsRoot returns .hatch3r/snapshots under the project", () => {
      expect(snapshotsRoot(projectRoot)).toBe(join(projectRoot, ".hatch3r", "snapshots"));
    });

    it("sessionDir composes <root>/<session-id>", () => {
      expect(sessionDir("sess-1", projectRoot)).toBe(
        join(projectRoot, ".hatch3r", "snapshots", "sess-1"),
      );
    });
  });

  describe("createSnapshot", () => {
    it("captures existing files byte-for-byte", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "subdir", "b.txt");
      await writeFile(fileA, "hello from A");
      await mkdir(join(projectRoot, "subdir"), { recursive: true });
      await writeFile(fileB, "hello from B");

      const result = await createSnapshot("sess-create", [fileA, fileB], { projectRoot });
      expect(result.count).toBe(2);
      expect(result.snapshotPath).toBe(sessionDir("sess-create", projectRoot));

      const snappedA = await readFile(
        join(result.snapshotPath, SNAPSHOT_FILES_DIR, "a.txt"),
        "utf-8",
      );
      expect(snappedA).toBe("hello from A");
      const snappedB = await readFile(
        join(result.snapshotPath, SNAPSHOT_FILES_DIR, "subdir", "b.txt"),
        "utf-8",
      );
      expect(snappedB).toBe("hello from B");
    });

    it("writes a meta.json with the captured paths", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "A");
      const { snapshotPath } = await createSnapshot("sess-meta", [fileA], { projectRoot });
      const meta = JSON.parse(
        await readFile(join(snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
      );
      expect(meta.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
      expect(meta.sessionId).toBe("sess-meta");
      expect(meta.paths).toContain(fileA);
      expect(meta.relativePaths).toContain("a.txt");
    });

    it("records a tombstone for files that do not yet exist", async () => {
      const futurePath = join(projectRoot, "will-exist.txt");
      const result = await createSnapshot("sess-tomb", [futurePath], { projectRoot });
      const tombstonePath = join(
        result.snapshotPath,
        SNAPSHOT_FILES_DIR,
        "will-exist.txt.tombstone",
      );
      expect(await fileExists(tombstonePath)).toBe(true);
    });

    it("accumulates paths when called twice with the same session id", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "b.txt");
      await writeFile(fileA, "A");
      await writeFile(fileB, "B");
      await createSnapshot("sess-accum", [fileA], { projectRoot });
      const result = await createSnapshot("sess-accum", [fileB], { projectRoot });
      expect(result.count).toBe(2);
      const meta = JSON.parse(
        await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
      );
      expect(meta.relativePaths).toContain("a.txt");
      expect(meta.relativePaths).toContain("b.txt");
    });

    it("rejects an empty session id", async () => {
      await expect(createSnapshot("", [], { projectRoot })).rejects.toThrow(
        /invalid sessionId/,
      );
    });

    it("rejects a session id with path separators", async () => {
      await expect(createSnapshot("a/b", [], { projectRoot })).rejects.toThrow(
        /invalid sessionId/,
      );
      await expect(createSnapshot("a\\b", [], { projectRoot })).rejects.toThrow(
        /invalid sessionId/,
      );
    });

    it("places paths outside the project under _external/", async () => {
      // External path simulated by going up beyond projectRoot. Use a path
      // that will not exist, so the tombstone branch records it.
      const external = "/this/should/never/exist/external-file.txt";
      const result = await createSnapshot("sess-ext", [external], { projectRoot });
      const meta = JSON.parse(
        await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
      );
      const externalRel = meta.relativePaths.find((p: string) =>
        p.startsWith("_external"),
      );
      expect(externalRel).toBeDefined();
    });

    it("accepts relative paths and resolves them against projectRoot", async () => {
      const target = join(projectRoot, "rel.txt");
      await writeFile(target, "rel-content");
      const result = await createSnapshot("sess-rel", ["rel.txt"], { projectRoot });
      expect(result.count).toBe(1);
      const snapped = await readFile(
        join(result.snapshotPath, SNAPSHOT_FILES_DIR, "rel.txt"),
        "utf-8",
      );
      expect(snapped).toBe("rel-content");
    });

    it("captures projectRoot itself as _external/root when passed in paths", async () => {
      const result = await createSnapshot("sess-root", [projectRoot], { projectRoot });
      const meta = JSON.parse(
        await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
      );
      const rootRel = meta.relativePaths.find((p: string) => p.includes("_external"));
      expect(rootRel).toBeDefined();
    });

    it("rejects existing snapshot dir with unreadable meta.json", async () => {
      const dir = sessionDir("sess-bad-meta", projectRoot);
      await mkdir(dir, { recursive: true });
      // Write garbage that cannot be parsed.
      await writeFile(join(dir, SNAPSHOT_META_FILE), "{not json{");
      await expect(
        createSnapshot("sess-bad-meta", [join(projectRoot, "x.txt")], { projectRoot }),
      ).rejects.toThrow(/unreadable/);
    });

    // F1.5-H2: two inputs that collapse to the same `_external/` mirror path
    // (the cross-drive Windows scenario) must not silently overwrite each
    // other. The second input is skipped, a warning is surfaced, and only the
    // first capture is recorded in the manifest.
    describe("mirror-path collision dedup (F1.5-H2)", () => {
      it("skips the second of two inputs that map to the same mirror and warns", async () => {
        const fileA = join(projectRoot, "dup.txt");
        await writeFile(fileA, "first capture");
        const warns: string[] = [];

        // Same path listed twice → identical mirror. The dedup guard fires on
        // the second occurrence (the platform-independent reproduction of the
        // Windows cross-drive collision the `seen` map defends against).
        const result = await createSnapshot("sess-collision", [fileA, fileA], {
          projectRoot,
          onWarn: (m) => warns.push(m),
        });

        // Only the first capture is recorded — count reflects accepted paths.
        expect(result.count).toBe(1);
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain("mirror collision");
        expect(warns[0]).toContain("Skipping the second capture");

        // The manifest advertises exactly one relative path (not a duplicate).
        const meta = JSON.parse(
          await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
        );
        expect(meta.relativePaths).toEqual(["dup.txt"]);
        // The first capture's bytes are intact on disk.
        const snapped = await readFile(
          join(result.snapshotPath, SNAPSHOT_FILES_DIR, "dup.txt"),
          "utf-8",
        );
        expect(snapped).toBe("first capture");
      });

      it("collects collision warnings in the returned warnings[] array", async () => {
        const fileA = join(projectRoot, "x.txt");
        await writeFile(fileA, "content");
        // No onWarn callback supplied → the warning must still surface via the
        // returned `warnings[]` (Silent Failure Contract: never swallowed).
        const result = await createSnapshot("sess-collision-arr", [fileA, fileA], {
          projectRoot,
        });
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain("maps to the same snapshot path");
      });

      it("does not warn when every input maps to a distinct mirror", async () => {
        const fileA = join(projectRoot, "a.txt");
        const fileB = join(projectRoot, "b.txt");
        await writeFile(fileA, "A");
        await writeFile(fileB, "B");
        const warns: string[] = [];
        const result = await createSnapshot("sess-no-collision", [fileA, fileB], {
          projectRoot,
          onWarn: (m) => warns.push(m),
        });
        expect(result.count).toBe(2);
        expect(warns).toEqual([]);
        expect(result.warnings).toEqual([]);
      });
    });

    // D8-9 (Cycle 11 Wave 3): a cross-call mirror collision must not desync the
    // `paths` / `relativePaths` index pairing. Two distinct absolute paths that
    // collapse to the same `_external/` mirror — the cross-drive Windows
    // scenario, reproduced platform-independently here by a backslash that POSIX
    // treats as a literal filename char but `mirrorRelativePath` normalises to
    // `/` — were previously deduped by two INDEPENDENT Sets (one on `paths`, one
    // on `relativePaths`). When the two inputs arrived in SEPARATE same-session
    // `createSnapshot` calls the per-call `seen` guard could not see the prior
    // call, so the manifest ended up with `paths.length === 2` but
    // `relativePaths.length === 1`, corrupting `applyRollback`'s index pairing.
    describe("cross-call mirror collision index alignment (D8-9)", () => {
      // Two distinct stored absolute paths whose `_external/` mirrors collide.
      const collidingA = "/data/x/file.txt";
      const collidingB = "/data\\x/file.txt"; // distinct abs, same mirror after \\ -> /

      it("keeps paths/relativePaths index-aligned across two same-session calls", async () => {
        // Call 1 captures the first colliding input.
        await createSnapshot("sess-xcall", [collidingA], { projectRoot });
        // Call 2 (same session) passes the OTHER input that maps to the same
        // mirror. Pre-fix this silently desynced the arrays; post-fix the
        // seeded guard detects it, skips the second capture, and warns.
        const warns: string[] = [];
        const result = await createSnapshot("sess-xcall", [collidingB], {
          projectRoot,
          onWarn: (m) => warns.push(m),
        });

        const meta = JSON.parse(
          await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
        );
        // The invariant applyRollback relies on: equal lengths, paired by index.
        expect(meta.paths.length).toBe(meta.relativePaths.length);
        // Built with `join` so the expected separator matches the host (the
        // source composes the mirror via `join("_external", safe)`).
        expect(meta.relativePaths).toEqual([join("_external", "data", "x", "file.txt")]);
        expect(meta.paths).toEqual([collidingA]);
        // The cross-call collision is surfaced, not swallowed.
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain("mirror collision");
        expect(result.count).toBe(1);
      });

      it("is idempotent when the SAME path is re-passed in a later same-session call (no spurious warning)", async () => {
        const fileA = join(projectRoot, "repeat.txt");
        await writeFile(fileA, "original");
        await createSnapshot("sess-idem", [fileA], { projectRoot });
        // Re-passing the identical path in a follow-up call is the documented
        // "extend a session incrementally" contract — it must not be reported as
        // a collision (the prior capture already holds the correct pre-run bytes).
        const warns: string[] = [];
        const result = await createSnapshot("sess-idem", [fileA], {
          projectRoot,
          onWarn: (m) => warns.push(m),
        });
        expect(warns).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.count).toBe(1);
        const meta = JSON.parse(
          await readFile(join(result.snapshotPath, SNAPSHOT_META_FILE), "utf-8"),
        );
        expect(meta.paths.length).toBe(meta.relativePaths.length);
        expect(meta.paths).toEqual([fileA]);
      });

      it("applyRollback pairs a real file correctly when a later call collides", async () => {
        // Call 1 captures a real in-project file AND the first external input.
        const realA = join(projectRoot, "real-a.txt");
        await writeFile(realA, "orig A");
        await createSnapshot("sess-xroll", [realA, collidingA], { projectRoot });
        // Call 2 passes collidingB, which maps to the SAME mirror as collidingA.
        // The seeded guard must skip it so it never shifts realA's (abs, rel)
        // index pairing — the desync this fix prevents.
        await createSnapshot("sess-xroll", [collidingB], { projectRoot });

        const meta = JSON.parse(
          await readFile(
            join(sessionDir("sess-xroll", projectRoot), SNAPSHOT_META_FILE),
            "utf-8",
          ),
        );
        // Index alignment preserved (realA + collidingA survive; collidingB skipped).
        expect(meta.paths.length).toBe(meta.relativePaths.length);
        expect(meta.paths).toContain(realA);
        expect(meta.paths).not.toContain(collidingB);

        // Round-trip: realA must restore to its captured pre-run bytes, proving
        // its index slot was not corrupted by the skipped collision.
        await writeFile(realA, "mut A");
        const result = await applyRollback("sess-xroll", { projectRoot });
        expect(result.errors).toEqual([]);
        expect(await readFile(realA, "utf-8")).toBe("orig A");
      });
    });
  });

  describe("listSnapshots", () => {
    it("returns empty array when the root does not exist", async () => {
      const out = await listSnapshots({ projectRoot });
      expect(out).toEqual([]);
    });

    it("lists all sessions sorted by timestamp descending", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "A");
      await createSnapshot("sess-old", [fileA], { projectRoot });

      // Hand-roll a newer timestamp so sort order is deterministic without sleeping.
      const dirOld = sessionDir("sess-old", projectRoot);
      const oldMeta = JSON.parse(
        await readFile(join(dirOld, SNAPSHOT_META_FILE), "utf-8"),
      );
      oldMeta.timestamp = "2026-01-01T00:00:00.000Z";
      await writeFile(join(dirOld, SNAPSHOT_META_FILE), JSON.stringify(oldMeta));

      await createSnapshot("sess-new", [fileA], { projectRoot });
      const dirNew = sessionDir("sess-new", projectRoot);
      const newMeta = JSON.parse(
        await readFile(join(dirNew, SNAPSHOT_META_FILE), "utf-8"),
      );
      newMeta.timestamp = "2027-01-01T00:00:00.000Z";
      await writeFile(join(dirNew, SNAPSHOT_META_FILE), JSON.stringify(newMeta));

      const out = await listSnapshots({ projectRoot });
      expect(out.length).toBe(2);
      expect(out[0].sessionId).toBe("sess-new");
      expect(out[1].sessionId).toBe("sess-old");
    });

    it("skips sessions with malformed meta.json silently", async () => {
      const dir = sessionDir("sess-broken", projectRoot);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, SNAPSHOT_META_FILE), "{not json{");
      const out = await listSnapshots({ projectRoot });
      expect(out).toEqual([]);
    });

    it("skips sessions with mismatched schema version", async () => {
      const dir = sessionDir("sess-old-schema", projectRoot);
      await mkdir(dir, { recursive: true });
      const bad = {
        schemaVersion: 99,
        sessionId: "sess-old-schema",
        timestamp: "2026-01-01T00:00:00.000Z",
        paths: [],
        relativePaths: [],
        projectRoot,
      };
      await writeFile(join(dir, SNAPSHOT_META_FILE), JSON.stringify(bad));
      const out = await listSnapshots({ projectRoot });
      expect(out).toEqual([]);
    });
  });

  describe("applyRollback (round-trip)", () => {
    it("restores file contents to the captured byte-for-byte state", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original A");
      await createSnapshot("sess-restore", [fileA], { projectRoot });

      // Mutate
      await writeFile(fileA, "mutated A");
      const before = await readFile(fileA, "utf-8");
      expect(before).toBe("mutated A");

      // Restore
      const result = await applyRollback("sess-restore", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      const after = await readFile(fileA, "utf-8");
      expect(after).toBe("original A");
    });

    it("restores non-UTF-8 content byte-for-byte (no U+FFFD corruption)", async () => {
      // D8-3 (Cycle 11 Wave 2, CQ4): the commit-phase restore previously did
      // `(sourceContent).toString("utf-8")`, which round-trips bytes >= 0x80
      // through the replacement char. 0xe9 is a lone, non-UTF-8 byte (é in
      // Latin-1); a lossy re-encode would replace it with the 3-byte U+FFFD
      // sequence (ef bf bd) and change the file length. The fix passes the
      // captured Buffer to atomicWriteFile verbatim, so the bytes survive.
      const binFile = join(projectRoot, "data.bin");
      const original = Buffer.from([0x68, 0x69, 0x20, 0xe9, 0x21]); // "hi " + 0xe9 + "!"
      await writeFile(binFile, original);
      await createSnapshot("sess-binary", [binFile], { projectRoot });

      // Mutate with different bytes.
      await writeFile(binFile, Buffer.from([0x00, 0x01, 0x02]));

      const result = await applyRollback("sess-binary", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);

      const after = await readFile(binFile); // Buffer, not utf-8 decode
      expect(after.equals(original)).toBe(true);
      // Guard against the specific corruption mode: a lossy utf-8 round-trip
      // would have grown the 5-byte file to 7 bytes (0xe9 -> ef bf bd).
      expect(after.length).toBe(5);
      expect(after.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
    });

    it("deletes a file that was created during the run via tombstone restore", async () => {
      const newFile = join(projectRoot, "created.txt");
      // Snapshot before file exists -> tombstone.
      await createSnapshot("sess-delete", [newFile], { projectRoot });
      // Now create the file.
      await writeFile(newFile, "should be deleted");
      expect(await fileExists(newFile)).toBe(true);

      const result = await applyRollback("sess-delete", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      expect(await fileExists(newFile)).toBe(false);
    });

    it("dry-run does not modify disk state", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "original");
      await createSnapshot("sess-dryrun", [fileA], { projectRoot });
      await writeFile(fileA, "mutated");

      const result = await applyRollback("sess-dryrun", { dryRun: true, projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      const content = await readFile(fileA, "utf-8");
      expect(content).toBe("mutated");
    });

    it("returns an error when the session id is unknown", async () => {
      const result = await applyRollback("does-not-exist", { projectRoot });
      expect(result.filesRestored).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("not found");
    });

    it("rejects a session with mismatched schema version", async () => {
      const dir = sessionDir("sess-schema-mismatch", projectRoot);
      await mkdir(dir, { recursive: true });
      const bad = {
        schemaVersion: 99,
        sessionId: "sess-schema-mismatch",
        timestamp: "2026-01-01T00:00:00.000Z",
        paths: [],
        relativePaths: [],
        projectRoot,
      };
      await writeFile(join(dir, SNAPSHOT_META_FILE), JSON.stringify(bad));
      const result = await applyRollback("sess-schema-mismatch", { projectRoot });
      expect(result.filesRestored).toBe(0);
      expect(result.errors[0]).toContain("schema");
    });

    it("survives a tombstone restore when the target is already absent", async () => {
      const newFile = join(projectRoot, "already-gone.txt");
      await createSnapshot("sess-tomb-absent", [newFile], { projectRoot });
      // Do not create the file; tombstone restore should be a no-op.
      const result = await applyRollback("sess-tomb-absent", { projectRoot });
      expect(result.filesRestored).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it("handles multiple files in one session", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "nested", "b.txt");
      await writeFile(fileA, "orig A");
      await mkdir(join(projectRoot, "nested"), { recursive: true });
      await writeFile(fileB, "orig B");

      await createSnapshot("sess-multi", [fileA, fileB], { projectRoot });
      await writeFile(fileA, "mut A");
      await writeFile(fileB, "mut B");

      const result = await applyRollback("sess-multi", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(2);
      expect(await readFile(fileA, "utf-8")).toBe("orig A");
      expect(await readFile(fileB, "utf-8")).toBe("orig B");
    });

    it("uses atomic writes (no .tmp orphans after restore)", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "orig");
      await createSnapshot("sess-atomic", [fileA], { projectRoot });
      await writeFile(fileA, "mut");
      await applyRollback("sess-atomic", { projectRoot });
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(projectRoot);
      const tmpOrphans = entries.filter((e) => e.includes(".tmp."));
      expect(tmpOrphans).toEqual([]);
    });
  });

  // F1.5-H3 / F8.2.4: applyRollback is a two-phase commit with all-or-nothing
  // semantics and a per-file disposition table.
  describe("rollback disposition table + all-or-nothing (F1.5-H3 / F8.2.4)", () => {
    it("reports original-restored disposition for every file on a clean live rollback", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "b.txt");
      await writeFile(fileA, "orig A");
      await writeFile(fileB, "orig B");
      await createSnapshot("sess-disp-ok", [fileA, fileB], { projectRoot });
      await writeFile(fileA, "mut A");
      await writeFile(fileB, "mut B");

      const result = await applyRollback("sess-disp-ok", { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(2);
      expect(result.dispositions).toBeDefined();
      const states = (result.dispositions ?? []).map((d) => d.state).sort();
      expect(states).toEqual(["original-restored", "original-restored"]);
      // Targets are reported in the disposition table.
      const targets = (result.dispositions ?? []).map((d) => d.target).sort();
      expect(targets).toEqual([fileA, fileB].sort());
    });

    it("dry-run returns a disposition table without touching disk", async () => {
      const fileA = join(projectRoot, "a.txt");
      await writeFile(fileA, "orig");
      await createSnapshot("sess-disp-dry", [fileA], { projectRoot });
      await writeFile(fileA, "mut");

      const result = await applyRollback("sess-disp-dry", { dryRun: true, projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      expect(result.dispositions).toHaveLength(1);
      expect(result.dispositions?.[0].state).toBe("original-restored");
      // Disk untouched by the dry run.
      expect(await readFile(fileA, "utf-8")).toBe("mut");
    });

    it("aborts the entire live rollback (mutated-still) when prepare finds an unreadable mirror", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "b.txt");
      await writeFile(fileA, "orig A");
      await writeFile(fileB, "orig B");
      const snap = await createSnapshot("sess-disp-abort", [fileA, fileB], { projectRoot });
      await writeFile(fileA, "mut A");
      await writeFile(fileB, "mut B");

      // Corrupt the prepare phase: remove one mirror so readFile(source) fails.
      // All-or-nothing means NEITHER file may be restored.
      const { rm: rmFile } = await import("node:fs/promises");
      await rmFile(join(snap.snapshotPath, SNAPSHOT_FILES_DIR, "a.txt"));

      const result = await applyRollback("sess-disp-abort", { projectRoot });
      expect(result.filesRestored).toBe(0);
      // The abort error names the prepare failure and states no files changed.
      expect(result.errors.some((e) => /aborted|read snapshot/.test(e))).toBe(true);
      // Every entry reports mutated-still — disk left in pre-rollback state.
      const states = (result.dispositions ?? []).map((d) => d.state);
      expect(states.every((s) => s === "mutated-still")).toBe(true);
      // Both files still hold the mutation (not rolled back).
      expect(await readFile(fileA, "utf-8")).toBe("mut A");
      expect(await readFile(fileB, "utf-8")).toBe("mut B");
    });
  });

  describe("end-to-end snapshot lifecycle", () => {
    it("supports create -> mutate -> list -> rollback round-trip", async () => {
      const fileA = join(projectRoot, "a.txt");
      const fileB = join(projectRoot, "b.txt");
      await writeFile(fileA, "ORIG A");
      await writeFile(fileB, "ORIG B");

      const created = await createSnapshot("sess-e2e", [fileA, fileB], { projectRoot });
      expect(created.count).toBe(2);

      const list = await listSnapshots({ projectRoot });
      expect(list.find((s) => s.sessionId === "sess-e2e")).toBeDefined();

      await writeFile(fileA, "MUTATED A");
      await writeFile(fileB, "MUTATED B");

      const restored = await applyRollback("sess-e2e", { projectRoot });
      expect(restored.errors).toEqual([]);
      expect(restored.filesRestored).toBe(2);
      expect(await readFile(fileA, "utf-8")).toBe("ORIG A");
      expect(await readFile(fileB, "utf-8")).toBe("ORIG B");
    });
  });

  describe("dry-run tombstone branch", () => {
    it("counts a dry-run tombstone restore even when target is absent", async () => {
      const futurePath = join(projectRoot, "ghost.txt");
      await createSnapshot("sess-dry-tomb", [futurePath], { projectRoot });
      // No file at futurePath; dry-run should report 1 restored (tombstone counted).
      const result = await applyRollback("sess-dry-tomb", { dryRun: true, projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
    });

    it("counts a dry-run tombstone restore when target exists", async () => {
      const futurePath = join(projectRoot, "ghost2.txt");
      await createSnapshot("sess-dry-tomb-exists", [futurePath], { projectRoot });
      await writeFile(futurePath, "would be deleted");
      const result = await applyRollback("sess-dry-tomb-exists", {
        dryRun: true,
        projectRoot,
      });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      // dry-run leaves it in place
      const content = await readFile(futurePath, "utf-8");
      expect(content).toBe("would be deleted");
    });
  });

  describe("unlink error branch", () => {
    it("reports an unlink error when the target is a non-empty directory", async () => {
      const futurePath = join(projectRoot, "blocking-dir");
      await createSnapshot("sess-unlink-fail", [futurePath], { projectRoot });
      // Create a non-empty directory at the path so unlink fails with EISDIR/ENOTEMPTY.
      await mkdir(futurePath, { recursive: true });
      await writeFile(join(futurePath, "child.txt"), "blocker");
      const result = await applyRollback("sess-unlink-fail", { projectRoot });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/unlink/);
    });
  });

  describe("paths defaults", () => {
    it("uses process.cwd() when projectRoot is not passed to createSnapshot", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(projectRoot);
        const fileA = join(process.cwd(), "cwd-file.txt");
        await writeFile(fileA, "cwd-content");
        const result = await createSnapshot("sess-cwd", [fileA]);
        expect(result.count).toBe(1);
        // Snapshot dir should be under process.cwd()/.hatch3r/snapshots/sess-cwd
        // (process.cwd() may differ from `projectRoot` if macOS canonicalizes /tmp).
        const expected = join(process.cwd(), ".hatch3r", "snapshots", "sess-cwd");
        expect(result.snapshotPath).toBe(expected);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("uses process.cwd() when projectRoot is not passed to listSnapshots", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(projectRoot);
        const fileA = join(projectRoot, "cwd2.txt");
        await writeFile(fileA, "x");
        await createSnapshot("sess-list-cwd", [fileA]);
        const out = await listSnapshots();
        expect(out.find((s) => s.sessionId === "sess-list-cwd")).toBeDefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("uses process.cwd() when projectRoot is not passed to applyRollback", async () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(projectRoot);
        const fileA = join(projectRoot, "cwd3.txt");
        await writeFile(fileA, "orig-cwd");
        await createSnapshot("sess-roll-cwd", [fileA]);
        await writeFile(fileA, "mut-cwd");
        const result = await applyRollback("sess-roll-cwd");
        expect(result.errors).toEqual([]);
        expect(await readFile(fileA, "utf-8")).toBe("orig-cwd");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // Suppress unused import warnings under strict mode.
  it("resolve helper exists for absolute-path normalization", () => {
    expect(typeof resolve).toBe("function");
    expect(typeof stat).toBe("function");
  });

  // Decision 27 (Bucket 2.2) wiring: cover the `withSnapshot` helper that
  // the four mutation commands invoke before any disk write. The helper
  // exists so a single `hatch3r rollback --session=<id>` can revert an
  // entire run; these tests verify session-id construction, dry-run
  // bypass, listing visibility, and round-trip rollback for each
  // command-name namespace surfaced to the operator.
  describe("buildSessionId", () => {
    it("composes <command>-<ISO> with `:` and `.` replaced by `-`", () => {
      const id = buildSessionId("sync", new Date("2026-05-27T12:34:56.789Z"));
      expect(id).toBe("sync-2026-05-27T12-34-56-789Z");
      expect(id.includes(":")).toBe(false);
      expect(id.includes(".")).toBe(false);
    });

    it("is filesystem-safe (no `/` or `\\` after sanitization)", () => {
      const id = buildSessionId("init", new Date("2026-01-01T00:00:00.000Z"));
      expect(id.includes("/")).toBe(false);
      expect(id.includes("\\")).toBe(false);
    });
  });

  describe("withSnapshot", () => {
    it("captures the supplied paths and returns the session id", async () => {
      const fileA = join(projectRoot, "wire-a.txt");
      await writeFile(fileA, "wire-a-original");
      const fixedNow = new Date("2026-03-15T10:20:30.000Z");
      let mutatorSawSessionId: string | null = null;
      const out = await withSnapshot(
        "sync",
        [fileA],
        async (sessionId) => {
          mutatorSawSessionId = sessionId;
          return "mutated" as const;
        },
        { projectRoot, now: () => fixedNow },
      );
      expect(out.result).toBe("mutated");
      expect(out.sessionId).toMatch(/^sync-/);
      expect(out.snapshotPath).not.toBeNull();
      expect(out.count).toBe(1);
      expect(mutatorSawSessionId).toBe(out.sessionId);

      const sessions = await listSnapshots({ projectRoot });
      expect(sessions.find((s) => s.sessionId === out.sessionId)).toBeDefined();
    });

    it("namespaces session ids by command name (init / sync / update / config / clean)", async () => {
      const baseTime = Date.now();
      const commands = ["init", "sync", "update", "config", "clean"] as const;
      let i = 0;
      for (const cmd of commands) {
        i += 1;
        // Ensure each session id has a distinct timestamp to avoid
        // accumulation under the same directory.
        const fixedNow = new Date(baseTime + i * 1000);
        const out = await withSnapshot(
          cmd,
          [],
          async () => undefined,
          { projectRoot, now: () => fixedNow },
        );
        expect(out.sessionId).not.toBeNull();
        expect(out.sessionId!.startsWith(`${cmd}-`)).toBe(true);
      }
    });

    it("skips snapshot capture when dryRun=true", async () => {
      const fileA = join(projectRoot, "wire-dry.txt");
      await writeFile(fileA, "dry-original");
      const out = await withSnapshot(
        "sync",
        [fileA],
        async (sessionId) => {
          expect(sessionId).toBeNull();
          return "ok" as const;
        },
        { projectRoot, dryRun: true },
      );
      expect(out.result).toBe("ok");
      expect(out.sessionId).toBeNull();
      expect(out.snapshotPath).toBeNull();
      expect(out.count).toBe(0);
      const sessions = await listSnapshots({ projectRoot });
      expect(sessions.length).toBe(0);
    });

    it("filters out empty/falsy entries before capture", async () => {
      const fileA = join(projectRoot, "wire-filter.txt");
      await writeFile(fileA, "filter-original");
      const out = await withSnapshot(
        "init",
        ["", fileA, ""],
        async () => undefined,
        { projectRoot },
      );
      expect(out.count).toBe(1);
    });

    it("supports empty-paths snapshot so the session still appears in `rollback list`", async () => {
      const out = await withSnapshot(
        "init",
        [],
        async () => undefined,
        { projectRoot },
      );
      expect(out.sessionId).not.toBeNull();
      expect(out.count).toBe(0);
      const sessions = await listSnapshots({ projectRoot });
      expect(sessions.find((s) => s.sessionId === out.sessionId)).toBeDefined();
    });

    it("round-trip: a withSnapshot call followed by applyRollback restores the file", async () => {
      const fileA = join(projectRoot, "wire-roundtrip.txt");
      await writeFile(fileA, "roundtrip-original");
      const captured = await withSnapshot(
        "sync",
        [fileA],
        async () => {
          await writeFile(fileA, "roundtrip-mutated");
        },
        { projectRoot },
      );
      const after = await readFile(fileA, "utf-8");
      expect(after).toBe("roundtrip-mutated");

      const result = await applyRollback(captured.sessionId!, { projectRoot });
      expect(result.errors).toEqual([]);
      expect(result.filesRestored).toBe(1);
      const restored = await readFile(fileA, "utf-8");
      expect(restored).toBe("roundtrip-original");
    });

    it("snapshot capture failure propagates and does not invoke the mutator", async () => {
      const fileA = join(projectRoot, "wire-fail.txt");
      await writeFile(fileA, "fail-original");
      let mutatorRan = false;
      await expect(
        withSnapshot(
          "bad/name",
          [fileA],
          async () => {
            mutatorRan = true;
          },
          { projectRoot, now: () => new Date("2026-01-01T00:00:00.000Z") },
        ),
      ).rejects.toThrow(/invalid sessionId/);
      expect(mutatorRan).toBe(false);
    });
  });
});
