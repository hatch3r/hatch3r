import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, DEFAULT_FEATURES, type HatchManifest, type ContentSelection } from "../../types.js";

// ── Mock dependencies before imports ───────────────────────────

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn().mockReturnValue(Buffer.from("")) };
});

import inquirer from "inquirer";

// ── Constants ──────────────────────────────────────────────────

const AGENTS_DIR = ".agents";

// ── Fixture helpers ────────────────────────────────────────────

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
 * Create a test project with a hatch.json manifest in a temp directory.
 * The manifest can be customized via overrides to trigger specific checkpoints.
 */
async function createTestProject(
  root: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const agentsDir = join(root, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(join(agentsDir, "rules"), { recursive: true });
  await mkdir(join(agentsDir, "agents"), { recursive: true });
  await mkdir(join(agentsDir, "skills"), { recursive: true });
  await mkdir(join(agentsDir, "commands"), { recursive: true });

  const manifest: Record<string, unknown> = {
    version: "2.0.0",
    hatch3rVersion: "0.0.9",
    platform: "github",
    owner: "test-org",
    repo: "test-repo",
    namespace: "test-org",
    project: "test-repo",
    tools: ["cursor"],
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
    mcp: { servers: [] },
    content: {
      preset: "full",
      projectType: "brownfield",
      teamSize: "team",
      items: {
        agents: [], skills: [], rules: [], commands: [],
        prompts: [], hooks: [], githubAgents: [],
      },
    },
    managedFiles: [],
    ...overrides,
  };
  await writeFile(join(agentsDir, "hatch.json"), JSON.stringify(manifest, null, 2));

  // Write a minimal rule so update has something to work with
  await writeFile(
    join(agentsDir, "rules", "hatch3r-test.md"),
    "---\nid: hatch3r-test\ntype: rule\ndescription: test rule\nscope: always\n---\n# Test Rule\n\nOld test content.\n",
  );
}

// ── Test suite ─────────────────────────────────────────────────

describe("migration checkpoints", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-migration-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(inquirer.prompt).mockReset();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  // ── D3-2: Checkpoint condition fixtures ─────────────────────

  describe("content-selections-init checkpoint", () => {
    it("should trigger when manifest has no content field", async () => {
      // Create manifest without content field -- this should trigger the checkpoint
      await createTestProject(tempDir, { content: undefined });
      // Remove the content key entirely from the JSON (override sets it to undefined,
      // but JSON.stringify strips undefined values)
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.content;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // Mock inquirer to answer the two prompts:
      // 1. projectType prompt
      // 2. teamSize prompt
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ projectType: "brownfield" })
        .mockResolvedValueOnce({ teamSize: "team" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      // Verify the prompts were called (content-selections-init asks two questions)
      expect(inquirer.prompt).toHaveBeenCalled();
      const promptCalls = vi.mocked(inquirer.prompt).mock.calls;
      const allQuestions = promptCalls.flatMap((call) => {
        const arg = call[0];
        return Array.isArray(arg) ? arg : [arg];
      });
      const projectTypeQ = allQuestions.find(
        (q) => typeof q === "object" && "name" in q && q.name === "projectType",
      );
      const teamSizeQ = allQuestions.find(
        (q) => typeof q === "object" && "name" in q && q.name === "teamSize",
      );
      expect(projectTypeQ).toBeDefined();
      expect(teamSizeQ).toBeDefined();

      // Verify manifest now has content field
      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.content).toBeDefined();
      expect(updated.content.projectType).toBe("brownfield");
      expect(updated.content.teamSize).toBe("team");
      expect(updated.content.preset).toBe("full");
    });

    it("should not trigger when manifest already has content field", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        content: makeContentSelection(),
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      // No prompts should have been called for content-selections-init
      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });

  describe("platform-selection checkpoint", () => {
    it("should trigger when manifest has no platform field", async () => {
      // Create manifest without platform -- triggers platform-selection
      await createTestProject(tempDir, { platform: undefined });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // Mock: platform prompt -> github (no follow-up namespace/project prompts needed)
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ platform: "github" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.platform).toBe("github");
      expect(updated.namespace).toBeDefined();
      expect(updated.project).toBeDefined();
    });

    it("should not trigger when manifest has platform field", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        platform: "github",
        content: makeContentSelection(),
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });

  describe("customize-yaml-size checkpoint", () => {
    it("should trigger when .customize.yaml file exceeds 10KB", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        content: makeContentSelection(),
      });

      // Create a large .customize.yaml file (> 10KB = 10240 bytes)
      const largeYaml = "# Large customize file\n" + "override-key: value\n".repeat(1000);
      const customizePath = join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.customize.yaml");
      await writeFile(customizePath, largeYaml);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      // The checkpoint should generate a notice about the large file
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("Large customize file");
    });

    it("should not trigger when .customize.yaml files are small", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        content: makeContentSelection(),
      });

      // Create a small customize file (well under 10KB)
      const smallYaml = "override-key: value\n";
      const customizePath = join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.customize.yaml");
      await writeFile(customizePath, smallYaml);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).not.toContain("Large customize file");
    });
  });

  describe("fully migrated manifest", () => {
    it("should trigger no checkpoints when manifest is complete", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        platform: "github",
        content: makeContentSelection(),
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      // No prompts at all -- fully migrated manifest
      expect(inquirer.prompt).not.toHaveBeenCalled();

      // Should report "Already at" since hatch3rVersion matches
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("Already at");
    });
  });

  // ── D3-1: Mock inquirer for 5 interactive flows ─────────────

  describe("content-selections-init prompts for projectType and teamSize", () => {
    it("should accept greenfield + solo answers", async () => {
      await createTestProject(tempDir, { content: undefined });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.content;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ projectType: "greenfield" })
        .mockResolvedValueOnce({ teamSize: "solo" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.content.projectType).toBe("greenfield");
      expect(updated.content.teamSize).toBe("solo");
    });

    it("should accept brownfield + team answers", async () => {
      await createTestProject(tempDir, { content: undefined });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.content;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ projectType: "brownfield" })
        .mockResolvedValueOnce({ teamSize: "team" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.content.projectType).toBe("brownfield");
      expect(updated.content.teamSize).toBe("team");

      // Should produce migration notice
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("content tracking");
    });
  });

  describe("platform-selection with GitHub", () => {
    it("should auto-populate namespace and project from existing owner/repo", async () => {
      // Set owner/repo but clear namespace/project so the checkpoint fills them
      await createTestProject(tempDir, {
        platform: undefined,
        owner: "my-org",
        repo: "my-repo",
        namespace: "",
        project: "",
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // content-selections-init does NOT fire because content is already set
      // platform-selection fires -> user selects github
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ platform: "github" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.platform).toBe("github");
      // namespace/project should be auto-populated from owner/repo when previously empty
      expect(updated.namespace).toBe("my-org");
      expect(updated.project).toBe("my-repo");
    });
  });

  describe("platform-selection with non-github platform", () => {
    it("should prompt for namespace, project, and repo when Azure DevOps is selected", async () => {
      await createTestProject(tempDir, {
        platform: undefined,
        owner: "old-owner",
        repo: "old-repo",
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // platform-selection: user selects azure-devops, then provides namespace/project/repo
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ platform: "azure-devops" })
        .mockResolvedValueOnce({
          namespace: "my-ado-org",
          project: "my-ado-project",
          repo: "my-ado-repo",
        });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.platform).toBe("azure-devops");
      expect(updated.namespace).toBe("my-ado-org");
      expect(updated.owner).toBe("my-ado-org");
      expect(updated.project).toBe("my-ado-project");
      expect(updated.repo).toBe("my-ado-repo");
    });

    it("should prompt for namespace, project, and repo when GitLab is selected", async () => {
      await createTestProject(tempDir, {
        platform: undefined,
        owner: "old-owner",
        repo: "old-repo",
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ platform: "gitlab" })
        .mockResolvedValueOnce({
          namespace: "my-gitlab-group",
          project: "my-gl-project",
          repo: "my-gl-repo",
        });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.platform).toBe("gitlab");
      expect(updated.namespace).toBe("my-gitlab-group");
      expect(updated.project).toBe("my-gl-project");
      expect(updated.repo).toBe("my-gl-repo");
    });
  });

  describe("main update flow when manifest exists", () => {
    it("should complete update and report summary for outdated manifest", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "0.0.9",
        platform: "github",
        content: makeContentSelection(),
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.hatch3rVersion).toBe("1.4.0");

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("Update complete");
      expect(allOutput).toContain("canonical files");
    });
  });

  describe("update flow when manifest is already up-to-date", () => {
    it("should note already at latest version and still complete update", async () => {
      await createTestProject(tempDir, {
        hatch3rVersion: "1.4.0",
        platform: "github",
        content: makeContentSelection(),
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("Already at");
      expect(allOutput).toContain("Update complete");

      // No migration prompts should have fired
      expect(inquirer.prompt).not.toHaveBeenCalled();
    });
  });

  // ── Combined checkpoint scenarios ───────────────────────────

  describe("multiple checkpoints triggering together", () => {
    it("should run both content-selections-init and platform-selection when both are missing", async () => {
      await createTestProject(tempDir, {
        content: undefined,
        platform: undefined,
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.content;
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // First: content-selections-init prompts (projectType, teamSize)
      // Then: platform-selection prompt (platform choice)
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ projectType: "greenfield" })
        .mockResolvedValueOnce({ teamSize: "solo" })
        .mockResolvedValueOnce({ platform: "github" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.content).toBeDefined();
      expect(updated.content.projectType).toBe("greenfield");
      expect(updated.content.teamSize).toBe("solo");
      expect(updated.platform).toBe("github");

      // Should have 3 prompt calls total
      expect(inquirer.prompt).toHaveBeenCalledTimes(3);
    });

    it("should run content-selections-init, platform-selection (non-github), and customize-yaml-size", async () => {
      await createTestProject(tempDir, {
        content: undefined,
        platform: undefined,
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.content;
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      // Create a large customize yaml to trigger the third checkpoint
      const largeYaml = "# Large file\n" + "key: value\n".repeat(1500);
      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "hatch3r-big.customize.yaml"),
        largeYaml,
      );

      // content-selections-init: projectType + teamSize
      // platform-selection: platform (azure-devops) + namespace/project/repo
      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ projectType: "brownfield" })
        .mockResolvedValueOnce({ teamSize: "team" })
        .mockResolvedValueOnce({ platform: "azure-devops" })
        .mockResolvedValueOnce({
          namespace: "ado-org",
          project: "ado-proj",
          repo: "ado-repo",
        });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.content.projectType).toBe("brownfield");
      expect(updated.platform).toBe("azure-devops");

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("Large customize file");
      expect(allOutput).toContain("Azure DevOps");
    });
  });

  describe("version upgrade during platform migration", () => {
    it("should upgrade manifest version from 1.0.0 to 2.0.0 during platform migration", async () => {
      await createTestProject(tempDir, {
        version: "1.0.0",
        platform: undefined,
        content: makeContentSelection(),
      });
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.platform;
      await writeFile(manifestPath, JSON.stringify(raw, null, 2));

      vi.mocked(inquirer.prompt)
        .mockResolvedValueOnce({ platform: "github" });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const updated = JSON.parse(await readFile(manifestPath, "utf-8"));
      expect(updated.version).toBe("2.0.0");
      expect(updated.platform).toBe("github");
    });
  });

  describe("error handling", () => {
    it("should exit with error when no manifest exists", async () => {
      // No manifest file at all
      const { updateCommand } = await import("../../cli/commands/update.js");

      await expect(updateCommand()).rejects.toThrow(HatchError);

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(allOutput).toContain("No .agents/hatch.json found");
    });
  });
});
