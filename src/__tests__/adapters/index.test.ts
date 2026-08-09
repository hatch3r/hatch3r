// ── Prompt Regression Testing ──────────────────────────
//
// Adapter outputs contain prompt text derived from canonical content (agents,
// rules, skills), so adapter-generation or template changes can regress the
// instructions delivered to AI tools. Snapshot regression coverage for the 3
// supported adapters (claude, cursor, copilot) lives in
// `src/__tests__/adapters/snapshots.test.ts`; update those snapshots explicitly
// when an adapter-generation or canonical-content change is intentional.

import { describe, it, expect } from "vitest";
import {
  ADAPTER_CAPABILITIES,
  ADAPTER_CAPABILITY_KEYS,
  getAdapter,
  getUnsupportedFeatureWarnings,
} from "../../adapters/index.js";
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

    const codex = getAdapter("codex");
    expect(codex.name).toBe("codex");
  });

  it("throws for unknown tool", () => {
    expect(() => getAdapter("unknown" as Tool)).toThrow("Unknown tool: unknown");
  });

  // C7-H14: getAdapter throws HatchError (not plain Error) so the CLI can
  // surface a structured exitCode for unknown tool selections.
  // D2-SA2.5-01 (Cycle 12 Wave 3): the exitCode is DERIVED from the
  // errorCode via ERROR_CODE_TO_EXIT_CODE (VALIDATION_ERROR -> 64, sysexits
  // EX_USAGE), not a literal. The prior pin asserted `1`, which contradicted
  // the docs/troubleshooting.md "no exit 1 for command failures" contract and
  // froze the wrong value in CI. Pinning 64 keeps the mapping the single
  // source of truth for this call site.
  it("throws HatchError with VALIDATION_ERROR code (exit 64) for unknown tool", () => {
    try {
      getAdapter("unknown" as Tool);
      throw new Error("expected throw did not occur");
    } catch (e) {
      expect(e).toBeInstanceOf(HatchError);
      expect((e as HatchError).errorCode).toBe("VALIDATION_ERROR");
      expect((e as HatchError).exitCode).toBe(64);
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
        "Supported tools: claude, codex, copilot, cursor. Re-run with one of these via `--tools`.",
      );
      // The hint must enumerate every tool the registry can actually build.
      for (const tool of ["claude", "codex", "copilot", "cursor"]) {
        expect(hint).toContain(tool);
      }
    }
  });

  it("returns adapters for all supported tools", () => {
    const tools: Tool[] = ["cursor", "copilot", "claude", "codex"];
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

  // ── D2-SA2.5-02: handoffs joins the warning surface ──
  //
  // `Features.handoffs` toggles the `.hatch3r/handoffs/` bridge segment for
  // every adapter (base.ts threads `ctx.features.handoffs`). The matrix now
  // carries a `handoffs` column (true for all 3 adapters) and the warning loop
  // enumerates it, so the matrix contract "every emission-affecting Features key
  // has a column + a warning row" holds. Because all 3 adapters support it, the
  // warning never fires — pin that so a future `handoffs: false` adapter (or a
  // dropped column) surfaces here.
  it("does not warn when handoffs is enabled for adapters that support it", () => {
    for (const tool of ["cursor", "claude", "copilot"] as Tool[]) {
      const manifest = makeManifest({ handoffs: true });
      const warnings = getUnsupportedFeatureWarnings(tool, manifest);
      expect(
        warnings.some((w) => w.includes("handoffs")),
        `${tool}: handoffs is supported by every adapter — must not warn (got: ${JSON.stringify(warnings)})`,
      ).toBe(false);
    }
  });

  // ── Cycle 11 D2-3 regression: default `prompts` warns no adapter ──
  //
  // A fresh `createManifest({ tools: [tool] })` applies DEFAULT_FEATURES
  // verbatim. Before D2-3, DEFAULT_FEATURES.prompts was `true` while every
  // adapter sets `prompts: false`, so the default init/sync/update path fired a
  // spurious "prompts not supported" warning on each of the 3 adapters with no
  // canonical `prompts/` content able to satisfy it. D2-3 flips the default to
  // `false`; this pins it: no adapter emits a `prompts` warning on the default
  // path. Flipping DEFAULT_FEATURES.prompts back to true fails this test.
  //
  // NOTE: this asserts on the `prompts` substring specifically, not on an empty
  // list — DEFAULT_FEATURES.githubAgents is `true` (a real Copilot feature) so
  // cursor/claude still surface a separate "GitHub agents" not-applicable
  // warning on the default path. That is a distinct issue outside D2-3's scope.
  it("emits no `prompts` unsupported-feature warning on the DEFAULT_FEATURES path (all 3 adapters)", () => {
    for (const tool of ["cursor", "claude", "copilot"] as Tool[]) {
      const manifest = createManifest({ tools: [tool] });
      const warnings = getUnsupportedFeatureWarnings(tool, manifest);
      expect(
        warnings.some((w) => w.includes("prompts")),
        `${tool}: default path must not warn about prompts (got: ${JSON.stringify(warnings)})`,
      ).toBe(false);
    }
  });
});

// ── D2-SA2.5-07: ADAPTER_CAPABILITY_KEYS runtime closed-enum ──
//
// pack-trust-model §5.2 binds a pack manifest's `required_capabilities` to the
// key set of the `AdapterCapability` interface, promising "keys added to
// AdapterCapability in future cycles join the enum automatically". A TS
// interface erases at compile time, so the runtime list must be DERIVED from a
// live matrix row (not hand-copied) for that promise to hold structurally.
// These tests pin the derivation and the per-adapter row-key uniformity the
// enum depends on.
describe("ADAPTER_CAPABILITY_KEYS (D2-SA2.5-07)", () => {
  it("derives the runtime key list from the live matrix row keys", () => {
    const claudeKeys = Object.keys(ADAPTER_CAPABILITIES.claude).sort();
    expect([...ADAPTER_CAPABILITY_KEYS].sort()).toEqual(claudeKeys);
  });

  it("every registered adapter row exposes exactly the ADAPTER_CAPABILITY_KEYS set", () => {
    // The §5.2 closed enum is only well-defined if every adapter row carries the
    // same key set as the derived list — a row that gained or dropped a key
    // would make `required_capabilities` validation adapter-dependent.
    const expected = [...ADAPTER_CAPABILITY_KEYS].sort();
    for (const [tool, caps] of Object.entries(ADAPTER_CAPABILITIES)) {
      expect(
        Object.keys(caps).sort(),
        `${tool}: row key set must equal ADAPTER_CAPABILITY_KEYS`,
      ).toEqual(expected);
    }
  });

  it("includes the feature-flag, extended, and handoffs columns", () => {
    for (const key of [
      "agents",
      "commands",
      "handoffs",
      "worktree",
      "cliTools",
      "nativeQuestionTool",
    ] as const) {
      expect(ADAPTER_CAPABILITY_KEYS).toContain(key);
    }
  });
});

// ── C9-H39 (D11-SA11.1-01): sourceFiles provenance non-emptiness gate ──
//
// Every adapter that reads canonical content must populate `sourceFiles` on
// at least one of its outputs so the per-output provenance manifest emitted
// by `src/manifest/provenance.ts` can attribute generated artifacts back to
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
  const ADAPTERS_WITH_CANONICAL_READS: Tool[] = ["cursor", "claude", "copilot", "codex"];

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
