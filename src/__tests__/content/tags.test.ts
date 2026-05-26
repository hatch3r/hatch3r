import { describe, it, expect } from "vitest";
import {
  // Capability tags (1.x base)
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
  TAG_ORCHESTRATION,
  TAG_BOARD,
  TAG_PERFORMANCE,
  TAG_AI,
  // Capability tags (2.0.0 expansion — CQ-vector + work-type)
  TAG_ORCHESTRATOR,
  TAG_SECURITY,
  TAG_RELIABILITY,
  TAG_TESTING,
  TAG_SCALABILITY,
  TAG_MAINTAINABILITY,
  TAG_ENHANCABILITY,
  TAG_OBSERVABILITY,
  TAG_SUPPLY_CHAIN,
  TAG_ACCESSIBILITY,
  TAG_SPEC,
  TAG_GREENFIELD,
  TAG_BROWNFIELD,
  TAG_MIGRATION,
  TAG_TELEMETRY,
  TAG_COST,
  TAG_ANTI_DUPLICATION,
  TAG_CODE_QUALITY,
  TAG_CODE_STANDARDS,
  TAG_ADAPTERS,
  TAG_CAPABILITY,
  TAG_CURRENCY,
  TAG_ITERATION,
  TAG_SUMMARY,
  TAG_LEARNING,
  TAG_KNOWLEDGE_CAPTURE,
  TAG_PROOF,
  TAG_VERIFICATION,
  TAG_CITATION,
  TAG_PLAYWRIGHT,
  TAG_VISUAL_REGRESSION,
  // Floor tags
  TAG_FLOOR_SECURITY,
  TAG_FLOOR_UI_UX,
  TAG_FLOOR_PROTOCOL,
  TAG_FLOOR_CONTENT_QUALITY,
  // Context tags
  TAG_CTX_GREENFIELD_ONLY,
  TAG_CTX_BROWNFIELD_ONLY,
  TAG_CTX_TEAM_ONLY,
  // Customize
  TAG_CUSTOMIZE,
  // UI/UX specialisation
  TAG_A11Y,
  TAG_FRONTEND,
  TAG_UI,
  TAG_UX,
  TAG_DESIGN_SYSTEM,
  // CLI tool family
  TAG_CLI_TOOLS,
  TAG_OPT_IN,
  TAG_CAVEAT,
  TAG_REFERENCE,
  // CLI category
  TAG_CAT_SEARCH,
  TAG_CAT_JSON,
  TAG_CAT_YAML,
  TAG_CAT_GIT,
  TAG_CAT_VIEW,
  TAG_CAT_EDIT,
  TAG_CAT_ARCHIVE,
  TAG_CAT_DATA,
  TAG_CAT_FORGE,
  TAG_CAT_BROWSER,
  TAG_CAT_CONTAINER,
  TAG_CAT_AI,
  TAG_CAT_INTERACTIVE,
  // Language
  TAG_LANG_TYPESCRIPT,
  TAG_LANG_PYTHON,
  TAG_LANG_GO,
  TAG_LANG_RUST,
  TAG_LANG_JAVA,
  TAG_LANG_RUBY,
  // Helpers and registry
  ALL_TAGS,
  TAG_REGISTRY,
  facetOf,
  tagsForFacet,
  isCapabilityTag,
  isFloorTag,
  isContextTag,
  isCustomizeTag,
  isUiUxSpecialisation,
  isLanguageTag,
  LANGUAGE_TO_TAG,
  resolveLanguageTags,
  filterByLanguages,
} from "../../content/tags.js";

// ── Capability tag constants ─────────────────────────────────────

describe("capability tag constants", () => {
  it("TAG_PLANNING equals 'planning'", () => {
    expect(TAG_PLANNING).toBe("planning");
  });

  it("TAG_IMPLEMENTATION equals 'implementation'", () => {
    expect(TAG_IMPLEMENTATION).toBe("implementation");
  });

  it("TAG_REVIEW equals 'review'", () => {
    expect(TAG_REVIEW).toBe("review");
  });

  it("TAG_DEVOPS equals 'devops'", () => {
    expect(TAG_DEVOPS).toBe("devops");
  });

  it("TAG_MAINTENANCE equals 'maintenance'", () => {
    expect(TAG_MAINTENANCE).toBe("maintenance");
  });

  it("TAG_ORCHESTRATION equals 'orchestration' (formerly TAG_CORE)", () => {
    expect(TAG_ORCHESTRATION).toBe("orchestration");
  });

  it("TAG_BOARD equals 'board'", () => {
    expect(TAG_BOARD).toBe("board");
  });

  it("TAG_PERFORMANCE equals 'performance'", () => {
    expect(TAG_PERFORMANCE).toBe("performance");
  });

  it("TAG_AI equals 'ai' (new capability tag, distinct from TAG_CAT_AI)", () => {
    expect(TAG_AI).toBe("ai");
  });
});

// ── Floor tag constants ──────────────────────────────────────────

describe("floor tag constants", () => {
  it("TAG_FLOOR_SECURITY equals 'floor:security'", () => {
    expect(TAG_FLOOR_SECURITY).toBe("floor:security");
  });

  it("TAG_FLOOR_UI_UX equals 'floor:ui-ux'", () => {
    expect(TAG_FLOOR_UI_UX).toBe("floor:ui-ux");
  });

  it("TAG_FLOOR_PROTOCOL equals 'floor:protocol'", () => {
    expect(TAG_FLOOR_PROTOCOL).toBe("floor:protocol");
  });
});

// ── Context tag constants ────────────────────────────────────────

describe("context tag constants", () => {
  it("TAG_CTX_GREENFIELD_ONLY equals 'ctx:greenfield-only'", () => {
    expect(TAG_CTX_GREENFIELD_ONLY).toBe("ctx:greenfield-only");
  });

  it("TAG_CTX_BROWNFIELD_ONLY equals 'ctx:brownfield-only'", () => {
    expect(TAG_CTX_BROWNFIELD_ONLY).toBe("ctx:brownfield-only");
  });

  it("TAG_CTX_TEAM_ONLY equals 'ctx:team-only'", () => {
    expect(TAG_CTX_TEAM_ONLY).toBe("ctx:team-only");
  });
});

// ── Customize and UI/UX specialisation ───────────────────────────

describe("customize and ui-ux specialisation tag constants", () => {
  it("TAG_CUSTOMIZE equals 'customize'", () => {
    expect(TAG_CUSTOMIZE).toBe("customize");
  });

  it("TAG_A11Y equals 'a11y'", () => {
    expect(TAG_A11Y).toBe("a11y");
  });

  it("TAG_FRONTEND equals 'frontend'", () => {
    expect(TAG_FRONTEND).toBe("frontend");
  });

  it("TAG_UI equals 'ui'", () => {
    expect(TAG_UI).toBe("ui");
  });

  it("TAG_UX equals 'ux'", () => {
    expect(TAG_UX).toBe("ux");
  });

  it("TAG_DESIGN_SYSTEM equals 'design-system'", () => {
    expect(TAG_DESIGN_SYSTEM).toBe("design-system");
  });
});

// ── CLI category — rename verification ───────────────────────────

describe("CLI category — 'ai' renamed to 'ai-cat' to disambiguate from capability tag", () => {
  it("TAG_CAT_AI equals 'ai-cat' (not 'ai')", () => {
    expect(TAG_CAT_AI).toBe("ai-cat");
  });

  it("TAG_AI (capability) and TAG_CAT_AI (cli category) have distinct values", () => {
    expect(TAG_AI).not.toBe(TAG_CAT_AI);
  });

  it("TAG_CAT_AI is registered as a cli-tool-category facet", () => {
    expect(facetOf(TAG_CAT_AI)).toBe("cli-tool-category");
  });

  it("TAG_AI is registered as a capability facet", () => {
    expect(facetOf(TAG_AI)).toBe("capability");
  });
});

// ── TAG_REGISTRY consistency ─────────────────────────────────────

describe("TAG_REGISTRY consistency", () => {
  it("every exported TAG_* constant has an entry in TAG_REGISTRY", () => {
    const exportedTagValues = [
      TAG_PLANNING, TAG_IMPLEMENTATION, TAG_REVIEW, TAG_DEVOPS, TAG_MAINTENANCE,
      TAG_ORCHESTRATION, TAG_BOARD, TAG_PERFORMANCE, TAG_AI,
      TAG_FLOOR_SECURITY, TAG_FLOOR_UI_UX, TAG_FLOOR_PROTOCOL,
      TAG_CTX_GREENFIELD_ONLY, TAG_CTX_BROWNFIELD_ONLY, TAG_CTX_TEAM_ONLY,
      TAG_CUSTOMIZE,
      TAG_A11Y, TAG_FRONTEND, TAG_UI, TAG_UX, TAG_DESIGN_SYSTEM,
      TAG_CLI_TOOLS, TAG_OPT_IN, TAG_CAVEAT, TAG_REFERENCE,
      TAG_CAT_SEARCH, TAG_CAT_JSON, TAG_CAT_YAML, TAG_CAT_GIT, TAG_CAT_VIEW,
      TAG_CAT_EDIT, TAG_CAT_ARCHIVE, TAG_CAT_DATA, TAG_CAT_FORGE,
      TAG_CAT_BROWSER, TAG_CAT_CONTAINER, TAG_CAT_AI, TAG_CAT_INTERACTIVE,
      TAG_LANG_TYPESCRIPT, TAG_LANG_PYTHON, TAG_LANG_GO, TAG_LANG_RUST,
      TAG_LANG_JAVA, TAG_LANG_RUBY,
    ];
    for (const tag of exportedTagValues) {
      expect(TAG_REGISTRY[tag], `expected TAG_REGISTRY to contain ${tag}`).toBeDefined();
    }
  });

  it("TAG_REGISTRY keys equal ALL_TAGS (single source of truth)", () => {
    expect(Object.keys(TAG_REGISTRY).sort()).toEqual([...ALL_TAGS].sort());
  });

  it("ALL_TAGS has no duplicate values", () => {
    const unique = new Set(ALL_TAGS);
    expect(unique.size).toBe(ALL_TAGS.length);
  });

  it("ALL_TAGS contains exactly 76 elements (40 capability + 4 floor + 3 context + 1 customize + 5 ui-ux + 4 cli-tool + 13 cli-cat + 6 language) — 2.0.0 expansion", () => {
    expect(ALL_TAGS).toHaveLength(76);
  });

  it("facetOf returns 'capability' for every capability tag", () => {
    const capTags = [
      // 1.x base
      TAG_PLANNING, TAG_IMPLEMENTATION, TAG_REVIEW, TAG_DEVOPS, TAG_MAINTENANCE,
      TAG_ORCHESTRATION, TAG_BOARD, TAG_PERFORMANCE, TAG_AI,
      // 2.0.0 expansion
      TAG_ORCHESTRATOR, TAG_SECURITY, TAG_RELIABILITY, TAG_TESTING, TAG_SCALABILITY,
      TAG_MAINTAINABILITY, TAG_ENHANCABILITY, TAG_OBSERVABILITY, TAG_SUPPLY_CHAIN,
      TAG_ACCESSIBILITY, TAG_SPEC, TAG_GREENFIELD, TAG_BROWNFIELD, TAG_MIGRATION,
      TAG_TELEMETRY, TAG_COST, TAG_ANTI_DUPLICATION, TAG_CODE_QUALITY, TAG_CODE_STANDARDS,
      TAG_ADAPTERS, TAG_CAPABILITY, TAG_CURRENCY, TAG_ITERATION, TAG_SUMMARY,
      TAG_LEARNING, TAG_KNOWLEDGE_CAPTURE, TAG_PROOF, TAG_VERIFICATION, TAG_CITATION,
      TAG_PLAYWRIGHT, TAG_VISUAL_REGRESSION,
    ];
    for (const tag of capTags) {
      expect(facetOf(tag)).toBe("capability");
    }
  });

  it("facetOf returns 'floor' for every floor tag", () => {
    expect(facetOf(TAG_FLOOR_SECURITY)).toBe("floor");
    expect(facetOf(TAG_FLOOR_UI_UX)).toBe("floor");
    expect(facetOf(TAG_FLOOR_PROTOCOL)).toBe("floor");
    expect(facetOf(TAG_FLOOR_CONTENT_QUALITY)).toBe("floor");
  });

  it("facetOf returns 'context' for every context tag", () => {
    expect(facetOf(TAG_CTX_GREENFIELD_ONLY)).toBe("context");
    expect(facetOf(TAG_CTX_BROWNFIELD_ONLY)).toBe("context");
    expect(facetOf(TAG_CTX_TEAM_ONLY)).toBe("context");
  });

  it("facetOf returns 'customize' for TAG_CUSTOMIZE", () => {
    expect(facetOf(TAG_CUSTOMIZE)).toBe("customize");
  });

  it("facetOf returns 'ui-ux-specialisation' for every ui-ux tag", () => {
    expect(facetOf(TAG_A11Y)).toBe("ui-ux-specialisation");
    expect(facetOf(TAG_FRONTEND)).toBe("ui-ux-specialisation");
    expect(facetOf(TAG_UI)).toBe("ui-ux-specialisation");
    expect(facetOf(TAG_UX)).toBe("ui-ux-specialisation");
    expect(facetOf(TAG_DESIGN_SYSTEM)).toBe("ui-ux-specialisation");
  });

  it("facetOf returns 'cli-tool' for marker/tier classifier tags", () => {
    expect(facetOf(TAG_CLI_TOOLS)).toBe("cli-tool");
    expect(facetOf(TAG_OPT_IN)).toBe("cli-tool");
    expect(facetOf(TAG_CAVEAT)).toBe("cli-tool");
    expect(facetOf(TAG_REFERENCE)).toBe("cli-tool");
  });

  it("facetOf returns 'cli-tool-category' for each CLI category tag", () => {
    const catTags = [
      TAG_CAT_SEARCH, TAG_CAT_JSON, TAG_CAT_YAML, TAG_CAT_GIT, TAG_CAT_VIEW,
      TAG_CAT_EDIT, TAG_CAT_ARCHIVE, TAG_CAT_DATA, TAG_CAT_FORGE,
      TAG_CAT_BROWSER, TAG_CAT_CONTAINER, TAG_CAT_AI, TAG_CAT_INTERACTIVE,
    ];
    for (const tag of catTags) {
      expect(facetOf(tag)).toBe("cli-tool-category");
    }
  });

  it("facetOf returns 'language' for every language tag", () => {
    expect(facetOf(TAG_LANG_TYPESCRIPT)).toBe("language");
    expect(facetOf(TAG_LANG_PYTHON)).toBe("language");
    expect(facetOf(TAG_LANG_GO)).toBe("language");
    expect(facetOf(TAG_LANG_RUST)).toBe("language");
    expect(facetOf(TAG_LANG_JAVA)).toBe("language");
    expect(facetOf(TAG_LANG_RUBY)).toBe("language");
  });

  it("facetOf returns undefined for unknown / legacy tag values", () => {
    expect(facetOf("core")).toBeUndefined();
    expect(facetOf("solo")).toBeUndefined();
    expect(facetOf("team")).toBeUndefined();
    expect(facetOf("not-a-tag")).toBeUndefined();
    expect(facetOf("")).toBeUndefined();
    // Note: 2.0.0 expansion moved `security`, `greenfield`, `brownfield` from "unknown" to "capability"
    // per Decision 13 (CQ-vector specialist agents) and Decision 14 (spec agents).
  });
});

// ── tagsForFacet — facet enumeration ─────────────────────────────

describe("tagsForFacet", () => {
  it("returns the 40 capability tags (9 base + 31 2.0.0 expansion)", () => {
    const result = tagsForFacet("capability");
    expect(result).toHaveLength(40);
    expect(result.sort()).toEqual(
      [
        // 1.x base
        TAG_PLANNING, TAG_IMPLEMENTATION, TAG_REVIEW, TAG_DEVOPS, TAG_MAINTENANCE,
        TAG_ORCHESTRATION, TAG_BOARD, TAG_PERFORMANCE, TAG_AI,
        // 2.0.0 expansion
        TAG_ORCHESTRATOR, TAG_SECURITY, TAG_RELIABILITY, TAG_TESTING, TAG_SCALABILITY,
        TAG_MAINTAINABILITY, TAG_ENHANCABILITY, TAG_OBSERVABILITY, TAG_SUPPLY_CHAIN,
        TAG_ACCESSIBILITY, TAG_SPEC, TAG_GREENFIELD, TAG_BROWNFIELD, TAG_MIGRATION,
        TAG_TELEMETRY, TAG_COST, TAG_ANTI_DUPLICATION, TAG_CODE_QUALITY, TAG_CODE_STANDARDS,
        TAG_ADAPTERS, TAG_CAPABILITY, TAG_CURRENCY, TAG_ITERATION, TAG_SUMMARY,
        TAG_LEARNING, TAG_KNOWLEDGE_CAPTURE, TAG_PROOF, TAG_VERIFICATION, TAG_CITATION,
        TAG_PLAYWRIGHT, TAG_VISUAL_REGRESSION,
      ].sort(),
    );
  });

  it("returns the 4 floor tags (3 base + floor:content-quality 2.0.0)", () => {
    const result = tagsForFacet("floor");
    expect(result).toHaveLength(4);
    expect(result.sort()).toEqual(
      [TAG_FLOOR_SECURITY, TAG_FLOOR_UI_UX, TAG_FLOOR_PROTOCOL, TAG_FLOOR_CONTENT_QUALITY].sort(),
    );
  });

  it("returns the 3 context tags", () => {
    const result = tagsForFacet("context");
    expect(result).toHaveLength(3);
    expect(result.sort()).toEqual(
      [TAG_CTX_GREENFIELD_ONLY, TAG_CTX_BROWNFIELD_ONLY, TAG_CTX_TEAM_ONLY].sort(),
    );
  });

  it("returns the single customize tag", () => {
    const result = tagsForFacet("customize");
    expect(result).toEqual([TAG_CUSTOMIZE]);
  });

  it("returns the 5 ui-ux-specialisation tags", () => {
    const result = tagsForFacet("ui-ux-specialisation");
    expect(result).toHaveLength(5);
    expect(result.sort()).toEqual(
      [TAG_A11Y, TAG_FRONTEND, TAG_UI, TAG_UX, TAG_DESIGN_SYSTEM].sort(),
    );
  });

  it("returns the 4 cli-tool marker/tier tags", () => {
    const result = tagsForFacet("cli-tool");
    expect(result).toHaveLength(4);
    expect(result.sort()).toEqual(
      [TAG_CLI_TOOLS, TAG_OPT_IN, TAG_CAVEAT, TAG_REFERENCE].sort(),
    );
  });

  it("returns the 13 cli-tool-category tags including 'ai-cat'", () => {
    const result = tagsForFacet("cli-tool-category");
    expect(result).toHaveLength(13);
    expect(result).toContain(TAG_CAT_AI);
    expect(TAG_CAT_AI).toBe("ai-cat");
  });

  it("returns the 6 language tags", () => {
    const result = tagsForFacet("language");
    expect(result).toHaveLength(6);
    for (const t of result) {
      expect(t).toMatch(/^lang:/);
    }
  });
});

// ── Facet predicates ─────────────────────────────────────────────

describe("isCapabilityTag", () => {
  it("returns true for capability tags", () => {
    expect(isCapabilityTag(TAG_PLANNING)).toBe(true);
    expect(isCapabilityTag(TAG_IMPLEMENTATION)).toBe(true);
    expect(isCapabilityTag(TAG_ORCHESTRATION)).toBe(true);
    expect(isCapabilityTag(TAG_AI)).toBe(true);
  });

  it("returns false for non-capability tags", () => {
    expect(isCapabilityTag(TAG_FLOOR_SECURITY)).toBe(false);
    expect(isCapabilityTag(TAG_CTX_TEAM_ONLY)).toBe(false);
    expect(isCapabilityTag(TAG_CUSTOMIZE)).toBe(false);
    expect(isCapabilityTag(TAG_LANG_TYPESCRIPT)).toBe(false);
    expect(isCapabilityTag("core")).toBe(false); // legacy
    expect(isCapabilityTag("")).toBe(false);
  });
});

describe("isFloorTag", () => {
  it("returns true for floor tags", () => {
    expect(isFloorTag(TAG_FLOOR_SECURITY)).toBe(true);
    expect(isFloorTag(TAG_FLOOR_UI_UX)).toBe(true);
    expect(isFloorTag(TAG_FLOOR_PROTOCOL)).toBe(true);
  });

  it("returns false for non-floor tags", () => {
    expect(isFloorTag(TAG_PLANNING)).toBe(false);
    expect(isFloorTag(TAG_A11Y)).toBe(false);
    expect(isFloorTag("security")).toBe(false); // legacy
    expect(isFloorTag("")).toBe(false);
  });
});

describe("isContextTag", () => {
  it("returns true for context tags", () => {
    expect(isContextTag(TAG_CTX_GREENFIELD_ONLY)).toBe(true);
    expect(isContextTag(TAG_CTX_BROWNFIELD_ONLY)).toBe(true);
    expect(isContextTag(TAG_CTX_TEAM_ONLY)).toBe(true);
  });

  it("returns false for non-context tags", () => {
    expect(isContextTag(TAG_PLANNING)).toBe(false);
    expect(isContextTag(TAG_FLOOR_SECURITY)).toBe(false);
    expect(isContextTag("team")).toBe(false); // legacy
    expect(isContextTag("greenfield")).toBe(false); // legacy
    expect(isContextTag("")).toBe(false);
  });
});

describe("isCustomizeTag", () => {
  it("returns true for TAG_CUSTOMIZE", () => {
    expect(isCustomizeTag(TAG_CUSTOMIZE)).toBe(true);
  });

  it("returns false for every other tag", () => {
    expect(isCustomizeTag(TAG_PLANNING)).toBe(false);
    expect(isCustomizeTag(TAG_FLOOR_SECURITY)).toBe(false);
    expect(isCustomizeTag(TAG_A11Y)).toBe(false);
    expect(isCustomizeTag("")).toBe(false);
  });
});

describe("isUiUxSpecialisation", () => {
  it("returns true for ui-ux specialisation tags", () => {
    expect(isUiUxSpecialisation(TAG_A11Y)).toBe(true);
    expect(isUiUxSpecialisation(TAG_FRONTEND)).toBe(true);
    expect(isUiUxSpecialisation(TAG_UI)).toBe(true);
    expect(isUiUxSpecialisation(TAG_UX)).toBe(true);
    expect(isUiUxSpecialisation(TAG_DESIGN_SYSTEM)).toBe(true);
  });

  it("returns false for non-ui-ux tags", () => {
    expect(isUiUxSpecialisation(TAG_FLOOR_UI_UX)).toBe(false); // floor, not specialisation
    expect(isUiUxSpecialisation(TAG_PLANNING)).toBe(false);
    expect(isUiUxSpecialisation("")).toBe(false);
  });
});

describe("isLanguageTag", () => {
  it("returns true for language tags", () => {
    expect(isLanguageTag("lang:typescript")).toBe(true);
    expect(isLanguageTag("lang:python")).toBe(true);
    expect(isLanguageTag("lang:go")).toBe(true);
  });

  it("returns false for non-language tags", () => {
    expect(isLanguageTag(TAG_PLANNING)).toBe(false);
    expect(isLanguageTag(TAG_FLOOR_SECURITY)).toBe(false);
    expect(isLanguageTag("")).toBe(false);
  });
});

// ── CLI category breadth ─────────────────────────────────────────

describe("CLI category coverage", () => {
  it("contains the 13 categories from CliToolMeta.category union", () => {
    const cats = tagsForFacet("cli-tool-category");
    expect(cats).toHaveLength(13);
    expect(cats).toContain(TAG_CAT_SEARCH);
    expect(cats).toContain(TAG_CAT_JSON);
    expect(cats).toContain(TAG_CAT_YAML);
    expect(cats).toContain(TAG_CAT_GIT);
    expect(cats).toContain(TAG_CAT_VIEW);
    expect(cats).toContain(TAG_CAT_EDIT);
    expect(cats).toContain(TAG_CAT_ARCHIVE);
    expect(cats).toContain(TAG_CAT_DATA);
    expect(cats).toContain(TAG_CAT_FORGE);
    expect(cats).toContain(TAG_CAT_BROWSER);
    expect(cats).toContain(TAG_CAT_CONTAINER);
    expect(cats).toContain(TAG_CAT_AI);
    expect(cats).toContain(TAG_CAT_INTERACTIVE);
  });
});

// ── LANGUAGE_TO_TAG ──────────────────────────────────────────────

describe("LANGUAGE_TO_TAG", () => {
  it("maps typescript to lang:typescript", () => {
    expect(LANGUAGE_TO_TAG["typescript"]).toBe(TAG_LANG_TYPESCRIPT);
  });

  it("maps javascript to lang:typescript (JS benefits from TS rules)", () => {
    expect(LANGUAGE_TO_TAG["javascript"]).toBe(TAG_LANG_TYPESCRIPT);
  });

  it("maps python to lang:python", () => {
    expect(LANGUAGE_TO_TAG["python"]).toBe(TAG_LANG_PYTHON);
  });

  it("maps go to lang:go", () => {
    expect(LANGUAGE_TO_TAG["go"]).toBe(TAG_LANG_GO);
  });

  it("maps rust to lang:rust", () => {
    expect(LANGUAGE_TO_TAG["rust"]).toBe(TAG_LANG_RUST);
  });

  it("maps java to lang:java", () => {
    expect(LANGUAGE_TO_TAG["java"]).toBe(TAG_LANG_JAVA);
  });

  it("maps kotlin to lang:java (shared ecosystem)", () => {
    expect(LANGUAGE_TO_TAG["kotlin"]).toBe(TAG_LANG_JAVA);
  });

  it("maps ruby to lang:ruby", () => {
    expect(LANGUAGE_TO_TAG["ruby"]).toBe(TAG_LANG_RUBY);
  });
});

// ── resolveLanguageTags ──────────────────────────────────────────

describe("resolveLanguageTags", () => {
  it("maps a single known language to its lang:* tag", () => {
    const result = resolveLanguageTags(["typescript"]);
    expect(result.has(TAG_LANG_TYPESCRIPT)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("maps multiple known languages to their tags", () => {
    const result = resolveLanguageTags(["python", "go"]);
    expect(result.has(TAG_LANG_PYTHON)).toBe(true);
    expect(result.has(TAG_LANG_GO)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("collapses javascript and typescript to the same lang:typescript tag", () => {
    const result = resolveLanguageTags(["javascript", "typescript"]);
    expect(result.has(TAG_LANG_TYPESCRIPT)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("silently drops unknown languages (e.g. 'unknown', 'cobol')", () => {
    const result = resolveLanguageTags(["unknown", "cobol", "python"]);
    expect(result.has(TAG_LANG_PYTHON)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("returns an empty set for an empty input", () => {
    const result = resolveLanguageTags([]);
    expect(result.size).toBe(0);
  });
});

// ── filterByLanguages ────────────────────────────────────────────

describe("filterByLanguages", () => {
  // Minimal local fixture — independent of CatalogItem to keep this a unit test.
  type Item = { id: string; tags: string[]; protected?: boolean };

  function item(id: string, tags: string[], extras: Partial<Item> = {}): Item {
    return { id, tags, ...extras };
  }

  it("includes items with no lang:* tags (universal/agnostic content)", () => {
    const items: Item[] = [
      item("agnostic-a", [TAG_ORCHESTRATION]),
      item("agnostic-b", [TAG_FLOOR_SECURITY]),
      item("agnostic-c", []),
    ];
    const result = filterByLanguages(items, ["python"]);
    expect(result.map((i) => i.id)).toEqual(["agnostic-a", "agnostic-b", "agnostic-c"]);
  });

  it("includes items whose lang:* tag matches a project language", () => {
    const items: Item[] = [
      item("py-rule", ["lang:python"]),
      item("ts-rule", ["lang:typescript"]),
    ];
    const result = filterByLanguages(items, ["python"]);
    expect(result.map((i) => i.id)).toEqual(["py-rule"]);
  });

  it("excludes items whose lang:* tags do not intersect the project languages", () => {
    const items: Item[] = [
      item("ts-only", [TAG_ORCHESTRATION, "lang:typescript"]),
      item("go-only", [TAG_ORCHESTRATION, "lang:go"]),
      item("agnostic", [TAG_ORCHESTRATION]),
    ];
    const result = filterByLanguages(items, ["python"]);
    expect(result.map((i) => i.id)).toEqual(["agnostic"]);
  });

  it("includes items with at least one matching lang tag among many", () => {
    const items: Item[] = [
      item("multi", ["lang:python", "lang:go", "lang:rust"]),
    ];
    expect(filterByLanguages(items, ["go"]).map((i) => i.id)).toEqual(["multi"]);
    expect(filterByLanguages(items, ["python"]).map((i) => i.id)).toEqual(["multi"]);
    expect(filterByLanguages(items, ["java"]).map((i) => i.id)).toEqual([]);
  });

  it("treats projectLanguages=[] as a no-op (returns all items unchanged)", () => {
    const items: Item[] = [
      item("ts-only", ["lang:typescript"]),
      item("agnostic", [TAG_ORCHESTRATION]),
    ];
    const result = filterByLanguages(items, []);
    expect(result.map((i) => i.id)).toEqual(["ts-only", "agnostic"]);
  });

  it("always includes protected items even when their lang tag does not match", () => {
    const items: Item[] = [
      item("ts-protected", ["lang:typescript"], { protected: true }),
      item("ts-unprotected", ["lang:typescript"]),
    ];
    const result = filterByLanguages(items, ["python"]);
    expect(result.map((i) => i.id)).toEqual(["ts-protected"]);
  });

  it("multi-language projects include items matching any of the listed languages", () => {
    const items: Item[] = [
      item("py-rule", ["lang:python"]),
      item("go-rule", ["lang:go"]),
      item("ruby-rule", ["lang:ruby"]),
    ];
    const result = filterByLanguages(items, ["python", "go"]);
    expect(result.map((i) => i.id).sort()).toEqual(["go-rule", "py-rule"]);
  });

  it("javascript projects accept items tagged lang:typescript (alias mapping)", () => {
    const items: Item[] = [item("ts-rule", ["lang:typescript"])];
    const result = filterByLanguages(items, ["javascript"]);
    expect(result.map((i) => i.id)).toEqual(["ts-rule"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [item("a", ["lang:python"]), item("b", ["lang:go"])];
    const snapshot = [...items];
    filterByLanguages(items, ["python"]);
    expect(items).toEqual(snapshot);
  });
});
