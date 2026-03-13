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
  ALL_TAGS,
  WORKFLOW_TAGS,
  CONTEXT_TAGS,
  DOMAIN_TAGS,
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
  it("contains exactly 15 elements", () => {
    expect(ALL_TAGS).toHaveLength(15);
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

describe("tag group completeness", () => {
  it("ALL_TAGS equals the union of WORKFLOW_TAGS, CONTEXT_TAGS, and DOMAIN_TAGS", () => {
    const combined = [...WORKFLOW_TAGS, ...CONTEXT_TAGS, ...DOMAIN_TAGS];
    expect(ALL_TAGS).toEqual(combined);
  });
});
