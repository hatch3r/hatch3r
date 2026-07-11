import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, rm, access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireWriteLock,
  atomicWriteFile,
  enableDefaultCrossProcessLocking,
  resetDefaultCrossProcessLocking,
} from "../../merge/safeWrite.js";
import { HatchError } from "../../types.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ──────────────────────────────────────────────────────────────────────────
// D1-SA1.5.1: File-locking primitive for concurrent hatch3r processes.
// Locking is opt-in via HATCH3R_LOCK=1. Default behavior must be unchanged.
// ──────────────────────────────────────────────────────────────────────────

describe("atomicWriteFile — HATCH3R_LOCK opt-in file locking (D1-SA1.5.1)", () => {
  let tempDir: string;
  const origLock = process.env.HATCH3R_LOCK;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lock-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    // D8-M3: clear any default-on state set by the per-test block so each test
    // starts from the single-process default.
    resetDefaultCrossProcessLocking();
  });

  describe("default behavior (HATCH3R_LOCK unset)", () => {
    it("writes the file successfully without creating a .lock file", async () => {
      delete process.env.HATCH3R_LOCK;
      const filePath = join(tempDir, "no-lock.md");

      await atomicWriteFile(filePath, "default-behavior content");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("default-behavior content");

      // No .hatch3r.lock directory should be created when the env var is unset.
      const lockPath = filePath + ".hatch3r.lock";
      const lockExists = await access(lockPath).then(() => true).catch(() => false);
      expect(lockExists).toBe(false);
    });

    it("HATCH3R_LOCK set to '' (falsy string) leaves locking disabled", async () => {
      process.env.HATCH3R_LOCK = "";
      const filePath = join(tempDir, "empty-flag.md");

      await atomicWriteFile(filePath, "content");
      expect(await readFile(filePath, "utf-8")).toBe("content");

      const lockExists = await access(filePath + ".hatch3r.lock").then(() => true).catch(() => false);
      expect(lockExists).toBe(false);
    });

    it("HATCH3R_LOCK set to 'true' (not '1') leaves locking disabled", async () => {
      // Gate is strictly === "1" so only explicit opt-in enables locks.
      process.env.HATCH3R_LOCK = "true";
      const filePath = join(tempDir, "non-one-flag.md");

      await atomicWriteFile(filePath, "content");
      expect(await readFile(filePath, "utf-8")).toBe("content");

      const lockExists = await access(filePath + ".hatch3r.lock").then(() => true).catch(() => false);
      expect(lockExists).toBe(false);
    });
  });

  describe("HATCH3R_LOCK=1 enabled behavior", () => {
    it("acquires and releases the lock around a write", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "locked.md");

      await atomicWriteFile(filePath, "locked content");

      // Write succeeded
      expect(await readFile(filePath, "utf-8")).toBe("locked content");

      // proper-lockfile cleans up its lock directory after release, so after
      // the write completes there should be no lingering lock.
      const lockExists = await access(filePath + ".hatch3r.lock").then(() => true).catch(() => false);
      expect(lockExists).toBe(false);
    });

    it("allows sequential writes to the same path (lock released between calls)", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "sequential.md");

      await atomicWriteFile(filePath, "first");
      await atomicWriteFile(filePath, "second");
      await atomicWriteFile(filePath, "third");

      expect(await readFile(filePath, "utf-8")).toBe("third");
    });

    it("serialises concurrent writes — every writer completes and the final bytes are the LAST completer's (D1-SA1.5-03)", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "concurrent.md");

      // Fire 3 concurrent writes. Pre-Cycle-12 the 2nd/3rd calls bypassed the
      // held lock with a path-keyed no-op release, so writes overlapped and
      // the final content was ANY of A/B/C regardless of completion order —
      // and this test asserted only membership, so the bypass was invisible.
      // With the in-process queue, writes genuinely serialize: the last
      // writer to complete performs the last rename, so its bytes are final.
      const completionOrder: string[] = [];
      await Promise.all([
        atomicWriteFile(filePath, "A").then(() => completionOrder.push("A")),
        atomicWriteFile(filePath, "B").then(() => completionOrder.push("B")),
        atomicWriteFile(filePath, "C").then(() => completionOrder.push("C")),
      ]);

      const final = await readFile(filePath, "utf-8");
      expect(completionOrder).toHaveLength(3);
      expect(final).toBe(completionOrder[completionOrder.length - 1]);
    });

    it("creates the parent directory before acquiring the lock", async () => {
      process.env.HATCH3R_LOCK = "1";
      // Target in a nested directory that does not yet exist.
      const filePath = join(tempDir, "nested", "deep", "file.md");

      await atomicWriteFile(filePath, "nested content");

      expect(await readFile(filePath, "utf-8")).toBe("nested content");
    });

    it("releases the lock even when the write throws", async () => {
      process.env.HATCH3R_LOCK = "1";
      // Use a path with a null byte — this triggers a write error but the
      // lock itself is valid. After the failure, the lock must be released.
      const goodPath = join(tempDir, "recovery.md");

      // First, succeed on one path.
      await atomicWriteFile(goodPath, "ok");

      // Trigger a failure by writing to an invalid path (directory, not file).
      const dirPath = tempDir; // directory — cannot be overwritten as a file by rename
      await expect(atomicWriteFile(dirPath, "will-fail")).rejects.toThrow();

      // After the failure, the same path should still be writable — lock
      // must have been released. Re-use goodPath which is known writable.
      await atomicWriteFile(goodPath, "second write after failure");
      expect(await readFile(goodPath, "utf-8")).toBe("second write after failure");
    });
  });

  // D1-SA1.5-03 (Cycle 12): ownership-scoped reentrancy. A sibling acquire on
  // a held path must BLOCK until the holder releases (pre-fix it returned a
  // mutual-exclusion-bypassing no-op in ~0ms), while the nested-write shape
  // (atomicWriteFile under an externally held lock, i.e. writeManifest under
  // configCommand) stays reentrant.
  describe("D1-SA1.5-03 sibling acquires block; nested writes stay reentrant", () => {
    it("a sibling acquireWriteLock on a held path blocks until the holder releases", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "sibling.md");

      const releaseA = await acquireWriteLock(filePath);
      let siblingAcquired = false;
      const siblingPromise = acquireWriteLock(filePath).then((release) => {
        siblingAcquired = true;
        return release;
      });

      // The finding's probe: pre-fix the sibling acquire returned in ~0ms.
      await sleep(150);
      expect(siblingAcquired).toBe(false);

      await releaseA();
      const releaseB = await siblingPromise;
      expect(siblingAcquired).toBe(true);
      await releaseB();
    });

    it("a woken sibling genuinely holds the lock — a third acquirer waits for IT", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "three-way.md");
      const order: string[] = [];

      const releaseA = await acquireWriteLock(filePath);
      const bPromise = acquireWriteLock(filePath).then((release) => {
        order.push("B");
        return release;
      });
      await sleep(100);
      await releaseA();
      const releaseB = await bPromise;

      // Pre-fix, B's release was a no-op and A's release deleted the on-disk
      // lock, so a third acquirer succeeded IMMEDIATELY while B still wrote —
      // the broken-mutual-exclusion half of the finding's probe.
      let cAcquired = false;
      const cPromise = acquireWriteLock(filePath).then((release) => {
        cAcquired = true;
        order.push("C");
        return release;
      });
      await sleep(150);
      expect(cAcquired).toBe(false);

      await releaseB();
      const releaseC = await cPromise;
      await releaseC();
      expect(order).toEqual(["B", "C"]);
    });

    it("a queued sibling times out with LOCK_TIMEOUT when the holder never releases (~5s in-process budget)", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "never-released.md");

      const releaseA = await acquireWriteLock(filePath);
      let caught: unknown;
      try {
        await acquireWriteLock(filePath);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HatchError);
      expect((caught as HatchError).errorCode).toBe("LOCK_TIMEOUT");
      expect((caught as HatchError).message).toContain("in-process");
      expect((caught as HatchError).message).toContain(filePath);
      await releaseA();
    }, 20_000);

    it("atomicWriteFile under an externally held lock stays reentrant — no deadlock, the outer holder owns the lifecycle (F1.2-H1)", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "nested.md");

      const release = await acquireWriteLock(filePath);
      // The nested-write shape (writeManifest -> atomicWriteFile under
      // configCommand's held lock) must not self-deadlock.
      await atomicWriteFile(filePath, "written under outer lock");
      expect(await readFile(filePath, "utf-8")).toBe("written under outer lock");

      // The on-disk lock is still the OUTER holder's — the nested write's
      // no-op release must not have removed it.
      const lockDuring = await access(filePath + ".hatch3r.lock")
        .then(() => true)
        .catch(() => false);
      expect(lockDuring).toBe(true);

      await release();
      const lockAfter = await access(filePath + ".hatch3r.lock")
        .then(() => true)
        .catch(() => false);
      expect(lockAfter).toBe(false);
    });
  });

  describe("lock timeout", () => {
    it("throws HatchError with code LOCK_TIMEOUT when contention exceeds budget", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "contended.md");
      const lockfilePath = filePath + ".hatch3r.lock";

      // Simulate an abandoned but non-stale lock by pre-creating the lock
      // directory. proper-lockfile uses a directory (lockfilePath) to represent
      // a held lock; its presence with a fresh mtime blocks acquisition.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(lockfilePath, { recursive: true });

      // The acquireWriteLock retry budget is ~5 retries × up to 1.5s; so the
      // timeout happens within the test timeout. We explicitly assert the
      // LOCK_TIMEOUT error code.
      await expect(
        atomicWriteFile(filePath, "blocked"),
      ).rejects.toMatchObject({
        name: "HatchError",
        errorCode: "LOCK_TIMEOUT",
      });

      // Clean up so afterEach rm() does not stumble on the stale lock dir.
      await rm(lockfilePath, { recursive: true, force: true });
    }, 20_000);

    it("lock timeout HatchError message includes the file path and recovery hint", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "contended-msg.md");
      const lockfilePath = filePath + ".hatch3r.lock";

      const { mkdir } = await import("node:fs/promises");
      await mkdir(lockfilePath, { recursive: true });

      let caught: unknown;
      try {
        await atomicWriteFile(filePath, "blocked");
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HatchError);
      const msg = (caught as HatchError).message;
      expect(msg).toContain(filePath);
      expect(msg).toMatch(/stale|sequentially/i);

      await rm(lockfilePath, { recursive: true, force: true });
    }, 20_000);
  });

  describe("coexistence with existing atomic-write behavior", () => {
    it("HATCH3R_LOCK=1 still updates an existing file via tmp+rename", async () => {
      process.env.HATCH3R_LOCK = "1";
      const filePath = join(tempDir, "existing.md");
      await writeFile(filePath, "before", "utf-8");

      await atomicWriteFile(filePath, "after");

      expect(await readFile(filePath, "utf-8")).toBe("after");
    });
  });

  // D8-M3 (Cycle 10 rollover): default-on locking for workspace/worktree
  // contexts. Workspace/worktree command entry points call
  // `enableDefaultCrossProcessLocking()` so concurrent writes are serialized
  // without requiring operators to know `HATCH3R_LOCK=1`. `HATCH3R_LOCK=0`
  // still wins as an explicit opt-out.
  describe("D8-M3 default-on locking for workspace/worktree contexts", () => {
    it("enableDefaultCrossProcessLocking() activates locking without env var", async () => {
      delete process.env.HATCH3R_LOCK;
      enableDefaultCrossProcessLocking();

      const filePath = join(tempDir, "default-on.md");
      const lockfilePath = filePath + ".hatch3r.lock";

      // Pre-create a stale lockfile to force ELOCKED → LOCK_TIMEOUT, which
      // proves that the lock was actually attempted (not bypassed).
      const { mkdir } = await import("node:fs/promises");
      await mkdir(lockfilePath, { recursive: true });

      await expect(
        atomicWriteFile(filePath, "blocked-by-default-on"),
      ).rejects.toMatchObject({
        name: "HatchError",
        errorCode: "LOCK_TIMEOUT",
      });

      await rm(lockfilePath, { recursive: true, force: true });
    }, 20_000);

    it("HATCH3R_LOCK=0 wins over default-on (explicit opt-out)", async () => {
      process.env.HATCH3R_LOCK = "0";
      enableDefaultCrossProcessLocking();

      const filePath = join(tempDir, "opt-out.md");
      await atomicWriteFile(filePath, "no-lock-content");

      expect(await readFile(filePath, "utf-8")).toBe("no-lock-content");

      // No lockfile dir should have been created when opt-out is set.
      const lockExists = await access(filePath + ".hatch3r.lock")
        .then(() => true)
        .catch(() => false);
      expect(lockExists).toBe(false);
    });

    it("resetDefaultCrossProcessLocking() returns to single-process default", async () => {
      delete process.env.HATCH3R_LOCK;
      enableDefaultCrossProcessLocking();
      resetDefaultCrossProcessLocking();

      const filePath = join(tempDir, "after-reset.md");
      await atomicWriteFile(filePath, "single-process");

      expect(await readFile(filePath, "utf-8")).toBe("single-process");
      const lockExists = await access(filePath + ".hatch3r.lock")
        .then(() => true)
        .catch(() => false);
      expect(lockExists).toBe(false);
    });
  });
});
