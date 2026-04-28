import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkWorkspace,
  cleanWorkspace,
  PRESERVE_LIST,
  readBaselineCommitTime,
} from "../../audit/cleanup.js";

const execFileAsync = promisify(execFile);

interface Fixture {
  dir: string;
  workspaceDir: string;
  baseline: string;
}

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "hatch3r-cleanup-"));
  const workspaceDir = join(dir, ".audit-workspace");
  const baseline = join(dir, "governance", "audit", "baseline.json");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(dir, "governance", "audit"), { recursive: true });
  return { dir, workspaceDir, baseline };
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

/** Set both atime and mtime to a specific epoch ms. */
async function setMtime(path: string, ms: number): Promise<void> {
  const seconds = ms / 1000;
  await utimes(path, seconds, seconds);
}

const NOW = 1_777_000_000_000; // arbitrary fixed "now" for deterministic tests
const STALE_CUTOFF = 1_776_000_000_000; // 1000s earlier
const STALE_TIME = STALE_CUTOFF - 1_000_000; // older than cutoff
const FRESH_TIME = STALE_CUTOFF + 1_000_000; // newer than cutoff

describe("checkWorkspace", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("returns an empty report on an empty workspace", async () => {
    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(0);
    expect(report.stale).toEqual([]);
    expect(report.fresh).toEqual([]);
    expect(report.preserved).toEqual([]);
    expect(report.cutoffMs).toBe(STALE_CUTOFF);
  });

  it("reports preserved root files separately from scanned", async () => {
    for (const name of PRESERVE_LIST) {
      await writeFile(join(fx.workspaceDir, name), "preserved");
    }
    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(0);
    expect(report.stale).toEqual([]);
    expect(report.fresh).toEqual([]);
    expect(report.preserved.sort()).toEqual([...PRESERVE_LIST].sort());
  });

  it("classifies a stale non-preserved root file as stale", async () => {
    const target = join(fx.workspaceDir, "stale-marker.md");
    await writeFile(target, "old");
    await setMtime(target, STALE_TIME);

    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(1);
    expect(report.stale).toEqual(["stale-marker.md"]);
    expect(report.fresh).toEqual([]);
  });

  it("classifies a fresh non-preserved root file as fresh", async () => {
    const target = join(fx.workspaceDir, "fresh-marker.md");
    await writeFile(target, "new");
    await setMtime(target, FRESH_TIME);

    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(1);
    expect(report.fresh).toEqual(["fresh-marker.md"]);
    expect(report.stale).toEqual([]);
  });

  it("inspects subdirectories at one level (treated as removable units)", async () => {
    // A stale subdirectory and a fresh subdirectory.
    const staleSubdir = join(fx.workspaceDir, "wave-3");
    const freshSubdir = join(fx.workspaceDir, "wave-4");
    await mkdir(staleSubdir);
    await mkdir(freshSubdir);
    // Files inside (cleanup walks one level for root entries; subdir mtime is
    // what matters for stale-vs-fresh classification of the dir itself).
    await writeFile(join(staleSubdir, "leaf.md"), "x");
    await writeFile(join(freshSubdir, "leaf.md"), "y");
    await setMtime(staleSubdir, STALE_TIME);
    await setMtime(freshSubdir, FRESH_TIME);

    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(2);
    expect(report.stale).toEqual(["wave-3"]);
    expect(report.fresh).toEqual(["wave-4"]);
  });

  it("uses an explicit baselineCommitTime as cutoff", async () => {
    const target = join(fx.workspaceDir, "marker.md");
    await writeFile(target, "x");
    // mtime is between two candidate cutoffs:
    const mtimeMs = 1_770_000_000_000;
    await setMtime(target, mtimeMs);

    // Cutoff before mtime → fresh.
    const r1 = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: mtimeMs - 5_000_000,
    });
    expect(r1.fresh).toEqual(["marker.md"]);
    expect(r1.stale).toEqual([]);

    // Cutoff after mtime → stale.
    const r2 = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: mtimeMs + 5_000_000,
    });
    expect(r2.stale).toEqual(["marker.md"]);
    expect(r2.fresh).toEqual([]);
  });

  it("falls back to a 7-day cutoff when baselineCommitTime is omitted", async () => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const old = join(fx.workspaceDir, "old.md");
    const recent = join(fx.workspaceDir, "recent.md");
    await writeFile(old, "x");
    await writeFile(recent, "y");
    // Set explicit mtimes so they bracket the 7-day window.
    const now = Date.now();
    await setMtime(old, now - sevenDaysMs - 60_000); // 7d + 1m old
    await setMtime(recent, now - 60_000); // 1m old

    const report = await checkWorkspace({ workspaceDir: fx.workspaceDir });
    expect(report.stale).toContain("old.md");
    expect(report.fresh).toContain("recent.md");
  });

  it("ignores a `cold/` subdirectory entirely (archive-managed)", async () => {
    const cold = join(fx.workspaceDir, "cold");
    await mkdir(cold);
    await writeFile(join(cold, "cycle-3.tar.gz"), "x");
    await setMtime(cold, STALE_TIME); // even when stale, must be ignored

    const report = await checkWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(0);
    expect(report.stale).toEqual([]);
    expect(report.fresh).toEqual([]);
    expect(report.preserved).toEqual([]); // cold isn't in PRESERVE_LIST
  });

  it("returns an empty report when the workspace dir does not exist", async () => {
    const phantom = join(fx.dir, "nonexistent-dir");
    const report = await checkWorkspace({
      workspaceDir: phantom,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(report.scanned).toBe(0);
    expect(report.stale).toEqual([]);
    expect(report.fresh).toEqual([]);
    expect(report.preserved).toEqual([]);
  });
});

describe("cleanWorkspace", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("returns empty `removed` in dryRun mode (no files unlinked)", async () => {
    const target = join(fx.workspaceDir, "stale.md");
    await writeFile(target, "x");
    await setMtime(target, STALE_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
      dryRun: true,
    });
    expect(result.removed).toEqual([]);
    expect(result.report.stale).toEqual(["stale.md"]);
    expect(await fileExists(target)).toBe(true);
  });

  it("non-strict cleanup removes only stale files", async () => {
    const stale = join(fx.workspaceDir, "stale.md");
    const fresh = join(fx.workspaceDir, "fresh.md");
    await writeFile(stale, "x");
    await writeFile(fresh, "y");
    await setMtime(stale, STALE_TIME);
    await setMtime(fresh, FRESH_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(result.removed).toEqual(["stale.md"]);
    expect(await fileExists(stale)).toBe(false);
    expect(await fileExists(fresh)).toBe(true);
  });

  it("strict cleanup removes both stale and fresh non-preserved files", async () => {
    const stale = join(fx.workspaceDir, "stale.md");
    const fresh = join(fx.workspaceDir, "fresh.md");
    await writeFile(stale, "x");
    await writeFile(fresh, "y");
    await setMtime(stale, STALE_TIME);
    await setMtime(fresh, FRESH_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
      strict: true,
    });
    expect(result.removed.sort()).toEqual(["fresh.md", "stale.md"]);
    expect(await fileExists(stale)).toBe(false);
    expect(await fileExists(fresh)).toBe(false);
  });

  it("never removes preserved root files (even with strict)", async () => {
    for (const name of PRESERVE_LIST) {
      const p = join(fx.workspaceDir, name);
      await writeFile(p, "x");
      await setMtime(p, STALE_TIME); // very stale, still preserved
    }
    // Drop a stale non-preserved file so there's something to remove.
    const stale = join(fx.workspaceDir, "stale.md");
    await writeFile(stale, "x");
    await setMtime(stale, STALE_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
      strict: true,
    });
    expect(result.removed).toEqual(["stale.md"]);
    for (const name of PRESERVE_LIST) {
      expect(await fileExists(join(fx.workspaceDir, name))).toBe(true);
    }
  });

  it("recursively removes non-preserved subdir trees with content", async () => {
    const subdir = join(fx.workspaceDir, "wave-3");
    const nested = join(subdir, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(subdir, "summary.md"), "x");
    await writeFile(join(nested, "deep.md"), "y");
    await setMtime(subdir, STALE_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(result.removed).toEqual(["wave-3"]);
    expect(await fileExists(subdir)).toBe(false);
    // Confirm whole tree is gone.
    const remaining = await readdir(fx.workspaceDir);
    expect(remaining).toEqual([]);
  });

  it("removes empty stale subdirs as a unit", async () => {
    const subdir = join(fx.workspaceDir, "wave-empty");
    await mkdir(subdir);
    await setMtime(subdir, STALE_TIME);

    const result = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(result.removed).toEqual(["wave-empty"]);
    expect(await fileExists(subdir)).toBe(false);
  });

  it("leaves `cold/` subdir alone in both default and strict modes", async () => {
    const cold = join(fx.workspaceDir, "cold");
    await mkdir(cold);
    await writeFile(join(cold, "cycle-3.tar.gz"), "archive");
    await setMtime(cold, STALE_TIME);

    // Default mode.
    const r1 = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
    });
    expect(r1.removed).toEqual([]);
    expect(await fileExists(cold)).toBe(true);

    // Strict mode.
    const r2 = await cleanWorkspace({
      workspaceDir: fx.workspaceDir,
      baselineCommitTime: STALE_CUTOFF,
      strict: true,
    });
    expect(r2.removed).toEqual([]);
    expect(await fileExists(cold)).toBe(true);
  });
});

describe("readBaselineCommitTime", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fx);
  });

  it("returns null when baseline.json is missing", async () => {
    const ms = await readBaselineCommitTime(
      join(fx.dir, "governance/audit/missing.json"),
    );
    expect(ms).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    await writeFile(fx.baseline, "{ not json");
    const ms = await readBaselineCommitTime(fx.baseline);
    expect(ms).toBeNull();
  });

  it("returns null when JSON is a non-object root", async () => {
    await writeFile(fx.baseline, JSON.stringify(["array"]));
    const ms = await readBaselineCommitTime(fx.baseline);
    expect(ms).toBeNull();
  });

  it("uses commit_time_ms verbatim when present", async () => {
    await writeFile(
      fx.baseline,
      JSON.stringify({ commit_time_ms: 1_777_000_000_000 }),
    );
    expect(await readBaselineCommitTime(fx.baseline)).toBe(1_777_000_000_000);
  });

  it("uses committedAtMs when commit_time_ms is absent", async () => {
    await writeFile(
      fx.baseline,
      JSON.stringify({ committedAtMs: 1_776_000_000_000 }),
    );
    expect(await readBaselineCommitTime(fx.baseline)).toBe(1_776_000_000_000);
  });

  it("multiplies commitTime (seconds-epoch) by 1000", async () => {
    await writeFile(fx.baseline, JSON.stringify({ commitTime: 1_700_000_000 }));
    expect(await readBaselineCommitTime(fx.baseline)).toBe(1_700_000_000_000);
  });

  it("resolves a sha-only baseline via `git log -1 --format=%ct`", async () => {
    // Run inside the real repo (process.cwd()) so HEAD resolves predictably.
    const { stdout: shaRaw } = await execFileAsync("git", [
      "rev-parse",
      "HEAD",
    ]);
    const sha = shaRaw.trim();
    const { stdout: ctRaw } = await execFileAsync("git", [
      "log",
      "-1",
      "--format=%ct",
      sha,
    ]);
    const expectedMs = Number(ctRaw.trim()) * 1000;

    // The baseline file lives inside a tmp dir, but execFile invokes git in
    // the inherited cwd which is the repo root. The sha is repo-resolvable.
    await writeFile(fx.baseline, JSON.stringify({ commit_sha: sha }));
    expect(await readBaselineCommitTime(fx.baseline)).toBe(expectedMs);
  });

  it("falls back to baselineCommit when commit_sha is absent", async () => {
    const { stdout: shaRaw } = await execFileAsync("git", [
      "rev-parse",
      "HEAD",
    ]);
    const sha = shaRaw.trim();
    await writeFile(fx.baseline, JSON.stringify({ baselineCommit: sha }));
    const ms = await readBaselineCommitTime(fx.baseline);
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThan(0);
  });

  it("returns null when the sha does not resolve via git", async () => {
    await writeFile(
      fx.baseline,
      JSON.stringify({ commit_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
    );
    const ms = await readBaselineCommitTime(fx.baseline);
    expect(ms).toBeNull();
  });

  it("rejects a non-hex `commit_sha` field (no shell injection surface)", async () => {
    await writeFile(
      fx.baseline,
      // Even if the baseline carried a malicious string, we never pass it to
      // a shell — execFile takes argv directly. The hex-shape check rejects
      // it before the git call. Validates the defensive guard.
      JSON.stringify({ commit_sha: "; rm -rf /" }),
    );
    expect(await readBaselineCommitTime(fx.baseline)).toBeNull();
  });

  it("uses the project-shape `commit` field as a fallback sha source", async () => {
    // Our own governance/audit/baseline.json uses `commit` (not commit_sha).
    // Validates we accept that shape too.
    const { stdout: shaRaw } = await execFileAsync("git", [
      "rev-parse",
      "HEAD",
    ]);
    const sha = shaRaw.trim();
    await writeFile(fx.baseline, JSON.stringify({ commit: sha }));
    const ms = await readBaselineCommitTime(fx.baseline);
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThan(0);
  });
});
