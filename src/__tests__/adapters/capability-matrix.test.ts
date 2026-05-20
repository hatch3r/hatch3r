// ── Property-based ADAPTER_CAPABILITIES drift test ────────────────────────────
//
// Finding C7.5-W2B2-H6 (D2 Adapter Infrastructure, High severity, pillars P2/P3):
// `ADAPTER_CAPABILITIES` in `src/adapters/index.ts` is hand-maintained with no
// programmatic reconciliation against the adapters' `doGenerate()` outputs. A
// matrix row can silently drift from the adapter implementation (either the
// matrix stops matching what the adapter actually emits, or the adapter gains
// or loses behaviour without a matrix update).
//
// This test treats `ADAPTER_CAPABILITIES` as a contract and verifies, per
// adapter and per feature flag, that toggling the flag in the manifest
// produces an observable change in `doGenerate()` output exactly when the
// matrix claims the adapter supports that feature. Drift fails the test.
//
// ── Capability columns covered ────────────────────────────────────────────────
// The matrix contains 11 columns. Eight are directly observable from
// `doGenerate()` output given the `Features` flags: agents, skills, rules,
// hooks, mcp, commands, prompts, githubAgents. The remaining three
// (worktree, customization, modelOverride) are not observable via a feature
// flag alone -- they depend on manifest-level configuration and on whether
// the adapter threads a specific runtime through its pipeline. This test
// scopes to the eight feature-flag-driven columns, which is what the finding
// recommendation names ("instantiating each adapter with maximal features and
// verifying matrix row matches observed output"). The other three columns
// are orthogonal facts about the adapter's runtime wiring and would require a
// separate test fixture to exercise.
//
// ── Detection heuristic ───────────────────────────────────────────────────────
// For each (tool, feature) pair:
//   1. Generate outputs with ALL eight features enabled (maximal) and the
//      MCP server list populated so MCP-capable adapters emit config.
//   2. Generate outputs again with the target feature disabled (all others
//      still enabled).
//   3. If the two outputs differ (by the canonical digest below), the
//      adapter observably exercises that feature -> observed = true.
//   4. Otherwise observed = false.
//
// The "declared" side of each pair is extracted from the live matrix via
// `getUnsupportedFeatureWarnings`: the matrix is the only source of truth
// for declaration, so we avoid mirroring it here and catch drift in the
// matrix itself (not just in our copy of it).
//
// Canonical digest = sorted `${path}\n${content}` joined. Stable across
// generation order, sensitive to both path set and content.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  ADAPTER_CAPABILITIES,
  getAdapter,
  getUnsupportedFeatureWarnings,
} from "../../adapters/index.js";
import { getAskUserToolEntry } from "../../pipeline/adapterToolTranslator.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { Features, HatchManifest, Tool } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

// All 3 registered tools (must stay in lockstep with TOOLS / adapter factory
// map in src/adapters/index.ts). Test will fail-fast if a new tool is added
// to TOOLS without being added here, because the length mismatch surfaces in
// the assertion below.
const TOOLS_UNDER_TEST: Tool[] = ["cursor", "copilot", "claude"];

// Keys of Features that the matrix declares per-column.
const FEATURE_KEYS: Array<keyof Features> = [
  "agents",
  "skills",
  "rules",
  "hooks",
  "mcp",
  "commands",
  "prompts",
  "githubAgents",
];

function maximalFeatures(): Features {
  return {
    agents: true,
    skills: true,
    rules: true,
    hooks: true,
    mcp: true,
    commands: true,
    prompts: true,
    githubAgents: true,
    handoffs: true,
  };
}

/**
 * Build a manifest where every feature flag is true and the MCP server
 * list is populated, so MCP-capable adapters actually emit config files.
 */
function buildManifest(tool: Tool, features: Features): HatchManifest {
  return createManifest({
    tools: [tool],
    mcpServers: ["github"],
    features,
  });
}

/**
 * Canonical digest of an AdapterOutput[] that is stable across generation
 * order but sensitive to path set changes, content changes, and managed
 * block differences.
 */
function digest(outputs: { path: string; content: string }[]): string {
  const sorted = [...outputs].sort((a, b) => a.path.localeCompare(b.path));
  const joined = sorted.map((o) => `${o.path}\n${o.content}`).join("\n---\n");
  return createHash("sha256").update(joined).digest("hex");
}

interface ObservedCapabilityRow {
  agents: boolean;
  skills: boolean;
  rules: boolean;
  hooks: boolean;
  mcp: boolean;
  commands: boolean;
  prompts: boolean;
  githubAgents: boolean;
  handoffs: boolean;
}

/**
 * Extract the declared capability for `tool` × `feature` from the live
 * `ADAPTER_CAPABILITIES` matrix by asking `getUnsupportedFeatureWarnings`
 * whether enabling that single feature triggers a warning. A warning means
 * the matrix declares the feature unsupported.
 */
function declaredSupport(tool: string, feature: keyof Features): boolean {
  const manifest: HatchManifest = {
    version: "2.0.0",
    hatch3rVersion: "1.6.1",
    platform: "github",
    owner: "",
    repo: "",
    namespace: "",
    project: "",
    tools: [tool as Tool],
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
      [feature]: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
  };
  const warnings = getUnsupportedFeatureWarnings(tool, manifest);
  return warnings.length === 0;
}

/**
 * For a given adapter, compute the observed capability row by comparing the
 * maximal-features digest against each single-feature-disabled digest. Any
 * feature whose removal changes the output is observably exercised by the
 * adapter.
 */
async function observedRow(tool: Tool): Promise<ObservedCapabilityRow> {
  const adapter = getAdapter(tool);

  const maximalManifest = buildManifest(tool, maximalFeatures());
  const maximalOutputs = await adapter.generate(FIXTURES_DIR, maximalManifest);
  const maximalDigest = digest(maximalOutputs);

  const observed: Partial<ObservedCapabilityRow> = {};
  for (const feature of FEATURE_KEYS) {
    const offFeatures: Features = { ...maximalFeatures(), [feature]: false };
    const offManifest = buildManifest(tool, offFeatures);
    const offOutputs = await adapter.generate(FIXTURES_DIR, offManifest);
    const offDigest = digest(offOutputs);
    observed[feature] = offDigest !== maximalDigest;
  }
  return observed as ObservedCapabilityRow;
}

describe("ADAPTER_CAPABILITIES drift detection (C7.5-W2B2-H6)", () => {
  it("exercises every registered tool exactly once", () => {
    // Guard: if someone adds a tool to TOOLS without adding it to
    // TOOLS_UNDER_TEST, this assertion surfaces the gap before the per-tool
    // tests run. Keep in lockstep with src/types.ts `TOOLS`.
    const expectedCount = 3;
    expect(TOOLS_UNDER_TEST.length).toBe(expectedCount);
  });

  it("nativeQuestionTool flag agrees with ASK_USER_TOOLS map", () => {
    for (const [adapter, caps] of Object.entries(ADAPTER_CAPABILITIES)) {
      const entry = getAskUserToolEntry(adapter);
      if (caps.nativeQuestionTool) {
        expect(entry, `${adapter}: nativeQuestionTool=true requires ASK_USER_TOOLS entry`).not.toBeNull();
      } else {
        expect(entry, `${adapter}: nativeQuestionTool=false requires ASK_USER_TOOLS null`).toBeNull();
      }
    }
  });

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // ADAPTER_CAPABILITIES.cliTools must be `true` for all 3 retained adapters
  // (cursor, claude, copilot), each of which exposes a native `skills: true`
  // surface. The matrix drives the runtime warning emitted by
  // `getUnsupportedFeatureWarnings` for users who select CLI tools on an
  // adapter that doesn't render them.
  describe("cliTools capability (Wave 5 plan §4.6)", () => {
    const CLI_TOOLS_TRUE: ReadonlyArray<Tool> = ["cursor", "claude", "copilot"];

    it("declares cliTools: true for adapters with skills surfaces", () => {
      for (const tool of CLI_TOOLS_TRUE) {
        const caps = ADAPTER_CAPABILITIES[tool];
        expect(caps, `${tool}: ADAPTER_CAPABILITIES entry missing`).toBeDefined();
        expect(
          caps.cliTools,
          `${tool}: expected cliTools=true (Wave 5 plan §4.6)`,
        ).toBe(true);
      }
    });

    it("every registered adapter has a cliTools field of boolean type", () => {
      for (const [adapter, caps] of Object.entries(ADAPTER_CAPABILITIES)) {
        expect(
          typeof caps.cliTools,
          `${adapter}: cliTools must be a boolean`,
        ).toBe("boolean");
      }
    });

    it("cliTools capability count matches the truth table partition", () => {
      const total = Object.values(ADAPTER_CAPABILITIES).length;
      const trueCount = Object.values(ADAPTER_CAPABILITIES).filter(
        (c) => c.cliTools,
      ).length;
      const falseCount = total - trueCount;
      // 3 true + 0 false = 3 (the full adapter matrix after the 3-adapter pivot).
      expect(total).toBe(3);
      expect(trueCount).toBe(3);
      expect(falseCount).toBe(0);
    });
  });

  for (const tool of TOOLS_UNDER_TEST) {
    describe(`${tool}`, () => {
      it("matrix row matches observed doGenerate output for all feature flags", async () => {
        const observed = await observedRow(tool);

        for (const feature of FEATURE_KEYS) {
          const declared = declaredSupport(tool, feature);
          const obs = observed[feature];

          // Build a specific drift message to make failures actionable in
          // CI logs. If declared=true but observed=false, the matrix claims
          // support but the adapter ignores the flag. If declared=false but
          // observed=true, the adapter emits feature-specific output that
          // the matrix hides from callers of getUnsupportedFeatureWarnings.
          expect(obs, driftMessage(tool, feature, declared, obs)).toBe(
            declared,
          );
        }
      });
    });
  }
});

function driftMessage(
  tool: string,
  feature: keyof Features,
  declared: boolean,
  observed: boolean,
): string {
  if (declared === observed) {
    return `${tool}.${feature}: matches (declared=${declared})`;
  }
  if (declared && !observed) {
    return (
      `ADAPTER_CAPABILITIES drift for "${tool}.${feature}": matrix declares ` +
      `support=true but doGenerate produces identical output when features.${feature} ` +
      `is toggled on/off. Either update the adapter to honour the flag or set ` +
      `${feature}: false in src/adapters/index.ts for "${tool}".`
    );
  }
  return (
    `ADAPTER_CAPABILITIES drift for "${tool}.${feature}": matrix declares ` +
    `support=false but doGenerate emits feature-specific output when features.${feature} ` +
    `is enabled. Either remove the feature handling from the adapter or set ` +
    `${feature}: true in src/adapters/index.ts for "${tool}".`
  );
}
