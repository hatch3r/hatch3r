import { describe, it, expect } from "vitest";
import { planPerPackageOutputs, emitsPerPackage } from "../../content/monorepoEmission.js";
import type { AdapterOutput, PackageEntry } from "../../types.js";

function fakeOutput(path: string, content = "body"): AdapterOutput {
  return { path, content, action: "create" };
}

describe("emitsPerPackage (D14-6)", () => {
  it("returns true only for cursor (per-directory load model)", () => {
    expect(emitsPerPackage("cursor")).toBe(true);
  });

  it("returns false for claude (ancestor-loads root CLAUDE.md -> double-load)", () => {
    expect(emitsPerPackage("claude")).toBe(false);
  });

  it("returns false for copilot (root-only .github/copilot-instructions.md)", () => {
    expect(emitsPerPackage("copilot")).toBe(false);
  });
});

describe("planPerPackageOutputs", () => {
  it("returns empty when packages list is undefined or empty", () => {
    expect(planPerPackageOutputs("cursor", undefined, [fakeOutput(".cursor/rules/00-hatch3r.mdc")])).toEqual([]);
    expect(planPerPackageOutputs("cursor", [], [fakeOutput(".cursor/rules/00-hatch3r.mdc")])).toEqual([]);
  });

  it("returns empty when no root outputs exist", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    expect(planPerPackageOutputs("cursor", packages, [])).toEqual([]);
  });

  it("D14-6: returns empty for claude even with packages and outputs", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    expect(planPerPackageOutputs("claude", packages, [fakeOutput("CLAUDE.md")])).toEqual([]);
  });

  it("D14-6: returns empty for copilot even with packages and outputs", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    expect(
      planPerPackageOutputs("copilot", packages, [fakeOutput(".github/copilot-instructions.md")]),
    ).toEqual([]);
  });

  it("re-targets each output under every package prefix for cursor", () => {
    const packages: PackageEntry[] = [
      { name: "@scope/alpha", path: "packages/alpha" },
      { name: "@scope/beta", path: "packages/beta" },
    ];
    const outputs = [
      fakeOutput(".cursor/rules/00-hatch3r.mdc", "rule body"),
      fakeOutput(".cursor/rules/10-security.mdc", "security body"),
    ];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned).toHaveLength(4);
    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/.cursor/rules/00-hatch3r.mdc",
      "packages/alpha/.cursor/rules/10-security.mdc",
      "packages/beta/.cursor/rules/00-hatch3r.mdc",
      "packages/beta/.cursor/rules/10-security.mdc",
    ]);
    expect(planned[0].output.content).toBe("rule body");
    expect(planned[0].packageName).toBe("@scope/alpha");
    expect(planned[0].originalPath).toBe(".cursor/rules/00-hatch3r.mdc");
  });

  it("sorts packages by path for deterministic emission order", () => {
    const packages: PackageEntry[] = [
      { name: "z", path: "packages/zeta" },
      { name: "a", path: "apps/site" },
    ];
    const outputs = [fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "apps/site/.cursor/rules/00-hatch3r.mdc",
      "packages/zeta/.cursor/rules/00-hatch3r.mdc",
    ]);
  });

  it("normalises backslash separators in package paths", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages\\alpha" }];
    const outputs = [fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/alpha/.cursor/rules/00-hatch3r.mdc");
  });

  it("strips trailing slashes on the package prefix", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha/" }];
    const outputs = [fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned[0].output.path).toBe("packages/alpha/.cursor/rules/00-hatch3r.mdc");
  });

  it("skips an output that is an absolute path", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [fakeOutput("/etc/passwd"), fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/.cursor/rules/00-hatch3r.mdc",
    ]);
  });

  it("skips an output that traverses with `..`", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [fakeOutput("../escape.md"), fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/.cursor/rules/00-hatch3r.mdc",
    ]);
  });

  it("skips a package with an unsafe absolute path", () => {
    const packages: PackageEntry[] = [
      { name: "alpha", path: "/etc/passwd" },
      { name: "beta", path: "packages/beta" },
    ];
    const outputs = [fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/beta/.cursor/rules/00-hatch3r.mdc");
  });

  it("skips a package whose path starts with `..`", () => {
    const packages: PackageEntry[] = [
      { name: "alpha", path: "../escape" },
      { name: "beta", path: "packages/beta" },
    ];
    const outputs = [fakeOutput(".cursor/rules/00-hatch3r.mdc")];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/beta/.cursor/rules/00-hatch3r.mdc");
  });

  it("skips the canonical manifest path so per-package copies cannot diverge", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [
      fakeOutput(".hatch3r/hatch.json"),
      fakeOutput(".cursor/rules/00-hatch3r.mdc"),
    ];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/.cursor/rules/00-hatch3r.mdc",
    ]);
  });

  it("propagates managedContent and action fields unchanged", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs: AdapterOutput[] = [
      {
        path: ".cursor/rules/00-hatch3r.mdc",
        content: "wrapper",
        managedContent: "inner",
        action: "update",
      },
    ];

    const planned = planPerPackageOutputs("cursor", packages, outputs);

    expect(planned[0].output.managedContent).toBe("inner");
    expect(planned[0].output.action).toBe("update");
  });
});
