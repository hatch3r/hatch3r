import { describe, it, expect } from "vitest";
import { resolveAgentModel } from "../../models/resolve.js";
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
    version: "1.0.0",
    hatch3rVersion: "1.0.0",
    owner: "test",
    repo: "test",
    tools: ["cursor"],
    features: { agents: true, skills: true, rules: true, prompts: true, commands: true, mcp: true, guardrails: true, githubAgents: true, hooks: true },
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
});
