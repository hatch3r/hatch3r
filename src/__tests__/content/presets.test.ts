import { describe, it, expect } from "vitest";
import {
  PRESETS,
  getPreset,
  omittedCapabilityClusters,
  composePresets,
  resolvePresetArg,
  capabilityLabel,
  FULL_CAPABILITY_SUPERSET,
  KNOWN_PRESET_IDS,
  type CapabilityTag,
  type ContentPreset,
  type PresetId,
} from "../../content/presets.js";
import {
  resolveSelection,
  getAllContentIds,
  type CatalogItem,
  type ContentIndex,
} from "../../content/index.js";
import { HatchError } from "../../types.js";
import { TAG_AI, TAG_PERFORMANCE, TAG_FLOOR_CONTENT_QUALITY } from "../../content/tags.js";

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

// D10-34 (Cycle 11 Wave 3): the `omits` ⇄ `omittedCapabilityClusters` checks
// above are a tautology over the `capabilities` arrays — both sides derive from
// the same `capabilities` vs `full.capabilities` diff, so neither resolves a
// selection. That left the labels unverified against `resolveSelection`'s actual
// output: a floor-expansion change (re-tagging a capability cluster `floor:*`)
// would keep `omits` listing it while the realized selection still shipped every
// member, and no test would fail. This block closes the gap by wiring each
// `omits` label to the realized `resolveSelection(full) \ resolveSelection(preset)`
// id-set delta.
describe("omits labels match the realized resolveSelection delta (D10-34)", () => {
  // One genuinely-droppable agent per capability tag: a single capability tag,
  // no floor tag, not protected, not customize. Under this index a cluster is
  // dropped by a preset iff that capability is absent from preset.capabilities —
  // so the realized post-floor delta equals the intent gap exactly, and the
  // `omits` labels must reproduce it through `resolveSelection`.
  function makeIndex(items: CatalogItem[]): ContentIndex {
    const byType: Record<string, CatalogItem[]> = {};
    const byId = new Map<string, CatalogItem>();
    const byTypeAndId = new Map<string, CatalogItem>();
    for (const item of items) {
      (byType[item.type] ??= []).push(item);
      byId.set(item.id, item);
      byTypeAndId.set(`${item.type}:${item.id}`, item);
    }
    return { items, byType, byId, byTypeAndId, collisions: [] };
  }

  const perCapabilityItem = (cap: CapabilityTag): CatalogItem => ({
    id: `cap-${cap}-agent`,
    type: "agent",
    description: `Sole-${cap} agent`,
    tags: [cap],
    relativePath: `agents/cap-${cap}-agent.md`,
    source: "canonical",
  });
  const capabilityIndex = makeIndex(FULL_CAPABILITY_SUPERSET.map(perCapabilityItem));
  // `omits` is the capability/floor dial, independent of project-type and
  // team-size context filtering — resolve both ends with those filters off so
  // the delta isolates the dial (mirrors content/index.ts::presetOmittedClusters).
  const SKIP_CTX = { skipContextFilters: true } as const;
  const capForId = new Map<string, CapabilityTag>(
    FULL_CAPABILITY_SUPERSET.map((cap) => [`cap-${cap}-agent`, cap]),
  );

  const realizedOmitLabels = (preset: ContentPreset): string[] => {
    const fullIds = getAllContentIds(
      resolveSelection(getPreset("full"), "brownfield", "team", capabilityIndex, undefined, undefined, SKIP_CTX),
    );
    const presetIds = getAllContentIds(
      resolveSelection(preset, "brownfield", "team", capabilityIndex, undefined, undefined, SKIP_CTX),
    );
    const dropped = new Set<CapabilityTag>();
    for (const id of fullIds) {
      if (presetIds.has(id)) continue;
      const cap = capForId.get(id);
      if (cap) dropped.add(cap);
    }
    return FULL_CAPABILITY_SUPERSET.filter((cap) => dropped.has(cap)).map(capabilityLabel);
  };

  it("full resolves the whole capability superset (delta baseline is complete)", () => {
    const fullIds = getAllContentIds(
      resolveSelection(getPreset("full"), "brownfield", "team", capabilityIndex, undefined, undefined, SKIP_CTX),
    );
    for (const cap of FULL_CAPABILITY_SUPERSET) {
      expect(fullIds.has(`cap-${cap}-agent`), `full must admit the ${cap} item`).toBe(true);
    }
  });

  it("each non-custom preset's omits labels equal the resolveSelection(full) \\ resolveSelection(preset) cluster set", () => {
    for (const preset of PRESETS) {
      if (preset.id === "custom") continue;
      const realized = realizedOmitLabels(preset).sort();
      expect(
        [...preset.omits].sort(),
        `${preset.id}: declared omits must equal the realized resolveSelection delta`,
      ).toEqual(realized);
    }
  });

  it("every omits label names a cluster actually absent from the resolved selection", () => {
    // The directional half of the finding: each omits label's cluster item must
    // be present under full and removed under the preset — not merely a label.
    for (const preset of PRESETS) {
      if (preset.id === "custom") continue;
      const labelToCap = new Map(FULL_CAPABILITY_SUPERSET.map((c) => [capabilityLabel(c), c]));
      const fullIds = getAllContentIds(
        resolveSelection(getPreset("full"), "brownfield", "team", capabilityIndex, undefined, undefined, SKIP_CTX),
      );
      const presetIds = getAllContentIds(
        resolveSelection(preset, "brownfield", "team", capabilityIndex, undefined, undefined, SKIP_CTX),
      );
      for (const label of preset.omits) {
        const cap = labelToCap.get(label);
        expect(cap, `${preset.id}: omits label "${label}" maps to a capability tag`).toBeDefined();
        const itemId = `cap-${cap}-agent`;
        expect(fullIds.has(itemId), `${preset.id}: full ships the ${cap} item`).toBe(true);
        expect(
          presetIds.has(itemId),
          `${preset.id}: omits "${label}" ⇒ the ${cap} item is absent from the resolved selection`,
        ).toBe(false);
      }
    }
  });

  it("a cluster shipped via a floor tag is NOT a realized omit even when the capability dial is off (floor-expansion guard)", () => {
    // The exact regression the finding flagged: if a capability cluster is also
    // floor-tagged, floor admission ships it for every preset, so the cluster is
    // NOT in the realized delta. minimal's intent-omits include "review"; here a
    // review item ALSO carrying floor:content-quality must survive minimal, so
    // "review" must NOT appear in the realized-omit labels even though it is in
    // minimal.omits — proving this delta-based check is what catches a label that
    // a floor expansion would silently invalidate.
    const reviewCap = "review" as CapabilityTag;
    const floorReviewItem: CatalogItem = {
      id: "cap-review-floor-agent",
      type: "agent",
      description: "Review agent that also carries the content-quality floor",
      tags: [reviewCap, TAG_FLOOR_CONTENT_QUALITY],
      relativePath: "agents/cap-review-floor-agent.md",
      source: "canonical",
    };
    // Only this floor-tagged review item carries the `review` capability in this
    // index, so floor admission is the sole reason it could ship.
    const floorIndex = makeIndex(
      FULL_CAPABILITY_SUPERSET.filter((c) => c !== reviewCap).map(perCapabilityItem).concat(floorReviewItem),
    );
    const minimal = getPreset("minimal");
    const fullIds = getAllContentIds(
      resolveSelection(getPreset("full"), "brownfield", "team", floorIndex, undefined, undefined, SKIP_CTX),
    );
    const minimalIds = getAllContentIds(
      resolveSelection(minimal, "brownfield", "team", floorIndex, undefined, undefined, SKIP_CTX),
    );
    // The floor-tagged review item ships under BOTH full and minimal.
    expect(fullIds.has("cap-review-floor-agent")).toBe(true);
    expect(minimalIds.has("cap-review-floor-agent")).toBe(true);
    // So `review` is NOT in the realized delta, even though it IS in minimal.omits.
    const droppedCaps = new Set<string>();
    for (const id of fullIds) {
      if (minimalIds.has(id)) continue;
      const item = floorIndex.byId.get(id);
      for (const tag of item?.tags ?? []) {
        if ((FULL_CAPABILITY_SUPERSET as ReadonlyArray<string>).includes(tag)) droppedCaps.add(tag);
      }
    }
    expect(droppedCaps.has(reviewCap)).toBe(false);
    expect(minimal.omits).toContain("review");
  });
});

describe("preset descriptions name exclusions (D10 F10.6-10)", () => {
  it("standard description names the AI dial-off instead of inclusion-only framing", () => {
    const desc = getPreset("standard").description;
    // D10-12 (Cycle 11): standard does NOT genuinely omit AI content — most AI
    // artifacts carry floor tags and ship at every tier, so the picker's
    // realized omit line would not list "AI feature engineering". The honest
    // framing names the AI *dial* being off, not an AI content omission. The
    // old inclusion-only wording opened with "including board, customize" and
    // never said what Standard narrowed — guard against regressing to it.
    expect(desc).toMatch(/AI/);
    expect(desc).toMatch(/dial/i);
  });

  it("minimal description names the capability dial it narrows to", () => {
    expect(getPreset("minimal").description).toMatch(/dial/i);
  });

  // D10-12 (Cycle 11 Wave 2): the picker prose previously claimed "the security
  // & UI/UX floor"; the floor also ships the content-quality specialists, so
  // every non-custom preset's description must name the content-quality floor.
  it("every non-custom preset description names the content-quality floor", () => {
    for (const p of PRESETS) {
      if (p.id === "custom") continue;
      expect(
        p.description,
        `${p.id} description should mention the content-quality floor`,
      ).toContain("content-quality");
    }
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

  it("release/2.8.5: monorepo + web-app carry full's includeIds carve-out so their 'vs Full' claims hold", () => {
    // monorepo's description promises "Drops nothing vs Full" and web-app's
    // promises only-the-AI-dial-off — capability parity alone missed full's
    // per-id `includeIds` carve-out, silently dropping exactly that artifact
    // from both (BUG-1 secondary). Every id full admits by carve-out must
    // appear on both archetypes too.
    const fullIncludeIds = getPreset("full").includeIds ?? [];
    expect(fullIncludeIds.length).toBeGreaterThan(0);
    for (const preset of [getPreset("monorepo"), getPreset("web-app")]) {
      for (const id of fullIncludeIds) {
        expect(preset.includeIds ?? [], `${preset.id} must carry full's includeIds entry "${id}"`).toContain(id);
      }
    }
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
