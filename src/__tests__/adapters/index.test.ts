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
import { createManifest } from "../../manifest/hatchJson.js";
import { HatchError, type HatchManifest, type Tool } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

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

  // C7-H14: getAdapter throws HatchError (not plain Error) so the CLI can
  // surface a structured exitCode for unknown tool selections.
  it("throws HatchError with VALIDATION_ERROR code for unknown tool", () => {
    try {
      getAdapter("unknown" as Tool);
      throw new Error("expected throw did not occur");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      expect((e as HatchError).exitCode).toBe(1);
    }
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
        handoffs: false,
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
    // amp does not support commands — custom slash commands deprecated
    // by Amp on 2026-01-29 (C9-H23 / D9-SA9.8.F1). Re-verified 2026-05-18.
    const warnings = getUnsupportedFeatureWarnings("amp", manifest);
    expect(warnings.some((w) => w.includes("commands"))).toBe(true);
  });

  it("warns when githubAgents are enabled but adapter lacks githubAgent support", () => {
    const manifest = makeManifest({ githubAgents: true });
    // cursor does not support GitHub agents
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings.some((w) => w.includes("GitHub agents"))).toBe(true);
  });

  it("groups multiple unsupported features into a single combined warning", () => {
    const manifest = makeManifest({ hooks: true, mcp: true, commands: true });
    // aider lacks hooks, mcp, and commands — grouped into one line
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("aider: features enabled but not supported by this adapter:");
    expect(warnings[0]).toContain("hooks");
    expect(warnings[0]).toContain("MCP");
    expect(warnings[0]).toContain("commands");
  });

  it("uses singular noun when exactly one feature is unsupported", () => {
    const manifest = makeManifest({ hooks: true });
    const warnings = getUnsupportedFeatureWarnings("aider", manifest);
    expect(warnings).toEqual(["aider: feature enabled but not supported by this adapter: hooks"]);
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

// ── C9-H39 (D11-SA11.1-01): sourceFiles provenance non-emptiness gate ──
//
// Every adapter that reads canonical content must populate `sourceFiles` on
// at least one of its outputs so the per-output provenance manifest emitted
// by `src/integrity/provenance.ts` can attribute generated artifacts back to
// the canonical files that shaped them. Adapters that bypass
// `BaseAdapter.readTrackedCanonicalFiles` (the wrapper that pushes into
// `_trackedSourceFiles`) by calling `readCanonicalFiles` directly leave the
// `sourceFiles` field unset and break the audit-trail contract.
//
// This test reads the shared canonical fixtures under
// `src/__tests__/fixtures/agents` and runs every adapter's full generate()
// pipeline. Each adapter must produce at least one output whose
// `sourceFiles` array is non-empty.
//
// Excluded: `amp` reads MCP config only (no canonical content path) and
// emits zero outputs against the fixture's empty mcp.servers list — it has
// no canonical-content provenance to track.
describe("adapter sourceFiles provenance (C9-H39)", () => {
  // Adapters that consume canonical files (rules/agents/skills/commands/...).
  // The provenance contract requires sourceFiles to be non-empty on at least
  // one output. Run each adapter with full feature flags so the canonical
  // read path is exercised.
  const ADAPTERS_WITH_CANONICAL_READS: Tool[] = [
    "cursor",
    "claude",
    "copilot",
    "cline",
    "windsurf",
    "gemini",
    "codex",
    "opencode",
    "kiro",
    "goose",
    "zed",
    "aider",
    "amazon-q",
    "antigravity",
  ];

  // Adapters that do not consume canonical content at generate() time. `amp`
  // emits only `.amp/settings.json` from MCP config; with no MCP entries it
  // produces zero outputs and has no provenance to track.
  const ADAPTERS_WITHOUT_CANONICAL_READS: Tool[] = ["amp"];

  for (const tool of ADAPTERS_WITH_CANONICAL_READS) {
    it(`adapter "${tool}" populates sourceFiles on at least one output`, async () => {
      const adapter = getAdapter(tool);
      const manifest = createManifest({ tools: [tool] });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      const outputsWithSourceFiles = outputs.filter(
        (o) => Array.isArray(o.sourceFiles) && o.sourceFiles.length > 0,
      );
      expect(
        outputsWithSourceFiles.length,
        `${tool}: expected at least one output with non-empty sourceFiles. ` +
          `Got ${outputs.length} outputs; none had sourceFiles populated. ` +
          `This usually means the adapter calls readCanonicalFiles directly ` +
          `instead of this.readTrackedCanonicalFiles.`,
      ).toBeGreaterThan(0);
      // Each populated sourceFiles entry must be an absolute path string
      // (canonical file `sourcePath`s are absolute filesystem paths).
      for (const out of outputsWithSourceFiles) {
        for (const src of out.sourceFiles!) {
          expect(typeof src).toBe("string");
          expect(src.length).toBeGreaterThan(0);
        }
      }
    });
  }

  for (const tool of ADAPTERS_WITHOUT_CANONICAL_READS) {
    it(`adapter "${tool}" is documented as not reading canonical content`, async () => {
      const adapter = getAdapter(tool);
      const manifest = createManifest({ tools: [tool] });
      const outputs = await adapter.generate(FIXTURES_DIR, manifest);
      // The fixture manifest has zero MCP servers, so amp produces zero
      // outputs. If the adapter ever starts reading canonical content,
      // move it to ADAPTERS_WITH_CANONICAL_READS and the assertion above
      // will start applying.
      expect(outputs.length).toBe(0);
    });
  }
});
