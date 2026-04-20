import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../types.js";

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
  // with a roadmap pointer. The preflight integrity guard still rejects
  // with exit 1 on drift — those tests live in the nested describe below.
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

  // C7-H5 (D15, OWASP ASI 2026): Preflight integrity check tests
  describe("preflight integrity check (C7-H5)", () => {
    async function seedDriftScenario(root: string): Promise<void> {
      const { generateIntegrityManifest, writeIntegrityManifest } = await import("../../integrity/index.js");
      const agentsDir = join(root, ".agents");
      await mkdir(join(agentsDir, "rules"), { recursive: true });
      await writeFile(
        join(agentsDir, "rules", "hatch3r-test.md"),
        "---\nid: hatch3r-test\ntype: rule\ndescription: original\n---\n# Original\n",
      );
      const manifest = await generateIntegrityManifest(agentsDir, "1.0.0");
      await writeIntegrityManifest(agentsDir, manifest);
      // Now drift the file after the manifest was sealed
      await writeFile(
        join(agentsDir, "rules", "hatch3r-test.md"),
        "tampered content",
      );
    }

    it("refuses to proceed on integrity drift without --force", async () => {
      await seedDriftScenario(tempDir);

      const { addCommand } = await import("../../cli/commands/add.js");
      try {
        await addCommand();
        expect.fail("addCommand should have thrown");
      } catch (e) {
        const err = e as HatchError;
        expect(err.errorCode).toBe("INTEGRITY_ERROR");
        expect(err.exitCode).toBe(1);
      }
    });

    it("with --force, bypasses the integrity gate and reaches the coming-soon notice", async () => {
      await seedDriftScenario(tempDir);

      const { addCommand } = await import("../../cli/commands/add.js");
      // C8-D1-M8 (D1-SA1.3.1): with --force we bypass the integrity gate and
      // reach the informational "coming soon" path, which now returns cleanly
      // (exit 0) instead of throwing a VALIDATION_ERROR.
      await expect(addCommand({ force: true })).resolves.toBeUndefined();

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("coming in a future hatch3r release");
    });
  });
});
