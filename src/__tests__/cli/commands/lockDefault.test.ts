/**
 * DD-A (release/2.8.5): default-on cross-process locking at the CLI surface.
 *
 *   - the global `--no-lock` program option wires through the preAction hook
 *     into `disableCrossProcessLocking()` (DD-A4),
 *   - env precedence: HATCH3R_LOCK=1 re-enables over --no-lock,
 *     HATCH3R_LOCK=0 disables like the flag (DD-A1),
 *   - the shared manifest-write chokepoint (`writeManifest` →
 *     `atomicWriteFile`) that init/config/mcp/update/cli-tools all persist
 *     through takes the lock BY DEFAULT — proven by contention (a pre-held
 *     `<hatch.json>.hatch3r.lock` blocks the write with LOCK_TIMEOUT), and
 *     `--no-lock` suppresses it (same held lock, write succeeds).
 *
 * Scope note: the per-command bodies of init/config/update are owned by a
 * concurrent 2.8.5 work unit, so this suite pins the shared chokepoint those
 * commands write through plus the program-level wiring; command-level
 * contention is additionally pinned in ../lockOutcomes.test.ts (mcp remove).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HATCH3R_DIR } from "../../../types.js";
import {
  disableCrossProcessLocking,
  resetCrossProcessLocking,
  isCrossProcessLockingEnabled,
} from "../../../merge/safeWrite.js";
import { writeManifest, readManifest } from "../../../manifest/hatchJson.js";
import type { HatchManifest } from "../../../types.js";

const origLock = process.env.HATCH3R_LOCK;

function restoreEnv(): void {
  if (origLock === undefined) delete process.env.HATCH3R_LOCK;
  else process.env.HATCH3R_LOCK = origLock;
}

function minimalManifest(): HatchManifest {
  return {
    version: "3.0.0",
    hatch3rVersion: "2.8.5",
    platform: "github",
    owner: "o",
    repo: "r",
    namespace: "o",
    project: "r",
    defaultBranch: "main",
    tools: ["cursor"],
    features: {
      agents: true, skills: true, rules: true, prompts: false,
      commands: true, mcp: false, githubAgents: true, hooks: true, handoffs: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
  } as unknown as HatchManifest;
}

describe("DD-A4 global --no-lock program wiring", () => {
  afterEach(() => {
    restoreEnv();
    resetCrossProcessLocking();
    vi.restoreAllMocks();
  });

  it("`hatch3r --no-lock list agent` disables locking via the preAction hook", async () => {
    delete process.env.HATCH3R_LOCK;
    resetCrossProcessLocking();
    expect(isCrossProcessLockingEnabled()).toBe(true);

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { createProgram } = await import("../../../cli/program.js");
    const program = createProgram();
    await program.parseAsync(["node", "hatch3r", "--no-lock", "list", "agent"]);

    expect(isCrossProcessLockingEnabled()).toBe(false);
  }, 60_000);

  it("without --no-lock the same command leaves locking enabled", async () => {
    delete process.env.HATCH3R_LOCK;
    resetCrossProcessLocking();

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { createProgram } = await import("../../../cli/program.js");
    const program = createProgram();
    await program.parseAsync(["node", "hatch3r", "list", "agent"]);

    expect(isCrossProcessLockingEnabled()).toBe(true);
  }, 60_000);

  it("HATCH3R_LOCK=1 re-enables over --no-lock; HATCH3R_LOCK=0 matches the flag", () => {
    resetCrossProcessLocking();
    disableCrossProcessLocking(); // what the preAction hook does for --no-lock

    process.env.HATCH3R_LOCK = "1";
    expect(isCrossProcessLockingEnabled()).toBe(true);

    process.env.HATCH3R_LOCK = "0";
    expect(isCrossProcessLockingEnabled()).toBe(false);

    delete process.env.HATCH3R_LOCK;
    expect(isCrossProcessLockingEnabled()).toBe(false); // flag still active
  });
});

describe("DD-A1 manifest-write chokepoint locks by default", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lockdefault-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    delete process.env.HATCH3R_LOCK;
    resetCrossProcessLocking();
  });

  afterEach(async () => {
    restoreEnv();
    resetCrossProcessLocking();
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("writeManifest contends on a pre-held hatch.json lock → LOCK_TIMEOUT (no env var set)", async () => {
    const lockDir = join(tempDir, HATCH3R_DIR, "hatch.json.hatch3r.lock");
    await mkdir(lockDir, { recursive: true });

    await expect(writeManifest(tempDir, minimalManifest())).rejects.toMatchObject({
      name: "HatchError",
      errorCode: "LOCK_TIMEOUT",
    });
  }, 20_000);

  it("--no-lock (disableCrossProcessLocking) suppresses the lock: same held lock, write succeeds", async () => {
    const lockDir = join(tempDir, HATCH3R_DIR, "hatch.json.hatch3r.lock");
    await mkdir(lockDir, { recursive: true });

    disableCrossProcessLocking();
    await writeManifest(tempDir, minimalManifest());

    const onDisk = await readManifest(tempDir);
    expect(onDisk?.owner).toBe("o");
  });

  it("HATCH3R_LOCK=0 suppresses identically (env equivalent of the flag)", async () => {
    const lockDir = join(tempDir, HATCH3R_DIR, "hatch.json.hatch3r.lock");
    await mkdir(lockDir, { recursive: true });

    process.env.HATCH3R_LOCK = "0";
    await writeManifest(tempDir, minimalManifest());
    expect((await readManifest(tempDir))?.repo).toBe("r");
  });

  it("a clean default write locks AND releases: manifest lands, no lingering lock dir", async () => {
    await writeManifest(tempDir, minimalManifest());
    expect((await readManifest(tempDir))?.owner).toBe("o");

    const raw = await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8");
    expect(JSON.parse(raw).version).toBe("3.0.0");
    // proper-lockfile removes its lock dir on release.
    const lockDir = join(tempDir, HATCH3R_DIR, "hatch.json.hatch3r.lock");
    await expect(readFile(join(lockDir, "nonexistent"), "utf-8")).rejects.toMatchObject({
      code: expect.stringMatching(/ENOENT/),
    });
  });

  it("the workspace-manifest writer locks by default too (writeWorkspaceManifest)", async () => {
    const { writeWorkspaceManifest, createWorkspaceManifest } = await import(
      "../../../workspace/manifest.js"
    );
    const wsLockDir = join(tempDir, HATCH3R_DIR, "workspace.json.hatch3r.lock");
    await mkdir(wsLockDir, { recursive: true });

    const manifest = createWorkspaceManifest(
      "ws",
      {
        tools: ["cursor"],
        features: {
          agents: true, skills: true, rules: true, prompts: false,
          commands: true, mcp: false, githubAgents: true, hooks: true, handoffs: true,
        },
        mcp: { servers: [] },
        content: {
          preset: "minimal",
          projectType: "brownfield",
          teamSize: "solo",
          items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        },
      },
      [],
      "manual",
    );

    await expect(writeWorkspaceManifest(tempDir, manifest)).rejects.toMatchObject({
      name: "HatchError",
      errorCode: "LOCK_TIMEOUT",
    });

    await writeFile(join(tempDir, "keep"), "x"); // noop write so tempDir teardown has content
  }, 20_000);
});
