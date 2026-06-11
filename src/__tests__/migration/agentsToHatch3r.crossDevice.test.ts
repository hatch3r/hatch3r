// Coverage for D8-6 (cross-device EXDEV move fallback) and D8-5 (interrupted
// migration atomicity / best-effort rollback) in the `.agents/` -> `.hatch3r/`
// migration shim.
//
// These two paths require injecting an `EXDEV` from `rename` and a mid-sequence
// `cp` failure, so they live in a separate file that mocks `node:fs/promises`
// via `vi.doMock` + `importOriginal`. Only `rename` (always) and `cp`
// (selectively, for the rollback test) are overridden — `cp`/`rm` otherwise run
// against the real temp filesystem so the copy-then-delete fallback is actually
// exercised end-to-end. The non-mocked happy/conflict paths are covered by the
// sibling `agentsToHatch3r.test.ts`.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HATCH3R_DIR, MANIFEST_FILE } from "../../types.js";

const AGENTS_DIR = ".agents";

/** errno-style error matching what node:fs surfaces on a cross-device rename. */
function mkErrno(code: string, message = ""): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message || code);
  err.code = code;
  return err;
}

/**
 * Structural HatchError assertion. `vi.resetModules()` re-imports the module
 * under test against a fresh `types.js`, so the thrown HatchError's class
 * identity differs from this file's top-level import — `instanceof` would
 * spuriously fail. Assert on the structural contract (name + errorCode +
 * recoveryHint) instead, which is identity-independent.
 */
function expectHatchFsError(err: unknown): void {
  expect(err).toBeInstanceOf(Error);
  const e = err as Error & { errorCode?: string; recoveryHint?: string };
  expect(e.name).toBe("HatchError");
  expect(e.errorCode).toBe("FS_ERROR");
  expect(e.recoveryHint).toBe(
    "Migration interrupted; re-run to finish or move the listed entries manually",
  );
  expect(e.message).toMatch(/interrupted/i);
}

describe("migrateAgentsToHatch3r — cross-device + rollback (mocked fs)", () => {
  let migrateAgentsToHatch3r: typeof import("../../migration/agentsToHatch3r.js").migrateAgentsToHatch3r;
  let tempDir: string;
  let warnSpy: MockInstance;

  const mockRename = vi.fn<(...args: unknown[]) => Promise<void>>();
  // cp/rm default to the real implementation so the EXDEV fallback genuinely
  // copies bytes on the temp filesystem; individual tests override cp to fail.
  let realCp: typeof import("node:fs/promises").cp;
  let realRm: typeof import("node:fs/promises").rm;
  const mockCp = vi.fn<(...args: unknown[]) => Promise<void>>();

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

    const actualFs = await import("node:fs/promises");
    realCp = actualFs.cp;
    realRm = actualFs.rm;

    // Default: rename always reports a cross-device boundary so the shim takes
    // the cp+rm fallback for every move.
    mockRename.mockRejectedValue(mkErrno("EXDEV", "EXDEV: cross-device link not permitted"));
    // Default cp/rm pass through to the real fs.
    mockCp.mockImplementation((...args: unknown[]) =>
      (realCp as (...a: unknown[]) => Promise<void>)(...args),
    );

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        rename: mockRename,
        cp: mockCp,
      };
    });

    const mod = await import("../../migration/agentsToHatch3r.js");
    migrateAgentsToHatch3r = mod.migrateAgentsToHatch3r;

    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-agents-xdev-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    vi.doUnmock("node:fs/promises");
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  // ── D8-6: EXDEV copy-fallback ────────────────────────────────────

  describe("EXDEV copy-fallback (D8-6)", () => {
    it("relocates a file across a device boundary via cp + rm when rename throws EXDEV", async () => {
      const legacy = join(tempDir, AGENTS_DIR);
      const payload = '{"version":"1.0.0","cross":"device"}';
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, MANIFEST_FILE), payload);

      const result = await migrateAgentsToHatch3r(tempDir);

      // rename was attempted (and threw EXDEV); cp performed the real copy.
      expect(mockRename).toHaveBeenCalled();
      expect(mockCp).toHaveBeenCalled();

      // The manifest now lives at the destination with byte-identical content,
      // and the legacy copy was removed by the rm half of the fallback.
      expect(result.moved).toContain(
        `${AGENTS_DIR}/${MANIFEST_FILE} -> ${HATCH3R_DIR}/${MANIFEST_FILE}`,
      );
      const relocated = await readFile(join(tempDir, HATCH3R_DIR, MANIFEST_FILE), "utf-8");
      expect(relocated).toBe(payload);
      await expect(access(join(legacy, MANIFEST_FILE))).rejects.toThrow();
    });

    it("relocates a whole subtree across a device boundary via recursive cp", async () => {
      const legacy = join(tempDir, AGENTS_DIR);
      await mkdir(join(legacy, "learnings"), { recursive: true });
      await writeFile(join(legacy, "learnings", "INDEX.md"), "# x-device learnings");

      const result = await migrateAgentsToHatch3r(tempDir);

      expect(result.moved).toContain(
        `${AGENTS_DIR}/learnings/ -> ${HATCH3R_DIR}/learnings/`,
      );
      const relocated = await readFile(
        join(tempDir, HATCH3R_DIR, "learnings", "INDEX.md"),
        "utf-8",
      );
      expect(relocated).toBe("# x-device learnings");
      await expect(access(join(legacy, "learnings"))).rejects.toThrow();
    });

    it("re-throws a non-EXDEV rename error unchanged (no cp fallback)", async () => {
      mockRename.mockRejectedValue(mkErrno("EPERM", "EPERM: operation not permitted"));
      const legacy = join(tempDir, AGENTS_DIR);
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, MANIFEST_FILE), "{}");

      // EPERM is not a cross-device error — it surfaces as an interrupted
      // migration (wrapped HatchError, see D8-5) rather than silently copying.
      let thrown: unknown;
      try {
        await migrateAgentsToHatch3r(tempDir);
      } catch (err) {
        thrown = err;
      }
      expectHatchFsError(thrown);
      // The cp fallback must NOT run for a non-EXDEV failure.
      expect(mockCp).not.toHaveBeenCalled();
    });
  });

  // ── D8-5: interrupted migration rollback ─────────────────────────

  describe("interrupted-migration rollback (D8-5)", () => {
    it("rolls back already-moved entries and throws a FS_ERROR HatchError when a later move fails", async () => {
      const legacy = join(tempDir, AGENTS_DIR);
      // Manifest moves first and succeeds (cp passthrough); learnings/ is the
      // second move and its cp is forced to fail, interrupting the sequence.
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, MANIFEST_FILE), '{"keep":"me"}');
      await mkdir(join(legacy, "learnings"), { recursive: true });
      await writeFile(join(legacy, "learnings", "INDEX.md"), "# boom");

      mockCp.mockImplementation((src: unknown, dest: unknown, ...rest: unknown[]) => {
        // Fail the forward copy of the learnings subtree only; let the manifest
        // forward-copy AND every rollback copy (back into .agents/) pass.
        if (
          typeof dest === "string" &&
          dest.includes(join(HATCH3R_DIR, "learnings"))
        ) {
          return Promise.reject(mkErrno("EIO", "EIO: simulated copy failure"));
        }
        return (realCp as (...a: unknown[]) => Promise<void>)(src, dest, ...rest);
      });

      let thrown: unknown;
      try {
        await migrateAgentsToHatch3r(tempDir);
      } catch (err) {
        thrown = err;
      }

      // A structured, actionable HatchError is surfaced (not a raw fs error).
      expectHatchFsError(thrown);

      // Rollback restored the manifest to its origin under .agents/ ...
      const restored = await readFile(join(legacy, MANIFEST_FILE), "utf-8");
      expect(restored).toBe('{"keep":"me"}');
      // ... and removed the half-applied destination copy so a re-run starts
      // from the pre-migration layout rather than a destination-exists state.
      await expect(access(join(tempDir, HATCH3R_DIR, MANIFEST_FILE))).rejects.toThrow();

      // The failed learnings subtree is still at its origin (its forward move
      // never completed, so nothing to roll back there).
      await expect(
        access(join(legacy, "learnings", "INDEX.md")),
      ).resolves.toBeUndefined();
    });

    it("rollback never masks the original error even if a move-back itself fails", async () => {
      const legacy = join(tempDir, AGENTS_DIR);
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, MANIFEST_FILE), '{"v":1}');
      await mkdir(join(legacy, "learnings"), { recursive: true });
      await writeFile(join(legacy, "learnings", "INDEX.md"), "x");

      // Manifest forward-copy succeeds; learnings forward-copy fails (interrupt);
      // every rollback copy ALSO fails — the move-back is guarded and must not
      // replace the interruption HatchError with the rollback error.
      mockCp.mockImplementation((src: unknown, dest: unknown, ...rest: unknown[]) => {
        if (typeof dest === "string" && dest.includes(join(HATCH3R_DIR, "learnings"))) {
          return Promise.reject(mkErrno("EIO", "EIO: forward copy failure"));
        }
        if (typeof dest === "string" && dest.includes(join(AGENTS_DIR, MANIFEST_FILE))) {
          // Rollback copy back into .agents/ — force it to fail too.
          return Promise.reject(mkErrno("EACCES", "EACCES: rollback copy failure"));
        }
        return (realCp as (...a: unknown[]) => Promise<void>)(src, dest, ...rest);
      });

      let thrown: unknown;
      try {
        await migrateAgentsToHatch3r(tempDir);
      } catch (err) {
        thrown = err;
      }
      // The interruption error reaches the caller; the failed rollback did not
      // replace it with its own EACCES.
      expectHatchFsError(thrown);
      expect((thrown as Error).message).toMatch(/forward copy failure/);
    });

    it("emits a verbose rollback-failure note when HATCH3R_VERBOSE is set", async () => {
      const legacy = join(tempDir, AGENTS_DIR);
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, MANIFEST_FILE), '{"v":1}');
      await mkdir(join(legacy, "learnings"), { recursive: true });
      await writeFile(join(legacy, "learnings", "INDEX.md"), "x");

      mockCp.mockImplementation((src: unknown, dest: unknown, ...rest: unknown[]) => {
        if (typeof dest === "string" && dest.includes(join(HATCH3R_DIR, "learnings"))) {
          return Promise.reject(mkErrno("EIO", "EIO: forward copy failure"));
        }
        if (typeof dest === "string" && dest.includes(join(AGENTS_DIR, MANIFEST_FILE))) {
          return Promise.reject(mkErrno("EACCES", "EACCES: rollback copy failure"));
        }
        return (realCp as (...a: unknown[]) => Promise<void>)(src, dest, ...rest);
      });

      const original = process.env.HATCH3R_VERBOSE;
      process.env.HATCH3R_VERBOSE = "1";
      try {
        let thrown: unknown;
        try {
          await migrateAgentsToHatch3r(tempDir);
        } catch (err) {
          thrown = err;
        }
        expectHatchFsError(thrown);
        const concatenated = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(concatenated).toMatch(/rollback of .* failed/);
      } finally {
        if (original === undefined) delete process.env.HATCH3R_VERBOSE;
        else process.env.HATCH3R_VERBOSE = original;
        // keep realRm referenced so lint does not flag the captured handle
        void realRm;
      }
    });
  });
});
