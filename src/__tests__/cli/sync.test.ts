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
    // Wave B3: rule outputs now carry a `NN-` precedence prefix. The fixture
    // rule declares no `precedence:` frontmatter, so it falls into the
    // default `normal` bucket (rank 500, rendered as `50-`).
    const rulesContent = await readFile(
      join(cursorRulesDir, "50-hatch3r-test.mdc"),
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

  // Task #11: orphan adapter-output cleanup on sync. Verifies that files
  // previously written by hatch3r but no longer emitted by the current
  // adapter set are unlinked, and that the manifest's
  // `managedFilesByAdapter` history is maintained across runs.
  describe("orphan adapter-output cleanup", () => {
    it("unlinks a pre-B3 hatch3r-*.mdc after sync emits NN-hatch3r-*.mdc", async () => {
      await createTestProject(tempDir);

      // Seed the manifest with a prior path the current sync will NOT
      // re-emit (the pre-B3 filename shape). Also physically place the
      // orphan file so the cleanup has something to unlink.
      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      (manifest.managedFilesByAdapter as Record<string, string[]> | undefined) = {
        cursor: [".cursor/rules/hatch3r-test.mdc"],
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });
      const orphanPath = join(cursorRulesDir, "hatch3r-test.mdc");
      await writeFile(orphanPath, "# pre-B3 stray file\n");

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Old file should be gone.
      const stillThere = await readFile(orphanPath, "utf-8").catch(() => null);
      expect(stillThere).toBeNull();

      // New file should exist (the canonical B3 path with `50-` prefix).
      const newFile = await readFile(
        join(cursorRulesDir, "50-hatch3r-test.mdc"),
        "utf-8",
      ).catch(() => null);
      expect(newFile).not.toBeNull();

      // Manifest should record the new path under managedFilesByAdapter.cursor.
      const updatedManifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
        managedFilesByAdapter?: Record<string, string[]>;
      };
      expect(updatedManifest.managedFilesByAdapter?.cursor).toBeDefined();
      expect(updatedManifest.managedFilesByAdapter!.cursor).toContain(
        ".cursor/rules/50-hatch3r-test.mdc",
      );
      expect(updatedManifest.managedFilesByAdapter!.cursor).not.toContain(
        ".cursor/rules/hatch3r-test.mdc",
      );
    });

    it("no-op when the manifest has no managedFilesByAdapter history (first run)", async () => {
      await createTestProject(tempDir);
      // Seed a file that would be an orphan IF there were any history.
      // Without history, the cleanup should not touch it.
      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });
      const foreignPath = join(cursorRulesDir, "hatch3r-untracked.mdc");
      await writeFile(foreignPath, "# not in manifest history\n");

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Untracked file remains — no history means no inferred orphans.
      const stillThere = await readFile(foreignPath, "utf-8").catch(() => null);
      expect(stillThere).not.toBeNull();
    });

    it("does NOT unlink a file the user has wrapped with custom content outside the managed block", async () => {
      await createTestProject(tempDir);

      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      (manifest.managedFilesByAdapter as Record<string, string[]> | undefined) = {
        cursor: [".cursor/rules/hatch3r-edited.mdc"],
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });
      const editedPath = join(cursorRulesDir, "hatch3r-edited.mdc");
      // User has customised the file — surrounding text outside the managed block.
      const userContent =
        "# My team preamble (keep this)\n\n" +
        "<!-- HATCH3R:BEGIN -->\n# managed rule body\n<!-- HATCH3R:END -->\n\n" +
        "# My team footer (keep this)\n";
      await writeFile(editedPath, userContent);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // File remains untouched because it contains user content.
      const preserved = await readFile(editedPath, "utf-8");
      expect(preserved).toBe(userContent);
    });

    it("refuses to unlink a manifest-claimed path outside any known adapter output root", async () => {
      await createTestProject(tempDir);

      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      // Tampered manifest: claims ownership of a path under src/.
      (manifest.managedFilesByAdapter as Record<string, string[]> | undefined) = {
        cursor: ["src/hatch3r-evil.md"],
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Plant the file so if the defense is broken we see the loss.
      await mkdir(join(tempDir, "src"), { recursive: true });
      const foreignPath = join(tempDir, "src", "hatch3r-evil.md");
      await writeFile(foreignPath, "# not an adapter output\n");

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // File remains — root-containment filter rejected the unlink.
      const stillThere = await readFile(foreignPath, "utf-8").catch(() => null);
      expect(stillThere).not.toBeNull();
    });

    it("preserves managedFilesByAdapter entries for adapters not part of this sync", async () => {
      await createTestProject(tempDir, { tools: ["cursor"] });

      const manifestPath = join(tempDir, AGENTS_DIR, "hatch.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
      // Simulate a prior sync that also recorded a windsurf entry which the
      // current run does NOT re-generate (tool removed from manifest.tools).
      (manifest.managedFilesByAdapter as Record<string, string[]> | undefined) = {
        windsurf: [".windsurf/rules/50-hatch3r-test.md"],
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const updatedManifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
        managedFilesByAdapter?: Record<string, string[]>;
      };
      // windsurf entry preserved — we did not run windsurf this sync so we
      // cannot claim its history is stale.
      expect(updatedManifest.managedFilesByAdapter?.windsurf).toEqual([
        ".windsurf/rules/50-hatch3r-test.md",
      ]);
      // cursor entry populated from this run.
      expect(updatedManifest.managedFilesByAdapter?.cursor).toBeDefined();
      expect(updatedManifest.managedFilesByAdapter!.cursor.length).toBeGreaterThan(0);
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

  // C9-M26 (D11-SA11.4-01): orphan-file scan reports + optionally removes
  // files in `.agents/<canonical-subdir>/` that do not match the canonical
  // naming convention (`hatch3r-` prefix / `hatch3r-*/` parent / `mcp.json`).
  describe("orphan-file scan (C9-M26)", () => {
    it("reports orphan files in canonical subdirs as informational only by default", async () => {
      await createTestProject(tempDir);

      // Seed two orphan files in canonical subdirs.
      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "# stray\n",
      );
      await writeFile(
        join(tempDir, AGENTS_DIR, "commands", "scratch.md"),
        "# scratch\n",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const combined = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      expect(combined).toMatch(/orphan file/);
      expect(combined).toContain(".agents/agents/stray-note.md");
      expect(combined).toContain(".agents/commands/scratch.md");
      expect(combined).toContain("--clean-orphans");

      // Default mode: files MUST still be on disk.
      const stray1 = await readFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "utf-8",
      ).catch(() => null);
      const stray2 = await readFile(
        join(tempDir, AGENTS_DIR, "commands", "scratch.md"),
        "utf-8",
      ).catch(() => null);
      expect(stray1).not.toBeNull();
      expect(stray2).not.toBeNull();
    });

    it("removes orphans when --clean-orphans is set", async () => {
      await createTestProject(tempDir);

      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "# stray\n",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand({ cleanOrphans: true });

      // Orphan must be unlinked.
      const stray = await readFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "utf-8",
      ).catch(() => null);
      expect(stray).toBeNull();

      // hatch3r- canonical fixture is preserved.
      const canonical = await readFile(
        join(tempDir, AGENTS_DIR, "rules", "hatch3r-test.md"),
        "utf-8",
      ).catch(() => null);
      expect(canonical).not.toBeNull();
    });

    it("never flags files under .agents/user/ even when --clean-orphans is set", async () => {
      await createTestProject(tempDir);

      // Seed user content with NO hatch3r- prefix — must NOT be flagged.
      const userDir = join(tempDir, AGENTS_DIR, "user", "agents");
      await mkdir(userDir, { recursive: true });
      const userPath = join(userDir, "my-agent.md");
      await writeFile(userPath, "# user agent\n");

      // Also seed a real orphan to verify the scan still runs.
      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "stray.md"),
        "# stray\n",
      );

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand({ cleanOrphans: true });

      const userStill = await readFile(userPath, "utf-8").catch(() => null);
      expect(userStill).not.toBeNull();
      const strayGone = await readFile(
        join(tempDir, AGENTS_DIR, "agents", "stray.md"),
        "utf-8",
      ).catch(() => null);
      expect(strayGone).toBeNull();
    });

    it("never flags files inside a hatch3r-* parent directory (skill dirs)", async () => {
      await createTestProject(tempDir);

      // Seed a fake skill directory with an inner SKILL.md (no hatch3r- prefix
      // on the file itself). The hatch3r- parent dir marks it canonical.
      const skillDir = join(tempDir, AGENTS_DIR, "skills", "hatch3r-fake-skill");
      await mkdir(skillDir, { recursive: true });
      const skillFile = join(skillDir, "SKILL.md");
      await writeFile(skillFile, "# fake skill\n");

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand({ cleanOrphans: true });

      const stillThere = await readFile(skillFile, "utf-8").catch(() => null);
      expect(stillThere).not.toBeNull();
    });
  });
});
