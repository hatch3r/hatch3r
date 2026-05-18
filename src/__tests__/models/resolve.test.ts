import { describe, it, expect } from "vitest";
import { resolveAgentModel, withProviderPrefix } from "../../models/resolve.js";
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
    expect(result).toBe("claude-opus-4-6");
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
