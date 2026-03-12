// ── Prompt Regression Testing Guidance ──────────────────────────
//
// Adapter outputs contain prompt text derived from canonical content (agents,
// rules, skills). Changes to adapter generation logic or prompt templates can
// cause unintended regressions in the instructions delivered to AI tools.
//
// Future work: add snapshot tests for the main adapters (claude, cursor,
// windsurf, copilot, cline, codex, etc.) that capture the full generated
// output and compare against a stored snapshot. This catches unintended
// prompt changes during refactors. To implement:
//   1. Create a __snapshots__/ directory in this test folder.
//   2. For each adapter, call adapter.generate() with the fixtures and
//      snapshot the output array using expect(outputs).toMatchSnapshot().
//   3. Review snapshot diffs carefully on any adapter or content change --
//      intentional prompt changes should update snapshots explicitly.
//
// Until snapshots are in place, reviewers should manually verify adapter
// output structure when modifying adapter logic or canonical content.

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
