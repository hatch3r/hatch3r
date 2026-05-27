import { describe, it, expect } from "vitest";
import {
  PRESETS,
  getPreset,
  omittedCapabilityClusters,
  type PresetId,
} from "../../content/presets.js";
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
  it("exposes the four known preset ids", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["minimal", "standard", "full", "custom"]);
  });
});
