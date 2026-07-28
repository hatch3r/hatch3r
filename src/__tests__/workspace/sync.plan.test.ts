/**
 * DD-E1 (release/2.8.5): resolved-plan characterization for the workspace
 * layered merge (defaults → groups → overrides → lockedContent/floor),
 * exercised through `syncWorkspaceRepos({ dryRun: true })` so the assertions
 * cover the REAL wiring in workspace/sync.ts (`resolveGroupDeltas` +
 * `resolveRepoConfig` + `unconditionalIds`), not just the pure resolver.
 * Fresh member repos have no prior manifest, so `repos[].added` IS the
 * resolved effective id set.
 *
 * Probe ids (canonical corpus, tags verified at authoring time):
 *   - hatch3r-git-conventions   rule, [orchestration]        — non-floor, excludable
 *   - hatch3r-api-design        rule, [planning]             — non-floor, group-injectable
 *   - hatch3r-agent-orchestration rule, [.., floor:protocol] — unconditional
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";
import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
} from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults, WorkspaceRepoEntry } from "../../workspace/types.js";

const baseContent: ContentSelection = {
  preset: "minimal",
  projectType: "brownfield",
  teamSize: "solo",
  items: {
    agents: ["hatch3r-implementer"],
    skills: [],
    rules: ["hatch3r-git-conventions", "hatch3r-agent-orchestration"],
    commands: [],
    prompts: [],
    hooks: [],
    githubAgents: [],
  },
};

function makeDefaults(extra: Partial<WorkspaceDefaults> = {}): WorkspaceDefaults {
  return {
    platform: "github",
    tools: ["cursor"],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: [] },
    content: baseContent,
    ...extra,
  };
}

function createGitRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
}

describe("workspace sync resolved plan (defaults → groups → overrides → locked/floor)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function setupWorkspace(
    defaults: WorkspaceDefaults,
    repos: WorkspaceRepoEntry[],
  ): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-plan-"));
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    for (const r of repos) {
      await mkdir(join(tempDir, r.path), { recursive: true });
      createGitRepo(join(tempDir, r.path));
    }
    await writeWorkspaceManifest(tempDir, createWorkspaceManifest("plan", defaults, repos, "manual"));
    return tempDir;
  }

  it("group layer applies only to member repos, in addition to defaults", async () => {
    const ws = await setupWorkspace(
      makeDefaults({
        groups: { platformteam: { contentOverrides: { include: ["hatch3r-api-design"] } } },
      }),
      [
        { path: "member", sync: true, groups: ["platformteam"] },
        { path: "plain", sync: true },
      ],
    );

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.outcome).toBe("passed");

    const member = result.repos.find((r) => r.path === "member");
    const plain = result.repos.find((r) => r.path === "plain");
    expect(member?.added).toContain("hatch3r-api-design");
    expect(member?.added).toContain("hatch3r-git-conventions"); // defaults survive
    expect(plain?.added).not.toContain("hatch3r-api-design");
  }, 60_000);

  it("per-repo overrides win over the group layer (exclude drops a group-included non-floor id)", async () => {
    const ws = await setupWorkspace(
      makeDefaults({
        groups: { platformteam: { contentOverrides: { include: ["hatch3r-api-design"] } } },
      }),
      [
        {
          path: "member",
          sync: true,
          groups: ["platformteam"],
          overrides: { contentOverrides: { exclude: ["hatch3r-api-design"] } },
        },
      ],
    );

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos[0].added).not.toContain("hatch3r-api-design");
  }, 60_000);

  it("a plain non-floor default IS excludable by a per-repo override", async () => {
    const ws = await setupWorkspace(makeDefaults(), [
      { path: "member", sync: true, overrides: { contentOverrides: { exclude: ["hatch3r-git-conventions"] } } },
    ]);

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos[0].added).not.toContain("hatch3r-git-conventions");
  }, 60_000);

  it("lockedContent beats a per-repo exclude (workspace-mandatory id survives)", async () => {
    const ws = await setupWorkspace(
      makeDefaults({ lockedContent: ["hatch3r-git-conventions"] }),
      [
        { path: "member", sync: true, overrides: { contentOverrides: { exclude: ["hatch3r-git-conventions"] } } },
      ],
    );

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos[0].added).toContain("hatch3r-git-conventions");
  }, 60_000);

  it("admitsUnconditionally floor: a floor:protocol rule survives a per-repo exclude", async () => {
    const ws = await setupWorkspace(makeDefaults(), [
      { path: "member", sync: true, overrides: { contentOverrides: { exclude: ["hatch3r-agent-orchestration"] } } },
    ]);

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos[0].added).toContain("hatch3r-agent-orchestration");
  }, 60_000);

  it("an unknown group name is skipped: the sync proceeds with the defaults-only selection", async () => {
    const ws = await setupWorkspace(
      makeDefaults({
        groups: { platformteam: { contentOverrides: { include: ["hatch3r-api-design"] } } },
      }),
      [{ path: "member", sync: true, groups: ["typo-group"] }],
    );

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos[0].action).toBe("dry-run"); // no throw
    expect(result.repos[0].added).not.toContain("hatch3r-api-design");
    expect(result.repos[0].added).toContain("hatch3r-git-conventions");
  }, 60_000);

  it("group order is honored: later group layers stack on earlier ones (both includes land)", async () => {
    const ws = await setupWorkspace(
      makeDefaults({
        groups: {
          a: { contentOverrides: { include: ["hatch3r-api-design"] } },
          b: { contentOverrides: { exclude: ["hatch3r-api-design"] } },
        },
      }),
      [
        // Declared order a→b: b's exclude runs AFTER a's include → dropped.
        { path: "ab", sync: true, groups: ["a", "b"] },
        // Declared order b→a: a's include runs AFTER b's exclude → present.
        { path: "ba", sync: true, groups: ["b", "a"] },
      ],
    );

    const result = await syncWorkspaceRepos(ws, { dryRun: true });
    expect(result.repos.find((r) => r.path === "ab")?.added).not.toContain("hatch3r-api-design");
    expect(result.repos.find((r) => r.path === "ba")?.added).toContain("hatch3r-api-design");
  }, 60_000);
});
