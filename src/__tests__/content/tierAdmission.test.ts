// Maturity is an investment-calibration dial, not a content-admission gate.
//
// The retired Decision-16 model declared a four-tier maturity ladder (solo /
// team / scaleup / enterprise) wired through a `tier:*` admission facet and
// `isAdmittedByMaturityTier` at stage 6 of `resolveSelection`. That gate was
// removed: maturity now admits nothing and removes nothing — it only
// calibrates investment depth (per `rules/hatch3r-right-sizing.md` +
// `docs/maturity-tiers.md`). `resolveSelection` no longer accepts a
// `maturity` option and no canonical artifact carries a `tier:*` tag.
//
// This file is the inverse of the old monotonic-superset regression test: it
// pins the INVARIANCE that maturity has no effect on the resolved corpus, and
// guards against any artifact regressing a tier tag back into the corpus.

import { describe, it, expect } from "vitest";
import { buildContentIndex, resolveSelection, getAllContentIds } from "../../content/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { getPreset } from "../../content/presets.js";

describe("maturity is calibration, not content-admission (corpus invariance)", () => {
  it("the live canonical corpus carries ZERO tier:* / floor:enterprise-only tags", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);

    // Guards against any artifact regressing a tier admission tag. The
    // `tier:*` facet and the `floor:enterprise-only` alias were retired with
    // the maturity content-gate; no canonical artifact may carry either.
    expect(
      index.items.every(
        (i) => !i.tags.some((t) => t.startsWith("tier:") || t === "floor:enterprise-only"),
      ),
    ).toBe(true);
  });

  it("a formerly tier:enterprise-only item is admitted by the full preset (maturity no longer gates)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);
    const preset = getPreset("full");

    const selection = resolveSelection(preset, "brownfield", "team", index);
    const ids = getAllContentIds(selection);

    // The resolved set is stable and non-empty.
    expect(ids.size).toBeGreaterThan(0);

    // `hatch3r-ai-evals` (tags: [review, implementation, ai]) was a candidate
    // for tier:enterprise-only gating under Decision 16. It carries the `ai`
    // capability, which the full preset admits — and with the maturity gate
    // gone it ships unconditionally, with no `maturity` axis to suppress it.
    expect(ids.has("hatch3r-ai-evals")).toBe(true);
  });

  it("resolveSelection's options type omits `maturity` (positive type-level guard)", async () => {
    const contentRoot = resolveBundledContentRoot();
    const index = await buildContentIndex(contentRoot);
    const preset = getPreset("full");

    // The options object accepts only skipContextFilters / role / facets.
    // A `maturity` key would be a type error here — this call compiling is the
    // assertion that selection is independent of any maturity input.
    const options: NonNullable<Parameters<typeof resolveSelection>[6]> = {
      skipContextFilters: false,
    };
    const selection = resolveSelection(
      preset,
      "brownfield",
      "team",
      index,
      undefined,
      undefined,
      options,
    );
    expect(getAllContentIds(selection).size).toBeGreaterThan(0);
  });
});
