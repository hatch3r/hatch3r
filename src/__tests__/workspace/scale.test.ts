import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults, WorkspaceRepoEntry } from "../../workspace/types.js";
import { createWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";

/**
 * Cycle 10 D14-SA14.2-F6 (Low, governance.P2): scale benchmark harness.
 *
 * `governance/SCALE.md` documents the methodology and the measured-figure
 * table this harness populates. The suite is SKIPPED by default so a routine
 * `npm test` run does not pay the multi-repo git-init + sync cost; run it
 * explicitly to (re)measure init/sync throughput at N sub-repos:
 *
 *   HATCH3R_SCALE=1 npm test -- src/__tests__/workspace/scale.test.ts
 *
 * The assertions are correctness regression gates (every opted-in repo syncs,
 * no `error` action), NOT hard timing thresholds — wall-clock varies by host.
 * Record the observed `console.log` durations into `governance/SCALE.md`.
 */

const SCALE_ENABLED = process.env.HATCH3R_SCALE === "1";
const describeScale = SCALE_ENABLED ? describe : describe.skip;

const baseContent: ContentSelection = {
  preset: "standard",
  projectType: "greenfield",
  teamSize: "solo",
  items: {
    agents: [],
    skills: [],
    rules: ["hatch3r-agent-orchestration"],
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

describeScale("workspace sync scale benchmark (D14-SA14.2-F6)", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  function createGitRepo(dir: string): void {
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  }

  // N values per the D14-SA14.2-F6 reference grid. All three rungs are
  // HATCH3R_SCALE-gated (describeScale); none runs in the default suite —
  // 100 is the upper documented rung.
  // Per-rung timeout: the default 30s test timeout terminated the 50/100
  // rungs before the harness could log their wall-clock (and N=10 on slower
  // reference machines), which is why the governance/SCALE.md grid stayed
  // "(measure)" — a benchmark that self-terminates below its measurement
  // ceiling can never record the figures it exists to produce. 10 minutes
  // bounds a hung run without capping a legitimate 100-repo measurement.
  for (const repoCount of [10, 50, 100] as const) {
    it(`syncs a ${repoCount}-repo workspace and records wall-clock`, { timeout: 600_000 }, async () => {
      tempDir = await mkdtemp(join(tmpdir(), `hatch3r-scale-${repoCount}-`));
      await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });

      const repos: WorkspaceRepoEntry[] = [];
      for (let i = 0; i < repoCount; i++) {
        const name = `repo-${i}`;
        const repoDir = join(tempDir, name);
        await mkdir(repoDir, { recursive: true });
        createGitRepo(repoDir);
        repos.push({ path: name, name, sync: true });
      }

      const wsManifest = createWorkspaceManifest("scale", defaults, repos, "manual");
      await writeWorkspaceManifest(tempDir, wsManifest);

      const start = performance.now();
      const result = await syncWorkspaceRepos(tempDir);
      const elapsedMs = performance.now() - start;

      console.log(
        `[scale] N=${repoCount} sync wall-clock=${elapsedMs.toFixed(0)}ms ` +
          `(${(elapsedMs / repoCount).toFixed(1)}ms/repo)`,
      );

      // Correctness regression gate — every opted-in repo must sync cleanly.
      expect(result.repos).toHaveLength(repoCount);
      expect(result.repos.every((r) => r.action === "synced")).toBe(true);
      expect(result.repos.some((r) => r.action === "error")).toBe(false);
    });
  }
});
