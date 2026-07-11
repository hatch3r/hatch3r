import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runSelfUpdate, pickReExecBin } from "../../install/selfUpdate.js";
import { _resetNpmGlobalRootCacheForTesting } from "../../detect/installContext.js";
import { HatchError } from "../../types.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

describe("runSelfUpdate", () => {
  let tempDir: string;
  const originalArgv1 = process.argv[1];
  // Capture the full descriptor (not just the string) so the restore is a
  // faithful round-trip and every stub carries `configurable: true` — without
  // it a real Windows runner (`process.platform === "win32"` at capture) would
  // pin the property non-configurable on the first define and throw
  // `TypeError: Cannot redefine property` on the next beforeEach/win32 stub.
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  );
  const setPlatform = (value: NodeJS.Platform): void => {
    Object.defineProperty(process, "platform", { value, configurable: true });
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-self-update-"));
    _resetNpmGlobalRootCacheForTesting();
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
    // Stub platform to a non-Windows value so the Windows-shim guard in
    // src/install/selfUpdate.ts (the `target.kind === "global" &&
    // process.platform === "win32"` skip) does NOT fire for tests that
    // exercise the global-install branch. Tests asserting non-Windows
    // behaviour MUST pin a non-win32 value here rather than relying on the
    // host, or they flip on a real Windows runner. The dedicated win32 test
    // below explicitly overrides this to "win32".
    setPlatform("linux");
  });

  afterEach(async () => {
    process.argv[1] = originalArgv1;
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  async function seedProjectLocal(version = "1.0.0"): Promise<void> {
    const pkg = join(tempDir, "node_modules", "hatch3r");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "hatch3r", version }),
    );
  }

  async function seedGlobalInstall(): Promise<void> {
    // Cannot create a real path under FAKE_GLOBAL_ROOT in the test fs, so we
    // mock npm root -g to return the temp directory and seed under it.
    const fakeRoot = join(tempDir, "fake-global-root");
    const pkg = join(fakeRoot, "hatch3r");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "hatch3r", version: "1.0.0" }),
    );
    // First execFileSync call is npm root -g; subsequent calls are package
    // updates. Make the npm root probe return the fake root, then default
    // to empty for installs.
    let callIndex = 0;
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      if (callIndex === 0) {
        callIndex++;
        return Buffer.from(`${fakeRoot}\n`);
      }
      callIndex++;
      return Buffer.from("");
    });
  }

  it("skips invokedFrom when classified as dev-source", async () => {
    process.argv[1] = "/some/random/path/cli.js";
    const result = await runSelfUpdate(tempDir);
    expect(result.updated).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.location.kind).toBe("dev-source");
  });

  it("skips npx with a guidance message", async () => {
    process.argv[1] = "/Users/x/.npm/_npx/abc/node_modules/hatch3r/dist/cli/index.js";
    const result = await runSelfUpdate(tempDir);
    expect(result.updated).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.location.kind).toBe("npx");
    expect(result.skipped[0]?.reason).toMatch(/npx/);
  });

  it("runs npm install for a project-local invocation", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    expect(result.updated[0]?.kind).toBe("project-local");
    // execFileSync gets called once for npm root -g (returns "") and once for
    // the install. The install call should target hatch3r@latest.
    const installCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@latest"),
    );
    expect(installCalls.length).toBe(1);
  });

  it("uses npm install -g for a global target", async () => {
    await seedGlobalInstall();
    const fakeRoot = join(tempDir, "fake-global-root");
    process.argv[1] = join(fakeRoot, "hatch3r", "dist", "cli", "index.js");
    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    expect(result.updated[0]?.kind).toBe("global");
    const globalInstallCalls = vi.mocked(execFileSync).mock.calls.filter((c) => {
      const args = c[1] as string[] | undefined;
      return Array.isArray(args) && args.includes("-g") && args.includes("hatch3r@latest");
    });
    expect(globalInstallCalls.length).toBe(1);
  });

  // D1-SA1.3-13 (D1, P6): `--pin-version` / `versionConstraint` is a
  // supply-chain control — freeze to a known-good version pending registry
  // revocation (pack-trust-model §2.1) — that previously had zero behavioral
  // coverage and one prior silent regression on record (D15-5, Cycle 11). These
  // four tests lock every branch of buildInvocation (selfUpdate.ts:73-97): the
  // pinned spec, the pnpm `add` vs npm `install` split, the global `-g` form,
  // and the unpinned `@latest` (pm.updateArgs) fallback.
  it("pins a project-local npm install to hatch3r@<version> when versionConstraint is set (D1-SA1.3-13)", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    // Clear accumulated call history so the filters below count only THIS
    // test's invocation (the shared execFileSync mock is not auto-cleared
    // between tests; mockClear keeps the beforeEach mockReturnValue intact).
    vi.mocked(execFileSync).mockClear();
    const result = await runSelfUpdate(tempDir, { versionConstraint: "2.1.0" });
    expect(result.updated.length).toBe(1);
    expect(result.updated[0]?.kind).toBe("project-local");
    const pinCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@2.1.0"),
    );
    expect(pinCalls.length).toBe(1);
    // npm project-local pin => `npm install hatch3r@2.1.0`, replacing the
    // `@latest` updateArgs path (and never `-g` for a project-local target).
    expect(pinCalls[0]?.[0]).toBe("npm");
    expect(pinCalls[0]?.[1]).toEqual(["install", "hatch3r@2.1.0"]);
    const latestCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@latest"),
    );
    expect(latestCalls.length).toBe(0);
  });

  it("uses `pnpm add hatch3r@<version>` for a pnpm project-local pin (D1-SA1.3-13)", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    // A real pnpm-lock.yaml makes detectPackageManager (which uses the
    // unmocked node:fs/promises access) resolve to pnpm, exercising the
    // pnpm `add`-vs-npm `install` pin branch the npm test above cannot reach.
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    vi.mocked(execFileSync).mockClear();
    const result = await runSelfUpdate(tempDir, { versionConstraint: "2.1.0" });
    expect(result.updated.length).toBe(1);
    const pinCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@2.1.0"),
    );
    expect(pinCalls.length).toBe(1);
    expect(pinCalls[0]?.[0]).toBe("pnpm");
    expect(pinCalls[0]?.[1]).toEqual(["add", "hatch3r@2.1.0"]);
  });

  it("pins a global install to `-g hatch3r@<version>` when versionConstraint is set (D1-SA1.3-13)", async () => {
    await seedGlobalInstall();
    const fakeRoot = join(tempDir, "fake-global-root");
    process.argv[1] = join(fakeRoot, "hatch3r", "dist", "cli", "index.js");
    // seedGlobalInstall's mockImplementation (callIndex closure) survives
    // mockClear — only the recorded call history is reset.
    vi.mocked(execFileSync).mockClear();
    const result = await runSelfUpdate(tempDir, { versionConstraint: "2.1.0" });
    expect(result.updated.length).toBe(1);
    expect(result.updated[0]?.kind).toBe("global");
    const pinCalls = vi.mocked(execFileSync).mock.calls.filter((c) => {
      const args = c[1] as string[] | undefined;
      return Array.isArray(args) && args.includes("-g") && args.includes("hatch3r@2.1.0");
    });
    expect(pinCalls.length).toBe(1);
    expect(pinCalls[0]?.[1]).toEqual(["install", "-g", "hatch3r@2.1.0"]);
  });

  it("falls back to `pnpm add hatch3r@latest` (updateArgs) when no versionConstraint is set (D1-SA1.3-13)", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    vi.mocked(execFileSync).mockClear();
    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    const latestCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@latest"),
    );
    expect(latestCalls.length).toBe(1);
    // No constraint => the unpinned pm.updateArgs path: `pnpm add hatch3r@latest`.
    expect(latestCalls[0]?.[0]).toBe("pnpm");
    expect(latestCalls[0]?.[1]).toEqual(["add", "hatch3r@latest"]);
    const pinCalls = vi.mocked(execFileSync).mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? []).includes("hatch3r@2.1.0"),
    );
    expect(pinCalls.length).toBe(0);
  });

  it("skips global self-update on Windows with guided message", async () => {
    // Assert Windows-specific behaviour by STUBBING win32 deterministically
    // (configurable so afterEach can restore) — never rely on the host
    // platform, which would make this pass only on a real Windows runner.
    setPlatform("win32");
    await seedGlobalInstall();
    const fakeRoot = join(tempDir, "fake-global-root");
    process.argv[1] = join(fakeRoot, "hatch3r", "dist", "cli", "index.js");
    const result = await runSelfUpdate(tempDir);
    expect(result.updated).toEqual([]);
    expect(result.skipped.length).toBeGreaterThanOrEqual(1);
    const winSkip = result.skipped.find((s) => s.location.kind === "global");
    expect(winSkip).toBeDefined();
    expect(winSkip?.reason).toMatch(/Windows|fresh terminal/i);
  });

  it("throws HatchError when the primary target's install fails", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    // First call: npm root -g (empty). Second call: install — throw.
    let callIndex = 0;
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      if (callIndex === 0) {
        callIndex++;
        return Buffer.from("");
      }
      callIndex++;
      throw new Error("npm install failed: 404 Not Found");
    });
    await expect(runSelfUpdate(tempDir)).rejects.toThrow(HatchError);
  });

  it("attaches an --offline recoveryHint to the fatal primary-install HatchError", async () => {
    // selfUpdate.ts:384 — the fatal primary-target install failure must
    // surface the offline regeneration escape hatch as its recoveryHint
    // (the registry fetch failed; canonical content is already on disk).
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    let callIndex = 0;
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      if (callIndex++ === 0) return Buffer.from(""); // npm root -g
      throw new Error("npm install failed: 404 Not Found");
    });
    const err = await runSelfUpdate(tempDir).catch((e) => e);
    expect(err).toBeInstanceOf(HatchError);
    expect((err as HatchError).recoveryHint).toBe(
      "Run `hatch3r update --offline` to regenerate adapter outputs from the already-installed canonical content without the registry fetch; resolve the package-manager failure above before retrying the online update.",
    );
  });

  it("attaches a --skip-audit-signatures recoveryHint to the signature-verification refusal", async () => {
    // selfUpdate.ts:341 — when `npm audit signatures` reports an invalid
    // signature the install is refused with INTEGRITY_ERROR; the hint must
    // point at the out-of-band-verify-then-override path.
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      const a = _args[1] as string[] | undefined;
      if (Array.isArray(a) && a[0] === "root" && a[1] === "-g") {
        return Buffer.from(""); // no global root
      }
      if (Array.isArray(a) && a[0] === "audit" && a[1] === "signatures") {
        // Exit 0 but invalid signature summary -> ok:false (secure default).
        return Buffer.from("audited 1 package\nsignatures: invalid\n");
      }
      return Buffer.from(""); // project-local install succeeds
    });
    const err = await runSelfUpdate(tempDir).catch((e) => e);
    expect(err).toBeInstanceOf(HatchError);
    expect((err as HatchError).errorCode).toBe("INTEGRITY_ERROR");
    expect((err as HatchError).recoveryHint).toBe(
      "Verify the package out-of-band first, then re-run `hatch3r update --skip-audit-signatures` to override the refusal; do not override on an unverified package.",
    );
  });

  it("does not refuse a global update when the audit cwd has no dependency tree (D1-SA1.3-01)", async () => {
    // A global install audited in a non-Node repo (or any cwd without an
    // installed dependency tree) makes `npm audit signatures` exit non-zero
    // with "found no installed dependencies to audit". Pre-fix this was
    // classified as a signature FAILURE and refused the update with an
    // INTEGRITY_ERROR blaming compromised artifacts. It must now degrade to a
    // warning and let the update proceed.
    await seedGlobalInstall();
    const fakeRoot = join(tempDir, "fake-global-root");
    process.argv[1] = join(fakeRoot, "hatch3r", "dist", "cli", "index.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      const a = _args[1] as string[] | undefined;
      if (Array.isArray(a) && a[0] === "root" && a[1] === "-g") {
        return Buffer.from(`${fakeRoot}\n`);
      }
      if (Array.isArray(a) && a[0] === "audit" && a[1] === "signatures") {
        throw new Error(
          "npm error code ENOLOCK\nnpm error audit This command requires an existing lockfile.\nnpm error found no installed dependencies to audit",
        );
      }
      return Buffer.from(""); // global install succeeds
    });

    // Must NOT throw an INTEGRITY refusal — the update proceeds.
    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    expect(result.updated[0]?.kind).toBe("global");
    expect(result.failed).toEqual([]);

    // The warning states the package is not flagged compromised (no false
    // "verification FAILED … compromised" message).
    const stderr = errSpy.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(
      stderr.some((line) => /Signature verification unavailable/.test(line)),
    ).toBe(true);
    expect(stderr.some((line) => /verification FAILED/.test(line))).toBe(false);
    errSpy.mockRestore();
  });

  it("degrades a secondary target failure to a warning, not a throw", async () => {
    // Primary = project-local (succeeds), secondary = global (fails).
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    const fakeRoot = join(tempDir, "fake-global-root");
    const globalPkg = join(fakeRoot, "hatch3r");
    await mkdir(globalPkg, { recursive: true });
    await writeFile(
      join(globalPkg, "package.json"),
      JSON.stringify({ name: "hatch3r", version: "1.0.0" }),
    );

    // Args-based dispatch (robust to extra calls injected by audit):
    //   ["root", "-g"]                    -> fake-global-root
    //   ["install", "hatch3r@latest"]     -> primary install succeeds
    //   ["audit", "signatures"]           -> primary audit succeeds
    //   ["install", "-g", "hatch3r@..."]  -> secondary global install throws
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      const a = _args[1] as string[] | undefined;
      if (Array.isArray(a) && a[0] === "root" && a[1] === "-g") {
        return Buffer.from(`${fakeRoot}\n`);
      }
      if (Array.isArray(a) && a[0] === "audit" && a[1] === "signatures") {
        return Buffer.from("verified: ok\n");
      }
      if (Array.isArray(a) && a.includes("-g") && a.includes("hatch3r@latest")) {
        throw new Error("EACCES: permission denied (global install)");
      }
      // project-local install
      return Buffer.from("");
    });

    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.location.kind).toBe("global");
  });

  it("classifies execFileSync timeout as a NETWORK_ERROR with timeout message", async () => {
    process.argv[1] = join(tempDir, "node_modules", ".bin", "hatch3r");
    await seedProjectLocal();
    let callIndex = 0;
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      if (callIndex++ === 0) return Buffer.from(""); // npm root -g
      const err = new Error("etimedout") as NodeJS.ErrnoException & {
        killed: boolean;
        signal: string;
      };
      err.killed = true;
      err.signal = "SIGTERM";
      throw err;
    });
    await expect(runSelfUpdate(tempDir)).rejects.toThrow(/timed out/i);
  });

  it("honours HATCH3R_UPDATE_TIMEOUT_MS env var when present and positive", async () => {
    // Stub the env var, re-import the module so the IIFE that reads
    // HATCH3R_UPDATE_TIMEOUT_MS runs with the override in place. Covers
    // the env-var branch in selfUpdate.ts:30-36 that the default-value
    // tests above would otherwise miss.
    vi.stubEnv("HATCH3R_UPDATE_TIMEOUT_MS", "5000");
    vi.resetModules();
    const reloaded = await import("../../install/selfUpdate.js");
    expect(typeof reloaded.runSelfUpdate).toBe("function");
    vi.unstubAllEnvs();
  });
});

describe("pickReExecBin", () => {
  it("returns null when nothing was updated", () => {
    const bin = pickReExecBin({
      updated: [],
      skipped: [],
      failed: [],
      survey: {
        invokedFrom: {
          kind: "dev-source",
          binPath: "/x",
          packageRoot: "/x",
          packageManager: "npm",
          version: null,
        },
        alsoPresent: [],
      },
    });
    expect(bin).toBeNull();
  });

  it("prefers a freshly-updated install matching invokedFrom.kind", () => {
    const bin = pickReExecBin({
      updated: [
        { kind: "project-local", binPath: "/local/bin", packageRoot: "/p", packageManager: "npm", version: "1.7.0" },
        { kind: "global", binPath: "/global/bin", packageRoot: "/g", packageManager: "npm", version: "1.7.0" },
      ],
      skipped: [],
      failed: [],
      survey: {
        invokedFrom: {
          kind: "global",
          binPath: "/global/bin",
          packageRoot: "/g",
          packageManager: "npm",
          version: "1.6.0",
        },
        alsoPresent: [],
      },
    });
    expect(bin).toBe("/global/bin");
  });

  it("falls back to first updated install when none matches invokedFrom.kind", () => {
    const bin = pickReExecBin({
      updated: [
        { kind: "project-local", binPath: "/local/bin", packageRoot: "/p", packageManager: "npm", version: "1.7.0" },
      ],
      skipped: [],
      failed: [],
      survey: {
        invokedFrom: {
          kind: "global",
          binPath: "/g/bin",
          packageRoot: "/g",
          packageManager: "npm",
          version: "1.6.0",
        },
        alsoPresent: [],
      },
    });
    expect(bin).toBe("/local/bin");
  });
});
