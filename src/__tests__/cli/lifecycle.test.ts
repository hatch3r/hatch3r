import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { HATCH3R_VERSION } from "../../version.js";

/**
 * G6 (v1.7.1): recursively SHA-256 every regular file under `root` and
 * return a `relPath -> hash` map. Used by the sync-idempotency test to
 * compare project state between successive syncs and catch regressions
 * where any adapter output drifts by even one byte. Skips `.git/` and
 * `node_modules/` (irrelevant + slow), and orphan `.tmp.<hex>` files
 * (atomic-write tmpfiles that may exist transiently).
 *
 * Cycle 10 F2.7-F1 / D11-C-3 wiring: `.hatch3r/snapshots/<sessionId>/` is
 * excluded from the byte-identical comparison because each `sync` /
 * `update` / `init` / `config` / `clean` run captures its own pre-mutation
 * rollback target under a session id of the form
 * `${command}-${ISO timestamp}` (`src/pipeline/snapshot.ts::buildSessionId`).
 * The session-id timestamp is intentionally per-run — two consecutive
 * idempotent syncs MUST produce two distinct snapshot directories so
 * `hatch3r rollback --session=<id>` can revert each run independently.
 * The idempotency invariant the test protects (adapter outputs, managed
 * files, `hatch.json`, `.worktreeinclude`, wrap/insert round-trips) still
 * holds — only the rollback ledger is per-session, analogous to how
 * `.git/objects/` and journal entries are not compared between two
 * equivalent operations.
 *
 * F16.1-C1 (Cycle 10): the per-command resumability checkpoint
 * (`.{init,sync,update,config}-workspace/checkpoint.json`) is excluded for
 * the same reason — it is an operational progress ledger carrying a per-write
 * `timestamp`, not deterministic generated output. Two idempotent syncs
 * produce two checkpoints with distinct timestamps by design (so `--resume`
 * has an accurate "when did the last phase complete" record); the adapter
 * outputs they protect remain byte-identical.
 */
async function snapshotProject(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string, relPathFromRoot: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const entryRel = relPathFromRoot ? `${relPathFromRoot}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        // Skip per-session rollback ledger — see JSDoc above.
        if (entryRel === ".hatch3r/snapshots") continue;
        // Skip per-command resumability checkpoint ledgers (F16.1-C1) — the
        // checkpoint.json timestamp is per-write by design.
        if (/^\.(init|sync|update|config)-workspace$/.test(entry.name)) continue;
        await walk(full, entryRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/\.tmp\.[0-9a-f]{8}$/.test(entry.name)) continue;
      const buf = await readFile(full);
      const hash = createHash("sha256").update(buf).digest("hex");
      snapshot.set(relative(root, full), hash);
    }
  }
  await walk(root, "");
  return snapshot;
}

// Mock child_process to prevent actual git/npx calls from update command
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

// Wave 6: manifest moved from .agents/hatch.json to .hatch3r/hatch.json.
// Wave 3: .agents/ no longer materialized in user repos.
// Wave 5: user-authored overrides live under .hatch3r/overrides/{type}/.
const HATCH3R_DIR = ".hatch3r";

// Heavy filesystem I/O per test (mkdtemp + init creates 131 files + per-adapter
// generation + integrity hashing + rm -rf teardown). On Windows Node 22 CI
// runners this regularly exceeds the 30s default (vitest#7302, nodejs/node#60397).
//
// D3-1 (Cycle 11 Wave-2 High): `sequential: true` pins this suite to in-order
// execution. The `beforeEach` calls `process.chdir(tempDir)` (line below) and
// `process.cwd()` is process-global state that the `forks` pool reuses across
// files and that `isolate: true` does NOT reset (same mechanism documented in
// vitest.config.ts under D3-4). Without an explicit `sequential` marker a
// future `describe.concurrent` edit, or vitest interleaving these chdir-mutating
// tests with a sibling that also chdirs, could let one test observe a cwd a
// concurrent test moved out from under it. The flake symptom was the
// idempotency test seeing `Map(248) vs Map(218)` — one snapshot missing the 30
// `.cursor/commands/hatch3r-*.md` files. Vitest already runs intra-file tests
// in order by default; this marker makes the contract explicit and inheritance-
// proof. Paired with the warm-sync hardening in "sync is idempotent".
describe("init -> sync -> update lifecycle", { timeout: 60_000, sequential: true }, () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lifecycle-"));
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

  it("full lifecycle: init creates project, sync generates output, update refreshes", async () => {
    // ── Phase 1: Init ──────────────────────────────────────────
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    // Verify init created the .hatch3r/ footprint (Wave 6) — no .agents/ tree (Wave 3).
    await expect(access(join(tempDir, HATCH3R_DIR))).resolves.toBeUndefined();
    await expect(access(join(tempDir, HATCH3R_DIR, "hatch.json"))).resolves.toBeUndefined();
    await expect(access(join(tempDir, ".agents"))).rejects.toThrow();

    const manifestRaw = await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.tools).toContain("cursor");
    expect(manifest.features.rules).toBe(true);

    // ── Phase 2: Sync ──────────────────────────────────────────
    consoleSpy.mockClear();
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Verify sync generated adapter output
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const bridgePath = join(cursorRulesDir, "hatch3r-bridge.mdc");
    const bridgeContent = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(bridgeContent).not.toBeNull();
    expect(bridgeContent).toContain("Hatch3r Bridge");

    // Wave 3: root AGENTS.md is no longer emitted; each adapter writes only its native surface.
    await expect(access(join(tempDir, "AGENTS.md"))).rejects.toThrow();

    const syncOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(syncOutput).toContain("Sync complete");

    // ── Phase 3: Update ────────────────────────────────────────
    consoleSpy.mockClear();
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // Verify update refreshed the manifest version
    const updatedManifestRaw = await readFile(join(tempDir, HATCH3R_DIR, "hatch.json"), "utf-8");
    const updatedManifest = JSON.parse(updatedManifestRaw);
    expect(updatedManifest.hatch3rVersion).toBe(HATCH3R_VERSION);

    // Verify adapter output was regenerated
    const updatedBridge = await readFile(bridgePath, "utf-8").catch(() => null);
    expect(updatedBridge).not.toBeNull();

    const updateOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(updateOutput).toContain("Update complete");
  });

  it("sync is idempotent: re-sync after init produces byte-identical files", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    const { syncCommand } = await import("../../cli/commands/sync.js");

    // D3-1 (Cycle 11 Wave-2 High): warm the project state with a throwaway
    // sync BEFORE the two snapshots compared below. The idempotency invariant
    // this test protects is sync(warm) == sync(warm), not init-then-sync ==
    // sync. The first sync after `init` is the only run that diffs its
    // per-adapter output against the manifest history `init` wrote, sweeps a
    // cold orphan set, and first-creates non-deterministic operational ledgers
    // (`.hatch3r/.breaker-state.jsonl`, the `.sync-workspace/` checkpoint).
    // Snapshotting after the FIRST sync (the prior shape of this test) compared
    // a post-init-cold state against a warm one, leaving a window where the two
    // snapshots could legitimately differ on first-run-only side effects. With
    // the warm-up sync, both `snapshot1` and `snapshot2` are taken after a warm
    // sync, so any inequality is a real adapter-output regression — the signal
    // the test exists to catch — not a cold/warm asymmetry.
    await syncCommand();

    // First measured sync (state already warm from the throwaway above).
    await syncCommand();
    const snapshot1 = await snapshotProject(tempDir);

    // Second measured sync (must be byte-identical — every adapter output, every
    // managed file, every wrap/insert round-trip. The previous version of
    // this test only compared AGENTS.md, which missed the v1.7.0 worktree-
    // setup symptom where adapter outputs drifted by trailing-newline bytes
    // between syncs.)
    consoleSpy.mockClear();
    await syncCommand();
    const snapshot2 = await snapshotProject(tempDir);

    expect(snapshot2).toEqual(snapshot1);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Sync complete");
  });

  it("update preserves user override files under .hatch3r/overrides/", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    // Wave 5: user-authored content lives at .hatch3r/overrides/{type}/.
    const overridesRulesDir = join(tempDir, HATCH3R_DIR, "overrides", "rules");
    await mkdir(overridesRulesDir, { recursive: true });
    const customRulePath = join(overridesRulesDir, "my-team-rule.md");
    await writeFile(
      customRulePath,
      "---\nid: my-team-rule\ntype: rule\ndescription: Team rule\nscope: always\n---\n# My Team Rule\n\nCustom team content.\n",
    );

    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // Custom file should be preserved under .hatch3r/overrides/.
    const customContent = await readFile(customRulePath, "utf-8");
    expect(customContent).toContain("My Team Rule");
    expect(customContent).toContain("Custom team content");
  });

  it("update after sync refreshes hatch3r-prefixed adapter outputs", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor" });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Wave 3: canonical files are no longer materialized in the user repo.
    // The cursor adapter writes hatch3r-prefixed rules to .cursor/rules/ instead.
    const rulesDir = join(tempDir, ".cursor", "rules");
    const ruleFiles = await readdir(rulesDir);
    const hatch3rRules = ruleFiles.filter((f) => f.startsWith("hatch3r-"));
    expect(hatch3rRules.length).toBeGreaterThan(0);

    // Run update
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    // hatch3r-prefixed files should still exist after update.
    const updatedRuleFiles = await readdir(rulesDir);
    const updatedHatch3rRules = updatedRuleFiles.filter((f) => f.startsWith("hatch3r-"));
    expect(updatedHatch3rRules.length).toBeGreaterThan(0);
  });

  it("multi-tool lifecycle: init with multiple tools, sync generates all outputs", async () => {
    const { initCommand } = await import("../../cli/commands/init.js");
    await initCommand({ yes: true, tools: "cursor,claude" });

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Verify cursor output exists
    const cursorBridge = await readFile(
      join(tempDir, ".cursor", "rules", "hatch3r-bridge.mdc"),
      "utf-8",
    ).catch(() => null);
    expect(cursorBridge).not.toBeNull();

    // Verify claude output exists
    const claudeMd = await readFile(
      join(tempDir, "CLAUDE.md"),
      "utf-8",
    ).catch(() => null);
    expect(claudeMd).not.toBeNull();

    // Run update to verify both tools are refreshed
    consoleSpy.mockClear();
    const { updateCommand } = await import("../../cli/commands/update.js");
    await updateCommand({ backup: false });

    const updateOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(updateOutput).toContain("2 tool(s) re-synced");
  });
});
