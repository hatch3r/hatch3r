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

  it("throws HatchError with exit code 2 (not yet implemented)", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await expect(addCommand()).rejects.toThrow(HatchError);
    await expect(addCommand()).rejects.toThrow("not yet implemented");
  });

  it("mentions community packs and follow link before throwing", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    try {
      await addCommand();
    } catch {
      // Expected
    }

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("community packs");
    expect(output).toContain("github.com/hatch3r");
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

    it("with --force, falls through to the not-implemented error", async () => {
      await seedDriftScenario(tempDir);

      const { addCommand } = await import("../../cli/commands/add.js");
      try {
        await addCommand({ force: true });
        expect.fail("addCommand should have thrown");
      } catch (e) {
        const err = e as HatchError;
        // With --force we bypass the integrity gate and reach the existing
        // "not yet implemented" error path.
        expect(err.errorCode).toBe("VALIDATION_ERROR");
        expect(err.message).toContain("not yet implemented");
      }
    });
  });
});
