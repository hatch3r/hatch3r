import { describe, it, expect } from "vitest";
import {
  AVAILABLE_CLI_TOOLS,
  TIER1_CLI_TOOLS,
  TIER2_CLI_TOOLS_BY_TRIGGER,
  TIER3_CLI_TOOLS,
  DEFAULT_CLI_TOOLS,
  CLI_TOOL_SECRET_NOTES,
  STANDALONE_CLI_TOOLS,
  TOOLBOX_CLI_TOOLS,
  cliToolSelectionUsesToolbox,
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

  it("contains the expected tier counts (11/13/15)", () => {
    const tier1 = allEntries.filter((t) => t.tier === 1);
    const tier2 = allEntries.filter((t) => t.tier === 2);
    const tier3 = allEntries.filter((t) => t.tier === 3);

    // Cycle 10 D21-SA21.7-F-21.7.1: tier counts updated when the HTTP
    // category (curl/httpie/xh), dasel, and container-use landed.
    // Cycle 12 D21-SA21.7-05: tier-3 grew 10 → 15 with the CL-2 additions
    // (crush, jaq, tombi, hurl, tea) — 11 tier-1 default-on, 13 tier-2
    // conditional, 15 tier-3 opt-in.
    expect(tier1.length).toBe(11);
    expect(tier2.length).toBe(13);
    expect(tier3.length).toBe(15);
    // Total catalog size 39 — surfaces accidental tool additions without
    // tier classification updates.
    expect(allEntries.length).toBe(39);
  });

  it("partitions the five standalone skills from the 34-tool toolbox", () => {
    expect(STANDALONE_CLI_TOOLS).toHaveLength(5);
    expect(TOOLBOX_CLI_TOOLS).toHaveLength(34);
    expect(new Set([...STANDALONE_CLI_TOOLS, ...TOOLBOX_CLI_TOOLS])).toEqual(
      new Set(Object.keys(AVAILABLE_CLI_TOOLS)),
    );
    expect(cliToolSelectionUsesToolbox(["jq"])).toBe(false);
    expect(cliToolSelectionUsesToolbox(["jq", "curl"])).toBe(true);
    expect(cliToolSelectionUsesToolbox(["never-existed-tool"])).toBe(false);
  });

  it("tier arrays partition AVAILABLE_CLI_TOOLS exactly — the section-header counts are un-driftable (D21-SA21.4-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.4-05: the `// ── Tier N (M tools) ──` section-header
    // comments in registry.ts are hand-maintained and had drifted — tier 1 read
    // "10 tools" after curl's Cycle-11 admission made it 11. Comments are not
    // runtime-readable, so this asserts the next-best invariant: each tier array
    // is exactly the set of registry entries at that tier (both directions), and
    // the three tiers partition the whole catalog. A tool added to the registry
    // without a matching tier-array update — or vice versa — now fails here.
    const registryTierIds = (n: 1 | 2 | 3): string[] =>
      allEntries.filter((t) => t.tier === n).map((t): string => t.id).sort();
    const sorted = (ids: readonly string[]): string[] => [...ids].sort();
    expect(sorted(TIER1_CLI_TOOLS)).toEqual(registryTierIds(1));
    expect(sorted(TIER3_CLI_TOOLS)).toEqual(registryTierIds(3));
    // Tier-2 tools may appear under multiple triggers (taplo: rust + python), so
    // compare the DISTINCT tool set across all triggers against the registry.
    const tier2FromTriggers = sorted([
      ...new Set(Object.values(TIER2_CLI_TOOLS_BY_TRIGGER).flat()),
    ]);
    expect(tier2FromTriggers).toEqual(registryTierIds(2));
    // The partition sums to the full catalog — the count the section headers
    // assert (11 + 13 + 10 = 34).
    expect(
      registryTierIds(1).length + registryTierIds(2).length + registryTierIds(3).length,
    ).toBe(Object.keys(AVAILABLE_CLI_TOOLS).length);
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
        "crush",
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
        "hurl",
        "jaq",
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
        "tea",
        "tombi",
        "xh",
        "yq",
        "zstd",
      ]
    ` );
  });

  it("registry replaces archived xsv with active qsv fork (D21-SA21.3-F01)", () => {
    // BurntSushi/xsv was archived 2025-04-24; qsv — canonically dathere/qsv
    // after the org transfer (Cycle 12 D21-SA21.3-05) — is the active successor
    // with a superset of xsv's command set. The registry must not ship the
    // archived id.
    const keys = Object.keys(AVAILABLE_CLI_TOOLS);
    expect(keys).toContain("qsv");
    expect(keys).not.toContain("xsv");

    const qsv = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).qsv;
    expect(qsv).toBeDefined();
    expect(qsv!.id).toBe("qsv");
    expect(qsv!.tier).toBe(2);
    expect(qsv!.trigger).toBe("data-project");
    // Cycle 12 D21-SA21.3-05: the project transferred to the dathere org; the
    // D15.7 provenance fields must point at the canonical repo, not the
    // jqnatividad GitHub transfer-redirect.
    expect(qsv!.homepage).toContain("dathere/qsv");
    expect(qsv!.sourceRepo).toContain("dathere/qsv");
    expect(qsv!.homepage).not.toContain("jqnatividad");
    expect(qsv!.sourceRepo).not.toContain("jqnatividad");
  });

  it("jq entry floors at >=1.8.2 for the 16-CVE cluster fixed in 1.8.2 (D21-SA21.3-01, Cycle 12)", () => {
    // Cycle 12 D21-SA21.3-01: jq 1.8.2 (2026-06-20) superseded 1.8.1 as the
    // security release, fixing a 16-CVE stack/integer-overflow + NUL-truncation
    // + use-after-free cluster (CVE-2026-32316 … CVE-2026-54679). The prior
    // >=1.8.1 floor certified the exact vulnerable build as acceptable; the
    // floor is raised to >=1.8.2, which still clears the 2024 CVE-2023-49355 /
    // CVE-2024-53427 1.7.x cluster the prior comment cited.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.minVersion).toBe(">=1.8.2");
  });

  it("jq securityNote names the 1.8.2-fixed CVE cluster and drops the stale unfixed-advisory framing (D21-SA21.3-01, Cycle 12)", () => {
    // Cycle 12 D21-SA21.3-01: the prior note called the 2026 advisories
    // "unfixed" and prescribed external validation / sandboxing as the only
    // mitigation — wrong once jq 1.8.2 shipped the fixes. The refreshed note
    // names the cluster bounds (CVE-2026-32316 … CVE-2026-54679), the patched
    // version, and reframes the sandbox guidance as for-un-upgradable-builds-only.
    const jq = AVAILABLE_CLI_TOOLS.jq;
    expect(jq.securityNote).toBeDefined();
    expect(jq.securityNote).toContain("1.8.2");
    expect(jq.securityNote).toContain("CVE-2026-32316");
    expect(jq.securityNote).toContain("CVE-2026-54679");
    expect(jq.securityNote).toMatch(/16-CVE/);
    // The discredited "unfixed advisories" framing and the now-dead
    // advisories-page roster pointer are gone.
    expect(jq.securityNote).not.toMatch(/unfixed advisories/i);
    expect(jq.securityNote).not.toContain("the only tagged release as of 2026-05-27");
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

  it("ast-grep entry declares an extensionProbe disambiguating shadow-utils sg (D21-SA21.1-01, Cycle 12)", () => {
    // Cycle 12 D21-SA21.1-01: the `sg` probe false-positives on Linux, where the
    // shadow-utils `login` package ships an unrelated /usr/bin/sg (setgroups) in
    // the base system — `command -v sg` then resolves for a machine without
    // ast-grep. The probe stays `sg` (the generated skill still invokes it) and
    // this extensionProbe runs `sg --version`, reporting installed only when
    // stdout carries "ast-grep" (mirrors the az-devops extensionProbe pattern).
    const astGrep = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)["ast-grep"];
    expect(astGrep).toBeDefined();
    expect(astGrep!.probe).toBe("sg");
    expect(astGrep!.extensionProbe).toBeDefined();
    expect(astGrep!.extensionProbe!.args).toEqual(["--version"]);
    expect(astGrep!.extensionProbe!.expectInStdout).toBe("ast-grep");
    expect(astGrep!.extensionProbe!.name).toBe("ast-grep");
  });

  it("gh entry floors at >=2.96.0 for CVE-2026-59831 + securityNote enumerates the codespace-jupyter advisory (D21-SA21.5-01, Cycle 12)", () => {
    // Cycle 12 D21-SA21.5-01: GHSA-8cg3-r6g9-fpg2 / CVE-2026-59831 (CVSS 4.4,
    // published 2026-07-02) makes `gh codespace jupyter` open an unvalidated
    // `vscode://` URL from a malicious codespace → command execution on the
    // host; affected v2.10.0+, patched only in v2.96.0. The prior >=2.93.0 floor
    // recommended an affected build, so it is raised to >=2.96.0 and the
    // advisory is appended while the Cycle-11 attributions are preserved.
    const gh = AVAILABLE_CLI_TOOLS.gh;
    expect(gh.minVersion).toBe(">=2.96.0");
    expect(gh.securityNote).toBeDefined();
    // The Cycle-12 codespace-jupyter advisory + its patched floor.
    expect(gh.securityNote).toContain("CVE-2026-59831");
    expect(gh.securityNote).toContain("GHSA-8cg3-r6g9-fpg2");
    expect(gh.securityNote).toContain("2.96.0");
    expect(gh.securityNote).toContain("codespace jupyter");
    // The Cycle-11 Authorization-header leak (the HIGH-impact token exposure) is
    // still the real CVE-2026-48501 / GHSA-8xvp-7hj6-mcj9, fixed 2.93.0.
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

  it("curl entry tier-1 minVersion >=8.21.0 + securityNote marks 8.20.0 advisory-affected and 8.21.0 the clean floor (D21-SA21.4-01, Cycle 12)", () => {
    // Cycle 12 D21-SA21.4-01: curl 8.21.0 shipped 2026-06-24; curl.se's
    // vuln-8.20.0.html now lists 18 published problems for 8.20.0 (incl.
    // CVE-2026-11856, fixed in 8.21.0), while vuln-8.21.0.html lists 0. The
    // prior >=8.20.0 floor + its "8.20.0 documented clean" claim are stale, so
    // the floor is raised to >=8.21.0 and the note reframes 8.20.0 as
    // advisory-affected. The Cycle-11 historical roster
    // (CVE-2026-5773/5545/4873 + the High CVE-2026-6253) is preserved.
    const curl = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).curl;
    expect(curl).toBeDefined();
    expect(curl!.id).toBe("curl");
    expect(curl!.tier).toBe(1);
    expect(curl!.category).toBe("http");
    expect(curl!.minVersion).toBe(">=8.21.0");
    expect(curl!.securityNote).toBeDefined();
    // The new clean floor + the advisory that pushed 8.20.0 out of the floor.
    expect(curl!.securityNote).toContain("8.21.0");
    expect(curl!.securityNote).toContain("CVE-2026-11856");
    // The Cycle-11 historical roster is preserved.
    expect(curl!.securityNote).toContain("CVE-2026-5773");
    expect(curl!.securityNote).toContain("CVE-2026-5545");
    expect(curl!.securityNote).toContain("CVE-2026-4873");
    // The earlier High advisory is still named with correct severity.
    expect(curl!.securityNote).toContain("CVE-2026-6253");
    expect(curl!.securityNote).toMatch(/High/);
    // The stale "8.20.0 documented clean" framing is retired.
    expect(curl!.securityNote).not.toContain("documented clean");
    // The discredited Cycle-10 framing stays gone.
    expect(curl!.securityNote).not.toContain("CVE-2026-7168");
    expect(curl!.securityNote).not.toMatch(/Medium-and-Low/);
  });

  it("zstd carries a drift-baseline minVersion 1.5.7 + securityNote citing CVE-2022-4899 (D15-SA15.7-02 / D21-SA21.2-02, Cycle 12)", () => {
    // Cycle 12 D15-SA15.7-02: zstd was OSV-exempt with no compensating floor or
    // note. D21-SA21.2-02 adds a Meta ~annual-cadence drift-baseline pin (1.5.7,
    // bare doc-pin form per the glab/miller precedent) and a securityNote
    // recording the historical CVE-2022-4899 (HIGH, cleared by any 1.5.x build).
    const zstd = AVAILABLE_CLI_TOOLS.zstd;
    expect(zstd.minVersion).toBe("1.5.7");
    expect(zstd.securityNote).toBeDefined();
    expect(zstd.securityNote).toContain("CVE-2022-4899");
    expect(zstd.securityNote).toMatch(/HIGH/);
  });

  it("bat + fd declare Debian-rename probeFallbacks (batcat / fdfind) (D21-SA21.2-03, Cycle 12)", () => {
    // Cycle 12 D21-SA21.2-03: the recommended `apt install bat` / `apt install
    // fd-find` channels install the binaries as `batcat` / `fdfind`, so a bare
    // `command -v bat`/`fd` probe false-negatives on Debian/Ubuntu. The
    // probeFallbacks let detect.ts resolve the renamed binary before reporting
    // the tool absent.
    const bat = AVAILABLE_CLI_TOOLS.bat;
    const fd = AVAILABLE_CLI_TOOLS.fd;
    expect(bat.probeFallbacks).toEqual(["batcat"]);
    expect(fd.probeFallbacks).toEqual(["fdfind"]);
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

  it("playwright floors at >=1.60.0 to machine-cover the CVE-2026-2441 Chromium fix + retains the installer-MitM CVE note (D21-SA21.6-07, Cycle 12)", () => {
    // Cycle 12 D21-SA21.6-07: the prior >=1.55.1 floor machine-covered only the
    // installer CVE (CVE-2025-59288, fixed 1.55.1), leaving the bundled-Chromium
    // RCE CVE-2026-2441 (fixed in Chromium 146.0.7680.31, playwright issue
    // #39574) to prose alone. v1.60.0 is the earliest release verified to bundle
    // a Chromium past that fix (148.0.7778.96, per the playwright releases page
    // accessed 2026-07-11) — 1.59.x's bundled Chromium is unlisted there — so the
    // floor is raised to >=1.60.0 to enforce both CVEs. The installer-CVE tokens
    // (CVE-2025-59288 / 1.55.1) and CVE-2026-2441 stay in the securityNote.
    const playwright = AVAILABLE_CLI_TOOLS.playwright;
    expect(playwright.minVersion).toBe(">=1.60.0");
    expect(playwright.securityNote).toBeDefined();
    expect(playwright.securityNote).toContain("CVE-2025-59288");
    expect(playwright.securityNote).toContain("CVE-2026-2441");
    // The installer-CVE fix version is retained; the new browser-engine floor is named.
    expect(playwright.securityNote).toContain("1.55.1");
    expect(playwright.securityNote).toContain("1.60.0");
    // The Chromium fix build is cited so the floor's basis is auditable.
    expect(playwright.securityNote).toContain("146.0.7680.31");
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

  it("mods discloses the upstream archive + crush successor via caveat and description (D21-SA21.6-02 / D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.6-02: charmbracelet/mods was archived upstream
    // (2026-03-09) with crush as the same-org successor, yet the entry carried
    // no disclosure while staler peers (httpie, container-use) did. mods is
    // retained (removal is a B1-gated owner decision, staged next cycle per
    // rules/hatch3r-tool-currency.md:68); the caveat + description surface the
    // EOL state to the picker and the toolbox.
    const mods = AVAILABLE_CLI_TOOLS.mods;
    expect(mods.caveat).toBe("upstream-archived-superseded-by-crush");
    expect(mods.description).toContain("archived 2026-03-09");
    expect(mods.description).toContain("crush");
    expect(mods.tier).toBe(3);
  });

  it("crush registered as tier-3 ai — the archived-mods successor, signed channels on all 3 OSes (D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-05 (CL-2 P2; home D21-SA21.6-09): crush is
    // charmbracelet's designated mods successor, verified v0.84.1 (2026-07-11)
    // with 0 GitHub advisories, accessed 2026-07-12. The linux recipe must be
    // the Charm signed-apt keyring one-liner (gh D21-17 precedent) — a bare
    // `sudo apt install crush` fails without the repo.charm.sh repo.
    const crush = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).crush;
    expect(crush).toBeDefined();
    expect(crush!.id).toBe("crush");
    expect(crush!.tier).toBe(3);
    expect(crush!.category).toBe("ai");
    expect(crush!.minVersion).toBe("0.84.1");
    expect(crush!.license).toBe("FSL-1.1-MIT");
    const linux = crush!.install.linux.map((c) => c.command);
    expect(linux).not.toContain("sudo apt install crush");
    expect(linux.some((c) => c.includes("repo.charm.sh"))).toBe(true);
    expect(linux.some((c) => c.includes("signed-by=/etc/apt/keyrings/charm.gpg"))).toBe(true);
  });

  it("jaq registered as tier-3 json — the memory-safe jq peer with --locked cargo recipes (D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-05 (CL-2 P3; home D21-SA21.3-07): jaq is the
    // security-audited memory-safe hedge against jq's 16-CVE 2026 cluster
    // (D21-SA21.3-01). Verified v3.1.0 (2026-06-11), 0 advisories, accessed
    // 2026-07-12. Cargo recipes pin --locked per the ast-grep/xh/qsv precedent.
    const jaq = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).jaq;
    expect(jaq).toBeDefined();
    expect(jaq!.id).toBe("jaq");
    expect(jaq!.tier).toBe(3);
    expect(jaq!.category).toBe("json");
    expect(jaq!.minVersion).toBe("3.1.0");
    for (const os of ["linux", "win"] as const) {
      const commands = jaq!.install[os].map((c) => c.command);
      expect(commands).toContain("cargo install --locked jaq");
    }
  });

  it("tombi registered as tier-3 yaml — the maintained taplo alternative, taplo retained (D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-05 (CL-2 P3; home D21-SA21.3-02/-07): tombi is the
    // active peer to the trajectory-negative taplo (maintainer stepdown,
    // tamasfe/taplo#715). Verified v1.2.0 (2026-07-05), 0 advisories, accessed
    // 2026-07-12. taplo stays registered — demotion is a B1-gated owner
    // decision staged for the next cycle.
    const tombi = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).tombi;
    expect(tombi).toBeDefined();
    expect(tombi!.id).toBe("tombi");
    expect(tombi!.tier).toBe(3);
    expect(tombi!.category).toBe("yaml");
    expect(tombi!.minVersion).toBe("1.2.0");
    // The unsigned curl-piped-shell vendor channel must not be registered.
    for (const os of ["mac", "linux", "win"] as const) {
      for (const c of tombi!.install[os]) {
        expect(c.command).not.toContain("install.sh");
      }
    }
    expect((AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).taplo).toBeDefined();
  });

  it("hurl registered as tier-3 http with the >=7.0.0 GHSA floor + securityNote (D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-05 (CL-2 P3; home D21-SA21.4-06): hurl covers the
    // assertion-based HTTP test-file cell none of curl/httpie/xh expresses.
    // GHSA-v33j-v3x4-42qg (Moderate, no CVE assigned): `hurlfmt --out html`
    // regex-literal injection on builds <=6.1.1, patched 7.0.0 — hence the
    // range-form floor (delta precedent). Verified 8.0.1 (2026-04-29),
    // accessed 2026-07-12.
    const hurl = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).hurl;
    expect(hurl).toBeDefined();
    expect(hurl!.id).toBe("hurl");
    expect(hurl!.tier).toBe(3);
    expect(hurl!.category).toBe("http");
    expect(hurl!.minVersion).toBe(">=7.0.0");
    expect(hurl!.securityNote).toBeDefined();
    expect(hurl!.securityNote).toContain("GHSA-v33j-v3x4-42qg");
    expect(hurl!.securityNote).toContain("7.0.0");
  });

  it("tea registered as tier-3 forge with a Gitea-disambiguating extensionProbe + gitea.com sourceRepo (D21-SA21.7-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-05 (CL-2 P3; home D21-SA21.5-05): tea closes the
    // Gitea/Forgejo/Codeberg forge-family coverage gap. The bare `tea` probe
    // collides (Debian's TEA Qt editor at /usr/bin/tea; legacy teaxyz tea), so
    // detection confirms identity via `tea --help` stdout containing "Gitea" —
    // `tea --version` is unusable because gitea/tea's custom VersionPrinter
    // prints the bare version with no name prefix (cmd/cmd.go, verified
    // 2026-07-12). Verified v0.14.2 (2026-06-26), 0 advisories.
    const tea = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).tea;
    expect(tea).toBeDefined();
    expect(tea!.id).toBe("tea");
    expect(tea!.tier).toBe(3);
    expect(tea!.category).toBe("forge");
    expect(tea!.minVersion).toBe("0.14.2");
    expect(tea!.extensionProbe).toBeDefined();
    expect(tea!.extensionProbe!.args).toEqual(["--help"]);
    expect(tea!.extensionProbe!.expectInStdout).toBe("Gitea");
    expect(tea!.extensionProbe!.name).toBe("tea");
    // Canonical VCS home is the Gitea forge itself (no GitHub mirror).
    expect(tea!.sourceRepo).toBe("https://gitea.com/gitea/tea");
    // The go-install recipes pin the documented release tag (dasel precedent).
    for (const os of ["linux", "win"] as const) {
      const commands = tea!.install[os].map((c) => c.command);
      expect(commands).toContain("go install gitea.dev/tea@v0.14.2");
    }
  });

  it("podman floor is normalized to the >=5.8.2 range form + Windows-only securityNote citing CVE-2026-33414 (D21-SA21.6-04, Cycle 12)", () => {
    // C9-H92: Podman 5.8.2 patches CVE-2026-33414 — Windows-only PowerShell
    // command injection on the Hyper-V backend via `podman machine init`.
    // Cycle 12 D21-SA21.6-04: podman shipped a 6.x major that the unpinned
    // channels now resolve to; the floor stays at 5.8.2 (still clears the only
    // podman CVE) but is normalized from the bare "5.8.2" string to the
    // ">=5.8.2" range form so it reads unambiguously as a floor (matching
    // docker's ">=29.5.2"), not an exact pin.
    const podman = AVAILABLE_CLI_TOOLS.podman;
    expect(podman.minVersion).toBe(">=5.8.2");
    expect(podman.securityNote).toBeDefined();
    expect(podman.securityNote).toContain("CVE-2026-33414");
    expect(podman.securityNote).toContain("Windows only");
  });

  it("ast-grep linux cargo recipe pins --locked for supply-chain reproducibility (D21-SA21.1-05, Cycle 12)", () => {
    // Cycle 12 D21-SA21.1-05: `cargo install ast-grep` omitted `--locked`,
    // diverging from its own toolbox skill row and from every other
    // cargo-installed registry tool (xh/taplo/qsv/difftastic). `--locked`
    // resolves against the crate's committed Cargo.lock instead of
    // channel-current transitive deps.
    const astGrep = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)["ast-grep"];
    expect(astGrep).toBeDefined();
    const linux = astGrep!.install.linux.map((c) => c.command);
    expect(linux).toContain("cargo install ast-grep --locked");
    expect(linux).not.toContain("cargo install ast-grep");
  });

  it("dasel linux go-install is pinned to the v3.11.0 floor tag, not @latest (D15-SA15.7-05, Cycle 12)", () => {
    // Cycle 12 D15-SA15.7-05: the dasel linux recipe installed `@latest` while
    // the entry's own minVersion is ">=3.11.0" and the securityNote says pin
    // >=3.11.0 — a floating @latest cannot honor the stated floor. Pinned to the
    // v3.11.0 tag (the go-module `/v3` path takes `v3.x.y` tags).
    const dasel = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).dasel;
    expect(dasel).toBeDefined();
    const linux = dasel!.install.linux.map((c) => c.command);
    expect(linux.some((c) => c.includes("dasel/v3/cmd/dasel@v3.11.0"))).toBe(true);
    expect(linux.some((c) => c.includes("@latest"))).toBe(false);
    // The pinned tag satisfies the entry's own stated floor.
    expect(dasel!.minVersion).toBe(">=3.11.0");
  });

  it("stagehand is marked packageType: 'library' — its npm package ships no bin (D21-SA21.7-04, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-04 (detection-contract class C): @browserbasehq/stagehand
    // is an npm library with no executable bin, so a `command -v stagehand` PATH
    // probe can never resolve. packageType: "library" records that shape so the
    // npm-global-bin gate below exempts it (and the class-C detection follow-on
    // can suppress the meaningless PATH probe).
    const stagehand = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>).stagehand;
    expect(stagehand).toBeDefined();
    expect(stagehand!.packageType).toBe("library");
  });

  it("registry invariant (i): every `npm install -g` tool declares a CLI bin or is packageType: 'library' (D21-SA21.7-04, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-04 (detection-contract class C — net-new gate): the
    // detection contract resolves every tool by a single PATH probe, so a tool
    // whose npm package ships NO executable (stagehand) registers a probe that
    // can never resolve. This gate forces a bin-audit decision at every
    // npm-global registration: the entry must EITHER be a bin-declaring package
    // listed in NPM_GLOBAL_BIN_DECLARING (after verifying its published `bin`
    // map) OR be explicitly marked packageType: "library". The curated allowlist
    // is the offline-enforceable form of the finding's "fixture-checked" intent —
    // no future tool can silently re-introduce the class-C bug.
    const NPM_GLOBAL_BIN_DECLARING = new Set<string>([
      // npm-global packages verified to ship an executable `bin`. Empty today:
      // stagehand (the only `npm install -g` entry) ships no bin and is
      // packageType: "library". Add an id here only after confirming the
      // package's published `bin` map is non-empty.
    ]);
    for (const entry of allEntries) {
      const npmGlobal = (["mac", "linux", "win"] as const).some((os) =>
        entry.install[os].some((c) => /\bnpm install -g\b/.test(c.command)),
      );
      if (!npmGlobal) continue;
      const accounted = NPM_GLOBAL_BIN_DECLARING.has(entry.id) || entry.packageType === "library";
      expect(
        accounted,
        `${entry.id} installs via 'npm install -g' but neither declares a bin (add to NPM_GLOBAL_BIN_DECLARING after a bin audit) nor is marked packageType: "library" — a PATH probe on a no-bin package can never resolve (D21-SA21.7-04 class C)`,
      ).toBe(true);
    }
  });

  it("registry invariant (ii): every probe is collision-audited; colliding probes carry a disambiguation extensionProbe (D21-SA21.7-04, Cycle 12)", () => {
    // Cycle 12 D21-SA21.7-04 (detection-contract class A — net-new gate): a bare
    // `command -v <probe>` false-positives when the probe name resolves for a
    // machine that lacks the actual tool — either an unrelated system binary
    // (ast-grep's `sg` => shadow-utils /usr/bin/sg) or a base CLI present without
    // its extension (az-devops's `az` without the azure-devops extension). Every
    // registry probe must carry an explicit collision verdict here (so adding a
    // tool forces a probe audit), and any probe audited as colliding MUST declare
    // an extensionProbe so detect.ts confirms identity before reporting installed.
    const PROBE_COLLISION_AUDIT: Record<string, { collides: boolean; note?: string }> = {
      rg: { collides: false },
      fd: { collides: false },
      jq: { collides: false },
      yq: { collides: false },
      gh: { collides: false },
      delta: { collides: false },
      bat: { collides: false },
      sd: { collides: false },
      sg: { collides: true, note: "shadow-utils /usr/bin/sg (setgroups) on Linux — ast-grep issue #706/#1659" },
      zstd: { collides: false },
      curl: { collides: false },
      playwright: { collides: false },
      http: { collides: false },
      xh: { collides: false },
      duckdb: { collides: false },
      qsv: { collides: false },
      taplo: { collides: false },
      glab: { collides: false },
      az: { collides: true, note: "base Azure CLI resolves without the azure-devops extension" },
      docker: { collides: false },
      llm: { collides: false },
      fzf: { collides: false },
      lazygit: { collides: false },
      difft: { collides: false },
      rtk: { collides: false },
      stagehand: { collides: false },
      aichat: { collides: false },
      mods: { collides: false },
      comby: { collides: false },
      mlr: { collides: false },
      csvlook: { collides: false },
      podman: { collides: false },
      dasel: { collides: false },
      "container-use": { collides: false },
      // Cycle 12 D21-SA21.7-05 CL-2 additions.
      crush: { collides: false },
      jaq: { collides: false },
      tombi: { collides: false },
      hurl: { collides: false },
      tea: {
        collides: true,
        note:
          "Debian ships an unrelated `tea` package (TEA Qt text editor, /usr/bin/tea) and legacy teaxyz tea installs (pre-pkgx rename) share the name — gitea/tea disambiguates via `tea --help` stdout containing 'Gitea'",
      },
    };
    for (const entry of allEntries) {
      const verdict = PROBE_COLLISION_AUDIT[entry.probe];
      expect(
        verdict,
        `probe "${entry.probe}" (${entry.id}) is not in PROBE_COLLISION_AUDIT — add a collision verdict before registering the tool`,
      ).toBeDefined();
      if (verdict?.collides) {
        expect(
          entry.extensionProbe,
          `probe "${entry.probe}" (${entry.id}) is audited as colliding but declares no extensionProbe to disambiguate (D21-SA21.7-04 class A)`,
        ).toBeDefined();
      }
    }
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
      // Functional Source License 1.1 with MIT future grant — a registered
      // SPDX id; used by charmbracelet/crush (Cycle 12 D21-SA21.7-05).
      "FSL-1.1-MIT",
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
      // sourceRepo: a GitHub, GitLab, or Gitea https VCS URL (never a docs
      // site). gitea.com joined the accepted hosts with the `tea` addition
      // (Cycle 12 D21-SA21.7-05): the first-party Gitea CLI is canonically
      // hosted on the Gitea forge itself, with no GitHub mirror documented.
      expect(entry.sourceRepo, `${entry.id} sourceRepo`).toBeTypeOf("string");
      expect(
        /^https:\/\/(?:github\.com|gitlab\.com|gitea\.com)\/[^/]+\/[^/]+/.test(entry.sourceRepo),
        `${entry.id} sourceRepo "${entry.sourceRepo}" must be a github.com/gitlab.com/gitea.com VCS URL`,
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

  it("web-project orders xh ahead of httpie so the picker surfaces the maintained client first (D21-SA21.4-02, Cycle 12)", () => {
    // Cycle 12 D21-SA21.4-02: httpie's upstream is dormant (last release 3.2.4,
    // 2024-11-01) while xh is actively maintained (v0.26.1, 2026-06-19). The
    // toolbox tells users to "prefer xh … for new web-project work", so xh is
    // listed before httpie in the web-project pre-check array. httpie is
    // retained (not dropped) so it stays installable/offered — the picker's
    // tier-2 offer surface (pickers.ts::pickCliTools) reads this same array.
    const web = TIER2_CLI_TOOLS_BY_TRIGGER["web-project"];
    expect(web).toContain("xh");
    expect(web).toContain("httpie");
    expect(web.indexOf("xh")).toBeLessThan(web.indexOf("httpie"));
    // playwright stays first (browser automation, orthogonal to the HTTP-client order).
    expect(web[0]).toBe("playwright");
  });
});

describe("TIER3_CLI_TOOLS", () => {
  it("has exactly 15 entries", () => {
    // 10 pre-Cycle-12 entries + the 5 CL-2 additions (D21-SA21.7-05):
    // crush, jaq, tombi, hurl, tea.
    expect(TIER3_CLI_TOOLS.length).toBe(15);
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
