import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";

// Wave 6 + Wave 7 rewrite (1.9.0):
//   - manifest moved from `.agents/hatch.json` to `.hatch3r/hatch.json`.
//   - status pivots to `computeAdapterDrift` (in-memory regeneration vs.
//     on-disk adapter outputs). The integrity-manifest "fast path" /
//     `--deep` flag / partial-sync indicator / codex `AGENTS.override.md`
//     warning are all gone.
//   - tests build `.hatch3r/hatch.json` fixtures and rely on the real
//     `syncCommand` to write adapter outputs, then exercise the drift
//     branches by mutating those outputs after the fact.

async function createTestProject(root: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const hatch3rDir = join(root, HATCH3R_DIR);
  await mkdir(hatch3rDir, { recursive: true });

  const manifest = {
    version: "3.0.0",
    hatch3rVersion: "1.9.0",
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
    managedFiles: [],
    ...overrides,
  };
  await writeFile(join(hatch3rDir, "hatch.json"), JSON.stringify(manifest, null, 2));
}

describe("status command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-status-"));
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
    // Hardened teardown (matches lifecycle/sync/config/update tests): under the
    // full-suite `forks` pool, /tmp is saturated with thousands of concurrent
    // temp dirs; a bare rm of this test's own root can hit a transient FS race
    // (ENOTEMPTY/ENOENT mid-walk). maxRetries+retryDelay absorbs it so cleanup
    // of one test never fails the suite.
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it("should exit with error when no manifest exists", async () => {
    const { statusCommand } = await import("../../cli/commands/status.js");

    await expect(statusCommand()).rejects.toThrow(HatchError);
    // C8-D1-M5: CONFIG_ERROR resolves through ERROR_CODE_TO_EXIT_CODE to
    // sysexits.h EX_DATAERR (65) — the legacy `1` is no longer hand-picked.
    try { await statusCommand(); } catch (e) { expect((e as HatchError).exitCode).toBe(65); }

    // Error message references the new manifest location.
    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain(".hatch3r/hatch.json");
  });

  it("should report synced when all generated files match", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("In sync:");
    expect(output).toContain("Status");
  });

  // D10-17 (D10, P1): status is the reporting surface that reads the SPACE
  // telemetry JSONL written by `init.ts::recordFirstRunSuccess`. Seeding a
  // firstRunSuccessRate record and asserting the "Developer productivity
  // (SPACE)" box renders proves the read path is wired (not a dead module).
  it("renders the SPACE developer-productivity box from persisted telemetry", async () => {
    await createTestProject(tempDir);

    // Seed two success + one failure firstRunSuccessRate records for today.
    const today = new Date().toISOString().slice(0, 10);
    const telemetryDir = join(tempDir, HATCH3R_DIR, "telemetry");
    await mkdir(telemetryDir, { recursive: true });
    const ts = `${today}T12:00:00.000Z`;
    const lines = [
      { metricId: "firstRunSuccessRate", axis: "performance", value: 1, timestamp: ts, source: "hatch3r-init" },
      { metricId: "firstRunSuccessRate", axis: "performance", value: 1, timestamp: ts, source: "hatch3r-init" },
      { metricId: "firstRunSuccessRate", axis: "performance", value: 0, timestamp: ts, source: "hatch3r-init" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    await writeFile(join(telemetryDir, `space-${today}.jsonl`), lines + "\n");

    consoleSpy.mockClear();
    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Developer productivity (SPACE)");
    // 2 of 3 success -> 67% first-run success, 3 runs.
    expect(output).toContain("First-run success");
    expect(output).toContain("67%");
    expect(output).toContain("3 runs");
  });

  it("omits the SPACE box when no telemetry exists", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();
    consoleSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("Developer productivity (SPACE)");
  });

  it("emits spaceTelemetry in the --json payload", async () => {
    await createTestProject(tempDir);

    const today = new Date().toISOString().slice(0, 10);
    const telemetryDir = join(tempDir, HATCH3R_DIR, "telemetry");
    await mkdir(telemetryDir, { recursive: true });
    const ts = `${today}T12:00:00.000Z`;
    await writeFile(
      join(telemetryDir, `space-${today}.jsonl`),
      JSON.stringify({ metricId: "firstRunSuccessRate", axis: "performance", value: 1, timestamp: ts }) + "\n",
    );

    // emitJson writes via process.stdout.write, not console.log — spy on it.
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);

    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }

    const combined = stdoutChunks.join("");
    const start = combined.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(combined.slice(start).trim()) as {
      spaceTelemetry: { recordCount: number; firstRunSuccessRate: number | null };
    };
    expect(payload.spaceTelemetry.recordCount).toBe(1);
    expect(payload.spaceTelemetry.firstRunSuccessRate).toBe(1);
  });

  // D12-SA12.2-01 (D12, CQ2): status now reports the manifest's CONFIGURED
  // hatch3r version alongside the RUNNING CLI version, so an operator can tell
  // "these files drifted because I upgraded" from managed-block corruption.
  it("emits an installation block with configured-vs-running versions and a skew flag in --json (D12-SA12.2-01)", async () => {
    // createTestProject pins hatch3rVersion "1.9.0"; the running CLI differs, so
    // versionSkew must be true.
    await createTestProject(tempDir);

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }

    const combined = stdoutChunks.join("");
    const payload = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      installation: {
        configuredVersion: string;
        runningVersion: string;
        manifestVersion: string;
        tools: string[];
        versionSkew: boolean;
      };
    };
    expect(payload.installation.configuredVersion).toBe("1.9.0");
    expect(payload.installation.runningVersion).toBe(HATCH3R_VERSION);
    expect(payload.installation.manifestVersion).toBe("3.0.0");
    expect(payload.installation.tools).toEqual(["cursor"]);
    expect(payload.installation.versionSkew).toBe(true);
  });

  it("renders the Installation box with a version-skew note in human mode (D12-SA12.2-01)", async () => {
    await createTestProject(tempDir);
    consoleSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Installation");
    expect(output).toContain("Configured");
    expect(output).toContain("hatch3r v1.9.0");
    // The skew note names the upgrade as the expected cause of the drift.
    expect(output).toContain("configured; CLI is");
  });

  // D1-SA1.4-04 (D1, P1): the boolean `versionSkew` above says only WHETHER the
  // versions differ, not WHICH WAY. Status now also exposes the DIRECTION so a CI
  // consumer can tell a normal upgrade (installed-newer) from an installed-older
  // DOWNGRADE hazard where `sync` would regress the on-disk output.
  it("exposes versionSkewDirection installed-newer in --json when the CLI is newer than the writer (D1-SA1.4-04)", async () => {
    // The fixture pins writer 1.9.0; the running CLI is newer.
    await createTestProject(tempDir);
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const payload = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      installation: { versionSkew: boolean; versionSkewDirection: string };
    };
    expect(payload.installation.versionSkew).toBe(true);
    expect(payload.installation.versionSkewDirection).toBe("installed-newer");
  });

  it("exposes versionSkewDirection installed-older in --json when the CLI is older than the writer (D1-SA1.4-04)", async () => {
    // Force the writer version ABOVE any real CLI version → installed-older.
    await createTestProject(tempDir, { hatch3rVersion: "99.0.0" });
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const payload = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      installation: { versionSkewDirection: string };
    };
    expect(payload.installation.versionSkewDirection).toBe("installed-older");
  });

  it("flips the human Installation note to an update-first downgrade warning when installed-older (D1-SA1.4-04)", async () => {
    await createTestProject(tempDir, { hatch3rVersion: "99.0.0" });
    consoleSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // installed-older names the downgrade risk and points at `update`, NOT the
    // upgrade-framed "Run hatch3r sync to regenerate". The hint renders inside the
    // Installation printBox (ui.ts → boxen, borderStyle "round", no explicit
    // width), so on a non-TTY stdout boxen wraps the ~165-char sentence at its
    // ~80-col default — splitting "generated" | "these files" across box lines.
    // Strip the round-border box characters and collapse the wrap whitespace so
    // the assertion tests the SENTENCE, not the terminal-width-dependent wrap
    // (D1-SA1.4-04).
    const flat = output.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ");
    expect(flat).toContain("is older than the version that generated these files");
    expect(flat).toContain("hatch3r update");
    expect(output).not.toContain("canonical drift is expected from the upgrade");
  });

  // D10-SA10.2-02 (D10, P1): every status JSON document is now self-identifying
  // (carries `command`) and exposes a normalized `outcome` for a CI branch check
  // alongside the domain-specific `status`.
  it("emits command:status and a normalized outcome in the --json payload (D10-SA10.2-02)", async () => {
    await createTestProject(tempDir);
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }

    const combined = stdoutChunks.join("");
    const payload = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      command: string;
      status: string;
      outcome: string;
    };
    expect(payload.command).toBe("status");
    // Domain status is preserved (not renamed); a clean sync is in-sync → passed.
    expect(payload.status).toBe("in-sync");
    expect(payload.outcome).toBe("passed");
  });

  // D10-SA10.8-01 (D10, P5): the SPACE surface now feeds >1 axis. Seeding an
  // efficiency record proves status surfaces the newly-fed non-performance axis
  // via its per-axis rollup (not only firstRunSuccessRate).
  it("surfaces a non-performance SPACE axis (efficiency) in the --json rollup (D10-SA10.8-01)", async () => {
    await createTestProject(tempDir);

    const today = new Date().toISOString().slice(0, 10);
    const telemetryDir = join(tempDir, HATCH3R_DIR, "telemetry");
    await mkdir(telemetryDir, { recursive: true });
    const ts = `${today}T12:00:00.000Z`;
    await writeFile(
      join(telemetryDir, `space-${today}.jsonl`),
      JSON.stringify({ metricId: "timeToFirstValueMs", axis: "efficiency", value: 1234, timestamp: ts, source: "hatch3r-init" }) + "\n",
    );

    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      const { statusCommand } = await import("../../cli/commands/status.js");
      await statusCommand({ format: "json" });
    } finally {
      stdoutSpy.mockRestore();
    }

    const combined = stdoutChunks.join("");
    const payload = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      spaceTelemetry: { axes: { axis: string; count: number; mean: number }[] };
    };
    const efficiency = payload.spaceTelemetry.axes.find((a) => a.axis === "efficiency");
    expect(efficiency).toBeDefined();
    expect(efficiency?.count).toBe(1);
    expect(efficiency?.mean).toBe(1234);
  });

  it("should report drifted when a generated file differs", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await writeFile(join(cursorRulesDir, ruleFile!), "modified drift content");

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("drifted");
    expect(output).toContain("Drifted:");
    // F2.7-F5 (Cycle 10 Wave 2, partial): the drifted hint must warn that sync
    // overwrites the managed block, since status cannot yet attribute drift
    // direction (user edit vs. outdated canonical) without an emit-time baseline.
    expect(output).toContain("sync overwrites the managed block");
  });

  it("should report missing when a generated file is deleted", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("missing");
    expect(output).toContain("Missing:");
  });

  it("should check all configured tools", async () => {
    await createTestProject(tempDir, { tools: ["cursor", "claude"] });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("cursor:");
    expect(output).toContain("claude:");
  });

  it("should display correct summary counts", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Status");
    expect(output).toContain("In sync:");
  });

  it("should handle empty tools list gracefully", async () => {
    await createTestProject(tempDir, { tools: [] });

    const { statusCommand } = await import("../../cli/commands/status.js");
    await statusCommand();

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Status");
  });

  // Wave 7: `computeAdapterDrift` is the single source of truth for both
  // `status` and `verify`. Exercise the helper directly so the contract
  // is locked at the function level too.
  describe("computeAdapterDrift helper", () => {
    it("classifies in-sync vs. modified vs. missing per file", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const { computeAdapterDrift } = await import("../../cli/commands/status.js");

      // Sanity: the report yields a synced bucket and at least one entry.
      const beforeMutation = await computeAdapterDrift(tempDir, manifest!);
      expect(beforeMutation.counts.synced).toBeGreaterThan(0);
      expect(beforeMutation.entries.length).toBeGreaterThan(0);

      // Delete a tracked cursor rule and verify it is reported as "missing".
      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      const entries = await readdir(cursorRulesDir);
      const ruleFile = entries.find((f) => f.endsWith(".mdc"));
      expect(ruleFile).toBeDefined();
      // `e.path` is the adapter's POSIX-separator output path (always `/`), so
      // the comparison target must be POSIX too — `join` would emit `\` on
      // Windows and never match (`posix.join` keeps `/` on every OS).
      const targetPath = posix.join(".cursor", "rules", ruleFile!);
      await rm(join(cursorRulesDir, ruleFile!));

      const afterDelete = await computeAdapterDrift(tempDir, manifest!);
      const matching = afterDelete.entries.find(
        (e) => e.path.endsWith(ruleFile!) || e.path === targetPath,
      );
      expect(matching).toBeDefined();
      expect(matching!.status).toBe("missing");
      expect(afterDelete.counts.missing).toBeGreaterThanOrEqual(1);
    });
  });

  // D14-1 (Cycle 11 Wave 1, Critical): monorepo per-package outputs must not be
  // reported as `unexpected` orphans. init/sync write each adapter output into
  // every `<package>/.hatch3r/<rel>` and stamp those paths into
  // `manifest.managedFiles`; before the fix `computeAdapterDrift` only added the
  // root `adapter.generate()` paths to `seenPaths`, so the orphan loop flagged
  // every per-package copy as `unexpected` — ~(root-output-count x N) false
  // orphans for an N-package x M-adapter repo on every status/verify call.
  // Test-robustness (not a logic change): this is the heaviest test in the file
  // — a real sync of 2 adapters x 2 monorepo packages emits the largest batch of
  // tmp+rename atomic writes (root + per-package x per-adapter). It used to flake
  // under the full-suite parallel `forks` pool when its FS batch raced the rest
  // of the suite's concurrent fork-worker filesystem churn (a just-created
  // parent dir intermittently invisible to a following mkdir/rename/open — a
  // contention ENOENT, NOT a product bug; it passes 22/22 in isolation). The fix
  // is in vitest.config.ts: status.test.ts + verify.test.ts run in a separate
  // "heavy-fs" project at a later sequence.groupOrder, so they execute ALONE
  // after the parallel "main" group drains — no concurrent FS churn. The prior
  // per-test `retry` is gone (the contention it papered over no longer occurs);
  // `timeout` stays as a margin for the genuinely-large FS batch. Assertions
  // (0 false orphans / in-sync) are unchanged.
  describe("monorepo per-package drift (D14-1)", { timeout: 30_000 }, () => {
    it("reports a 2-package monorepo in-sync with 0 false orphans", async () => {
      // Two-package workspace fixture. The package directories do not need to
      // pre-exist — sync's safeWriteFile creates `<package>/...` parents
      // recursively. Configure cursor (emits per-package copies per D14-6) plus
      // claude (root-only, no per-package copies) so the orphan loop is
      // exercised against a mixed adapter set, not a single-adapter corner case.
      await createTestProject(tempDir, {
        tools: ["cursor", "claude"],
        packages: [
          { name: "@scope/alpha", path: "packages/alpha" },
          { name: "@scope/beta", path: "packages/beta" },
        ],
      });

      // Real sync writes the root outputs AND the per-package copies, and
      // persists every emitted path into manifest.managedFiles.
      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      // Sanity guard: the fixture actually produced per-package managed files.
      // Without this, a regression that stops emitting per-package outputs
      // could make the 0-orphan assertion below pass vacuously.
      const perPackageTracked = (manifest!.managedFiles ?? []).filter(
        (p) => p.startsWith("packages/alpha/") || p.startsWith("packages/beta/"),
      );
      expect(perPackageTracked.length).toBeGreaterThan(0);
      // And they are on disk (so the pre-fix `access()` orphan probe would have
      // resolved and classified each as `unexpected`).
      const { access } = await import("node:fs/promises");
      await expect(access(join(tempDir, perPackageTracked[0]))).resolves.toBeUndefined();

      const { computeAdapterDrift } = await import("../../cli/commands/status.js");
      const report = await computeAdapterDrift(tempDir, manifest!);

      // Core assertion: zero per-package files are misclassified as orphans.
      expect(report.counts.unexpected).toBe(0);
      const unexpectedEntries = report.entries.filter((e) => e.status === "unexpected");
      expect(unexpectedEntries).toEqual([]);
      // Each per-package file the manifest tracks must be accounted for as a
      // seen path (in-sync), never surfaced as an orphan entry.
      for (const tracked of perPackageTracked) {
        const orphan = report.entries.find(
          (e) => e.path === tracked && e.status === "unexpected",
        );
        expect(orphan).toBeUndefined();
      }
    });

    // D2-SA2.7-04 (D2, P2): per-package copies were seen-only — never
    // content-compared — so a hand-edited or deleted `<pkg>/.cursor/...` copy
    // drifted INVISIBLY (`verify` exited 0 while managed output had changed).
    // computeAdapterDrift now runs the identical per-file comparison on
    // per-package outputs, so `modified` and `missing` are reported for them.
    it("reports modified and missing for monorepo per-package cursor copies (D2-SA2.7-04)", async () => {
      await createTestProject(tempDir, {
        tools: ["cursor", "claude"],
        packages: [
          { name: "@scope/alpha", path: "packages/alpha" },
          { name: "@scope/beta", path: "packages/beta" },
        ],
      });

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      // Guard: per-package copies were emitted + tracked (else a vacuous pass).
      const perPackageTracked = (manifest!.managedFiles ?? []).filter((p) =>
        p.startsWith("packages/alpha/"),
      );
      expect(perPackageTracked.length).toBeGreaterThan(0);

      const { computeAdapterDrift } = await import("../../cli/commands/status.js");

      // Fresh sync → per-package copies are verbatim mirrors → no drift.
      const clean = await computeAdapterDrift(tempDir, manifest!);
      expect(clean.counts.modified).toBe(0);
      expect(clean.counts.missing).toBe(0);

      // Modify one alpha per-package copy and delete one beta per-package copy.
      const alphaRulesDir = join(tempDir, "packages", "alpha", ".cursor", "rules");
      const alphaRule = (await readdir(alphaRulesDir)).find((f) => f.endsWith(".mdc"));
      expect(alphaRule).toBeDefined();
      const alphaModifiedPath = posix.join("packages", "alpha", ".cursor", "rules", alphaRule!);
      await writeFile(join(alphaRulesDir, alphaRule!), "hand-edited per-package drift");

      const betaRulesDir = join(tempDir, "packages", "beta", ".cursor", "rules");
      const betaRule = (await readdir(betaRulesDir)).find((f) => f.endsWith(".mdc"));
      expect(betaRule).toBeDefined();
      const betaMissingPath = posix.join("packages", "beta", ".cursor", "rules", betaRule!);
      await rm(join(betaRulesDir, betaRule!));

      const report = await computeAdapterDrift(tempDir, manifest!);
      const modifiedEntry = report.entries.find((e) => e.path === alphaModifiedPath);
      const missingEntry = report.entries.find((e) => e.path === betaMissingPath);
      expect(modifiedEntry?.status).toBe("modified");
      expect(missingEntry?.status).toBe("missing");
      // The edited/deleted copies stay "seen", so neither is mis-flagged as an
      // unexpected orphan (the F14.2-H1 suppression still holds).
      expect(
        report.entries.some(
          (e) => (e.path === alphaModifiedPath || e.path === betaMissingPath) && e.status === "unexpected",
        ),
      ).toBe(false);
    });
  });

  // D3-M13 (Cycle 10 Wave-3 Medium rollover): status.ts branches were 53.5%.
  // The JSON-mode emit path, the no-baseline-but-drifted attribution branch,
  // and the `unexpected` (manifest-tracked-but-not-emitted) path were not
  // covered by the prior `describe("status command")` block. Add tests so
  // every documented status branch has a falsifiable assertion.
  describe("status command — additional branches (D3-M13)", () => {
    it("emits a JSON document with status:drift when --format json and drift exists", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Introduce drift by editing a tracked file post-sync.
      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      const entries = await readdir(cursorRulesDir);
      const ruleFile = entries.find((f) => f.endsWith(".mdc"));
      expect(ruleFile).toBeDefined();
      await writeFile(join(cursorRulesDir, ruleFile!), "modified drift content");

      // emitJson writes via process.stdout.write, not console.log — spy on
      // it for this test (and restore after).
      const stdoutChunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((chunk: string | Uint8Array): boolean => {
          stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
          return true;
        }) as never);

      try {
        const { statusCommand } = await import("../../cli/commands/status.js");
        await statusCommand({ format: "json" });
      } finally {
        stdoutSpy.mockRestore();
      }

      // Find the one JSON document we emitted.
      const combined = stdoutChunks.join("");
      const start = combined.indexOf("{");
      expect(start).toBeGreaterThanOrEqual(0);
      const payload = JSON.parse(combined.slice(start).trim()) as {
        status: string;
        counts: { modified: number };
      };
      expect(payload.status).toBe("drift");
      expect(payload.counts.modified).toBeGreaterThanOrEqual(1);
    });

    it("emits status:failed with an errorCode when --format json and no manifest exists", async () => {
      const stdoutChunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(((chunk: string | Uint8Array): boolean => {
          stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
          return true;
        }) as never);

      try {
        const { statusCommand } = await import("../../cli/commands/status.js");
        // tempDir has no manifest yet — JSON mode must emit status:failed and throw.
        await expect(statusCommand({ format: "json" })).rejects.toThrow(HatchError);
      } finally {
        stdoutSpy.mockRestore();
      }

      const combined = stdoutChunks.join("");
      const start = combined.indexOf("{");
      expect(start).toBeGreaterThanOrEqual(0);
      const payload = JSON.parse(combined.slice(start).trim()) as {
        status: string;
        errorCode?: string;
      };
      expect(payload.status).toBe("failed");
      expect(payload.errorCode).toBe("CONFIG_ERROR");
    });

    it("classifies drift as `unknown` driftKind when no provenance baseline exists", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Remove the emit-time baseline so loadProvenanceBaseline returns an
      // empty Map and any drifted file falls through to `driftKind: unknown`.
      await rm(join(tempDir, HATCH3R_DIR, "provenance.json"), { force: true });

      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      const entries = await readdir(cursorRulesDir);
      const ruleFile = entries.find((f) => f.endsWith(".mdc"));
      expect(ruleFile).toBeDefined();
      await writeFile(join(cursorRulesDir, ruleFile!), "drift without baseline");

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      const { computeAdapterDrift } = await import("../../cli/commands/status.js");
      const report = await computeAdapterDrift(tempDir, manifest!);

      const drifted = report.entries.find((e) => e.status === "modified");
      expect(drifted).toBeDefined();
      expect(drifted!.driftKind).toBe("unknown");
      expect(report.driftKindCounts.unknown).toBeGreaterThanOrEqual(1);
    });

    // D12-5 (Cycle 11 Wave 2, High): `update` must advance the emit-time
    // drift-attribution baseline. Before D12-4 wired the shared `writeProvenance`
    // writer into `runRegenerate`, only `sync` wrote `provenance.json`, so the
    // baseline went stale after an `update` that changed on-disk content. A
    // subsequent single user edit was then scored `both` (on-disk != stale
    // baseline AND a fresh regeneration != stale baseline) instead of
    // `user-modified` — directly corrupting the "safe to sync vs back up first"
    // guidance (SA12.2-F2). This lifecycle test models the stale baseline by
    // corrupting one output's contentHash post-sync, proves the bug still
    // reproduces against that stale baseline (negative control: `both === 1`),
    // then runs `update` and asserts it refreshed the baseline so the same single
    // edit now scores `userModified === 1`, `both === 0`.
    it("advances the drift baseline on update so a later user edit scores user-modified, not both", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Pick a stable single-source per-rule output to drive the lifecycle on.
      const cursorRulesDir = join(tempDir, ".cursor", "rules");
      const ruleEntries = await readdir(cursorRulesDir);
      const ruleFile = ruleEntries.find((f) => f.endsWith(".mdc"));
      expect(ruleFile).toBeDefined();
      // `targetRel` is matched against POSIX-separator paths from both surfaces:
      // provenance `o.path` (written as the adapter's `/`-path) and drift entry
      // `e.path` (the same adapter output path). Build it with `posix.join` so it
      // stays `/`-based — a plain `join` emits `\` on Windows, the lookups miss,
      // and `staleEntry`/`staleDrifted` come back `undefined` (the reported
      // "undefined to be defined" Windows failure). `targetAbs` stays `join`
      // because it is a real on-disk path the test reads/writes.
      const targetRel = posix.join(".cursor", "rules", ruleFile!);
      const targetAbs = join(cursorRulesDir, ruleFile!);

      const provenancePath = join(tempDir, HATCH3R_DIR, "provenance.json");
      const { readFile: read, writeFile: write } = await import("node:fs/promises");

      // Corrupt this output's emit-time hash so the on-disk file no longer
      // matches the recorded baseline — the exact stale-baseline condition that
      // existed after an `update` before D12-4 advanced it.
      const staleManifest = JSON.parse(await read(provenancePath, "utf-8")) as {
        outputs: { path: string; contentHash?: string }[];
      };
      const staleEntry = staleManifest.outputs.find((o) => o.path === targetRel);
      expect(staleEntry).toBeDefined();
      staleEntry!.contentHash = "0".repeat(64); // sha256-shaped sentinel, never a real block hash
      await write(provenancePath, JSON.stringify(staleManifest, null, 2) + "\n");

      const { readManifest } = await import("../../manifest/hatchJson.js");
      const { computeAdapterDrift } = await import("../../cli/commands/status.js");

      // Negative control: with the stale baseline, a single user edit is
      // mis-scored `both` — the pre-fix pathology this finding targets.
      await write(targetAbs, "user hand edit (pre-update baseline is stale)");
      const stale = await computeAdapterDrift(tempDir, (await readManifest(tempDir))!);
      const staleDrifted = stale.entries.find((e) => e.path === targetRel);
      expect(staleDrifted?.driftKind).toBe("both");
      expect(stale.driftKindCounts.both).toBe(1);
      expect(stale.driftKindCounts.userModified).toBe(0);

      // Run `update` (network-free regenerate). D12-4's `writeProvenance(...,
      // "update", ...)` rewrites the baseline with the correct emit-time hash,
      // overwriting both the stale sentinel and the user's edit on disk.
      const { runRegenerate } = await import("../../cli/commands/update.js");
      const regen = await runRegenerate(tempDir, (await readManifest(tempDir))!);
      expect(regen.failedTools).toBe(0);

      // The refreshed manifest must record `lastCommand: "update"` and drop the
      // sentinel hash for the target output.
      const refreshed = JSON.parse(await read(provenancePath, "utf-8")) as {
        lastCommand: string;
        outputs: { path: string; contentHash?: string }[];
      };
      expect(refreshed.lastCommand).toBe("update");
      const refreshedEntry = refreshed.outputs.find((o) => o.path === targetRel);
      expect(refreshedEntry?.contentHash).not.toBe("0".repeat(64));

      // Now make exactly one user edit on top of the freshly-regenerated output.
      // Against the advanced baseline this is unambiguously `user-modified`.
      await write(targetAbs, "user hand edit (post-update baseline is fresh)");
      const fresh = await computeAdapterDrift(tempDir, (await readManifest(tempDir))!);
      const freshDrifted = fresh.entries.find((e) => e.path === targetRel);
      expect(freshDrifted?.status).toBe("modified");
      expect(freshDrifted?.driftKind).toBe("user-modified");
      expect(fresh.driftKindCounts.userModified).toBe(1);
      expect(fresh.driftKindCounts.both).toBe(0);
    });

    it("classifies a manifest-tracked-but-unowned file as `unexpected`", async () => {
      await createTestProject(tempDir);

      const { syncCommand } = await import("../../cli/commands/sync.js");
      await syncCommand();

      // Stamp an extra path into the manifest that no adapter emits, then
      // physically write the file so the `access()` probe inside the
      // `unexpected` branch resolves successfully.
      const manifestPath = join(tempDir, HATCH3R_DIR, "hatch.json");
      const { readManifest, writeManifest } = await import("../../manifest/hatchJson.js");
      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();
      manifest!.managedFiles.push(".legacy/stale-file.txt");
      await writeManifest(tempDir, manifest!);
      // re-read to be sure
      void manifestPath;
      const legacyDir = join(tempDir, ".legacy");
      const { mkdir: mk } = await import("node:fs/promises");
      await mk(legacyDir, { recursive: true });
      await writeFile(join(legacyDir, "stale-file.txt"), "leftover");

      const fresh = await readManifest(tempDir);
      const { computeAdapterDrift } = await import("../../cli/commands/status.js");
      const report = await computeAdapterDrift(tempDir, fresh!);
      const unexpected = report.entries.find((e) => e.status === "unexpected");
      expect(unexpected).toBeDefined();
      expect(unexpected!.path).toBe(".legacy/stale-file.txt");
      expect(report.counts.unexpected).toBeGreaterThanOrEqual(1);
    });
  });

  // Wave 7 removals:
  //   - "fast vs deep status paths" — fast path depended on the integrity
  //     manifest; both the manifest and the `--deep` flag are gone.
  //   - "AGENTS.override.md precedence warning" — the codex adapter that
  //     drove this warning was removed in Wave 1. There is no longer any
  //     emission path that fires this warning.
});
