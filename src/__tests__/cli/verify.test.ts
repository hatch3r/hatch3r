import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError, HATCH3R_DIR } from "../../types.js";

// Wave 7 (1.9.0) — fresh test for the verify command. The integrity
// manifest subsystem was deleted in this wave; `verify` is now a thin
// drift-detection wrapper over `computeAdapterDrift`. It must:
//   - exit 0 (no throw) when every tracked adapter output matches a
//     freshly regenerated copy (sourced from the bundled content root);
//   - throw HatchError(INTEGRITY_ERROR) with exitCode=1 when any file is
//     drifted (modified) or missing on disk.
//
// Mirrors the fixture/spy pattern used in `src/__tests__/cli/status.test.ts`
// because verify reuses the same drift helper as `status` (Wave 7 contract:
// one drift definition, two CLI front doors).

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

describe("verify command", () => {
  let tempDir: string;
  let originalCwd: string;
  let exitSpy: MockInstance;
  let consoleSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-verify-"));
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

  it("exits with error when no manifest exists", async () => {
    const { verifyCommand } = await import("../../cli/commands/verify.js");

    await expect(verifyCommand()).rejects.toThrow(HatchError);
    try {
      await verifyCommand();
    } catch (e) {
      // C8-D1-M5: CONFIG_ERROR -> EX_DATAERR (65) via central map.
      expect((e as HatchError).exitCode).toBe(65);
      expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
    }

    const allOutput = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join(" ");
    expect(allOutput).toContain(".hatch3r/hatch.json");
  });

  it("exits cleanly (exit 0) when there is no adapter output to check", async () => {
    // Manifest with an empty tools list — `computeAdapterDrift` walks
    // zero adapters and zero managed files, so verify must succeed.
    await createTestProject(tempDir, { tools: [], managedFiles: [] });

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("verify: PASS");
  });

  it("throws HatchError(INTEGRITY_ERROR) when an adapter output is modified", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Tamper with one rule file so the regenerated content no longer
    // matches the on-disk managed block.
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await writeFile(join(cursorRulesDir, ruleFile!), "tampered drift content\n");

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const err = thrown as HatchError;
    expect(err.errorCode).toBe("INTEGRITY_ERROR");
    // C8-D1-M5: INTEGRITY_ERROR -> EX_CANTCREAT (73) via central map.
    expect(err.exitCode).toBe(73);
    expect(err.message).toMatch(/drift detected/i);
  });

  it("throws HatchError(INTEGRITY_ERROR) when an adapter output is missing", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Delete one rule file so verify sees a missing output.
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const err = thrown as HatchError;
    expect(err.errorCode).toBe("INTEGRITY_ERROR");
    // C8-D1-M5: INTEGRITY_ERROR -> EX_CANTCREAT (73) via central map.
    expect(err.exitCode).toBe(73);
    expect(err.message).toMatch(/drift detected/i);

    // Failure output should surface the verify: FAIL header so operators
    // see immediately which command rejected the run.
    const output = [
      ...consoleSpy.mock.calls.map((c) => String(c[0])),
      ...consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");
    expect(output).toMatch(/verify: FAIL/);
  });

  // Cycle 10 / D11-H-6: the advertised `--fix` flag (declared in program.ts)
  // was silently ignored — `hatch3r verify --fix` behaved identically to a
  // plain drift report (Silent-Failure-Contract, P5). `--fix` now repairs
  // drift by regenerating adapter output (the same in-memory regeneration
  // `sync` performs) up to `--max-fix-attempts` times, re-checking after each
  // pass.
  it("repairs drift and exits PASS when run with --fix", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Introduce genuine drift INSIDE the managed block while preserving the
    // HATCH3R:BEGIN/END markers — this is the drift `--fix` regenerates.
    // (Destroying the markers entirely is a separate, fail-closed case:
    // safeWriteFile refuses to clobber a marker-less file by design, so
    // `--fix` cannot and must not auto-repair that.)
    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    const rulePath = join(cursorRulesDir, ruleFile!);
    const original = await readFile(rulePath, "utf-8");
    // Insert AFTER the full begin marker comment so the marker itself stays
    // intact and the injected line lands inside the managed block (the
    // regenerable region). Splicing inside the `<!-- ... -->` marker text
    // would instead corrupt the marker — a separate fail-closed case.
    const beginMarker = "<!-- HATCH3R:BEGIN -->";
    const beginIdx = original.indexOf(beginMarker);
    expect(beginIdx).toBeGreaterThan(-1);
    const insertAt = beginIdx + beginMarker.length;
    const tampered =
      original.slice(0, insertAt) + "\ndrifted-inside-block-line" + original.slice(insertAt);
    await writeFile(rulePath, tampered);

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // --fix must regenerate the drifted block and exit cleanly (no throw).
    await expect(verifyCommand({ fix: true })).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/--fix attempt 1\//);
    expect(output).toContain("verify: PASS");

    // The drifted line must be gone and a subsequent plain verify confirms
    // the repair persisted on disk.
    const repaired = await readFile(rulePath, "utf-8");
    expect(repaired).not.toContain("drifted-inside-block-line");
    await expect(verifyCommand()).resolves.toBeUndefined();
  });

  it("repairs a missing adapter output when run with --fix", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    await rm(join(cursorRulesDir, ruleFile!));

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // The missing file must be regenerated; verify --fix exits 0.
    await expect(verifyCommand({ fix: true, maxFixAttempts: 1 })).resolves.toBeUndefined();

    const restored = await readdir(cursorRulesDir);
    expect(restored).toContain(ruleFile!);
  });

  // D1-SA1.4-07 / D2-SA2.7-06 (D1/D2, P1): orphan-only drift is a file the
  // manifest still tracks but no current adapter produces (a leftover from a
  // removed tool / renamed output). Regeneration can NEVER clear it — only
  // `hatch3r clean` removes it — so `verify --fix` must (a) run 0 regenerate
  // attempts on an orphan-only report instead of spinning futile
  // snapshot+regenerate cycles, and (b) point the operator at `hatch3r clean`,
  // not `hatch3r sync` (the pre-fix hardcoded hint, which did nothing for this
  // case). `tools: []` walks zero adapters so the tracked-but-unproduced file is
  // the only drift the report carries.
  it("runs 0 regenerate attempts and points at clean, not sync, for orphan-only --fix (D1-SA1.4-07, D2-SA2.7-06)", async () => {
    await createTestProject(tempDir, { tools: [], managedFiles: ["stale-orphan.md"] });
    // The tracked path must exist on disk so the orphan loop classifies it
    // `unexpected` (present but unowned) rather than skipping it as absent.
    await writeFile(join(tempDir, "stale-orphan.md"), "leftover from a removed tool\n");

    consoleSpy.mockClear();
    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand({ fix: true });
    } catch (e) {
      thrown = e;
    }
    // Orphan drift still FAILS verify (exit 73) — regeneration cannot clear it.
    expect(thrown).toBeInstanceOf(HatchError);
    expect((thrown as HatchError).errorCode).toBe("INTEGRITY_ERROR");

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // 0 regenerate attempts: the "--fix attempt N/" progress line never prints.
    expect(output).not.toMatch(/--fix attempt \d+\//);
    // Category-aware guidance names `clean` (the orphan remedy), not `sync`.
    expect(output).toContain("hatch3r clean");
    // The recovery hint carried on the thrown error is likewise `clean`, not the
    // pre-fix hardcoded `sync` suggestion.
    const hint = (thrown as HatchError).recoveryHint ?? "";
    expect(hint).toContain("hatch3r clean");
    expect(hint).not.toMatch(/hatch3r sync/);
  });

  // D1-SA1.4-F11 (Cycle 10 Wave 4, P1): verify only printed aggregate drift
  // counts, so an operator who saw `verify: FAIL (N drift(s))` had to re-run
  // `hatch3r status` to learn WHICH files drifted. `--verbose` now prints the
  // same per-tool / per-file breakdown status emits, before the summary box.
  it("prints the per-tool drift breakdown on FAIL only when --verbose is set", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    // Delete one output so verify reports a `missing` drift entry.
    await rm(join(cursorRulesDir, ruleFile!));

    const { verifyCommand } = await import("../../cli/commands/verify.js");

    // Without --verbose: aggregate counts only, no per-file path line.
    consoleSpy.mockClear();
    await expect(verifyCommand()).rejects.toThrow(HatchError);
    const plain = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(plain).toMatch(/verify: FAIL/);
    expect(plain).not.toContain(ruleFile!);

    // With --verbose: the per-tool breakdown names the drifted file + tool.
    consoleSpy.mockClear();
    await expect(verifyCommand({ verbose: true })).rejects.toThrow(HatchError);
    const verbose = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(verbose).toContain(ruleFile!);
    expect(verbose).toContain("cursor:");
    expect(verbose).toContain("(missing)");
  });

  it("prints the per-tool breakdown on PASS when --verbose is set", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    consoleSpy.mockClear();
    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand({ verbose: true })).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("verify: PASS");
    // The in-sync breakdown lists the cursor adapter's checked outputs.
    expect(output).toContain("cursor:");
  });

  // D14-1 (Cycle 11 Wave 1, Critical): the shared `computeAdapterDrift` helper
  // now registers monorepo per-package output paths as seen, so the orphan loop
  // no longer flags them as `unexpected`. verify is the second front door onto
  // that helper — confirm the fix reaches it too: a 2-package monorepo whose
  // per-package files are all in sync must verify PASS (exit 0, no throw),
  // where before the fix it threw INTEGRITY_ERROR on ~(outputs x packages)
  // false orphans.
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
  // per-test `retry` is gone (the contention it papered over no longer occurs).
  // No per-test `timeout` here: a per-test value overrides the heavy-fs
  // project's platform-aware testTimeout (120s on win32, 30s elsewhere), so a
  // flat 30s override silently clamped windows-latest back to 30s — the exact
  // spurious-timeout class the 120s headroom exists to absorb. Assertions
  // (verify PASS / 0 false orphans) are unchanged.
  it("verifies a 2-package monorepo as PASS with no false-orphan drift (D14-1)", async () => {
    await createTestProject(tempDir, {
      tools: ["cursor", "claude"],
      packages: [
        { name: "@scope/alpha", path: "packages/alpha" },
        { name: "@scope/beta", path: "packages/beta" },
      ],
    });

    // sync writes root + per-package outputs and tracks every path in the
    // manifest's managedFiles list.
    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    // Guard against a vacuous pass: confirm per-package files were emitted and
    // tracked, so the verify-PASS below is the orphan-suppression fix and not
    // an empty manifest.
    const { readManifest } = await import("../../manifest/hatchJson.js");
    const manifest = await readManifest(tempDir);
    const perPackageTracked = (manifest?.managedFiles ?? []).filter(
      (p) => p.startsWith("packages/alpha/") || p.startsWith("packages/beta/"),
    );
    expect(perPackageTracked.length).toBeGreaterThan(0);

    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // Must NOT throw: no false-orphan drift means a clean verify.
    await expect(verifyCommand()).resolves.toBeUndefined();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("verify: PASS");
    expect(output).not.toMatch(/verify: FAIL/);
    // No "Unexpected:" summary row, since no per-package file is an orphan.
    expect(output).not.toContain("Unexpected:");
  });

  // D15-6 (SA15.4-F2, D15, P6): verify advertised "drift or tampering"
  // detection but only diffed the EXTRACTED managed block — a structurally
  // broken HATCH3R:BEGIN/END marker (orphan/duplicate/wrong-syntax) was
  // invisible because `extractManagedBlock` reads only the first BEGIN..END
  // pair. verify now runs `scanManagedBlockTampering` (the same structural scan
  // `validate` runs) and surfaces its findings as advisory warnings. Append an
  // ORPHAN END marker after the real one: the extracted block is unchanged
  // (content drift stays clean → PASS exit code unchanged), but the structural
  // scan flags the second END. This proves the tamper path reaches verify
  // without regressing the drift-based PASS/FAIL contract.
  it("surfaces structural marker tampering as a warning while drift stays PASS (D15-6)", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const cursorRulesDir = join(tempDir, ".cursor", "rules");
    const entries = await readdir(cursorRulesDir);
    const ruleFile = entries.find((f) => f.endsWith(".mdc"));
    expect(ruleFile).toBeDefined();
    const rulePath = join(cursorRulesDir, ruleFile!);
    const original = await readFile(rulePath, "utf-8");
    // Guard: the real END marker must exist so the appended one is a genuine
    // duplicate/orphan and not the first occurrence.
    expect(original).toContain("<!-- HATCH3R:END -->");
    // Append a SECOND end marker after the managed block. `extractManagedBlock`
    // stops at the first END, so the on-disk block content still matches
    // canonical (no drift); only the structural scan sees the orphan END.
    await writeFile(rulePath, `${original}\n<!-- HATCH3R:END -->\n`);

    // ── Human mode: PASS box + structural-warning box, no FAIL/throw. ──
    consoleSpy.mockClear();
    const { verifyCommand } = await import("../../cli/commands/verify.js");
    await expect(verifyCommand()).resolves.toBeUndefined();
    const human = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(human).toContain("verify: PASS");
    expect(human).not.toMatch(/verify: FAIL/);
    expect(human).toContain("Managed-block structural warnings");
    // `boxen` word-wraps the warning line across the box border, so strip the
    // box-drawing glyphs and collapse whitespace runs before matching the full
    // phrase (the wrap point is box-width-dependent and not load-bearing).
    const humanFlat = human.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ");
    expect(humanFlat).toMatch(/orphan managed-block end marker/);

    // ── JSON mode: status still "pass", tamperWarnings non-empty. ──
    // emitJson writes via process.stdout.write, not console.log — spy on it.
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      await expect(verifyCommand({ format: "json" })).resolves.toBeUndefined();
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const start = combined.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(combined.slice(start).trim()) as {
      status: string;
      tamperWarnings: string[];
    };
    expect(parsed.status).toBe("pass");
    expect(Array.isArray(parsed.tamperWarnings)).toBe(true);
    expect(parsed.tamperWarnings.length).toBeGreaterThan(0);
    expect(parsed.tamperWarnings.some((w) => /orphan managed-block end marker/.test(w))).toBe(true);
  });

  // D15-6: when the marker structure is well-formed, the tamper scan is silent
  // — no structural-warning box in human mode and an empty `tamperWarnings`
  // array in JSON mode. Guards against the box rendering on every clean run.
  it("emits no structural-tamper warnings on a clean synced project (D15-6)", async () => {
    await createTestProject(tempDir);

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // emitJson writes via process.stdout.write, not console.log — spy on it.
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      await expect(verifyCommand({ format: "json" })).resolves.toBeUndefined();
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const start = combined.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(combined.slice(start).trim()) as {
      status: string;
      tamperWarnings: string[];
    };
    expect(parsed.status).toBe("pass");
    expect(parsed.tamperWarnings).toEqual([]);

    consoleSpy.mockClear();
    await expect(verifyCommand()).resolves.toBeUndefined();
    const human = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(human).toContain("verify: PASS");
    expect(human).not.toContain("Managed-block structural warnings");
  });

  // D1-SA1.4-04 (D1, P1): verify (a CI drift gate) never read the manifest's
  // recorded writer version, so a stale (older) global install followed verify's
  // `sync`/`--fix` hint and silently DOWNGRADED the outputs. verify now surfaces
  // the writer version + skew direction (JSON) and flips the recovery hint to
  // `update`-first when the running CLI is older than the writer.
  it("exposes manifestHatch3rVersion + versionSkewDirection installed-newer in --json (D1-SA1.4-04)", async () => {
    // Fixture writer is 1.9.0; the running CLI is newer. Sync → clean PASS.
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
      const { verifyCommand } = await import("../../cli/commands/verify.js");
      await expect(verifyCommand({ format: "json" })).resolves.toBeUndefined();
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const parsed = JSON.parse(combined.slice(combined.indexOf("{")).trim()) as {
      manifestHatch3rVersion: string;
      versionSkew: boolean;
      versionSkewDirection: string;
    };
    expect(parsed.manifestHatch3rVersion).toBe("1.9.0");
    expect(parsed.versionSkew).toBe(true);
    expect(parsed.versionSkewDirection).toBe("installed-newer");
  });

  it("flips the recovery hint + human disclosure to update-first when installed-older (D1-SA1.4-04)", async () => {
    // Writer 99.0.0 (above any real CLI) → installed-older. No sync → the cursor
    // outputs are missing (syncable drift), so verify FAILS: the recovery hint
    // must direct at `update` (sync would regenerate from the older set and
    // downgrade), not the default `sync`/`--fix`.
    await createTestProject(tempDir, { hatch3rVersion: "99.0.0" });
    consoleSpy.mockClear();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    let thrown: unknown;
    try {
      await verifyCommand();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HatchError);
    const hint = (thrown as HatchError).recoveryHint ?? "";
    expect(hint).toContain("hatch3r update");
    expect(hint).toContain("would downgrade");
    expect(hint).not.toMatch(/Run `hatch3r sync` to regenerate drifted\/missing files/);

    // The human path also prints the one-line skew disclosure.
    const human = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(human).toContain("is older than the version that generated these files");
  });

  // S2c (release/2.6.0): emission-completeness rows. An artifact dropped by a
  // customize `enabled: false` override is reported per-artifact with the
  // .customize.yaml path in the action — and stays informational: verify PASSes
  // (exit code unchanged; only `unexplained` gaps count as ordinary drift).
  it("reports a customization-disabled artifact as an attributed emission gap without failing (S2c)", async () => {
    await createTestProject(tempDir);
    // Disable BEFORE the first sync so the artifact is never emitted or
    // tracked — the drop shows up ONLY through the completeness check.
    const customizeDir = join(tempDir, HATCH3R_DIR, "commands");
    await mkdir(customizeDir, { recursive: true });
    await writeFile(join(customizeDir, "hatch3r-benchmark.customize.yaml"), "enabled: false", "utf-8");

    const { syncCommand } = await import("../../cli/commands/sync.js");
    await syncCommand();

    const { verifyCommand } = await import("../../cli/commands/verify.js");
    // ── JSON mode: PASS + the attributed gap row in the payload. ──
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as never);
    try {
      await expect(verifyCommand({ format: "json" })).resolves.toBeUndefined();
    } finally {
      stdoutSpy.mockRestore();
    }
    const combined = stdoutChunks.join("");
    const start = combined.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(combined.slice(start).trim()) as {
      status: string;
      emissionGaps: Array<{ tool: string; contentClass: string; id: string; reason: string; action: string }>;
    };
    expect(parsed.status).toBe("pass");
    const gap = parsed.emissionGaps.find((g) => g.id === "hatch3r-benchmark");
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("customization-disabled");
    expect(gap!.action).toContain("hatch3r-benchmark.customize.yaml");
    // No unexplained rows on a clean synced project.
    expect(parsed.emissionGaps.every((g) => g.reason !== "unexplained")).toBe(true);

    // ── Human mode: PASS box + the not-emitted box naming the artifact. ──
    consoleSpy.mockClear();
    await expect(verifyCommand()).resolves.toBeUndefined();
    const human = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(human).toContain("verify: PASS");
    const humanFlat = human.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ");
    expect(humanFlat).toContain("Canonical artifacts not emitted");
    expect(humanFlat).toContain("hatch3r-benchmark");
  });
});
