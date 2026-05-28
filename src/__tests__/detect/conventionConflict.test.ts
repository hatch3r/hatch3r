import { describe, it, expect } from "vitest";
import {
  detectConventionConflicts,
  formatConventionConflicts,
  type ConventionConflict,
} from "../../detect/conventionConflict.js";

/** Minimal RepoInfo-shaped input for the detector. */
function info(over: {
  linters?: string[];
  testFrameworks?: string[];
  ciProviders?: string[];
}): { linters?: string[]; testFrameworks?: string[]; ciProviders?: string[] } {
  return over;
}

describe("detectConventionConflicts", () => {
  it("returns no conflicts for a single-toolchain repo", () => {
    const conflicts = detectConventionConflicts(
      info({ linters: ["eslint"], testFrameworks: ["vitest"], ciProviders: ["github-actions"] }),
    );
    expect(conflicts).toEqual([]);
  });

  it("returns no conflicts for empty/absent lists", () => {
    expect(detectConventionConflicts(info({}))).toEqual([]);
    expect(
      detectConventionConflicts(info({ linters: [], testFrameworks: [], ciProviders: [] })),
    ).toEqual([]);
  });

  it("flags two competing JS unit test runners", () => {
    const conflicts = detectConventionConflicts(
      info({ testFrameworks: ["vitest", "jest"] }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.dimension).toBe("testFramework");
    expect(conflicts[0]!.tools).toEqual(["jest", "vitest"]);
    expect(conflicts[0]!.message).toContain("test frameworks");
  });

  it("does NOT flag a unit runner plus an e2e runner (complementary)", () => {
    const conflicts = detectConventionConflicts(
      info({ testFrameworks: ["vitest", "playwright"] }),
    );
    expect(conflicts).toEqual([]);
  });

  it("does NOT flag runners for different languages (complementary)", () => {
    const conflicts = detectConventionConflicts(
      info({ testFrameworks: ["pytest", "go-test", "cargo-test"] }),
    );
    expect(conflicts).toEqual([]);
  });

  it("flags two e2e runners as a conflict", () => {
    const conflicts = detectConventionConflicts(
      info({ testFrameworks: ["playwright", "cypress"] }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.tools).toEqual(["cypress", "playwright"]);
  });

  it("flags two competing linters", () => {
    const conflicts = detectConventionConflicts(info({ linters: ["eslint", "biome"] }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.dimension).toBe("linter");
    expect(conflicts[0]!.tools).toEqual(["biome", "eslint"]);
  });

  it("does NOT flag eslint + prettier (lint vs format are different dimensions)", () => {
    const conflicts = detectConventionConflicts(info({ linters: ["eslint", "prettier"] }));
    expect(conflicts).toEqual([]);
  });

  it("flags two formatters as a formatter conflict", () => {
    const conflicts = detectConventionConflicts(info({ linters: ["prettier", "black"] }));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.dimension).toBe("formatter");
    expect(conflicts[0]!.tools).toEqual(["black", "prettier"]);
  });

  it("does NOT flag a python linter plus a python formatter", () => {
    const conflicts = detectConventionConflicts(info({ linters: ["ruff", "black"] }));
    expect(conflicts).toEqual([]);
  });

  it("flags two CI providers", () => {
    const conflicts = detectConventionConflicts(
      info({ ciProviders: ["github-actions", "gitlab-ci"] }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.dimension).toBe("ciProvider");
    expect(conflicts[0]!.tools).toEqual(["github-actions", "gitlab-ci"]);
  });

  it("surfaces multiple conflicts across dimensions, sorted deterministically", () => {
    const conflicts = detectConventionConflicts(
      info({
        linters: ["eslint", "biome"],
        testFrameworks: ["vitest", "jest"],
        ciProviders: ["github-actions", "circleci"],
      }),
    );
    expect(conflicts.map((c) => c.dimension)).toEqual([
      "ciProvider",
      "linter",
      "testFramework",
    ]);
  });

  it("treats unknown test frameworks as non-conflicting (own bucket each)", () => {
    const conflicts = detectConventionConflicts(
      info({ testFrameworks: ["customrunner-a", "customrunner-b"] }),
    );
    expect(conflicts).toEqual([]);
  });

  it("deduplicates a repeated tool (a single tool listed twice is no conflict)", () => {
    const conflicts = detectConventionConflicts(info({ linters: ["eslint", "eslint"] }));
    expect(conflicts).toEqual([]);
  });

  it("ignores blank tool entries", () => {
    const conflicts = detectConventionConflicts(
      info({ linters: ["eslint", "  ", ""], testFrameworks: ["", "vitest"] }),
    );
    expect(conflicts).toEqual([]);
  });
});

describe("formatConventionConflicts", () => {
  it("returns an empty string for no conflicts", () => {
    expect(formatConventionConflicts([])).toBe("");
  });

  it("renders a multi-line block with one line per conflict", () => {
    const conflicts: ConventionConflict[] = [
      { dimension: "testFramework", tools: ["jest", "vitest"], message: "msg A" },
      { dimension: "linter", tools: ["biome", "eslint"], message: "msg B" },
    ];
    const out = formatConventionConflicts(conflicts);
    expect(out.split("\n")).toEqual([
      "Convention conflicts detected:",
      "  - msg A",
      "  - msg B",
    ]);
  });
});
