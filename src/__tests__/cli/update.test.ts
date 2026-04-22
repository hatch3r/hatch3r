import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { HatchError } from "../../types.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

const AGENTS_DIR = ".agents";

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

  const manifest = {
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
    worktree: { enabled: false },
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

  await writeFile(
    join(agentsDir, "rules", "hatch3r-test.md"),
    "---\nid: hatch3r-test\ntype: rule\ndescription: test rule\nscope: always\n---\n# Test Rule\n\nOld test content.\n",
  );
}

describe("update command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-update-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it("should exit with error when no manifest exists", async () => {
    const { updateCommand } = await import("../../cli/commands/update.js");

    await expect(updateCommand()).rejects.toThrow(HatchError);
    try { await updateCommand(); } catch (e) { expect((e as HatchError).exitCode).toBe(1); }

    // D12-M1: error() routes to console.error (stderr) per POSIX convention.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain("No .agents/hatch.json found");
  });

  it("should update hatch3rVersion in manifest", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const manifest = JSON.parse(
      await readFile(join(tempDir, AGENTS_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.hatch3rVersion).toBe("1.6.2");
  });

  it("should copy hatch3r-prefixed files from pack", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const rulesDir = join(tempDir, AGENTS_DIR, "rules");
    const rules = await readdir(rulesDir);
    const hatch3rRules = rules.filter((f) => f.startsWith("hatch3r-"));
    expect(hatch3rRules.length).toBeGreaterThan(0);
  });

  it("should preserve custom (non-hatch3r-prefixed) files", async () => {
    await createTestProject(tempDir);
    const customRulePath = join(tempDir, AGENTS_DIR, "rules", "my-custom-rule.md");
    await writeFile(customRulePath, "# My custom rule\n\nThis should be preserved.");

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const content = await readFile(customRulePath, "utf-8");
    expect(content).toContain("My custom rule");
    expect(content).toContain("This should be preserved");
  });

  it("should regenerate adapter output files after update", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const bridgePath = join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc");
    const bridgeContent = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(bridgeContent).not.toBeNull();
    expect(bridgeContent).toContain("Hatch3r Bridge");
  });

  it("should report update summary", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Update complete");
    expect(output).toContain("canonical files");
  });

  it("should note when already at latest version", async () => {
    await createTestProject(tempDir, { hatch3rVersion: "1.6.2" });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Already at");
  });

  it("should update canonical files for multiple tools", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("2 tool(s) re-synced");
  });

  // C7-H5 (D15, OWASP ASI 2026): Preflight integrity check tests
  describe("preflight integrity check", () => {
    async function seedIntegrityManifest(root: string): Promise<void> {
      const { generateIntegrityManifest, writeIntegrityManifest } = await import("../../integrity/index.js");
      const agentsDir = join(root, AGENTS_DIR);
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);
    }

    it("refuses to update when canonical file has been modified (no --force)", async () => {
      await createTestProject(tempDir);
      await seedIntegrityManifest(tempDir);
      await writeFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "tampered content",
      );

      const { updateCommand } = await import("../../cli/commands/update.js");
      await expect(updateCommand({})).rejects.toThrow(HatchError);

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
        "tampered content",
      );

      const { updateCommand } = await import("../../cli/commands/update.js");
      await expect(updateCommand({ force: true })).resolves.toBeUndefined();
    });

    it("emits HatchError with INTEGRITY_ERROR code on drift block", async () => {
      await createTestProject(tempDir);
      await seedIntegrityManifest(tempDir);
      await writeFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "tampered",
      );

      const { updateCommand } = await import("../../cli/commands/update.js");
      try {
        await updateCommand({});
      } catch (e) {
        const err = e as HatchError;
        expect(err.errorCode).toBe("INTEGRITY_ERROR");
        expect(err.exitCode).toBe(1);
      }
    });
  });

  // C7-H9 (D1): runPackageUpdate / runRegenerate split — verify the
  // exported helpers are individually callable.
  describe("runPackageUpdate / runRegenerate split", () => {
    it("exports runPackageUpdate as a separate function", async () => {
      const mod = await import("../../cli/commands/update.js");
      expect(typeof mod.runPackageUpdate).toBe("function");
    });

    it("exports runRegenerate as a separate function", async () => {
      const mod = await import("../../cli/commands/update.js");
      expect(typeof mod.runRegenerate).toBe("function");
    });

    it("runRegenerate copies canonical files and regenerates adapter outputs without touching the network", async () => {
      await createTestProject(tempDir);

      // Reset the execFileSync mock so prior tests in this file don't taint
      // the not-called assertion below.
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const result = await runRegenerate(tempDir, manifest!);
      expect(result.copiedFiles).toBeGreaterThan(0);
      expect(result.failedTools).toBe(0);
      // execFileSync is mocked at the top of this file. runRegenerate should
      // never invoke it because there is no package fetch step.
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });
  });

  // C8-D1-M6 (D1): --offline / --skip-fetch flag
  describe("--offline flag", () => {
    it("skips the package-fetch step when --offline is set", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true });

      // execFileSync is only invoked by runPackageUpdate. In offline mode we
      // bypass that step and call runRegenerate directly.
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });

    it("accepts the commander-style skipFetch property as an alias for offline", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();

      const { updateCommand } = await import("../../cli/commands/update.js");
      // Commander stores `--offline, --skip-fetch` under the last long name.
      await updateCommand({ skipFetch: true });

      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });

    it("still fetches the package when --offline is NOT set", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({});

      // Default path goes through runPackageUpdate, which calls execFileSync.
      expect(vi.mocked(execFileSync)).toHaveBeenCalled();
    });

    it("surfaces an offline-mode banner in console output", async () => {
      await createTestProject(tempDir);
      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toMatch(/Offline mode|offline/i);
    });
  });

  // C8-D12-M2 (D12): --dry-run flag on update
  describe("--dry-run flag", () => {
    it("does not regenerate canonical content when --dry-run is set", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ dryRun: true });

      // Dry-run should never touch the package fetch path.
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });

    it("does not overwrite adapter outputs when --dry-run is set", async () => {
      await createTestProject(tempDir);

      // Seed an adapter output that would ordinarily be overwritten so we can
      // detect a destructive write.
      const adapterOutputPath = join(tempDir, ".cursor", "rules", "hatch3r-test.mdc");
      await mkdir(join(tempDir, ".cursor", "rules"), { recursive: true });
      await writeFile(adapterOutputPath, "SENTINEL CONTENT — must survive dry-run");

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ dryRun: true });

      const after = await readFile(adapterOutputPath, "utf-8");
      expect(after).toBe("SENTINEL CONTENT — must survive dry-run");
    });

    it("prints a dry-run summary box", async () => {
      await createTestProject(tempDir);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ dryRun: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toMatch(/dry run|dry-run/i);
    });

    it("exposes runUpdateDryRun as a standalone helper", async () => {
      const mod = await import("../../cli/commands/update.js");
      expect(typeof mod.runUpdateDryRun).toBe("function");
    });

    it("runUpdateDryRun returns a structured changeset", async () => {
      await createTestProject(tempDir);

      const { runUpdateDryRun } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const result = await runUpdateDryRun(tempDir, manifest!);
      expect(result.canonicalCandidates.length).toBeGreaterThan(0);
      expect(result.adapterChanges.size).toBe(manifest!.tools.length);
    });
  });

  // C8-D8-M1 (D8): aggregated recovery guidance on thrown HatchError
  describe("aggregated recovery guidance", () => {
    it("HatchError thrown on all-adapter failure carries a recovery hint", async () => {
      await createTestProject(tempDir, { tools: ["cursor"] });

      // Force every adapter invocation to return completed:false so the
      // adapter loop's catch block populates adapterFailures for every tool
      // and the terminal "All adapters failed" branch fires with our new
      // aggregated guidance.
      const adapterTimeoutMod = await import("../../pipeline/adapterTimeout.js");
      const spy = vi.spyOn(adapterTimeoutMod, "generateWithTimeout").mockResolvedValue({
        tool: "cursor",
        completed: false,
        elapsedMs: 10,
        error: "invalid config: missing required field",
        warnings: [],
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      try {
        await updateCommand({});
        expect.fail("expected updateCommand to throw HatchError");
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
