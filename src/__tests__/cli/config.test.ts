import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ARCHIVE_DIR, HatchError, DEFAULT_FEATURES, type Features, type HatchManifest } from "../../types.js";
import {
  makeManifest,
  makeContentSelection,
  applyDefaultConfigMocks,
  setupStandardPrompts as queueStandardPrompts,
  primeConfig as primeConfigBase,
  primeContent as primeContentBase,
  stubContentIdsTransition,
  stubResolveSelectionAgents,
  getConfigUpdatedBox,
  getCurrentConfigBox,
  getWrittenManifest,
  expectSummaryLine,
  type PromptOverrides,
} from "../helpers/configHelpers.js";

// ── Mock all dependencies before imports ──────────────────────
//
// Note: vi.mock() calls are module-hoisted and cannot live in a helper.
// Default implementations are re-applied via applyDefaultConfigMocks() in
// beforeEach (after vi.clearAllMocks). See src/__tests__/helpers/configHelpers.ts.

vi.mock("inquirer", () => {
  // Wave 3 CLI-tooling pivot: `pickCliTools` in src/cli/shared/pickers.ts
  // builds tier headers via `new inquirer.Separator(label)`. The mocked
  // default must expose a Separator constructor or the picker throws
  // `default.Separator is not a constructor` before any inquirer.prompt is
  // reached. The shape here matches the real inquirer.Separator API.
  class Separator {
    constructor(public readonly line: string) {}
  }
  return {
    default: {
      prompt: vi.fn(),
      Separator,
    },
  };
});

vi.mock("../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  // Bucket 2.1: scalar config `get maturity` consults `readMaturityTier` so the
  // mock surface needs to export it. Implementation matches the real helper:
  // valid persisted value pass-through, anything else falls back to "solo".
  readMaturityTier: vi.fn((m: { maturity?: string } | null | undefined) => {
    const value = m?.maturity;
    return value && ["solo", "team", "scaleup", "enterprise"].includes(value)
      ? value
      : "solo";
  }),
  // D13-SA13.3-F13.3.3 / -F2: scalar config `get confidence_floor` consults
  // `readConfidenceFloor`; mirror the real helper — explicit valid floor wins,
  // else the maturity-aware default (scaleup/enterprise → "high", else "any").
  readConfidenceFloor: vi.fn((m: { confidenceFloor?: string; maturity?: string } | null | undefined) => {
    const value = m?.confidenceFloor;
    if (value && ["any", "medium", "high"].includes(value)) return value;
    const tier =
      m?.maturity && ["solo", "team", "scaleup", "enterprise"].includes(m.maturity) ? m.maturity : "solo";
    return tier === "scaleup" || tier === "enterprise" ? "high" : "any";
  }),
  isValidGitBranchName: vi.fn(() => true),
}));

vi.mock("../../cli/commands/update.js", async (importOriginal) => {
  // D1-3 (Cycle 11 Wave 2): config now calls the real partial-failure gate after
  // runRegenerate. Keep the heavy update entry points stubbed (no network/disk),
  // but pull the REAL `throwOnPartialAdapterFailure` from the actual module so the
  // exit-2 contract is exercised end-to-end rather than re-implemented in the test.
  const actual = await importOriginal<typeof import("../../cli/commands/update.js")>();
  return {
    runUpdate: vi.fn(),
    runRegenerate: vi.fn(),
    runPackageUpdate: vi.fn(),
    throwOnPartialAdapterFailure: actual.throwOnPartialAdapterFailure,
  };
});

vi.mock("../../archive/index.js", () => ({
  archiveToolOutputs: vi.fn(),
  collectToolFiles: vi.fn(),
  removeManagedFilesForPaths: vi.fn(),
}));

vi.mock("../../content/index.js", () => ({
  buildContentIndex: vi.fn(),
  getAvailableItems: vi.fn(),
  archiveCustomizeOverrides: vi.fn(),
  countSelectionItems: vi.fn(),
  selectionSummary: vi.fn(),
  extractContentReferences: vi.fn(),
  validateOrchestrationDependencies: vi.fn(),
  TYPE_TO_SELECTION_KEY: {
    agent: "agents",
    skill: "skills",
    rule: "rules",
    command: "commands",
    prompt: "prompts",
    hook: "hooks",
    "github-agent": "githubAgents",
  },
  resolveSelection: vi.fn().mockReturnValue({
    preset: "full", projectType: "brownfield", teamSize: "team",
    items: { agents: [], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
  }),
  countPresetExclusions: vi.fn().mockReturnValue(0),
  // D10-12 (Cycle 11 Wave 2): the preset picker now renders the realized
  // post-floor omit clusters via presetOmittedClusters; stub it so the picker
  // step renders without hitting an undefined export.
  presetOmittedClusters: vi.fn().mockReturnValue([]),
  estimatePresetItemCount: vi.fn().mockReturnValue(50),
  getAllContentIds: vi.fn().mockReturnValue(new Set<string>()),
}));

vi.mock("../../content/presets.js", () => ({
  // Wave 1 of the content-pack redesign replaced the legacy
  // { includeTags, excludeTags } preset shape with
  // { capabilities, includeCustomize, includeIds?, excludeIds? } per
  // src/content/presets.ts::ContentPreset. The mock mirrors the live shape
  // so test fixtures do not encode obsolete fields.
  PRESETS: [
    { id: "minimal", name: "Minimal", description: "Core only", capabilities: ["orchestration", "implementation"], includeCustomize: false },
    { id: "standard", name: "Standard (recommended)", description: "Full dev lifecycle", capabilities: ["orchestration", "planning", "implementation", "review", "devops", "maintenance", "board"], includeCustomize: true },
    { id: "full", name: "Full", description: "Everything", capabilities: ["orchestration", "planning", "implementation", "review", "devops", "maintenance", "board", "performance", "ai"], includeCustomize: true },
    { id: "custom", name: "Custom", description: "Choose exactly what you need", capabilities: [], includeCustomize: false },
  ],
  getPreset: vi.fn().mockReturnValue({ id: "standard", name: "Standard (recommended)", description: "Full dev lifecycle", capabilities: ["orchestration", "planning", "implementation", "review", "devops", "maintenance", "board"], includeCustomize: true }),
}));

vi.mock("../../cli/shared/agentsContent.js", () => ({
  generateCanonicalAgentsMd: vi.fn(),
  generateRootAgentsMd: vi.fn(),
}));

vi.mock("../../merge/safeWrite.js", async () => {
  // D2-7 (Cycle 11 Wave 2): the tool-removal path now opens a real pre-deletion
  // snapshot via `withSnapshot` (pipeline/snapshot.js is NOT mocked here), and
  // `createSnapshot` writes its meta.json through `atomicWriteFile`. The prior
  // mock omitted that export, so the snapshot capture threw `atomicWriteFile is
  // not a function`, the Silent Failure Contract downgraded it to a warning, and
  // the session id came back null. Provide a functional `atomicWriteFile` that
  // performs the externally-observable write (mkdir parent + writeFile) so the
  // snapshot lands and a real `config-<ts>` session id is minted — matching
  // production. The fsync/lock ceremony is irrelevant to these assertions.
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  return {
    safeWriteFile: vi.fn(),
    // F1.2-H1 (Cycle 10): configCommand wraps its body in an outer manifest
    // lock; mock returns a no-op release so tests do not need HATCH3R_LOCK=1.
    acquireWriteLock: vi.fn().mockResolvedValue(async () => {}),
    atomicWriteFile: vi.fn(async (filePath: string, content: string | Buffer) => {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content as Parameters<typeof writeFile>[1]);
    }),
  };
});

vi.mock("../../env/mcpEnv.js", () => ({
  ensureEnvMcp: vi.fn(),
  ensureGitignoreEntry: vi.fn(),
  getSourceEnvMcpCommand: vi.fn(),
}));

vi.mock("../../cli/shared/paths.js", () => ({
  findPackageRoot: vi.fn(),
}));

vi.mock("../../workspace/detect.js", () => ({
  detectWorkspaceContext: vi.fn(),
  detectSubRepos: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../workspace/manifest.js", () => ({
  readWorkspaceManifest: vi.fn(),
  writeWorkspaceManifest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../workspace/sync.js", () => ({
  syncWorkspaceRepos: vi.fn().mockResolvedValue({ repos: [] }),
}));

vi.mock("../../workspace/git.js", () => ({
  detectRepoGitIdentity: vi.fn().mockReturnValue({ owner: "", repo: "", defaultBranch: "main", platform: undefined }),
}));

vi.mock("../../cli/shared/ui.js", () => ({
  printBanner: vi.fn(),
  createSpinner: vi.fn(),
  printBox: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  step: vi.fn(),
  label: vi.fn(),
  warn: vi.fn(),
  verbose: vi.fn(),
  // W5-bigfour: configCommand now routes its entry/exit through
  // beginCommand/finishCommand (src/cli/shared/commandOutput.ts), which pulls
  // these state setters + chrome emitters from the ui module. The mock must
  // export them or beginCommand throws before any assertion runs. State
  // getters default to "not quiet / not json / not verbose" so the existing
  // chrome assertions keep observing the human path.
  resetUiState: vi.fn(),
  setJson: vi.fn(),
  setQuiet: vi.fn(),
  setVerbose: vi.fn(),
  isQuiet: vi.fn(() => false),
  isJson: vi.fn(() => false),
  isVerbose: vi.fn(() => false),
  printNextSteps: vi.fn(),
  printTimingSummary: vi.fn(),
}));

// Wave 5 CLI-tooling pivot: the cliTools section in configCommand calls
// findMissingCliTools (real PATH probe) and offerInstaller (inquirer.prompt).
// Without these mocks, offerInstaller consumes the queued features answer
// from setupStandardPrompts, leaving selectedFeatures undefined at
// config.ts:371. Default to "nothing missing" so offerInstaller is never
// invoked; tests that exercise install flow can override per-test.
vi.mock("../../cliTools/detect.js", () => ({
  findMissingCliTools: vi.fn().mockResolvedValue([]),
  detectCliTool: vi.fn(),
  detectCliTools: vi.fn().mockResolvedValue([]),
  probeBin: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../cliTools/install.js", () => ({
  offerInstaller: vi.fn().mockResolvedValue(true),
  buildInstallPlan: vi.fn().mockReturnValue([]),
  currentOsKey: vi.fn().mockReturnValue("mac"),
  printMissingCliToolsDisclaimer: vi.fn(),
}));

// ── Import mocked modules ─────────────────────────────────────

import inquirer from "inquirer";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { runRegenerate } from "../../cli/commands/update.js";
import { archiveToolOutputs, collectToolFiles, removeManagedFilesForPaths } from "../../archive/index.js";
import {
  buildContentIndex,
  archiveCustomizeOverrides,
  countSelectionItems,
  selectionSummary,
  extractContentReferences,
  validateOrchestrationDependencies,
  resolveSelection,
  getAllContentIds,
} from "../../content/index.js";
import { generateCanonicalAgentsMd, generateRootAgentsMd } from "../../cli/shared/agentsContent.js";
import { safeWriteFile, atomicWriteFile } from "../../merge/safeWrite.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { findPackageRoot } from "../../cli/shared/paths.js";
import { printBox, info, error as logError, warn, createSpinner, step, label } from "../../cli/shared/ui.js";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { readWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { findMissingCliTools } from "../../cliTools/detect.js";
import { printMissingCliToolsDisclaimer } from "../../cliTools/install.js";
import type { WorkspaceManifest } from "../../workspace/types.js";

// ── Local test types ─────────────────────────────────────────
//
// Inquirer's `Question` union is wide and noisy at the use sites here;
// the tests only inspect `name`, so a narrow structural type captures
// the contract without committing to inquirer's full type surface.
type PromptQuestion = { name?: string };

// ── Local test helpers (thin wrappers around shared harness) ──

/**
 * Queue the standard configCommand prompt sequence via the shared helper,
 * binding the inquirer mock once so individual tests stay concise.
 */
function setupStandardPrompts(manifest: HatchManifest, overrides: PromptOverrides = {}): void {
  queueStandardPrompts(vi.mocked(inquirer) as unknown as { prompt: MockInstance }, manifest, overrides);
}

/**
 * Prime readManifest + the standard prompt sequence in one call.
 * Covers the two-line boilerplate present in ~80 tests.
 */
function primeConfig(manifest: HatchManifest, overrides: PromptOverrides = {}): HatchManifest {
  return primeConfigBase(
    readManifest,
    vi.mocked(inquirer) as unknown as { prompt: MockInstance },
    manifest,
    overrides,
  );
}

/**
 * Prime a content-management test: readManifest + content index + prompts.
 * `agentIds` seeds both the content index and the selectionSummary count.
 */
function primeContent(manifest: HatchManifest, agentIds: string[], overrides: PromptOverrides = {}): void {
  primeContentBase(
    { readManifest, countSelectionItems, selectionSummary, buildContentIndex },
    vi.mocked(inquirer) as unknown as { prompt: MockInstance },
    manifest,
    agentIds,
    overrides,
  );
}

/** Import configCommand (lazy -- after vi.mock hoists, before each test needs it). */
async function importConfigCommand(): Promise<typeof import("../../cli/commands/config.js")["configCommand"]> {
  return (await import("../../cli/commands/config.js")).configCommand;
}

describe("config command", () => {
  let tempDir: string;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-config-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    // D1-18 (Cycle 11 Wave 3): the interactive flow now refuses to run under a
    // non-TTY stdin (CI/pipe). Under vitest stdin is not a TTY, so mark it
    // interactive for the prompt-driven cases; the dedicated non-TTY test below
    // sets it false explicitly. Restored in afterEach.
    originalStdinIsTTY = process.stdin.isTTY;
    (process.stdin as { isTTY?: boolean }).isTTY = true;
    // Silence console noise from configCommand UI; restored by restoreAllMocks.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
    // Also reset inquirer's prompt queue: clearAllMocks does NOT clear
    // `.mockResolvedValueOnce(...)` queues, and tests that throw early leave
    // unconsumed responses that would leak into the next test's prompt stream.
    vi.mocked(inquirer.prompt).mockReset();

    // Re-apply default mock implementations after clearAllMocks via shared harness
    applyDefaultConfigMocks({
      countSelectionItems,
      selectionSummary,
      extractContentReferences,
      validateOrchestrationDependencies,
      generateCanonicalAgentsMd,
      generateRootAgentsMd,
      ensureEnvMcp,
      getSourceEnvMcpCommand,
      runRegenerate,
      archiveToolOutputs,
      writeManifest,
      detectWorkspaceContext,
      readWorkspaceManifest,
      findPackageRoot,
      createSpinner,
      step,
      label,
    });
    // D10-35 (Cycle 11 Wave 3): archiveCustomizeOverrides returns the customize
    // files it rescued into the archive. The config flow destructures that
    // result, so the default mock must resolve to the empty-rescue shape (the
    // assertion test below sets its own resolved value where it matters).
    vi.mocked(archiveCustomizeOverrides).mockResolvedValue({ archivedCustomizeFiles: [] });
    // D2-SA2.7-01 (Cycle 12): configCommand now consults collectToolFiles to
    // derive the removal preview + rollback snapshot from the FULL on-disk set.
    // Default to empty so tests that do not exercise tool removal are unaffected;
    // the removal tests below set an explicit resolved value.
    vi.mocked(collectToolFiles).mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalStdinIsTTY === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      (process.stdin as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    }
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  // ── No manifest ──────────────────────────────────────────────

  describe("no manifest", () => {
    it("should throw HatchError when no manifest found", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);
      const configCommand = await importConfigCommand();
      await expect(configCommand()).rejects.toThrow(HatchError);
    });

    it("should show error message about missing hatch.json", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);
      const configCommand = await importConfigCommand();
      try { await configCommand(); } catch (err) { /* expected throw */ expect(err).toBeDefined(); }

      expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.stringContaining("No .hatch3r/hatch.json found"));
    });

    it("should throw with central-map exit code 65 (CONFIG_ERROR)", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);
      const configCommand = await importConfigCommand();
      try {
        await configCommand();
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        // C8-D1-M5: CONFIG_ERROR -> EX_DATAERR (65) via ERROR_CODE_TO_EXIT_CODE.
        expect((e as HatchError).exitCode).toBe(65);
      }
    });
  });

  // ── Platform flows ───────────────────────────────────────────

  describe("platform flows", () => {
    it("should prompt for owner and repo on GitHub platform", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { platform: "github" });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as unknown as PromptQuestion[];
      expect(repoPrompt.some((p) => p.name === "owner")).toBe(true);
      expect(repoPrompt.some((p) => p.name === "repo")).toBe(true);
    });

    it("should prompt for org, project, and repo on Azure DevOps platform", async () => {
      const manifest = makeManifest({ platform: "azure-devops" });
      primeConfig(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "my-org", project: "my-proj", repo: "my-repo" },
      });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as unknown as PromptQuestion[];
      expect(repoPrompt.some((p) => p.name === "org")).toBe(true);
      expect(repoPrompt.some((p) => p.name === "project")).toBe(true);
      expect(repoPrompt.some((p) => p.name === "repo")).toBe(true);
    });

    it("should prompt for namespace and project on GitLab platform", async () => {
      const manifest = makeManifest({ platform: "gitlab" });
      primeConfig(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "my-group", project: "my-proj" },
      });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as unknown as PromptQuestion[];
      expect(repoPrompt.some((p) => p.name === "namespace")).toBe(true);
      expect(repoPrompt.some((p) => p.name === "project")).toBe(true);
    });

    it("should set namespace and project to owner and repo for GitHub", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        platform: "github",
        repoAnswers: { owner: "gh-owner", repo: "gh-repo" },
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.namespace).toBe("gh-owner");
      expect(writtenManifest.project).toBe("gh-repo");
    });

    it("should set namespace to org and project for Azure DevOps", async () => {
      const manifest = makeManifest({ platform: "azure-devops" });
      primeConfig(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "ado-org", project: "ado-project", repo: "ado-repo" },
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.owner).toBe("ado-org");
      expect(writtenManifest.namespace).toBe("ado-org");
      expect(writtenManifest.project).toBe("ado-project");
      expect(writtenManifest.repo).toBe("ado-repo");
    });

    it("should set namespace and project for GitLab", async () => {
      const manifest = makeManifest({ platform: "gitlab" });
      primeConfig(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-group", project: "gl-project" },
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.owner).toBe("gl-group");
      expect(writtenManifest.repo).toBe("gl-project");
      expect(writtenManifest.namespace).toBe("gl-group");
      expect(writtenManifest.project).toBe("gl-project");
    });
  });

  // ── Tool selection ───────────────────────────────────────────

  describe("tool selection", () => {
    it("should throw HatchError when no tools selected", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { tools: [] });
      const configCommand = await importConfigCommand();
      await expect(configCommand()).rejects.toThrow(HatchError);
    });

    it("should throw with message about at least one tool required", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { tools: [] });
      const configCommand = await importConfigCommand();
      try {
        await configCommand();
      } catch (e) {
        expect((e as HatchError).message).toContain("At least one tool must be selected");
        // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
        expect((e as HatchError).exitCode).toBe(64);
      }
    });

    it("should preserve existing tools when unchanged", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should detect added tools in diff and update manifest", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.tools).toContain("claude");
    });

    it("should detect removed tools in diff", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      primeConfig(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.tools).toEqual(["cursor"]);
      expect(writtenManifest.tools).not.toContain("claude");
    });
  });

  // ── Feature selection ────────────────────────────────────────

  describe("feature selection", () => {
    it("should preserve existing features when unchanged", async () => {
      const manifest = makeManifest();
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should detect enabled features in diff", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, hooks: false },
      });
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.features.hooks).toBe(true);
    });

    it("should detect disabled features in diff", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.features.hooks).toBe(false);
      expect(writtenManifest.features.mcp).toBe(false);
    });
  });

  // ── 2.1.0: handoffs fix + maturity/confidence interactive surfaces ──
  describe("handoffs feature-rebuild fix (Task D, 2.1.0)", () => {
    it("FEATURE_CHOICES offers handoffs (default-checked) so it round-trips", async () => {
      const { FEATURE_CHOICES } = await import("../../cli/shared/constants.js");
      expect(FEATURE_CHOICES.some((c) => c.value === "handoffs")).toBe(true);
    });

    it("re-running config keeps features.handoffs === true (core regression)", async () => {
      // makeManifest carries DEFAULT_FEATURES.handoffs === true. A tool add
      // forces the write; the feature selection accepts the default set (which
      // now includes handoffs as a checked choice), so handoffs survives.
      const manifest = makeManifest();
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.features.handoffs).toBe(true);
    });

    it("rebuildFeaturesFromSelection preserves a feature absent from the picker", async () => {
      const { rebuildFeaturesFromSelection } = await import("../../cli/commands/config.js");
      const prev: Features = { ...DEFAULT_FEATURES, handoffs: true, mcp: true };
      // Simulate the pre-2.1.0 picker that did NOT render handoffs.
      const pickerVisible: (keyof Features)[] = [
        "agents", "skills", "rules", "prompts", "commands", "mcp", "hooks", "githubAgents",
      ];
      // User unchecks hooks; handoffs is not offered at all.
      const selected: (keyof Features)[] = [
        "agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents",
      ];

      const result = rebuildFeaturesFromSelection(prev, selected, pickerVisible);

      expect(result.handoffs).toBe(true); // unlisted → prior value preserved
      expect(result.hooks).toBe(false);   // listed + unselected → off
      expect(result.mcp).toBe(true);      // listed + selected → on
    });

    it("renders Handoffs checked when the manifest OMITS the key, and keeps it enabled on accept-defaults", async () => {
      // Upgraded manifests written before `handoffs` joined the schema omit the
      // key entirely. DEFAULT_FEATURES.handoffs === true, so the checkbox
      // default must fall back to the schema default and render handoffs CHECKED
      // — otherwise an accept-defaults run rebuilds features.handoffs = false and
      // silently disables it (the existing handoffs tests above use a manifest
      // where the key is present, so they miss this missing-key path).
      const manifest = makeManifest();
      delete (manifest.features as Partial<Features>).handoffs;
      expect(manifest.features.handoffs).toBeUndefined();

      // Accept the (now-checked) default set including handoffs; adding a tool
      // forces the write past the no-changes guard.
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "commands", "mcp", "githubAgents", "hooks", "handoffs"],
        tools: ["cursor", "claude"],
      });

      await (await importConfigCommand())();

      // 1. The features prompt seeded handoffs as a checked default (the fix:
      //    `manifest.features[k] ?? DEFAULT_FEATURES[k]`). Pre-fix the missing
      //    key read as falsy and handoffs was absent from the default set.
      const featuresCall = vi.mocked(inquirer.prompt).mock.calls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "features");
      });
      expect(featuresCall).toBeDefined();
      const featuresQuestion = (featuresCall![0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
      expect(featuresQuestion.default).toContain("handoffs");

      // 2. The accepted selection persists handoffs enabled — no silent disable.
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.features.handoffs).toBe(true);
    });
  });

  describe("maturity + confidence_floor interactive steps (Tasks C/E, 2.1.0)", () => {
    it("the maturity step fires and persists the chosen tier", async () => {
      const manifest = makeManifest(); // no maturity field → resolves to solo
      primeConfig(manifest, { maturity: "scaleup" });

      await (await importConfigCommand())();

      // The maturity prompt was rendered.
      const sawMaturityPrompt = vi.mocked(inquirer.prompt).mock.calls.some((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "maturity");
      });
      expect(sawMaturityPrompt).toBe(true);
      // The tier change alone forces the write (not gated by "No changes").
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("scaleup");
    });

    it("the confidence_floor step fires and persists the chosen floor", async () => {
      const manifest = makeManifest(); // solo, no floor → resolves to "any"
      primeConfig(manifest, { confidenceFloor: "high" });

      await (await importConfigCommand())();

      const sawFloorPrompt = vi.mocked(inquirer.prompt).mock.calls.some((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "confidenceFloor");
      });
      expect(sawFloorPrompt).toBe(true);
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.confidenceFloor).toBe("high");
    });

    it("accepting the maturity + floor defaults registers no change", async () => {
      // makeManifest has no maturity/floor → defaults solo/any; the queued
      // answers mirror those defaults, so the no-changes guard still fires.
      const manifest = makeManifest();
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("seeds the floor default from the in-run maturity bump, not the pre-mutation tier", async () => {
      // solo manifest, no explicit confidenceFloor → pre-mutation floor "any".
      // Bumping maturity to scaleup in the SAME run must seed the floor prompt's
      // default to scaleup's derived "high" (not the stale "any"), so accepting
      // it cannot pin a floor that contradicts the new tier. The inquirer mock
      // returns queued answers regardless of `default`, so the seed is asserted
      // on the rendered prompt; the queued floor answer mirrors accepting it.
      const manifest = makeManifest(); // no maturity / confidenceFloor fields
      expect(manifest.confidenceFloor).toBeUndefined();
      primeConfig(manifest, { maturity: "scaleup", confidenceFloor: "high" });

      await (await importConfigCommand())();

      const floorCall = vi.mocked(inquirer.prompt).mock.calls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "confidenceFloor");
      });
      expect(floorCall).toBeDefined();
      const floorQuestion = (floorCall![0] as unknown as Array<{ name?: string; default?: unknown }>)[0];
      // Pre-fix this default was readConfidenceFloor(pre-mutation solo) === "any".
      expect(floorQuestion.default).toBe("high");

      // Accepting that tier-correct default persists a floor that follows the
      // new tier — no stale "any" pin overriding scaleup's derived "high".
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("scaleup");
      expect(writtenManifest.confidenceFloor).toBe("high");
    });

    it("dry-run preview includes the maturity dial line (Bugbot: config dry-run omits dial lines)", async () => {
      // The live "Config updated" box appends `~ Maturity:` / `~ Confidence
      // floor:` after buildDiffSummaryLines; the `--dry-run` terminus must show
      // the same dial lines so the preview matches what a real run persists.
      const manifest = makeManifest(); // no maturity field → resolves to solo
      primeConfig(manifest, { maturity: "scaleup" });

      await (await importConfigCommand())(undefined, undefined, { dryRun: true });

      // Dry run writes nothing …
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      // … and the dry-run box carries the maturity change line a live run would.
      const dryRunBox = vi
        .mocked(printBox)
        .mock.calls.find((call) => call[0] === "Config dry run (no writes)");
      expect(dryRunBox).toBeDefined();
      const lines = dryRunBox![1] as string[];
      expect(lines.some((l) => l.includes("Maturity: scaleup"))).toBe(true);
    });
  });

  // ── MCP servers ──────────────────────────────────────────────

  describe("MCP servers", () => {
    it("should show MCP prompts when mcp feature enabled", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
        mcpServers: ["github", "context7"],
      });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const mcpCall = promptCalls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "mcp");
      });
      expect(mcpCall).toBeDefined();
    });

    it("should not show MCP prompts when mcp feature disabled", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: [] },
      });
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
      });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const mcpCall = promptCalls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "mcp");
      });
      expect(mcpCall).toBeUndefined();
    });

    it("should auto-add platform MCP server if missing from selection", async () => {
      const manifest = makeManifest({ mcp: { servers: ["context7"] } });
      primeConfig(manifest, {
        mcpServers: ["context7"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.mcp.servers).toContain("github");
      expect(writtenManifest.mcp.servers).toContain("context7");
    });

    it("should detect added and removed MCP in diff", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      primeConfig(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.mcp.servers).toContain("brave-search");
      expect(writtenManifest.mcp.servers).not.toContain("context7");
    });
  });

  // ── Content management ───────────────────────────────────────

  describe("content management", () => {
    it("should use preset selection for content management", async () => {
      const manifest = makeManifest({
        content: makeContentSelection({
          items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        }),
      });
      primeContent(manifest, ["hatch3r-implementer"]);
      vi.mocked(getAllContentIds).mockReturnValue(new Set(["hatch3r-implementer"]));
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer"]);


      await (await importConfigCommand())();

      expect(vi.mocked(buildContentIndex)).toHaveBeenCalled();
      expect(vi.mocked(resolveSelection)).toHaveBeenCalled();
    });

    it("should record added content items manifest-only (no .agents/ materialization)", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer"]);

      // Old selection has implementer, new selection adds reviewer
      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer"], ["hatch3r-implementer", "hatch3r-reviewer"]);
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer", "hatch3r-reviewer"]);


      await (await importConfigCommand())();

      // The add lands in the manifest selection; adapters regenerate from it.
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.content?.items.agents).toContain("hatch3r-reviewer");
      expect(vi.mocked(runRegenerate)).toHaveBeenCalled();
      // Adding never archives overrides, and no write touches a `.agents`
      // path — the 1.9.0 hard-cut removed the mirror entirely.
      expect(vi.mocked(archiveCustomizeOverrides)).not.toHaveBeenCalled();
      const agentsWrites = [
        ...vi.mocked(safeWriteFile).mock.calls,
        ...vi.mocked(atomicWriteFile).mock.calls,
      ].filter(([p]) => typeof p === "string" && p.includes(".agents"));
      expect(agentsWrites).toHaveLength(0);
    });

    it("should NOT archive customize overrides on preset downgrade (D10-SA10.6-02: item still emits under Decision 16, so its override stays live)", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-reviewer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer"]);

      // Old has both, new only has implementer
      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer", "hatch3r-reviewer"], ["hatch3r-implementer"]);
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer"], "minimal");

      setupStandardPrompts(manifest, { contentPreset: "minimal" });

      await (await importConfigCommand())();

      // D10-SA10.6-02: dropping hatch3r-reviewer from the tracked selection does
      // NOT stop the adapters emitting it (readTrackedCanonicalFiles ignores the
      // selection — Decision 16 "dial not gate"). Archiving its `.customize.*`
      // override would detach a live customization from a still-emitted artifact
      // and silently revert it to canonical, so config no longer archives on
      // removal; the override is left live where the user placed it.
      expect(vi.mocked(archiveCustomizeOverrides)).not.toHaveBeenCalled();
    });

    it("should never create a .agents/ tree when content items are added (regression, v1.9.0 hard-cut)", async () => {
      // Pre-1.9 `hatch3r config` materialized added items under `.agents/`
      // via addContentItem. That path is deleted: content changes are
      // manifest-only and runRegenerate produces adapter outputs. Guard the
      // full write surface (safeWriteFile + atomicWriteFile mocks) and the
      // real temp dir against any `.agents` reappearance.
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-protected"]);

      stubContentIdsTransition(
        getAllContentIds,
        ["hatch3r-implementer"],
        ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-protected"],
      );
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer", "hatch3r-reviewer", "hatch3r-protected"]);


      await (await importConfigCommand())();

      const allWritePaths = [
        ...vi.mocked(safeWriteFile).mock.calls,
        ...vi.mocked(atomicWriteFile).mock.calls,
      ].map(([p]) => p);
      expect(allWritePaths.filter((p) => typeof p === "string" && p.includes(".agents"))).toEqual([]);
      // The on-disk project tree gained no `.agents/` directory either.
      await expect(stat(join(tempDir, ".agents"))).rejects.toThrow();
    });

    it("should update manifest content after preset change", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-testability"]);

      const newSelection = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-testability"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer"], ["hatch3r-implementer", "hatch3r-testability"]);
      vi.mocked(resolveSelection).mockReturnValue(newSelection);


      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.content?.items.agents).toContain("hatch3r-implementer");
      expect(writtenManifest.content?.items.agents).toContain("hatch3r-testability");
    });

    it("should NOT emit AGENTS.md after content changes (F10.5-1 Cycle 10)", async () => {
      // F10.5-1 (Cycle 10): config.ts no longer emits canonical or root
      // AGENTS.md after content changes — aligns with sync.ts:303 +
      // init.ts:509-510 + update.ts:304-306 Wave 3 contract. Adapters source
      // canonical content from the bundled package via
      // resolveBundledContentRoot(); writing AGENTS.md from config left a
      // dangling root AGENTS.md after tool switches or `hatch3r clean`.
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer"]);

      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer"], ["hatch3r-implementer", "hatch3r-reviewer"]);
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer", "hatch3r-reviewer"]);


      await (await importConfigCommand())();

      // Neither canonical nor root AGENTS.md should be written by config.
      expect(vi.mocked(generateCanonicalAgentsMd)).not.toHaveBeenCalled();
      expect(vi.mocked(generateRootAgentsMd)).not.toHaveBeenCalled();
      const agentsMdWrites = vi.mocked(safeWriteFile).mock.calls.filter(
        ([p]) => typeof p === "string" && p.endsWith("AGENTS.md"),
      );
      expect(agentsMdWrites).toHaveLength(0);
    });

    it("should not regenerate AGENTS.md when no content changes (F10.5-1 Cycle 10)", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer"]);

      // Both old and new resolve to the same set — no changes
      vi.mocked(getAllContentIds).mockReturnValue(new Set(["hatch3r-implementer"]));
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer"]);


      await (await importConfigCommand())();

      expect(vi.mocked(generateCanonicalAgentsMd)).not.toHaveBeenCalled();
    });
  });

  // ── No changes ───────────────────────────────────────────────

  describe("no changes", () => {
    it("should print 'No changes detected' when diff is empty", async () => {
      const manifest = makeManifest();
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should return without calling writeManifest or runRegenerate", async () => {
      const manifest = makeManifest();
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
    });
  });

  // ── Archive ──────────────────────────────────────────────────

  describe("archive", () => {
    it("should archive removed tool outputs", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: [".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledWith(tempDir, "claude");
    });

    it("should show archive count in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["file1.md", "file2.md", "file3.md"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(printBox)).toHaveBeenCalled();
      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Archived");
    });

    it("should call removeManagedFilesForPaths for archived files", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(removeManagedFilesForPaths)).toHaveBeenCalledWith(
        manifest,
        ["CLAUDE.md", ".claude/settings.json"],
      );
    });

    // D2-6 (Cycle 11 Wave 2): the tool-removal confirm prompt must name the real
    // archive destination via ARCHIVE_DIR, not the drifted `.hatch3r/archive/`
    // literal it used to print (the on-disk path is `${ARCHIVE_DIR}/<tool>/<ts>/`).
    it("tool-removal confirm prompt references ARCHIVE_DIR (no path drift)", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      // Find the inquirer.prompt call that posed the `confirmArchive` question.
      const confirmCall = vi.mocked(inquirer.prompt).mock.calls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "confirmArchive");
      });
      expect(confirmCall).toBeDefined();
      const archiveQuestion = (confirmCall![0] as unknown as Array<{ name?: string; message?: string }>).find(
        (q) => q.name === "confirmArchive",
      );
      // The literal ".hatch3r-archive" (ARCHIVE_DIR's value) must appear; the
      // stale ".hatch3r/archive/" literal must not.
      expect(archiveQuestion?.message).toContain(ARCHIVE_DIR);
      expect(archiveQuestion?.message).not.toContain(".hatch3r/archive/");
    });

    // D2-5 (Cycle 11 Wave 2): the prompt must name the SUPPORTED recovery path —
    // the `hatch3r rollback` snapshot D2-7 captures — and must NOT present the
    // gitignored, clean-deleted `${ARCHIVE_DIR}/` as the recovery source. The
    // prior "...and can be recovered" wording made the archive look durable.
    it("tool-removal confirm prompt points recovery at hatch3r rollback, not the archive dir", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const confirmCall = vi.mocked(inquirer.prompt).mock.calls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "confirmArchive");
      });
      const archiveQuestion = (confirmCall![0] as unknown as Array<{ name?: string; message?: string }>).find(
        (q) => q.name === "confirmArchive",
      );
      // Recovery is steered to the rollback command...
      expect(archiveQuestion?.message).toContain("hatch3r rollback");
      // ...and the archive is qualified as an inspection copy, not "recovered".
      expect(archiveQuestion?.message).toContain("inspection");
      expect(archiveQuestion?.message).not.toContain("can be recovered");
    });

    // D2-7 (Cycle 11 Wave 2): tool removal must snapshot the dropped tool's files
    // BEFORE the archive deletes them and thread that session into runRegenerate
    // (reuseSessionId) so the single advertised `config-<ts>` rollback restores
    // the removed tool. Asserts runRegenerate receives a `reuseSessionId`.
    it("reuses the pre-deletion snapshot session for runRegenerate on tool removal", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md", ".claude/settings.json"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const regenCall = vi.mocked(runRegenerate).mock.calls.at(-1);
      expect(regenCall).toBeDefined();
      const opts = regenCall![2] as { snapshotCommandName?: string; reuseSessionId?: string };
      expect(opts.snapshotCommandName).toBe("config");
      // A real `config-<ts>` session id was minted by the pre-deletion snapshot
      // and handed to runRegenerate to accumulate into.
      expect(opts.reuseSessionId).toMatch(/^config-/);
    });

    // D2-5 (Cycle 11 Wave 2): the tool-removal migration notes must steer
    // recovery to the rollback snapshot (`hatch3r rollback --session=<id>`),
    // not present `${ARCHIVE_DIR}/` as "recoverable" — the archive is gitignored
    // and `hatch3r clean` deletes it, so it is an inspection copy only.
    it("migration notes steer undo to hatch3r rollback, not the archive (recoverable claim removed)", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md", ".claude/settings.json"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const infoMessages = vi.mocked(info).mock.calls.map((c) => String(c[0]));
      // The undo line names the live rollback session captured by D2-7.
      expect(infoMessages.some((m) => /hatch3r rollback --session=config-/.test(m))).toBe(true);
      // No surface calls the archive dir "recoverable" anymore.
      expect(infoMessages.some((m) => m.includes("(recoverable)"))).toBe(false);
      // The archive copy is described as inspection-only.
      expect(infoMessages.some((m) => m.includes("inspection copy"))).toBe(true);
    });

    // D2-7: when NO tool is removed, runRegenerate mints its own session — the
    // reuseSessionId field is absent so behavior is unchanged from pre-D2-7.
    it("does not pass reuseSessionId when no tool is removed", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const regenCall = vi.mocked(runRegenerate).mock.calls.at(-1);
      expect(regenCall).toBeDefined();
      const opts = regenCall![2] as { snapshotCommandName?: string; reuseSessionId?: string };
      expect(opts.snapshotCommandName).toBe("config");
      expect(opts.reuseSessionId).toBeUndefined();
    });

    // D2-SA2.7-01 (Cycle 12, D2, P6): the pre-deletion rollback snapshot must
    // cover EVERY file the archive loop removes — including user-authored files
    // under the tool's paths — not just `managedFilesByAdapter`. Otherwise the
    // advertised `hatch3r rollback` cannot restore them and their only surviving
    // copy sits in the gitignored, `hatch3r clean`-deleted archive. Asserts
    // withSnapshot receives the FULL collectToolFiles set (managed + user file).
    it("snapshots user-authored files under a removed tool's paths, not just the managed subset (D2-SA2.7-01)", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      // collectToolFiles returns the FULL on-disk set: the managed CLAUDE.md
      // plus a user-authored settings.local.json the manifest never tracked.
      vi.mocked(collectToolFiles).mockResolvedValue([
        "CLAUDE.md",
        ".claude/settings.local.json",
      ]);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.local.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      // Spy on the real withSnapshot (deliberately un-mocked) to capture the
      // path set config.ts hands it, while the real session still mints.
      const snapshotModule = await import("../../pipeline/snapshot.js");
      const withSnapshotSpy = vi.spyOn(snapshotModule, "withSnapshot");

      await (await importConfigCommand())();

      // The pre-deletion removal snapshot call: first arg "config", second arg
      // the absolute path set. It must include BOTH the managed and the
      // user-authored file (so rollback restores 100% of what archive removes).
      const snapCall = withSnapshotSpy.mock.calls.find(
        (c) =>
          c[0] === "config" &&
          Array.isArray(c[1]) &&
          (c[1] as string[]).some((p) => p.includes("settings.local.json")),
      );
      expect(snapCall).toBeDefined();
      const snapshottedPaths = snapCall![1] as string[];
      expect(snapshottedPaths).toContain(join(tempDir, "CLAUDE.md"));
      expect(snapshottedPaths).toContain(
        join(tempDir, ".claude/settings.local.json"),
      );
      // collectToolFiles (not managedFilesByAdapter) is the snapshot source.
      expect(vi.mocked(collectToolFiles)).toHaveBeenCalledWith(tempDir, "claude");
    });

    // D2-SA2.7-01: the consent preview must DISCLOSE non-managed files that will
    // also be archived+deleted, so the user is not surprised by data loss they
    // did not knowingly consent to. Asserts a warn() line names the surplus.
    it("warns that non-managed files under a removed tool's paths will also be archived (D2-SA2.7-01)", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(collectToolFiles).mockResolvedValue([
        "CLAUDE.md",
        ".claude/settings.local.json",
      ]);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.local.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const warnMessages = vi.mocked(warn).mock.calls.map((c) => String(c[0]));
      const surplusWarning = warnMessages.find((m) =>
        m.includes("NOT hatch3r-managed"),
      );
      expect(surplusWarning).toBeDefined();
      expect(surplusWarning).toContain("1 file(s)");
      expect(surplusWarning).toContain(".claude/settings.local.json");
    });

    // D2-SA2.7-01 negative: when every on-disk file IS managed, no surplus
    // warning fires — the disclosure is scoped to genuinely un-managed files.
    it("does not warn about non-managed files when the on-disk set is fully managed (D2-SA2.7-01)", async () => {
      const manifest = makeManifest({
        tools: ["cursor", "claude"],
        managedFilesByAdapter: { claude: ["CLAUDE.md", ".claude/settings.json"] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(collectToolFiles).mockResolvedValue([
        "CLAUDE.md",
        ".claude/settings.json",
      ]);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const warnMessages = vi.mocked(warn).mock.calls.map((c) => String(c[0]));
      expect(warnMessages.some((m) => m.includes("NOT hatch3r-managed"))).toBe(
        false,
      );
    });
  });

  // ── Update + env ─────────────────────────────────────────────

  describe("update and env", () => {
    it("should call runRegenerate after manifest changes", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      // Decision 27 (Bucket 2.2) wiring: config passes
      // `snapshotCommandName: "config"` so the pre-mutation snapshot
      // captured inside `runRegenerate` is namespaced `config-...`.
      expect(vi.mocked(runRegenerate)).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ tools: ["cursor", "claude"] }),
        expect.objectContaining({ snapshotCommandName: "config" }),
      );
    });

    it("should call ensureEnvMcp for MCP servers when mcp feature enabled", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      primeConfig(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(ensureEnvMcp)).toHaveBeenCalledWith(
        tempDir,
        expect.arrayContaining(["github", "brave-search"]),
      );
      expect(vi.mocked(ensureGitignoreEntry)).toHaveBeenCalledWith(tempDir);
    });

    it("should warn about new secrets needed when ensureEnvMcp reports new vars", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(ensureEnvMcp).mockResolvedValue({
        action: "updated",
        path: ".env.mcp",
        newVars: ["BRAVE_API_KEY"],
      });
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("BRAVE_API_KEY"));
    });

    it("should not call ensureEnvMcp when mcp feature is disabled", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: [] },
      });
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
        tools: ["cursor", "claude"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(ensureEnvMcp)).not.toHaveBeenCalled();
    });

    it("should handle ensureEnvMcp errors gracefully", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(ensureEnvMcp).mockRejectedValue(new Error("Permission denied"));
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      await (await importConfigCommand())();

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("Could not update .env.mcp"));
    });
  });

  // ── Summary output ───────────────────────────────────────────

  describe("summary output", () => {
    it("should show added tools in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(printBox)).toHaveBeenCalled();
      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Tools added", "Claude Code");
    });

    it("should show removed tools in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: [], migrations: [] });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Tools removed", "Claude Code");
    });

    it("should show platform change in summary", async () => {
      const manifest = makeManifest({ platform: "github" });
      primeConfig(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-group", project: "gl-project" },
        mcpServers: ["gitlab"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Platform");
    });

    it("should show content changes in summary", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer"]);

      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer"], ["hatch3r-implementer", "hatch3r-reviewer"]);
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer", "hatch3r-reviewer"]);


      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Content added");
    });

    it("should show version in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(runRegenerate).mockResolvedValue({ copiedFiles: 10, syncedTools: 2, failedTools: 0, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Version", "1.1.0");
    });

    it("should show files and tools count in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(runRegenerate).mockResolvedValue({ copiedFiles: 15, syncedTools: 2, failedTools: 0, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      const filesLine = lines.find((l) => typeof l === "string" && l.includes("Files"));
      const toolsLine = lines.find((l) => typeof l === "string" && l.includes("Tools") && l.includes("synced"));
      expect(filesLine).toContain("15");
      expect(toolsLine).toContain("2");
    });

    // D1-3 (Cycle 11 Wave 2): a partial adapter-regenerate failure must NOT
    // exit 0 with a green "Config updated" box. config now honours the same
    // partial-failure contract `update`/`sync` enforce — it titles the box
    // "Config updated with errors", styles it as a warning, names the failed
    // count, then throws an exit-2 ADAPTER_ERROR.
    it("throws exit-2 ADAPTER_ERROR and renders a warning box on partial adapter failure", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      // 2 tools resolved, 1 regenerated, 1 failed → partial failure.
      vi.mocked(runRegenerate).mockResolvedValue({ copiedFiles: 8, syncedTools: 1, failedTools: 1, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      let thrown: unknown;
      try {
        await (await importConfigCommand())();
        expect.unreachable("Expected a partial-adapter-failure HatchError");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HatchError);
      expect((thrown as HatchError).exitCode).toBe(2);
      expect((thrown as HatchError).errorCode).toBe("ADAPTER_ERROR");

      // The summary box rendered as a warning titled "Config updated with errors",
      // and the green "Config updated" box was NOT used.
      const calls = vi.mocked(printBox).mock.calls as unknown as [string, string[], string][];
      const warnBox = calls.find((c) => c[0] === "Config updated with errors");
      expect(warnBox).toBeDefined();
      expect(warnBox![2]).toBe("warning");
      expect(warnBox![1].some((l) => typeof l === "string" && l.includes("Adapters failed"))).toBe(true);
      expect(calls.some((c) => c[0] === "Config updated")).toBe(false);
    });

    // D1-3: a clean regenerate (failedTools 0) keeps the green box and does not throw.
    it("keeps the green 'Config updated' box when no adapters fail", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(runRegenerate).mockResolvedValue({ copiedFiles: 12, syncedTools: 2, failedTools: 0, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const calls = vi.mocked(printBox).mock.calls as unknown as [string, string[], string][];
      expect(calls.some((c) => c[0] === "Config updated")).toBe(true);
      expect(calls.some((c) => c[0] === "Config updated with errors")).toBe(false);
    });

    it("should show MCP added in summary", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      primeConfig(manifest, {
        mcpServers: ["github", "context7"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "MCP added", "context7");
    });

    it("should show MCP removed in summary", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      primeConfig(manifest, {
        mcpServers: ["github"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "MCP removed", "context7");
    });

    it("should show enabled features in summary", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, hooks: false },
      });
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Features enabled", "hooks");
    });

    it("should show disabled features in summary", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Features disabled");
    });

    it("should show repo change in summary", async () => {
      const manifest = makeManifest({ owner: "old-org", repo: "old-repo" });
      primeConfig(manifest, {
        repoAnswers: { owner: "new-org", repo: "new-repo" },
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Repo");
    });

    it("should show default branch change in summary", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { branch: "develop" });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Default branch", "develop");
    });

    it("should show content removed in summary", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-reviewer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      primeContent(manifest, ["hatch3r-implementer", "hatch3r-reviewer"]);

      stubContentIdsTransition(getAllContentIds, ["hatch3r-implementer", "hatch3r-reviewer"], ["hatch3r-implementer"]);
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer"], "minimal");

      setupStandardPrompts(manifest, { contentPreset: "minimal" });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Content removed");
    });

    it("should show migrations when present", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md"],
        migrations: [{ from: "CLAUDE.md", to: ".hatch3r/custom.md", type: "rule", id: "my-rule" }],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("Customizations migrated"));
    });
  });

  // ── Manifest update ──────────────────────────────────────────

  describe("manifest update", () => {
    it("should apply platform to manifest", async () => {
      const manifest = makeManifest({ platform: "github" });
      primeConfig(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-ns", project: "gl-proj" },
        mcpServers: ["gitlab"],
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.platform).toBe("gitlab");
    });

    it("should apply tools to manifest", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude", "copilot"] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.tools).toEqual(["cursor", "claude", "copilot"]);
    });

    it("should apply features to manifest", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "rules"],
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.features.agents).toBe(true);
      expect(writtenManifest.features.rules).toBe(true);
      expect(writtenManifest.features.skills).toBe(false);
      expect(writtenManifest.features.mcp).toBe(false);
    });

    it("should apply MCP servers to manifest", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      primeConfig(manifest, {
        mcpServers: ["github", "context7", "playwright"],
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.mcp.servers).toEqual(expect.arrayContaining(["github", "context7", "playwright"]));
    });

    it("should update board when board exists", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        repoAnswers: { owner: "new-owner", repo: "new-repo" },
        branch: "develop",
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.board?.owner).toBe("new-owner");
      expect(writtenManifest.board?.repo).toBe("new-repo");
      expect(writtenManifest.board?.defaultBranch).toBe("develop");
    });

    it("should create board when it does not exist and branch differs from main", async () => {
      const manifest = makeManifest({ board: undefined });
      primeConfig(manifest, { branch: "develop" });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.board).toBeDefined();
      expect(writtenManifest.board?.defaultBranch).toBe("develop");
      expect(writtenManifest.board?.branchConvention).toBe("{type}/{short-description}");
    });

    it("preserves existing MCP servers when mcp feature is disabled (Wave 3 plan §4.4)", async () => {
      // Wave 3 (CLI-tooling pivot, plan §4.4): disabling the mcp feature no
      // longer wipes the server list — the user may toggle the feature off
      // temporarily and expects their setup intact when toggling back on.
      // The gate runs only when features.mcp is true; otherwise mcpServers
      // is initialised from the existing manifest entry and passed through.
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      // Existing manifest.mcp.servers = ["github"] is preserved.
      expect(writtenManifest.mcp.servers).toEqual(["github"]);
    });

    it("should write manifest to rootDir", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(tempDir, expect.any(Object));
    });
  });

  // ── Helper functions (tested via configCommand orchestration) ─

  describe("helper functions via orchestration", () => {
    it("computeDiff: detects no tool changes", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("computeDiff: detects tool additions", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Tools added"))).toBe(true);
    });

    it("computeDiff: detects tool removals", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: [], migrations: [] });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Tools removed"))).toBe(true);
    });

    it("computeDiff: detects platform change", async () => {
      const manifest = makeManifest({ platform: "github" });
      primeConfig(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "my-org", project: "my-proj", repo: "my-repo" },
        mcpServers: ["azure-devops"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Platform"))).toBe(true);
    });

    it("computeDiff: detects repo change", async () => {
      const manifest = makeManifest({ owner: "old", repo: "old-repo" });
      primeConfig(manifest, {
        repoAnswers: { owner: "new-org", repo: "new-repo" },
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Repo"))).toBe(true);
    });

    it("computeDiff: detects MCP additions", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      primeConfig(manifest, {
        mcpServers: ["github", "playwright"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("MCP added"))).toBe(true);
    });

    it("computeDiff: detects MCP removals", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      primeConfig(manifest, {
        mcpServers: ["github"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("MCP removed"))).toBe(true);
    });

    it("computeDiff: detects feature enables", async () => {
      const manifest = makeManifest({ features: { ...DEFAULT_FEATURES, hooks: false, mcp: false } });
      primeConfig(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features enabled"))).toBe(true);
    });

    it("computeDiff: detects feature disables", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        features: ["agents", "skills", "rules"],
      });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features disabled"))).toBe(true);
    });

    it("isDiffEmpty: returns true when nothing changed", async () => {
      const manifest = makeManifest();
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
    });

    it("isDiffEmpty: returns false when only branch changed", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { branch: "release" });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
    });

    it("printCurrentConfig: is called before prompts", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(0);
      setupStandardPrompts(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(printBox)).toHaveBeenCalledWith(
        "Current configuration",
        expect.any(Array),
        "info",
      );
    });

    it("printCurrentConfig: shows content count when content exists", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-reviewer"], skills: [], rules: ["hatch3r-code-standards"], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(3);
      vi.mocked(selectionSummary).mockReturnValue("2 agents, 1 rules");
      setupStandardPrompts(manifest);

      await (await importConfigCommand())();

      const lines = getCurrentConfigBox(printBox);
      expectSummaryLine(lines, "Content");
    });

    it("printCurrentConfig: handles missing platform", async () => {
      // Intentionally undefined to exercise the missing-platform branch.
      const manifest = makeManifest({ platform: undefined as unknown as HatchManifest["platform"] });
      primeConfig(manifest, { platform: "github" });

      await (await importConfigCommand())();

      // Helper throws if the box is missing -- assertion is implicit.
      getCurrentConfigBox(printBox);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle manifest without board", async () => {
      const manifest = makeManifest({ board: undefined });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.board).toBeDefined();
    });

    it("should handle manifest without content", async () => {
      const manifest = makeManifest({ content: undefined });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const contentCall = promptCalls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "manage");
      });
      expect(contentCall).toBeUndefined();
    });

    it("should handle empty branch input by falling back to current branch", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { branch: "" });

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should sanitize user inputs for repo identity", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, {
        repoAnswers: { owner: "test/org@bad", repo: "test repo!" },
      });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.owner).not.toContain("/");
      expect(writtenManifest.owner).not.toContain("@");
      expect(writtenManifest.repo).not.toContain("!");
      expect(writtenManifest.repo).not.toContain(" ");
    });

    it("should archive multiple removed tools", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude", "copilot"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: ["file1.md"], migrations: [] });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      await (await importConfigCommand())();

      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledWith(tempDir, "claude");
      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledWith(tempDir, "copilot");
    });

    it("should call writeManifest before runRegenerate", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const callOrder: string[] = [];
      vi.mocked(writeManifest).mockImplementation(async () => { callOrder.push("writeManifest"); });
      vi.mocked(runRegenerate).mockImplementation(async () => {
        callOrder.push("runRegenerate");
        return { copiedFiles: 10, syncedTools: 1, failedTools: 0, version: "1.1.0" };
      });

      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(callOrder).toEqual(["writeManifest", "runRegenerate"]);
    });
  });

  // ── Workspace context ─────────────────────────────────────────

  describe("workspace context", () => {
    it("should show member warning and exit when user chooses workspace", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(detectWorkspaceContext).mockResolvedValue({
        type: "workspace-member",
        workspaceRoot: "/path/to/workspace",
        rootPath: "../..",
      });

      // User chooses to switch to workspace root
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ action: "workspace" });

      await (await importConfigCommand())();

      expect(vi.mocked(warn)).toHaveBeenCalledWith(
        expect.stringContaining("managed by workspace"),
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("cd /path/to/workspace"),
      );
      // Should NOT have written manifest (early return)
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("should continue with local config when member chooses local", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(detectWorkspaceContext).mockResolvedValue({
        type: "workspace-member",
        workspaceRoot: "/path/to/workspace",
        rootPath: "../..",
      });

      // User chooses to configure locally -- prepend the action prompt
      const inquirerMock = vi.mocked(inquirer);
      inquirerMock.prompt.mockResolvedValueOnce({ action: "local" });
      setupStandardPrompts(manifest);

      await (await importConfigCommand())();

      // Should still warn but proceed
      expect(vi.mocked(warn)).toHaveBeenCalledWith(
        expect.stringContaining("managed by workspace"),
      );
    });

    it("should show workspace header for workspace-root context", async () => {
      // Use tools different from default to ensure a diff is detected
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(detectWorkspaceContext).mockResolvedValue({
        type: "workspace-root",
        workspaceRoot: "/path/to/workspace",
      });
      vi.mocked(readWorkspaceManifest).mockResolvedValue({
        version: "1.0.0",
        hatch3rVersion: "1.5.0",
        name: "my-workspace",
        repos: [
          { path: "repo-a", name: "repo-a", sync: true },
          { path: "repo-b", name: "repo-b", sync: false },
        ],
        defaults: {
          tools: ["cursor"],
          features: { ...DEFAULT_FEATURES },
          mcp: { servers: ["github"] },
          content: makeContentSelection(),
        },
        syncStrategy: "manual",
      } satisfies WorkspaceManifest);

      // Change tools to create a diff so config proceeds past "no changes"
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });
      // Add the workspace management prompt (decline to manage)
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ manageWorkspace: false });

      await (await importConfigCommand())();

      // Should show workspace-aware header box
      expect(vi.mocked(printBox)).toHaveBeenCalledWith(
        expect.stringContaining("Workspace configuration (2 repos)"),
        expect.any(Array),
        "info",
      );
      // Should save workspace defaults even without managing
      expect(vi.mocked(writeWorkspaceManifest)).toHaveBeenCalled();
    });

    it("should not show workspace prompts for standalone context", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(detectWorkspaceContext).mockResolvedValue({ type: "standalone" });

      setupStandardPrompts(manifest);

      await (await importConfigCommand())();

      // Should not show workspace header or member warning
      expect(vi.mocked(warn)).not.toHaveBeenCalledWith(
        expect.stringContaining("managed by workspace"),
      );
      expect(vi.mocked(writeWorkspaceManifest)).not.toHaveBeenCalled();
    });

    // C8-D1-M7 (D1 Medium): Workspace manifest-write + sync-now atomicity.
    // sync-now must run BEFORE writeWorkspaceManifest so the persisted
    // manifest reflects the last state that successfully propagated to
    // sub-repos (or, on failure, surfaces the partial state to the user).
    describe("manifest-write + sync atomicity (C8-D1-M7)", () => {
      function queueManageWorkspacePrompts(manifest: HatchManifest, syncNow: boolean): void {
        // Tool change ensures diff is non-empty and config proceeds.
        setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });
        // manageWorkspace = true
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ manageWorkspace: true });
        // syncRepos: keep repo-a synced
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ syncRepos: ["repo-a"] });
        // editIdentity: keep current
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ editIdentity: "keep" });
        // strategy: manual
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ strategy: "manual" });
        // syncNow prompt
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({ syncNow });
      }

      function primeWorkspaceRoot(): HatchManifest {
        const manifest = makeManifest({ tools: ["cursor"] });
        vi.mocked(readManifest).mockResolvedValue(manifest);
        vi.mocked(detectWorkspaceContext).mockResolvedValue({
          type: "workspace-root",
          workspaceRoot: "/path/to/workspace",
        });
        vi.mocked(readWorkspaceManifest).mockResolvedValue({
          version: "1.0.0",
          hatch3rVersion: "1.5.0",
          name: "my-workspace",
          repos: [{ path: "repo-a", name: "repo-a", sync: true }],
          defaults: {
            tools: ["cursor"],
            features: { ...DEFAULT_FEATURES },
            mcp: { servers: ["github"] },
            content: makeContentSelection(),
          },
          syncStrategy: "manual",
        } satisfies WorkspaceManifest);
        return manifest;
      }

      it("should call syncWorkspaceRepos BEFORE writeWorkspaceManifest when user opts to sync", async () => {
        const manifest = primeWorkspaceRoot();
        queueManageWorkspacePrompts(manifest, /* syncNow */ true);

        const callOrder: string[] = [];
        vi.mocked(syncWorkspaceRepos).mockImplementation(async () => {
          callOrder.push("sync");
          return { repos: [{ path: "repo-a", added: [], removed: [], toolsSynced: ["cursor"], action: "synced" }] };
        });
        vi.mocked(writeWorkspaceManifest).mockImplementation(async () => {
          callOrder.push("write");
        });

        await (await importConfigCommand())();

        // First observed event must be sync (before any manifest write),
        // last observed event must be write (after sync resolves).
        expect(callOrder[0]).toBe("sync");
        expect(callOrder[callOrder.length - 1]).toBe("write");
      });

      it("should still persist manifest and warn when syncWorkspaceRepos rejects", async () => {
        const manifest = primeWorkspaceRoot();
        queueManageWorkspacePrompts(manifest, /* syncNow */ true);

        vi.mocked(syncWorkspaceRepos).mockRejectedValueOnce(new Error("network down"));

        await (await importConfigCommand())();

        // Manifest IS still persisted so the user's in-memory selections
        // (strategy + repo sync flags) are not silently discarded.
        expect(vi.mocked(writeWorkspaceManifest)).toHaveBeenCalled();
        // User is warned that the on-disk manifest now references un-synced
        // state that must be reconciled with `hatch3r sync`.
        expect(vi.mocked(warn)).toHaveBeenCalledWith(
          expect.stringContaining("Workspace manifest persisted"),
        );
      });

      it("should persist manifest once without warning when user declines syncNow", async () => {
        const manifest = primeWorkspaceRoot();
        queueManageWorkspacePrompts(manifest, /* syncNow */ false);

        await (await importConfigCommand())();

        // Sync is NOT attempted
        expect(vi.mocked(syncWorkspaceRepos)).not.toHaveBeenCalled();
        // Manifest persisted exactly once (no redundant second write)
        expect(vi.mocked(writeWorkspaceManifest)).toHaveBeenCalledTimes(1);
        // No atomicity warning when sync never ran
        expect(vi.mocked(warn)).not.toHaveBeenCalledWith(
          expect.stringContaining("Workspace manifest persisted"),
        );
      });

      it("should warn and still persist manifest when syncWorkspaceRepos reports per-repo errors", async () => {
        const manifest = primeWorkspaceRoot();
        queueManageWorkspacePrompts(manifest, /* syncNow */ true);

        vi.mocked(syncWorkspaceRepos).mockResolvedValueOnce({
          repos: [{
            path: "repo-a",
            added: [],
            removed: [],
            toolsSynced: [],
            action: "error",
            error: "Directory not found: repo-a",
          }],
        });

        await (await importConfigCommand())();

        expect(vi.mocked(writeWorkspaceManifest)).toHaveBeenCalled();
        expect(vi.mocked(warn)).toHaveBeenCalledWith(
          expect.stringContaining("Workspace manifest persisted"),
        );
      });
    });
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.4) ──────────────────────
  //
  // Coverage for the new CLI tools section in configCommand and the
  // Yes/No MCP gate:
  //  - CLI tools picker appears between tools and features.
  //  - The diff surfaces addedCliTools / removedCliTools correctly.
  //  - MCP gate defaults Yes when existing servers are configured, No when
  //    the manifest has none.
  describe("CLI tools section (Wave 5 plan §4.4)", () => {
    it("persists the CLI tools selection into manifest.cliTools", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { cliTools: ["ripgrep", "jq"] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.cliTools).toBeDefined();
      expect(writtenManifest.cliTools?.enabled).toBe(true);
      expect(writtenManifest.cliTools?.selected).toEqual(["ripgrep", "jq"]);
    });

    it("disables cliTools when the picker returns an empty list and manifest had none", async () => {
      // No prior cliTools in manifest + empty picker selection -> diff is empty
      // along the CLI-tools axis, but we still need to surface a side change to
      // force writeManifest. Trigger a feature change so the manifest writes.
      const manifest = makeManifest({
        cliTools: { enabled: true, selected: ["jq"] },
      });
      primeConfig(manifest, { cliTools: [] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.cliTools?.enabled).toBe(false);
      expect(writtenManifest.cliTools?.selected).toEqual([]);
    });

    it("computes addedCliTools when the picker adds an id not present before", async () => {
      const manifest = makeManifest({
        cliTools: { enabled: true, selected: ["ripgrep"] },
      });
      primeConfig(manifest, { cliTools: ["ripgrep", "jq"] });

      await (await importConfigCommand())();

      // The summary box surfaces "+jq" under "CLI tools" — check the rendered
      // line set rather than re-deriving the diff struct.
      const summary = getConfigUpdatedBox(printBox).join("\n");
      // Plan §4.4: diff lines mention added/removed CLI tools by id.
      expect(summary).toContain("jq");
    });

    it("computes removedCliTools when the picker drops an id present before", async () => {
      const manifest = makeManifest({
        cliTools: { enabled: true, selected: ["ripgrep", "jq"] },
      });
      primeConfig(manifest, { cliTools: ["ripgrep"] });

      await (await importConfigCommand())();

      const summary = getConfigUpdatedBox(printBox).join("\n");
      // The removed id surfaces in the diff output.
      expect(summary).toContain("jq");
    });

    it("invokes printMissingCliToolsDisclaimer when a final detection pass reports missing tools", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { cliTools: ["ripgrep", "jq"] });
      vi.mocked(findMissingCliTools).mockResolvedValueOnce([]).mockResolvedValueOnce(["jq"]);

      await (await importConfigCommand())();

      expect(vi.mocked(printMissingCliToolsDisclaimer)).toHaveBeenCalledWith(["jq"], 2);
    });

    it("does not invoke printMissingCliToolsDisclaimer when no CLI tools are selected", async () => {
      const manifest = makeManifest({
        tools: ["cursor"],
        cliTools: { enabled: false, selected: [] },
      });
      primeConfig(manifest, { tools: ["cursor", "claude"], cliTools: [] });

      await (await importConfigCommand())();

      expect(vi.mocked(printMissingCliToolsDisclaimer)).not.toHaveBeenCalled();
    });
  });

  describe("MCP Yes/No gate (Wave 5 plan §4.4)", () => {
    it("gate defaults Yes when manifest already has MCP servers (servers survive a same-diff run)", async () => {
      // Existing servers -> gate proceeds by default -> picker runs and the
      // server list survives. Force a side-channel change (add a tool) so
      // writeManifest is invoked and we can inspect the persisted shape.
      const manifest = makeManifest({
        tools: ["cursor"],
        mcp: { servers: ["github"] },
      });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.mcp.servers).toContain("github");
    });

    it("gate defaults No when manifest has no MCP servers (Wave 3 default-off)", async () => {
      // Empty servers + features.mcp true -> gate defaults No -> picker does
      // NOT run -> servers remain empty. Force a side-channel change to
      // produce a non-empty diff so writeManifest is invoked.
      const manifest = makeManifest({
        tools: ["cursor"],
        mcp: { servers: [] },
      });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      // No servers were picked because the gate defaulted to No.
      expect(writtenManifest.mcp.servers).toEqual([]);
    });
  });

  // ── Non-TTY preflight (D1-18) ─────────────────────────────────
  //
  // The interactive flow issues ~15 inquirer prompts; under a pipe/CI stdin is
  // not a TTY and inquirer cannot read a response. config now fails fast with a
  // usage-code (exit 2) error naming the scalar escape hatch. Scalar forms
  // short-circuit before the gate, so they keep working headlessly.
  describe("non-TTY preflight (D1-18)", () => {
    it("throws a usage-code (exit 2) HatchError when stdin is not a TTY", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand();
        throw new Error("expected configCommand to throw under non-TTY stdin");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).exitCode).toBe(2);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        expect((e as HatchError).recoveryHint).toMatch(/config maturity=/);
      }
      // No interactive prompt should have been reached.
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });

    it("still accepts the scalar form under non-TTY stdin (short-circuits before the gate)", async () => {
      (process.stdin as { isTTY?: boolean }).isTTY = false;
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("team");
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });
  });

  // ── Maturity tier (Decision 4 / #16) ──────────────────────────
  //
  // `hatch3r config maturity=<tier>` is a non-interactive scalar setter that
  // bypasses the prompt-driven interactive flow entirely. It validates the
  // tier value, persists it under `manifest.maturity`, and short-circuits
  // before reaching `runRegenerate` / the workspace flow.
  describe("maturity tier (Decision 4 / #16)", () => {
    it("sets maturity=solo via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=solo");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("solo");
    });

    it("sets maturity=team via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("team");
    });

    it("sets maturity=scaleup via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=scaleup");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("scaleup");
    });

    it("sets maturity=enterprise via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=enterprise");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("enterprise");
    });

    it("sets maturity via `set` verb form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "maturity team");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("team");
    });

    it("sets maturity via `set` verb + `=`-joined form (D1-SA1.2-L3)", async () => {
      // D1-SA1.2-L3: `set maturity=team` (verb + embedded `=`) is the fourth,
      // previously-undocumented accepted shape. handleScalarConfig Form 3 splits
      // the rest arg on `=` before falling back to whitespace, so this persists
      // identically to the space form. Regression-guards the eq branch the
      // finding flagged as reachable-but-untested.
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "maturity=team");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.maturity).toBe("team");
    });

    it("rejects invalid maturity tier with HatchError(VALIDATION_ERROR)", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("maturity=garbage")).rejects.toThrow(HatchError);
      // Manifest is never persisted on validation failure.
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("rejects empty maturity value with HatchError", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("maturity=")).rejects.toThrow(HatchError);
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("error message lists all valid tiers", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand("maturity=invalid");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        const msg = (e as HatchError).message;
        expect(msg).toContain("solo");
        expect(msg).toContain("team");
        expect(msg).toContain("scaleup");
        expect(msg).toContain("enterprise");
        // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map.
        expect((e as HatchError).exitCode).toBe(64);
      }
    });

    it("prints current value via `get maturity` form", async () => {
      const manifest = makeManifest({ maturity: "scaleup" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "maturity");

      expect(logSpy).toHaveBeenCalledWith("scaleup");
      // `get` form does not mutate the manifest.
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("`get maturity` defaults to 'solo' when manifest has no maturity field", async () => {
      // Older manifests written before the maturity field existed return the
      // documented default rather than `undefined` (CLI UX P1 — actionable).
      const manifest = makeManifest();
      // Verify there is no maturity field on the test fixture.
      expect((manifest as unknown as Record<string, unknown>).maturity).toBeUndefined();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "maturity");

      expect(logSpy).toHaveBeenCalledWith("solo");
    });

    it("rejects unknown config key on `get`", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("get", "unknown-key")).rejects.toThrow(HatchError);
    });

    it("rejects unknown config key on `set`", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("set", "unknown-key value")).rejects.toThrow(HatchError);
    });

    it("requires a value on `set` (missing value rejected)", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("set", "maturity")).rejects.toThrow(HatchError);
    });

    it("persists maturity to manifest at .hatch3r/hatch.json path", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team");

      // writeManifest is called with rootDir + manifest body. The maturity
      // field arrives via the manifest body — the persistence layer routes
      // it to the on-disk JSON.
      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ maturity: "team" }),
      );
    });

    it("no-op when maturity is already set to the requested value", async () => {
      const manifest = makeManifest({ maturity: "team" });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team");

      // The scalar setter writes unconditionally — verifying via info()
      // surfaces the same-value branch.
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("already set"),
      );
    });

    it("scalar setter short-circuits before interactive flow (no inquirer prompts)", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team");

      // Interactive flow runs inquirer.prompt; scalar setter must not.
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
      // And the regenerate pipeline is not invoked either — content tier
      // gating is applied on next sync/update via the persisted manifest.
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
    });

    it("throws HatchError(CONFIG_ERROR) when manifest is absent on `maturity=<tier>`", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);

      const configCommand = await importConfigCommand();
      await expect(configCommand("maturity=team")).rejects.toThrow(HatchError);
    });
  });

  // D13-SA13.3-F13.3.3 (Pillar P1): `hatch3r config confidence_floor=<floor>` is
  // the persisted half of the agent-assertiveness knob (the `--confidence-floor`
  // run flag is documented in the core orchestrator command artifacts). It
  // mirrors the `maturity` scalar contract: closed enum (any|medium|high),
  // validated at write time, read back via `readConfidenceFloor`, default "any".
  describe("confidence floor (D13-SA13.3-F13.3.3)", () => {
    it("sets confidence_floor=any via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("confidence_floor=any");

      expect(getWrittenManifest(writeManifest).confidenceFloor).toBe("any");
    });

    it("sets confidence_floor=medium via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("confidence_floor=medium");

      expect(getWrittenManifest(writeManifest).confidenceFloor).toBe("medium");
    });

    it("sets confidence_floor=high via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("confidence_floor=high");

      expect(getWrittenManifest(writeManifest).confidenceFloor).toBe("high");
    });

    it("sets confidence_floor via `set` verb (space) form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "confidence_floor high");

      expect(getWrittenManifest(writeManifest).confidenceFloor).toBe("high");
    });

    it("sets confidence_floor via `set` verb + `=`-joined form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "confidence_floor=medium");

      expect(getWrittenManifest(writeManifest).confidenceFloor).toBe("medium");
    });

    it("rejects invalid confidence floor with HatchError, listing valid floors", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand("confidence_floor=paranoid");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        const msg = (e as HatchError).message;
        expect(msg).toContain("any");
        expect(msg).toContain("medium");
        expect(msg).toContain("high");
      }
      // Manifest is never persisted on validation failure.
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("rejects empty confidence_floor value with HatchError", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("confidence_floor=")).rejects.toThrow(HatchError);
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("prints current value via `get confidence_floor` form", async () => {
      const manifest = makeManifest({ confidenceFloor: "high" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "confidence_floor");

      expect(logSpy).toHaveBeenCalledWith("high");
      // `get` form does not mutate the manifest.
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("`get confidence_floor` defaults to 'any' when manifest has no field", async () => {
      const manifest = makeManifest();
      expect((manifest as unknown as Record<string, unknown>).confidenceFloor).toBeUndefined();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "confidence_floor");

      expect(logSpy).toHaveBeenCalledWith("any");
    });

    it("persists confidence_floor to the manifest body", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("confidence_floor=high");

      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ confidenceFloor: "high" }),
      );
    });
  });

  // F16.1-C1 (Decision 27): config wires checkpoints. The scalar setter records
  // a best-effort `.config-workspace` checkpoint after its manifest write (the
  // write is swallowed if it fails, so the setter must still complete); the
  // interactive flow's checkpoint comes from runRegenerate with
  // snapshotCommandName "config".
  describe("resumability checkpoints (F16.1-C1)", () => {
    it("scalar set completes successfully even though the checkpoint write is best-effort", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      // Must not throw — the checkpoint write is wrapped in a verbose()-routed
      // try/catch, so a (mocked) atomicWriteFile failure cannot break the set.
      await expect(configCommand("maturity=scaleup")).resolves.toBeUndefined();
      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ maturity: "scaleup" }),
      );
    });

    it("interactive config delegates regeneration with snapshotCommandName 'config' (checkpoint namespacing)", async () => {
      // A tool add triggers the regenerate pipeline (the seam that writes the
      // `.config-workspace` checkpoint).
      const manifest = makeManifest({ tools: ["cursor"] });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      const configCommand = await importConfigCommand();
      await configCommand();

      // config must pass the "config" namespace so its checkpoint does not
      // collide with the `.update-workspace` checkpoint.
      expect(vi.mocked(runRegenerate)).toHaveBeenCalledWith(
        tempDir,
        expect.anything(),
        expect.objectContaining({ snapshotCommandName: "config" }),
      );
    });
  });

  // ── W5-bigfour: --format json / --quiet / --dry-run / --verbose ─────────
  describe("standardized flags (W5-bigfour)", () => {
    /**
     * The JSON envelope is emitted via emitJson → process.stdout.write (not
     * console.log) — capture the chunks around a configCommand run.
     */
    async function captureStdoutWrite(run: () => Promise<void>): Promise<string> {
      const chunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((chunk: string | Uint8Array): boolean => {
          chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
          return true;
        }) as never);
      try {
        await run();
      } finally {
        stdoutSpy.mockRestore();
      }
      return chunks.join("");
    }

    it("scalar get with --format json emits the {key, value} envelope", async () => {
      const manifest = makeManifest({ maturity: "team" });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      const raw = await captureStdoutWrite(() =>
        configCommand("get", "maturity", { format: "json" }),
      );
      const payload = JSON.parse(raw.trim());
      expect(payload.command).toBe("config");
      expect(payload.key).toBe("maturity");
      expect(payload.value).toBe("team");
      expect(payload.status).toBe("ok");
      expect(typeof payload.hatch3rVersion).toBe("string");
      expect(typeof payload.timestamp).toBe("string");
    });

    it("scalar set with --format json emits the {key, value, previous} envelope and writes the manifest", async () => {
      const manifest = makeManifest({ maturity: "solo" });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      const raw = await captureStdoutWrite(() =>
        configCommand("maturity=team", undefined, { format: "json" }),
      );
      const payload = JSON.parse(raw.trim());
      expect(payload.key).toBe("maturity");
      expect(payload.value).toBe("team");
      expect(payload.previous).toBe("solo");
      expect(payload.status).toBe("passed");
      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(
        tempDir,
        expect.objectContaining({ maturity: "team" }),
      );
    });

    it("interactive flow + --format json is rejected with exit 2 and an actionable hint", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      const err = await configCommand(undefined, undefined, { format: "json" }).catch(
        (e) => e as HatchError,
      );
      expect(err).toBeInstanceOf(HatchError);
      expect((err as HatchError).exitCode).toBe(2);
      // The hint names the scalar headless escape.
      expect((err as HatchError).recoveryHint).toContain("config get");
      // Rejected BEFORE any prompt or write.
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("scalar set with --dry-run prints the would-change and skips writeManifest", async () => {
      const manifest = makeManifest({ maturity: "solo" });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("maturity=team", undefined, { dryRun: true });

      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      const infoLines = vi.mocked(info).mock.calls.map((c) => String(c[0])).join("\n");
      expect(infoLines).toContain("Dry run: would set maturity");
    });

    it("interactive flow with --dry-run runs the prompts, prints the change summary, and skips writeManifest + runRegenerate", async () => {
      const manifest = makeManifest();
      // A branch change makes the diff non-empty without touching tools.
      primeConfig(manifest, { branch: "develop" });

      const configCommand = await importConfigCommand();
      await configCommand(undefined, undefined, { dryRun: true });

      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
      const dryBox = vi
        .mocked(printBox)
        .mock.calls.find((c) => String(c[0]) === "Config dry run (no writes)");
      expect(dryBox).toBeDefined();
      const lines = (dryBox![1] as string[]).join("\n");
      expect(lines).toContain("Default branch: develop");
    });
  });
});
