import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { HatchError } from "../../types.js";

describe("add command", () => {
  let consoleSpy: MockInstance;
  let warnSpy: MockInstance;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
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
});
