import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import inquirer from "inquirer";
import { HatchError, HATCH3R_DIR } from "../../types.js";
import { HATCH3R_VERSION } from "../../version.js";
import { _resetNpmGlobalRootCacheForTesting } from "../../detect/installContext.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(), spawnSync: vi.fn() };
});

// D1-SA1.3-04: mock inquirer so the interactivity-gate tests can assert that the
// migration-checkpoint prompts are NEVER reached (beginCommand rejects json+no-yes
// first). Inert for every other test — the modern manifest createTestProject writes
// satisfies both checkpoint conditions, so no prompt fires there.
vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

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

  // W5-bigfour: the clean-update epilogue renders the printNextSteps ladder
  // after the summary box (preserved through the finishCommand adoption).
  it("clean update output contains the next-steps ladder", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Next steps:");
    expect(output).toContain("hatch3r status");
  });

  // W5-bigfour: `--quiet` (beginCommand → setQuiet) suppresses the banner,
  // summary box, and next-steps chrome while the update still regenerates.
  it("--quiet suppresses the banner, summary box, and next steps on stdout", async () => {
    await createTestProject(tempDir);

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false, quiet: true });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain("Update complete");
    expect(output).not.toContain("Next steps:");

    // The regenerate itself still ran — the manifest version advanced.
    const manifest = JSON.parse(
      await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8"),
    );
    expect(manifest.hatch3rVersion).toBe(HATCH3R_VERSION);
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

    // D1-4 (Cycle 11 Wave 2): rollback after a regenerate that ENABLES a new
    // adapter must delete that adapter's newly-created outputs (all-or-nothing
    // revert). Before the fix the snapshot enumerated only previously-recorded
    // managedFiles, so a freshly-added adapter's outputs had no tombstone and
    // survived rollback. The test starts cursor-only, regenerates with claude
    // added (CLAUDE.md is newly created), then rolls back and asserts CLAUDE.md
    // is gone.
    it("rollback after enabling a new adapter deletes its newly-created output", async () => {
      await createTestProject(tempDir, { tools: ["cursor"] });
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");
      const { applyRollback } = await import("../../pipeline/snapshot.js");

      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();
      // Enable claude as a brand-new adapter — its CLAUDE.md is not yet tracked
      // in manifest.managedFiles, so only the D1-4 pre-enumeration can tombstone it.
      manifest!.tools = ["cursor", "claude"];

      const claudeMdPath = join(tempDir, "CLAUDE.md");
      // Sanity: CLAUDE.md does not exist before the regenerate.
      await expect(readFile(claudeMdPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

      const result = await runRegenerate(tempDir, manifest!);
      expect(result.failedTools).toBe(0);
      expect(result.snapshotSessionId).toBeTruthy();
      // The new adapter's output now exists on disk.
      const created = await readFile(claudeMdPath, "utf-8");
      expect(created.length).toBeGreaterThan(0);

      // Roll the session back: the pre-enumerated would-be path was tombstoned,
      // so restoring deletes the newly-created CLAUDE.md.
      const rollback = await applyRollback(result.snapshotSessionId!, { projectRoot: tempDir });
      expect(rollback.errors).toEqual([]);
      await expect(readFile(claudeMdPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    // D2-7 (Cycle 11 Wave 2): when a caller (config tool-removal path) opens a
    // snapshot session and captures the to-be-deleted tool's files into it BEFORE
    // deletion, runRegenerate must accumulate its own paths into that SAME session
    // (reuseSessionId) rather than minting a fresh one — so the single advertised
    // rollback restores both the removed tool's bytes and the regenerated outputs.
    it("runRegenerate accumulates into a reused snapshot session (reuseSessionId)", async () => {
      await createTestProject(tempDir, { tools: ["cursor"] });
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");
      const { createSnapshot, sessionDir } = await import("../../pipeline/snapshot.js");

      // Caller pre-captures a removed-tool file into a config-<ts> session BEFORE
      // any deletion. Use a real file so a tombstone is not what we assert on.
      const removedFile = join(tempDir, "REMOVED.md");
      await writeFile(removedFile, "removed-tool original bytes\n");
      const sessionId = "config-2026-01-01T00-00-00-000Z";
      await createSnapshot(sessionId, [removedFile], { projectRoot: tempDir });

      const manifest = await readManifest(tempDir);
      expect(manifest).not.toBeNull();

      const result = await runRegenerate(tempDir, manifest!, {
        snapshotCommandName: "config",
        reuseSessionId: sessionId,
      });
      expect(result.failedTools).toBe(0);
      // The reused session id — not a freshly minted one — is surfaced back so the
      // caller's success summary advertises a single coherent rollback target.
      expect(result.snapshotSessionId).toBe(sessionId);

      // The session's meta now unions the pre-captured removed-tool path AND the
      // regenerate's own snapshot paths (hatch.json among them) — one session
      // restores everything.
      const metaRaw = await readFile(join(sessionDir(sessionId, tempDir), "meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw) as { paths: string[] };
      expect(meta.paths).toContain(removedFile);
      expect(meta.paths.some((p) => p.endsWith(join(HATCH3R_DIR, "hatch.json")))).toBe(true);
    });
  });

  // D10-SA10.4-01 / D10-SA10.4-02 (Cycle 12, D10, P1): marker recovery parity
  // with sync (appendIfNoBlock threaded into runRegenerate's adapter write
  // loop) and the per-write disposition tally replacing the bare file count.
  describe("marker recovery + write-disposition tally (D10-SA10.4-01/-02)", () => {
    it("runRegenerate re-splices a managed block whose markers the user stripped (parity with sync's D11-H-3)", async () => {
      await createTestProject(tempDir, { tools: ["claude"] });
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");

      const manifest = await readManifest(tempDir);
      const first = await runRegenerate(tempDir, manifest!);
      expect(first.failedTools).toBe(0);
      const claudeMdPath = join(tempDir, "CLAUDE.md");
      expect(await readFile(claudeMdPath, "utf-8")).toContain("HATCH3R:BEGIN");

      // The user strips the markers (intentionally or by accident): the file
      // becomes marker-less user content.
      await writeFile(claudeMdPath, "# My own notes\n\nKeep these.\n", "utf-8");

      const manifest2 = await readManifest(tempDir);
      const second = await runRegenerate(tempDir, manifest2!);
      expect(second.failedTools).toBe(0);
      const recovered = await readFile(claudeMdPath, "utf-8");
      // Pre-fix: this write loop had no appendIfNoBlock, so safeWrite's
      // no-marker branch returned action "skipped" on every update run —
      // the managed block silently stayed stale and only `hatch3r sync`
      // could recover the file.
      expect(recovered).toContain("HATCH3R:BEGIN");
      expect(recovered).toContain("# My own notes");
      expect(second.writeActions!.merged).toBeGreaterThanOrEqual(1);
    });

    it("runRegenerate reports a per-write disposition tally that sums to copiedFiles (D10-SA10.4-02)", async () => {
      await createTestProject(tempDir);
      vi.mocked(execFileSync).mockClear();

      const { runRegenerate } = await import("../../cli/commands/update.js");
      const { readManifest } = await import("../../manifest/hatchJson.js");

      const manifest = await readManifest(tempDir);
      const first = await runRegenerate(tempDir, manifest!);
      const wa1 = first.writeActions!;
      expect(wa1.created).toBeGreaterThanOrEqual(1);
      expect(
        wa1.created + wa1.merged + wa1.regenerated + wa1.unchanged + wa1.skipped,
      ).toBe(first.copiedFiles);

      // Second regenerate with nothing changed: idempotent writes report
      // unchanged (G3 skipIfUnchanged), never a fresh "created".
      const manifest2 = await readManifest(tempDir);
      const second = await runRegenerate(tempDir, manifest2!);
      const wa2 = second.writeActions!;
      expect(wa2.created).toBe(0);
      expect(wa2.unchanged).toBeGreaterThanOrEqual(1);
      expect(
        wa2.created + wa2.merged + wa2.regenerated + wa2.unchanged + wa2.skipped,
      ).toBe(second.copiedFiles);
    });

    it("update summary renders the Changes tally (D10-SA10.4-02)", async () => {
      await createTestProject(tempDir);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Changes");
      expect(output).toContain("created");
    });

    it("update summary shows 'merged (your edits preserved)' after recovering a stripped-marker file", async () => {
      await createTestProject(tempDir, { tools: ["claude"] });

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ backup: false });

      // Strip markers between runs — the exact fearful-upgrader scenario.
      await writeFile(join(tempDir, "CLAUDE.md"), "# Mine\n", "utf-8");
      consoleSpy.mockClear();

      await updateCommand({ backup: false });
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("merged (your edits preserved)");
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

    // D1-SA1.3-02 (Cycle 12, D1): a `--dry-run --pin-version` preview must not
    // persist `versionConstraint`. Before the fix, the pin's writeManifest ran
    // before the dry-run fork, so previewing a pin durably changed the install
    // spec of every future update. The manifest must be byte-identical after.
    it("does not persist --pin-version to the manifest under --dry-run (D1-SA1.3-02)", async () => {
      await createTestProject(tempDir);
      const manifestPath = join(tempDir, HATCH3R_DIR, "hatch.json");
      const before = await readFile(manifestPath, "utf-8");

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ dryRun: true, pinVersion: "2.1.0" });

      const after = await readFile(manifestPath, "utf-8");
      // A no-op preview must not durably change future-update behavior.
      expect(after).toBe(before);
      expect(JSON.parse(after).versionConstraint).toBeUndefined();
    });

    // D1-SA1.3-02 (Cycle 12, D1): a `--dry-run` upgrade of a pre-worktree
    // manifest triggers the worktree-config-init checkpoint, which wrote
    // `.worktreeinclude` before the dry-run fork. Under --dry-run the checkpoint
    // must preview only — no `.worktreeinclude` on disk, manifest untouched.
    it("does not write .worktreeinclude for a pre-worktree manifest under --dry-run (D1-SA1.3-02)", async () => {
      await createTestProject(tempDir, { worktree: undefined });
      const manifestPath = join(tempDir, HATCH3R_DIR, "hatch.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
      delete raw.worktree;
      const before = JSON.stringify(raw, null, 2);
      await writeFile(manifestPath, before);

      const { updateCommand } = await import("../../cli/commands/update.js");
      await updateCommand({ dryRun: true });

      const { access } = await import("node:fs/promises");
      const wtExists = await access(join(tempDir, ".worktreeinclude"))
        .then(() => true)
        .catch(() => false);
      expect(wtExists).toBe(false);
      // The checkpoint's in-memory mutation is discarded on the dry-run path.
      expect(await readFile(manifestPath, "utf-8")).toBe(before);

      const output = [
        ...consoleSpy.mock.calls.map((c) => String(c[0])),
        ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
      ].join("\n");
      expect(output).toContain("would be generated");
    });
  });

  // D1-SA1.3-04 (Cycle 12, D1, P1): `update` prompts via the content-selections-init
  // and platform-selection migration checkpoints on a legacy manifest. beginCommand
  // must reject `--format json` without `--yes` (exit 2) BEFORE any prompt runs, so a
  // prompt cannot interleave with the single JSON document / hang non-TTY CI.
  describe("--format json interactivity gate (D1-SA1.3-04)", () => {
    // A pre-content-tracking, pre-multi-platform manifest: both migration-checkpoint
    // conditions (manifest.content === undefined, !manifest.platform) hold, so a live
    // non-headless update WOULD reach the inquirer prompts.
    async function createLegacyProject(): Promise<void> {
      await createTestProject(tempDir, { content: undefined, platform: undefined });
    }

    beforeEach(() => {
      vi.mocked(inquirer.prompt).mockClear();
    });

    it("rejects `--format json` without `--yes` (exit 2) on a legacy manifest — no prompt interleaves", async () => {
      await createLegacyProject();
      const { updateCommand } = await import("../../cli/commands/update.js");

      const err = await updateCommand({ format: "json" }).catch((e) => e as HatchError);
      expect(err).toBeInstanceOf(HatchError);
      expect((err as HatchError).exitCode).toBe(2);
      expect((err as HatchError).recoveryHint).toContain("--yes");
      // The gate fires in beginCommand BEFORE the manifest read + runMigrationCheckpoints,
      // so the inquirer prompts are never reached.
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });

    it("rejects `--format json --dry-run` without `--yes` (exit 2) — update's checkpoints prompt on the dry-run path too", async () => {
      // Regression guard for the discriminator choice: unlike rollback/clean, update's
      // migration checkpoints ignore dryRun (they gate only on headless), so the
      // interactive flag keys off `--yes`, not `--dry-run`. A `_opts?.dryRun !== true`
      // form would let this json+dry-run+no-yes run reach a prompt on a legacy manifest.
      await createLegacyProject();
      const { updateCommand } = await import("../../cli/commands/update.js");

      const err = await updateCommand({ format: "json", dryRun: true }).catch((e) => e as HatchError);
      expect(err).toBeInstanceOf(HatchError);
      expect((err as HatchError).exitCode).toBe(2);
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
    });

    it("`--format json --yes` passes the interactivity gate (headless escape, no over-rejection)", async () => {
      // The `--yes` escape must NOT be rejected at beginCommand: a headless json update
      // takes checkpoint defaults (no prompt) and proceeds. It may still terminate later
      // in the mocked pipeline, but never with the exit-2 interactive-prompt-flow gate.
      await createLegacyProject();
      const { updateCommand } = await import("../../cli/commands/update.js");

      const err = await updateCommand({ format: "json", yes: true }).catch((e) => e as HatchError);
      const hitInteractivityGate =
        err instanceof HatchError &&
        err.exitCode === 2 &&
        /interactive prompt flow/.test(err.message);
      expect(hitInteractivityGate).toBe(false);
      expect(vi.mocked(inquirer.prompt)).not.toHaveBeenCalled();
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
        // update.ts:595 — the aggregated guidance is also surfaced as the
        // recoveryHint so the top-level handler prints an actionable next
        // step, not just the failure summary. A substantive (non-transient)
        // failure routes to the "inspect per-adapter messages" branch.
        expect(err.recoveryHint).toBeDefined();
        expect(err.recoveryHint).toMatch(/substantive|Inspect|resolve before retrying/i);
        expect(err.message).toContain(err.recoveryHint as string);
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
