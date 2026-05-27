// F14.3-C1 (Cycle 10 Wave 1, D14 Cross-Project Adaptability):
// regression test for the maturity-tier admission gate declared in
// `governance/CONSTITUTION.md` §6 Decision 16.
//
// Decision 16 declares a four-tier maturity model (solo / team / scaleup /
// enterprise) with per-tier admission gates wired through
// `TIER_TAG_REQUIREMENTS` in `src/content/index.ts:40-45`. The admission
// gate is enforced at stage 6 of `resolveSelection`
// (`src/content/index.ts:676-688`). The audit finding observed that prior
// to Cycle 10 Wave 1, zero canonical artifacts in the bundled content
// corpus carried any `tier:*` admission tag, so the gate was a no-op —
// resolved selection at `maturity=enterprise` was byte-identical to
// `maturity=solo`. This test prevents future regression by asserting that
// the four tiers continue to resolve to distinct supersets against the
// real canonical corpus, not synthetic fixtures.
//
// Unit-level admission semantics are exercised in
// `src/__tests__/content/index.test.ts` under "maturity tier admission" —
// this file complements those by binding the invariant to the live corpus.

import { describe, it, expect } from "vitest";
import { buildContentIndex, resolveSelection, getAllContentIds } from "../../content/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { getPreset } from "../../content/presets.js";
import type { MaturityTier } from "../../types.js";

describe("maturity-tier admission against canonical corpus (F14.3-C1)", () => {
  it("non-solo tiers each admit a strictly larger set than solo (Decision 16 gate is non-trivial)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);
    const preset = getPreset("full");

    const tiers: MaturityTier[] = ["solo", "team", "scaleup", "enterprise"];
    const idsByTier = new Map<MaturityTier, Set<string>>();
    for (const tier of tiers) {
      const selection = resolveSelection(
        preset,
        "brownfield",
        "team",
        index,
        undefined,
        undefined,
        { maturity: tier },
      );
      idsByTier.set(tier, getAllContentIds(selection));
    }

    const soloIds = idsByTier.get("solo")!;
    const teamIds = idsByTier.get("team")!;
    const scaleupIds = idsByTier.get("scaleup")!;
    const enterpriseIds = idsByTier.get("enterprise")!;

    // Each non-solo tier admits strictly more ids than solo.
    // The audit finding was that all four sets were identical.
    expect(teamIds.size).toBeGreaterThan(soloIds.size);
    expect(scaleupIds.size).toBeGreaterThan(soloIds.size);
    expect(enterpriseIds.size).toBeGreaterThan(soloIds.size);

    // Tier admission is monotonic: each higher tier admits a superset of
    // the lower tier (no item drops as the tier escalates).
    for (const id of soloIds) {
      expect(teamIds.has(id)).toBe(true);
      expect(scaleupIds.has(id)).toBe(true);
      expect(enterpriseIds.has(id)).toBe(true);
    }
    for (const id of teamIds) {
      expect(scaleupIds.has(id)).toBe(true);
      expect(enterpriseIds.has(id)).toBe(true);
    }
    for (const id of scaleupIds) {
      expect(enterpriseIds.has(id)).toBe(true);
    }

    // Each step up the tier ladder adds at least one item — otherwise an
    // adjacent pair would be byte-identical and Decision 16 would be a
    // no-op for that pair.
    expect(teamIds.size).toBeGreaterThan(soloIds.size);
    expect(scaleupIds.size).toBeGreaterThan(teamIds.size);
    expect(enterpriseIds.size).toBeGreaterThan(scaleupIds.size);
  });

  it("at least 12 canonical artifacts carry a tier:* admission tag (F14.3-C1 recommendation)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);

    const tierTagPattern = /^(tier:enterprise-only|tier:scaleup-plus|tier:team-plus|floor:enterprise-only)$/;
    const tagged = index.items.filter((item) => item.tags.some((t) => tierTagPattern.test(t)));

    // Audit finding F14.3-C1 recommendation step 1: tag ≥12 canonical
    // artifacts (3 per non-solo tier) by Wave 2. This assertion guards
    // against regression: a future refactor that strips tier tags would
    // surface here before the wider admission test goes vacuously green.
    expect(tagged.length).toBeGreaterThanOrEqual(12);

    // Distribution check: at least one artifact per non-solo tier (so each
    // tier band has a non-empty admission delta). Protected items bypass
    // the tier gate but still count toward authoring discipline coverage.
    const teamPlusCount = tagged.filter((item) => item.tags.includes("tier:team-plus")).length;
    const scaleupPlusCount = tagged.filter((item) => item.tags.includes("tier:scaleup-plus")).length;
    const enterpriseOnlyCount = tagged.filter(
      (item) => item.tags.includes("tier:enterprise-only") || item.tags.includes("floor:enterprise-only"),
    ).length;

    expect(teamPlusCount).toBeGreaterThanOrEqual(3);
    expect(scaleupPlusCount).toBeGreaterThanOrEqual(3);
    expect(enterpriseOnlyCount).toBeGreaterThanOrEqual(3);
  });
});
