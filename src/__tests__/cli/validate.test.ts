import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENTS_DIR = ".agents";

async function createMinimalAgentsDir(root: string): Promise<void> {
  const agentsDir = join(root, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(join(agentsDir, "agents"), { recursive: true });
  await mkdir(join(agentsDir, "skills"), { recursive: true });
  await mkdir(join(agentsDir, "rules"), { recursive: true });
  await mkdir(join(agentsDir, "commands"), { recursive: true });
  await mkdir(join(agentsDir, "mcp"), { recursive: true });

  const manifest = {
    version: "1.0.0",
    hatch3rVersion: "1.0.0",
    owner: "test-org",
    repo: "test-repo",
    tools: ["cursor"],
    features: {
      agents: true,
      skills: true,
      rules: true,
      prompts: true,
      commands: true,
      mcp: true,
      guardrails: true,
      githubAgents: true,
      hooks: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
  };
  await writeFile(
    join(agentsDir, "hatch.json"),
    JSON.stringify(manifest, null, 2),
  );

  await writeFile(
    join(agentsDir, "AGENTS.md"),
    "# AGENTS.md\n\nTest agents file.\n",
  );

  await writeFile(
    join(agentsDir, "rules", "hatch3r-test-rule.md"),
    "---\nid: hatch3r-test-rule\ntype: rule\ndescription: A test rule\nscope: always\n---\n# Test Rule\n\nTest content.\n",
  );
}

describe("validate command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-validate-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should report error when .agents/ directory is missing", async () => {
    const { validateCommand } = await import("../../cli/commands/validate.js");

    await expect(validateCommand()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .join(" ");
    expect(allOutput).toContain(".agents/ directory not found");
  });

  it("should pass validation for a valid structure", async () => {
    await createMinimalAgentsDir(tempDir);

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("should report error when hatch.json is missing", async () => {
    const agentsDir = join(tempDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await mkdir(join(agentsDir, "agents"), { recursive: true });
    await mkdir(join(agentsDir, "skills"), { recursive: true });
    await mkdir(join(agentsDir, "rules"), { recursive: true });

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await expect(validateCommand()).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Missing .agents/hatch.json manifest");
  });

  it("should warn about missing frontmatter in canonical files", async () => {
    await createMinimalAgentsDir(tempDir);

    await writeFile(
      join(tempDir, AGENTS_DIR, "rules", "bad-rule.md"),
      "# No frontmatter\n\nThis file has no frontmatter.\n",
    );

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Missing frontmatter");
  });

  it("should warn about missing optional directories", async () => {
    await createMinimalAgentsDir(tempDir);
    await rm(join(tempDir, AGENTS_DIR, "commands"), {
      recursive: true,
      force: true,
    });

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Optional directory missing");
  });

  it("should report error for invalid frontmatter (no closing ---)", async () => {
    await createMinimalAgentsDir(tempDir);

    await writeFile(
      join(tempDir, AGENTS_DIR, "rules", "bad-frontmatter.md"),
      "---\nid: bad\ntype: rule\n# No closing delimiter\n\nContent.\n",
    );

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await expect(validateCommand()).rejects.toThrow("process.exit called");

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid frontmatter (no closing ---)");
  });

  it("should warn about missing id in frontmatter", async () => {
    await createMinimalAgentsDir(tempDir);

    await writeFile(
      join(tempDir, AGENTS_DIR, "rules", "no-id.md"),
      "---\ntype: rule\ndescription: no id\n---\n# No ID\n\nContent.\n",
    );

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Missing 'id' in frontmatter");
  });

  it("should warn about missing type in frontmatter", async () => {
    await createMinimalAgentsDir(tempDir);

    await writeFile(
      join(tempDir, AGENTS_DIR, "rules", "no-type.md"),
      "---\nid: no-type\ndescription: no type\n---\n# No Type\n\nContent.\n",
    );

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Missing 'type' in frontmatter");
  });

  it("should warn about skill directory missing SKILL.md", async () => {
    await createMinimalAgentsDir(tempDir);

    await mkdir(join(tempDir, AGENTS_DIR, "skills", "bad-skill"), {
      recursive: true,
    });

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Skill directory missing SKILL.md");
  });

  it("should warn about managed file without hatch3r prefix", async () => {
    await createMinimalAgentsDir(tempDir);

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf-8"),
    ) as Record<string, unknown>;
    manifest.managedFiles = [".cursor/rules/custom-rule.mdc"];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Managed file without hatch3r- prefix");
  });

  it("should report error for invalid JSON in mcp.json", async () => {
    await createMinimalAgentsDir(tempDir);

    const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    manifest.mcp = { servers: ["github"] };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    await writeFile(
      join(tempDir, AGENTS_DIR, "mcp", "mcp.json"),
      "{ invalid json }",
    );

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await expect(validateCommand()).rejects.toThrow("process.exit called");

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Invalid JSON in .agents/mcp/mcp.json");
  });

  it("should show validation passed with warnings when only warnings exist", async () => {
    await createMinimalAgentsDir(tempDir);
    await rm(join(tempDir, AGENTS_DIR, "commands"), {
      recursive: true,
      force: true,
    });

    const { validateCommand } = await import("../../cli/commands/validate.js");
    await validateCommand();

    const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(allOutput).toContain("Validation passed");
    expect(allOutput).toContain("warning(s)");
  });
});
