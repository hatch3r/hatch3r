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
import { getAdapter, getUnsupportedFeatureWarnings } from "../../adapters/index.js";
import type { HatchManifest, Tool } from "../../types.js";

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

  it("returns adapters for all supported tools", () => {
    const tools: Tool[] = [
      "cursor", "copilot", "claude", "opencode", "windsurf", "amp",
      "codex", "gemini", "cline", "aider", "kiro", "goose", "zed",
      "amazon-q", "antigravity",
    ];
    for (const tool of tools) {
      const adapter = getAdapter(tool);
      expect(adapter.name).toBe(tool);
    }
  });
});

describe("getUnsupportedFeatureWarnings", () => {
  function makeManifest(features: Partial<HatchManifest["features"]>): HatchManifest {
    return {
      version: "2.0.0",
      hatch3rVersion: "1.4.0",
      platform: "github",
      owner: "",
      repo: "",
      namespace: "",
      project: "",
      tools: ["cursor"],
      features: {
        agents: false,
        skills: false,
        rules: false,
        prompts: false,
        commands: false,
        mcp: false,
        githubAgents: false,
        hooks: false,
        ...features,
      },
      mcp: { servers: [] },
      managedFiles: [],
    };
  }

  it("returns empty array when no features are unsupported", () => {
    const manifest = makeManifest({ agents: true, rules: true, skills: true });
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings).toEqual([]);
  });

  it("returns empty array for unknown tool", () => {
    const manifest = makeManifest({ agents: true });
    const warnings = getUnsupportedFeatureWarnings("unknown-tool", manifest);
    expect(warnings).toEqual([]);
  });

  it("warns when hooks are enabled but adapter lacks hook support", () => {
    const manifest = makeManifest({ hooks: true });
    // aider does not support hooks
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings.some((w) => w.includes("hooks"))).toBe(true);
  });

  it("warns when MCP is enabled but adapter lacks MCP support", () => {
    const manifest = makeManifest({ mcp: true });
    // aider does not support MCP
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings.some((w) => w.includes("MCP"))).toBe(true);
  });

  it("warns when prompts are enabled but adapter lacks prompt support", () => {
    const manifest = makeManifest({ prompts: true });
    // cursor does not support prompts
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings.some((w) => w.includes("prompts"))).toBe(true);
  });

  it("does not warn when disabled features are unsupported", () => {
    const manifest = makeManifest({ hooks: false, mcp: false });
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings).toEqual([]);
  });

  // ── Finding 3.11: expanded getUnsupportedFeatureWarnings coverage ──

  it("warns when commands are enabled but adapter lacks command support", () => {
    const manifest = makeManifest({ commands: true });
    // amp does not support commands
    const warnings = getUnsupportedFeatureWarnings("amp", manifest);
    expect(warnings.some((w) => w.includes("commands"))).toBe(true);
  });

  it("warns when githubAgents are enabled but adapter lacks githubAgent support", () => {
    const manifest = makeManifest({ githubAgents: true });
    // cursor does not support GitHub agents
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings.some((w) => w.includes("GitHub agents"))).toBe(true);
  });

  it("returns multiple warnings when several features are unsupported", () => {
    const manifest = makeManifest({ hooks: true, mcp: true, commands: true });
    // aider lacks hooks, mcp, and commands
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(warnings.some((w) => w.includes("hooks"))).toBe(true);
    expect(warnings.some((w) => w.includes("MCP"))).toBe(true);
    expect(warnings.some((w) => w.includes("commands"))).toBe(true);
  });

  it("returns empty for tools that support all enabled features", () => {
    const manifest = makeManifest({
      agents: true, skills: true, rules: true, hooks: true,
      mcp: true, commands: true,
    });
    // cursor supports all of these
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings).toEqual([]);
  });

  it("warns when skills are enabled for zed (no skills support)", () => {
    const manifest = makeManifest({ skills: true });
    const warnings = getUnsupportedFeatureWarnings("zed", manifest);
    expect(warnings.some((w) => w.includes("skills"))).toBe(true);
  });
});
