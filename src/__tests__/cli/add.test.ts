import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("add command", () => {
  let consoleSpy: MockInstance;
  let warnSpy: MockInstance;
  let tempDir: string;
  let cwdSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-add-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  // C8-D1-M8 (D1-SA1.3.1, P1): `hatch3r add` used to throw HatchError with
  // exit code 2 (Bash "misuse of shell builtins" per tldp.org; sysexits
  // EX_USAGE=64) as a placeholder. That mislabelled a valid invocation of an
  // advertised-but-pending feature as user misuse and tripped CI pipelines
  // that probe the subcommand. The command now returns cleanly (exit 0 /
  // EX_OK per sysexits) and prints an informational "coming soon" notice
  // with a roadmap pointer.
  //
  // Wave 7 (1.9.0): the preflight integrity guard was removed alongside
  // the integrity-manifest subsystem. The tests that previously exercised
  // the drift-block behaviour have no implementation to test and were
  // deleted in this wave.
  //
  // Sources (re-verified 2026-04-20):
  //   - https://tldp.org/LDP/abs/html/exitcodes.html (exit 2 = Bash misuse)
  //   - https://man.freebsd.org/cgi/man.cgi?query=sysexits (EX_OK = 0)
  it("returns without throwing (exit 0) when the feature is not yet implemented", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await expect(addCommand()).resolves.toBeUndefined();
  });

  it("prints an informational coming-soon notice and roadmap pointer", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("coming in a future hatch3r release");
    expect(output).toContain("github.com/hatch3r/hatch3r/releases");
    expect(output).toContain("github.com/hatch3r/hatch3r/discussions");
  });
});
