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
  LANGUAGE_TAGS,
  LANGUAGE_TO_TAG,
  isLanguageTag,
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
  it("contains exactly 21 elements", () => {
    expect(ALL_TAGS).toHaveLength(21);
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
  it("has exactly 5 elements", () => {
    expect(DOMAIN_TAGS).toHaveLength(5);
  });

  it("contains the correct domain tags", () => {
    expect(DOMAIN_TAGS).toContain(TAG_BOARD);
    expect(DOMAIN_TAGS).toContain(TAG_SECURITY);
    expect(DOMAIN_TAGS).toContain(TAG_A11Y);
    expect(DOMAIN_TAGS).toContain(TAG_PERFORMANCE);
    expect(DOMAIN_TAGS).toContain(TAG_CUSTOMIZE);
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
  it("ALL_TAGS equals the union of WORKFLOW_TAGS, CONTEXT_TAGS, DOMAIN_TAGS, and LANGUAGE_TAGS", () => {
    const combined = [...WORKFLOW_TAGS, ...CONTEXT_TAGS, ...DOMAIN_TAGS, ...LANGUAGE_TAGS];
    expect(ALL_TAGS).toEqual(combined);
  });
});
