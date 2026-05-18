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
        "qsv",
        "ripgrep",
        "rtk",
        "sd",
        "stagehand",
        "taplo",
        "yq",
        "zstd",
      ]
    ` );
  });

  it("registry replaces archived xsv with active qsv fork (D21-SA21.3-F01)", () => {
    // BurntSushi/xsv was archived 2025-04-24; jqnatividad/qsv is the active
    // successor with a superset of xsv's command set. The registry must not
    // ship the archived id.
    const keys = Object.keys(AVAILABLE_CLI_TOOLS);
    expect(keys).toContain("qsv");
    expect(keys).not.toContain("xsv");

    const qsv = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).qsv;
    expect(qsv).toBeDefined();
    expect(qsv!.id).toBe("qsv");
    expect(qsv!.tier).toBe(2);
    expect(qsv!.trigger).toBe("data-project");
    expect(qsv!.homepage).toContain("jqnatividad/qsv");
  });

  it("jq entry carries a securityNote citing CVE-2026-32316 (D21-SA21.3-F02)", () => {
    // jq 1.8.1 ships with CVE-2026-32316 (heap buffer overflow) plus six
    // additional CVEs disclosed 2026-04-15 with no tagged release yet. The
    // registry surfaces this via securityNote so the picker/installer/skill
    // generator can warn downstream consumers.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.securityNote).toBeDefined();
    expect(jq.securityNote).toContain("CVE-2026-32316");
  });

  it("jq securityNote enumerates the additional 2026-04-15 CVE IDs (D21-SA21.3-F03)", () => {
    // C9-H87: Cycle 9 D21-SA21.3-F03 — extend the jq securityNote to
    // enumerate the three confirmed additional CVE IDs from the 2026-04-15
    // oss-sec batch. Three further IDs from that batch were not assigned
    // canonical names in audit sources and remain referenced by batch URL.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.securityNote).toContain("CVE-2026-40612");
    expect(jq.securityNote).toContain("CVE-2026-43894");
    expect(jq.securityNote).toContain("CVE-2026-43896");
    // The oss-sec batch URL anchors the unenumerated remainder so consumers
    // can pivot to the canonical disclosure list.
    expect(jq.securityNote).toContain("seclists.org/oss-sec");
  });

  it("sd entry is annotated releaseCadence:'stable' (D21-SA21.2-F01)", () => {
    // C9-H86: sd 1.1.0 (released 2025-02-24) is 447 days old at the
    // 2026-05-18 audit. Tagging the entry `stable` documents that the long
    // gap is intentional (mature steady-state tool) — the staleness
    // heuristic in src/cliTools/triggers.ts can suppress amber-flag noise.
    const sd = AVAILABLE_CLI_TOOLS.sd;
    expect(sd.releaseCadence).toBe("stable");
  });

  it("gh entry carries minVersion + securityNote citing GHSA-crc3-h8v6-qh57 (D21-SA21.5-F01)", () => {
    // C9-H88: gh CLI before 2.92.0 (released 2026-05-06) leaks tokens via
    // auxiliary host extension calls per GHSA-crc3-h8v6-qh57. Surface
    // minVersion + securityNote so the installer/picker flag old builds.
    const gh = AVAILABLE_CLI_TOOLS.gh;
    expect(gh.minVersion).toBe(">=2.92.0");
    expect(gh.securityNote).toBeDefined();
    expect(gh.securityNote).toContain("GHSA-crc3-h8v6-qh57");
    expect(gh.securityNote).toContain("2.92.0");
  });

  it("docker entry carries minVersion + securityNote citing CVE-2026-32288 (D21-SA21.6-F02)", () => {
    // C9-H91: Docker engine 29.5.0 patches CVE-2026-32288 (DoS via crafted
    // image manifest). minVersion surfaces the requirement before pulling
    // images from untrusted registries.
    const docker = AVAILABLE_CLI_TOOLS.docker;
    expect(docker.minVersion).toBe("29.5.0");
    expect(docker.securityNote).toBeDefined();
    expect(docker.securityNote).toContain("CVE-2026-32288");
  });

  it("podman entry carries minVersion + Windows-only securityNote citing CVE-2026-33414 (D21-SA21.6-F03)", () => {
    // C9-H92: Podman 5.8.2 patches CVE-2026-33414 — Windows-only PowerShell
    // command injection on the Hyper-V backend via `podman machine init`.
    // The securityNote carries an explicit `Windows only` prefix so mac /
    // linux consumers see the platform scope inline.
    const podman = AVAILABLE_CLI_TOOLS.podman;
    expect(podman.minVersion).toBe("5.8.2");
    expect(podman.securityNote).toBeDefined();
    expect(podman.securityNote).toContain("CVE-2026-33414");
    expect(podman.securityNote).toContain("Windows only");
  });

  it("optional schema fields are correctly typed on every entry (D15-SA15.7-F01 / D21-SA21.7-F02)", () => {
    // C9-H55 + C9-H89: minVersion / releaseCadence / cve_scan are optional
    // schema extensions. Verify that each entry that declares them uses the
    // documented shape — strings for minVersion, the literal union for
    // releaseCadence, and { last_checked, advisory_count, report_url } for
    // cve_scan. Entries that omit the fields are not iterated.
    const validCadences = new Set(["rapid", "monthly", "quarterly", "stable"]);
    for (const entry of allEntries) {
      if (entry.minVersion !== undefined) {
        expect(entry.minVersion).toBeTypeOf("string");
        expect(entry.minVersion.length).toBeGreaterThan(0);
      }
      if (entry.releaseCadence !== undefined) {
        expect(validCadences.has(entry.releaseCadence)).toBe(true);
      }
      if (entry.cve_scan !== undefined) {
        expect(entry.cve_scan.last_checked).toBeTypeOf("string");
        expect(entry.cve_scan.advisory_count).toBeTypeOf("number");
        expect(entry.cve_scan.report_url).toBeTypeOf("string");
      }
    }
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
