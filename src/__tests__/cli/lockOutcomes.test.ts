/**
 * DD-E5 (release/2.8.5): command-level lock outcomes. A second hatch3r
 * process holding a target's advisory lock must surface as a structured
 * `LOCK_TIMEOUT` HatchError carrying the derived ~3s budget figure and the
 * lockfile-path recovery text (src/merge/safeWrite.ts acquire refusal) —
 * exercised through a REAL command entry point (`mcp remove`, whose
 * `withManifestLock` wraps the whole read-modify-write), not just the
 * primitive.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HATCH3R_DIR, HatchError } from "../../types.js";
import { LOCK_RETRY_TOTAL_BACKOFF_MS } from "../../merge/safeWrite.js";
import { resetCrossProcessLocking } from "../../merge/safeWrite.js";

const origLock = process.env.HATCH3R_LOCK;

describe("DD-E5 command-level lock contention (mcp remove)", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lockout-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    await writeFile(
      join(tempDir, HATCH3R_DIR, "hatch.json"),
      JSON.stringify({
        version: "3.0.0",
        hatch3rVersion: "2.8.5",
        owner: "o",
        repo: "r",
        namespace: "o",
        project: "r",
        tools: ["cursor"],
        features: {
          agents: true, skills: true, rules: true, prompts: false,
          commands: true, mcp: true, githubAgents: true, hooks: true, handoffs: true,
        },
        mcp: { servers: ["github"] },
        managedFiles: [],
      }, null, 2),
    );
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.HATCH3R_LOCK;
    resetCrossProcessLocking();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    vi.restoreAllMocks();
    if (origLock === undefined) delete process.env.HATCH3R_LOCK;
    else process.env.HATCH3R_LOCK = origLock;
    resetCrossProcessLocking();
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("a held manifest lock makes `mcp remove` fail with LOCK_TIMEOUT, quoting the ~3s budget and the lockfile path", async () => {
    const manifestPath = join(tempDir, HATCH3R_DIR, "hatch.json");
    const lockfilePath = manifestPath + ".hatch3r.lock";
    // Simulate the second-process holder: a fresh proper-lockfile lock dir.
    await mkdir(lockfilePath, { recursive: true });

    const { mcpRemoveCommand } = await import("../../cli/commands/mcp.js");

    let caught: unknown;
    const startedMs = Date.now();
    try {
      await mcpRemoveCommand("github", {});
    } catch (err) {
      caught = err;
    }
    const elapsedMs = Date.now() - startedMs;

    expect(caught).toBeInstanceOf(HatchError);
    const err = caught as HatchError;
    expect(err.errorCode).toBe("LOCK_TIMEOUT");
    // Message quotes the DERIVED budget (~3s for the shipped retry schedule)
    // and the lockfile-path recovery text — D11-SA11.2-03's no-drift contract.
    expect(LOCK_RETRY_TOTAL_BACKOFF_MS).toBe(3000);
    expect(err.message).toContain(`~${Math.round(LOCK_RETRY_TOTAL_BACKOFF_MS / 1000)}s`);
    expect(err.message).toContain(manifestPath);
    expect(err.message).toContain(lockfilePath);
    // The refusal comes AFTER the real retry budget was spent contending.
    expect(elapsedMs).toBeGreaterThanOrEqual(2000);

    await rm(lockfilePath, { recursive: true, force: true });
  }, 30_000);

  it("without contention the same command mutates the manifest and exits cleanly", async () => {
    const { mcpRemoveCommand } = await import("../../cli/commands/mcp.js");
    await mcpRemoveCommand("github", {});

    const { readManifest } = await import("../../manifest/hatchJson.js");
    const manifest = await readManifest(tempDir);
    expect(manifest?.mcp.servers).not.toContain("github");
  }, 30_000);
});
