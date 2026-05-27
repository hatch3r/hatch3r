// F3.3-H2 (D3 Cycle 10 Wave 2): direct unit coverage for the maturity-tier
// admission predicate.
//
// `isAdmittedByMaturityTier` drives Stage 6 of resolveSelection (Decision 4 /
// Bucket 2.1). Before this file the predicate had ZERO direct tests — its truth
// table (maturity rank × tier-tag × protected) was only probed end-to-end
// through resolveSelection. Adding a fifth tier rank or reordering
// TIER_TAG_REQUIREMENTS could regress the table with no unit signal. These
// tests pin the predicate's truth table directly so a refactor that changes the
// admission math fails here, not silently downstream.
//
// Source of truth: src/content/index.ts (isAdmittedByMaturityTier +
// TIER_TAG_REQUIREMENTS) and src/types.ts (MATURITY_TIER_RANK: solo 0, team 1,
// scaleup 2, enterprise 3).

import { describe, it, expect } from "vitest";

import { isAdmittedByMaturityTier, TIER_TAG_REQUIREMENTS } from "../../content/index.js";
import { MATURITY_TIER_RANK, type MaturityTier } from "../../types.js";

const ALL_TIERS: MaturityTier[] = ["solo", "team", "scaleup", "enterprise"];

describe("isAdmittedByMaturityTier", () => {
  // ── Tag-absent: default-admit at every tier ──────────────────
  describe("item with no tier tag (default-admit)", () => {
    for (const tier of ALL_TIERS) {
      it(`admits a no-tier-tag item at maturity=${tier}`, () => {
        expect(isAdmittedByMaturityTier(["capability:implementation"], tier, false)).toBe(true);
      });
    }
  });

  // ── tier:team-plus — admitted at team, scaleup, enterprise; dropped at solo ──
  describe("tier:team-plus", () => {
    const cases: Array<[MaturityTier, boolean]> = [
      ["solo", false],
      ["team", true],
      ["scaleup", true],
      ["enterprise", true],
    ];
    for (const [tier, expected] of cases) {
      it(`maturity=${tier} → ${expected ? "admitted" : "dropped"}`, () => {
        expect(isAdmittedByMaturityTier(["tier:team-plus"], tier, false)).toBe(expected);
      });
    }
  });

  // ── tier:scaleup-plus — admitted at scaleup, enterprise; dropped below ──
  describe("tier:scaleup-plus", () => {
    const cases: Array<[MaturityTier, boolean]> = [
      ["solo", false],
      ["team", false],
      ["scaleup", true],
      ["enterprise", true],
    ];
    for (const [tier, expected] of cases) {
      it(`maturity=${tier} → ${expected ? "admitted" : "dropped"}`, () => {
        expect(isAdmittedByMaturityTier(["tier:scaleup-plus"], tier, false)).toBe(expected);
      });
    }
  });

  // ── tier:enterprise-only — admitted only at enterprise ──
  describe("tier:enterprise-only", () => {
    const cases: Array<[MaturityTier, boolean]> = [
      ["solo", false],
      ["team", false],
      ["scaleup", false],
      ["enterprise", true],
    ];
    for (const [tier, expected] of cases) {
      it(`maturity=${tier} → ${expected ? "admitted" : "dropped"}`, () => {
        expect(isAdmittedByMaturityTier(["tier:enterprise-only"], tier, false)).toBe(expected);
      });
    }
  });

  // ── floor:enterprise-only alias — identical to tier:enterprise-only ──
  describe("floor:enterprise-only (alias of tier:enterprise-only)", () => {
    it("drops at solo / team / scaleup", () => {
      for (const tier of ["solo", "team", "scaleup"] as MaturityTier[]) {
        expect(isAdmittedByMaturityTier(["floor:enterprise-only"], tier, false)).toBe(false);
      }
    });
    it("admits at enterprise", () => {
      expect(isAdmittedByMaturityTier(["floor:enterprise-only"], "enterprise", false)).toBe(true);
    });
  });

  // ── Protected bypass: a protected item ships at every tier even with the
  //    most restrictive tier tag ──
  describe("protected item bypasses tier gating", () => {
    for (const tier of ALL_TIERS) {
      it(`admits a protected tier:enterprise-only item at maturity=${tier}`, () => {
        expect(isAdmittedByMaturityTier(["tier:enterprise-only"], tier, true)).toBe(true);
      });
    }
  });

  // ── Most-restrictive-wins: an item carrying two tier tags is gated by the
  //    higher minimum tier ──
  it("a multi-tier-tagged item is gated by its highest minimum tier", () => {
    const tags = ["tier:team-plus", "tier:enterprise-only"];
    // team meets team-plus but not enterprise-only → dropped.
    expect(isAdmittedByMaturityTier(tags, "team", false)).toBe(false);
    // enterprise meets both → admitted.
    expect(isAdmittedByMaturityTier(tags, "enterprise", false)).toBe(true);
  });
});

describe("TIER_TAG_REQUIREMENTS table integrity", () => {
  it("every requirement names a known maturity tier and a registered tier/floor tag string", () => {
    for (const { tag, minTier } of TIER_TAG_REQUIREMENTS) {
      expect(MATURITY_TIER_RANK[minTier]).toBeDefined();
      expect(tag.startsWith("tier:") || tag === "floor:enterprise-only").toBe(true);
    }
  });

  it("covers all three tier admission levels plus the enterprise-only alias", () => {
    const tags = TIER_TAG_REQUIREMENTS.map((r) => r.tag);
    expect(tags).toContain("tier:team-plus");
    expect(tags).toContain("tier:scaleup-plus");
    expect(tags).toContain("tier:enterprise-only");
    expect(tags).toContain("floor:enterprise-only");
  });
});
