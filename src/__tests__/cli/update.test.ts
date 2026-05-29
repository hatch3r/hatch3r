import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { _resetNpmGlobalRootCacheForTesting } from "../../detect/installContext.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(), spawnSync: vi.fn() };
});

// Wave 7 (1.9.0) rewrite contract for `update`:
//   - Manifest lives at `.hatch3r/hatch.json` (Wave 6 relocation).
//   - Canonical content is sourced from the bundled npm package — no
//     `.agents/` materialisation, no per-rule recopy step. `runRegenerate`
//     only regenerates adapter outputs.
//   - Integrity-manifest subsystem deleted in Wave 7 — no preflight,
//     no `.integrity.json`, no `--force` carve-out for drift.
//   - The "orphan file scan" used to walk `.agents/<canonical-subdir>/`;
//     that subtree no longer exists in user repos. The scan is retired.
//
// Removed tests (Wave 7 cleanup):
//   - "should copy hatch3r-prefixed files from pack" (no .agents/ copy)
//   - "should preserve custom (non-hatch3r-prefixed) files" (ditto)
//   - "should update canonical files for multiple tools" (output message
//     changed; replaced by an adapter-regeneration assertion)
//   - integrity preflight describe block (subsystem deleted)
//   - C9-M26 orphan-file scan describe block (scan retired in user repos)

async function createTestProject(
  root: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const hatch3rDir = join(root, HATCH3R_DIR);
  await mkdir(hatch3rDir, { recursive: true });

  const manifest = {
    version: "3.0.0",
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
      handoffs: true,
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
  await writeFile(join(hatch3rDir, "hatch.json"), JSON.stringify(manifest, null, 2));
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
    // C8-D1-M5: CONFIG_ERROR -> EX_DATAERR (65) via central map.
    try { await updateCommand(); } catch (e) { expect((e as HatchError).exitCode).toBe(65); }

    // Wave 6: error message references the new manifest location.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain(".hatch3r/hatch.json");
  });

  it("should update hatch3rVersion in manifest", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const manifest = JSON.parse(
      await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
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

  it("does NOT materialise canonical content under .agents/ on update (Wave 3 removal)", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const stat = await import("node:fs/promises").then((m) => m.stat);
    let dotAgentsExists = false;
    try {
      await stat(join(tempDir, ".agents"));
      dotAgentsExists = true;
    } catch (err) {
      void err;
    }
    expect(dotAgentsExists).toBe(false);
  });

  it("should report update summary", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Update complete");
  });

  it("should note when already at latest version", async () => {
    await createTestProject(tempDir, { hatch3rVersion: HATCH3R_VERSION });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Already at");
  });

  it("should regenerate adapter outputs for multiple tools", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // Both tools' bridge files land on disk.
    const cursorBridge = await readFile(
      join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(cursorBridge).not.toBeNull();

    const claudeMd = await readFile(
      join(tempDir, "CLAUDE.md"),
      "utf-8",
    ).catch(() => null);
    expect(claudeMd).not.toBeNull();
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

    it("runRegenerate regenerates adapter outputs without touching the network", async () => {
      await createTestProject(tempDir);

      // Reset the execFileSync mock so prior tests in this file don't taint
      // the not-called assertion below.
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const result = await runRegenerate(tempDir, manifest!);
      // Wave 7: there is no canonical-file copy step. The contract reduces
      // to "no adapter failures + execFileSync never invoked (no network)".
      expect(result.failedTools).toBe(0);
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

  // F8.3.4 (D8): the regenerate adapter phase is wrapped in
  // `runWithPipelineDeadman` (parity with sync). A wall-clock breach surfaces
  // as a HatchError(exit 2), not a silent partial regenerate.
  describe("pipeline deadman (F8.3.4)", () => {
    it("surfaces a PipelineTimeoutError as a HatchError(exit 2)", async () => {
      await createTestProject(tempDir);
      const ptMod = await import("../../pipeline/pipelineTimeout.js");
      const { PipelineTimeoutError } = ptMod;
      const spy = vi
        .spyOn(ptMod, "runWithPipelineDeadman")
        .mockRejectedValue(new PipelineTimeoutError(900_000, 901_000));

      const { updateCommand } = await import("../../cli/commands/update.js");
      try {
        await updateCommand({ offline: true });
        expect.fail("expected updateCommand to throw on deadman breach");
      } catch (e) {
        const err = e as HatchError;
        expect(err).toBeInstanceOf(HatchError);
        expect(err.exitCode).toBe(2);
        expect(err.message).toMatch(/pipeline budget|aborted/i);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // F16.1-C1 (Decision 27): runRegenerate writes a checkpoint after each
  // mutation phase under `.update-workspace/checkpoint.json`.
  describe("resumability checkpoints (F16.1-C1)", () => {
    it("writes a `passed` checkpoint at .update-workspace/checkpoint.json after a successful regenerate", async () => {
      await createTestProject(tempDir);
      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true });

      const cpRaw = await readFile(join(tempDir, ".update-workspace", "checkpoint.json"), "utf-8");
      const cp = JSON.parse(cpRaw) as { phase: string; status: string; wave: number; meta: { baselineSha: string } };
      expect(cp.phase).toBe("update");
      expect(cp.status).toBe("passed");
      expect(cp.wave).toBe(2);
      expect(cp.meta.baselineSha).toBe(HATCH3R_VERSION);
    });
  });

  // F6.4-H1 (D6, OWASP ASI06): materialization-time learnings gate in the
  // regenerate write path (parity with sync).
  describe("learnings materialization gate (F6.4-H1)", () => {
    it("refuses to regenerate when a learning file exceeds the byte limit (no --force)", async () => {
      await createTestProject(tempDir);
      const learningsDir = join(tempDir, HATCH3R_DIR, "learnings");
      await mkdir(learningsDir, { recursive: true });
      await writeFile(join(learningsDir, "huge.md"), "x".repeat(70_000));

      const { updateCommand } = await import("../../cli/commands/update.js");
      await expect(updateCommand({ offline: true })).rejects.toThrow(HatchError);

      const output = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      expect(output).toMatch(/Learnings validation|byte limit/i);
    });

    it("allows the regenerate with --force despite invalid learnings", async () => {
      await createTestProject(tempDir);
      const learningsDir = join(tempDir, HATCH3R_DIR, "learnings");
      await mkdir(learningsDir, { recursive: true });
      await writeFile(join(learningsDir, "huge.md"), "x".repeat(70_000));

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, force: true });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Update complete");
    });
  });

  // D1-SA1.5-F10 (Cycle 10 Wave 4, D1, P6): every CLI command entry point that
  // reaches atomicWriteFile sweeps orphan `.tmp.<8-hex>` files at start-of-run.
  // This integration test fabricates an orphan from a prior interrupted session
  // and asserts a command-entry invocation reclaims it — the contract the
  // finding requires ("a deliberately-fabricated orphan from a prior session is
  // swept on next command entry regardless of which command runs").
  describe("orphan-tmp entry-point sweep (D1-SA1.5-F10)", () => {
    /**
     * Write a file that looks like a real orphan tmp (the exact `.tmp.<8-hex>`
     * suffix atomicWriteFile produces) and backdate its mtime past the 60s
     * orphan-age gate so the sweep treats it as abandoned.
     */
    async function fabricateOrphan(base: string, suffix = "deadbeef"): Promise<string> {
      const { writeFile: wf, utimes } = await import("node:fs/promises");
      const path = join(tempDir, `${base}.tmp.${suffix}`);
      await wf(path, "orphan content from a prior interrupted run", "utf-8");
      const past = new Date(Date.now() - 120_000);
      await utimes(path, past, past);
      return path;
    }

    async function exists(path: string): Promise<boolean> {
      const { access } = await import("node:fs/promises");
      return access(path).then(() => true).catch(() => false);
    }

    it("sweeps a fabricated prior-session orphan on update entry", async () => {
      await createTestProject(tempDir);
      const orphan = await fabricateOrphan("CLAUDE.md");
      expect(await exists(orphan)).toBe(true);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, force: true });

      // The entry-point sweep reclaimed the orphan from the prior run.
      expect(await exists(orphan)).toBe(false);
    });

    it("does NOT sweep a fresh (in-flight) tmp file younger than the age gate", async () => {
      await createTestProject(tempDir);
      // No backdate: mtime is "now", well under the 60s in-flight-write floor.
      const { writeFile: wf } = await import("node:fs/promises");
      const fresh = join(tempDir, "live.md.tmp.abcd1234");
      await wf(fresh, "in-flight write from a concurrent worker", "utf-8");

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, force: true });

      // A live atomicWriteFile on another worker is never swept out from under it.
      expect(await exists(fresh)).toBe(true);
    });

    it("skips the sweep under --dry-run (which promises no writes)", async () => {
      await createTestProject(tempDir);
      const orphan = await fabricateOrphan("AGENTS.md", "0badf00d");
      expect(await exists(orphan)).toBe(true);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ offline: true, dryRun: true });

      // --dry-run must not mutate the filesystem, including the orphan sweep.
      expect(await exists(orphan)).toBe(true);
    });
  });
});
