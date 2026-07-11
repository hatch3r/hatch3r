import { describe, it, expect } from "vitest";
import { resolveAgentModel, resolveArtifactModel, withProviderPrefix } from "../../models/resolve.js";
import type { CanonicalFile, HatchManifest } from "../../types.js";

function makeAgent(overrides: Partial<CanonicalFile> = {}): CanonicalFile {
  return {
    id: "hatch3r-implementer",
    type: "agent",
    description: "Test agent",
    content: "",
    rawContent: "",
    sourcePath: "",
    ...overrides,
  };
}

function makeManifest(overrides: Partial<HatchManifest> = {}): HatchManifest {
  return {
    version: "2.0.0",
    hatch3rVersion: "1.0.0",
    platform: "github",
    owner: "test",
    repo: "test",
    namespace: "test",
    project: "test",
    tools: ["cursor"],
    features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, githubAgents: true, hooks: true, handoffs: true },
    mcp: { servers: [] },
    managedFiles: [],
    ...overrides,
  };
}

describe("resolveAgentModel", () => {
  it("returns undefined when nothing is configured", () => {
    const agent = makeAgent();
    const manifest = makeManifest();
    const result = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(result).toBeUndefined();
  });

  it("uses manifest default when set", () => {
    const agent = makeAgent();
    const manifest = makeManifest({ models: { default: "opus" } });
    const result = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(result).toBe("claude-opus-4-8");
  });

  it("uses agent model when set in canonical frontmatter", () => {
    const agent = makeAgent({ model: "sonnet" });
    const manifest = makeManifest();
    const result = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(result).toBe("claude-sonnet-4-6");
  });

  it("uses manifest per-agent override when set", () => {
    const agent = makeAgent({ model: "sonnet" });
    const manifest = makeManifest({
      models: { default: "opus", agents: { "hatch3r-implementer": "codex" } },
    });
    const result = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(result).toBe("gpt-5.3-codex");
  });

  it("uses customize when provided (highest priority)", () => {
    const agent = makeAgent({ model: "sonnet" });
    const manifest = makeManifest({
      models: { default: "opus", agents: { "hatch3r-implementer": "codex" } },
    });
    const customize = { model: "haiku" };
    const result = resolveAgentModel(
      "hatch3r-implementer",
      agent,
      manifest,
      customize,
    );
    expect(result).toBe("claude-haiku-4-5");
  });

  it("resolves aliases", () => {
    const agent = makeAgent({ model: "gemini-pro" });
    const manifest = makeManifest();
    const result = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(result).toBe("gemini-3.1-pro");
  });

  it("resolves haiku to the current GA haiku model (D1-SA1.6-03 currency pin extension)", () => {
    // D1-25 pinned only the tier that failed in Cycle 11 (opus); D1-SA1.6-03
    // found the guard gap let the sonnet row go stale undetected. Pin haiku
    // here (current per the vendor model table, verified 2026-07-11). The
    // sonnet pin joins when the queued alias bump lands — `sonnet` currently
    // resolves to the previous-generation claude-sonnet-4-6, and the bump to
    // claude-sonnet-5 must move in lock-step with costEstimator.ts
    // TIER_ALIASES/MODEL_RATES and docs/model-selection.md (aliases.ts:10-14).
    const agent = makeAgent({ model: "haiku" });
    const manifest = makeManifest();
    expect(resolveAgentModel("hatch3r-implementer", agent, manifest)).toBe("claude-haiku-4-5");
  });

  it("resolves opus to the current GA opus model (D1-25 currency)", () => {
    // The `opus` row was two GA generations stale (`claude-opus-4-6`) until the
    // D1-25 bump; lock the current target so a future stale value fails here.
    const agent = makeAgent({ model: "opus" });
    const manifest = makeManifest();
    expect(resolveAgentModel("hatch3r-implementer", agent, manifest)).toBe("claude-opus-4-8");
  });

  it("passes the capacity-tier words standard/fast through verbatim (D5-21)", () => {
    // `standard`/`fast` are hatch3r-internal triage/cost tiers, NOT MODEL_ALIASES
    // keys: resolveModelAlias has no entry, so they must pass through unchanged.
    // The Claude/Copilot adapters then gate native `model:` emission to
    // recognizable values (isClaudeRecognizableModel / isCopilotRecognizableModel),
    // omitting the tier word from frontmatter rather than shipping a value Claude
    // would reject (sonnet/opus/haiku/id/inherit only). This test locks the
    // passthrough contract so a regression that aliases the tier words — which
    // would re-introduce the dead native field D9-16 removed — fails here.
    const manifest = makeManifest();
    for (const tier of ["standard", "fast"]) {
      const agent = makeAgent({ model: tier });
      expect(resolveAgentModel("hatch3r-implementer", agent, manifest)).toBe(tier);
    }
  });

  it("falls back through priority chain: customize > per-agent > frontmatter > default", () => {
    const agent = makeAgent({ model: "sonnet" });
    const manifest = makeManifest({
      models: { default: "opus", agents: { "hatch3r-implementer": "codex" } },
    });
    // Without customize: per-agent override wins over frontmatter and default
    const withoutCustom = resolveAgentModel("hatch3r-implementer", agent, manifest);
    expect(withoutCustom).toBe("gpt-5.3-codex");

    // With customize: customize wins over everything
    const withCustom = resolveAgentModel("hatch3r-implementer", agent, manifest, { model: "haiku" });
    expect(withCustom).toBe("claude-haiku-4-5");
  });
});

// release/2.2.0: per-artifact model resolution generalized to skills and
// commands. `models.default` stays agents-only by design (a default feeding
// skills/commands would grow model lines in every generated skill/command —
// a byte-stability break; a command-level model switches the whole
// conversation model).
describe("resolveArtifactModel", () => {
  it("returns undefined when nothing is configured, for every class", () => {
    const manifest = makeManifest();
    for (const cls of ["agents", "skills", "commands"] as const) {
      expect(resolveArtifactModel(cls, "hatch3r-feature", undefined, manifest)).toBeUndefined();
    }
  });

  it("resolves the per-class manifest map for skills and commands", () => {
    const manifest = makeManifest({
      models: {
        skills: { "hatch3r-feature": "opus" },
        commands: { "hatch3r-workflow": "sonnet" },
      },
    });
    expect(resolveArtifactModel("skills", "hatch3r-feature", undefined, manifest)).toBe("claude-opus-4-8");
    expect(resolveArtifactModel("commands", "hatch3r-workflow", undefined, manifest)).toBe("claude-sonnet-4-6");
    // Maps are class-scoped: a skills entry never leaks into commands and
    // vice versa.
    expect(resolveArtifactModel("commands", "hatch3r-feature", undefined, manifest)).toBeUndefined();
    expect(resolveArtifactModel("skills", "hatch3r-workflow", undefined, manifest)).toBeUndefined();
  });

  it("follows precedence customize > manifest map > frontmatter per class", () => {
    for (const cls of ["agents", "skills", "commands"] as const) {
      const models: HatchManifest["models"] = {};
      models[cls] = { "x-artifact": "codex" };
      const manifest = makeManifest({ models });
      // frontmatter only
      expect(resolveArtifactModel(cls, "x-artifact", "sonnet", makeManifest())).toBe("claude-sonnet-4-6");
      // manifest map beats frontmatter
      expect(resolveArtifactModel(cls, "x-artifact", "sonnet", manifest)).toBe("gpt-5.3-codex");
      // customize beats manifest map and frontmatter
      expect(resolveArtifactModel(cls, "x-artifact", "sonnet", manifest, { model: "haiku" })).toBe("claude-haiku-4-5");
    }
  });

  it("applies models.default to agents ONLY (skills/commands resolve undefined)", () => {
    const manifest = makeManifest({ models: { default: "opus", skills: {}, commands: {} } });
    expect(resolveArtifactModel("agents", "hatch3r-implementer", undefined, manifest)).toBe("claude-opus-4-8");
    expect(resolveArtifactModel("skills", "hatch3r-feature", undefined, manifest)).toBeUndefined();
    expect(resolveArtifactModel("commands", "hatch3r-workflow", undefined, manifest)).toBeUndefined();
  });

  it("passes `inherit` through verbatim (emission gating is the adapter's job)", () => {
    const manifest = makeManifest({ models: { skills: { "hatch3r-feature": "inherit" } } });
    expect(resolveArtifactModel("skills", "hatch3r-feature", undefined, manifest)).toBe("inherit");
    expect(resolveArtifactModel("commands", "hatch3r-workflow", "inherit", makeManifest())).toBe("inherit");
  });

  it("expands aliases for skills and commands the same as for agents", () => {
    const manifest = makeManifest();
    expect(resolveArtifactModel("skills", "hatch3r-feature", "gemini-pro", manifest)).toBe("gemini-3.1-pro");
    expect(resolveArtifactModel("commands", "hatch3r-workflow", "haiku", manifest)).toBe("claude-haiku-4-5");
  });

  it("resolveAgentModel delegates to resolveArtifactModel('agents', ...) unchanged", () => {
    const agent = makeAgent({ model: "sonnet" });
    const manifest = makeManifest({
      models: { default: "opus", agents: { "hatch3r-implementer": "codex" } },
    });
    expect(resolveAgentModel("hatch3r-implementer", agent, manifest)).toBe(
      resolveArtifactModel("agents", "hatch3r-implementer", agent.model, manifest),
    );
  });
});

describe("withProviderPrefix", () => {
  it("adds anthropic/ prefix for claude models", () => {
    expect(withProviderPrefix("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    expect(withProviderPrefix("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
  });

  it("adds openai/ prefix for gpt models", () => {
    expect(withProviderPrefix("gpt-4o")).toBe("openai/gpt-4o");
  });

  it("adds openai/ prefix for codex models", () => {
    expect(withProviderPrefix("codex-mini")).toBe("openai/codex-mini");
  });

  it("adds google/ prefix for gemini models", () => {
    expect(withProviderPrefix("gemini-3.1-pro")).toBe("google/gemini-3.1-pro");
  });

  it("returns model unchanged when no prefix matches", () => {
    expect(withProviderPrefix("custom-model")).toBe("custom-model");
    expect(withProviderPrefix("llama-3")).toBe("llama-3");
  });
});
