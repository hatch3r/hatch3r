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
  // 2.8.0: scalar config `get communication_style` consults
  // `readCommunicationStyle` — valid persisted value pass-through, else "plain".
  readCommunicationStyle: vi.fn((m: { communicationStyle?: string } | null | undefined) => {
    const value = m?.communicationStyle;
    return value && ["plain", "technical"].includes(value) ? value : "plain";
  }),
  // 2.8.0: scalar config `get default_effort` consults `readDefaultEffort` —
  // valid persisted value pass-through, else undefined (auto-tier; the config
  // layer renders the "auto-tier" sentinel).
  readDefaultEffort: vi.fn((m: { defaultEffort?: string } | null | undefined) => {
    const value = m?.defaultEffort;
    return value && ["light", "standard", "deep"].includes(value) ? value : undefined;
  }),
  // release/2.8.5 (BUG-4): config threads the persisted --role/--facets filter
  // into resolveSelection via `readContentFilter`. Mirror the real helper:
  // known-id narrowing with fail-open-to-no-filtering semantics.
  readContentFilter: vi.fn(
    (m: { contentFilter?: { role?: string; facets?: string[] } } | null | undefined) => {
      const role = m?.contentFilter?.role;
      const facets = m?.contentFilter?.facets ?? [];
      const knownRoles = ["reviewer", "security-lead", "senior-eng"];
      const knownFacets = ["a11y", "performance", "observability"];
      return {
        role: role && knownRoles.includes(role) ? role : undefined,
        facets: facets.filter((f) => knownFacets.includes(f)),
      };
    },
  ),
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

vi.mock("../../archive/index.js", async (importOriginal) => {
  // release/2.8.5: the stale-adapter reclamation runs the REAL
  // merge/orphanCleanup sweep, which reads `TOOL_PATH_PREFIXES` from this
  // module for its containment safety filter — pass the real constant through
  // while keeping the write-path entry points stubbed.
  const actual = await importOriginal<typeof import("../../archive/index.js")>();
  return {
    archiveToolOutputs: vi.fn(),
    collectToolFiles: vi.fn(),
    removeManagedFilesForPaths: vi.fn(),
    TOOL_PATH_PREFIXES: actual.TOOL_PATH_PREFIXES,
  };
});

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
    // Silent-writes sweep (release/2.7.1): configCommand now reads the
    // MergeResult that safeWriteFile resolves (`wtResult.warning` on the
    // worktree-include write, config.ts) — a bare `vi.fn()` resolves
    // undefined and the `.warning` read throws. Honor the real contract
    // with a minimal `{ path, action }` MergeResult (src/types.ts). The
    // implementation is passed INTO vi.fn() (not set via mockResolvedValue)
    // so the afterEach `vi.restoreAllMocks()` restores THIS implementation
    // instead of wiping it after the first test — same style as the
    // functional atomicWriteFile mock below.
    safeWriteFile: vi.fn(async (filePath: string) => ({ path: filePath, action: "updated" as const })),
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

// release/2.8.5 (BUG-2): config resolves the content root through
// `resolveBundledContentRoot()` (the bundled chokepoint) instead of
// `findPackageRoot(__dirname)`. The real resolver walks the mocked
// findPackageRoot above to "/fake/package/root" and throws "Bundled content
// not found"; stub the chokepoint — buildContentIndex is mocked in this file,
// so the returned path is never read from disk.
vi.mock("../../content/contentRoot.js", () => ({
  resolveBundledContentRoot: vi.fn(() => "/fake/package/root"),
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
  estimatePresetItemCount,
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

  // ── Customize-explainer box (D10-SA10.4-05) ──────────────────

  describe("'Two ways to change content' box", () => {
    it("enumerates all four customize routes, not only the two .customize.* files (D10-SA10.4-05)", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { platform: "github" });

      await (await importConfigCommand())();

      const box = vi
        .mocked(printBox)
        .mock.calls.find((c) => c[0] === "Two ways to change content");
      expect(box).toBeDefined();
      const lines = (box?.[1] as string[]).join("\n");
      // The two .customize.* files (kept) …
      expect(lines).toContain(".customize.yaml");
      expect(lines).toContain(".customize.md");
      // … plus the two routes the prior wording omitted.
      expect(lines).toContain("HATCH3R:BEGIN/END");
      expect(lines).toContain(".hatch3r/overrides/");
      // Selection-vs-Customization framing retained.
      expect(lines).toContain("Selection");
      expect(lines).toContain("Customization");
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

    it("release/2.8.5 (BUG-3 secondary): reclaims a stale recorded adapter after explicit consent", async () => {
      // A `managedFilesByAdapter` entry for an adapter that is neither in the
      // tool set nor being removed this run — leftover state no other path
      // ever cleans. The confirm fires after the machine; answering Yes drops
      // the record (the sweep itself no-ops here: the files do not exist).
      const manifest = makeManifest({
        tools: ["cursor"],
        managedFilesByAdapter: {
          cursor: [".cursor/rules/50-hatch3r-testing.mdc"],
          claude: ["CLAUDE.md", ".claude/agents/hatch3r-implementer.md"],
        },
      });
      primeConfig(manifest, { tools: ["cursor", "copilot"] });
      // Extra consent prompt appended after the standard queue.
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ confirmStaleReclaim: true });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.managedFilesByAdapter?.claude).toBeUndefined();
      // The in-set adapter's record is untouched.
      expect(writtenManifest.managedFilesByAdapter?.cursor).toEqual([
        ".cursor/rules/50-hatch3r-testing.mdc",
      ]);
    });

    it("release/2.8.5 (BUG-3 secondary): declining the stale-adapter reclaim keeps the record", async () => {
      const manifest = makeManifest({
        tools: ["cursor"],
        managedFilesByAdapter: {
          claude: ["CLAUDE.md"],
        },
      });
      primeConfig(manifest, { tools: ["cursor", "copilot"] });
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ confirmStaleReclaim: false });

      await (await importConfigCommand())();

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.managedFilesByAdapter?.claude).toEqual(["CLAUDE.md"]);
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

    it("release/2.8.5: never issues a features prompt (init/config parity)", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const featuresCall = vi.mocked(inquirer.prompt).mock.calls.find((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "features");
      });
      expect(featuresCall).toBeUndefined();
    });

    it("release/2.8.5: does not mutate persisted feature flags from the interactive flow", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, hooks: false, mcp: false },
        mcp: { servers: [] },
      });
      // A tool add forces the write past the no-changes guard.
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = getWrittenManifest(writeManifest);
      // Flags survive verbatim — the flow derives features from the manifest.
      expect(writtenManifest.features.hooks).toBe(false);
      expect(writtenManifest.features.mcp).toBe(false);
      expect(writtenManifest.features.agents).toBe(true);
    });
  });

  // ── 2.1.0: handoffs fix + maturity/confidence interactive surfaces ──
  describe("handoffs feature-rebuild fix (Task D, 2.1.0)", () => {
    it("FEATURE_CHOICES still enumerates handoffs (release/2.8.5: retained as the feature-surface enumeration)", async () => {
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

    it("release/2.8.5: a manifest that OMITS the handoffs key gets the schema default materialized (no prompt involved)", async () => {
      // Upgraded manifests written before `handoffs` joined the schema omit
      // the key entirely. The manifest-derived features object fills it from
      // DEFAULT_FEATURES (`handoffs === true`), so an accept-defaults run
      // persists it enabled — the 2.1.0 silent-disable regression stays dead
      // even without the (removed) features checkbox.
      const manifest = makeManifest();
      delete (manifest.features as Partial<Features>).handoffs;
      expect(manifest.features.handoffs).toBeUndefined();

      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

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

    it("release/2.8.5: the communication-style step fires and persists the chosen style", async () => {
      const manifest = makeManifest(); // no communicationStyle → resolves "plain"
      primeConfig(manifest, { communicationStyle: "technical" });

      await (await importConfigCommand())();

      const sawStylePrompt = vi.mocked(inquirer.prompt).mock.calls.some((call) => {
        const questions = call[0] as unknown as PromptQuestion[];
        return Array.isArray(questions) && questions.some((q) => q.name === "communicationStyle");
      });
      expect(sawStylePrompt).toBe(true);
      // The style change alone forces the write (not gated by "No changes").
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.communicationStyle).toBe("technical");
    });

    it("release/2.8.5: accepting the communication-style default registers no change", async () => {
      const manifest = makeManifest(); // absent style → default "plain" queued
      primeConfig(manifest);

      await (await importConfigCommand())();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
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
    it("should show MCP prompts when the persisted mcp feature is enabled", async () => {
      // makeManifest pins features.mcp = true; the gate keys on that
      // persisted flag (release/2.8.5: no features prompt to flip it).
      const manifest = makeManifest();
      primeConfig(manifest, {
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

    it("should not show MCP prompts when the persisted mcp feature is disabled", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: [] },
      });
      primeConfig(manifest);

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

    it("release/2.8.5 (BUG-4): re-resolution threads the persisted --role/--facets filter + languages, init-style", async () => {
      const manifest = makeManifest({
        content: makeContentSelection({
          items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        }),
        languages: ["typescript", "python"],
        contentFilter: { role: "reviewer", facets: ["a11y", "not-a-facet"] },
      });
      primeContent(manifest, ["hatch3r-implementer"]);
      vi.mocked(getAllContentIds).mockReturnValue(new Set(["hatch3r-implementer"]));
      stubResolveSelectionAgents(resolveSelection, ["hatch3r-implementer"]);

      await (await importConfigCommand())();

      expect(vi.mocked(resolveSelection)).toHaveBeenCalled();
      const call = vi.mocked(resolveSelection).mock.calls[0];
      // Args: preset, projectType, teamSize, index, customSelections,
      // projectLanguages, options. Pre-2.8.5 config passed `undefined`
      // languages + `{ skipContextFilters: true }` and NO role/facets — a
      // wider resolution than init's on the same repo (phantom "Content
      // added" on an accept-defaults run) that silently dropped the filter.
      expect(call[5]).toEqual(["typescript", "python"]);
      const options = call[6] as { skipContextFilters?: boolean; role?: string; facets?: string[] };
      expect(options.skipContextFilters).toBeUndefined();
      expect(options.role).toBe("reviewer");
      // Unknown facet ids are dropped by readContentFilter (fail-open).
      expect(options.facets).toEqual(["a11y"]);
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
      // release/2.8.5: no features prompt — the persisted flag alone gates the
      // env write; a tool add forces the write path past the no-changes guard.
      primeConfig(manifest, { tools: ["cursor", "claude"] });

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

    it("release/2.8.5: shows Features enabled only for schema-default materialization (omitted key filled)", async () => {
      // The only remaining feature-diff source is a legacy manifest omitting a
      // schema key: the derived object fills `handoffs: true`, computeDiff
      // reports it enabled, and the summary discloses the materialization.
      const manifest = makeManifest();
      delete (manifest.features as Partial<Features>).handoffs;
      primeConfig(manifest);

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expectSummaryLine(lines, "Features enabled", "handoffs");
    });

    it("release/2.8.5: an accept-defaults run emits no feature diff lines", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features enabled"))).toBe(false);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features disabled"))).toBe(false);
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

    it("release/2.8.5: applies the manifest-derived feature set unchanged", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, skills: false, mcp: false },
        mcp: { servers: [] },
      });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

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

    it("preserves existing MCP servers when the persisted mcp feature is off (Wave 3 plan §4.4)", async () => {
      // Wave 3 (CLI-tooling pivot, plan §4.4): a disabled mcp feature never
      // wipes the server list — the user may have toggled the feature off
      // (via `hatch3r mcp remove` paths) and expects their setup intact when
      // toggling back on. release/2.8.5: the gate keys on the PERSISTED
      // manifest.features.mcp; when off, mcpServers passes through verbatim.
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: ["github"] },
      });
      primeConfig(manifest, { tools: ["cursor", "claude"] });

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

    it("computeDiff: release/2.8.5 — feature enables only from schema-default materialization", async () => {
      const manifest = makeManifest();
      delete (manifest.features as Partial<Features>).handoffs;
      primeConfig(manifest);

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features enabled"))).toBe(true);
    });

    it("computeDiff: release/2.8.5 — no feature disables from the interactive flow", async () => {
      const manifest = makeManifest();
      primeConfig(manifest, { tools: ["cursor", "claude"] });

      await (await importConfigCommand())();

      const lines = getConfigUpdatedBox(printBox);
      expect(lines.some((l) => typeof l === "string" && l.includes("Features disabled"))).toBe(false);
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
          return { repos: [{ path: "repo-a", added: [], removed: [], toolsSynced: ["cursor"], action: "synced" as const }], outcome: "passed" as const, counts: { total: 1, synced: 1, failed: 0, skipped: 0, dryRun: 0 } };
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
          outcome: "failed",
          counts: { total: 1, synced: 0, failed: 1, skipped: 0, dryRun: 0 },
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

  // 2.8.0: `hatch3r config communication_style=<style>` — non-interactive
  // scalar setter mirroring the `maturity` contract: closed enum
  // (plain|technical), HatchError(VALIDATION_ERROR) → exit 64 on bad input,
  // absent field reads back as the documented "plain" default.
  describe("communication_style scalar (2.8.0)", () => {
    it("sets communication_style=technical via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("communication_style=technical");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.communicationStyle).toBe("technical");
    });

    it("sets communication_style=plain via `set` verb form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "communication_style plain");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.communicationStyle).toBe("plain");
    });

    it("rejects an invalid style with HatchError(VALIDATION_ERROR) exit 64 and no write", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand("communication_style=shouty");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        // C8-D1-M5: VALIDATION_ERROR -> EX_USAGE (64) via central map — never
        // a bare numeric exit 1.
        expect((e as HatchError).exitCode).toBe(64);
        const msg = (e as HatchError).message;
        expect(msg).toContain("plain");
        expect(msg).toContain("technical");
      }
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("prints the persisted value via `get communication_style`", async () => {
      const manifest = makeManifest({ communicationStyle: "technical" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "communication_style");

      expect(logSpy).toHaveBeenCalledWith("technical");
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("`get communication_style` defaults to 'plain' when the field is absent", async () => {
      const manifest = makeManifest();
      expect((manifest as unknown as Record<string, unknown>).communicationStyle).toBeUndefined();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "communication_style");

      expect(logSpy).toHaveBeenCalledWith("plain");
    });
  });

  // 2.8.0: `hatch3r config default_effort=<effort>` — closed enum
  // (light|standard|deep). Absence means auto-tier, so `get` renders the
  // "auto-tier" sentinel rather than a settable value.
  describe("default_effort scalar (2.8.0)", () => {
    it("sets default_effort=deep via inline key=value form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("default_effort=deep");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.defaultEffort).toBe("deep");
    });

    it("sets default_effort=light via `set` verb + `=`-joined form", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await configCommand("set", "default_effort=light");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.defaultEffort).toBe("light");
    });

    it("rejects an invalid effort with HatchError(VALIDATION_ERROR) exit 64 and no write", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        // "max" is a model reasoning-effort level, not an orchestration effort.
        await configCommand("default_effort=max");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        expect((e as HatchError).exitCode).toBe(64);
        const msg = (e as HatchError).message;
        expect(msg).toContain("light");
        expect(msg).toContain("standard");
        expect(msg).toContain("deep");
      }
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("rejects empty default_effort value with HatchError and no write", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      await expect(configCommand("default_effort=")).rejects.toThrow(HatchError);
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("prints the persisted value via `get default_effort`", async () => {
      const manifest = makeManifest({ defaultEffort: "standard" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "default_effort");

      expect(logSpy).toHaveBeenCalledWith("standard");
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("`get default_effort` renders the auto-tier sentinel when the field is absent", async () => {
      const manifest = makeManifest();
      expect((manifest as unknown as Record<string, unknown>).defaultEffort).toBeUndefined();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "default_effort");

      expect(logSpy).toHaveBeenCalledWith("auto-tier");
    });
  });

  // release/2.8.6: `hatch3r config team_size=<v>` — the team-size lever the
  // init advisory used to dead-end on ("or `hatch3r config` to switch later"
  // while ConfigState had no teamSize slot and SCALAR_CONFIG_KEYS no key).
  // Unlike the four manifest-root scalars, a CHANGED write re-resolves
  // `manifest.content` through the same resolveSelection shape the
  // interactive flow uses, so the added/removed item delta is computed,
  // reported, and persisted.
  describe("team_size scalar + re-resolution (release/2.8.6)", () => {
    // Mock-index fixture: a solo-safe agent plus one team-only item per class
    // (command / skill / github-agent), typed so the delta report can group by
    // class. Canonically-exact 11-item membership is pinned against the REAL
    // corpus in src/__tests__/content/compound.test.ts — this unit fixture
    // only exercises the config wiring.
    const TEAM_ONLY_FIXTURE = [
      { id: "cmd-hatch3r-board-fill", type: "command" },
      { id: "hatch3r-board-init", type: "skill" },
      { id: "hatch3r-test-agent", type: "github-agent" },
    ];
    const makeTeamAwareIndex = (): unknown => {
      const items = [
        { id: "hatch3r-implementer", type: "agent", tags: [], relativePath: "agents/hatch3r-implementer.md" },
        ...TEAM_ONLY_FIXTURE.map((i) => ({ ...i, tags: ["ctx:team-only"], relativePath: `${i.type}s/${i.id}.md` })),
      ];
      return { items, byType: {}, byId: new Map(items.map((i) => [i.id, i])) };
    };
    const soloSelection = () =>
      makeContentSelection({
        preset: "full",
        teamSize: "solo",
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
    const teamSelection = () =>
      makeContentSelection({
        preset: "full",
        teamSize: "team",
        items: {
          agents: ["hatch3r-implementer"],
          skills: ["hatch3r-board-init"],
          rules: [],
          commands: ["cmd-hatch3r-board-fill"],
          prompts: [],
          hooks: [],
          githubAgents: ["hatch3r-test-agent"],
        },
      });
    /** Real-shaped flattening so old/new id diffs are computed, not stubbed. */
    const stubRealContentHelpers = (): void => {
      vi.mocked(getAllContentIds).mockImplementation((sel: { items: Record<string, string[]> }) => {
        const ids = new Set<string>();
        for (const arr of Object.values(sel.items)) for (const id of arr) ids.add(id);
        return ids;
      });
      vi.mocked(resolveSelection).mockImplementation(
        (_preset: unknown, _pt: unknown, teamSize: unknown) =>
          teamSize === "team" ? teamSelection() : soloSelection(),
      );
      vi.mocked(buildContentIndex).mockResolvedValue(makeTeamAwareIndex() as never);
    };

    it("sets team_size=team via inline form: persists content.teamSize AND the re-resolved selection", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      await configCommand("team_size=team");

      // Re-resolution ran at the NEW team size…
      const call = vi.mocked(resolveSelection).mock.calls[0];
      expect(call[2]).toBe("team");
      // …and the persisted selection carries both the flag and the item delta.
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.content?.teamSize).toBe("team");
      expect(writtenManifest.content?.items.commands).toContain("cmd-hatch3r-board-fill");
      expect(writtenManifest.content?.items.skills).toContain("hatch3r-board-init");
      expect(writtenManifest.content?.items.githubAgents).toContain("hatch3r-test-agent");
      // The delta is reported (3 team-only items appeared).
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("3 added, 0 removed"));
      // Scalar form: still no interactive prompts…
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
      // …but unlike the four manifest-root scalars, a CHANGED team_size write
      // chains runRegenerate so the re-resolved selection is materialized
      // into tool outputs in the same run (review-2.8.6-r1 F2).
      expect(vi.mocked(runRegenerate)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runRegenerate).mock.calls[0]?.[2]).toMatchObject({
        snapshotCommandName: "config",
      });
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("Adapter outputs regenerated"),
      );
    });

    it("sets team_size=solo via `set` verb form: removes the team-only items and fires the solo+full disclosure", async () => {
      const manifest = makeManifest({ content: teamSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      await configCommand("set", "team_size solo");

      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.content?.teamSize).toBe("solo");
      expect(writtenManifest.content?.items.commands).not.toContain("cmd-hatch3r-board-fill");
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("0 added, 3 removed"));
      // Task 2d disclosure: the re-selection is solo under full, so the
      // still-filtered team-only set is enumerated with the include lever.
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("team-scoped items (ctx:team-only) stay excluded"),
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("commands: cmd-hatch3r-board-fill"),
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("team_size=team"),
      );
    });

    it("same-value write skips re-resolution (already-set branch)", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      await configCommand("team_size=solo");

      expect(vi.mocked(resolveSelection)).not.toHaveBeenCalled();
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("already set"));
      // review-2.8.6-r1 F2: an unchanged write also skips the regenerate.
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
    });

    it("`--dry-run` previews the delta without writing", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      await configCommand("team_size=team", undefined, { dryRun: true });

      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("Dry run: would set team_size"));
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("3 added, 0 removed"));
      // review-2.8.6-r1 F2: the preview names the regenerate a live run would
      // chain, and no regenerate actually runs under --dry-run.
      expect(vi.mocked(info)).toHaveBeenCalledWith(
        expect.stringContaining("Adapter outputs would be regenerated"),
      );
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
    });

    it("rejects an invalid team size with HatchError(VALIDATION_ERROR) exit 64 and no write", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand("team_size=duo");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
        expect((e as HatchError).exitCode).toBe(64);
        const msg = (e as HatchError).message;
        expect(msg).toContain("solo");
        expect(msg).toContain("team");
      }
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("throws CONFIG_ERROR on set when the manifest has no content selection", async () => {
      const manifest = makeManifest(); // no content field
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const configCommand = await importConfigCommand();
      try {
        await configCommand("team_size=team");
        expect.unreachable("Expected HatchError");
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
        expect((e as HatchError).recoveryHint).toContain("hatch3r init");
      }
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("prints the persisted value via `get team_size` (and CONFIG_ERROR without content)", async () => {
      const manifest = makeManifest({ content: teamSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const configCommand = await importConfigCommand();
      await configCommand("get", "team_size");
      expect(logSpy).toHaveBeenCalledWith("team");
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();

      vi.mocked(readManifest).mockResolvedValue(makeManifest());
      await expect(configCommand("get", "team_size")).rejects.toThrow(HatchError);
    });

    it("interactive team-size step: solo→team re-resolves and reports the added team-only items", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      primeContent(manifest, ["hatch3r-implementer"], { teamSize: "team" });
      stubRealContentHelpers();
      // primeContent's buildContentIndex stub is overwritten by
      // stubRealContentHelpers with the typed team-aware index.

      await (await importConfigCommand())();

      // The re-resolution used the in-run team size…
      const call = vi.mocked(resolveSelection).mock.calls[0];
      expect(call[2]).toBe("team");
      // CQ5-1 (test-2.8.6-p4): …and so did the presetStep teamSize THUNK —
      // every per-choice estimate call received the in-run "team", not the
      // stale persisted "solo" (arg index 2 = teamSize in
      // estimatePresetItemCount(preset, projectType, teamSize, …)).
      const estimateCalls = vi.mocked(estimatePresetItemCount).mock.calls;
      expect(estimateCalls.length).toBeGreaterThan(0);
      expect(estimateCalls.every((c) => c[2] === "team")).toBe(true);
      const writtenManifest = getWrittenManifest(writeManifest);
      expect(writtenManifest.content?.teamSize).toBe("team");
      expect(writtenManifest.content?.items.commands).toContain("cmd-hatch3r-board-fill");
      // …and the summary box names the flip + the item delta.
      const boxLines = getConfigUpdatedBox(printBox);
      expectSummaryLine(boxLines, "Team size:", "team");
      expectSummaryLine(boxLines, "Content added: 3 item(s)");
    });

    it("interactive re-selection kept at solo+full renders the still-filtered disclosure in the summary box", async () => {
      const manifest = makeManifest({ content: soloSelection(), tools: ["cursor"] });
      // A tool ADD makes the diff non-empty so the summary box renders while
      // team size stays solo (accept-default) under the full preset.
      primeContent(manifest, ["hatch3r-implementer"], { tools: ["cursor", "claude"] });
      stubRealContentHelpers();

      await (await importConfigCommand())();

      const boxLines = getConfigUpdatedBox(printBox);
      expectSummaryLine(boxLines, "team-scoped workflows (ctx:team-only) are excluded for solo");
      expectSummaryLine(boxLines, "commands: cmd-hatch3r-board-fill");
      expectSummaryLine(boxLines, "team_size=team");
    });

    /** Local JSON-envelope capture (emitJson writes via process.stdout.write). */
    async function captureJsonRun(run: () => Promise<void>): Promise<Record<string, unknown>> {
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
      return JSON.parse(chunks.join("").trim()) as Record<string, unknown>;
    }

    it("scalar set with --format json carries regenerated: true after a changed write (review-2.8.6-r1 F2)", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      const payload = await captureJsonRun(() =>
        configCommand("team_size=team", undefined, { format: "json" }),
      );
      expect(payload.changed).toBe(true);
      expect(payload.regenerated).toBe(true);
      expect(vi.mocked(runRegenerate)).toHaveBeenCalledTimes(1);
    });

    // CQ5-6 (test-2.8.6-p4): the regen-failure wrapper's NON-HatchError arm —
    // a plain TypeError from the pipeline must still surface as a structured
    // ADAPTER_ERROR naming what succeeded (the manifest write) and the
    // `hatch3r sync` fallback, never as an unstructured crash.
    it("wraps a non-HatchError regen failure as ADAPTER_ERROR, naming the saved write and the sync fallback", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();
      vi.mocked(runRegenerate).mockRejectedValueOnce(
        new TypeError("Cannot read properties of undefined (reading 'emit')"),
      );

      const configCommand = await importConfigCommand();
      const err = await configCommand("team_size=team").then(
        () => {
          throw new Error("expected the regen failure to throw");
        },
        (e: unknown) => e as HatchError,
      );

      expect(err).toBeInstanceOf(HatchError);
      expect(err.errorCode).toBe("ADAPTER_ERROR");
      expect(err.message).toContain("team_size was saved");
      expect(err.message).toContain("Cannot read properties of undefined");
      expect(err.recoveryHint).toContain("hatch3r sync");
    });

    it("`--dry-run --format json` previews wouldRegenerate: true without regenerating", async () => {
      const manifest = makeManifest({ content: soloSelection() });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();

      const configCommand = await importConfigCommand();
      const payload = await captureJsonRun(() =>
        configCommand("team_size=team", undefined, { format: "json", dryRun: true }),
      );
      expect(payload.status).toBe("dry-run");
      expect(payload.wouldRegenerate).toBe(true);
      expect(payload.regenerated).toBeUndefined();
      expect(vi.mocked(runRegenerate)).not.toHaveBeenCalled();
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("surfaces a regeneration failure with the `hatch3r sync` fallback, preserving the partial-failure exit-2 contract", async () => {
      const manifest = makeManifest({ content: soloSelection(), tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      stubRealContentHelpers();
      // Partial adapter failure (1 of 2 tools): the REAL
      // throwOnPartialAdapterFailure (un-mocked in this suite) throws exit-2
      // ADAPTER_ERROR; the scalar path re-wraps it with the sync fallback
      // WITHOUT changing exitCode/errorCode (review-2.8.6-r1 F2).
      vi.mocked(runRegenerate).mockResolvedValue({
        copiedFiles: 1,
        syncedTools: 1,
        failedTools: 1,
        version: "2.8.6",
      } as never);

      const configCommand = await importConfigCommand();
      const err = await configCommand("team_size=team").catch((e) => e as HatchError);
      expect(err).toBeInstanceOf(HatchError);
      expect((err as HatchError).exitCode).toBe(2);
      expect((err as HatchError).errorCode).toBe("ADAPTER_ERROR");
      expect((err as HatchError).message).toContain("team_size was saved");
      expect((err as HatchError).recoveryHint).toContain("hatch3r sync");
      // Honest failure shape: the manifest write landed BEFORE the failed
      // regenerate — the error reports saved-config + stale-outputs, not a
      // rolled-back no-op.
      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
    });

    // review-2.8.6-r1 F3: the custom-preset branch — the currently tracked ids
    // thread into resolveSelection as the custom baseline, so the context
    // filter re-applies over the user's explicit picks only.
    it("custom preset: team→solo moves ctx:team-only picks into removed; solo→team adds nothing (re-pick required)", async () => {
      const allPickedIds = [
        "hatch3r-implementer",
        "hatch3r-board-init",
        "cmd-hatch3r-board-fill",
        "hatch3r-test-agent",
      ];
      const customSelection = (teamSize: "solo" | "team", ids: string[]) =>
        makeContentSelection({
          preset: "custom",
          teamSize,
          items: {
            agents: ids.filter((id) => id === "hatch3r-implementer"),
            skills: ids.filter((id) => id === "hatch3r-board-init"),
            rules: [],
            commands: ids.filter((id) => id === "cmd-hatch3r-board-fill"),
            prompts: [],
            hooks: [],
            githubAgents: ids.filter((id) => id === "hatch3r-test-agent"),
          },
        });
      stubRealContentHelpers();
      // Custom-aware resolveSelection stand-in: keep the threaded baseline,
      // re-apply the ctx:team-only context filter at solo. Mirrors the real
      // resolver's custom contract (picks are the source of truth).
      const teamOnlyIds = new Set(TEAM_ONLY_FIXTURE.map((i) => i.id));
      vi.mocked(resolveSelection).mockImplementation(
        (_preset: unknown, _pt: unknown, teamSize: unknown, _index: unknown, customSelections?: unknown) => {
          const base = (customSelections as string[] | undefined) ?? [];
          const kept = teamSize === "solo" ? base.filter((id) => !teamOnlyIds.has(id)) : base;
          return customSelection(teamSize as "solo" | "team", kept);
        },
      );

      // team→solo: the three team-only picks land in `removed`.
      vi.mocked(readManifest).mockResolvedValue(
        makeManifest({ content: customSelection("team", allPickedIds) }),
      );
      const configCommand = await importConfigCommand();
      await configCommand("team_size=solo");
      // Baseline threaded: the resolver received the tracked ids (oldIds).
      expect(vi.mocked(resolveSelection).mock.calls[0]?.[4]).toEqual(
        expect.arrayContaining(allPickedIds),
      );
      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("0 added, 3 removed"));
      const soloWritten = getWrittenManifest(writeManifest);
      expect(soloWritten.content?.items.commands).not.toContain("cmd-hatch3r-board-fill");
      // preset stays custom (not full) → the solo+full disclosure never fires.
      expect(vi.mocked(info)).not.toHaveBeenCalledWith(expect.stringContaining("stay excluded"));

      // solo→team: EMPTY added — the baseline holds only prior picks, so
      // team-only items require a re-pick via interactive config (the
      // reresolveContentForTeamSize JSDoc's documented no-op).
      vi.mocked(info).mockClear();
      vi.mocked(resolveSelection).mockClear();
      vi.mocked(writeManifest).mockClear();
      vi.mocked(readManifest).mockResolvedValue(
        makeManifest({ content: customSelection("solo", ["hatch3r-implementer"]) }),
      );
      await configCommand("team_size=team");
      const teamWritten = getWrittenManifest(writeManifest);
      expect(teamWritten.content?.teamSize).toBe("team");
      expect(teamWritten.content?.items.commands).toEqual([]);
      // No item delta → no "re-resolved: N added, M removed" line at all.
      expect(vi.mocked(info)).not.toHaveBeenCalledWith(expect.stringContaining("re-resolved"));
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
