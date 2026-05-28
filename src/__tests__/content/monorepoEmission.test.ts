import { describe, it, expect } from "vitest";
import { planPerPackageOutputs } from "../../content/monorepoEmission.js";
import type { AdapterOutput, PackageEntry } from "../../types.js";

function fakeOutput(path: string, content = "body"): AdapterOutput {
  return { path, content, action: "create" };
}

describe("planPerPackageOutputs", () => {
  it("returns empty when packages list is undefined or empty", () => {
    expect(planPerPackageOutputs(undefined, [fakeOutput("CLAUDE.md")])).toEqual([]);
    expect(planPerPackageOutputs([], [fakeOutput("CLAUDE.md")])).toEqual([]);
  });

  it("returns empty when no root outputs exist", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    expect(planPerPackageOutputs(packages, [])).toEqual([]);
  });

  it("re-targets each output under every package prefix", () => {
    const packages: PackageEntry[] = [
      { name: "@scope/alpha", path: "packages/alpha" },
      { name: "@scope/beta", path: "packages/beta" },
    ];
    const outputs = [
      fakeOutput("CLAUDE.md", "claude body"),
      fakeOutput(".cursor/rules/00-hatch3r.mdc", "cursor body"),
    ];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned).toHaveLength(4);
    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/CLAUDE.md",
      "packages/alpha/.cursor/rules/00-hatch3r.mdc",
      "packages/beta/CLAUDE.md",
      "packages/beta/.cursor/rules/00-hatch3r.mdc",
    ]);
    expect(planned[0].output.content).toBe("claude body");
    expect(planned[0].packageName).toBe("@scope/alpha");
    expect(planned[0].originalPath).toBe("CLAUDE.md");
  });

  it("sorts packages by path for deterministic emission order", () => {
    const packages: PackageEntry[] = [
      { name: "z", path: "packages/zeta" },
      { name: "a", path: "apps/site" },
    ];
    const outputs = [fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "apps/site/CLAUDE.md",
      "packages/zeta/CLAUDE.md",
    ]);
  });

  it("normalises backslash separators in package paths", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages\\alpha" }];
    const outputs = [fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/alpha/CLAUDE.md");
  });

  it("strips trailing slashes on the package prefix", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha/" }];
    const outputs = [fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned[0].output.path).toBe("packages/alpha/CLAUDE.md");
  });

  it("skips an output that is an absolute path", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [fakeOutput("/etc/passwd"), fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/CLAUDE.md",
    ]);
  });

  it("skips an output that traverses with `..`", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [fakeOutput("../escape.md"), fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/CLAUDE.md",
    ]);
  });

  it("skips a package with an unsafe absolute path", () => {
    const packages: PackageEntry[] = [
      { name: "alpha", path: "/etc/passwd" },
      { name: "beta", path: "packages/beta" },
    ];
    const outputs = [fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/beta/CLAUDE.md");
  });

  it("skips a package whose path starts with `..`", () => {
    const packages: PackageEntry[] = [
      { name: "alpha", path: "../escape" },
      { name: "beta", path: "packages/beta" },
    ];
    const outputs = [fakeOutput("CLAUDE.md")];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned).toHaveLength(1);
    expect(planned[0].output.path).toBe("packages/beta/CLAUDE.md");
  });

  it("skips the canonical manifest path so per-package copies cannot diverge", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs = [
      fakeOutput(".hatch3r/hatch.json"),
      fakeOutput("CLAUDE.md"),
    ];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned.map((p) => p.output.path)).toEqual([
      "packages/alpha/CLAUDE.md",
    ]);
  });

  it("propagates managedContent and action fields unchanged", () => {
    const packages: PackageEntry[] = [{ name: "alpha", path: "packages/alpha" }];
    const outputs: AdapterOutput[] = [
      {
        path: "CLAUDE.md",
        content: "wrapper",
        managedContent: "inner",
        action: "update",
      },
    ];

    const planned = planPerPackageOutputs(packages, outputs);

    expect(planned[0].output.managedContent).toBe("inner");
    expect(planned[0].output.action).toBe("update");
  });
});
