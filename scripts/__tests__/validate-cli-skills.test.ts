import { describe, it, expect } from "vitest";

import {
  type Advisory,
  installBodyParityAdvisories,
  normalizeInstallCmd,
  parseInstallMatrix,
  referencesCurrencyAdvisories,
  standaloneSecuritySurfaceAdvisories,
} from "../validate-cli-skills.js";
import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../../src/cliTools/registry.js";

/**
 * Regression fixtures for the Cycle-12 advisory tier added to
 * `scripts/validate-cli-skills.ts` (D21-SA21.7-02 install-body + standalone
 * security-surface parity; D5-SA5.6-07 References currency). Each fixture pins
 * one of the 7 body-level drifts the structural gate shipped behind a green
 * "0 drift" summary, plus the by-design tolerances (substring, sudo-strip,
 * `same` shorthand) so a later graduate-to-`Failure` flip keeps the same
 * semantics.
 */

const gh = AVAILABLE_CLI_TOOLS.gh;
const ripgrep = AVAILABLE_CLI_TOOLS.ripgrep;
const jq = AVAILABLE_CLI_TOOLS.jq;
const fd = AVAILABLE_CLI_TOOLS.fd;
const docker = AVAILABLE_CLI_TOOLS.docker;
const rtk = AVAILABLE_CLI_TOOLS.rtk;
const difftastic = AVAILABLE_CLI_TOOLS.difftastic;
const astGrep = AVAILABLE_CLI_TOOLS["ast-grep"];
const stagehand = AVAILABLE_CLI_TOOLS.stagehand;
const delta = AVAILABLE_CLI_TOOLS.delta;

const kinds = (adv: Advisory[]): string[] => adv.map((a) => a.kind);

describe("normalizeInstallCmd", () => {
  it("strips leading and mid-string sudo and collapses whitespace", () => {
    expect(normalizeInstallCmd("sudo apt install git-delta")).toBe("apt install git-delta");
    expect(normalizeInstallCmd("x && sudo apt  install   y")).toBe("x && apt install y");
    expect(normalizeInstallCmd("  brew install gh  ")).toBe("brew install gh");
  });
});

describe("parseInstallMatrix", () => {
  const toolbox = [
    "Some intro table (a decoy backtick-id row before the marker):",
    "",
    "| `curl` | decoy-mac | decoy-linux |",
    "",
    "Install commands:",
    "",
    "| Tool | mac (`brew`) | linux (`apt` / other) |",
    "|------|--------------|------------------------|",
    "| `container-use` | `brew install dagger/tap/container-use` | `curl -fsSL https://x/install.sh \\| bash` |",
    "| `docker` | `brew install --cask docker` | `apt install docker.io` |",
    "",
    "## Next section",
    "| `podman` | not | parsed |",
  ].join("\n");

  it("parses only rows inside the Install-commands region", () => {
    const m = parseInstallMatrix(toolbox);
    expect(m.size).toBe(2);
    expect(m.has("curl")).toBe(false); // decoy row before the marker is ignored
    expect(m.has("podman")).toBe(false); // row after the next "## " heading is ignored
  });

  it("restores markdown-escaped pipes inside a cell", () => {
    const m = parseInstallMatrix(toolbox);
    expect(m.get("container-use")?.linux).toContain("| bash");
    expect(m.get("docker")?.linux).toContain("apt install docker.io");
  });
});

describe("installBodyParityAdvisories — standalone skills", () => {
  it("flags a standalone body whose linux install command drifted from the registry (gh, D21-SA21.5-02)", () => {
    const staleBody = [
      "Install (macOS): brew install gh",
      "Install (Linux): sudo apt install gh", // stale — registry now ships the signed keyring recipe
      "Install (Windows): winget install GitHub.cli",
    ].join("\n");
    const adv = installBodyParityAdvisories(gh, staleBody, undefined);
    expect(adv).toHaveLength(1);
    expect(adv[0].kind).toBe("install-body-parity");
    expect(adv[0].detail).toContain("linux");
  });

  it("passes a standalone body carrying every registry install command verbatim", () => {
    const body = [
      `mac: ${gh.install.mac[0].command}`,
      `linux: ${gh.install.linux[0].command}`,
      `win: ${gh.install.win[0].command}`,
    ].join("\n");
    expect(installBodyParityAdvisories(gh, body, undefined)).toHaveLength(0);
  });

  it("returns nothing when the standalone body is absent (structural check owns that)", () => {
    expect(installBodyParityAdvisories(gh, null, undefined)).toHaveLength(0);
  });
});

describe("installBodyParityAdvisories — toolbox install matrix", () => {
  const row = (mac: string, linux: string): { mac: string; linux: string } => ({ mac, linux });

  it("flags a functionally-wrong linux cell (docker apt vs get.docker.com, D21-SA21.6-08)", () => {
    const adv = installBodyParityAdvisories(docker, null, row("brew install --cask docker", "apt install docker.io"));
    expect(kinds(adv)).toEqual(["install-body-parity"]);
    expect(adv[0].detail).toContain("linux");
  });

  it("flags a non-command linux cell (rtk 'check upstream release', D21-SA21.6-08)", () => {
    const adv = installBodyParityAdvisories(rtk, null, row("brew install rtk-ai/tap/rtk", "check upstream release"));
    expect(kinds(adv)).toEqual(["install-body-parity"]);
  });

  it("flags a divergent flag drop (difftastic missing --locked, D21-SA21.2-04)", () => {
    const adv = installBodyParityAdvisories(difftastic, null, row("brew install difftastic", "cargo install difftastic"));
    expect(kinds(adv)).toEqual(["install-body-parity"]);
  });

  it("tolerates a superset cell via substring (ast-grep cell adds --locked over the registry, D21-SA21.1-05)", () => {
    const adv = installBodyParityAdvisories(astGrep, null, row("brew install ast-grep", "cargo install ast-grep --locked"));
    expect(adv).toHaveLength(0);
  });

  it("tolerates the sudo prefix divergence (delta registry has sudo, toolbox cell omits it)", () => {
    const adv = installBodyParityAdvisories(delta, null, row("brew install git-delta", "apt install git-delta (or download release)"));
    expect(adv).toHaveLength(0);
  });

  it("resolves a 'same' linux cell to the mac cell before comparing (stagehand)", () => {
    const adv = installBodyParityAdvisories(stagehand, null, row("npm install -g @browserbasehq/stagehand", "same"));
    expect(adv).toHaveLength(0);
  });

  it("flags a toolbox tool with no matrix row at all", () => {
    const adv = installBodyParityAdvisories(docker, null, undefined);
    expect(kinds(adv)).toEqual(["install-body-parity"]);
    expect(adv[0].detail).toContain("no row");
  });
});

describe("standaloneSecuritySurfaceAdvisories", () => {
  it("flags a body that omits the registry minVersion floor (ripgrep >=13.0.0)", () => {
    const adv = standaloneSecuritySurfaceAdvisories(ripgrep, "# ripgrep\nFast search. No security section here.");
    expect(kinds(adv)).toEqual(["standalone-security-surface"]);
    expect(adv[0].detail).toContain("13.0.0");
  });

  it("passes when the floor is surfaced and the tool has no securityNote (ripgrep)", () => {
    expect(standaloneSecuritySurfaceAdvisories(ripgrep, "Minimum recommended version: >=13.0.0.")).toHaveLength(0);
  });

  it("passes when both floor and a securityNote advisory id are surfaced (jq)", () => {
    const body = "Minimum recommended version: >=1.8.2. Fixes CVE-2026-32316 and siblings.";
    expect(standaloneSecuritySurfaceAdvisories(jq, body)).toHaveLength(0);
  });

  it("flags a securityNote whose advisory id / marker is absent from the body (gh)", () => {
    const adv = standaloneSecuritySurfaceAdvisories(gh, "gh CLI. Minimum recommended version: >=2.96.0.");
    expect(kinds(adv)).toEqual(["standalone-security-surface"]);
  });

  it("says nothing for a tool with neither minVersion nor securityNote (fd)", () => {
    expect(standaloneSecuritySurfaceAdvisories(fd, "# fd\nA find replacement.")).toHaveLength(0);
  });
});

describe("referencesCurrencyAdvisories", () => {
  it("flags an undated URL entry in a References section (D5-SA5.6-07)", () => {
    const body = ["## References", "", "- https://example.com/spec — vendor docs"].join("\n");
    const adv = referencesCurrencyAdvisories("skills/x/SKILL.md", body);
    expect(kinds(adv)).toEqual(["references-currency"]);
  });

  it("passes a dated References entry", () => {
    const body = ["## References", "", "- https://example.com/spec (accessed 2026-07-10; tier: official-docs)"].join("\n");
    expect(referencesCurrencyAdvisories("skills/x/SKILL.md", body)).toHaveLength(0);
  });

  it("passes a bare ISO-dated References entry with no 'accessed' keyword", () => {
    const body = ["## References", "", "- https://example.com/spec — 2026-07-10"].join("\n");
    expect(referencesCurrencyAdvisories("skills/x/SKILL.md", body)).toHaveLength(0);
  });

  it("flags a token-cost empirical claim with no References section (the 4 CLI skills)", () => {
    const body = "## Token Cost\n\ncode-execution-over-MCP yields 98.7% token reduction.";
    const adv = referencesCurrencyAdvisories("skills/hatch3r-cli-fd/SKILL.md", body);
    expect(kinds(adv)).toEqual(["references-currency"]);
    expect(adv[0].detail).toContain("References");
  });

  it("says nothing for a body with no References and no empirical claim", () => {
    expect(referencesCurrencyAdvisories("skills/x/SKILL.md", "# tool\nplain body")).toHaveLength(0);
  });
});

/**
 * Guard that the fixtures track the live registry: if a future registry edit
 * removes ripgrep's floor or gh's securityNote, these regression fixtures would
 * silently stop testing what they claim to. Pin the preconditions.
 */
describe("registry preconditions the fixtures rely on", () => {
  it("ripgrep pins a minVersion and carries no securityNote", () => {
    expect((ripgrep as CliToolMeta).minVersion).toBeTruthy();
    expect((ripgrep as CliToolMeta).securityNote).toBeUndefined();
  });
  it("gh and jq carry a securityNote", () => {
    expect((gh as CliToolMeta).securityNote).toBeTruthy();
    expect((jq as CliToolMeta).securityNote).toBeTruthy();
  });
  it("fd carries neither a minVersion nor a securityNote", () => {
    expect((fd as CliToolMeta).minVersion).toBeUndefined();
    expect((fd as CliToolMeta).securityNote).toBeUndefined();
  });
});
