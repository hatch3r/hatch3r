// D14-3 (Cycle 11, D14 Project Detection): build-time invariant guarding the
// language-detection ↔ language-tag mapping against silent skew.
//
// The bug: `repoAnalyzer.detectLanguages` can emit 18 language names (the
// `LANGUAGE_INDICATORS` keys + `csharp`), but `content/tags.ts::LANGUAGE_TO_TAG`
// maps only 8. The 10 unmapped names (php, swift, dart, elixir, scala, zig,
// ocaml, haskell, clojure, lua) resolve to ∅. Before the fix, a repo whose only
// detected language was unmapped produced an empty relevant-set and
// `filterByLanguages` dropped EVERY `lang:*`-tagged item (SA14.1-F2).
//
// Two guards live here:
//   1. Skew invariant — every detectable language is either mapped in
//      LANGUAGE_TO_TAG or named in UNMAPPED_BY_DESIGN below. A NEW detected
//      language that is neither mapped nor allowlisted fails this test, so the
//      next person to add a language indicator is forced to make a decision.
//   2. Safety net — `filterByLanguages` treats an all-unmapped project-language
//      list as a no-op (passes every item through), so even a deliberately
//      unmapped language never strips lang:*-tagged content.

import { describe, it, expect } from "vitest";
import { DETECTABLE_LANGUAGES } from "../../detect/repoAnalyzer.js";
import { LANGUAGE_TO_TAG, filterByLanguages } from "../../content/tags.js";

/**
 * Languages that `detectLanguages` recognises but that LANGUAGE_TO_TAG
 * deliberately does NOT map, because the canonical corpus ships no
 * `lang:<that>` content tag for them (the 6 language tags are typescript,
 * python, go, rust, java, ruby). Detecting them still has value — it feeds the
 * `RepoInfo.languages` summary and tier triggers — but there is nothing
 * language-specific to admit, so they map to ∅ on purpose. Adding a `lang:*`
 * tag + content for one of these moves it from this allowlist into
 * LANGUAGE_TO_TAG.
 */
const UNMAPPED_BY_DESIGN = new Set<string>([
  "php",
  "swift",
  "dart",
  "elixir",
  "scala",
  "zig",
  "ocaml",
  "haskell",
  "clojure",
  "lua",
  "csharp",
]);

describe("language-detection ↔ tag-mapping skew invariant (D14-3)", () => {
  it("every detectable language is either mapped in LANGUAGE_TO_TAG or allowlisted as unmapped-by-design", () => {
    const unaccounted = DETECTABLE_LANGUAGES.filter(
      (lang) => !(lang in LANGUAGE_TO_TAG) && !UNMAPPED_BY_DESIGN.has(lang),
    );
    expect(
      unaccounted,
      `detectLanguages can emit ${unaccounted.join(", ")} but they are neither in ` +
        `LANGUAGE_TO_TAG nor the UNMAPPED_BY_DESIGN allowlist — either add a lang:* ` +
        `mapping (and content) or allowlist them so filterByLanguages does not silently ` +
        `strip lang:*-tagged items for repos in this language`,
    ).toEqual([]);
  });

  it("Object.keys(LANGUAGE_TO_TAG) ⊇ (DETECTABLE_LANGUAGES − UNMAPPED_BY_DESIGN)", () => {
    const mustBeMapped = DETECTABLE_LANGUAGES.filter((l) => !UNMAPPED_BY_DESIGN.has(l));
    for (const lang of mustBeMapped) {
      expect(LANGUAGE_TO_TAG[lang], `expected LANGUAGE_TO_TAG to map ${lang}`).toBeDefined();
    }
  });

  it("the allowlist names only languages detectLanguages can actually emit (no dead entries)", () => {
    const detectable = new Set(DETECTABLE_LANGUAGES);
    for (const lang of UNMAPPED_BY_DESIGN) {
      expect(detectable.has(lang), `allowlist entry '${lang}' is not a detectable language`).toBe(true);
    }
  });

  it("no allowlisted language is also mapped (the allowlist and the map are disjoint)", () => {
    for (const lang of UNMAPPED_BY_DESIGN) {
      expect(lang in LANGUAGE_TO_TAG, `'${lang}' is both allowlisted and mapped`).toBe(false);
    }
  });
});

describe("filterByLanguages safety net for unmapped-language repos (D14-3)", () => {
  type Item = { id: string; tags: string[]; protected?: boolean };

  it("does not strip lang:*-tagged items when the sole detected language is unmapped (e.g. pure PHP)", () => {
    const items: Item[] = [
      { id: "ts-rule", tags: ["lang:typescript"] },
      { id: "py-rule", tags: ["lang:python"] },
      { id: "agnostic", tags: ["orchestration"] },
    ];
    // "php" is detectable but unmapped → relevant set is empty → no-op passthrough.
    const result = filterByLanguages(items, ["php"]);
    expect(result.map((i) => i.id)).toEqual(["ts-rule", "py-rule", "agnostic"]);
  });

  it("passes through when EVERY detected language is unmapped (multi-unmapped repo)", () => {
    const items: Item[] = [{ id: "ts-rule", tags: ["lang:typescript"] }];
    const result = filterByLanguages(items, ["swift", "elixir"]);
    expect(result.map((i) => i.id)).toEqual(["ts-rule"]);
  });

  it("still narrows when at least one detected language IS mapped (mixed mapped + unmapped)", () => {
    const items: Item[] = [
      { id: "py-rule", tags: ["lang:python"] },
      { id: "ts-rule", tags: ["lang:typescript"] },
      { id: "agnostic", tags: ["orchestration"] },
    ];
    // python is mapped, php is not → relevant = { lang:python }; the TS rule drops.
    const result = filterByLanguages(items, ["python", "php"]);
    expect(result.map((i) => i.id)).toEqual(["py-rule", "agnostic"]);
  });
});
