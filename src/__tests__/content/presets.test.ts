import { describe, it, expect } from "vitest";
import {
  PRESETS,
  getPreset,
  omittedCapabilityClusters,
  composePresets,
  resolvePresetArg,
  KNOWN_PRESET_IDS,
  type ContentPreset,
  type PresetId,
} from "../../content/presets.js";
import { HatchError } from "../../types.js";
import { TAG_AI, TAG_PERFORMANCE } from "../../content/tags.js";

// D10 F10.6-1 / F10.6-10: preset descriptions named what was INCLUDED but
// never what was EXCLUDED, so a user picking "Standard (recommended)" silently
// opted out of AI feature engineering + performance without the picker naming
// the omission. The `omits` field + `omittedCapabilityClusters` derivation give
// the prompt renderer named exclusions and an anti-drift invariant tying the
// human-readable labels to the actual `capabilities` arrays.

describe("preset omits field (D10 F10.6-1)", () => {
  const ALL_IDS: PresetId[] = ["minimal", "standard", "full", "custom"];

  it("every preset declares an omits array", () => {
    for (const id of ALL_IDS) {
      const preset = getPreset(id);
      expect(Array.isArray(preset.omits), `${id}.omits is an array`).toBe(true);
    }
  });

  it("full omits nothing (it is the capability superset)", () => {
    expect(getPreset("full").omits).toEqual([]);
    expect(omittedCapabilityClusters(getPreset("full"))).toEqual([]);
  });

  it("custom omits nothing (user picks explicitly)", () => {
    expect(getPreset("custom").omits).toEqual([]);
    expect(omittedCapabilityClusters(getPreset("custom"))).toEqual([]);
  });

  it("standard names AI + performance as its omissions", () => {
    expect(getPreset("standard").omits).toEqual([
      "AI feature engineering",
      "performance",
    ]);
  });

  it("minimal names every capability it drops relative to full", () => {
    // minimal carries only orchestration + implementation, so it omits the
    // other 7 capability clusters full ships.
    expect(getPreset("minimal").omits.length).toBe(7);
  });
});

describe("omittedCapabilityClusters derivation (D10 anti-drift invariant)", () => {
  it("standard's derived omissions are exactly the AI + performance tags", () => {
    const derived = omittedCapabilityClusters(getPreset("standard"));
    expect([...derived].sort()).toEqual([TAG_AI, TAG_PERFORMANCE].sort());
  });

  it("human-readable omits count matches derived capability gap for non-custom presets", () => {
    // The label list and the derived capability gap must stay the same length
    // so a future capability addition cannot leave `omits` silently stale —
    // the exact failure mode F10.6-1 flagged (exclusion data must be derivable).
    for (const id of ["minimal", "standard", "full"] as PresetId[]) {
      const preset = getPreset(id);
      const derived = omittedCapabilityClusters(preset);
      expect(
        preset.omits.length,
        `${id}: omits labels (${preset.omits.length}) must match derived capability gap (${derived.length})`,
      ).toBe(derived.length);
    }
  });

  it("a preset's capabilities and its derived omissions are disjoint and cover full", () => {
    const full = getPreset("full");
    for (const id of ["minimal", "standard", "full"] as PresetId[]) {
      const preset = getPreset(id);
      const present = new Set<string>(preset.capabilities);
      const derived = omittedCapabilityClusters(preset);
      // No tag appears in both present capabilities and the omission set.
      for (const cap of derived) {
        expect(present.has(cap), `${id}: ${cap} cannot be both present and omitted`).toBe(false);
      }
      // present-in-this-preset ∪ derived-omissions covers every full capability.
      const union = new Set<string>([...preset.capabilities, ...derived]);
      for (const cap of full.capabilities) {
        expect(union.has(cap), `${id}: full capability ${cap} must be present or omitted`).toBe(true);
      }
    }
  });
});

describe("preset descriptions name exclusions (D10 F10.6-10)", () => {
  it("standard description names the AI omission instead of inclusion-only framing", () => {
    const desc = getPreset("standard").description;
    expect(desc).toContain("AI feature engineering");
    // The old inclusion-only wording opened with "including board, customize"
    // and never said what Standard dropped — guard against regressing to it.
    expect(desc).toContain("Drops");
  });

  it("minimal description names what it drops", () => {
    expect(getPreset("minimal").description).toContain("Drops");
  });
});

describe("PRESETS registry shape", () => {
  it("exposes the base + archetype preset ids in registry order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "minimal",
      "standard",
      "full",
      "web-app",
      "api-service",
      "cli-tool",
      "monorepo",
      "legacy",
      "security",
      "custom",
    ]);
  });
});

// Project-archetype presets: 6 capability-subset presets shaped per project
// shape (web app, backend service, CLI, monorepo, brownfield, security), plus
// the `composePresets` helper backing the `--preset a,b` CLI composition flow.

describe("project-archetype presets", () => {
  const ARCHETYPE_IDS: PresetId[] = [
    "web-app",
    "api-service",
    "cli-tool",
    "monorepo",
    "legacy",
    "security",
  ];

  it("getPreset resolves each archetype id", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(getPreset(id).id).toBe(id);
    }
  });

  it("each archetype's capabilities are a subset of full's", () => {
    const fullCaps = new Set<string>(getPreset("full").capabilities);
    for (const id of ARCHETYPE_IDS) {
      for (const cap of getPreset(id).capabilities) {
        expect(fullCaps.has(cap), `${id}: ${cap} must be a full capability`).toBe(true);
      }
    }
  });

  it("each archetype's omits length matches its derived capability gap", () => {
    for (const id of ARCHETYPE_IDS) {
      const preset = getPreset(id);
      const derived = omittedCapabilityClusters(preset);
      expect(
        preset.omits.length,
        `${id}: omits labels (${preset.omits.length}) must match derived gap (${derived.length})`,
      ).toBe(derived.length);
    }
  });

  it("each archetype's omits set equals its derived capability gap (via label map)", () => {
    // The label map: every capability is its own label except `ai`, which is
    // "AI feature engineering". The omits labels, mapped back, must equal the
    // derived capability-tag gap exactly — same set, no drift.
    const labelToCap = (label: string): string =>
      label === "AI feature engineering" ? TAG_AI : label;
    for (const id of ARCHETYPE_IDS) {
      const preset = getPreset(id);
      const derived = [...omittedCapabilityClusters(preset)].sort();
      const fromLabels = preset.omits.map(labelToCap).sort();
      expect(fromLabels, `${id}: omits labels map back to the derived gap`).toEqual(derived);
    }
  });

  it("monorepo carries the full superset and omits nothing", () => {
    const monorepo = getPreset("monorepo");
    const fullCaps = [...getPreset("full").capabilities].sort();
    expect([...monorepo.capabilities].sort()).toEqual(fullCaps);
    expect(monorepo.omits).toEqual([]);
    expect(omittedCapabilityClusters(monorepo)).toEqual([]);
  });

  it("security preset opts out of customize; the lifecycle archetypes opt in", () => {
    expect(getPreset("security").includeCustomize).toBe(false);
    for (const id of ["web-app", "api-service", "cli-tool", "monorepo", "legacy"] as PresetId[]) {
      expect(getPreset(id).includeCustomize, `${id} includeCustomize`).toBe(true);
    }
  });
});

describe("composePresets", () => {
  it("unions capabilities of two presets with no duplicates", () => {
    const composed = composePresets([getPreset("web-app"), getPreset("security")]);
    const expected = new Set<string>([
      ...getPreset("web-app").capabilities,
      ...getPreset("security").capabilities,
    ]);
    // Every capability from either input is present.
    const composedCaps = composed.capabilities as ReadonlyArray<string>;
    for (const cap of expected) {
      expect(composedCaps.includes(cap), `union must contain ${cap}`).toBe(true);
    }
    // No duplicates: the array length equals the de-duplicated set size.
    expect(composed.capabilities.length).toBe(new Set(composed.capabilities).size);
    expect(composed.capabilities.length).toBe(expected.size);
  });

  it("ORs includeCustomize across inputs", () => {
    // web-app opts in (true), security opts out (false) → composite is true.
    expect(composePresets([getPreset("web-app"), getPreset("security")]).includeCustomize).toBe(true);
    // security alone opts out (false) → composite is false.
    expect(composePresets([getPreset("security")]).includeCustomize).toBe(false);
    // two opt-out presets → composite stays false.
    const bothOut: ContentPreset = { ...getPreset("web-app"), includeCustomize: false };
    expect(composePresets([bothOut, getPreset("security")]).includeCustomize).toBe(false);
  });

  it("omits only capabilities absent from EVERY composed preset", () => {
    const webApp = getPreset("web-app");
    const security = getPreset("security");
    const composed = composePresets([webApp, security]);
    const composedCaps = new Set<string>(composed.capabilities);
    const labelToCap = (label: string): string =>
      label === "AI feature engineering" ? TAG_AI : label;
    const omittedCaps = composed.omits.map(labelToCap);
    // Any omitted capability must be absent from both inputs.
    for (const cap of omittedCaps) {
      expect(composedCaps.has(cap), `${cap} omitted ⇒ absent from the union`).toBe(false);
    }
    // web-app drops only AI; security drops more, but the union restores all of
    // security's extras (orchestration/implementation/review/maintenance are in
    // web-app). So the only capability absent from BOTH is AI.
    expect(composed.omits).toEqual(["AI feature engineering"]);
  });

  it("synthesizes a custom id and a name joining the inputs", () => {
    const composed = composePresets([getPreset("web-app"), getPreset("security")]);
    expect(composed.id).toBe("custom");
    expect(composed.name).toBe("Web App + Security-Focused");
  });

  it("unions includeIds / excludeIds when present, omits them when empty", () => {
    const a: ContentPreset = { ...getPreset("cli-tool"), includeIds: ["x", "y"], excludeIds: ["z"] };
    const b: ContentPreset = { ...getPreset("api-service"), includeIds: ["y", "w"] };
    const composed = composePresets([a, b]);
    expect([...(composed.includeIds ?? [])].sort()).toEqual(["w", "x", "y"]);
    expect(composed.excludeIds).toEqual(["z"]);
    // No id overrides on either input → fields omitted entirely.
    const plain = composePresets([getPreset("cli-tool"), getPreset("api-service")]);
    expect(plain.includeIds).toBeUndefined();
    expect(plain.excludeIds).toBeUndefined();
  });

  it("a single-preset input returns an equivalent capability set + omits", () => {
    for (const id of ["web-app", "api-service", "monorepo", "legacy"] as PresetId[]) {
      const source = getPreset(id);
      const composed = composePresets([source]);
      expect([...composed.capabilities].sort()).toEqual([...source.capabilities].sort());
      expect([...composed.omits].sort()).toEqual([...source.omits].sort());
      expect(composed.includeCustomize).toBe(source.includeCustomize);
    }
  });

  it("throws VALIDATION_ERROR on empty input", () => {
    expect(() => composePresets([])).toThrow(HatchError);
    try {
      composePresets([]);
      throw new Error("expected composePresets([]) to throw");
    } catch (err) {
      expect((err as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("throws VALIDATION_ERROR when any input is the custom preset", () => {
    expect(() => composePresets([getPreset("custom")])).toThrow(HatchError);
    expect(() => composePresets([getPreset("web-app"), getPreset("custom")])).toThrow(HatchError);
    try {
      composePresets([getPreset("web-app"), getPreset("custom")]);
      throw new Error("expected composePresets with custom to throw");
    } catch (err) {
      expect((err as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });
});

// KNOWN_PRESET_IDS backs the CLI `--preset` validation lists; resolvePresetArg
// turns a raw `--preset` arg (single id OR comma-list) into a ContentPreset for
// the `--preset a,b` composition flow.

describe("KNOWN_PRESET_IDS", () => {
  it("contains all 10 registry ids in registry order", () => {
    expect(KNOWN_PRESET_IDS).toEqual([
      "minimal",
      "standard",
      "full",
      "web-app",
      "api-service",
      "cli-tool",
      "monorepo",
      "legacy",
      "security",
      "custom",
    ]);
    expect(KNOWN_PRESET_IDS.length).toBe(10);
  });

  it("is derived from PRESETS so it cannot drift from the array", () => {
    expect([...KNOWN_PRESET_IDS]).toEqual(PRESETS.map((p) => p.id));
  });
});

describe("resolvePresetArg", () => {
  it("resolves a single archetype id to that preset", () => {
    expect(resolvePresetArg("web-app").id).toBe("web-app");
    expect(resolvePresetArg("standard")).toBe(getPreset("standard"));
  });

  it("resolves a single id with surrounding whitespace", () => {
    expect(resolvePresetArg("  api-service  ").id).toBe("api-service");
  });

  it("composes a comma-list into a synthetic preset (union of capabilities)", () => {
    const composed = resolvePresetArg("api-service,security");
    const expected = new Set<string>([
      ...getPreset("api-service").capabilities,
      ...getPreset("security").capabilities,
    ]);
    const composedCaps = composed.capabilities as ReadonlyArray<string>;
    for (const cap of expected) {
      expect(composedCaps.includes(cap), `union must contain ${cap}`).toBe(true);
    }
    expect(composed.capabilities.length).toBe(expected.size);
    // A composition is a synthetic custom-id preset (round-trips via content.items).
    expect(composed.id).toBe("custom");
  });

  it("composes 3 presets, unioning all of their capabilities", () => {
    const composed = resolvePresetArg("cli-tool,api-service,security");
    const expected = new Set<string>([
      ...getPreset("cli-tool").capabilities,
      ...getPreset("api-service").capabilities,
      ...getPreset("security").capabilities,
    ]);
    expect(new Set(composed.capabilities)).toEqual(expected);
  });

  it("ignores empty segments and trims parts in a comma-list", () => {
    const composed = resolvePresetArg(" web-app , , security ");
    expect(composed.id).toBe("custom");
    expect(composed.name).toBe("Web App + Security-Focused");
  });

  it("throws VALIDATION_ERROR on an unknown id", () => {
    expect(() => resolvePresetArg("bogus")).toThrow(HatchError);
    try {
      resolvePresetArg("bogus");
      throw new Error("expected resolvePresetArg('bogus') to throw");
    } catch (err) {
      expect((err as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("throws VALIDATION_ERROR when a comma-list contains custom (not composable)", () => {
    expect(() => resolvePresetArg("standard,custom")).toThrow(HatchError);
    try {
      resolvePresetArg("standard,custom");
      throw new Error("expected resolvePresetArg('standard,custom') to throw");
    } catch (err) {
      expect((err as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });

  it("throws VALIDATION_ERROR on an empty / all-empty arg", () => {
    expect(() => resolvePresetArg("")).toThrow(HatchError);
    expect(() => resolvePresetArg("  ,  ,  ")).toThrow(HatchError);
    try {
      resolvePresetArg("");
      throw new Error("expected resolvePresetArg('') to throw");
    } catch (err) {
      expect((err as HatchError).errorCode).toBe("VALIDATION_ERROR");
    }
  });
});
