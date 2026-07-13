import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

// ───────────────────────────────────────────────────────────────────────────
// Lock-path branch coverage for src/merge/safeWrite.ts that the real-fs
// fileLock suite cannot reach deterministically:
//   - acquireWriteLock reentrancy (HELD_LOCKS short-circuit, line 177)
//   - acquireWriteLock non-ELOCKED error rethrow (line 216)
//   - atomicWriteFile release()-throws diagnostic when locking active (356-357)
//   - resolveLockStaleMs env-var parsing branches (75-77)
//
// These mock `proper-lockfile` so the lock primitive returns a controllable
// release function (and can be made to throw arbitrary errors).
// ───────────────────────────────────────────────────────────────────────────

function mkErrno(code: string, message = ""): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(message || code);
  err.code = code;
  return err;
}

describe("acquireWriteLock — reentrancy and non-ELOCKED errors (mocked proper-lockfile)", () => {
  let tempDir: string;
  const origLock = process.env.HATCH3R_LOCK;
  const mockLock = vi.fn<(...args: unknown[]) => Promise<() => Promise<void>>>();

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lockbranch-"));

    vi.doMock("proper-lockfile", () => ({
      lock: mockLock,
    }));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    vi.doUnmock("proper-lockfile");
    vi.resetModules();
  });

  // D1-SA1.5-03 (Cycle 12): the pre-fix contract made ANY second acquire on a
  // held path a no-op (path-keyed reentrancy) — including a concurrent sibling
  // task outside the holder's call chain, which silently bypassed mutual
  // exclusion. The two tests below pin the REPLACEMENT contract: sibling
  // EXTERNAL acquires queue; only the nested-write shape stays reentrant.
  it("a sibling EXTERNAL acquire on a held path queues instead of returning a no-op (D1-SA1.5-03)", async () => {
    process.env.HATCH3R_LOCK = "1";
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockLock.mockResolvedValue(release);

    const { acquireWriteLock } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "sibling.md");

    const releaseOuter = await acquireWriteLock(filePath);
    expect(mockLock).toHaveBeenCalledTimes(1);

    let siblingAcquired = false;
    const siblingPromise = acquireWriteLock(filePath).then((r) => {
      siblingAcquired = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    // Pre-fix this resolved instantly with a no-op release.
    expect(siblingAcquired).toBe(false);
    expect(mockLock).toHaveBeenCalledTimes(1);

    await releaseOuter();
    const releaseSibling = await siblingPromise;
    expect(siblingAcquired).toBe(true);
    // The woken sibling took a REAL lock of its own (second proper-lockfile
    // call) — pre-fix its "release" was unattributable to any lock at all.
    expect(mockLock).toHaveBeenCalledTimes(2);
    await releaseSibling();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("a nested atomicWriteFile under an externally held lock stays reentrant (F1.2-H1 shape preserved)", async () => {
    process.env.HATCH3R_LOCK = "1";
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockLock.mockResolvedValue(release);

    const { acquireWriteLock, atomicWriteFile } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "reentrant.md");

    // Outer acquire takes the real on-disk lock exactly once.
    const releaseOuter = await acquireWriteLock(filePath);
    // The nested write (writeManifest -> atomicWriteFile under configCommand)
    // must NOT call proper-lockfile again and must not deadlock behind the
    // outer holder — its internal acquire no-ops for external holders.
    await atomicWriteFile(filePath, "nested write");
    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(await readFile(filePath, "utf-8")).toBe("nested write");

    // Releasing the outer releases the real proper-lockfile lock.
    await releaseOuter();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-ELOCKED error from proper-lockfile unchanged (not wrapped as LOCK_TIMEOUT)", async () => {
    process.env.HATCH3R_LOCK = "1";
    // proper-lockfile can surface filesystem errors (e.g. EACCES creating the
    // lockfile). Only ELOCKED is translated to LOCK_TIMEOUT; everything else
    // must propagate verbatim so the operator sees the real cause.
    mockLock.mockRejectedValue(mkErrno("EACCES", "cannot create lockfile"));

    const { acquireWriteLock } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "lock-eacces.md");

    await expect(acquireWriteLock(filePath)).rejects.toMatchObject({
      code: "EACCES",
      message: "cannot create lockfile",
    });
    // It must NOT have been rewrapped into a HatchError/LOCK_TIMEOUT.
    await expect(acquireWriteLock(filePath)).rejects.not.toMatchObject({
      errorCode: "LOCK_TIMEOUT",
    });
  });

  it("translates ELOCKED to a LOCK_TIMEOUT HatchError (via the mocked lock)", async () => {
    process.env.HATCH3R_LOCK = "1";
    mockLock.mockRejectedValue(mkErrno("ELOCKED", "held"));

    const { acquireWriteLock } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "lock-elocked.md");

    await expect(acquireWriteLock(filePath)).rejects.toMatchObject({
      name: "HatchError",
      errorCode: "LOCK_TIMEOUT",
    });
  });
});

// D1-SA1.5-04 (Cycle 12): safeWriteFile must hold the write lock across the
// FULL read-merge-write. Pre-fix, the lock was acquired inside atomicWriteFile
// — AFTER the merge decision had consumed a possibly-stale read — so content
// written between a run's read and its locked write was silently clobbered.
describe("safeWriteFile — lock spans the full read-merge-write (D1-SA1.5-04, mocked proper-lockfile)", () => {
  let tempDir: string;
  const origLock = process.env.HATCH3R_LOCK;
  const mockLock = vi.fn<(...args: unknown[]) => Promise<() => Promise<void>>>();

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-rmwlock-"));
    vi.doMock("proper-lockfile", () => ({ lock: mockLock }));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    vi.doUnmock("proper-lockfile");
    vi.resetModules();
  });

  it("computes the merge from content read AFTER the lock is granted, not from a pre-lock snapshot", async () => {
    process.env.HATCH3R_LOCK = "1";
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let grantLock!: (r: () => Promise<void>) => void;
    mockLock.mockImplementation(
      () =>
        new Promise<() => Promise<void>>((resolveLock) => {
          grantLock = resolveLock;
        }),
    );

    const { safeWriteFile } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "AGENTS.md");
    const original = [
      "<!-- HATCH3R:BEGIN -->",
      "old managed body",
      "<!-- HATCH3R:END -->",
      "",
      "# User notes v1",
    ].join("\n");
    await writeFile(filePath, original, "utf-8");

    const writePromise = safeWriteFile(filePath, "ignored", {
      managedContent: "new managed body",
    });
    // Let safeWriteFile reach the (still pending) entry lock acquisition.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockLock).toHaveBeenCalledTimes(1);

    // A concurrent writer lands while our run waits for the lock — the exact
    // interleaving from the finding. Pre-fix, safeWriteFile had ALREADY read
    // the file before any lock, so this edit was clobbered by its merge.
    const mutated = original.replace("# User notes v1", "# User notes v2 (edited mid-wait)");
    await writeFile(filePath, mutated, "utf-8");

    grantLock(release);
    const result = await writePromise;
    expect(result.action).toBe("updated");

    const final = await readFile(filePath, "utf-8");
    expect(final).toContain("new managed body");
    expect(final).toContain("# User notes v2 (edited mid-wait)");
    expect(final).not.toContain("# User notes v1");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("atomicWriteFile — release() failure diagnostic (mocked proper-lockfile)", () => {
  let tempDir: string;
  const origLock = process.env.HATCH3R_LOCK;
  const mockLock = vi.fn<(...args: unknown[]) => Promise<() => Promise<void>>>();

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lockrel-"));
    vi.doMock("proper-lockfile", () => ({ lock: mockLock }));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    vi.doUnmock("proper-lockfile");
    vi.resetModules();
  });

  it("emits a console.error diagnostic (and does NOT throw) when release() rejects while locking is active", async () => {
    process.env.HATCH3R_LOCK = "1";
    // The lock is acquired fine, the write succeeds, but releasing the lock in
    // the finally block throws. Per the Silent Failure Contract the original
    // operation must still succeed and the release failure must be logged.
    const release = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("release boom"));
    mockLock.mockResolvedValue(release);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { atomicWriteFile } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "release-fail.md");

    try {
      // Must NOT reject — the write itself succeeded; only the release failed.
      await expect(atomicWriteFile(filePath, "ok content")).resolves.toBeUndefined();

      // File was written correctly.
      expect(await readFile(filePath, "utf-8")).toBe("ok content");

      // Diagnostic surfaced because locking was active for this call.
      expect(errorSpy).toHaveBeenCalled();
      const msg = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(msg).toContain("failed to release write lock");
      expect(msg).toContain(filePath);
      expect(msg).toContain("release boom");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stringifies a non-Error release rejection in the release diagnostic", async () => {
    process.env.HATCH3R_LOCK = "1";
    // releaseErr instanceof Error ? .message : String(releaseErr) — exercise
    // the String() branch by rejecting the release with a non-Error value.
    const release = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue("plain-string-rejection");
    mockLock.mockResolvedValue(release);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { atomicWriteFile } = await import("../../merge/safeWrite.js");
    const filePath = join(tempDir, "release-fail-2.md");

    try {
      await atomicWriteFile(filePath, "content");
      const msg = errorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(msg).toContain("failed to release write lock");
      expect(msg).toContain("plain-string-rejection");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("resolveLockStaleMs env-var parsing (HATCH3R_LOCK_STALE_MS, mocked proper-lockfile)", () => {
  // resolveLockStaleMs is module-internal; observe its result via the `stale`
  // option passed to the mocked proper-lockfile.lock. Each env value drives a
  // distinct branch: undefined/blank → default; non-finite/≤0 → default;
  // valid-large → that value; sub-floor → clamped up to the floor.
  let tempDir: string;
  const origLock = process.env.HATCH3R_LOCK;
  const origStale = process.env.HATCH3R_LOCK_STALE_MS;
  const mockLock = vi.fn<(...args: unknown[]) => Promise<() => Promise<void>>>();

  const DEFAULT_MS = 15_000;
  const FLOOR_MS = 2_000;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-stale-"));
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockLock.mockResolvedValue(release);
    vi.doMock("proper-lockfile", () => ({ lock: mockLock }));
    process.env.HATCH3R_LOCK = "1";
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    if (origStale === undefined) delete process.env.HATCH3R_LOCK_STALE_MS;
    else process.env.HATCH3R_LOCK_STALE_MS = origStale;
    vi.doUnmock("proper-lockfile");
    vi.resetModules();
  });

  async function acquireAndReadStale(): Promise<number> {
    // Re-import fresh so the env var is read at call time (resolveLockStaleMs
    // reads process.env on each acquire).
    const { acquireWriteLock } = await import("../../merge/safeWrite.js");
    const release = await acquireWriteLock(join(tempDir, `f-${Math.random()}.md`));
    await release();
    const lastCall = mockLock.mock.calls.at(-1);
    const opts = lastCall?.[1] as { stale: number };
    return opts.stale;
  }

  it("uses the 15s default when HATCH3R_LOCK_STALE_MS is unset", async () => {
    delete process.env.HATCH3R_LOCK_STALE_MS;
    expect(await acquireAndReadStale()).toBe(DEFAULT_MS);
  });

  it("uses the default when HATCH3R_LOCK_STALE_MS is blank/whitespace", async () => {
    process.env.HATCH3R_LOCK_STALE_MS = "   ";
    expect(await acquireAndReadStale()).toBe(DEFAULT_MS);
  });

  it("falls back to the default for a non-numeric value", async () => {
    process.env.HATCH3R_LOCK_STALE_MS = "not-a-number";
    expect(await acquireAndReadStale()).toBe(DEFAULT_MS);
  });

  it("falls back to the default for a non-positive value (0 / negative)", async () => {
    process.env.HATCH3R_LOCK_STALE_MS = "0";
    expect(await acquireAndReadStale()).toBe(DEFAULT_MS);
    process.env.HATCH3R_LOCK_STALE_MS = "-500";
    expect(await acquireAndReadStale()).toBe(DEFAULT_MS);
  });

  it("honours a valid large override above the floor (truncated to integer)", async () => {
    process.env.HATCH3R_LOCK_STALE_MS = "30000.9";
    // Math.trunc → 30000, which is >= floor so used as-is.
    expect(await acquireAndReadStale()).toBe(30_000);
  });

  it("clamps a sub-floor positive value up to the 2s floor", async () => {
    process.env.HATCH3R_LOCK_STALE_MS = "500";
    expect(await acquireAndReadStale()).toBe(FLOOR_MS);
  });
});
