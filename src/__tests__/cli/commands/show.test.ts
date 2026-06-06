// D3-3 (Cycle 11 Wave 2, P2/P5 — CLI command coverage): exercise the
// `hatch3r show <id>` and `hatch3r list <type>` command bodies. show.ts
// (219 LOC) had ~4% scoped coverage. These tests run against the REAL bundled
// canonical content root so id resolution, the frontmatter projection, and the
// body-preview/truncation path are checked end-to-end, plus the missing-arg
// (exit 2) and unknown-id / unknown-type (CONFIG_ERROR / VALIDATION_ERROR)
// failure paths.

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HatchError } from "../../../types.js";

describe("showCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-show-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("throws a usage error (exit 2, VALIDATION_ERROR) when the id is missing", async () => {
    const { showCommand } = await import("../../../cli/commands/show.js");
    await expect(showCommand(undefined)).rejects.toThrow(HatchError);
    try {
      await showCommand(undefined);
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("throws CONFIG_ERROR (with a `list` recovery hint) for an unknown id", async () => {
    const { showCommand } = await import("../../../cli/commands/show.js");
    await expect(showCommand("no-such-artifact-xyz")).rejects.toThrow(HatchError);
    try {
      await showCommand("no-such-artifact-xyz");
    } catch (e) {
      expect((e as HatchError).errorCode).toBe("CONFIG_ERROR");
      expect((e as HatchError).recoveryHint).toContain("hatch3r list");
    }
  });

  it("prints frontmatter header + a body preview for a real canonical agent", async () => {
    const { showCommand } = await import("../../../cli/commands/show.js");
    await showCommand("hatch3r-implementer");
    const out = logged();
    expect(out).toContain("Artifact: hatch3r-implementer");
    expect(out).toContain("Type");
    expect(out).toContain("agent");
    // hatch3r-implementer is a long agent body, so the preview is truncated and
    // the footer pointing at the source file must appear.
    expect(out).toContain("more line(s) — open");
  });

  it("resolves an id supplied WITHOUT the hatch3r- prefix", async () => {
    const { showCommand } = await import("../../../cli/commands/show.js");
    await showCommand("implementer");
    expect(logged()).toContain("Artifact: hatch3r-implementer");
  });
});

describe("listCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-list-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("throws a usage error (exit 2) for an unknown type", async () => {
    const { listCommand } = await import("../../../cli/commands/show.js");
    await expect(listCommand("widgets")).rejects.toThrow(HatchError);
    try {
      await listCommand("widgets");
    } catch (e) {
      expect((e as HatchError).exitCode).toBe(2);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("enumerates canonical agents and lists hatch3r-implementer among them", async () => {
    const { listCommand } = await import("../../../cli/commands/show.js");
    await listCommand("agent");
    const out = logged();
    expect(out).toMatch(/agent \(\d+\):/);
    expect(out).toContain("hatch3r-implementer");
  });

  it("accepts the plural type alias (agents → agent)", async () => {
    const { listCommand } = await import("../../../cli/commands/show.js");
    await listCommand("agents");
    expect(logged()).toMatch(/agent \(\d+\):/);
  });
});
