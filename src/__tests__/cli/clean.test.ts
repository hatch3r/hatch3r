import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { HatchError, type HatchManifest } from "../../types.js";

// ── Mock all external dependencies before imports ─────────────

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

vi.mock("../../clean/index.js", () => ({
  inventoryArtifacts: vi.fn(),
  executeClean: vi.fn(),
  backupLearnings: vi.fn(),
  restoreLearnings: vi.fn(),
}));

vi.mock("../../detect/repoAnalyzer.js", () => ({
  analyzeRepo: vi.fn(),
}));

vi.mock("../../cli/commands/init.js", () => ({
  runInit: vi.fn(),
}));

vi.mock("../../cli/shared/ui.js", () => ({
  printBanner: vi.fn(),
  createSpinner: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
  printBox: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  step: vi.fn().mockImplementation((n: number, total: number, msg: string) => `[${n}/${total}] ${msg}`),
  label: vi.fn().mockImplementation((name: string, value: string) => `${name}: ${value}`),
}));

// ── Import mocked modules ─────────────────────────────────────

import inquirer from "inquirer";
import {
  inventoryArtifacts,
  executeClean,
  backupLearnings,
  restoreLearnings,
  type CleanInventory,
} from "../../clean/index.js";
import { analyzeRepo } from "../../detect/repoAnalyzer.js";
import { runInit } from "../../cli/commands/init.js";
import { info } from "../../cli/shared/ui.js";

// ── Import module under test ──────────────────────────────────

import { cleanCommand } from "../../cli/commands/clean.js";

// ── Helpers ───────────────────────────────────────────────────

function makeInventory(overrides: Partial<CleanInventory> = {}): CleanInventory {
  return {
    adapterFiles: [],
    canonicalDir: false,
    archiveDir: false,
    customizeDir: false,
    worktreeInclude: false,
    envMcp: false,
    agentsMdHasUserContent: false,
    learnings: [],
    isWorkspaceRoot: false,
    isWorkspaceMember: false,
    workspaceRootPath: null,
    manifest: null,
    ...overrides,
  };
}

function makeManifest() {
  return {
    version: "2.0.0",
    hatch3rVersion: "1.5.0",
    platform: "github" as const,
    owner: "test-org",
    repo: "test-repo",
    namespace: "test-org",
    project: "test-repo",
    tools: ["cursor" as const],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: true,
      commands: true,
      mcp: true,
      githubAgents: true,
      hooks: true,
    },
    mcp: { servers: ["github"] },
    board: {
      owner: "test-org",
      repo: "test-repo",
      defaultBranch: "main",
      projectNumber: null,
      statusFieldId: null,
      statusOptions: { backlog: null, ready: null, inProgress: null, inReview: null, done: null },
      labels: {
        types: ["type:bug"],
        executors: ["executor:agent"],
        statuses: ["status:triage"],
        meta: ["meta:board-overview"],
      },
      branchConvention: "{type}/{short-description}",
      areas: [],
    },
    managedFiles: [".cursor/rules/hatch3r-test.mdc"],
    content: {
      preset: "standard" as const,
      projectType: "brownfield" as const,
      teamSize: "solo" as const,
      items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
    },
  };
}

function makeRepoInfo() {
  return {
    languages: ["typescript"],
    packageManager: "npm" as const,
    frameworks: [],
    isMonorepo: false,
    hasExistingAgents: false,
    existingTools: [],
    rootDir: "/fake/repo",
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("cleanCommand", () => {
  let consoleSpy: MockInstance;
  let cwdSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/fake/repo");
    vi.mocked(backupLearnings).mockResolvedValue(null);
    vi.mocked(executeClean).mockResolvedValue({ removed: [], kept: [], errors: [] });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  it("exits early when nothing to clean", async () => {
    vi.mocked(inventoryArtifacts).mockResolvedValue(makeInventory());

    await cleanCommand();

    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to clean"),
    );
    expect(executeClean).not.toHaveBeenCalled();
  });

  it("shows inventory and prompts for confirmation", async () => {
    vi.mocked(inventoryArtifacts).mockResolvedValue(
      makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], canonicalDir: true }),
    );
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: false });

    await expect(cleanCommand()).rejects.toThrow(HatchError);

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "proceed", type: "confirm" }),
      ]),
    );
  });

  it("--yes skips confirmation and reinit prompt", async () => {
    const inv = makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], canonicalDir: true });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc", ".agents/"], kept: [], errors: [] });

    await cleanCommand({ yes: true });

    // Should NOT prompt
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // Should execute clean
    expect(executeClean).toHaveBeenCalledWith("/fake/repo", inv, false);
  });

  it("--dry-run shows what would be removed without executing", async () => {
    const inv = makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], canonicalDir: true });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc", ".agents/"],
      kept: [],
      errors: [],
    });

    await cleanCommand({ dryRun: true });

    // Should call executeClean with dryRun=true
    expect(executeClean).toHaveBeenCalledWith("/fake/repo", inv, true);
    // Should NOT prompt for confirmation
    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it("offers reinit after cleanup when manifest exists", async () => {
    const manifest = makeManifest();
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest,
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });
    // First prompt: proceed with clean; Second prompt: reinit
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: false });

    await cleanCommand();

    // Should prompt for reinit
    expect(inquirer.prompt).toHaveBeenCalledTimes(2);
    expect(inquirer.prompt).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "reinit", type: "confirm" }),
      ]),
    );
  });

  it("calls runInit with captured config when user accepts reinit", async () => {
    const manifest = makeManifest();
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest,
    });
    const repoInfo = makeRepoInfo();

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });
    vi.mocked(analyzeRepo).mockResolvedValue(repoInfo);
    vi.mocked(runInit).mockResolvedValue(undefined);

    // Proceed with clean, then accept reinit
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    await cleanCommand();

    expect(runInit).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: "/fake/repo",
        platform: "github",
        owner: "test-org",
        repo: "test-repo",
        tools: ["cursor"],
        repoInfo,
      }),
    );
  });

  // 1.7.1: clean -> reinit must carry forward GitHub Projects v2 IDs and other
  // user/platform-specific manifest fields. Before this fix, captureConfig
  // discarded board.projectNumber/statusFieldId/statusOptions and the rebuilt
  // manifest reset them to null.
  it("forwards preservedManifestFields (board IDs, costTracking, etc.) into runInit on reinit", async () => {
    // Populate manifest with real platform-specific state captured by /board-init
    // plus user-set costTracking and specs that must survive clean -> reinit.
    const manifest = makeManifest() as unknown as HatchManifest;
    manifest.board = {
      ...manifest.board!,
      projectNumber: 42,
      statusFieldId: 99,
      statusOptions: {
        backlog: "PVTSSF_backlog",
        ready: "PVTSSF_ready",
        inProgress: "PVTSSF_in_progress",
        inReview: "PVTSSF_in_review",
        done: "PVTSSF_done",
      },
      areas: ["api", "ui"],
    };
    manifest.costTracking = { sessionBudget: 5, currency: "USD", hardStop: true };
    manifest.specs = { paths: ["docs/api.md"], lastGenerated: "2026-05-01" };

    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });
    vi.mocked(analyzeRepo).mockResolvedValue(makeRepoInfo());
    vi.mocked(runInit).mockResolvedValue(undefined);

    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    await cleanCommand();

    expect(runInit).toHaveBeenCalledWith(
      expect.objectContaining({
        preservedManifestFields: expect.objectContaining({
          board: expect.objectContaining({
            projectNumber: 42,
            statusFieldId: 99,
            statusOptions: expect.objectContaining({
              backlog: "PVTSSF_backlog",
              done: "PVTSSF_done",
            }),
            areas: ["api", "ui"],
          }),
          costTracking: expect.objectContaining({
            sessionBudget: 5,
            currency: "USD",
            hardStop: true,
          }),
          specs: expect.objectContaining({
            paths: ["docs/api.md"],
            lastGenerated: "2026-05-01",
          }),
        }),
      }),
    );
  });

  it("restores learnings after reinit", async () => {
    const manifest = makeManifest();
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(backupLearnings).mockResolvedValue("/tmp/hatch3r-learnings-backup");
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });
    vi.mocked(analyzeRepo).mockResolvedValue(makeRepoInfo());
    vi.mocked(runInit).mockResolvedValue(undefined);

    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    await cleanCommand();

    expect(restoreLearnings).toHaveBeenCalledWith("/fake/repo", "/tmp/hatch3r-learnings-backup");
  });

  it("cleans up learnings backup when user declines reinit", async () => {
    const manifest = makeManifest();
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(backupLearnings).mockResolvedValue("/tmp/hatch3r-learnings-backup");
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });

    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: false });

    await cleanCommand();

    // Should NOT restore learnings
    expect(restoreLearnings).not.toHaveBeenCalled();
    // runInit should NOT have been called
    expect(runInit).not.toHaveBeenCalled();
  });

  it("handles missing manifest (no reinit prompt)", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      canonicalDir: true,
      manifest: null,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc"], kept: [], errors: [] });

    // Only one prompt: proceed with clean
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true });

    await cleanCommand();

    // Should only prompt once (no reinit prompt)
    expect(inquirer.prompt).toHaveBeenCalledTimes(1);
    // runInit should NOT be called
    expect(runInit).not.toHaveBeenCalled();
  });
});
