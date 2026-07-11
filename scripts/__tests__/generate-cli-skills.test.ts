import { describe, it, expect } from "vitest";

import { buildPlan, renderPerToolFile } from "../generate-cli-skills.js";
import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../../src/cliTools/registry.js";

/**
 * Regression guards for `scripts/generate-cli-skills.ts`.
 *
 * D1-SA1.7-02: the five hand-authored standalone CLI skills (ripgrep, jq, gh,
 * fd, fzf) keep the `<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->` marker after
 * Wave-4 hand-finishing, so a plain `npm run generate:cli-skills` classified
 * them as replaceable `update`s and would silently revert their authored
 * Recipes / Wrong-Choice / Alternatives to scaffold placeholders. The
 * content-state guard in `classify()` must refuse any regeneration whose new
 * body would introduce a scaffold placeholder into a file that no longer
 * carries one. These tests dry-run the planner against the real repo and
 * assert zero destructive `update` actions.
 *
 * D5-SA5.6-05: the generator must strip the renderer's host-OS highlight
 * ("Install (macOS — default for this machine):") so the canonical checked-in
 * skills assert no build-host identity.
 */
describe("generate-cli-skills — content-state guard (D1-SA1.7-02)", () => {
  it("plans zero `update` actions against the checked-in authored skills", async () => {
    const plan = await buildPlan(false);
    // STANDALONE_TOOLS = { ripgrep, jq, gh, fd, fzf }.
    expect(plan.length).toBe(5);
    const updates = plan.filter((e) => e.action === "update");
    expect(
      updates,
      `regeneration would clobber authored skills: ${updates.map((e) => e.path).join(", ")}`,
    ).toEqual([]);
  });

  it("refuses every authored standalone skill via the content-state guard", async () => {
    const plan = await buildPlan(false);
    const refused = plan.filter((e) => e.action === "refuse");
    expect(refused.length).toBe(5);
    for (const entry of refused) {
      expect(entry.reason).toContain("content-state guard");
    }
  });
});

describe("generate-cli-skills — host-neutral canonical output (D5-SA5.6-05)", () => {
  it("strips the host-OS highlight and keeps every per-OS install block", () => {
    // fd carries mac + linux + win install commands, so all three blocks render.
    const fd = AVAILABLE_CLI_TOOLS.fd as CliToolMeta;
    const file = renderPerToolFile(fd, "mac");
    expect(file).not.toContain("default for this machine");
    expect(file).toContain("Install (macOS):");
    expect(file).toContain("Install (Linux):");
    expect(file).toContain("Install (Windows):");
  });

  it("is host-independent: output does not vary with the generation host OS", () => {
    const fd = AVAILABLE_CLI_TOOLS.fd as CliToolMeta;
    expect(renderPerToolFile(fd, "linux")).toBe(renderPerToolFile(fd, "mac"));
    expect(renderPerToolFile(fd, "win")).toBe(renderPerToolFile(fd, "mac"));
  });
});
