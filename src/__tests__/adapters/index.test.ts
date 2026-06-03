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

  // D10-SA10.2-F2: getAdapter attaches an actionable recoveryHint listing the
  // supported tools (derived from the adapter registry) so the CLI can guide
  // the operator to a valid `--tools` value instead of a bare failure.
  it("attaches a recoveryHint naming the supported tools for unknown tool", () => {
    try {
      getAdapter("unknown" as Tool);
      throw new Error("expected throw did not occur");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      const hint = (e as HatchError).recoveryHint;
      expect(hint).toBe(
        "Supported tools: claude, copilot, cursor. Re-run with one of these via `--tools`.",
      );
      // The hint must enumerate every tool the registry can actually build.
      for (const tool of ["claude", "copilot", "cursor"]) {
        expect(hint).toContain(tool);
      }
    }
  });

  it("returns adapters for all supported tools", () => {
    const tools: Tool[] = ["cursor", "copilot", "claude"];
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
    // copilot does not support hooks
    const warnings = getUnsupportedFeatureWarnings("copilot", manifest);
    expect(warnings.some((w) => w.includes("hooks"))).toBe(true);
  });

  it("warns when prompts are enabled but adapter lacks prompt support", () => {
    const manifest = makeManifest({ prompts: true });
    // cursor does not support prompts
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings.some((w) => w.includes("prompts"))).toBe(true);
  });

  it("does not warn when disabled features are unsupported", () => {
    const manifest = makeManifest({ hooks: false, prompts: false });
    const warnings = getUnsupportedFeatureWarnings("copilot", manifest);
    expect(warnings).toEqual([]);
  });

  // ── Finding 3.11: expanded getUnsupportedFeatureWarnings coverage ──

  it("warns when githubAgents are enabled but adapter lacks githubAgent support", () => {
    const manifest = makeManifest({ githubAgents: true });
    // cursor does not support GitHub agents
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings.some((w) => w.includes("GitHub agents"))).toBe(true);
  });

  it("groups multiple unsupported features into a single combined warning", () => {
    const manifest = makeManifest({ prompts: true, githubAgents: true });
    // cursor lacks both prompts and githubAgents — grouped into one line
    const warnings = getUnsupportedFeatureWarnings("cursor", manifest);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("cursor: features enabled but not supported by this adapter:");
    expect(warnings[0]).toContain("prompts");
    expect(warnings[0]).toContain("GitHub agents");
  });

  it("uses singular noun when exactly one feature is unsupported", () => {
    const manifest = makeManifest({ hooks: true });
    const warnings = getUnsupportedFeatureWarnings("copilot", manifest);
    expect(warnings).toEqual(["copilot: feature enabled but not supported by this adapter: hooks"]);
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
describe("adapter sourceFiles provenance (C9-H39)", () => {
  // Adapters that consume canonical files (rules/agents/skills/commands/...).
  // The provenance contract requires sourceFiles to be non-empty on at least
  // one output. Run each adapter with full feature flags so the canonical
  // read path is exercised. All 3 retained adapters consume canonical content.
  const ADAPTERS_WITH_CANONICAL_READS: Tool[] = ["cursor", "claude", "copilot"];

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
});
