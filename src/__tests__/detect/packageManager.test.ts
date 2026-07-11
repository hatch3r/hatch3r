import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPackageManager } from "../../detect/packageManager.js";
import { setVerbose } from "../../cli/shared/ui.js";

// D1-SA1.6-02 (D1, P3): dedicated coverage for `detectPackageManager`. Before
// this file the function was exercised only transitively via repoAnalyzer, and
// that path probed `bun.lockb` alone — so the missing `bun.lock` (Bun >=1.2
// text lockfile, default since Jan 2025) was invisible to CI. These cases pin
// all four lockfiles, the bun text/binary pair, the default fallback, and the
// F7 `source` field the fallback now surfaces under --verbose.
describe("detectPackageManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-pm-detect-"));
  });

  afterEach(async () => {
    setVerbose(false);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects bun from the text lockfile bun.lock (Bun >=1.2 default)", async () => {
    await writeFile(join(tempDir, "bun.lock"), "# bun lockfile v1\n", "utf-8");
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("bun");
    expect(pm.source).toBe("lockfile");
    expect(pm.installCmd).toBe("bun");
  });

  it("detects bun from the binary lockfile bun.lockb (pre-1.2)", async () => {
    await writeFile(join(tempDir, "bun.lockb"), "\0binary", "utf-8");
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("bun");
    expect(pm.source).toBe("lockfile");
  });

  it("detects bun when both bun.lock and bun.lockb are present (migration overlap)", async () => {
    await writeFile(join(tempDir, "bun.lock"), "# bun lockfile v1\n", "utf-8");
    await writeFile(join(tempDir, "bun.lockb"), "\0binary", "utf-8");
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("bun");
    expect(pm.source).toBe("lockfile");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: 6.0\n", "utf-8");
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("pnpm");
    expect(pm.source).toBe("lockfile");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(tempDir, "yarn.lock"), "# yarn lockfile v1\n", "utf-8");
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("yarn");
    expect(pm.source).toBe("lockfile");
  });

  it("defaults to npm with source 'default' when no lockfile is present", async () => {
    const pm = await detectPackageManager(tempDir);
    expect(pm.name).toBe("npm");
    expect(pm.source).toBe("default");
    expect(pm.updateArgs).toEqual(["install", "hatch3r@latest"]);
  });

  it("emits a --verbose fallback diagnostic naming the default (F7 surfaced)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(true);

    const pm = await detectPackageManager(tempDir);
    expect(pm.source).toBe("default");

    const stderr = spy.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(
      stderr.some((line) => /detectPackageManager: no recognized lockfile/.test(line)),
    ).toBe(true);
    spy.mockRestore();
  });

  it("stays silent (no fallback diagnostic) when a lockfile is detected", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(true);

    await writeFile(join(tempDir, "bun.lock"), "# bun lockfile v1\n", "utf-8");
    await detectPackageManager(tempDir);

    const stderr = spy.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(stderr.some((line) => /no recognized lockfile/.test(line))).toBe(false);
    spy.mockRestore();
  });
});
