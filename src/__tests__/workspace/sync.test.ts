import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";

// Wave 6: hatch3r footprint moved from `.agents/` to `.hatch3r/`. Both the
// workspace manifest (`workspace.json`) and per-member manifests
// (`hatch.json`) live under HATCH3R_DIR now.
const AGENTS_DIR = HATCH3R_DIR;
import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
  readWorkspaceManifest,
} from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { detectSubRepos, shouldSuggestWorkspace, detectWorkspaceContext, isWorkspaceRoot } from "../../workspace/detect.js";
import type { ContentSelection } from "../../types.js";
import type { WorkspaceDefaults } from "../../workspace/types.js";

describe("workspace detect", () => {
  let tempDir: string;

  afterEach(async () => {
    // Windows-safe teardown: fs.rm retries ENOTEMPTY/EBUSY/EPERM with a linear
    // backoff when recursive:true (Node fs docs, accessed 2026-06-04:
    // https://nodejs.org/api/fs.html). These tests create real git repos whose
    // file handles Windows may still hold; the retries cover the brief
    // deferred-deletion window. Inert on POSIX (first attempt succeeds).
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-detect-"));
    return tempDir;
  }

  async function createGitRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  }

  describe("detectSubRepos", () => {
    it("detects git subdirectories", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));
      await createGitRepo(join(dir, "web"));
      await mkdir(join(dir, "docs")); // not a git repo

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(2);
      expect(repos.map((r) => r.name)).toContain("api");
      expect(repos.map((r) => r.name)).toContain("web");
    });

    it("returns empty for directory with no git repos", async () => {
      const dir = await setup();
      await mkdir(join(dir, "folder1"));
      await mkdir(join(dir, "folder2"));

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(0);
    });

    it("detects existing hatch3r setups", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));
      await mkdir(join(dir, "api", AGENTS_DIR), { recursive: true });
      await writeFile(join(dir, "api", AGENTS_DIR, "hatch.json"), "{}");

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(1);
      expect(repos[0].hasHatch3r).toBe(true);
    });

    it("skips hidden directories", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, ".hidden-repo"));
      await createGitRepo(join(dir, "visible-repo"));

      const repos = await detectSubRepos(dir);
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe("visible-repo");
    });
  });

  describe("shouldSuggestWorkspace", () => {
    it("returns true for non-git dir with git subdirs", async () => {
      const dir = await setup();
      await createGitRepo(join(dir, "api"));

      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(true);
    });

    it("returns false for git repo", async () => {
      const dir = await setup();
      await createGitRepo(dir);
      await createGitRepo(join(dir, "sub"));

      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(false);
    });

    it("returns false for empty dir", async () => {
      const dir = await setup();
      const result = await shouldSuggestWorkspace(dir);
      expect(result).toBe(false);
    });
  });

  describe("detectWorkspaceContext", () => {
    it("detects standalone repo", async () => {
      const dir = await setup();
      await createGitRepo(dir);

      const ctx = await detectWorkspaceContext(dir);
      expect(ctx.type).toBe("standalone");
    });

    it("detects workspace root", async () => {
      const dir = await setup();
      await mkdir(join(dir, AGENTS_DIR), { recursive: true });
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({
          version: "1.0.0",
          hatch3rVersion: "1.4.0",
          name: "test",
          repos: [],
          defaults: { tools: [], features: DEFAULT_FEATURES, mcp: { servers: [] }, content: { preset: "standard", projectType: "brownfield", teamSize: "solo", items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] } } },
          syncStrategy: "manual",
        }),
      );

      const ctx = await detectWorkspaceContext(dir);
      expect(ctx.type).toBe("workspace-root");
      expect(ctx.workspaceRoot).toBe(dir);
    });

    it("detects workspace member by walking up", async () => {
      const dir = await setup();
      // Create workspace root. D1-31: membership is registration-based, so the
      // sub-repo must be listed in `repos[]` to classify as a member — an empty
      // `repos[]` no longer admits an arbitrary sub-directory (which would be a
      // false "managed / overwritten on sync" positive).
      await mkdir(join(dir, AGENTS_DIR), { recursive: true });
      await writeFile(
        join(dir, AGENTS_DIR, "workspace.json"),
        JSON.stringify({
          version: "1.0.0",
          hatch3rVersion: "1.4.0",
          name: "test",
          repos: [{ path: "api", sync: true }],
          defaults: { tools: [], features: DEFAULT_FEATURES, mcp: { servers: [] }, content: { preset: "standard", projectType: "brownfield", teamSize: "solo", items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] } } },
          syncStrategy: "manual",
        }),
      );
      // Create sub-repo dir registered above
      const subDir = join(dir, "api");
      await createGitRepo(subDir);

      const ctx = await detectWorkspaceContext(subDir);
      expect(ctx.type).toBe("workspace-member");
      expect(ctx.workspaceRoot).toBe(dir);
    });
  });
});

describe("isWorkspaceRoot", () => {
  let tempDir: string;

  afterEach(async () => {
    // Windows-safe teardown — see the rationale on the "workspace detect"
    // afterEach above: fs.rm retries ENOTEMPTY/EBUSY/EPERM (recursive:true).
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("returns true for directory with workspace.json", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-isroot-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await writeFile(
      join(tempDir, AGENTS_DIR, "workspace.json"),
      JSON.stringify({
        version: "1.0.0",
        hatch3rVersion: "1.4.0",
        name: "test",
        repos: [],
        defaults: { tools: [], features: DEFAULT_FEATURES, mcp: { servers: [] }, content: { preset: "standard", projectType: "brownfield", teamSize: "solo", items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] } } },
        syncStrategy: "manual",
      }),
    );

    const result = await isWorkspaceRoot(tempDir);
    expect(result).toBe(true);
  });

  it("returns false for directory without workspace.json", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-notroot-"));
    const result = await isWorkspaceRoot(tempDir);
    expect(result).toBe(false);
  });

  it("returns false for directory with only hatch.json (not a workspace root)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-nows-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await writeFile(
      join(tempDir, AGENTS_DIR, "hatch.json"),
      JSON.stringify({ version: "2.0.0", tools: ["cursor"] }),
    );

    const result = await isWorkspaceRoot(tempDir);
    expect(result).toBe(false);
  });
});

describe("workspace sync", () => {
  let tempDir: string;

  afterEach(async () => {
    // Windows-safe teardown — see the rationale on the "workspace detect"
    // afterEach above. This block's parallel/concurrency-cap tests create 5
    // git repos and run 5 real adapter generations, so they hold the most
    // file handles and are the most prone to the deferred-deletion ENOTEMPTY
    // that caused the CI failure; the retries cover that window.
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function createGitRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  }

  const baseContent: ContentSelection = {
    preset: "minimal",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: ["hatch3r-researcher", "hatch3r-implementer", "hatch3r-reviewer", "hatch3r-security"],
      skills: [],
      // hatch3r-agent-orchestration carries floor:protocol (non-excludable per
      // D16-2); hatch3r-git-conventions is a non-floor cosmetic rule used to
      // verify the exclude mechanism still drops ordinary content.
      rules: ["hatch3r-agent-orchestration", "hatch3r-git-conventions"],
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

  it("syncs content to opted-in sub-repos", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-sync-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    // Create sub-repos
    await createGitRepo(join(tempDir, "api"));
    await createGitRepo(join(tempDir, "web"));

    // Create workspace manifest with one repo opted in
    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: false },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Sync
    const result = await syncWorkspaceRepos(tempDir);

    // Only api should be synced
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].path).toBe("api");
    expect(result.repos[0].action).toBe("synced");

    // api should have .agents/hatch.json with workspace provenance
    const apiManifestRaw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const apiManifest = JSON.parse(apiManifestRaw);
    expect(apiManifest.workspace).toBeDefined();
    expect(apiManifest.workspace.rootPath).toBe("..");
    expect(apiManifest.tools).toEqual(["cursor"]);

    // web should NOT have .agents/
    try {
      await access(join(tempDir, "web", AGENTS_DIR, "hatch.json"));
      expect.fail("web should not have hatch.json");
    } catch (err) {
      // Expected — web is not synced.
      void err;
    }
  });

  it("respects --dry-run flag", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-dry-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir, { dryRun: true });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("dry-run");

    // dry-run should include estimated token count
    expect(typeof result.repos[0].estimatedTokens).toBe("number");
    expect(result.repos[0].estimatedTokens).toBeGreaterThan(0);

    // api should NOT have .agents/ because it was dry-run
    try {
      await access(join(tempDir, "api", AGENTS_DIR, "hatch.json"));
      expect.fail("api should not have hatch.json in dry-run mode");
    } catch (err) {
      // Expected — dry-run does not write hatch.json.
      void err;
    }
  });

  it("reports error for missing repo directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-missing-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "nonexistent", name: "nonexistent", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("error");
    expect(result.repos[0].error).toContain("not found");
  });

  it("syncs specific repos via repos option", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-specific-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));
    await createGitRepo(join(tempDir, "web"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Only sync api
    const result = await syncWorkspaceRepos(tempDir, { repos: ["api"] });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].path).toBe("api");
  });

  // D1-SA1.10-12 (Cycle 12, Info): an explicit --repos path that matches no
  // registered repo must surface an onWarn line naming it (with the known repo
  // set) — otherwise the CLI reports a green "0 repo(s) synced" and an operator
  // typo reads as a clean no-op (Silent Failure Contract).
  it("warns per unmatched --repos path instead of silently syncing nothing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-unmatched-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const warnings: string[] = [];
    const result = await syncWorkspaceRepos(tempDir, {
      repos: ["ap"], // typo of "api"
      onWarn: (m) => warnings.push(m),
    });

    // Nothing matched — no repo synced (the prior silent behavior).
    expect(result.repos).toHaveLength(0);
    // But the typo is now audible: a warning names the unmatched path AND lists
    // the registered repo so the operator can spot the typo.
    const unmatchedWarn = warnings.find((w) => /matched no registered repo/.test(w));
    expect(unmatchedWarn).toBeDefined();
    expect(unmatchedWarn).toContain("ap"); // the unmatched path
    expect(unmatchedWarn).toContain("api"); // the registered repo set
  });

  // D1-SA1.10-12 (Cycle 12, Info): an explicit --repos path selects by path
  // membership alone, so a repo with sync:false IS synced when named directly.
  // Pins the opt-out override the option contract now documents.
  it("syncs a sync:false repo when its path is named explicitly via --repos", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-optout-override-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "web"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "web", name: "web", sync: false },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // The no-argument default would skip web (sync:false); naming it explicitly
    // overrides the opt-out and must not emit an unmatched-path warning.
    const warnings: string[] = [];
    const result = await syncWorkspaceRepos(tempDir, {
      repos: ["web"],
      onWarn: (m) => warnings.push(m),
    });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].path).toBe("web");
    expect(result.repos[0].action).toBe("synced");
    expect(warnings.some((w) => /matched no registered repo/.test(w))).toBe(false);
  });

  it("updates lastSync in workspace manifest after sync", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-ts-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const updated = await readWorkspaceManifest(tempDir);
    expect(updated!.repos[0].lastSync).toBeDefined();
    expect(new Date(updated!.repos[0].lastSync!).getTime()).toBeGreaterThan(0);
  });

  // D1-SA1.9.1 (High): Incremental per-repo lastSync writes survive mid-loop
  // interruption. We simulate an interruption by failing the SECOND repo's
  // sync and then reading the workspace manifest from disk — the first
  // repo's lastSync must have been persisted incrementally, even though
  // the loop did not run to completion successfully.
  it("persists lastSync incrementally per successful sub-repo", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-incremental-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));
    // Intentionally omit the "web" directory so its per-repo sync will
    // error out, simulating a mid-loop failure scenario.

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
      { path: "web", name: "web", sync: true }, // directory missing on disk
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);

    // api succeeded; web errored
    expect(result.repos.find((r) => r.path === "api")?.action).toBe("synced");
    expect(result.repos.find((r) => r.path === "web")?.action).toBe("error");

    // Read workspace manifest FROM DISK — api.lastSync must have been
    // persisted even though web failed immediately afterward.
    const persisted = await readWorkspaceManifest(tempDir);
    const apiEntry = persisted!.repos.find((r) => r.path === "api");
    expect(apiEntry?.lastSync).toBeDefined();
    expect(new Date(apiEntry!.lastSync!).getTime()).toBeGreaterThan(0);

    const webEntry = persisted!.repos.find((r) => r.path === "web");
    expect(webEntry?.lastSync).toBeUndefined();
  });

  it("populates complete workspace provenance in sub-repo manifest", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-prov-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);

    // Verify all workspace provenance fields
    expect(manifest.workspace).toBeDefined();
    expect(manifest.workspace.rootPath).toBe("..");
    expect(typeof manifest.workspace.lastSync).toBe("string");
    expect(new Date(manifest.workspace.lastSync).getTime()).toBeGreaterThan(0);
    expect(typeof manifest.workspace.syncVersion).toBe("string");
    expect(typeof manifest.workspace.workspaceChecksum).toBe("string");
    expect(manifest.workspace.workspaceChecksum.length).toBe(64); // SHA-256 hex
  });

  it("syncs with per-repo tool overrides", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-override-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        overrides: { tools: ["claude"] },
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.tools).toEqual(["claude"]);
  });

  it("syncs with content exclude overrides", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-exclude-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        overrides: {
          contentOverrides: {
            // Attempt to exclude BOTH a floor rule and a non-floor rule.
            exclude: ["hatch3r-agent-orchestration", "hatch3r-git-conventions"],
          },
        },
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    // The non-floor rule is excluded from the content selection + tracked.
    expect(manifest.content.items.rules).not.toContain("hatch3r-git-conventions");
    expect(manifest.workspace.excludedContent).toContain("hatch3r-git-conventions");
    // D16-2: the floor:protocol rule is NOT excludable — the universal-floor
    // invariant outranks the per-repo exclude, so it is retained and not
    // tracked as excluded.
    expect(manifest.content.items.rules).toContain("hatch3r-agent-orchestration");
    expect(manifest.workspace.excludedContent).not.toContain("hatch3r-agent-orchestration");

    // D10-SA10.6-01 (release/2.8.6): the exclusion now has an ON-DISK effect —
    // the member's adapter emission honors the selection as an allowlist, so
    // the excluded rule's `.mdc` never materializes while the retained floor
    // rule's does.
    const emittedRules = await readdir(join(tempDir, "api", ".cursor", "rules"));
    expect(emittedRules.some((f) => f.includes("hatch3r-agent-orchestration"))).toBe(true);
    expect(emittedRules.some((f) => f.includes("hatch3r-git-conventions"))).toBe(false);
  });

  // D10-SA10.6-01 fail-open: a legacy workspace whose defaults selection
  // resolves ZERO known ids (buildSelectionFromIds matches nothing against the
  // current corpus → `preset: "custom"` with all-empty items) must still emit —
  // the empty-union selection DISABLES the emission allowlist rather than
  // emitting nothing.
  it("still emits member outputs when the workspace selection resolves zero known ids (empty-union fail-open)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-emptyunion-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const staleContent: ContentSelection = {
      preset: "custom",
      projectType: "brownfield",
      teamSize: "solo",
      items: {
        // Ids the current corpus does not carry — every one resolves to no
        // catalog item, so the member selection materializes all-empty.
        agents: ["hatch3r-agent-retired-long-ago"],
        skills: [],
        rules: ["hatch3r-rule-retired-long-ago"],
        commands: [],
        prompts: [],
        hooks: [],
        githubAgents: [],
      },
    };
    const wsManifest = createWorkspaceManifest(
      "test",
      { ...defaults, content: staleContent },
      [{ path: "api", name: "api", sync: true }],
      "manual",
    );
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("synced");

    // The member manifest records the all-empty custom selection…
    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    const unionSize = (Object.values(manifest.content.items) as string[][]).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    expect(unionSize).toBe(0);

    // …and the adapter run still emitted real outputs (fail-open, not zero).
    const emittedRules = await readdir(join(tempDir, "api", ".cursor", "rules"));
    expect(emittedRules.length).toBeGreaterThan(0);
  });

  // D1-SA1.10-05 (Cycle 12): a workspace member must sweep adapter outputs the
  // prior run recorded but this run no longer emits (renamed output shape,
  // dropped tool, removed rule), and persist managedFilesByAdapter so the next
  // sync has a diff baseline — otherwise the coding tool keeps loading a
  // "ghost" file the workspace lead believes is gone, and the stale file falls
  // out of tracking so `hatch3r clean` can never reclaim it. Ports the
  // single-repo orphan sweep (src/cli/commands/sync.ts) into syncSingleRepo.
  // Seeds a stale prior path the current sync will not re-emit — the same
  // approach as the single-repo orphan test in src/__tests__/cli/sync.test.ts
  // (deterministic regardless of how the adapter maps a selection to outputs).
  it("sweeps a member's orphaned adapter output recorded by a prior run", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-orphan-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Sync 1 establishes the member. The fix persists managedFilesByAdapter on
    // the member manifest — the prior code never wrote it (createManifest built
    // a fresh manifest and only populated the flat managedFiles list).
    await syncWorkspaceRepos(tempDir);
    const memberManifestPath = join(tempDir, "api", AGENTS_DIR, "hatch.json");
    const m1 = JSON.parse(await readFile(memberManifestPath, "utf-8"));
    expect(Array.isArray(m1.managedFilesByAdapter?.cursor)).toBe(true);
    expect(m1.managedFilesByAdapter.cursor.length).toBeGreaterThan(0);

    // Seed a stale prior path (a pre-rename shape) into the member's per-adapter
    // history AND place the physical file, so sync 2's diff flags it as an
    // orphan the current emission set does not include.
    const stalePath = ".cursor/rules/50-hatch3r-removed-rule.mdc";
    m1.managedFilesByAdapter.cursor.push(stalePath);
    await writeFile(memberManifestPath, JSON.stringify(m1, null, 2));
    const staleAbs = join(tempDir, "api", stalePath);
    await mkdir(join(tempDir, "api", ".cursor", "rules"), { recursive: true });
    await writeFile(staleAbs, "# stale hatch3r rule output from a prior run\n");

    // Sync 2 re-emits the same corpus (which never includes the seeded stale
    // path), so the sweep reclaims it.
    const warnings: string[] = [];
    await syncWorkspaceRepos(tempDir, { onWarn: (msg) => warnings.push(msg) });

    // The stale file is unlinked from the member repo (the sweep).
    await expect(access(staleAbs)).rejects.toThrow();
    // It is dropped from the member manifest's per-adapter tracking.
    const m2 = JSON.parse(await readFile(memberManifestPath, "utf-8"));
    const cursorPaths2: string[] = m2.managedFilesByAdapter?.cursor ?? [];
    expect(cursorPaths2).not.toContain(stalePath);
    // A real, still-emitted output is NOT swept (no over-reclaim).
    const survivor: string = m2.managedFilesByAdapter.cursor[0];
    await expect(access(join(tempDir, "api", survivor))).resolves.toBeUndefined();
    // The operator sees an audible removal diagnostic.
    expect(warnings.some((w) => /Unlinked \d+ orphaned adapter output/.test(w))).toBe(true);
  });

  it("uses per-repo owner/repo/branch when syncing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-identity-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        owner: "team-a",
        repo: "backend",
        defaultBranch: "develop",
        platform: "gitlab",
      },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.owner).toBe("team-a");
    expect(manifest.repo).toBe("backend");
    expect(manifest.platform).toBe("gitlab");
    expect(manifest.board?.defaultBranch).toBe("develop");
  });

  it("falls back gracefully when per-repo identity is absent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-noid-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    // No per-repo identity fields, repo has no remote either
    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    // F1.9-H3 (Cycle 10 D1): capture warnings — the empty-string identity
    // fallback must surface an audible onWarn line, not persist empty
    // owner/repo silently (board/PR links would be broken otherwise).
    const warnings: string[] = [];
    await syncWorkspaceRepos(tempDir, { onWarn: (m) => warnings.push(m) });

    const raw = await readFile(join(tempDir, "api", AGENTS_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);
    // Should still create a valid manifest with empty/default values
    expect(manifest.owner).toBe("");
    expect(manifest.repo).toBe("");
    expect(manifest.board?.defaultBranch).toBe("main");
    // F1.9-H3: a consolidated owner/repo-detection warning, scoped to the
    // sub-repo path, must have been surfaced.
    const identityWarn = warnings.find(
      (w) => w.includes("[api]") && /owner\/repo/.test(w),
    );
    expect(identityWarn).toBeDefined();
    expect(identityWarn).toMatch(/board\/PR links/);
  });

  it("returns empty result when no repos are eligible", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-norepos-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: false },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(0);
  });

  it("produces sync output with added and tools arrays", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-output-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest("test", defaults, [
      { path: "api", name: "api", sync: true },
    ], "manual");
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("synced");
    expect(Array.isArray(result.repos[0].added)).toBe(true);
    expect(Array.isArray(result.repos[0].toolsSynced)).toBe(true);
    expect(result.repos[0].toolsSynced).toContain("cursor");
  });

  // Wave 7 (1.9.0): Integrity-manifest subsystem deleted alongside
  // `.integrity.json`. Adapter-output drift is now the source of truth
  // (see `computeAdapterDrift` in `src/cli/commands/status.ts`). The
  // two integrity-manifest tests that previously lived here exercised
  // behavior that no longer exists and were removed in this wave.

  // D14-SA14.2-H01 (High, C9-H45): Parallel sync of N opted-in repos
  // completes successfully and produces one synced result per repo.
  // Verifies the pLimit-bounded refactor preserves correctness when
  // multiple sub-repo syncs run concurrently.
  it("syncs multiple opted-in repos in parallel", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-parallel-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const repoNames = ["api", "web", "worker", "docs", "infra"];
    for (const name of repoNames) {
      await createGitRepo(join(tempDir, name));
    }

    const wsManifest = createWorkspaceManifest(
      "test",
      defaults,
      repoNames.map((name) => ({ path: name, name, sync: true })),
      "manual",
    );
    await writeWorkspaceManifest(tempDir, wsManifest);

    const result = await syncWorkspaceRepos(tempDir);

    expect(result.repos).toHaveLength(repoNames.length);
    for (const name of repoNames) {
      const repoResult = result.repos.find((r) => r.path === name);
      expect(repoResult, `result for ${name}`).toBeDefined();
      expect(repoResult!.action).toBe("synced");
      await expect(
        access(join(tempDir, name, AGENTS_DIR, "hatch.json")),
      ).resolves.toBeUndefined();
    }

    // All five repos must have lastSync recorded in the workspace manifest
    // — the serialized mutex on incremental writes preserves this guarantee
    // even when per-repo work completes concurrently.
    const persisted = await readWorkspaceManifest(tempDir);
    for (const name of repoNames) {
      const entry = persisted!.repos.find((r) => r.path === name);
      expect(entry?.lastSync, `lastSync for ${name}`).toBeDefined();
    }
    // Windows runners run real multi-repo git+adapter work ~5-10x slower; 30s
    // default is borderline — give headroom (test completes in ~6s on macOS,
    // never hangs). 5 real `git init` repos + 5 real adapter generations.
  }, 90_000);

  // D14-SA14.2-H01 (High, C9-H45): The `concurrency` option caps the
  // number of sub-repo syncs in flight simultaneously. Verified by
  // instrumenting the adapter to record peak in-flight count: with
  // concurrency=2 and 5 target repos, peak in-flight never exceeds 2.
  it("respects the concurrency cap on parallel sync", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-conc-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });

    const repoNames = ["a", "b", "c", "d", "e"];
    for (const name of repoNames) {
      await createGitRepo(join(tempDir, name));
    }

    const wsManifest = createWorkspaceManifest(
      "test",
      defaults,
      repoNames.map((name) => ({ path: name, name, sync: true })),
      "manual",
    );
    await writeWorkspaceManifest(tempDir, wsManifest);

    // Instrument the cursor adapter to add a small delay and record the
    // peak in-flight count. The adapter is invoked exactly once per repo
    // by syncSingleRepo, so its in-flight counter measures sub-repo
    // concurrency directly.
    let inFlight = 0;
    let peakInFlight = 0;
    const adaptersMod = await import("../../adapters/index.js");
    const realGetAdapter = adaptersMod.getAdapter;
    const getAdapterSpy = vi.spyOn(adaptersMod, "getAdapter").mockImplementation(
      ((tool: string) => {
        const real = realGetAdapter(tool as Parameters<typeof realGetAdapter>[0]);
        const wrapped = {
          get warnings() {
            return real.warnings;
          },
          generate: async (...args: Parameters<typeof real.generate>) => {
            inFlight++;
            if (inFlight > peakInFlight) peakInFlight = inFlight;
            try {
              // Real-timer delay is intentional here (not a flake risk): it
              // forces concurrent generate() calls to overlap so peakInFlight
              // measures actual sub-repo concurrency against the cap. Fake
              // timers would collapse the overlap and defeat the assertion;
              // this is the same "real timers are correct for the behavior
              // under test" case as the pipeline timeout-feature tests.
              await new Promise((resolve) => setTimeout(resolve, 25));
              return await real.generate(...args);
            } finally {
              inFlight--;
            }
          },
        };
        return wrapped as unknown as ReturnType<typeof realGetAdapter>;
      }) as typeof realGetAdapter,
    );

    try {
      const result = await syncWorkspaceRepos(tempDir, { concurrency: 2 });
      expect(result.repos).toHaveLength(repoNames.length);
      for (const r of result.repos) {
        expect(r.action).toBe("synced");
      }
      // Peak in-flight count must not exceed the concurrency cap.
      expect(peakInFlight).toBeGreaterThan(0);
      expect(peakInFlight).toBeLessThanOrEqual(2);
    } finally {
      getAdapterSpy.mockRestore();
    }
    // Windows runners run real multi-repo git+adapter work ~5-10x slower; 30s
    // default is borderline — give headroom (test completes in ~7.6s on macOS,
    // never hangs). 5 real `git init` repos + 5 real adapter generations, each
    // with a forced 25ms overlap delay to make the concurrency-cap assertion
    // observable; the cap logic itself is exercised real, not mocked.
  }, 90_000);

  // D14-SA14.2-H01 (High, C9-H45): The sync journal at
  // `<workspaceRoot>/.agents/.workspace-sync-journal.jsonl` records one
  // JSONL line per sub-repo terminal action so a crashed run leaves a
  // recoverable trace.
  it("writes a journal entry per repo to .workspace-sync-journal.jsonl", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-journal-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));
    await createGitRepo(join(tempDir, "web"));
    // "missing" path intentionally has no directory — produces an error
    // entry that must also be journaled.

    const wsManifest = createWorkspaceManifest(
      "test",
      defaults,
      [
        { path: "api", name: "api", sync: true },
        { path: "web", name: "web", sync: true },
        { path: "missing", name: "missing", sync: true },
      ],
      "manual",
    );
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir);

    const journalPath = join(tempDir, AGENTS_DIR, ".workspace-sync-journal.jsonl");
    await expect(access(journalPath)).resolves.toBeUndefined();

    const raw = await readFile(journalPath, "utf-8");
    const lines = raw.trim().split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const byRepo = new Map(entries.map((e) => [e.repo as string, e]));

    expect(byRepo.get("api")?.action).toBe("synced");
    expect(byRepo.get("web")?.action).toBe("synced");
    expect(byRepo.get("missing")?.action).toBe("error");
    expect(typeof byRepo.get("missing")?.error).toBe("string");

    for (const entry of entries) {
      expect(typeof entry.ts).toBe("string");
      expect(typeof entry.workspaceChecksum).toBe("string");
      expect((entry.workspaceChecksum as string).length).toBe(64);
    }
  });

  // D14-SA14.2-H01 (High, C9-H45): Dry-run mode must remain side-effect-
  // free — no journal file written, no manifest mutation.
  it("does not write a journal entry in dry-run mode", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-dry-journal-"));
    await mkdir(join(tempDir, AGENTS_DIR), { recursive: true });
    await createGitRepo(join(tempDir, "api"));

    const wsManifest = createWorkspaceManifest(
      "test",
      defaults,
      [{ path: "api", name: "api", sync: true }],
      "manual",
    );
    await writeWorkspaceManifest(tempDir, wsManifest);

    await syncWorkspaceRepos(tempDir, { dryRun: true });

    const journalPath = join(tempDir, AGENTS_DIR, ".workspace-sync-journal.jsonl");
    await expect(access(journalPath)).rejects.toThrow();
  });
});
