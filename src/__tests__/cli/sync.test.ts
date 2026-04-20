import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";

const AGENTS_DIR = ".agents";

function createTestManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
      githubAgents: true,
      hooks: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
    ...overrides,
  };
}

async function createTestProject(root: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const agentsDir = join(root, AGENTS_DIR);
  await mkdir(agentsDir, { recursive: true });
  await mkdir(join(agentsDir, "rules"), { recursive: true });
  await mkdir(join(agentsDir, "agents"), { recursive: true });
  await mkdir(join(agentsDir, "skills"), { recursive: true });
  await mkdir(join(agentsDir, "commands"), { recursive: true });

  const manifest = createTestManifest(overrides);
  await writeFile(join(agentsDir, "hatch.json"), JSON.stringify(manifest, null, 2));

  await writeFile(
    join(agentsDir, "rules", "hatch3r-test.md"),
    "---\nid: hatch3r-test\ntype: rule\ndescription: test rule\nscope: always\n---\n# Test Rule\n\nTest content.\n",
  );

  await writeFile(
    join(agentsDir, "agents", "hatch3r-test-agent.md"),
    "---\nid: test-agent\ntype: agent\ndescription: test agent\n---\n# Test Agent\n\nYou are a test agent.\n",
  );
}

describe("sync command", () => {
  let tempDir: string;
  let cwdSpy: MockInstance;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-sync-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should exit with error when no manifest exists", async () => {
    const { syncCommand } = await import("../../cli/commands/sync.js");

    await expect(syncCommand()).rejects.toThrow(HatchError);
    try { await syncCommand(); } catch (e) { expect((e as HatchError).exitCode).toBe(1); }

    // D12-M1: error() routes to console.error (stderr) per POSIX convention.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain("No .agents/hatch.json found");
  });

  it("should sync and create adapter output files", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const rulesContent = await readFile(
      join(cursorRulesDir, "hatch3r-test.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(rulesContent).not.toBeNull();
  });

  it("should create or update AGENTS.md with managed block", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("<!-- HATCH3R:BEGIN -->");
    expect(agentsMd).toContain("<!-- HATCH3R:END -->");
    expect(agentsMd).toContain("hatch3r");
  });

  it("should skip AGENTS.md when it has no managed block markers", async () => {
    await createTestProject(tempDir);
    const customContent =
      "# My Custom Header\n\nCustom content that should be preserved.\n";
    await writeFile(join(tempDir, "AGENTS.md"), customContent);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const agentsMd = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toBe(customContent);
  });

  it("should report sync summary", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Sync complete");
  });

  it("should sync multiple tools when configured", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesExists = await readFile(
      join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(cursorRulesExists).not.toBeNull();

    const claudeMdExists = await readFile(
      join(tempDir, "CLAUDE.md"),
      "utf-8",
    ).catch(() => null);
    expect(claudeMdExists).not.toBeNull();
  });

  it("should report actions for each synced file", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("AGENTS.md");
  });

  it("should warn about new MCP env vars when servers require them", async () => {
    await createTestProject(tempDir, {
      mcp: { servers: ["github"] },
    });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // D12-M1: warn() routes to console.error (stderr) per POSIX convention.
    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toContain("New secrets needed in .env.mcp");
    expect(output).toContain("GITHUB_PAT");
  });

  it("should report 'skipped' for unchanged non-managed files on re-sync", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("skipped");
  });

  it("should report 'skipped' when a non-managed file has changed on disk", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const envJsonPath = join(tempDir, ".cursor", "environment.json");
    await writeFile(envJsonPath, '{"changed": true}');

    consoleSpy.mockClear();
    await syncCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("skipped");
  });

  it("should exit with error when adapter generation fails", async () => {
    // Use an invalid tool name which now fails manifest validation (#108)
    await createTestProject(tempDir, { tools: ["nonexistent-tool"] });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await expect(syncCommand()).rejects.toThrow(/Invalid manifest|required fields/);
  });

  it("should log minimal mode info when --minimal flag is passed", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand({ minimal: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Minimal generation mode");
  });

  it("should complete sync and report results with --minimal flag", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand({ minimal: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Sync complete");
    expect(output).toContain("AGENTS.md");
  });

  // C7-H5 (D15, OWASP ASI 2026): Preflight integrity check tests
  describe("preflight integrity check", () => {
    async function seedIntegrityManifest(root: string): Promise<void> {
      const { generateIntegrityManifest, writeIntegrityManifest } = await import("../../integrity/index.js");
      const agentsDir = join(root, AGENTS_DIR);
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);
    }

    it("refuses to sync when canonical file has been modified (no --force)", async () => {
      await createTestProject(tempDir);
      await seedIntegrityManifest(tempDir);

      // Modify a canonical file after the integrity manifest was sealed
      await writeFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "---\nid: hatch3r-test\ntype: rule\ndescription: tampered\nscope: always\n---\n# Tampered.\n",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await expect(syncCommand()).rejects.toThrow(HatchError);

      const combined = consoleSpy.mock.calls.map((c) => String(c[0])).join(" ") +
        " " + consoleErrorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(combined).toMatch(/MODIFIED/);
      expect(combined).toMatch(/--force/);
    });

    it("proceeds with --force despite integrity drift", async () => {
      await createTestProject(tempDir);
      await seedIntegrityManifest(tempDir);

      await writeFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "---\nid: hatch3r-test\ntype: rule\ndescription: tampered\nscope: always\n---\n# Tampered.\n",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await expect(syncCommand({ force: true })).resolves.toBeUndefined();
    });

    it("does NOT block when no integrity manifest exists yet (fresh repo)", async () => {
      await createTestProject(tempDir);
      // Intentionally do NOT seed integrity manifest

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await expect(syncCommand()).resolves.toBeUndefined();
    });

    it("emits an HatchError with INTEGRITY_ERROR code on drift block", async () => {
      await createTestProject(tempDir);
      await seedIntegrityManifest(tempDir);
      await writeFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "modified content without frontmatter",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      try {
        await syncCommand();
      } catch (e) {
        const err = e as HatchError;
        expect(err.errorCode).toBe("INTEGRITY_ERROR");
        expect(err.exitCode).toBe(1);
      }
    });
  });

  // C7.5-W2B2-H22 (D6-SA6.1-2): Pre-write context budget gate
  describe("context budget pre-write gate", () => {
    async function seedOversizedRule(root: string): Promise<void> {
      // Copilot's budget is 64K tokens ~= 256K characters. Seed a rule
      // containing ~300K characters of filler so the generated
      // copilot-instructions.md overflows the budget. The rule body is
      // injected verbatim into the inner-content block, guaranteeing overflow.
      const filler = "x".repeat(300_000);
      await writeFile(
        join(root, AGENTS_DIR, "rules", "hatch3r-oversize.md"),
        `---\nid: hatch3r-oversize\ntype: rule\ndescription: oversize rule for budget test\nscope: always\n---\n# Oversize\n\n${filler}\n`,
      );
    }

    it("emits the budget warning before any file is written (default mode)", async () => {
      await createTestProject(tempDir, { tools: ["copilot"] });
      await seedOversizedRule(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const combined =
        consoleSpy.mock.calls.map((c) => String(c[0])).join(" ") +
        " " + consoleErrorSpy.mock.calls.map((c) => String(c[0])).join(" ");
      expect(combined).toMatch(/context budget/i);
      expect(combined).toContain("hatch3r sync --minimal");
      expect(combined).toContain("--strict-budget");

      // Default behaviour: warning only, file is still written.
      const instructions = await readFile(
        join(tempDir, ".github", "copilot-instructions.md"),
        "utf-8",
      ).catch(() => null);
      expect(instructions).not.toBeNull();
    });

    it("fails sync with exit code 2 when --strict-budget is set and budget is exceeded", async () => {
      await createTestProject(tempDir, { tools: ["copilot"] });
      await seedOversizedRule(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      try {
        await syncCommand({ strictBudget: true });
        expect.fail("expected syncCommand to throw HatchError");
      } catch (e) {
        const err = e as HatchError;
        expect(err).toBeInstanceOf(HatchError);
        expect(err.exitCode).toBe(2);
        expect(err.errorCode).toBe("ADAPTER_ERROR");
      }

      // Strict mode aborts the write for the over-budget adapter.
      const instructions = await readFile(
        join(tempDir, ".github", "copilot-instructions.md"),
        "utf-8",
      ).catch(() => null);
      expect(instructions).toBeNull();
    });

    it("does not trigger the budget gate when output fits (--strict-budget success)", async () => {
      await createTestProject(tempDir, { tools: ["copilot"] });
      // No oversized rule seeded: default test content is well under budget.

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await expect(syncCommand({ strictBudget: true })).resolves.toBeUndefined();
    });
  });

  // D1-SA1.3.2 (High): integrity manifest metadata after sync
  describe("integrity manifest adapter metadata", () => {
    it("records expectedAdapters and successfulAdapters on full-success sync", async () => {
      await createTestProject(tempDir, { tools: ["cursor", "claude"] });

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readIntegrityManifest } = await import("../../integrity/index.js");
      const manifest = await readIntegrityManifest(join(tempDir, AGENTS_DIR));
      expect(manifest).not.toBeNull();
      expect(manifest!.expectedAdapters).toEqual(["claude", "cursor"]);
      expect(manifest!.successfulAdapters).toEqual(["claude", "cursor"]);
    });

    it("re-sealed manifests preserve sorted adapter field order", async () => {
      // Tools in non-alphabetical order in hatch.json
      await createTestProject(tempDir, { tools: ["cursor", "claude"] });

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readIntegrityManifest } = await import("../../integrity/index.js");
      const manifest = await readIntegrityManifest(join(tempDir, AGENTS_DIR));
      // Expectation order is stable (sorted) regardless of manifest input order
      expect(manifest!.expectedAdapters).toEqual(["claude", "cursor"]);
    });
  });

  // C8-D8-M1 (D8): aggregated recovery guidance on thrown HatchError
  describe("aggregated recovery guidance", () => {
    it("HatchError thrown on all-adapter failure carries a recovery hint", async () => {
      await createTestProject(tempDir, { tools: ["cursor"] });

      // Force every adapter invocation to return completed:false so the
      // adapter loop's catch block populates adapterFailures and the terminal
      // "All adapters failed" branch fires with our new aggregated guidance.
      const adapterTimeoutMod = await import("../../pipeline/adapterTimeout.js");
      const spy = vi.spyOn(adapterTimeoutMod, "generateWithTimeout").mockResolvedValue({
        tool: "cursor",
        completed: false,
        elapsedMs: 10,
        error: "invalid config: missing required field",
        warnings: [],
      });

      const { syncCommand } = await import("../../cli/commands/sync.js");
      try {
        await syncCommand();
        expect.fail("expected syncCommand to throw HatchError");
      } catch (e) {
        const err = e as HatchError;
        expect(err).toBeInstanceOf(HatchError);
        expect(err.message).toMatch(/All adapters failed/);
        expect(err.message).toMatch(/substantive|transient|Retry|Inspect|resolve/i);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
