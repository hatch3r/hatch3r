import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions } from "../../version/compare.js";

describe("parseVersion", () => {
  it("parses a simple version string", () => {
    expect(parseVersion("1.5.0")).toEqual({
      major: 1,
      minor: 5,
      patch: 0,
      pre: "",
    });
  });

  it("parses a version with a pre-release tag", () => {
    expect(parseVersion("2.0.0-alpha")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      pre: "alpha",
    });
  });

  it("strips the v prefix", () => {
    expect(parseVersion("v1.0.0")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      pre: "",
    });
  });

  it("parses a version with a dotted pre-release tag", () => {
    expect(parseVersion("0.1.0-beta.1")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      pre: "beta.1",
    });
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns -1 when the first version has a lower major", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 1 when the first version has a higher major", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
  });

  it("returns 1 when the first version has a higher minor", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
  });

  it("returns 1 when the first version has a higher patch", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });

  it("ranks a release higher than a pre-release at the same version", () => {
    expect(compareVersions("1.0.0", "1.0.0-alpha")).toBe(1);
  });

  it("orders alphanumeric pre-release identifiers in ASCII lexical order (SemVer §11.4.2)", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
  });

  it("compares numeric pre-release identifiers numerically, not lexically (SemVer §11.4.1)", () => {
    // Whole-string lexicographic comparison would invert these (it reads "9" > "1").
    expect(compareVersions("1.0.0-beta.9", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.9")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
  });

  it("ranks a numeric identifier below a non-numeric one at the same position (SemVer §11.4.3)", () => {
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.beta", "1.0.0-alpha.1")).toBe(1);
  });

  it("ranks a larger set of pre-release identifiers higher when the shared prefix is equal (SemVer §11.4.4)", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
  });

  it("treats identical pre-release strings as equal", () => {
    expect(compareVersions("1.0.0-beta.11", "1.0.0-beta.11")).toBe(0);
  });

  it("orders the full SemVer §11.4 canonical precedence chain", () => {
    // https://semver.org/spec/v2.0.0.html §11.4 (accessed 2026-07-12).
    const ascending = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < ascending.length - 1; i++) {
      expect(compareVersions(ascending[i]!, ascending[i + 1]!)).toBe(-1);
      expect(compareVersions(ascending[i + 1]!, ascending[i]!)).toBe(1);
    }
  });
});
