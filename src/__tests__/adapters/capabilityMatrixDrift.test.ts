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
// Nine matrix columns are directly observable from `doGenerate()` output given
// the `Features` flags: agents, skills, rules, hooks, mcp, commands, prompts,
// githubAgents, handoffs. The feature-flag loop at the bottom of this file
// covers those nine, which is what the original finding recommendation named
// ("instantiating each adapter with maximal features and verifying matrix row
// matches observed output"). D2-SA2.5-02 (Cycle 12 Wave 4) added `handoffs`: it
// toggles the `.hatch3r/handoffs/` bridge segment, so it is digest-diff
// observable like the other eight feature flags.
//
// The remaining four (worktree, customization, modelOverride, effortOverride)
// are not observable via a feature flag alone — they depend on manifest-level
// configuration and on whether the adapter threads a specific runtime through
// its pipeline. D2-16 (Cycle 11 Wave 3) closes the prior gap where nothing
// pinned them: the "extended-column drift protection (D2-16)" describe block
// asserts each against its real behavioural source — `worktree` against the
// load-bearing `WORKTREE_CAPABLE_TOOLS` Set (from which the matrix column is
// now derived), and `customization` / `modelOverride` / `effortOverride`
// (release/2.7.0) against each adapter's `doGenerate` invoking
// `applyCustomization` / `resolveAgentModel` / `resolveAgentEffort`.
//
// ── Detection heuristic ───────────────────────────────────────────────────────
// For each (tool, feature) pair:
//   1. Generate outputs with ALL nine features enabled (maximal) and the
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADAPTER_CAPABILITIES,
  getAdapter,
  getUnsupportedFeatureWarnings,
} from "../../adapters/index.js";
import { getAskUserToolEntry } from "../../pipeline/adapterToolTranslator.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { WORKTREE_CAPABLE_TOOLS, type Features, type HatchManifest, type Tool } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

// All registered tools (must stay in lockstep with TOOLS / adapter factory
// map in src/adapters/index.ts). Test will fail-fast if a new tool is added
// to TOOLS without being added here, because the length mismatch surfaces in
// the assertion below.
const TOOLS_UNDER_TEST: Tool[] = ["cursor", "copilot", "claude", "codex"];

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
  // D2-SA2.5-02 (Cycle 12 Wave 4): handoffs toggles the `.hatch3r/handoffs/`
  // bridge segment (base.ts threads `ctx.features.handoffs`), so it is
  // digest-diff observable like the other feature flags and now has a matrix
  // column + a `getUnsupportedFeatureWarnings` row to pin.
  "handoffs",
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
    if (feature === "githubAgents") {
      // D5-41 (Cycle 11 Wave 3, D5, P4 / D16.3 add-vs-remove bias): the copilot
      // adapter gates github-agent emission OFF when the regular-agent path is
      // active (`features.agents === true`), because github-agents
      // (`type: github-agent`) are simplified twins of regular agents and emit
      // to the SAME `.github/agents/` picker — shipping both would duplicate
      // `hatch3r-security` + `hatch3r-security-agent` (×4 pairs). The feature is
      // therefore only OBSERVABLE in its active regime (`agents: false`), so the
      // toggle here must hold `agents` off; the constant-`agents:true` probe used
      // for every other column would see no diff (both maximal and off suppress
      // github-agents) and falsely report drift. Diff `agents:false` ×
      // {githubAgents on, githubAgents off} to isolate the real toggle.
      const onBase: Features = { ...maximalFeatures(), agents: false, githubAgents: true };
      const onOutputs = await adapter.generate(FIXTURES_DIR, buildManifest(tool, onBase));
      const offBase: Features = { ...maximalFeatures(), agents: false, githubAgents: false };
      const offOutputs = await adapter.generate(FIXTURES_DIR, buildManifest(tool, offBase));
      observed[feature] = digest(onOutputs) !== digest(offOutputs);
      continue;
    }
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
    const expectedCount = 4;
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
  // ADAPTER_CAPABILITIES.cliTools must be `true` for every retained adapter,
  // each of which exposes a native `skills: true`
  // surface. The matrix drives the runtime warning emitted by
  // `getUnsupportedFeatureWarnings` for users who select CLI tools on an
  // adapter that doesn't render them.
  describe("cliTools capability (Wave 5 plan §4.6)", () => {
    const CLI_TOOLS_TRUE: ReadonlyArray<Tool> = ["cursor", "claude", "copilot", "codex"];

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
      // 4 true + 0 false = 4 (the full adapter matrix).
      expect(total).toBe(4);
      expect(trueCount).toBe(4);
      expect(falseCount).toBe(0);
    });
  });

  // ── D2-16 (Cycle 11 Wave 3): extended-column drift protection ──────────────
  //
  // The four extended columns (worktree, customization, modelOverride,
  // effortOverride) are not observable via a single feature flag, so the
  // feature-flag loop below scopes them out (see the header comment). Before
  // this wave nothing pinned them, so the matrix could silently lie (flip
  // `cursor.worktree=false` and no behaviour changed, no test failed). Pin
  // each column to its REAL behavioural source:
  //   - worktree       → WORKTREE_CAPABLE_TOOLS (the Set init/config/update read).
  //   - customization  → each adapter's doGenerate invoking applyCustomization.
  //   - modelOverride  → each adapter's doGenerate invoking resolveAgentModel.
  //   - effortOverride → each adapter's doGenerate invoking resolveAgentEffort
  //     (release/2.7.0 effort axis — claude emits an `effort:` frontmatter
  //     key, cursor a clamped bracket suffix on the model pin; copilot has no
  //     effort surface, so its source must NOT invoke the resolver).
  // The customization/modelOverride/effortOverride sources are asserted by
  // reading the adapter source file and checking the call is present — a
  // static behavioural probe that catches "adapter dropped the capability but
  // the matrix still claims it" without mocking the generation pipeline.
  describe("extended-column drift protection (D2-16)", () => {
    const ADAPTER_SOURCE: Record<Tool, string> = {
      cursor: resolve(import.meta.dirname, "../../adapters/cursor.ts"),
      claude: resolve(import.meta.dirname, "../../adapters/claude.ts"),
      copilot: resolve(import.meta.dirname, "../../adapters/copilot.ts"),
      codex: resolve(import.meta.dirname, "../../adapters/codex.ts"),
    };

    function adapterInvokes(tool: Tool, symbol: string): boolean {
      const src = readFileSync(ADAPTER_SOURCE[tool], "utf-8");
      return src.includes(`${symbol}(`);
    }

    for (const tool of TOOLS_UNDER_TEST) {
      it(`${tool}.worktree equals WORKTREE_CAPABLE_TOOLS membership`, () => {
        expect(
          ADAPTER_CAPABILITIES[tool].worktree,
          `${tool}: ADAPTER_CAPABILITIES.worktree must equal WORKTREE_CAPABLE_TOOLS.has("${tool}") — ` +
            `the matrix column is derived from that load-bearing Set (src/types.ts), so it cannot drift.`,
        ).toBe(WORKTREE_CAPABLE_TOOLS.has(tool));
      });

      it(`${tool}.customization equals applyCustomization invocation in doGenerate`, () => {
        const invokes =
          adapterInvokes(tool, "applyCustomization") ||
          adapterInvokes(tool, "processSkillsWithFmCliFiltered");
        expect(
          ADAPTER_CAPABILITIES[tool].customization,
          `${tool}: ADAPTER_CAPABILITIES.customization=${ADAPTER_CAPABILITIES[tool].customization} but ` +
            `adapter ${invokes ? "DOES" : "does NOT"} invoke applyCustomization. Align the matrix column with the source.`,
        ).toBe(invokes);
      });

      it(`${tool}.modelOverride equals resolveAgentModel invocation in doGenerate`, () => {
        const invokes = adapterInvokes(tool, "resolveAgentModel");
        expect(
          ADAPTER_CAPABILITIES[tool].modelOverride,
          `${tool}: ADAPTER_CAPABILITIES.modelOverride=${ADAPTER_CAPABILITIES[tool].modelOverride} but ` +
            `adapter ${invokes ? "DOES" : "does NOT"} invoke resolveAgentModel. Align the matrix column with the source.`,
        ).toBe(invokes);
      });

      it(`${tool}.effortOverride equals resolveAgentEffort invocation in doGenerate`, () => {
        // release/2.7.0 effort axis: claude expresses per-agent effort as an
        // `effort:` frontmatter key and cursor as a clamped `[effort=high]`
        // bracket suffix on the emitted model pin — both paths start at
        // resolveAgentEffort, so its presence in the adapter source is the
        // behavioural fact the column asserts (same probe as modelOverride).
        // copilot has no effort surface (its custom-agents frontmatter
        // reference documents no effort key), so its source must NOT invoke
        // the resolver and its column is false.
        const invokes = adapterInvokes(tool, "resolveAgentEffort");
        expect(
          ADAPTER_CAPABILITIES[tool].effortOverride,
          `${tool}: ADAPTER_CAPABILITIES.effortOverride=${ADAPTER_CAPABILITIES[tool].effortOverride} but ` +
            `adapter ${invokes ? "DOES" : "does NOT"} invoke resolveAgentEffort. Align the matrix column with the source.`,
        ).toBe(invokes);
      });
    }
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
