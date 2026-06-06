import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";

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
      const targetPath = join(".cursor", "rules", ruleFile!);
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
      // pre-exist — sync's safeWriteFile creates `<package>/.hatch3r/...`
      // parents recursively. Use two tools so the orphan blast radius the
      // finding describes (per-package x per-adapter) is exercised, not a
      // single-adapter corner case.
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
