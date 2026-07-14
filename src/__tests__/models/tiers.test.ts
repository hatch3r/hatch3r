import { describe, it, expect } from "vitest";
import {
  CLASS_DEFAULT_EFFORT_MAP,
  CLASS_HIGH,
  CLASS_LOW,
  CLASS_MID,
  CLASS_TOP,
  CLAUDE_TIER_MODEL_MAP,
  COPILOT_TIER_MODEL_MAP,
  CURSOR_TIER_MODEL_MAP,
  EFFORT_LEVELS,
  EFFORT_RANK,
  MODEL_CLASSES,
  defaultEffortForClass,
  normalizeEffortLevel,
  normalizeModelClass,
  resolveTierEffort,
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

describe("model-class ladder constants (release/2.7.0)", () => {
  it("names the four classes weakest -> strongest via the swappable CLASS_* constants", () => {
    expect(CLASS_LOW).toBe("economy");
    expect(CLASS_MID).toBe("standard");
    expect(CLASS_HIGH).toBe("advanced");
    expect(CLASS_TOP).toBe("frontier");
    expect(MODEL_CLASSES).toEqual([CLASS_LOW, CLASS_MID, CLASS_HIGH, CLASS_TOP]);
  });
});

describe("normalizeModelClass", () => {
  it("accepts the four class words", () => {
    expect(normalizeModelClass("economy")).toBe(CLASS_LOW);
    expect(normalizeModelClass("standard")).toBe(CLASS_MID);
    expect(normalizeModelClass("advanced")).toBe(CLASS_HIGH);
    expect(normalizeModelClass("frontier")).toBe(CLASS_TOP);
  });

  it("maps the legacy synonyms fast/default/reasoning/strongest", () => {
    expect(normalizeModelClass("fast")).toBe(CLASS_LOW);
    expect(normalizeModelClass("default")).toBe(CLASS_MID);
    expect(normalizeModelClass("reasoning")).toBe(CLASS_TOP);
    expect(normalizeModelClass("strongest")).toBe(CLASS_TOP);
  });

  it("resolves the shadowed `standard` on the canonical path (canonical membership beats the legacy row)", () => {
    // `standard` is BOTH canonical (CLASS_MID) and a pre-2.6.0 legacy word.
    // Canonical membership is checked first, so both readings agree on
    // CLASS_MID and the LEGACY_CLASS_SYNONYMS row is a harmless shadow.
    expect(normalizeModelClass("standard")).toBe(CLASS_MID);
    expect(normalizeModelClass("STANDARD")).toBe(CLASS_MID);
  });

  it("is whitespace- and case-tolerant (user-authored yaml values)", () => {
    expect(normalizeModelClass(" Economy ")).toBe(CLASS_LOW);
    expect(normalizeModelClass("FRONTIER")).toBe(CLASS_TOP);
    expect(normalizeModelClass(" Strongest ")).toBe(CLASS_TOP);
  });

  it("returns null for concrete ids, aliases, inherit, and unknown words", () => {
    for (const v of ["claude-opus-4-8", "opus", "sonnet", "haiku", "fable", "inherit", "gpt-4", "light", "deep", "", "strong"]) {
      expect(normalizeModelClass(v), `expected null for ${JSON.stringify(v)}`).toBeNull();
    }
  });
});

describe("normalizeEffortLevel", () => {
  it("accepts the five effort words", () => {
    for (const level of EFFORT_LEVELS) {
      expect(normalizeEffortLevel(level)).toBe(level);
    }
  });

  it("is whitespace- and case-tolerant (' XHIGH ' -> xhigh)", () => {
    expect(normalizeEffortLevel(" XHIGH ")).toBe("xhigh");
    expect(normalizeEffortLevel("Max")).toBe("max");
  });

  it("returns null for junk, inherit, and non-level words", () => {
    for (const v of ["", "inherit", "turbo", "extreme", "x-high", "highest", "opus", "high\ntools: [Bash]"]) {
      expect(normalizeEffortLevel(v), `expected null for ${JSON.stringify(v)}`).toBeNull();
    }
  });
});

describe("EFFORT_RANK", () => {
  it("ranks the five levels strictly ascending, low = 0 to max = 4", () => {
    expect(EFFORT_RANK.low).toBe(0);
    expect(EFFORT_RANK.max).toBe(4);
    for (let i = 1; i < EFFORT_LEVELS.length; i++) {
      expect(EFFORT_RANK[EFFORT_LEVELS[i]]).toBeGreaterThan(EFFORT_RANK[EFFORT_LEVELS[i - 1]]);
    }
  });
});

describe("adapter tier maps", () => {
  it("CLAUDE_TIER_MODEL_MAP covers every class with a Claude alias (frontier -> fable)", () => {
    expect(CLAUDE_TIER_MODEL_MAP).toEqual({
      [CLASS_LOW]: "haiku",
      [CLASS_MID]: "sonnet",
      [CLASS_HIGH]: "opus",
      [CLASS_TOP]: "fable",
    });
    for (const cls of MODEL_CLASSES) expect(CLAUDE_TIER_MODEL_MAP[cls]).toBeTruthy();
  });

  it("CLASS_DEFAULT_EFFORT_MAP carries economy/advanced/frontier only (standard => no effort line)", () => {
    expect(CLASS_DEFAULT_EFFORT_MAP[CLASS_LOW]).toBe("medium");
    expect(CLASS_DEFAULT_EFFORT_MAP[CLASS_MID]).toBeUndefined();
    expect(CLASS_DEFAULT_EFFORT_MAP[CLASS_HIGH]).toBe("high");
    expect(CLASS_DEFAULT_EFFORT_MAP[CLASS_TOP]).toBe("xhigh");
  });

  it("CURSOR_TIER_MODEL_MAP maps only economy to Cursor's native `fast` (advanced/frontier pin via alias expansion)", () => {
    expect(CURSOR_TIER_MODEL_MAP[CLASS_LOW]).toBe("fast");
    expect(CURSOR_TIER_MODEL_MAP[CLASS_MID]).toBeUndefined();
    expect(CURSOR_TIER_MODEL_MAP[CLASS_HIGH]).toBeUndefined();
    expect(CURSOR_TIER_MODEL_MAP[CLASS_TOP]).toBeUndefined();
  });

  it("COPILOT_TIER_MODEL_MAP carries single display-name strings, standard absent (picker default)", () => {
    expect(COPILOT_TIER_MODEL_MAP).toEqual({
      [CLASS_TOP]: "Claude Fable 5",
      [CLASS_HIGH]: "Claude Opus 4.8",
      [CLASS_LOW]: "Claude Haiku 4.5",
    });
    expect(COPILOT_TIER_MODEL_MAP[CLASS_MID]).toBeUndefined();
    // Copilot CLI rejects the array form — every row must stay a string.
    for (const value of Object.values(COPILOT_TIER_MODEL_MAP)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("resolveTierModel", () => {
  it("returns undefined when no models config / no tiers key / class unset", () => {
    expect(resolveTierModel(CLASS_TOP, makeManifest())).toBeUndefined();
    expect(resolveTierModel(CLASS_TOP, makeManifest({ models: {} }))).toBeUndefined();
    expect(resolveTierModel(CLASS_TOP, makeManifest({ models: { tiers: { economy: "haiku" } } }))).toBeUndefined();
  });

  it("returns the operator pin VERBATIM (no alias expansion) — pins win over adapter maps", () => {
    const manifest = makeManifest({ models: { tiers: { frontier: "fable", economy: "claude-haiku-4-5" } } });
    // Verbatim: `fable` stays `fable` here; adapters gate/expand at emission.
    expect(resolveTierModel(CLASS_TOP, manifest)).toBe("fable");
    expect(resolveTierModel(CLASS_LOW, manifest)).toBe("claude-haiku-4-5");
    expect(resolveTierModel(CLASS_MID, manifest)).toBeUndefined();
  });

  it("honors 2.6.0 legacy keys by normalization (default -> standard, strongest -> frontier)", () => {
    const manifest = makeManifest({ models: { tiers: { default: "claude-sonnet-4-6", strongest: "fable" } } });
    expect(resolveTierModel(CLASS_MID, manifest)).toBe("claude-sonnet-4-6");
    expect(resolveTierModel(CLASS_TOP, manifest)).toBe("fable");
    // Legacy keys pin only their own class — the others fall through.
    expect(resolveTierModel(CLASS_LOW, manifest)).toBeUndefined();
    expect(resolveTierModel(CLASS_HIGH, manifest)).toBeUndefined();
  });

  it("canonical key wins over a legacy key normalizing to the same class", () => {
    const manifest = makeManifest({
      models: { tiers: { strongest: "claude-opus-4-8", frontier: "fable", default: "claude-sonnet-4-6", standard: "sonnet" } },
    });
    expect(resolveTierModel(CLASS_TOP, manifest)).toBe("fable");
    expect(resolveTierModel(CLASS_MID, manifest)).toBe("sonnet");
  });

  it("per-class precedence: a pinned class resolves the pin while unpinned classes fall through", () => {
    const manifest = makeManifest({ models: { tiers: { standard: "claude-sonnet-4-6" } } });
    expect(resolveTierModel(CLASS_MID, manifest)).toBe("claude-sonnet-4-6");
    // Unpinned classes return undefined — the caller then applies its own map.
    expect(resolveTierModel(CLASS_LOW, manifest) ?? CLAUDE_TIER_MODEL_MAP[CLASS_LOW]).toBe("haiku");
    expect(resolveTierModel(CLASS_TOP, manifest) ?? CLAUDE_TIER_MODEL_MAP[CLASS_TOP]).toBe("fable");
  });
});

describe("resolveTierEffort + defaultEffortForClass", () => {
  it("resolveTierEffort reads canonical tierEfforts keys only", () => {
    expect(resolveTierEffort(CLASS_TOP, makeManifest())).toBeUndefined();
    expect(resolveTierEffort(CLASS_TOP, makeManifest({ models: {} }))).toBeUndefined();
    const manifest = makeManifest({ models: { tierEfforts: { frontier: "max", economy: "low" } } });
    expect(resolveTierEffort(CLASS_TOP, manifest)).toBe("max");
    expect(resolveTierEffort(CLASS_LOW, manifest)).toBe("low");
    expect(resolveTierEffort(CLASS_HIGH, manifest)).toBeUndefined();
  });

  it("defaultEffortForClass: operator pin beats the built-in class default", () => {
    const manifest = makeManifest({ models: { tierEfforts: { frontier: "max" } } });
    expect(defaultEffortForClass(CLASS_TOP, manifest)).toBe("max");
    // Unpinned classes fall back to CLASS_DEFAULT_EFFORT_MAP.
    expect(defaultEffortForClass(CLASS_LOW, manifest)).toBe("medium");
    expect(defaultEffortForClass(CLASS_HIGH, manifest)).toBe("high");
  });

  it("defaultEffortForClass: no pin => built-in map; standard stays undefined (platform default)", () => {
    const manifest = makeManifest();
    expect(defaultEffortForClass(CLASS_TOP, manifest)).toBe("xhigh");
    expect(defaultEffortForClass(CLASS_MID, manifest)).toBeUndefined();
    // A standard pin is still honored — absence of a BUILT-IN default does
    // not block the operator override.
    const pinned = makeManifest({ models: { tierEfforts: { standard: "high" } } });
    expect(defaultEffortForClass(CLASS_MID, pinned)).toBe("high");
  });
});
