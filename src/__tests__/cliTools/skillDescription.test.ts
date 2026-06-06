import { describe, it, expect } from "vitest";
import {
  buildSkillDescription,
  TOOL_TRIGGERS,
  TOOL_CLOSERS,
  CATEGORY_CLOSERS,
} from "../../cliTools/skillDescription.js";
import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../../cliTools/registry.js";

/**
 * D3-M11 (Cycle 10 Wave-3 Medium rollover): `src/cliTools/skillDescription.ts`
 * previously had 0% coverage despite being shipped in the npm package and
 * imported by two maintainer scripts (`scripts/generate-cli-skills.ts`,
 * `scripts/fix-cli-skill-frontmatter.ts`). The module's lookups drive the
 * cosine-similarity validator at runtime; an unintended mutation could push a
 * pair of CLI-tool skills above the 0.55 threshold and break validate without
 * any test surfacing the cause.
 *
 * The finding called for a unit test of `buildSkillDescription`. These tests
 * pin (1) the deterministic per-tool path, (2) the per-category fallback,
 * (3) the generic fallback, and (4) the 60-char minimum invariant that
 * `validateDescriptionLength` enforces downstream.
 */

const ripgrep = AVAILABLE_CLI_TOOLS.ripgrep as CliToolMeta;
const jq = AVAILABLE_CLI_TOOLS.jq as CliToolMeta;
const docker = AVAILABLE_CLI_TOOLS.docker as CliToolMeta;

describe("buildSkillDescription", () => {
  it("uses the per-tool TOOL_TRIGGERS entry when present", () => {
    const desc = buildSkillDescription(ripgrep);
    // ripgrep has a curated trigger sentence in TOOL_TRIGGERS.
    expect(desc).toContain(TOOL_TRIGGERS.ripgrep);
    // The probe is referenced verbatim with backticks.
    expect(desc).toContain("`rg`");
  });

  it("falls back to the category-default closer when no per-tool closer exists", () => {
    // jq has a TOOL_TRIGGERS entry but no TOOL_CLOSERS entry — so the
    // category-default ("json") fires.
    expect(TOOL_CLOSERS.jq).toBeUndefined();
    const desc = buildSkillDescription(jq);
    expect(desc).toContain(CATEGORY_CLOSERS.json);
  });

  it("uses the per-tool TOOL_CLOSERS entry when present, ignoring the category default", () => {
    // docker is in `container` category but also has a tool-specific closer.
    expect(TOOL_CLOSERS.docker).toBeDefined();
    const desc = buildSkillDescription(docker);
    expect(desc).toContain(TOOL_CLOSERS.docker);
    // The category fallback must NOT also appear.
    expect(desc).not.toContain(CATEGORY_CLOSERS.container);
  });

  it("falls back to the generic closer when neither tool nor category match", () => {
    const synthetic: CliToolMeta = {
      id: "synthetic-tool" as CliToolMeta["id"],
      probe: "synth",
      description: "Synthetic description",
      // Use a category string outside CATEGORY_CLOSERS to force the generic fallback.
      category: "unmapped-category" as CliToolMeta["category"],
      tier: 3,
      install: { mac: [], linux: [], win: [] },
      homepage: "https://example.com",
      sourceRepo: "https://github.com/example/synthetic-tool",
      license: "MIT",
    };
    const desc = buildSkillDescription(synthetic);
    // Generic closer is the documented final fallback in skillDescription.ts.
    expect(desc).toContain("Use over an MCP equivalent to cut output tokens.");
  });

  it("falls back to `${category} tasks` when the tool has no TOOL_TRIGGERS entry", () => {
    const synthetic: CliToolMeta = {
      id: "another-synthetic" as CliToolMeta["id"],
      probe: "ax",
      description: "Another synthetic description",
      category: "search" as CliToolMeta["category"],
      tier: 3,
      install: { mac: [], linux: [], win: [] },
      homepage: "https://example.com",
      sourceRepo: "https://github.com/example/another-synthetic",
      license: "MIT",
    };
    expect(TOOL_TRIGGERS["another-synthetic"]).toBeUndefined();
    const desc = buildSkillDescription(synthetic);
    expect(desc).toContain("Use when search tasks");
  });

  it("emits descriptions over the 60-char minimum for every catalog entry", () => {
    // 60-char minimum from validateDescriptionLength in src/cli/commands/validate.ts.
    for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as readonly CliToolMeta[]) {
      const desc = buildSkillDescription(meta);
      expect(desc.length).toBeGreaterThanOrEqual(60);
    }
  });
});
