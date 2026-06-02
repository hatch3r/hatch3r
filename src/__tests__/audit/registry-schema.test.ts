import { describe, expect, it } from "vitest";
import {
  CURRENT_REGISTRY_VERSION,
  migrate,
  parseRegistry,
  RegistryParseError,
  validateRegistry,
  type Finding,
} from "../../audit/registry-schema.js";

const FIXED_DATE = "2026-04-28T00:00:00.000Z";

function legacyMinimal(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "#42",
    domain: "D1: Core Source",
    severity: "Medium",
    description: "legacy minimal entry",
    disposition: "targeted",
    execution_status: "done",
    ...overrides,
  };
}

function modernMinimal(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "C8-D1-M1",
    domain: "D1: Core Source",
    severity: "Medium",
    description: "modern entry with rigor contract",
    disposition: "targeted",
    execution_status: "pending",
    confidence: "medium",
    causal_chain_depth: 4,
    sources: [],
    execution_tier: 3,
    central_path: false,
    cycle: 8,
    ...overrides,
  };
}

describe("parseRegistry", () => {
  it("accepts legacy v1 array", () => {
    const parsed = parseRegistry([legacyMinimal()]);
    expect(parsed.kind).toBe("legacy-v1");
    expect(parsed.rawLength).toBe(1);
  });

  it("accepts v2 envelope", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    expect(parsed.kind).toBe("v2");
    if (parsed.kind === "v2") {
      expect(parsed.registry.entries).toHaveLength(1);
      expect(parsed.registry.schema_version).toBe(CURRENT_REGISTRY_VERSION);
    }
  });

  it("throws on null root", () => {
    expect(() => parseRegistry(null)).toThrow(RegistryParseError);
  });

  it("throws on object missing schema_version", () => {
    expect(() => parseRegistry({ entries: [] })).toThrow(/schema_version/);
  });

  it("throws on object missing entries array", () => {
    expect(() =>
      parseRegistry({ schema_version: "2.0.0", generated_at: FIXED_DATE }),
    ).toThrow(/entries/);
  });

  it("throws on non-object entry", () => {
    expect(() => parseRegistry([null])).toThrow(RegistryParseError);
    expect(() => parseRegistry(["string"])).toThrow(RegistryParseError);
  });
});

describe("validateRegistry — legacy-tolerant defaults", () => {
  it("passes a clean modern entry", () => {
    const parsed = parseRegistry([modernMinimal()]);
    const drifts = validateRegistry(parsed);
    expect(drifts).toEqual([]);
  });

  it("flags legacy entries missing rigor fields when not grandfathered", () => {
    const parsed = parseRegistry([legacyMinimal()]);
    const drifts = validateRegistry(parsed);
    const reasons = new Set(drifts.map((d) => d.reason));
    expect(reasons).toContain("missing confidence");
    expect(reasons).toContain("missing causal_chain_depth");
    expect(reasons).toContain("missing sources");
  });

  it("grandfathers entries with disposition_note=pre-rigor-contract", () => {
    const parsed = parseRegistry([
      legacyMinimal({ disposition_note: "pre-rigor-contract" }),
    ]);
    const drifts = validateRegistry(parsed);
    expect(drifts).toEqual([]);
  });

  it("accepts aggregate severity on rollover summaries", () => {
    // Rollover summaries genuinely carry aggregate severities like
    // "Medium+Low" at runtime; the Severity union models canonical entries.
    const summary = {
      finding_id: "C7-D1-rollover-medium-low",
      domain: "D1",
      severity: "Medium+Low",
      description: "Cycle 7 untargeted M+L; defer",
      disposition: "partially_promoted",
      execution_status: "deferred",
    } as unknown as Finding;
    const drifts = validateRegistry(parseRegistry([summary]));
    expect(drifts.find((d) => d.reason === "invalid severity")).toBeUndefined();
  });

  it("rejects aggregate severity on a regular targeted finding", () => {
    // Cast through unknown: deliberately invalid input to verify rejection.
    const f = modernMinimal({
      severity: "Medium+Low" as unknown as Finding["severity"],
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === "invalid severity")).toBeDefined();
  });
});

describe("validateRegistry — invariants", () => {
  it("flags duplicate finding_id (Invariant 1: completeness)", () => {
    const parsed = parseRegistry([
      modernMinimal({ finding_id: "DUP-1" }),
      modernMinimal({ finding_id: "DUP-1" }),
    ]);
    const drifts = validateRegistry(parsed);
    const dup = drifts.find((d) => d.reason === "duplicate finding_id");
    expect(dup).toBeDefined();
    expect(dup?.finding_id).toBe("DUP-1");
  });

  it("flags broken dedup symmetry (Invariant 2)", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:B",
    });
    const b = modernMinimal({ finding_id: "B" /* no dedup_action */ });
    const drifts = validateRegistry(parseRegistry([a, b]));
    expect(drifts.find((d) => d.reason === "dedup symmetry broken")).toBeDefined();
  });

  it("flags merge_into pointing at a missing target (Invariant 2)", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:GHOST",
    });
    const drifts = validateRegistry(parseRegistry([a]));
    expect(drifts.find((d) => d.reason === "dedup target missing")).toBeDefined();
  });

  it("accepts symmetric merge_into / merged_from pair", () => {
    const a = modernMinimal({
      finding_id: "A",
      dedup_action: "merge_into:B",
    });
    const b = modernMinimal({
      finding_id: "B",
      dedup_action: "merged_from:A",
    });
    const drifts = validateRegistry(parseRegistry([a, b]));
    expect(drifts.filter((d) => d.reason.startsWith("dedup"))).toEqual([]);
  });

  it("flags tier=1 with missing tier1_pattern (Invariant 7)", () => {
    const f = modernMinimal({ execution_tier: 1, tier1_pattern: null });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "tier=1 missing tier1_pattern"),
    ).toBeDefined();
  });

  it("flags tier=1 with pattern outside the closed enum (Invariant 7)", () => {
    const f = modernMinimal({
      execution_tier: 1,
      tier1_pattern: "made-up-pattern",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "tier1_pattern outside closed enum"),
    ).toBeDefined();
  });

  it("accepts tier=1 with a pattern from the closed enum", () => {
    const f = modernMinimal({
      execution_tier: 1,
      tier1_pattern: "anti_slop_swap",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.filter((d) =>
        d.reason.includes("tier1_pattern") || d.reason.includes("tier=1"),
      ),
    ).toEqual([]);
  });

  it("flags shallow causal_chain_depth on non-grandfathered entry", () => {
    const f = modernMinimal({ causal_chain_depth: 1 });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(
      drifts.find((d) => d.reason === "shallow causal_chain_depth"),
    ).toBeDefined();
  });
});

describe("validateRegistry — Cycle Drain Contract (targeted parking)", () => {
  const PARK_REASON = "targeted finding parked at cycle close";

  it("flags a targeted finding with execution_status=deferred", () => {
    const f = modernMinimal({ execution_status: "deferred" });
    const drifts = validateRegistry(parseRegistry([f]));
    const parked = drifts.find((d) => d.reason === PARK_REASON);
    expect(parked).toBeDefined();
    expect(parked?.detail).toContain("Cycle Drain Contract");
    expect(parked?.detail).toContain("deferred");
  });

  it("flags a targeted finding with execution_status=never_attempted", () => {
    const f = modernMinimal({ execution_status: "never_attempted" });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeDefined();
  });

  it("does NOT flag a targeted finding with execution_status=done", () => {
    const f = modernMinimal({ execution_status: "done" });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted (human_only) finding with deferred status — archived data still validates", () => {
    const f = modernMinimal({
      disposition: "human_only",
      execution_status: "deferred",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });

  it("does NOT flag a non-targeted (excluded) finding with never_attempted status", () => {
    const f = modernMinimal({
      disposition: "excluded",
      execution_status: "never_attempted",
    });
    const drifts = validateRegistry(parseRegistry([f]));
    expect(drifts.find((d) => d.reason === PARK_REASON)).toBeUndefined();
  });
});

describe("validateRegistry — strict mode", () => {
  it("requires v2 envelope in strict mode", () => {
    const parsed = parseRegistry([modernMinimal()]);
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "schema_version missing")).toBeDefined();
  });

  it("flags schema_version mismatch", () => {
    const parsed = parseRegistry({
      schema_version: "1.0.0",
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(
      drifts.find((d) => d.reason === "schema_version mismatch"),
    ).toBeDefined();
  });

  it("rejects pre-rigor grandfather in strict mode", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [legacyMinimal({ disposition_note: "pre-rigor-contract" })],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "missing confidence")).toBeDefined();
  });

  it("requires execution_tier on every targeted entry in strict mode", () => {
    const f = modernMinimal();
    delete (f as { execution_tier?: unknown }).execution_tier;
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [f],
    });
    const drifts = validateRegistry(parsed, { strict: true });
    expect(drifts.find((d) => d.reason === "missing execution_tier")).toBeDefined();
  });
});

describe("validateRegistry — postPhase2", () => {
  it("flags missing work_unit on targeted findings after Phase 2", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal()],
    });
    const drifts = validateRegistry(parsed, { postPhase2: true });
    expect(drifts.find((d) => d.reason === "missing work_unit")).toBeDefined();
    expect(drifts.find((d) => d.reason === "missing wave")).toBeDefined();
  });

  it("passes when Phase 2 fields are populated", () => {
    const parsed = parseRegistry({
      schema_version: CURRENT_REGISTRY_VERSION,
      generated_at: FIXED_DATE,
      entries: [modernMinimal({ work_unit: "WU-A", wave: 1 })],
    });
    const drifts = validateRegistry(parsed, { postPhase2: true });
    expect(drifts).toEqual([]);
  });
});

describe("migrate", () => {
  it("wraps a legacy array in the v2 envelope", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    expect(result.registry.schema_version).toBe(CURRENT_REGISTRY_VERSION);
    expect(result.registry.generated_at).toBe(FIXED_DATE);
    expect(result.registry.entries).toHaveLength(1);
  });

  it("backfills rigor placeholders + disposition_note on pre-rigor entries", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.confidence).toBe("medium");
    expect(entry.causal_chain_depth).toBe(0);
    expect(entry.sources).toEqual([]);
    expect(entry.disposition_note).toBe("pre-rigor-contract");
    expect(entry.confidence_basis).toBe("backfilled-during-v2-migration");
    expect(entry.schema_revision).toBe("migrated-v1-to-v2");
    expect(result.stats.preRigorBackfilled).toBe(1);
  });

  it("does not overwrite existing rigor fields", () => {
    const original = modernMinimal({
      confidence: "high",
      causal_chain_depth: 5,
      sources: [{ url: "x" }],
    });
    const result = migrate([original], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.confidence).toBe("high");
    expect(entry.causal_chain_depth).toBe(5);
    expect(entry.sources).toEqual([{ url: "x" }]);
    expect(entry.disposition_note).toBeUndefined();
    expect(result.stats.preRigorBackfilled).toBe(0);
  });

  it("backfills execution_tier=3 when absent", () => {
    const f = legacyMinimal();
    delete (f as { execution_tier?: unknown }).execution_tier;
    const result = migrate([f], { generatedAt: FIXED_DATE });
    expect(result.registry.entries[0].execution_tier).toBe(3);
    expect(result.stats.tierBackfilled).toBe(1);
  });

  it("backfills central_path=false and false_positive=false when absent", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const entry = result.registry.entries[0];
    expect(entry.central_path).toBe(false);
    expect(entry.false_positive).toBe(false);
    expect(result.stats.centralPathBackfilled).toBe(1);
    expect(result.stats.falsePositiveBackfilled).toBe(1);
  });

  it("does not mutate the input array or its elements", () => {
    const inputEntry = legacyMinimal();
    const inputArr = [inputEntry];
    const snapshot = JSON.parse(JSON.stringify(inputArr));
    migrate(inputArr, { generatedAt: FIXED_DATE });
    expect(JSON.parse(JSON.stringify(inputArr))).toEqual(snapshot);
  });

  it("produces a v2 envelope that passes legacy-tolerant validation end-to-end", () => {
    const result = migrate([legacyMinimal()], { generatedAt: FIXED_DATE });
    const reparsed = parseRegistry(result.registry);
    const drifts = validateRegistry(reparsed);
    expect(drifts).toEqual([]);
  });
});
