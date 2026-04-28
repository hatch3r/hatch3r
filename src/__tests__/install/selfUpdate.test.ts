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

const FAKE_GLOBAL_ROOT = "/fake/global/lib/node_modules";

describe("runSelfUpdate", () => {
  let tempDir: string;
  const originalArgv1 = process.argv[1];
  const originalPlatform = process.platform;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-self-update-"));
    _resetNpmGlobalRootCacheForTesting();
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
  });

  afterEach(async () => {
    process.argv[1] = originalArgv1;
    Object.defineProperty(process, "platform", { value: originalPlatform });
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

  it("skips global self-update on Windows with guided message", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
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

    let callIndex = 0;
    vi.mocked(execFileSync).mockImplementation((..._args: unknown[]) => {
      if (callIndex === 0) {
        callIndex++;
        return Buffer.from(`${fakeRoot}\n`); // npm root -g
      }
      if (callIndex === 1) {
        callIndex++;
        return Buffer.from(""); // primary install succeeds
      }
      callIndex++;
      throw new Error("EACCES: permission denied (global install)");
    });

    const result = await runSelfUpdate(tempDir);
    expect(result.updated.length).toBe(1);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.location.kind).toBe("global");
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
});
