import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorAdapter } from "../../adapters/cursor.js";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";
import {
  applyCustomization,
  applyCustomizationRaw,
} from "../../adapters/customization.js";
import type { CanonicalFile } from "../../types.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

function makeManifest(
  overrides: Partial<Parameters<typeof createManifest>[0]> & { models?: HatchManifest["models"] } = {},
): HatchManifest {
  const { models, ...createOpts } = overrides;
  const base = createManifest({
    tools: ["cursor"],
    mcpServers: [],
    ...createOpts,
  });
  return models ? { ...base, models } : base;
}

describe("applyCustomization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-apply-cust-"));
    return tempDir;
  }

  const baseAgent: CanonicalFile = {
    id: "hatch3r-reviewer",
    type: "agent",
    description: "Code reviewer",
    content: "You are a code reviewer.",
    rawContent: "---\nid: hatch3r-reviewer\n---\nYou are a code reviewer.",
    sourcePath: "/fake/path.md",
  };

  const baseRule: CanonicalFile = {
    id: "hatch3r-testing",
    type: "rule",
    description: "Testing rules",
    scope: "always",
    content: "Write tests for all changes.",
    rawContent: "---\nid: hatch3r-testing\nscope: always\n---\nWrite tests for all changes.",
    sourcePath: "/fake/path.md",
  };

  it("returns original content when no customization files exist", async () => {
    const projectRoot = await setup();
    const result = await applyCustomization(projectRoot, baseAgent);
    expect(result.content).toBe("You are a code reviewer.");
    expect(result.skip).toBe(false);
    expect(result.overrides).toEqual({});
  });

  it("appends markdown customization to content", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.md"),
      "Focus on security.",
      "utf-8",
    );
    const result = await applyCustomization(projectRoot, baseAgent);
    expect(result.content).toContain("You are a code reviewer.");
    expect(result.content).toContain("## Project Customizations");
    expect(result.content).toContain("Focus on security.");
  });

  it("returns skip=true when enabled is false", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "enabled: false",
      "utf-8",
    );
    const result = await applyCustomization(projectRoot, baseAgent);
    expect(result.skip).toBe(true);
  });

  it("returns overrides from YAML", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus\ndescription: Custom reviewer",
      "utf-8",
    );
    const result = await applyCustomization(projectRoot, baseAgent);
    expect(result.overrides.model).toBe("opus");
    expect(result.overrides.description).toBe("Custom reviewer");
    expect(result.skip).toBe(false);
  });

  it("returns scope override for rules", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "scope: src/**/*.ts",
      "utf-8",
    );
    const result = await applyCustomization(projectRoot, baseRule);
    expect(result.overrides.scope).toBe("src/**/*.ts");
  });

  it("combines YAML overrides and markdown content", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus",
      "utf-8",
    );
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.md"),
      "Extra instructions here.",
      "utf-8",
    );
    const result = await applyCustomization(projectRoot, baseAgent);
    expect(result.overrides.model).toBe("opus");
    expect(result.content).toContain("Extra instructions here.");
    expect(result.content).toContain("## Project Customizations");
    expect(result.skip).toBe(false);
  });

  it("handles unsupported file types gracefully", async () => {
    const projectRoot = await setup();
    const hookFile: CanonicalFile = {
      ...baseAgent,
      type: "hook",
    };
    const result = await applyCustomization(projectRoot, hookFile);
    expect(result.content).toBe(baseAgent.content);
    expect(result.skip).toBe(false);
  });
});

describe("applyCustomizationRaw", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-apply-cust-raw-"));
    return tempDir;
  }

  const baseCommand: CanonicalFile = {
    id: "hatch3r-release",
    type: "command",
    description: "Release workflow",
    content: "Execute release steps.",
    rawContent: "---\nid: hatch3r-release\n---\n# Release\n\nExecute release steps.",
    sourcePath: "/fake/path.md",
  };

  it("returns rawContent when no customization", async () => {
    const projectRoot = await setup();
    const result = await applyCustomizationRaw(projectRoot, baseCommand);
    expect(result.content).toBe(baseCommand.rawContent);
    expect(result.skip).toBe(false);
  });

  it("appends markdown customization to rawContent", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-release.customize.md"),
      "Deploy to staging first.",
      "utf-8",
    );
    const result = await applyCustomizationRaw(projectRoot, baseCommand);
    expect(result.content).toContain(baseCommand.rawContent);
    expect(result.content).toContain("## Project Customizations");
    expect(result.content).toContain("Deploy to staging first.");
  });

  it("returns skip=true when enabled is false", async () => {
    const projectRoot = await setup();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-release.customize.yaml"),
      "enabled: false",
      "utf-8",
    );
    const result = await applyCustomizationRaw(projectRoot, baseCommand);
    expect(result.skip).toBe(true);
  });
});

describe("CursorAdapter with customization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setupWithCustomize(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cursor-cust-"));
    const agentsDir = join(tempDir, "agents");
    await cp(FIXTURES_DIR, agentsDir, { recursive: true });
    return tempDir;
  }

  it("injects customize.md content into agent managed block", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-agent.customize.md"),
      "Focus on healthcare compliance.",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.managedContent).toContain("You are a test agent");
    expect(agentFile!.managedContent).toContain("## Project Customizations");
    expect(agentFile!.managedContent).toContain("Focus on healthcare compliance.");
  });

  it("skips agent when enabled is false", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-agent.customize.yaml"),
      "enabled: false",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeUndefined();
  });

  it("applies description override to agent frontmatter", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-agent.customize.yaml"),
      "description: Custom test agent description",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const agentFile = outputs.find((o) => o.path === ".cursor/agents/hatch3r-test-agent.md");
    expect(agentFile).toBeDefined();
    expect(agentFile!.content).toContain("description: Custom test agent description");
  });

  it("skips rule when enabled is false", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-rule.customize.yaml"),
      "enabled: false",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const ruleFile = outputs.find((o) => o.path === ".cursor/rules/hatch3r-test-rule.mdc");
    expect(ruleFile).toBeUndefined();
  });

  it("applies scope override to rule frontmatter", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-rule.customize.yaml"),
      "scope: src/**/*.ts",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const ruleFile = outputs.find((o) => o.path === ".cursor/rules/hatch3r-test-rule.mdc");
    expect(ruleFile).toBeDefined();
    expect(ruleFile!.content).toContain('globs: ["src/**/*.ts"]');
    expect(ruleFile!.content).not.toContain("alwaysApply: true");
  });

  it("injects customize.md into command managed block", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-command.customize.md"),
      "Run staging tests first.",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const cmdFile = outputs.find((o) => o.path === ".cursor/commands/hatch3r-test-command.md");
    expect(cmdFile).toBeDefined();
    expect(cmdFile!.managedContent).toContain("## Project Customizations");
    expect(cmdFile!.managedContent).toContain("Run staging tests first.");
  });

  it("skips skill when enabled is false", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-skill.customize.yaml"),
      "enabled: false",
      "utf-8",
    );

    const adapter = new CursorAdapter();
    const manifest = makeManifest();
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const skillFile = outputs.find((o) => o.path.includes("hatch3r-test-skill"));
    expect(skillFile).toBeUndefined();
  });
});

describe("ClaudeAdapter with customization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setupWithCustomize(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-claude-cust-"));
    const agentsDir = join(tempDir, "agents");
    await cp(FIXTURES_DIR, agentsDir, { recursive: true });
    return tempDir;
  }

  it("injects customize.md into agent output", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-agent.customize.md"),
      "Check HIPAA compliance.",
      "utf-8",
    );

    const adapter = new ClaudeAdapter();
    const manifest = makeManifest({ tools: ["claude"] });
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const agentFile = outputs.find((o) => o.path.includes("hatch3r-test-agent"));
    expect(agentFile).toBeDefined();
    expect(agentFile!.managedContent).toContain("## Project Customizations");
    expect(agentFile!.managedContent).toContain("Check HIPAA compliance.");
  });

  it("skips disabled agents", async () => {
    const projectRoot = await setupWithCustomize();
    const hatch3rDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(hatch3rDir, { recursive: true });
    await writeFile(
      join(hatch3rDir, "test-agent.customize.yaml"),
      "enabled: false",
      "utf-8",
    );

    const adapter = new ClaudeAdapter();
    const manifest = makeManifest({ tools: ["claude"] });
    const outputs = await adapter.generate(join(projectRoot, "agents"), manifest);

    const agentFile = outputs.find((o) => o.path.includes("hatch3r-test-agent"));
    expect(agentFile).toBeUndefined();
  });
});
