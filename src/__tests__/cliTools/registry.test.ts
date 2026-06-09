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

  it("contains the expected tier counts (11/13/10)", () => {
    const tier1 = allEntries.filter((t) => t.tier === 1);
    const tier2 = allEntries.filter((t) => t.tier === 2);
    const tier3 = allEntries.filter((t) => t.tier === 3);

    // Cycle 10 D21-SA21.7-F-21.7.1: tier counts updated when the HTTP
    // category (curl/httpie/xh), dasel, and container-use landed —
    // 11 tier-1 default-on, 13 tier-2 conditional, 10 tier-3 opt-in.
    expect(tier1.length).toBe(11);
    expect(tier2.length).toBe(13);
    expect(tier3.length).toBe(10);
    // Total catalog size 34 — surfaces accidental tool additions without
    // tier classification updates.
    expect(allEntries.length).toBe(34);
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
        "container-use",
        "csvkit",
        "curl",
        "dasel",
        "delta",
        "difftastic",
        "docker",
        "duckdb",
        "fd",
        "fzf",
        "gh",
        "glab",
        "httpie",
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
        "xh",
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

  it("jq entry carries a minVersion floor at 1.8.1 (D21-SA21.3-F-21.3.1, Cycle 10)", () => {
    // Cycle 10 D21-SA21.3-F-21.3.1 (F-21.7.1 work-unit jq pin refresh):
    // 1.8.1 (2025-07-01) remains the only tagged release at audit time;
    // pinning the floor forces older 1.7.x installs (still on Ubuntu 22.04
    // LTS apt) to upgrade past the 2024 CVE-2023-49355 / CVE-2024-53427
    // cluster before exposure to the 2026 advisory pressure.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.minVersion).toBe(">=1.8.1");
  });

  it("jq securityNote points at the upstream advisories page as canonical roster (D21-SA21.3-F-21.3.2, Cycle 10)", () => {
    // Cycle 10 D21-SA21.3-F-21.3.2 (F-21.7.1 work-unit jq pin refresh):
    // the upstream tab is the canonical CVE roster (10+ GHSA entries at
    // audit time, growing). Enumerating specific CVE IDs in the registry
    // comment created maintenance debt that aged out within weeks — the
    // refreshed note routes consumers to the stable URL plus an install-
    // side mitigation contract while no tagged release supersedes 1.8.1.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.securityNote).toBeDefined();
    expect(jq.securityNote).toContain("https://github.com/jqlang/jq/security/advisories");
    expect(jq.securityNote).toContain("1.8.1");
    expect(jq.securityNote).toMatch(/sandbox|isolat/i);
  });

  it("az-devops entry declares an extensionProbe for the azure-devops extension (D21-M6, Cycle 10)", () => {
    // D21-M6: the base `command -v az` probe is a false positive for users
    // who install Azure CLI standalone without the azure-devops extension.
    // The registered extensionProbe runs `az extension list -o tsv` after
    // the base probe and only reports installed when "azure-devops" appears
    // in the roster; detect.ts consumes this to surface
    // result.extensionMissing instead of treating the tool as ready.
    const azDevops = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)["az-devops"];
    expect(azDevops).toBeDefined();
    expect(azDevops!.extensionProbe).toBeDefined();
    expect(azDevops!.extensionProbe!.args).toEqual(["extension", "list", "-o", "tsv"]);
    expect(azDevops!.extensionProbe!.expectInStdout).toBe("azure-devops");
    expect(azDevops!.extensionProbe!.name).toBe("azure-devops");
  });

  it("gh entry floors at >=2.93.0 + securityNote attributes the Authorization-header leak to CVE-2026-48501 (D21-1/D21-2, Cycle 11)", () => {
    // Cycle 11 D21-1/D21-2 (SA21.5-F1/F2): the prior note misattributed the
    // token leak to GHSA-crc3-h8v6-qh57. That advisory is CVE-2026-45803 (LOW
    // terminal-escape-sequence injection in `gh run view --log`, fixed 2.92.0).
    // The real Authorization-header leak to TUF mirrors is CVE-2026-48501 /
    // GHSA-8xvp-7hj6-mcj9, fixed in 2.93.0 — so the floor is raised to >=2.93.0
    // and the securityNote attributes each advisory to its correct CVE.
    const gh = AVAILABLE_CLI_TOOLS.gh;
    expect(gh.minVersion).toBe(">=2.93.0");
    expect(gh.securityNote).toBeDefined();
    // The Authorization-header leak (the HIGH-impact token exposure) is the
    // real CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9, fixed 2.93.0.
    expect(gh.securityNote).toContain("CVE-2026-48501");
    expect(gh.securityNote).toContain("GHSA-8xvp-7hj6-mcj9");
    expect(gh.securityNote).toContain("2.93.0");
    // GHSA-crc3-h8v6-qh57 is still mentioned, but correctly framed as the LOW
    // escape-injection (CVE-2026-45803) — never as a token leak.
    expect(gh.securityNote).toContain("CVE-2026-45803");
    expect(gh.securityNote).not.toMatch(/GHSA-crc3-h8v6-qh57[^.]*token/i);
  });

  it("glab + az-devops carry tested-against minVersion documentation pins (D21-SA21.5-F-21.5.3, Cycle 10)", () => {
    // Cycle 10 D21-SA21.5-F-21.5.3: these are documentation pins recording the
    // version Cycle 10 verified (glab 1.99.0, az-devops 1.0.4 / tag
    // 20260514.1), NOT CVE-driven floors — the installer surfaces them as
    // advisory text and the next cycle measures drift against them.
    const glab = AVAILABLE_CLI_TOOLS.glab;
    const azDevops = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)["az-devops"];
    expect(glab.minVersion).toBe("1.99.0");
    expect(azDevops).toBeDefined();
    expect(azDevops!.minVersion).toBe("1.0.4");
  });

  it("yq + miller + csvkit carry tested-against documentation-pin minVersions (D21-13, Cycle 11)", () => {
    // Cycle 11 D21-13 (SA21.3-F5): yq/miller/csvkit previously had no version
    // floor while jq/dasel did, so skill.ts emitted no floor block for them.
    // These are documentation pins mirroring the glab/az-devops precedent
    // (cycle-verified baseline, NOT CVE-driven): yq 4.53.2, miller 6.18.1,
    // csvkit 2.2.0. The bare version string (no `>=`) matches the doc-pin form.
    const yq = AVAILABLE_CLI_TOOLS.yq;
    const miller = AVAILABLE_CLI_TOOLS.miller;
    const csvkit = AVAILABLE_CLI_TOOLS.csvkit;
    expect(yq.minVersion).toBe("4.53.2");
    expect(miller.minVersion).toBe("6.18.1");
    expect(csvkit.minVersion).toBe("2.2.0");
  });

  it("gh linux recipe uses the upstream apt-repo one-liner; glab linux prefers snap (D21-17, Cycle 11)", () => {
    // Cycle 11 D21-17 (SA21.5-F4): bare `sudo apt install gh`/`glab` fail on
    // stock Debian and pull versions below the registry floor. gh's linux
    // recipe is the cli.github.com keyring + signed-repo apt one-liner; glab's
    // linux recipe is `snap install glab` (with the release `.deb` as fallback
    // per the registry comment) — the upstream-recommended Linux channels.
    const gh = AVAILABLE_CLI_TOOLS.gh;
    const ghLinux = gh.install.linux.map((c) => c.command);
    // No bare `apt install gh` remains; the recipe adds the signed cli.github.com repo.
    expect(ghLinux).not.toContain("sudo apt install gh");
    expect(ghLinux.some((c) => c.includes("cli.github.com/packages"))).toBe(true);
    expect(ghLinux.some((c) => c.includes("githubcli-archive-keyring.gpg"))).toBe(true);

    const glab = AVAILABLE_CLI_TOOLS.glab;
    const glabLinux = glab.install.linux.map((c) => c.command);
    expect(glabLinux).not.toContain("sudo apt install glab");
    expect(glabLinux).toContain("sudo snap install glab");
  });

  it("docker entry floors at >=29.5.2 + securityNote cites the docker cp host-root CVE cluster (D21-SA21.6-F02, Cycle 10)", () => {
    // C9-H91: Docker engine 29.5.0 patches CVE-2026-32288 (DoS via crafted
    // image manifest). Cycle 10 F21.6.F02: the 2026-05-18 announcement added
    // three host-root `docker cp` escapes (CVE-2026-41567/41568/42306) fixed
    // in 29.5.1; 29.5.2 (2026-05-20) fixes the 29.5.1 docker cp regression, so
    // the recommended floor is raised to >=29.5.2 — the first patched and
    // regression-free build.
    const docker = AVAILABLE_CLI_TOOLS.docker;
    expect(docker.minVersion).toBe(">=29.5.2");
    expect(docker.securityNote).toBeDefined();
    expect(docker.securityNote).toContain("CVE-2026-32288");
    expect(docker.securityNote).toContain("CVE-2026-41567");
    expect(docker.securityNote).toContain("CVE-2026-42306");
    expect(docker.securityNote).toContain("29.5.2");
    // Cycle 11 D21-16 (SA21.6-F4): the two HIGH 29.x AuthZ-bypass CVEs (both
    // fixed in 29.3.1) must be in the user-facing disclosure roster too.
    expect(docker.securityNote).toContain("CVE-2026-34040");
    expect(docker.securityNote).toContain("CVE-2026-33997");
    expect(docker.securityNote).toContain("29.3.1");
  });

  it("curl entry tier-1 minVersion >=8.20.0 + securityNote cites the 8.20.0-specific CVEs with accurate severity (D21-14, Cycle 11)", () => {
    // Cycle 11 D21-14 (SA21.4-F1): the prior note rolled seven CVEs together as
    // "all fixed in 8.20.0" and labelled them "Medium-and-Low" — both wrong
    // (CVE-2026-3805 fixed 8.18.0, CVE-2026-3783 fixed 8.17.0; CVE-2026-6253 is
    // High). The corrected note cites the three advisories actually resolved by
    // the 8.20.0 release (CVE-2026-5773/5545/4873) plus the earlier High
    // CVE-2026-6253, and states the >=8.20.0 floor clears the cumulative
    // backlog. The inaccurate CVE-2026-7168 roster is gone.
    const curl = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).curl;
    expect(curl).toBeDefined();
    expect(curl!.id).toBe("curl");
    expect(curl!.tier).toBe(1);
    expect(curl!.category).toBe("http");
    expect(curl!.minVersion).toBe(">=8.20.0");
    expect(curl!.securityNote).toBeDefined();
    // The three advisories specific to the 8.20.0 release.
    expect(curl!.securityNote).toContain("CVE-2026-5773");
    expect(curl!.securityNote).toContain("CVE-2026-5545");
    expect(curl!.securityNote).toContain("CVE-2026-4873");
    // The earlier High advisory is named with correct severity.
    expect(curl!.securityNote).toContain("CVE-2026-6253");
    expect(curl!.securityNote).toMatch(/High/);
    expect(curl!.securityNote).toContain("8.20.0");
    // The discredited "all fixed in 8.20.0 / Medium-and-Low" framing is gone.
    expect(curl!.securityNote).not.toContain("CVE-2026-7168");
    expect(curl!.securityNote).not.toMatch(/Medium-and-Low/);
  });

  it("httpie entry registered as tier-2 web-project (D21-SA21.4-F03, Cycle 10)", () => {
    // Cycle 10 D21-SA21.4-F03 (F-21.7.1): httpie/cli 3.2.4 (2024-11-01) is
    // 572 days old at audit but the project remains under maintenance, so it
    // stays registered as the tier-2 web-project HTTP tool.
    const httpie = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).httpie;
    expect(httpie).toBeDefined();
    expect(httpie!.id).toBe("httpie");
    expect(httpie!.probe).toBe("http");
    expect(httpie!.tier).toBe(2);
    expect(httpie!.category).toBe("http");
    expect(httpie!.trigger).toBe("web-project");
  });

  it("xh entry registered as tier-2 web-project with minVersion >=0.25.3 (D21-SA21.4-F04, Cycle 10)", () => {
    // Cycle 10 D21-SA21.4-F04 (F-21.7.1): xh v0.25.3 (2025-12-16) is the
    // latest stable; entry pins to the latest stable so 0.24.x builds get an
    // upgrade hint at install.
    const xh = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).xh;
    expect(xh).toBeDefined();
    expect(xh!.id).toBe("xh");
    expect(xh!.tier).toBe(2);
    expect(xh!.category).toBe("http");
    expect(xh!.trigger).toBe("web-project");
    expect(xh!.minVersion).toBe(">=0.25.3");
  });

  it("playwright entry floors at >=1.55.1 + securityNote cites the installer-MitM + Chromium-roll CVEs (D21-4, Cycle 11)", () => {
    // Cycle 11 D21-4 (SA21.6-F1): playwright was the only tier-2 browser tool
    // with no version floor while its sandbox image is recommended for
    // navigating untrusted URLs. CVE-2025-59288 (installer MitM in
    // `npx playwright install`, CVSS 8.7) is fixed in 1.55.1; the bundled
    // Chromium carries CVE-2026-2441 (rolled per monthly release). The entry
    // pins >=1.55.1 and the securityNote carries the Chromium-currency caution.
    const playwright = AVAILABLE_CLI_TOOLS.playwright;
    expect(playwright.minVersion).toBe(">=1.55.1");
    expect(playwright.securityNote).toBeDefined();
    expect(playwright.securityNote).toContain("CVE-2025-59288");
    expect(playwright.securityNote).toContain("CVE-2026-2441");
    expect(playwright.securityNote).toContain("1.55.1");
  });

  it("sd Linux recipe uses cargo binstall (v1.1.0 GitHub-release binary) + minVersion >=1.1.0 (D21-6, Cycle 11)", () => {
    // Cycle 11 D21-6 (SA21.2-F1): `cargo install sd` pins crates.io 1.0.0 while
    // brew/scoop ship 1.1.0 and the documented line-by-line default + -A flag
    // are 1.1.0-only. The GitHub v1.1.0 release ships prebuilt Linux binaries;
    // `cargo binstall sd` fetches that binary, aligning all three OSes on 1.1.0
    // so the >=1.1.0 floor is satisfiable everywhere.
    const sd = AVAILABLE_CLI_TOOLS.sd;
    expect(sd.minVersion).toBe(">=1.1.0");
    // The linux recipe is the binstall channel (v1.1.0 GitHub-release binary),
    // not the crates.io-pinned `cargo install sd` (which resolves to 1.0.0).
    const linuxCommands = sd.install.linux.map((c) => c.command);
    expect(linuxCommands).toContain("cargo binstall sd");
    expect(linuxCommands).not.toContain("cargo install sd");
  });

  it("dasel entry registered as tier-3 with minVersion >=3.11.0 + securityNote citing 3-CVE cluster (D21-SA21.3-F-21.3.5/F-21.3.6, Cycle 10)", () => {
    // Cycle 10 D21-SA21.3-F-21.3.5/F-21.3.6 (F-21.7.1): dasel was
    // referenced in skill prose but absent from the registry, leaving the
    // CVE-2026-46377/-46378/-33320 cluster unsurfaced to consumers. v3.11.0
    // (2026-05-19) ships the upstream fix.
    const dasel = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).dasel;
    expect(dasel).toBeDefined();
    expect(dasel!.id).toBe("dasel");
    expect(dasel!.tier).toBe(3);
    expect(dasel!.category).toBe("data");
    expect(dasel!.minVersion).toBe(">=3.11.0");
    expect(dasel!.securityNote).toBeDefined();
    expect(dasel!.securityNote).toContain("CVE-2026-46377");
    expect(dasel!.securityNote).toContain("CVE-2026-46378");
    expect(dasel!.securityNote).toContain("CVE-2026-33320");
    expect(dasel!.securityNote).toContain("3.11.0");
  });

  it("container-use entry registered as tier-3 container with caveat tagging pre-1.0 + missing-security-policy (D21-SA21.6-F03/F07, Cycle 10)", () => {
    // Cycle 10 D21-SA21.6-F03/F07 (F-21.7.1): dagger/container-use v0.4.2
    // (2025-08-19) is 281 days old with no SECURITY.md published; the
    // catalog must register it because D15 sandbox-escape control names
    // it alongside docker/playwright. caveat surfaces the pre-1.0 state.
    const containerUse = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)["container-use"];
    expect(containerUse).toBeDefined();
    expect(containerUse!.id).toBe("container-use");
    expect(containerUse!.tier).toBe(3);
    expect(containerUse!.category).toBe("container");
    expect(containerUse!.caveat).toBe("pre-1.0-stale-no-security-policy");
    expect(containerUse!.minVersion).toBe(">=0.4.2");
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
    // C9-H55 + C9-H89: minVersion / cve_scan are optional schema extensions.
    // Verify that each entry that declares them uses the documented shape —
    // strings for minVersion, and { last_checked, advisory_count, report_url }
    // for cve_scan. Entries that omit the fields are not iterated.
    for (const entry of allEntries) {
      if (entry.minVersion !== undefined) {
        expect(entry.minVersion).toBeTypeOf("string");
        expect(entry.minVersion.length).toBeGreaterThan(0);
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

  it("every entry declares a source-repo VCS URL + a valid SPDX license (D15-32, Cycle 11)", () => {
    // Cycle 11 D15-32 (SA15.7-F4): the D15.7 provenance contract requires
    // "vendor + source URL + license" as machine-checkable fields. `homepage`
    // alone is insufficient — several homepages are docs/marketing sites
    // (duckdb.org, learn.microsoft.com, csvkit.readthedocs.io) rather than the
    // source repo. `sourceRepo` must be a GitHub/GitLab VCS URL and `license`
    // a valid SPDX expression so provenance is auditable per cycle.

    // Curated allowlist of the SPDX license ids actually used by the catalog.
    // A new tool with a license outside this set fails here, forcing a
    // deliberate allowlist update (and a real SPDX id, not a typo / "see repo").
    const KNOWN_SPDX_IDS = new Set([
      "MIT",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "GPL-2.0-only",
      "Unlicense",
      "curl", // `curl` is itself a registered SPDX license id.
    ]);
    // SPDX expression: one-or-more ids joined by OR / AND / WITH operators.
    // Validates the structural shape and that every leaf id is a known SPDX id.
    const validateSpdxExpression = (expr: string): boolean => {
      if (!/^[A-Za-z0-9.+-]+(?: (?:OR|AND|WITH) [A-Za-z0-9.+-]+)*$/.test(expr)) {
        return false;
      }
      const leaves = expr.split(/ (?:OR|AND|WITH) /);
      return leaves.every((leaf) => KNOWN_SPDX_IDS.has(leaf));
    };

    for (const entry of allEntries) {
      // sourceRepo: a GitHub or GitLab https VCS URL (never a docs site).
      expect(entry.sourceRepo, `${entry.id} sourceRepo`).toBeTypeOf("string");
      expect(
        /^https:\/\/(?:github\.com|gitlab\.com)\/[^/]+\/[^/]+/.test(entry.sourceRepo),
        `${entry.id} sourceRepo "${entry.sourceRepo}" must be a github.com/gitlab.com VCS URL`,
      ).toBe(true);
      // license: a valid SPDX expression built from known ids.
      expect(entry.license, `${entry.id} license`).toBeTypeOf("string");
      expect(
        validateSpdxExpression(entry.license),
        `${entry.id} license "${entry.license}" is not a valid SPDX expression of known ids`,
      ).toBe(true);
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
  it("has exactly 11 entries", () => {
    expect(TIER1_CLI_TOOLS.length).toBe(11);
  });

  it("has stable ordering (snapshot)", () => {
    // Tier-1 tool list — order drives picker display order, so a re-ordering
    // needs explicit acknowledgement. curl appended at Cycle 10 per
    // D21-SA21.4-F02 / F-21.7.1 (HTTP category implementation).
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
      "curl",
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
  it("has exactly 10 entries", () => {
    expect(TIER3_CLI_TOOLS.length).toBe(10);
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
