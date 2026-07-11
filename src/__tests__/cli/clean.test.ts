import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { HatchError, ERROR_CODE_TO_EXIT_CODE, type HatchManifest } from "../../types.js";

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
  // W5: commandOutput.ts (beginCommand/finishCommand) routes through these ui
  // exports, so the mock must cover the full surface it touches.
  printNextSteps: vi.fn(),
  printTimingSummary: vi.fn(),
  resetUiState: vi.fn(),
  setJson: vi.fn(),
  setQuiet: vi.fn(),
  setVerbose: vi.fn(),
  isQuiet: vi.fn().mockReturnValue(false),
  isJson: vi.fn().mockReturnValue(false),
  isVerbose: vi.fn().mockReturnValue(false),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  step: vi.fn().mockImplementation((n: number, total: number, msg: string) => `[${n}/${total}] ${msg}`),
  label: vi.fn().mockImplementation((name: string, value: string) => `${name}: ${value}`),
  verbose: vi.fn(),
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
import { info, printBox } from "../../cli/shared/ui.js";

// ── Import module under test ──────────────────────────────────

import { cleanCommand } from "../../cli/commands/clean.js";

// ── Helpers ───────────────────────────────────────────────────

function makeInventory(overrides: Partial<CleanInventory> = {}): CleanInventory {
  // Wave 7 reshape: dropped `canonicalDir`, `customizeDir`, `learnings`,
  // `userContentCount`; added `manifestPresent` and `hatch3rDir` to
  // reflect the single `.hatch3r/` footprint (Wave 6).
  return {
    adapterFiles: [],
    manifestPresent: false,
    archiveDir: false,
    hatch3rDir: false,
    worktreeInclude: false,
    envMcp: false,
    agentsMdHasUserContent: false,
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
      handoffs: true,
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
      makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], hatch3rDir: true }),
    );
    vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: false });

    // D3-SA3.2-10: assert the differentiated exit code, not just the error
    // type. A user-declined clean is a clean cancel → exit 0 (cli-ux-standards:
    // "0 = success / clean user cancel"), distinct from any real-failure exit.
    const err = await cleanCommand().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HatchError);
    expect((err as HatchError).exitCode).toBe(0);

    expect(inquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "proceed", type: "confirm" }),
      ]),
    );
  });

  it("--yes skips confirmation and reinit prompt", async () => {
    const inv = makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], hatch3rDir: true });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({ removed: [".cursor/rules/hatch3r-test.mdc", ".agents/"], kept: [], errors: [] });

    await cleanCommand({ yes: true });

    // Should NOT prompt
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // Should execute clean
    expect(executeClean).toHaveBeenCalledWith("/fake/repo", inv, false);
  });

  it("--dry-run shows what would be removed without executing", async () => {
    const inv = makeInventory({ adapterFiles: [".cursor/rules/hatch3r-test.mdc"], hatch3rDir: true });
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
      hatch3rDir: true,
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
      hatch3rDir: true,
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
      hatch3rDir: true,
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
      hatch3rDir: true,
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
      hatch3rDir: true,
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
      hatch3rDir: true,
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

  // ── Wave 5 (CLI-tooling pivot, plan §4.7) ──────────────────────
  //
  // `cliTools` was added to `PreservedManifestFields` so `clean` -> reinit
  // carries the user's CLI selection forward. The captureConfig path in
  // cleanCommand passes it via `preservedManifestFields` to runInit.
  it("forwards cliTools selection in preservedManifestFields (Wave 5 plan §4.7)", async () => {
    // Manifest carrying an opted-in CLI tools config + plain `cliTools` field.
    const manifest = makeManifest() as unknown as HatchManifest;
    manifest.cliTools = {
      enabled: true,
      selected: ["ripgrep", "jq"],
    };

    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      manifest,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });
    vi.mocked(analyzeRepo).mockResolvedValue(makeRepoInfo());
    vi.mocked(runInit).mockResolvedValue(undefined);

    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    await cleanCommand();

    expect(runInit).toHaveBeenCalledWith(
      expect.objectContaining({
        preservedManifestFields: expect.objectContaining({
          cliTools: expect.objectContaining({
            enabled: true,
            selected: ["ripgrep", "jq"],
          }),
        }),
      }),
    );
  });

  it("omits cliTools from preservedManifestFields when manifest has none", async () => {
    // No cliTools on manifest -> preserved field should be absent (the
    // applyPreservedManifestFields code-path keeps the new init's selection
    // when none was preserved, mirroring features/mcp re-confirmation).
    const manifest = makeManifest();

    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      manifest,
    });

    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });
    vi.mocked(analyzeRepo).mockResolvedValue(makeRepoInfo());
    vi.mocked(runInit).mockResolvedValue(undefined);

    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    await cleanCommand();

    const callArgs = vi.mocked(runInit).mock.calls[0]?.[0] as { preservedManifestFields?: { cliTools?: unknown } };
    expect(callArgs.preservedManifestFields?.cliTools).toBeUndefined();
  });

  // ── D1-21 (Cycle 11 Wave 3): --purge full-uninstall surface ────
  //
  // The standard clean preserves `.hatch3r/` state + `.env.mcp`. `--purge`
  // removes those too, supersedes reinit, and is irreversible (it deletes the
  // pre-clean snapshot under `.hatch3r/snapshots/`). The real node:fs/promises
  // `rm({ force: true })` is a no-op against the non-existent /fake/repo, so
  // these tests assert on the UX surface, not on-disk effects.
  it("--purge --yes skips all prompts, purges, and does not reinit", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      envMcp: true,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });

    await cleanCommand({ yes: true, purge: true });

    // No prompts at all under --yes.
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // Reinit is superseded by purge.
    expect(runInit).not.toHaveBeenCalled();
    // Summary box reports the purge, not the standard "Clean complete".
    expect(vi.mocked(printBox)).toHaveBeenCalledWith(
      "Purge complete",
      expect.arrayContaining([expect.stringContaining(".hatch3r/")]),
      "success",
    );
  });

  it("--purge prompts for a separate confirmation after the clean confirm", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      envMcp: true,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });
    // 1st prompt: proceed with clean; 2nd prompt: confirm purge.
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ confirmPurge: true });

    await cleanCommand({ purge: true });

    expect(inquirer.prompt).toHaveBeenCalledTimes(2);
    expect(inquirer.prompt).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "confirmPurge", type: "confirm" }),
      ]),
    );
    expect(vi.mocked(printBox)).toHaveBeenCalledWith(
      "Purge complete",
      expect.anything(),
      "success",
    );
  });

  it("--purge declined keeps .hatch3r/ and .env.mcp (standard clean still applied)", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      envMcp: true,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ confirmPurge: false });

    await cleanCommand({ purge: true });

    // No "Purge complete" box; the decline path returns before it.
    expect(vi.mocked(printBox)).not.toHaveBeenCalledWith(
      "Purge complete",
      expect.anything(),
      "success",
    );
    expect(vi.mocked(info)).toHaveBeenCalledWith(
      expect.stringContaining("Purge declined"),
    );
    // Reinit is not offered on the purge path even when declined.
    expect(runInit).not.toHaveBeenCalled();
  });

  it("--dry-run --purge previews .hatch3r/ and .env.mcp as removed, not kept", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      envMcp: true,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [".env.mcp (contains secrets)", ".hatch3r/ (preserved)"],
      errors: [],
    });

    await cleanCommand({ dryRun: true, purge: true });

    // executeClean still runs in dry-run mode.
    expect(executeClean).toHaveBeenCalledWith("/fake/repo", inv, true);
    // No mutation prompt in dry-run.
    expect(inquirer.prompt).not.toHaveBeenCalled();
    // The preview should announce .hatch3r/ + .env.mcp under "Would remove".
    const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/Would remove/);
    expect(printed).toContain(".hatch3r/");
    expect(printed).toContain(".env.mcp");
  });

  it("--purge under --yes reports purged paths even when .env.mcp is absent", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      envMcp: false,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });

    await cleanCommand({ yes: true, purge: true });

    // .hatch3r/ is always purged; .env.mcp line is omitted when absent.
    const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Purge complete");
    expect(boxCall).toBeDefined();
    const lines = (boxCall?.[1] as string[]).join("\n");
    expect(lines).toContain(".hatch3r/");
    expect(lines).not.toContain(".env.mcp");
  });

  // W5 JSON stdout purity (mutating representative): `clean --yes --dry-run
  // --format json` must put NOTHING on stdout except the single JSON document
  // (emitJson → process.stdout.write); every raw console.log path is gated by
  // jsonMode and the prompt chain never runs.
  it("--yes --dry-run --format json emits exactly one parseable JSON document on stdout (W5 purity)", async () => {
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      manifestPresent: true,
      hatch3rDir: true,
      envMcp: true,
      manifest: makeManifest(),
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc", ".hatch3r/hatch.json"],
      kept: [".env.mcp (contains secrets)"],
      errors: [],
    });
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await cleanCommand({ yes: true, dryRun: true, format: "json" });

      // No prompts in json/dry-run mode.
      expect(inquirer.prompt).not.toHaveBeenCalled();

      // The entire captured stdout parses as ONE document (purity), carrying
      // the finishCommand envelope + the dry-run preview payload.
      const raw = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const payload = JSON.parse(raw) as Record<string, unknown>;
      expect(payload.status).toBe("ok");
      expect(payload.command).toBe("clean");
      expect(payload.dryRun).toBe(true);
      expect(payload.wouldRemove).toEqual([
        ".cursor/rules/hatch3r-test.mdc",
        ".hatch3r/hatch.json",
      ]);
      expect(Array.isArray(payload.wouldKeep)).toBe(true);
      expect(payload.hatch3rVersion).toBeTruthy();
      expect(payload.timestamp).toBeTruthy();

      // No raw console.log path ran (printInventory + the human dry-run lists
      // are jsonMode-gated; console.log output would interleave with the
      // single document on a real terminal).
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  // ── D3-SA3.2-10: differentiated exit codes on failure paths ──────────────
  //
  // The cancel path (asserted above) exits 0; the reinit-failure path throws
  // CLEAN_ERROR (exit 74). Assert the differentiated code at the throw site,
  // not just the HatchError type — a regression swapping CLEAN_ERROR for
  // UNKNOWN_ERROR (70) would break the documented CI exit-code contract
  // (docs/troubleshooting.md → Exit Codes) while still passing a type-only
  // assertion.
  it("reinit failure throws CLEAN_ERROR with the mapped exit code (D3-SA3.2-10)", async () => {
    const manifest = makeManifest();
    const inv = makeInventory({
      adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
      hatch3rDir: true,
      manifest,
    });
    vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
    vi.mocked(executeClean).mockResolvedValue({
      removed: [".cursor/rules/hatch3r-test.mdc"],
      kept: [],
      errors: [],
    });
    vi.mocked(analyzeRepo).mockResolvedValue(makeRepoInfo());
    // A non-cancel failure inside runInit → clean wraps it as CLEAN_ERROR.
    vi.mocked(runInit).mockRejectedValue(new Error("init boom"));
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ proceed: true })
      .mockResolvedValueOnce({ reinit: true });

    const err = await cleanCommand().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HatchError);
    expect((err as HatchError).errorCode).toBe("CLEAN_ERROR");
    expect((err as HatchError).exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.CLEAN_ERROR);
  });

  // ── D1-SA1.3-07: `--learnings` snapshot must restore the wiped user state ──
  //
  // Before the fix, cleanSnapshotPaths covered only adapter outputs + manifest,
  // so the "Revert with: hatch3r rollback" line the summary prints on a
  // --learnings run was a false recovery promise — a rollback restored the
  // adapter files but the wiped learnings/handoffs stayed gone. This exercises
  // the REAL snapshot module against a temp repo: wipe real learnings/handoffs,
  // then roll back and assert the files return byte-for-byte.
  it("--learnings captures wiped learnings/handoffs into the snapshot so rollback restores them (D1-SA1.3-07)", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { listSnapshots, applyRollback } = await import("../../pipeline/snapshot.js");

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hatch3r-clean-learnings-"));
    try {
      const learningFile = path.join(tmpRoot, ".hatch3r", "learnings", "LRN-1.md");
      const handoffFile = path.join(tmpRoot, ".hatch3r", "handoffs", "h-42.json");
      await fs.mkdir(path.dirname(learningFile), { recursive: true });
      await fs.mkdir(path.dirname(handoffFile), { recursive: true });
      await fs.writeFile(learningFile, "learning body\n");
      await fs.writeFile(handoffFile, '{"id":42}\n');

      // Run cleanCommand against the real temp repo (not the /fake/repo stub).
      cwdSpy.mockReturnValue(tmpRoot);

      const inv = makeInventory({
        adapterFiles: [".cursor/rules/hatch3r-test.mdc"],
        hatch3rDir: true,
      });
      vi.mocked(inventoryArtifacts).mockResolvedValue(inv);
      vi.mocked(executeClean).mockResolvedValue({ removed: [], kept: [], errors: [] });

      await cleanCommand({ yes: true, learnings: true });

      // The wipe removed both user-state files from disk.
      await expect(fs.access(learningFile)).rejects.toThrow();
      await expect(fs.access(handoffFile)).rejects.toThrow();

      // A single pre-clean snapshot exists and its captured paths include the
      // wiped learnings + handoff (the fix — previously absent from the set).
      const sessions = await listSnapshots({ projectRoot: tmpRoot });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].paths).toEqual(
        expect.arrayContaining([learningFile, handoffFile]),
      );

      // The advertised rollback actually restores the wiped user state.
      const rollback = await applyRollback(sessions[0].sessionId, { projectRoot: tmpRoot });
      expect(rollback.errors).toEqual([]);
      expect(await fs.readFile(learningFile, "utf-8")).toBe("learning body\n");
      expect(await fs.readFile(handoffFile, "utf-8")).toBe('{"id":42}\n');
    } finally {
      const { rm: rmReal } = await import("node:fs/promises");
      await rmReal(tmpRoot, { recursive: true, force: true });
    }
  });
});
