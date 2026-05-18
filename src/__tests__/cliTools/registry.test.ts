import { describe, it, expect } from "vitest";
import {
  AVAILABLE_CLI_TOOLS,
  TIER1_CLI_TOOLS,
  TIER2_CLI_TOOLS_BY_TRIGGER,
  TIER3_CLI_TOOLS,
  DEFAULT_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  type CliToolMeta,
} from "../../cliTools/registry.js";

/**
 * Wave 5 Item 28: registry contract tests for `src/cliTools/registry.ts`.
 *
 * Verifies the catalog satisfies the plan §3 contract: 10/11/8 tier counts,
 * stable tier-1 ordering, full per-entry shape, RTK caveat presence, secret
 * notes auto-generation. A drift in any of these surfaces here before it
 * reaches `pickCliTools` / `detect.ts` / `install.ts` callers.
 */

describe("AVAILABLE_CLI_TOOLS registry", () => {
  const allEntries = Object.values(AVAILABLE_CLI_TOOLS) as readonly CliToolMeta[];

  it("contains the expected tier counts (10/11/8)", () => {
    const tier1 = allEntries.filter((t) => t.tier === 1);
    const tier2 = allEntries.filter((t) => t.tier === 2);
    const tier3 = allEntries.filter((t) => t.tier === 3);

    // Plan §3: 10 tier-1 default-on, 11 tier-2 conditional, 8 tier-3 opt-in.
    expect(tier1.length).toBe(10);
    expect(tier2.length).toBe(11);
    expect(tier3.length).toBe(8);
    // Total catalog size 29 — surfaces accidental tool additions without
    // tier classification updates.
    expect(allEntries.length).toBe(29);
  });

  it("snapshot of AVAILABLE_CLI_TOOLS keys (drift gate)", () => {
    // Snapshot the registry key set so adding/removing a tool triggers an
    // explicit test update — keeps the catalogue and the picker / install
    // plan / detection batches in lockstep.
    const keys = Object.keys(AVAILABLE_CLI_TOOLS).sort();
    expect(keys).toMatchInlineSnapshot(`
      [
        "aichat",
        "ast-grep",
        "az-devops",
        "bat",
        "comby",
        "csvkit",
        "delta",
        "difftastic",
        "docker",
        "duckdb",
        "fd",
        "fzf",
        "gh",
        "glab",
        "jq",
        "lazygit",
        "llm",
        "miller",
        "mods",
        "playwright",
        "podman",
        "ripgrep",
        "rtk",
        "sd",
        "stagehand",
        "taplo",
        "xsv",
        "yq",
        "zstd",
      ]
    ` );
  });

  it("every entry has id/probe/description/category/tier/install/homepage", () => {
    for (const entry of allEntries) {
      expect(entry.id).toBeTypeOf("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.probe).toBeTypeOf("string");
      expect(entry.probe.length).toBeGreaterThan(0);
      expect(entry.description).toBeTypeOf("string");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.category).toBeTypeOf("string");
      expect([1, 2, 3]).toContain(entry.tier);
      expect(entry.install).toBeDefined();
      // Every entry must list per-OS install commands for all three platforms.
      expect(entry.install.mac).toBeDefined();
      expect(entry.install.linux).toBeDefined();
      expect(entry.install.win).toBeDefined();
      expect(Array.isArray(entry.install.mac)).toBe(true);
      expect(entry.install.mac.length).toBeGreaterThan(0);
      expect(entry.homepage).toBeTypeOf("string");
      expect(entry.homepage.startsWith("http")).toBe(true);
    }
  });

  it("registry key matches entry.id for every tool", () => {
    for (const [key, entry] of Object.entries(AVAILABLE_CLI_TOOLS)) {
      expect((entry as CliToolMeta).id).toBe(key);
    }
  });

  it("RTK has caveat: 'pipe-output-corruption'", () => {
    const rtk = AVAILABLE_CLI_TOOLS.rtk;
    expect(rtk).toBeDefined();
    expect(rtk.caveat).toBe("pipe-output-corruption");
    expect(rtk.tier).toBe(3);
  });

  it("no tier-1 or tier-2 tool carries a caveat", () => {
    // Only tier-3 tools may ship caveats — surfacing a tier-1 caveat would
    // contradict the picker's default-checked-by-default semantics for tier-1.
    for (const entry of allEntries) {
      if (entry.tier !== 3) {
        expect(entry.caveat, `${entry.id} (tier ${entry.tier}) must not carry a caveat`).toBeUndefined();
      }
    }
  });
});

describe("TIER1_CLI_TOOLS", () => {
  it("has exactly 10 entries", () => {
    expect(TIER1_CLI_TOOLS.length).toBe(10);
  });

  it("has stable ordering (snapshot)", () => {
    // Plan §3 tier-1 tool list — order drives picker display order, so a
    // re-ordering needs explicit acknowledgement.
    expect([...TIER1_CLI_TOOLS]).toEqual([
      "ripgrep",
      "fd",
      "jq",
      "yq",
      "gh",
      "delta",
      "bat",
      "sd",
      "ast-grep",
      "zstd",
    ]);
  });

  it("every TIER1 id resolves to a tier-1 entry in AVAILABLE_CLI_TOOLS", () => {
    for (const id of TIER1_CLI_TOOLS) {
      const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
      expect(meta, `TIER1 entry "${id}" missing from registry`).toBeDefined();
      expect(meta!.tier).toBe(1);
    }
  });

  it("DEFAULT_CLI_TOOLS equals TIER1_CLI_TOOLS", () => {
    // Plan §4.3: --yes path defaults to tier-1 + triggered tier-2; the base
    // default before trigger evaluation is exactly TIER1.
    expect(DEFAULT_CLI_TOOLS).toBe(TIER1_CLI_TOOLS);
  });
});

describe("TIER2_CLI_TOOLS_BY_TRIGGER", () => {
  it("covers all 9 documented triggers", () => {
    const triggers = Object.keys(TIER2_CLI_TOOLS_BY_TRIGGER).sort();
    expect(triggers).toEqual([
      "azure-remote",
      "ci-llm-project",
      "data-project",
      "docker-detected",
      "gitlab-remote",
      "interactive-tty",
      "python-project",
      "rust-project",
      "web-project",
    ]);
  });

  it("every triggered id resolves to a tier-2 entry", () => {
    for (const [trigger, ids] of Object.entries(TIER2_CLI_TOOLS_BY_TRIGGER)) {
      for (const id of ids) {
        const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
        expect(meta, `Trigger "${trigger}" references missing tool "${id}"`).toBeDefined();
        expect(meta!.tier).toBe(2);
      }
    }
  });
});

describe("TIER3_CLI_TOOLS", () => {
  it("has exactly 8 entries", () => {
    expect(TIER3_CLI_TOOLS.length).toBe(8);
  });

  it("every TIER3 id resolves to a tier-3 entry", () => {
    for (const id of TIER3_CLI_TOOLS) {
      const meta = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[id];
      expect(meta, `TIER3 entry "${id}" missing from registry`).toBeDefined();
      expect(meta!.tier).toBe(3);
    }
  });
});

describe("CLI_TOOL_SECRET_NOTES", () => {
  it("is auto-derived from registry entries with requiresEnv", () => {
    // Plan §4.3 step 5: CLI_TOOL_SECRET_NOTES mirrors TOOL_SECRET_NOTES for
    // MCP servers. The map is auto-generated from registry.requiresEnv so
    // adding a tool with new env vars does not require a separate edit.
    for (const entry of Object.values(AVAILABLE_CLI_TOOLS) as readonly CliToolMeta[]) {
      const env = entry.requiresEnv;
      if (env && env.length > 0) {
        expect(CLI_TOOL_SECRET_NOTES[entry.id]).toEqual(env);
      } else {
        expect(CLI_TOOL_SECRET_NOTES[entry.id]).toBeUndefined();
      }
    }
  });

  it("contains gh GH_TOKEN advisory", () => {
    expect(CLI_TOOL_SECRET_NOTES.gh).toEqual(["GH_TOKEN"]);
  });

  it("contains glab GITLAB_TOKEN advisory", () => {
    expect(CLI_TOOL_SECRET_NOTES.glab).toEqual(["GITLAB_TOKEN"]);
  });
});
