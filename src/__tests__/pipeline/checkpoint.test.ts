import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHECKPOINT_FILE,
  CHECKPOINT_SCHEMA_VERSION,
  checkpointPath,
  readCheckpoint,
  verifyResumability,
  writeCheckpoint,
  type CheckpointMeta,
} from "../../pipeline/checkpoint.js";
import { HatchError } from "../../types.js";

const sampleMeta = (overrides: Partial<CheckpointMeta> = {}): CheckpointMeta => ({
  baselineSha: "abc123def456",
  lastPassedGateN: 7,
  registrySha: "regsha-001",
  timestamp: new Date("2026-05-26T12:00:00Z").toISOString(),
  ...overrides,
});

describe("pipeline/checkpoint", () => {
  let tempDir: string;
  let workspace: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-checkpoint-test-"));
    workspace = join(tempDir, ".audit-workspace");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("checkpointPath", () => {
    it("returns workspace/checkpoint.json", () => {
      expect(checkpointPath("/tmp/foo")).toBe(`/tmp/foo/${CHECKPOINT_FILE}`);
    });
  });

  describe("writeCheckpoint", () => {
    it("creates the workspace directory and writes a valid JSON checkpoint", async () => {
      await writeCheckpoint(workspace, "wave-2", 2, "in-progress", sampleMeta());
      const raw = await readFile(checkpointPath(workspace), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
      expect(parsed.phase).toBe("wave-2");
      expect(parsed.wave).toBe(2);
      expect(parsed.status).toBe("in-progress");
      expect(parsed.meta.baselineSha).toBe("abc123def456");
    });

    it("overwrites an existing checkpoint atomically", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "in-progress", sampleMeta());
      await writeCheckpoint(workspace, "wave-2", 2, "passed", sampleMeta({ baselineSha: "newsha" }));
      const cp = await readCheckpoint(workspace);
      expect(cp?.phase).toBe("wave-2");
      expect(cp?.wave).toBe(2);
      expect(cp?.status).toBe("passed");
      expect(cp?.meta.baselineSha).toBe("newsha");
    });

    it("writes the file with a trailing newline (POSIX text-file convention)", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "passed", sampleMeta());
      const raw = await readFile(checkpointPath(workspace), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
    });

    it("does not leave a .tmp orphan after a successful write", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "passed", sampleMeta());
      const cpStat = await stat(checkpointPath(workspace));
      expect(cpStat.isFile()).toBe(true);
      // Read the workspace directory and assert no .tmp file remains.
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(workspace);
      const tmpOrphans = entries.filter((e) => e.includes(".tmp."));
      expect(tmpOrphans).toEqual([]);
    });
  });

  describe("readCheckpoint", () => {
    it("returns null when the checkpoint file is absent", async () => {
      const cp = await readCheckpoint(workspace);
      expect(cp).toBeNull();
    });

    it("returns the parsed checkpoint when the file exists", async () => {
      await writeCheckpoint(workspace, "wave-3", 3, "failed", sampleMeta());
      const cp = await readCheckpoint(workspace);
      expect(cp).not.toBeNull();
      expect(cp?.phase).toBe("wave-3");
      expect(cp?.wave).toBe(3);
      expect(cp?.status).toBe("failed");
    });

    it("throws when the checkpoint file is not valid JSON", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      await writeFile(checkpointPath(workspace), "not json {");
      await expect(readCheckpoint(workspace)).rejects.toThrow(/not valid JSON/);
    });

    it("throws when the checkpoint is missing required fields", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      await writeFile(checkpointPath(workspace), JSON.stringify({ schemaVersion: 1 }));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/failed validation/);
    });

    it("throws when the schemaVersion does not match", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 99,
        phase: "wave-1",
        wave: 1,
        status: "passed",
        meta: sampleMeta(),
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/schemaVersion must be 1/);
    });

    it("throws on invalid status value", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 1,
        phase: "wave-1",
        wave: 1,
        status: "weird",
        meta: sampleMeta(),
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/status must be/);
    });

    it("throws on negative wave", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 1,
        phase: "wave-1",
        wave: -1,
        status: "passed",
        meta: sampleMeta(),
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/wave must be a non-negative/);
    });

    it("throws on missing meta", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 1,
        phase: "wave-1",
        wave: 1,
        status: "passed",
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/meta/);
    });

    it("throws when meta.baselineSha is missing", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 1,
        phase: "wave-1",
        wave: 1,
        status: "passed",
        meta: { lastPassedGateN: 1, registrySha: "x", timestamp: "now" },
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/baselineSha/);
    });

    it("rejects an empty phase string", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      const bad = {
        schemaVersion: 1,
        phase: "",
        wave: 1,
        status: "passed",
        meta: sampleMeta(),
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(bad));
      await expect(readCheckpoint(workspace)).rejects.toThrow(/phase must be/);
    });

    it("rejects a non-object root", async () => {
      await (await import("node:fs/promises")).mkdir(workspace, { recursive: true });
      await writeFile(checkpointPath(workspace), "42");
      await expect(readCheckpoint(workspace)).rejects.toThrow(/not an object/);
    });

    // F1.5-H1 (Cycle 10 D1): a malformed checkpoint is preserved to
    // `checkpoint.json.corrupt-<ISO>` before the throw so the operator and a
    // future migration tool can inspect the original; the recovery hint names
    // the preserved copy.
    it("preserves a corrupt (unparseable) checkpoint and names the backup in the recovery hint", async () => {
      const { mkdir, readdir } = await import("node:fs/promises");
      await mkdir(workspace, { recursive: true });
      await writeFile(checkpointPath(workspace), "not json {");
      try {
        await readCheckpoint(workspace);
        throw new Error("expected readCheckpoint to throw on corrupt JSON");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).recoveryHint).toMatch(/preserved at .*checkpoint\.json\.corrupt-/);
      }
      const entries = await readdir(workspace);
      const backups = entries.filter((e) => /^checkpoint\.json\.corrupt-/.test(e));
      expect(backups.length).toBe(1);
      // The preserved copy holds the exact bytes that were on disk.
      const backupRaw = await readFile(join(workspace, backups[0]), "utf-8");
      expect(backupRaw).toBe("not json {");
    });

    // Schema-version mismatch is the realistic upgrade case: a checkpoint from
    // an older hatch3r version takes the validation-error branch. It too must
    // be preserved (not just "delete and re-run") so the operator does not lose
    // the only artifact a future migration shim could read.
    it("preserves a schema-version-mismatch checkpoint for migration on upgrade", async () => {
      const { mkdir, readdir } = await import("node:fs/promises");
      await mkdir(workspace, { recursive: true });
      const futureSchema = {
        schemaVersion: 99,
        phase: "wave-1",
        wave: 1,
        status: "passed",
        meta: sampleMeta(),
      };
      await writeFile(checkpointPath(workspace), JSON.stringify(futureSchema, null, 2));
      try {
        await readCheckpoint(workspace);
        throw new Error("expected readCheckpoint to throw on schema mismatch");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).recoveryHint).toMatch(/preserved at .*checkpoint\.json\.corrupt-.*migration/);
      }
      const entries = await readdir(workspace);
      const backups = entries.filter((e) => /^checkpoint\.json\.corrupt-/.test(e));
      expect(backups.length).toBe(1);
      const backupParsed = JSON.parse(await readFile(join(workspace, backups[0]), "utf-8"));
      expect(backupParsed.schemaVersion).toBe(99);
    });
  });

  describe("verifyResumability", () => {
    it("returns ok=false when no checkpoint exists", async () => {
      const result = await verifyResumability(workspace, "abc123");
      expect(result.ok).toBe(false);
      expect(result.drift).toContain("no checkpoint");
    });

    it("returns ok=true when baseline matches and status is in-progress", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "in-progress", sampleMeta({ baselineSha: "matching" }));
      const result = await verifyResumability(workspace, "matching");
      expect(result.ok).toBe(true);
      expect(result.drift).toBeUndefined();
    });

    it("returns ok=true when baseline matches and status is passed", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "passed", sampleMeta({ baselineSha: "matching" }));
      const result = await verifyResumability(workspace, "matching");
      expect(result.ok).toBe(true);
    });

    it("returns ok=false with drift diagnostic when baseline mismatches", async () => {
      await writeCheckpoint(workspace, "wave-1", 1, "in-progress", sampleMeta({ baselineSha: "old-sha" }));
      const result = await verifyResumability(workspace, "new-sha");
      expect(result.ok).toBe(false);
      expect(result.drift).toContain("baseline drift");
      expect(result.drift).toContain("old-sha");
      expect(result.drift).toContain("new-sha");
    });

    it("returns ok=false when the checkpoint recorded a failed wave", async () => {
      await writeCheckpoint(workspace, "wave-2", 2, "failed", sampleMeta({ baselineSha: "matching" }));
      const result = await verifyResumability(workspace, "matching");
      expect(result.ok).toBe(false);
      expect(result.drift).toContain("failed wave");
    });
  });

  describe("end-to-end write/read/verify cycle", () => {
    it("supports the full lifecycle: write -> read -> verify", async () => {
      await writeCheckpoint(workspace, "phase-1", 0, "in-progress", sampleMeta());
      await writeCheckpoint(workspace, "phase-1", 1, "passed", sampleMeta());
      await writeCheckpoint(workspace, "phase-1", 2, "in-progress", sampleMeta());
      const cp = await readCheckpoint(workspace);
      expect(cp?.wave).toBe(2);
      expect(cp?.status).toBe("in-progress");
      const verify = await verifyResumability(workspace, "abc123def456");
      expect(verify.ok).toBe(true);
    });
  });
});
