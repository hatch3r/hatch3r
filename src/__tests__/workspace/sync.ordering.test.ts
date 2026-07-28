/**
 * DD-E2 (release/2.8.5): write-ordering characterization for a member-repo
 * sync. The durable contract in `workspace/sync.ts::syncSingleRepo`:
 *
 *   1. member manifest written FIRST (identity + selection recorded before
 *      any adapter output lands — a crash mid-adapter leaves an attributable
 *      member),
 *   2. adapter outputs stream through `safeWriteFile`,
 *   3. member manifest written AGAIN LAST with managedFiles +
 *      managedFilesByAdapter populated (the orphan-sweep baseline for the
 *      next run).
 *
 * Spies wrap the REAL `writeManifest` / `safeWriteFile` (importOriginal) and
 * record a shared call sequence; the on-disk outcome is the production one.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults } from "../../workspace/types.js";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("../../manifest/hatchJson.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../manifest/hatchJson.js")>();
  return {
    ...actual,
    writeManifest: async (...args: Parameters<typeof actual.writeManifest>) => {
      calls.push("writeManifest");
      return actual.writeManifest(...args);
    },
  };
});

vi.mock("../../merge/safeWrite.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../merge/safeWrite.js")>();
  return {
    ...actual,
    safeWriteFile: async (...args: Parameters<typeof actual.safeWriteFile>) => {
      calls.push("safeWriteFile");
      return actual.safeWriteFile(...args);
    },
  };
});

import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
} from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";

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

describe("workspace sync write ordering (manifest-first, managedFiles-last)", () => {
  let tempDir: string;

  afterEach(async () => {
    calls.length = 0;
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("member manifest is written before any adapter output, and again after the last one", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-order-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    await mkdir(join(tempDir, "api"), { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: join(tempDir, "api"), stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: join(tempDir, "api"), stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "T"], { cwd: join(tempDir, "api"), stdio: "pipe" });

    await writeWorkspaceManifest(
      tempDir,
      createWorkspaceManifest("order", defaults, [{ path: "api", sync: true }], "manual"),
    );
    calls.length = 0; // discard fixture-setup writes

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.outcome).toBe("passed");

    const manifestWrites = calls
      .map((c, i) => (c === "writeManifest" ? i : -1))
      .filter((i) => i !== -1);
    const adapterWrites = calls
      .map((c, i) => (c === "safeWriteFile" ? i : -1))
      .filter((i) => i !== -1);

    // Exactly two member-manifest writes per synced repo: identity-first,
    // managedFiles-last.
    expect(manifestWrites).toHaveLength(2);
    // The cursor adapter emits at least one output for the fixture selection.
    expect(adapterWrites.length).toBeGreaterThan(0);
    // Manifest-before-adapters…
    expect(manifestWrites[0]).toBeLessThan(adapterWrites[0]);
    // …and managedFiles persisted after the final adapter write.
    expect(manifestWrites[1]).toBeGreaterThan(adapterWrites[adapterWrites.length - 1]);
  }, 60_000);
});
