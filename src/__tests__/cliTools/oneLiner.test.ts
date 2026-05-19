import { describe, it, expect } from "vitest";
import { buildInstallPlan } from "../../cliTools/install.js";
import { buildOneLiner } from "../../cliTools/oneLiner.js";

describe("buildOneLiner", () => {
  it("returns empty string for an empty plan", () => {
    expect(buildOneLiner([])).toBe("");
  });

  it("single brew pkg renders without continuation", () => {
    const plan = buildInstallPlan(["fd"], "mac");
    expect(buildOneLiner(plan)).toBe("brew install fd");
  });

  it("user's 11-tool macOS case groups brew + standalone playwright", () => {
    const plan = buildInstallPlan(
      ["fd", "yq", "delta", "bat", "sd", "ast-grep", "playwright", "fzf", "lazygit", "difftastic", "rtk"],
      "mac",
    );
    const expected =
      "brew install fd yq git-delta bat sd ast-grep fzf lazygit difftastic rtk-ai/tap/rtk \\\n  && npm install -D @playwright/test && npx playwright install";
    expect(buildOneLiner(plan)).toBe(expected);
  });

  it("linux ripgrep + sd groups apt + cargo (two prefix groups)", () => {
    const plan = buildInstallPlan(["ripgrep", "sd"], "linux");
    const expected =
      "sudo apt install ripgrep \\\n  && cargo install sd";
    expect(buildOneLiner(plan)).toBe(expected);
  });

  it("linux qsv install (with flags) stays standalone — multi-token package args are not groupable", () => {
    // qsv ships with `cargo install qsv --locked --features all_features`
    // (the `--features all_features` flag is required to land the full
    // 80+ command set). The grouping regex rejects multi-token tails, so
    // qsv lands as a standalone chunk after any groupable cargo bucket.
    const plan = buildInstallPlan(["sd", "qsv"], "linux");
    const result = buildOneLiner(plan);
    expect(result).toContain("cargo install sd");
    expect(result).toContain("cargo install qsv --locked --features all_features");
  });

  it("windows ripgrep + gh: scoop grouped, winget kept standalone", () => {
    const plan = buildInstallPlan(["ripgrep", "gh"], "win");
    const expected = "scoop install ripgrep \\\n  && winget install GitHub.cli";
    expect(buildOneLiner(plan)).toBe(expected);
  });

  it("first-appearance ordering: groups consolidated, standalones appear after groups", () => {
    const plan = buildInstallPlan(["fd", "playwright", "yq"], "mac");
    const expected =
      "brew install fd yq \\\n  && npm install -D @playwright/test && npx playwright install";
    expect(buildOneLiner(plan)).toBe(expected);
  });

  it("commands containing && are forced standalone even if manager would group", () => {
    const plan = buildInstallPlan(["playwright"], "mac");
    expect(buildOneLiner(plan)).toBe("npm install -D @playwright/test && npx playwright install");
  });

  it("registry gap (no command) falls back to manual-install comment", () => {
    const result = buildOneLiner([
      {
        id: "fd",
        probe: "fd",
        manager: undefined,
        command: undefined,
        homepage: "https://example.test/fd",
      },
    ]);
    expect(result).toBe("# install fd manually: see https://example.test/fd");
  });
});
