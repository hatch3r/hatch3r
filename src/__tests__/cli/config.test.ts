import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, DEFAULT_FEATURES, type HatchManifest, type Features, type ContentSelection } from "../../types.js";

// ── Mock all dependencies before imports ──────────────────────

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

vi.mock("../../manifest/hatchJson.js", () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}));

vi.mock("../../cli/commands/update.js", () => ({
  runUpdate: vi.fn(),
}));

vi.mock("../../archive/index.js", () => ({
  archiveToolOutputs: vi.fn(),
  removeManagedFilesForPaths: vi.fn(),
}));

vi.mock("../../content/index.js", () => ({
  buildContentIndex: vi.fn(),
  getAvailableItems: vi.fn(),
  addContentItem: vi.fn(),
  removeContentItem: vi.fn(),
  countSelectionItems: vi.fn().mockReturnValue(0),
  selectionSummary: vi.fn().mockReturnValue(""),
  extractContentReferences: vi.fn().mockReturnValue([]),
  validateOrchestrationDependencies: vi.fn().mockReturnValue([]),
  TYPE_TO_SELECTION_KEY: {
    agent: "agents",
    skill: "skills",
    rule: "rules",
    command: "commands",
    prompt: "prompts",
    hook: "hooks",
    "github-agent": "githubAgents",
  },
}));

vi.mock("../../cli/shared/agentsContent.js", () => ({
  generateCanonicalAgentsMd: vi.fn().mockResolvedValue("# AGENTS.md content"),
}));

vi.mock("../../merge/safeWrite.js", () => ({
  safeWriteFile: vi.fn(),
}));

vi.mock("../../env/mcpEnv.js", () => ({
  ensureEnvMcp: vi.fn().mockResolvedValue({ action: "skipped", path: ".env.mcp", newVars: [] }),
  ensureGitignoreEntry: vi.fn(),
  getSourceEnvMcpCommand: vi.fn().mockReturnValue("source .env.mcp"),
}));

vi.mock("../../cli/shared/paths.js", () => ({
  findPackageRoot: vi.fn().mockReturnValue("/fake/package/root"),
}));

vi.mock("../../cli/shared/ui.js", () => ({
  printBanner: vi.fn(),
  createSpinner: vi.fn().mockReturnValue({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  printBox: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  step: vi.fn().mockImplementation((n: number, total: number, msg: string) => `[${n}/${total}] ${msg}`),
  label: vi.fn().mockImplementation((name: string, value: string) => `${name}: ${value}`),
  warn: vi.fn(),
}));

// ── Import mocked modules ─────────────────────────────────────

import inquirer from "inquirer";
import { readManifest, writeManifest } from "../../manifest/hatchJson.js";
import { runUpdate } from "../../cli/commands/update.js";
import { archiveToolOutputs, removeManagedFilesForPaths } from "../../archive/index.js";
import {
  buildContentIndex,
  addContentItem,
  removeContentItem,
  countSelectionItems,
  selectionSummary,
  extractContentReferences,
  validateOrchestrationDependencies,
} from "../../content/index.js";
import { generateCanonicalAgentsMd } from "../../cli/shared/agentsContent.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { ensureEnvMcp, ensureGitignoreEntry, getSourceEnvMcpCommand } from "../../env/mcpEnv.js";
import { printBox, info, error as logError, warn } from "../../cli/shared/ui.js";

// ── Helpers ────────────────────────────────────────────────────

function makeManifest(overrides: Partial<HatchManifest> = {}): HatchManifest {
  return {
    version: "2.0.0",
    hatch3rVersion: "1.1.0",
    platform: "github",
    owner: "test-org",
    repo: "test-repo",
    namespace: "test-org",
    project: "test-repo",
    tools: ["cursor"],
    features: { ...DEFAULT_FEATURES },
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
    managedFiles: [],
    ...overrides,
  };
}

function makeContentSelection(overrides: Partial<ContentSelection> = {}): ContentSelection {
  return {
    preset: "full",
    projectType: "brownfield",
    teamSize: "team",
    items: {
      agents: [],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
    ...overrides,
  };
}

/**
 * Set up the standard prompt sequence for configCommand:
 * platform -> repo identity -> branch -> tools -> features -> mcp -> content manage
 */
function setupStandardPrompts(
  manifest: HatchManifest,
  overrides: {
    platform?: string;
    repoAnswers?: Record<string, string>;
    branch?: string;
    tools?: string[];
    features?: (keyof Features)[];
    mcpServers?: string[];
    manageContent?: boolean;
    contentItems?: string[];
  } = {},
): void {
  const inquirerMock = vi.mocked(inquirer);
  const platform = overrides.platform ?? manifest.platform ?? "github";

  // 1. Platform prompt
  inquirerMock.prompt.mockResolvedValueOnce({ platform });

  // 2. Repo identity prompt (varies by platform)
  if (platform === "azure-devops") {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { org: manifest.owner, project: manifest.project, repo: manifest.repo },
    );
  } else if (platform === "gitlab") {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { namespace: manifest.namespace, project: manifest.project },
    );
  } else {
    inquirerMock.prompt.mockResolvedValueOnce(
      overrides.repoAnswers ?? { owner: manifest.owner, repo: manifest.repo },
    );
  }

  // 3. Default branch prompt
  inquirerMock.prompt.mockResolvedValueOnce({
    defaultBranch: overrides.branch ?? manifest.board?.defaultBranch ?? "main",
  });

  // 4. Tools prompt
  inquirerMock.prompt.mockResolvedValueOnce({
    tools: overrides.tools ?? manifest.tools,
  });

  // 5. Features prompt
  const currentFeatureKeys = overrides.features ?? (Object.keys(DEFAULT_FEATURES) as (keyof Features)[])
    .filter((k) => manifest.features[k]);
  inquirerMock.prompt.mockResolvedValueOnce({ features: currentFeatureKeys });

  // 6. MCP servers prompt (only if mcp feature enabled)
  const featureSet = new Set(currentFeatureKeys);
  if (featureSet.has("mcp")) {
    inquirerMock.prompt.mockResolvedValueOnce({
      mcp: overrides.mcpServers ?? manifest.mcp.servers,
    });
  }

  // 6b. Worktree prompt (only if tools include a worktree-capable tool)
  const selectedTools = overrides.tools ?? manifest.tools;
  if (selectedTools.some((t: string) => t === "claude")) {
    inquirerMock.prompt.mockResolvedValueOnce({
      enabled: manifest.worktree?.enabled ?? true,
    });
  }

  // 7. Content management prompt (only if manifest has content)
  if (manifest.content) {
    inquirerMock.prompt.mockResolvedValueOnce({
      manage: overrides.manageContent ?? false,
    });

    // 8. Content items prompt (only if manage=true)
    if (overrides.manageContent) {
      inquirerMock.prompt.mockResolvedValueOnce({
        items: overrides.contentItems ?? [],
      });
    }
  }
}

describe("config command", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-config-"));
    originalCwd = process.cwd();
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();

    // Re-apply default mock implementations after clearAllMocks
    vi.mocked(countSelectionItems).mockReturnValue(0);
    vi.mocked(selectionSummary).mockReturnValue("");
    vi.mocked(extractContentReferences).mockReturnValue([]);
    vi.mocked(validateOrchestrationDependencies).mockReturnValue([]);
    vi.mocked(generateCanonicalAgentsMd).mockResolvedValue("# AGENTS.md content");
    vi.mocked(ensureEnvMcp).mockResolvedValue({ action: "skipped", path: ".env.mcp", newVars: [] });
    vi.mocked(getSourceEnvMcpCommand).mockReturnValue("source .env.mcp");
    vi.mocked(runUpdate).mockResolvedValue({ copiedFiles: 10, syncedTools: 1, failedTools: 0, version: "1.1.0" });
    vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: [], migrations: [] });
    vi.mocked(writeManifest).mockResolvedValue(undefined);

    // Re-apply findPackageRoot mock
    const pathsMod = await import("../../cli/shared/paths.js");
    vi.mocked(pathsMod.findPackageRoot).mockReturnValue("/fake/package/root");

    // Re-apply UI mocks
    const uiMod = await import("../../cli/shared/ui.js");
    vi.mocked(uiMod.createSpinner).mockReturnValue({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn() } as any);
    vi.mocked(uiMod.step).mockImplementation((n: number, total: number, msg: string) => `[${n}/${total}] ${msg}`);
    vi.mocked(uiMod.label).mockImplementation((name: string, value: string) => `${name}: ${value}`);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  // ── No manifest ──────────────────────────────────────────────

  describe("no manifest", () => {
    it("should throw HatchError when no manifest found", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);

      const { configCommand } = await import("../../cli/commands/config.js");
      await expect(configCommand()).rejects.toThrow(HatchError);
    });

    it("should show error message about missing hatch.json", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);

      const { configCommand } = await import("../../cli/commands/config.js");
      try { await configCommand(); } catch { /* expected */ }

      expect(vi.mocked(logError)).toHaveBeenCalledWith(expect.stringContaining("No .agents/hatch.json found"));
    });

    it("should throw with exit code 1", async () => {
      vi.mocked(readManifest).mockResolvedValue(null);

      const { configCommand } = await import("../../cli/commands/config.js");
      try {
        await configCommand();
      } catch (e) {
        expect(e).toBeInstanceOf(HatchError);
        expect((e as HatchError).exitCode).toBe(1);
      }
    });
  });

  // ── Platform flows ───────────────────────────────────────────

  describe("platform flows", () => {
    it("should prompt for owner and repo on GitHub platform", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { platform: "github" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as any[];
      expect(repoPrompt.some((p: any) => p.name === "owner")).toBe(true);
      expect(repoPrompt.some((p: any) => p.name === "repo")).toBe(true);
    });

    it("should prompt for org, project, and repo on Azure DevOps platform", async () => {
      const manifest = makeManifest({ platform: "azure-devops" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "my-org", project: "my-proj", repo: "my-repo" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as any[];
      expect(repoPrompt.some((p: any) => p.name === "org")).toBe(true);
      expect(repoPrompt.some((p: any) => p.name === "project")).toBe(true);
      expect(repoPrompt.some((p: any) => p.name === "repo")).toBe(true);
    });

    it("should prompt for namespace and project on GitLab platform", async () => {
      const manifest = makeManifest({ platform: "gitlab" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "my-group", project: "my-proj" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const repoPrompt = promptCalls[1][0] as any[];
      expect(repoPrompt.some((p: any) => p.name === "namespace")).toBe(true);
      expect(repoPrompt.some((p: any) => p.name === "project")).toBe(true);
    });

    it("should set namespace and project to owner and repo for GitHub", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "github",
        repoAnswers: { owner: "gh-owner", repo: "gh-repo" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writeCall = vi.mocked(writeManifest).mock.calls[0];
      const writtenManifest = writeCall[1] as HatchManifest;
      expect(writtenManifest.namespace).toBe("gh-owner");
      expect(writtenManifest.project).toBe("gh-repo");
    });

    it("should set namespace to org and project for Azure DevOps", async () => {
      const manifest = makeManifest({ platform: "azure-devops" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "ado-org", project: "ado-project", repo: "ado-repo" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writeCall = vi.mocked(writeManifest).mock.calls[0];
      const writtenManifest = writeCall[1] as HatchManifest;
      expect(writtenManifest.owner).toBe("ado-org");
      expect(writtenManifest.namespace).toBe("ado-org");
      expect(writtenManifest.project).toBe("ado-project");
      expect(writtenManifest.repo).toBe("ado-repo");
    });

    it("should set namespace and project for GitLab", async () => {
      const manifest = makeManifest({ platform: "gitlab" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-group", project: "gl-project" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writeCall = vi.mocked(writeManifest).mock.calls[0];
      const writtenManifest = writeCall[1] as HatchManifest;
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
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const inquirerMock = vi.mocked(inquirer);
      inquirerMock.prompt.mockResolvedValueOnce({ platform: "github" });
      inquirerMock.prompt.mockResolvedValueOnce({ owner: "test-org", repo: "test-repo" });
      inquirerMock.prompt.mockResolvedValueOnce({ defaultBranch: "main" });
      inquirerMock.prompt.mockResolvedValueOnce({ tools: [] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await expect(configCommand()).rejects.toThrow(HatchError);
    });

    it("should throw with message about at least one tool required", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const inquirerMock = vi.mocked(inquirer);
      inquirerMock.prompt.mockResolvedValueOnce({ platform: "github" });
      inquirerMock.prompt.mockResolvedValueOnce({ owner: "test-org", repo: "test-repo" });
      inquirerMock.prompt.mockResolvedValueOnce({ defaultBranch: "main" });
      inquirerMock.prompt.mockResolvedValueOnce({ tools: [] });

      const { configCommand } = await import("../../cli/commands/config.js");
      try {
        await configCommand();
      } catch (e) {
        expect((e as HatchError).message).toContain("At least one tool must be selected");
        expect((e as HatchError).exitCode).toBe(1);
      }
    });

    it("should preserve existing tools when unchanged", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should detect added tools in diff and update manifest", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.tools).toContain("claude");
    });

    it("should detect removed tools in diff", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.tools).toEqual(["cursor"]);
      expect(writtenManifest.tools).not.toContain("claude");
    });
  });

  // ── Feature selection ────────────────────────────────────────

  describe("feature selection", () => {
    it("should preserve existing features when unchanged", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should detect enabled features in diff", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, hooks: false },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.features.hooks).toBe(true);
    });

    it("should detect disabled features in diff", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.features.hooks).toBe(false);
      expect(writtenManifest.features.mcp).toBe(false);
    });
  });

  // ── MCP servers ──────────────────────────────────────────────

  describe("MCP servers", () => {
    it("should show MCP prompts when mcp feature enabled", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
        mcpServers: ["github", "context7"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const mcpCall = promptCalls.find((call) => {
        const questions = call[0] as any[];
        return Array.isArray(questions) && questions.some((q: any) => q.name === "mcp");
      });
      expect(mcpCall).toBeDefined();
    });

    it("should not show MCP prompts when mcp feature disabled", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: [] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const mcpCall = promptCalls.find((call) => {
        const questions = call[0] as any[];
        return Array.isArray(questions) && questions.some((q: any) => q.name === "mcp");
      });
      expect(mcpCall).toBeUndefined();
    });

    it("should auto-add platform MCP server if missing from selection", async () => {
      const manifest = makeManifest({ mcp: { servers: ["context7"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["context7"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.mcp.servers).toContain("github");
      expect(writtenManifest.mcp.servers).toContain("context7");
    });

    it("should detect added and removed MCP in diff", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.mcp.servers).toContain("brave-search");
      expect(writtenManifest.mcp.servers).not.toContain("context7");
    });
  });

  // ── Content management ───────────────────────────────────────

  describe("content management", () => {
    it("should skip content when user declines to manage", async () => {
      const manifest = makeManifest({
        content: makeContentSelection({
          items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
        }),
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");
      setupStandardPrompts(manifest, { manageContent: false });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(buildContentIndex)).not.toHaveBeenCalled();
    });

    it("should add new content items when selected", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-reviewer", { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer", "hatch3r-reviewer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(addContentItem)).toHaveBeenCalledWith(
        "/fake/package/root",
        expect.stringContaining(".agents"),
        expect.objectContaining({ id: "hatch3r-reviewer" }),
      );
    });

    it("should remove deselected content items", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-reviewer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(2);
      vi.mocked(selectionSummary).mockReturnValue("2 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-reviewer", { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(removeContentItem)).toHaveBeenCalledWith(
        expect.stringContaining(".agents"),
        expect.objectContaining({ id: "hatch3r-reviewer" }),
        expect.objectContaining({ rootDir: tempDir }),
      );
    });

    it("should update manifest content items after content changes", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-test-writer", type: "agent", description: "Test writer", tags: [], relativePath: "agents/hatch3r-test-writer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-test-writer", { id: "hatch3r-test-writer", type: "agent", description: "Test writer", tags: [], relativePath: "agents/hatch3r-test-writer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer", "hatch3r-test-writer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.content?.items.agents).toContain("hatch3r-implementer");
      expect(writtenManifest.content?.items.agents).toContain("hatch3r-test-writer");
    });

    it("should regenerate AGENTS.md after content changes", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-reviewer", { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer", "hatch3r-reviewer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(generateCanonicalAgentsMd)).toHaveBeenCalled();
      expect(vi.mocked(safeWriteFile)).toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md"),
        "# AGENTS.md content",
      );
    });

    it("should not regenerate AGENTS.md when no content changes", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(generateCanonicalAgentsMd)).not.toHaveBeenCalled();
    });
  });

  // ── No changes ───────────────────────────────────────────────

  describe("no changes", () => {
    it("should print 'No changes detected' when diff is empty", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should return without calling writeManifest or runUpdate", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(runUpdate)).not.toHaveBeenCalled();
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

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

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

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(printBox)).toHaveBeenCalled();
      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const archiveLine = lines.find((l) => typeof l === "string" && l.includes("Archived"));
      expect(archiveLine).toBeDefined();
    });

    it("should call removeManagedFilesForPaths for archived files", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md", ".claude/settings.json"],
        migrations: [],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(removeManagedFilesForPaths)).toHaveBeenCalledWith(
        manifest,
        ["CLAUDE.md", ".claude/settings.json"],
      );
    });
  });

  // ── Update + env ─────────────────────────────────────────────

  describe("update and env", () => {
    it("should call runUpdate after manifest changes", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(runUpdate)).toHaveBeenCalledWith(tempDir, expect.objectContaining({ tools: ["cursor", "claude"] }));
    });

    it("should call ensureEnvMcp for MCP servers when mcp feature enabled", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

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

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("BRAVE_API_KEY"));
    });

    it("should not call ensureEnvMcp when mcp feature is disabled", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, mcp: false },
        mcp: { servers: [] },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
        tools: ["cursor", "claude"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(ensureEnvMcp)).not.toHaveBeenCalled();
    });

    it("should handle ensureEnvMcp errors gracefully", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(ensureEnvMcp).mockRejectedValue(new Error("Permission denied"));
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "brave-search"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining("Could not update .env.mcp"));
    });
  });

  // ── Summary output ───────────────────────────────────────────

  describe("summary output", () => {
    it("should show added tools in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(printBox)).toHaveBeenCalled();
      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const addedLine = lines.find((l) => typeof l === "string" && l.includes("Tools added"));
      expect(addedLine).toBeDefined();
      expect(addedLine).toContain("Claude Code");
    });

    it("should show removed tools in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: [], migrations: [] });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const removedLine = lines.find((l) => typeof l === "string" && l.includes("Tools removed"));
      expect(removedLine).toBeDefined();
      expect(removedLine).toContain("Claude Code");
    });

    it("should show platform change in summary", async () => {
      const manifest = makeManifest({ platform: "github" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-group", project: "gl-project" },
        mcpServers: ["gitlab"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const platformLine = lines.find((l) => typeof l === "string" && l.includes("Platform"));
      expect(platformLine).toBeDefined();
    });

    it("should show content changes in summary", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(1);
      vi.mocked(selectionSummary).mockReturnValue("1 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-reviewer", { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer", "hatch3r-reviewer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const contentLine = lines.find((l) => typeof l === "string" && l.includes("Content added"));
      expect(contentLine).toBeDefined();
    });

    it("should show version in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(runUpdate).mockResolvedValue({ copiedFiles: 10, syncedTools: 2, failedTools: 0, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const versionLine = lines.find((l) => typeof l === "string" && l.includes("Version"));
      expect(versionLine).toBeDefined();
      expect(versionLine).toContain("1.1.0");
    });

    it("should show files and tools count in summary", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(runUpdate).mockResolvedValue({ copiedFiles: 15, syncedTools: 2, failedTools: 0, version: "1.1.0" });
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const filesLine = lines.find((l) => typeof l === "string" && l.includes("Files"));
      const toolsLine = lines.find((l) => typeof l === "string" && l.includes("Tools") && l.includes("synced"));
      expect(filesLine).toContain("15");
      expect(toolsLine).toContain("2");
    });

    it("should show MCP added in summary", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "context7"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const mcpLine = lines.find((l) => typeof l === "string" && l.includes("MCP added"));
      expect(mcpLine).toBeDefined();
      expect(mcpLine).toContain("context7");
    });

    it("should show MCP removed in summary", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const mcpLine = lines.find((l) => typeof l === "string" && l.includes("MCP removed"));
      expect(mcpLine).toBeDefined();
      expect(mcpLine).toContain("context7");
    });

    it("should show enabled features in summary", async () => {
      const manifest = makeManifest({
        features: { ...DEFAULT_FEATURES, hooks: false },
      });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const featureLine = lines.find((l) => typeof l === "string" && l.includes("Features enabled"));
      expect(featureLine).toBeDefined();
      expect(featureLine).toContain("hooks");
    });

    it("should show disabled features in summary", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const featureLine = lines.find((l) => typeof l === "string" && l.includes("Features disabled"));
      expect(featureLine).toBeDefined();
    });

    it("should show repo change in summary", async () => {
      const manifest = makeManifest({ owner: "old-org", repo: "old-repo" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        repoAnswers: { owner: "new-org", repo: "new-repo" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const repoLine = lines.find((l) => typeof l === "string" && l.includes("Repo"));
      expect(repoLine).toBeDefined();
    });

    it("should show default branch change in summary", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { branch: "develop" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const branchLine = lines.find((l) => typeof l === "string" && l.includes("Default branch"));
      expect(branchLine).toBeDefined();
      expect(branchLine).toContain("develop");
    });

    it("should show content removed in summary", async () => {
      const contentItems = makeContentSelection({
        items: { agents: ["hatch3r-implementer", "hatch3r-reviewer"], skills: [], rules: [], commands: [], prompts: [], hooks: [], githubAgents: [] },
      });
      const manifest = makeManifest({ content: contentItems });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(2);
      vi.mocked(selectionSummary).mockReturnValue("2 agents");

      const mockIndex = {
        items: [
          { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" },
          { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" },
        ],
        byType: {},
        byId: new Map([
          ["hatch3r-implementer", { id: "hatch3r-implementer", type: "agent", description: "Implementer", tags: [], relativePath: "agents/hatch3r-implementer.md" }],
          ["hatch3r-reviewer", { id: "hatch3r-reviewer", type: "agent", description: "Reviewer", tags: [], relativePath: "agents/hatch3r-reviewer.md" }],
        ]),
      };
      vi.mocked(buildContentIndex).mockResolvedValue(mockIndex as any);

      setupStandardPrompts(manifest, {
        manageContent: true,
        contentItems: ["hatch3r-implementer"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Config updated",
      );
      expect(boxCall).toBeDefined();
      const lines = boxCall![1] as string[];
      const removedLine = lines.find((l) => typeof l === "string" && l.includes("Content removed"));
      expect(removedLine).toBeDefined();
    });

    it("should show migrations when present", async () => {
      const manifest = makeManifest({ tools: ["cursor", "claude"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({
        archivedFiles: ["CLAUDE.md"],
        migrations: [{ from: "CLAUDE.md", to: ".hatch3r/custom.md", type: "rule", id: "my-rule" }],
      });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("Customizations migrated"));
    });
  });

  // ── Manifest update ──────────────────────────────────────────

  describe("manifest update", () => {
    it("should apply platform to manifest", async () => {
      const manifest = makeManifest({ platform: "github" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "gitlab",
        repoAnswers: { namespace: "gl-ns", project: "gl-proj" },
        mcpServers: ["gitlab"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.platform).toBe("gitlab");
    });

    it("should apply tools to manifest", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude", "copilot"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.tools).toEqual(["cursor", "claude", "copilot"]);
    });

    it("should apply features to manifest", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "rules"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.features.agents).toBe(true);
      expect(writtenManifest.features.rules).toBe(true);
      expect(writtenManifest.features.skills).toBe(false);
      expect(writtenManifest.features.mcp).toBe(false);
    });

    it("should apply MCP servers to manifest", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "context7", "playwright"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.mcp.servers).toEqual(expect.arrayContaining(["github", "context7", "playwright"]));
    });

    it("should update board when board exists", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        repoAnswers: { owner: "new-owner", repo: "new-repo" },
        branch: "develop",
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.board?.owner).toBe("new-owner");
      expect(writtenManifest.board?.repo).toBe("new-repo");
      expect(writtenManifest.board?.defaultBranch).toBe("develop");
    });

    it("should create board when it does not exist and branch differs from main", async () => {
      const manifest = makeManifest({ board: undefined });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { branch: "develop" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.board).toBeDefined();
      expect(writtenManifest.board?.defaultBranch).toBe("develop");
      expect(writtenManifest.board?.branchConvention).toBe("{type}/{short-description}");
    });

    it("should set MCP servers to empty when mcp feature disabled", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "githubAgents", "hooks"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.mcp.servers).toEqual([]);
    });

    it("should write manifest to rootDir", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalledWith(tempDir, expect.any(Object));
    });
  });

  // ── Helper functions (tested via configCommand orchestration) ─

  describe("helper functions via orchestration", () => {
    it("computeDiff: detects no tool changes", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
    });

    it("computeDiff: detects tool additions", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "windsurf"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Tools added"))).toBe(true);
    });

    it("computeDiff: detects tool removals", async () => {
      const manifest = makeManifest({ tools: ["cursor", "windsurf"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(archiveToolOutputs).mockResolvedValue({ archivedFiles: [], migrations: [] });
      setupStandardPrompts(manifest, { tools: ["cursor"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Tools removed"))).toBe(true);
    });

    it("computeDiff: detects platform change", async () => {
      const manifest = makeManifest({ platform: "github" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        platform: "azure-devops",
        repoAnswers: { org: "my-org", project: "my-proj", repo: "my-repo" },
        mcpServers: ["azure-devops"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Platform"))).toBe(true);
    });

    it("computeDiff: detects repo change", async () => {
      const manifest = makeManifest({ owner: "old", repo: "old-repo" });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        repoAnswers: { owner: "new-org", repo: "new-repo" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Repo"))).toBe(true);
    });

    it("computeDiff: detects MCP additions", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github", "playwright"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("MCP added"))).toBe(true);
    });

    it("computeDiff: detects MCP removals", async () => {
      const manifest = makeManifest({ mcp: { servers: ["github", "context7"] } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        mcpServers: ["github"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("MCP removed"))).toBe(true);
    });

    it("computeDiff: detects feature enables", async () => {
      const manifest = makeManifest({ features: { ...DEFAULT_FEATURES, hooks: false, mcp: false } });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules", "prompts", "commands", "mcp", "githubAgents", "hooks"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Features enabled"))).toBe(true);
    });

    it("computeDiff: detects feature disables", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        features: ["agents", "skills", "rules"],
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const boxCall = vi.mocked(printBox).mock.calls.find((c) => c[0] === "Config updated");
      const lines = boxCall![1] as string[];
      expect(lines.some((l) => typeof l === "string" && l.includes("Features disabled"))).toBe(true);
    });

    it("isDiffEmpty: returns true when nothing changed", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
      expect(vi.mocked(writeManifest)).not.toHaveBeenCalled();
      expect(vi.mocked(runUpdate)).not.toHaveBeenCalled();
    });

    it("isDiffEmpty: returns false when only branch changed", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { branch: "release" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
    });

    it("printCurrentConfig: is called before prompts", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      vi.mocked(countSelectionItems).mockReturnValue(0);
      setupStandardPrompts(manifest);

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

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

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const configBoxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Current configuration",
      );
      expect(configBoxCall).toBeDefined();
      const lines = configBoxCall![1] as string[];
      const contentLine = lines.find((l) => typeof l === "string" && l.includes("Content"));
      expect(contentLine).toBeDefined();
    });

    it("printCurrentConfig: handles missing platform", async () => {
      const manifest = makeManifest({ platform: undefined as any });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { platform: "github" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const configBoxCall = vi.mocked(printBox).mock.calls.find(
        (call) => call[0] === "Current configuration",
      );
      expect(configBoxCall).toBeDefined();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle manifest without board", async () => {
      const manifest = makeManifest({ board: undefined });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(writeManifest)).toHaveBeenCalled();
      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
      expect(writtenManifest.board).toBeDefined();
    });

    it("should handle manifest without content", async () => {
      const manifest = makeManifest({ content: undefined });
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const contentCall = promptCalls.find((call) => {
        const questions = call[0] as any[];
        return Array.isArray(questions) && questions.some((q: any) => q.name === "manage");
      });
      expect(contentCall).toBeUndefined();
    });

    it("should handle empty branch input by falling back to current branch", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, { branch: "" });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(info)).toHaveBeenCalledWith(expect.stringContaining("No changes detected"));
    });

    it("should sanitize user inputs for repo identity", async () => {
      const manifest = makeManifest();
      vi.mocked(readManifest).mockResolvedValue(manifest);
      setupStandardPrompts(manifest, {
        repoAnswers: { owner: "test/org@bad", repo: "test repo!" },
      });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      const writtenManifest = vi.mocked(writeManifest).mock.calls[0][1] as HatchManifest;
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

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledWith(tempDir, "claude");
      expect(vi.mocked(archiveToolOutputs)).toHaveBeenCalledWith(tempDir, "copilot");
    });

    it("should call writeManifest before runUpdate", async () => {
      const manifest = makeManifest({ tools: ["cursor"] });
      vi.mocked(readManifest).mockResolvedValue(manifest);

      const callOrder: string[] = [];
      vi.mocked(writeManifest).mockImplementation(async () => { callOrder.push("writeManifest"); });
      vi.mocked(runUpdate).mockImplementation(async () => {
        callOrder.push("runUpdate");
        return { copiedFiles: 10, syncedTools: 1, failedTools: 0, version: "1.1.0" };
      });

      setupStandardPrompts(manifest, { tools: ["cursor", "claude"] });

      const { configCommand } = await import("../../cli/commands/config.js");
      await configCommand();

      expect(callOrder).toEqual(["writeManifest", "runUpdate"]);
    });
  });
});
