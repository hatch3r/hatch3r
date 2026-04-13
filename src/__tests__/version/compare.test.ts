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

  it("compares pre-release tags lexicographically", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
});
