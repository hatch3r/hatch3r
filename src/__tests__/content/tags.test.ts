import { describe, it, expect } from "vitest";
import {
  TAG_CORE,
  TAG_PLANNING,
  TAG_IMPLEMENTATION,
  TAG_REVIEW,
  TAG_DEVOPS,
  TAG_MAINTENANCE,
  TAG_GREENFIELD,
  TAG_BROWNFIELD,
  TAG_SOLO,
  TAG_TEAM,
  TAG_BOARD,
  TAG_SECURITY,
  TAG_A11Y,
  TAG_PERFORMANCE,
  TAG_CUSTOMIZE,
  TAG_FRONTEND,
  TAG_UI,
  TAG_UX,
  TAG_DESIGN_SYSTEM,
  TAG_CLI_TOOLS,
  TAG_OPT_IN,
  TAG_CAVEAT,
  TAG_REFERENCE,
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
  TAG_LANG_TYPESCRIPT,
  TAG_LANG_PYTHON,
  TAG_LANG_GO,
  TAG_LANG_RUST,
  TAG_LANG_JAVA,
  TAG_LANG_RUBY,
  ALL_TAGS,
  WORKFLOW_TAGS,
  CONTEXT_TAGS,
  DOMAIN_TAGS,
  CLI_TOOL_TAGS,
  LANGUAGE_TAGS,
  LANGUAGE_TO_TAG,
  isLanguageTag,
  resolveLanguageTags,
  filterByLanguages,
} from "../../content/tags.js";

describe("tag constants", () => {
  it("TAG_CORE equals 'core'", () => {
    expect(TAG_CORE).toBe("core");
  });

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

  it("TAG_GREENFIELD equals 'greenfield'", () => {
    expect(TAG_GREENFIELD).toBe("greenfield");
  });

  it("TAG_BROWNFIELD equals 'brownfield'", () => {
    expect(TAG_BROWNFIELD).toBe("brownfield");
  });

  it("TAG_SOLO equals 'solo'", () => {
    expect(TAG_SOLO).toBe("solo");
  });

  it("TAG_TEAM equals 'team'", () => {
    expect(TAG_TEAM).toBe("team");
  });

  it("TAG_BOARD equals 'board'", () => {
    expect(TAG_BOARD).toBe("board");
  });

  it("TAG_SECURITY equals 'security'", () => {
    expect(TAG_SECURITY).toBe("security");
  });

  it("TAG_A11Y equals 'a11y'", () => {
    expect(TAG_A11Y).toBe("a11y");
  });

  it("TAG_PERFORMANCE equals 'performance'", () => {
    expect(TAG_PERFORMANCE).toBe("performance");
  });

  it("TAG_CUSTOMIZE equals 'customize'", () => {
    expect(TAG_CUSTOMIZE).toBe("customize");
  });
});

describe("ALL_TAGS", () => {
  // 25 base tags (workflow + context + domain + language) + 17 CLI tool
  // tags (marker + 3 tier classifiers + 13 category tags). Domain tags
  // expanded from 5 to 9 in 1.7.5 with frontend/ui/ux/design-system added
  // alongside the agent-produced UI/UX governance slice.
  it("contains exactly 42 elements", () => {
    expect(ALL_TAGS).toHaveLength(42);
  });

  it("contains every individual tag constant", () => {
    const allIndividualTags = [
      TAG_CORE,
      TAG_PLANNING,
      TAG_IMPLEMENTATION,
      TAG_REVIEW,
      TAG_DEVOPS,
      TAG_MAINTENANCE,
      TAG_GREENFIELD,
      TAG_BROWNFIELD,
      TAG_SOLO,
      TAG_TEAM,
      TAG_BOARD,
      TAG_SECURITY,
      TAG_A11Y,
      TAG_PERFORMANCE,
      TAG_CUSTOMIZE,
      TAG_FRONTEND,
      TAG_UI,
      TAG_UX,
      TAG_DESIGN_SYSTEM,
      TAG_CLI_TOOLS,
      TAG_OPT_IN,
      TAG_CAVEAT,
      TAG_REFERENCE,
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
      TAG_LANG_TYPESCRIPT,
      TAG_LANG_PYTHON,
      TAG_LANG_GO,
      TAG_LANG_RUST,
      TAG_LANG_JAVA,
      TAG_LANG_RUBY,
    ];
    for (const tag of allIndividualTags) {
      expect(ALL_TAGS).toContain(tag);
    }
  });

  it("has no duplicate values", () => {
    const unique = new Set(ALL_TAGS);
    expect(unique.size).toBe(ALL_TAGS.length);
  });
});

describe("CLI_TOOL_TAGS", () => {
  it("has exactly 17 elements", () => {
    expect(CLI_TOOL_TAGS).toHaveLength(17);
  });

  it("contains the marker tag and tier classifiers", () => {
    expect(CLI_TOOL_TAGS).toContain(TAG_CLI_TOOLS);
    expect(CLI_TOOL_TAGS).toContain(TAG_OPT_IN);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAVEAT);
    expect(CLI_TOOL_TAGS).toContain(TAG_REFERENCE);
  });

  it("contains the 13 category tags mirroring CliToolMeta.category", () => {
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_SEARCH);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_JSON);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_YAML);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_GIT);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_VIEW);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_EDIT);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_ARCHIVE);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_DATA);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_FORGE);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_BROWSER);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_CONTAINER);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_AI);
    expect(CLI_TOOL_TAGS).toContain(TAG_CAT_INTERACTIVE);
  });
});

describe("WORKFLOW_TAGS", () => {
  it("has exactly 6 elements", () => {
    expect(WORKFLOW_TAGS).toHaveLength(6);
  });

  it("contains the correct workflow tags", () => {
    expect(WORKFLOW_TAGS).toContain(TAG_CORE);
    expect(WORKFLOW_TAGS).toContain(TAG_PLANNING);
    expect(WORKFLOW_TAGS).toContain(TAG_IMPLEMENTATION);
    expect(WORKFLOW_TAGS).toContain(TAG_REVIEW);
    expect(WORKFLOW_TAGS).toContain(TAG_DEVOPS);
    expect(WORKFLOW_TAGS).toContain(TAG_MAINTENANCE);
  });
});

describe("CONTEXT_TAGS", () => {
  it("has exactly 4 elements", () => {
    expect(CONTEXT_TAGS).toHaveLength(4);
  });

  it("contains the correct context tags", () => {
    expect(CONTEXT_TAGS).toContain(TAG_GREENFIELD);
    expect(CONTEXT_TAGS).toContain(TAG_BROWNFIELD);
    expect(CONTEXT_TAGS).toContain(TAG_SOLO);
    expect(CONTEXT_TAGS).toContain(TAG_TEAM);
  });
});

describe("DOMAIN_TAGS", () => {
  it("has exactly 9 elements", () => {
    expect(DOMAIN_TAGS).toHaveLength(9);
  });

  it("contains the correct domain tags", () => {
    expect(DOMAIN_TAGS).toContain(TAG_BOARD);
    expect(DOMAIN_TAGS).toContain(TAG_SECURITY);
    expect(DOMAIN_TAGS).toContain(TAG_A11Y);
    expect(DOMAIN_TAGS).toContain(TAG_PERFORMANCE);
    expect(DOMAIN_TAGS).toContain(TAG_CUSTOMIZE);
    expect(DOMAIN_TAGS).toContain(TAG_FRONTEND);
    expect(DOMAIN_TAGS).toContain(TAG_UI);
    expect(DOMAIN_TAGS).toContain(TAG_UX);
    expect(DOMAIN_TAGS).toContain(TAG_DESIGN_SYSTEM);
  });
});

describe("LANGUAGE_TAGS", () => {
  it("has exactly 6 elements", () => {
    expect(LANGUAGE_TAGS).toHaveLength(6);
  });

  it("contains the correct language tags", () => {
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_TYPESCRIPT);
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_PYTHON);
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_GO);
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_RUST);
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_JAVA);
    expect(LANGUAGE_TAGS).toContain(TAG_LANG_RUBY);
  });

  it("all language tags start with 'lang:' prefix", () => {
    for (const tag of LANGUAGE_TAGS) {
      expect(tag).toMatch(/^lang:/);
    }
  });
});

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

describe("isLanguageTag", () => {
  it("returns true for language tags", () => {
    expect(isLanguageTag("lang:typescript")).toBe(true);
    expect(isLanguageTag("lang:python")).toBe(true);
    expect(isLanguageTag("lang:go")).toBe(true);
  });

  it("returns false for non-language tags", () => {
    expect(isLanguageTag("core")).toBe(false);
    expect(isLanguageTag("planning")).toBe(false);
    expect(isLanguageTag("security")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLanguageTag("")).toBe(false);
  });
});

describe("tag group completeness", () => {
  it("ALL_TAGS equals the union of WORKFLOW_TAGS, CONTEXT_TAGS, DOMAIN_TAGS, CLI_TOOL_TAGS, and LANGUAGE_TAGS", () => {
    const combined = [
      ...WORKFLOW_TAGS,
      ...CONTEXT_TAGS,
      ...DOMAIN_TAGS,
      ...CLI_TOOL_TAGS,
      ...LANGUAGE_TAGS,
    ];
    expect(ALL_TAGS).toEqual(combined);
  });
});

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

describe("filterByLanguages", () => {
  // Minimal local fixture — independent of CatalogItem to keep this a unit test.
  type Item = { id: string; tags: string[]; protected?: boolean };

  function item(id: string, tags: string[], extras: Partial<Item> = {}): Item {
    return { id, tags, ...extras };
  }

  it("includes items with no lang:* tags (universal/agnostic content)", () => {
    const items: Item[] = [
      item("agnostic-a", ["core"]),
      item("agnostic-b", ["security"]),
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
      item("ts-only", ["core", "lang:typescript"]),
      item("go-only", ["core", "lang:go"]),
      item("agnostic", ["core"]),
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
      item("agnostic", ["core"]),
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
