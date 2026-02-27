import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readAgentCustomization,
  readCustomization,
  readCustomizationMarkdown,
} from "../../models/customize.js";

describe("readAgentCustomization (backward compat)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-"));
    return tempDir;
  }

  it("returns undefined when file does not exist", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readAgentCustomization(projectRoot, "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("returns undefined when file has invalid YAML", async () => {
    const projectRoot = await createProjectRoot();
    const customizeDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(customizeDir, { recursive: true });
    await writeFile(
      join(customizeDir, "hatch3r-reviewer.customize.yaml"),
      "invalid: yaml: [",
      "utf-8",
    );
    const result = await readAgentCustomization(projectRoot, "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("returns undefined when file has no recognized fields", async () => {
    const projectRoot = await createProjectRoot();
    const customizeDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(customizeDir, { recursive: true });
    await writeFile(
      join(customizeDir, "hatch3r-reviewer.customize.yaml"),
      "agent: hatch3r-reviewer\npersonality:\n  tone: concise",
      "utf-8",
    );
    const result = await readAgentCustomization(projectRoot, "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("returns model when file has valid model field", async () => {
    const projectRoot = await createProjectRoot();
    const customizeDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(customizeDir, { recursive: true });
    await writeFile(
      join(customizeDir, "hatch3r-reviewer.customize.yaml"),
      "agent: hatch3r-reviewer\nmodel: opus",
      "utf-8",
    );
    const result = await readAgentCustomization(projectRoot, "hatch3r-reviewer");
    expect(result).toEqual({ model: "opus" });
  });

  it("returns undefined when model is empty string", async () => {
    const projectRoot = await createProjectRoot();
    const customizeDir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(customizeDir, { recursive: true });
    await writeFile(
      join(customizeDir, "hatch3r-reviewer.customize.yaml"),
      "agent: hatch3r-reviewer\nmodel: \"\"",
      "utf-8",
    );
    const result = await readAgentCustomization(projectRoot, "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });
});

describe("readCustomization", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-"));
    return tempDir;
  }

  it("returns undefined when file does not exist", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toBeUndefined();
  });

  it("reads model for agents", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.yaml"),
      "model: opus",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toEqual({ model: "opus" });
  });

  it("reads scope for rules", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "scope: src/**/*.ts",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toEqual({ scope: "src/**/*.ts" });
  });

  it("reads description for skills", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-issue-workflow.customize.yaml"),
      "description: Custom workflow description",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "skills", "hatch3r-issue-workflow");
    expect(result).toEqual({ description: "Custom workflow description" });
  });

  it("reads enabled flag", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-release.customize.yaml"),
      "enabled: false",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "commands", "hatch3r-release");
    expect(result).toEqual({ enabled: false });
  });

  it("reads multiple fields", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.yaml"),
      "scope: src/**/*.ts\ndescription: Custom testing\nenabled: true",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "rules", "hatch3r-testing");
    expect(result).toEqual({
      scope: "src/**/*.ts",
      description: "Custom testing",
      enabled: true,
    });
  });

  it("ignores empty string fields", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "test.customize.yaml"),
      'model: ""\ndescription: ""',
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "test");
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid YAML", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "test.customize.yaml"),
      "not: valid: yaml: [",
      "utf-8",
    );
    const result = await readCustomization(projectRoot, "agents", "test");
    expect(result).toBeUndefined();
  });
});

describe("readCustomizationMarkdown", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProjectRoot(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-customize-md-"));
    return tempDir;
  }

  it("returns undefined when file does not exist", async () => {
    const projectRoot = await createProjectRoot();
    const result = await readCustomizationMarkdown(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toBeUndefined();
  });

  it("returns content when file exists", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "agents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-reviewer.customize.md"),
      "## Custom Instructions\n\nReview for HIPAA compliance.",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "agents", "hatch3r-reviewer");
    expect(result).toBe("## Custom Instructions\n\nReview for HIPAA compliance.");
  });

  it("returns undefined for empty file", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "rules");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-testing.customize.md"),
      "",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "rules", "hatch3r-testing");
    expect(result).toBeUndefined();
  });

  it("returns undefined for whitespace-only file", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-issue-workflow.customize.md"),
      "   \n\n  \n",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "skills", "hatch3r-issue-workflow");
    expect(result).toBeUndefined();
  });

  it("trims content", async () => {
    const projectRoot = await createProjectRoot();
    const dir = join(projectRoot, ".hatch3r", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "hatch3r-release.customize.md"),
      "\n  Custom release steps  \n",
      "utf-8",
    );
    const result = await readCustomizationMarkdown(projectRoot, "commands", "hatch3r-release");
    expect(result).toBe("Custom release steps");
  });

  it("reads from different type directories", async () => {
    const projectRoot = await createProjectRoot();

    for (const type of ["agents", "skills", "commands", "rules"] as const) {
      const dir = join(projectRoot, ".hatch3r", type);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `test-id.customize.md`),
        `Custom ${type} content`,
        "utf-8",
      );
      const result = await readCustomizationMarkdown(projectRoot, type, "test-id");
      expect(result).toBe(`Custom ${type} content`);
    }
  });
});
