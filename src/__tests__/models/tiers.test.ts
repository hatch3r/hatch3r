import { describe, it, expect } from "vitest";
import {
  CLAUDE_TIER_EFFORT_MAP,
  CLAUDE_TIER_MODEL_MAP,
  CURSOR_TIER_MODEL_MAP,
  MODEL_CLASSES,
  normalizeModelClass,
  resolveTierModel,
} from "../../models/tiers.js";
import type { HatchManifest } from "../../types.js";

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

describe("normalizeModelClass", () => {
  it("accepts the three class words", () => {
    expect(normalizeModelClass("economy")).toBe("economy");
    expect(normalizeModelClass("default")).toBe("default");
    expect(normalizeModelClass("strongest")).toBe("strongest");
  });

  it("maps the legacy synonyms fast/standard/reasoning", () => {
    expect(normalizeModelClass("fast")).toBe("economy");
    expect(normalizeModelClass("standard")).toBe("default");
    expect(normalizeModelClass("reasoning")).toBe("strongest");
  });

  it("is whitespace- and case-tolerant (user-authored yaml values)", () => {
    expect(normalizeModelClass(" Economy ")).toBe("economy");
    expect(normalizeModelClass("STANDARD")).toBe("default");
  });

  it("returns null for concrete ids, aliases, inherit, and unknown words", () => {
    for (const v of ["claude-opus-4-8", "opus", "sonnet", "haiku", "fable", "inherit", "gpt-4", "light", "deep", "", "strong"]) {
      expect(normalizeModelClass(v), `expected null for ${JSON.stringify(v)}`).toBeNull();
    }
  });
});

describe("adapter tier maps", () => {
  it("CLAUDE_TIER_MODEL_MAP covers every class with a Claude alias", () => {
    expect(CLAUDE_TIER_MODEL_MAP).toEqual({ economy: "haiku", default: "sonnet", strongest: "opus" });
    for (const cls of MODEL_CLASSES) expect(CLAUDE_TIER_MODEL_MAP[cls]).toBeTruthy();
  });

  it("CLAUDE_TIER_EFFORT_MAP carries economy+strongest only (default => no effort line)", () => {
    expect(CLAUDE_TIER_EFFORT_MAP.economy).toBe("medium");
    expect(CLAUDE_TIER_EFFORT_MAP.strongest).toBe("high");
    expect(CLAUDE_TIER_EFFORT_MAP.default).toBeUndefined();
  });

  it("CURSOR_TIER_MODEL_MAP maps only economy to Cursor's native `fast`", () => {
    expect(CURSOR_TIER_MODEL_MAP.economy).toBe("fast");
    expect(CURSOR_TIER_MODEL_MAP.default).toBeUndefined();
    expect(CURSOR_TIER_MODEL_MAP.strongest).toBeUndefined();
  });
});

describe("resolveTierModel", () => {
  it("returns undefined when no models config / no tiers key / class unset", () => {
    expect(resolveTierModel("strongest", makeManifest())).toBeUndefined();
    expect(resolveTierModel("strongest", makeManifest({ models: {} }))).toBeUndefined();
    expect(resolveTierModel("strongest", makeManifest({ models: { tiers: { economy: "haiku" } } }))).toBeUndefined();
  });

  it("returns the operator pin VERBATIM (no alias expansion) — pins win over adapter maps", () => {
    const manifest = makeManifest({ models: { tiers: { strongest: "fable", economy: "claude-haiku-4-5" } } });
    // Verbatim: `fable` stays `fable` here; adapters gate/expand at emission.
    expect(resolveTierModel("strongest", manifest)).toBe("fable");
    expect(resolveTierModel("economy", manifest)).toBe("claude-haiku-4-5");
    expect(resolveTierModel("default", manifest)).toBeUndefined();
  });

  it("per-class precedence: a pinned class resolves the pin while unpinned classes fall through", () => {
    const manifest = makeManifest({ models: { tiers: { default: "claude-sonnet-4-6" } } });
    expect(resolveTierModel("default", manifest)).toBe("claude-sonnet-4-6");
    // Unpinned classes return undefined — the caller then applies its own map.
    expect(resolveTierModel("economy", manifest) ?? CLAUDE_TIER_MODEL_MAP.economy).toBe("haiku");
    expect(resolveTierModel("strongest", manifest) ?? CLAUDE_TIER_MODEL_MAP.strongest).toBe("opus");
  });
});
