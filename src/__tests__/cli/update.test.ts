import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { HatchError } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { _resetNpmGlobalRootCacheForTesting } from "../../detect/installContext.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(), spawnSync: vi.fn() };
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
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
      status: 0,
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);
    _resetNpmGlobalRootCacheForTesting();
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
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
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
    await createTestProject(tempDir, { hatch3rVersion: HATCH3R_VERSION });

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

  // Multi-install self-update + re-exec into the freshly installed binary.
  // The re-exec is what makes `hatch3r update` reliably refresh the CLI in
  // one shot instead of regenerating with stale module-cache code.
  describe("re-exec into freshly updated binary", () => {
    it("HATCH3R_RE_EXEC=1 short-circuits the self-update path (no re-exec, no second install)", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();
      vi.mocked(spawnSync).mockClear();
      const prevReExec = process.env.HATCH3R_RE_EXEC;
      process.env.HATCH3R_RE_EXEC = "1";
      try {
        const { updateCommand } = await import("../../cli/commands/update.js");
        // With HATCH3R_RE_EXEC set, the inner call MUST also pass --skip-fetch
        // (the parent always sets it). Mirror that here.
        await updateCommand({ skipFetch: true });
        expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
      } finally {
        if (prevReExec === undefined) delete process.env.HATCH3R_RE_EXEC;
        else process.env.HATCH3R_RE_EXEC = prevReExec;
      }
    });

    it("does NOT spawn a re-exec child when no install was actually updated", async () => {
      await createTestProject(tempDir);
      vi.mocked(spawnSync).mockClear();

      const { updateCommand } = await import("../../cli/commands/update.js");
      // In the test sandbox there is no node_modules/hatch3r and no detected
      // global install (npm root -g returns "" via the mock), so runSelfUpdate
      // skips dev-source, finds nothing else, and the regenerate phase runs
      // in-process without a re-exec.
      await updateCommand({});
      expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    });

    it("spawns a re-exec child with --skip-fetch + HATCH3R_RE_EXEC=1 when an install gets updated", async () => {
      await createTestProject(tempDir);

      // Seed a project-local install fixture so surveyInstalls finds a target.
      await mkdir(join(tempDir, "node_modules", "hatch3r"), { recursive: true });
      await writeFile(
        join(tempDir, "node_modules", "hatch3r", "package.json"),
        JSON.stringify({ name: "hatch3r", version: "1.0.0" }),
      );

      // Pretend the test runs from inside that install so it counts as
      // invokedFrom=project-local (otherwise dev-source skips and no update
      // happens).
      const prevArgv1 = process.argv[1];
      process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
      vi.mocked(spawnSync).mockClear();

      try {
        const { updateCommand } = await import("../../cli/commands/update.js");
        await expect(updateCommand({})).rejects.toThrow(/process.exit/);
        expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1);
        const [bin, args, opts] = vi.mocked(spawnSync).mock.calls[0]!;
        expect(typeof bin).toBe("string");
        expect(args).toEqual(expect.arrayContaining(["update", "--skip-fetch"]));
        const env = (opts as { env: Record<string, string> }).env;
        expect(env.HATCH3R_RE_EXEC).toBe("1");
      } finally {
        process.argv[1] = prevArgv1;
      }
    });
  });

  // C9-H51 (D15-SA15.4-F01): npm audit signatures programmatic verification
  // after every successful self-update fetch. Default behavior is to refuse
  // regenerate on signature failure; --skip-audit-signatures is an emergency
  // override that emits a visible warning.
  describe("npm audit signatures verification (C9-H51)", () => {
    /**
     * Seed an `invokedFrom=project-local` install so runSelfUpdate's
     * primary-target branch fires (and the audit gate runs). Without this,
     * runSelfUpdate classifies the invocation as `dev-source` and skips
     * the audit step entirely.
     */
    async function seedProjectLocalForUpdate(root: string): Promise<void> {
      await mkdir(join(root, "node_modules", "hatch3r"), { recursive: true });
      await writeFile(
        join(root, "node_modules", "hatch3r", "package.json"),
        JSON.stringify({ name: "hatch3r", version: "1.0.0" }),
      );
    }

    let prevArgv1: string;
    beforeEach(() => {
      prevArgv1 = process.argv[1] ?? "";
    });
    afterEach(() => {
      process.argv[1] = prevArgv1;
    });

    it("proceeds with regenerate when `npm audit signatures` reports OK", async () => {
      await createTestProject(tempDir);
      await seedProjectLocalForUpdate(tempDir);
      process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
      vi.mocked(execFileSync).mockClear();
      vi.mocked(spawnSync).mockClear();

      // Args-based mock: dispatch by the args array so the mock is robust
      // to extra npmGlobalRoot probes / cache-miss replays.
      vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
        const a = _args[1] as string[] | undefined;
        if (Array.isArray(a) && a[0] === "audit" && a[1] === "signatures") {
          return Buffer.from("audited 100 packages\nverified provenance: ok\n");
        }
        return Buffer.from("");
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      // updateCommand re-execs on success when an install was updated; the
      // spawnSync mock is set to status:0 in beforeEach, and process.exit is
      // mocked to throw. Catch and assert the audit step was invoked.
      try {
        await updateCommand({});
      } catch (e) {
        expect((e as Error).message).toMatch(/process\.exit|exit/i);
      }

      // Audit was invoked (at least once).
      const auditCalls = vi.mocked(execFileSync).mock.calls.filter((c) => {
        const args = c[1] as string[] | undefined;
        return Array.isArray(args) && args[0] === "audit" && args[1] === "signatures";
      });
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("throws HatchError(INTEGRITY_ERROR) and refuses regenerate when `npm audit signatures` fails", async () => {
      await createTestProject(tempDir);
      await seedProjectLocalForUpdate(tempDir);
      process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
      vi.mocked(execFileSync).mockClear();
      vi.mocked(spawnSync).mockClear();

      // Args-based mock: dispatch by args[0..1] so the audit call always
      // throws regardless of where it falls in execFileSync's call order.
      vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
        const a = _args[1] as string[] | undefined;
        if (Array.isArray(a) && a[0] === "audit" && a[1] === "signatures") {
          // audit signatures fails — simulate npm's typical failure output
          const err = new Error("npm audit signatures failed") as Error & {
            stderr?: string;
            status?: number;
          };
          err.stderr = "signatures: invalid for hatch3r@1.0.0\n";
          err.status = 1;
          throw err;
        }
        return Buffer.from("");
      });

      const { updateCommand } = await import("../../cli/commands/update.js");
      let thrown: unknown;
      try {
        await updateCommand({});
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HatchError);
      const err = thrown as HatchError;
      expect(err.errorCode).toBe("INTEGRITY_ERROR");
      expect(err.exitCode).toBe(1);
      expect(err.message).toMatch(/signatures? verification FAILED|npm audit signatures/i);
      // Verify regenerate was refused: spawnSync (the re-exec) must NOT have
      // been called — runSelfUpdate threw before reaching pickReExecBin.
      expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    });

    it("warns and proceeds when --skip-audit-signatures is passed", async () => {
      await createTestProject(tempDir);
      await seedProjectLocalForUpdate(tempDir);
      process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
      vi.mocked(execFileSync).mockClear();
      vi.mocked(spawnSync).mockClear();

      // No audit call should be made; all execFileSync calls succeed silently.
      vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
        return Buffer.from("");
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { updateCommand } = await import("../../cli/commands/update.js");
      try {
        await updateCommand({ skipAuditSignatures: true });
      } catch (e) {
        // re-exec branch throws via mocked process.exit; not the audit gate.
        expect((e as Error).message).toMatch(/process\.exit|exit/i);
      }

      // No audit signatures call was made.
      const auditCalls = vi.mocked(execFileSync).mock.calls.filter((c) => {
        const args = c[1] as string[] | undefined;
        return Array.isArray(args) && args[0] === "audit" && args[1] === "signatures";
      });
      expect(auditCalls.length).toBe(0);

      // A visible warning was emitted. The warn() helper routes via
      // chalk/console.warn; collect from both spies and the consoleSpy
      // (some ui.ts helpers route through console.log on certain platforms).
      const allOutput = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
        ...warnSpy.mock.calls.map((c) => String(c[0])),
      ].join(" ");
      expect(allOutput).toMatch(/skip.*audit.*signatures|SKIPPED|out-of-band/i);
      warnSpy.mockRestore();
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

  // C9-M26 (D11-SA11.4-01): orphan-file scan reports + optionally removes
  // files in `.agents/<canonical-subdir>/` that do not match the canonical
  // naming convention (`hatch3r-` prefix / `hatch3r-*/` parent / `mcp.json`).
  describe("orphan-file scan (C9-M26)", () => {
    it("reports orphan files in canonical subdirs as informational only by default", async () => {
      await createTestProject(tempDir);

      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "# stray\n",
      );
      await writeFile(
        join(tempDir, AGENTS_DIR, "commands", "scratch.md"),
        "# scratch\n",
      );

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true });

      const combined = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      expect(combined).toMatch(/orphan file/);
      expect(combined).toContain(".agents/agents/stray-note.md");
      expect(combined).toContain(".agents/commands/scratch.md");
      expect(combined).toContain("--clean-orphans");

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

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, cleanOrphans: true });

      const stray = await readFile(
        join(tempDir, AGENTS_DIR, "agents", "stray-note.md"),
        "utf-8",
      ).catch(() => null);
      expect(stray).toBeNull();
    });

    it("never flags files under .agents/user/ even when --clean-orphans is set", async () => {
      await createTestProject(tempDir);

      const userDir = join(tempDir, AGENTS_DIR, "user", "agents");
      await mkdir(userDir, { recursive: true });
      const userPath = join(userDir, "my-agent.md");
      await writeFile(userPath, "# user agent\n");

      await writeFile(
        join(tempDir, AGENTS_DIR, "agents", "stray.md"),
        "# stray\n",
      );

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, cleanOrphans: true });

      const userStill = await readFile(userPath, "utf-8").catch(() => null);
      expect(userStill).not.toBeNull();
      const strayGone = await readFile(
        join(tempDir, AGENTS_DIR, "agents", "stray.md"),
        "utf-8",
      ).catch(() => null);
      expect(strayGone).toBeNull();
    });
  });
});
