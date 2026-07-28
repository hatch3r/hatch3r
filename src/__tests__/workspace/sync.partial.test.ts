/**
 * DD-B/E3 (release/2.8.5): partial-failure contract for the workspace
 * cascade. Before this slice `syncWorkspaceRepos` flattened every failure to
 * `err.message` and returned only `repos[]` — the CLI exited 0 with N of M
 * repos failed and no machine-readable outcome. These suites pin:
 *   - the structured per-repo error (errorCode / recoveryHint / causeChain),
 *   - the aggregate `outcome` + `counts` (passed | partial | failed),
 *   - sibling isolation (one repo's failure never blocks another's sync),
 *   - LOCK_TIMEOUT classification under real lock contention.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, chmod, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HATCH3R_DIR, DEFAULT_FEATURES, HatchError } from "../../types.js";
import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
} from "../../workspace/manifest.js";
import {
  syncWorkspaceRepos,
  toRepoSyncError,
  computeWorkspaceSyncOutcome,
} from "../../workspace/sync.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults, WorkspaceRepoSyncResult } from "../../workspace/types.js";

const baseContent: ContentSelection = {
  preset: "minimal",
  projectType: "brownfield",
  teamSize: "solo",
  items: {
    agents: ["hatch3r-implementer"],
    skills: [],
    rules: ["hatch3r-git-conventions"],
    commands: [],
    prompts: [],
    hooks: [],
    githubAgents: [],
  },
};

const defaults: WorkspaceDefaults = {
  platform: "github",
  tools: ["cursor"],
  features: { ...DEFAULT_FEATURES },
  mcp: { servers: [] },
  content: baseContent,
};

function createGitRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
}

describe("workspace sync partial-failure contract (DD-B2/B3/B4)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      // Restore write permission before rm in case a chmod test failed midway.
      await chmod(tempDir, 0o755).catch(() => undefined);
      for (const sub of ["api", "web", "locked"]) {
        await chmod(join(tempDir, sub), 0o755).catch(() => undefined);
      }
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  async function setupWorkspace(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-partial-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    return tempDir;
  }

  it("mixed run: 1 failed + 1 synced → outcome 'partial', counts exact, errorDetail retained", async () => {
    const ws = await setupWorkspace();
    await mkdir(join(ws, "api"), { recursive: true });
    createGitRepo(join(ws, "api"));
    // "web" is registered but the directory does not exist → per-repo error.

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: true },
    ], "manual");
    await writeWorkspaceManifest(ws, wsManifest);

    const result = await syncWorkspaceRepos(ws);

    expect(result.outcome).toBe("partial");
    expect(result.counts).toEqual({ total: 2, synced: 1, failed: 1, skipped: 0, dryRun: 0 });

    const failed = result.repos.find((r) => r.path === "web");
    expect(failed?.action).toBe("error");
    // Legacy string mirror kept for renderers…
    expect(failed?.error).toContain("not found");
    // …and the structured twin carries the machine-readable class + fix.
    expect(failed?.errorDetail?.errorCode).toBe("FS_ERROR");
    expect(failed?.errorDetail?.message).toContain("not found");
    expect(failed?.errorDetail?.recoveryHint).toContain("workspace.json");

    const ok = result.repos.find((r) => r.path === "api");
    expect(ok?.action).toBe("synced");
    expect(ok?.errorDetail).toBeUndefined();
  }, 60_000);

  it("all-success run → outcome 'passed' with zero failed", async () => {
    const ws = await setupWorkspace();
    await mkdir(join(ws, "api"), { recursive: true });
    createGitRepo(join(ws, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(ws, wsManifest);

    const result = await syncWorkspaceRepos(ws);

    expect(result.outcome).toBe("passed");
    expect(result.counts.failed).toBe(0);
    expect(result.counts.synced).toBe(1);
  }, 60_000);

  it("LOCK_TIMEOUT under contention: a held member-manifest lock classifies as LOCK_TIMEOUT and the sibling still syncs", async () => {
    const ws = await setupWorkspace();
    await mkdir(join(ws, "api"), { recursive: true });
    createGitRepo(join(ws, "api"));
    await mkdir(join(ws, "locked"), { recursive: true });
    createGitRepo(join(ws, "locked"));

    // Hold the cross-process lock on the member's hatch.json (the fixture
    // pattern from safeWrite.fileLock.test.ts): a fresh pre-created
    // `<target>.hatch3r.lock` dir makes proper-lockfile contend until the
    // ~3s retry budget expires → HatchError(LOCK_TIMEOUT). DD-A1: locking is
    // default-on, so no env var is needed for the writer to contend.
    const memberManifest = join(ws, "locked", HATCH3R_DIR, "hatch.json");
    await mkdir(memberManifest + ".hatch3r.lock", { recursive: true });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "locked", name: "locked", sync: true },
    ], "manual");
    await writeWorkspaceManifest(ws, wsManifest);

    const result = await syncWorkspaceRepos(ws);

    expect(result.outcome).toBe("partial");
    const lockedRepo = result.repos.find((r) => r.path === "locked");
    expect(lockedRepo?.action).toBe("error");
    expect(lockedRepo?.errorDetail?.errorCode).toBe("LOCK_TIMEOUT");
    // The sibling is isolated from the contention.
    expect(result.repos.find((r) => r.path === "api")?.action).toBe("synced");
  }, 120_000);

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "permission failure on one repo (chmod 0o555) → that repo errors, sibling still syncs",
    async () => {
      const ws = await setupWorkspace();
      await mkdir(join(ws, "api"), { recursive: true });
      createGitRepo(join(ws, "api"));
      await mkdir(join(ws, "web"), { recursive: true });
      createGitRepo(join(ws, "web"));
      // Read-only repo dir: the member `.hatch3r/` mkdir fails EACCES.
      await chmod(join(ws, "web"), 0o555);

      const wsManifest = createWorkspaceManifest("test", defaults, [
        { path: "api", name: "api", sync: true },
        { path: "web", name: "web", sync: true },
      ], "manual");
      await writeWorkspaceManifest(ws, wsManifest);

      const result = await syncWorkspaceRepos(ws);

      expect(result.outcome).toBe("partial");
      const failed = result.repos.find((r) => r.path === "web");
      expect(failed?.action).toBe("error");
      expect(failed?.error).toMatch(/EACCES|permission/i);
      expect(result.repos.find((r) => r.path === "api")?.action).toBe("synced");

      // Verify the sibling's output landed on disk.
      await access(join(ws, "api", HATCH3R_DIR, "hatch.json"));
    },
    120_000,
  );
});

describe("toRepoSyncError (DD-B3)", () => {
  it("preserves errorCode + recoveryHint from a HatchError", () => {
    const err = new HatchError("boom", undefined, "LOCK_TIMEOUT", "wait and retry");
    expect(toRepoSyncError(err)).toEqual({
      message: "boom",
      errorCode: "LOCK_TIMEOUT",
      recoveryHint: "wait and retry",
    });
  });

  it("collects the Error.cause chain outermost-first, capped at 5 links", () => {
    let cursor: Error = new Error("deepest");
    for (let i = 0; i < 7; i++) {
      cursor = new Error(`level-${6 - i}`, { cause: cursor });
    }
    const detail = toRepoSyncError(new HatchError("outer", undefined, "FS_ERROR", undefined, { cause: cursor }));
    expect(detail.errorCode).toBe("FS_ERROR");
    expect(detail.causeChain).toHaveLength(5);
    expect(detail.causeChain?.[0]).toBe("level-0");
  });

  it("flattens a plain Error and a non-Error throw", () => {
    expect(toRepoSyncError(new Error("plain"))).toEqual({ message: "plain" });
    expect(toRepoSyncError("string-throw")).toEqual({ message: "string-throw" });
  });

  it("stringifies a non-Error cause link", () => {
    const err = new Error("outer", { cause: "raw-cause" });
    expect(toRepoSyncError(err)).toEqual({ message: "outer", causeChain: ["raw-cause"] });
  });
});

describe("computeWorkspaceSyncOutcome (DD-B4)", () => {
  const repo = (action: WorkspaceRepoSyncResult["action"]): WorkspaceRepoSyncResult => ({
    path: "x",
    added: [],
    removed: [],
    toolsSynced: [],
    action,
  });

  it("zero repos → passed", () => {
    expect(computeWorkspaceSyncOutcome([]).outcome).toBe("passed");
  });

  it("all synced → passed; mixed → partial; all error → failed", () => {
    expect(computeWorkspaceSyncOutcome([repo("synced"), repo("synced")]).outcome).toBe("passed");
    expect(computeWorkspaceSyncOutcome([repo("synced"), repo("error")]).outcome).toBe("partial");
    expect(computeWorkspaceSyncOutcome([repo("error"), repo("error")]).outcome).toBe("failed");
  });

  it("dry-run and skipped rows are non-failures and are tallied", () => {
    const { outcome, counts } = computeWorkspaceSyncOutcome([
      repo("dry-run"),
      repo("skipped"),
      repo("synced"),
    ]);
    expect(outcome).toBe("passed");
    expect(counts).toEqual({ total: 3, synced: 1, failed: 0, skipped: 1, dryRun: 1 });
  });
});
