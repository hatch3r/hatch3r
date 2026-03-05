import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

describe("add command", () => {
  let consoleSpy: MockInstance;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("outputs Coming soon! stub message", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Coming soon!");
  });

  it("mentions community packs and follow link", async () => {
    const { addCommand } = await import("../../cli/commands/add.js");
    await addCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("community packs");
    expect(output).toContain("github.com/hatch3r");
  });
});
