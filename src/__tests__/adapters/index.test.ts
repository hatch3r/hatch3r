import { describe, it, expect } from "vitest";
import { getAdapter } from "../../adapters/index.js";
import type { Tool } from "../../types.js";

describe("getAdapter", () => {
  it("returns adapter for known tools", () => {
    const cursor = getAdapter("cursor");
    expect(cursor.name).toBe("cursor");

    const claude = getAdapter("claude");
    expect(claude.name).toBe("claude");
  });

  it("throws for unknown tool", () => {
    expect(() => getAdapter("unknown" as Tool)).toThrow("Unknown tool: unknown");
  });
});
