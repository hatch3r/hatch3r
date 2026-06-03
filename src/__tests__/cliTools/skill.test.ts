import { describe, it, expect } from "vitest";
import { renderCliToolSkillBody } from "../../cliTools/skill.js";
import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../../cliTools/registry.js";

/**
 * Wave 5 Item 28: `src/cliTools/skill.ts::renderCliToolSkillBody` tests.
 *
 * Snapshots the body output for one tier-1 representative (fd) and
 * verifies RTK's caveat heading + `rtk proxy` mitigation appear in the
 * rendered output. Also checks the scaffold's placeholder
 * contract for non-caveat tools — Wave 4 cleanup replaces these inline,
 * but the renderer itself must continue to emit them so the generator
 * script remains idempotent.
 */

describe("renderCliToolSkillBody — fd (tier-1 representative)", () => {
  it("matches a stable inline snapshot for the mac OS path", () => {
    // fd is the minVersion-less / securityNote-less tier-1 representative for
    // the no-Security-section scaffold snapshot. (ripgrep was the prior
    // fixture but now carries a CVE-2021-3013 minVersion floor, which would
    // append a ## Security block.)
    const fd = AVAILABLE_CLI_TOOLS.fd as CliToolMeta;
    const body = renderCliToolSkillBody(fd, "mac");

    // Snapshot of the generator scaffold — Wave 4 swaps the three placeholder
    // sections with per-tool authored content; the wrapper structure (When
    // to Use, Token Cost, Recipes, Wrong Choice When, Alternatives,
    // Detection / Install, Homepage) is part of the contract.
    expect(body).toMatchInlineSnapshot(`
      "# fd

      User-friendly find replacement, gitignore-aware

      ## When to Use

      Reach for \`fd\` when the task is in the **search** category and the agent would otherwise call an MCP tool or read large outputs into context.

      ## Token Cost

      CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
      Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

      ## Recipes

      <placeholder — replaced in Wave 4>

      ## Wrong Choice When

      <placeholder — replaced in Wave 4>

      ## Alternatives

      <placeholder — replaced in Wave 4>

      ## Detection / Install

      Verify with:
      \`\`\`bash
      command -v fd
      \`\`\`

      Install (macOS — default for this machine):

      \`\`\`bash
      # brew
      brew install fd
      \`\`\`

      Install (Linux):

      \`\`\`bash
      # apt
      sudo apt install fd-find
      \`\`\`

      Install (Windows):

      \`\`\`bash
      # scoop
      scoop install fd
      \`\`\`

      Homepage: https://github.com/sharkdp/fd
      "
    `);
  });

  it("emits all three placeholder lines for non-caveat tools", () => {
    const jq = AVAILABLE_CLI_TOOLS.jq as CliToolMeta;
    const body = renderCliToolSkillBody(jq, "mac");
    // Renderer contract — Wave 2 emits structural placeholders that Wave 4
    // cleanup replaces with authored content. The renderer itself must
    // produce all three so re-running the generator on a Wave 2 build is
    // idempotent.
    const placeholderCount = (body.match(/<placeholder — replaced in Wave 4>/g) ?? []).length;
    expect(placeholderCount).toBe(3);
  });

  it("does NOT include the caveat heading for non-caveat tools", () => {
    const jq = AVAILABLE_CLI_TOOLS.jq as CliToolMeta;
    const body = renderCliToolSkillBody(jq, "mac");
    expect(body).not.toContain("⚠ Critical");
    expect(body).not.toContain("rtk proxy");
  });
});

describe("renderCliToolSkillBody — rtk (tier-3 with caveat)", () => {
  it("includes the ⚠ Critical heading and the verified `rtk proxy` mitigation", () => {
    const rtk = AVAILABLE_CLI_TOOLS.rtk as CliToolMeta;
    const body = renderCliToolSkillBody(rtk, "mac");

    expect(body).toContain("## ⚠ Critical: pipe-output corruption (issue #1282)");
    expect(body).toContain("rtk proxy");
    expect(body).toContain("https://github.com/rtk-ai/rtk/issues/1282");
    expect(body).not.toContain("RTK_DISABLE_PIPE_REWRITE");
  });

  it("places the caveat block BEFORE the When-to-Use section", () => {
    const rtk = AVAILABLE_CLI_TOOLS.rtk as CliToolMeta;
    const body = renderCliToolSkillBody(rtk, "mac");

    const caveatIdx = body.indexOf("## ⚠ Critical");
    const whenIdx = body.indexOf("## When to Use");

    expect(caveatIdx).toBeGreaterThanOrEqual(0);
    expect(whenIdx).toBeGreaterThan(caveatIdx);
  });
});

describe("renderCliToolSkillBody — Security section (F15.7-H7, Cycle 10 D15-SA15.7)", () => {
  it("renders a ## Security section surfacing securityNote + minVersion when present", () => {
    // jq carries both a securityNote and a minVersion floor — the generated
    // skill must surface them so the unsigned-channel / unpatched-version
    // context is not silently dropped next to the install recipe.
    const jq = AVAILABLE_CLI_TOOLS.jq as CliToolMeta;
    const body = renderCliToolSkillBody(jq, "mac");
    expect(body).toContain("## Security");
    expect(body).toContain("Minimum recommended version");
    expect(body).toContain(jq.minVersion as string);
    expect(body).toContain(jq.securityNote as string);
    // Security block sits after the install recipe, not before it.
    expect(body.indexOf("## Security")).toBeGreaterThan(body.indexOf("## Detection / Install"));
  });

  it("omits the ## Security section for tools with no securityNote or minVersion", () => {
    // fd has neither field — its body must stay free of the Security
    // heading so the no-advisory path is unchanged. (ripgrep now carries a
    // CVE-2021-3013 minVersion floor, so fd is the minVersion-less fixture.)
    const fd = AVAILABLE_CLI_TOOLS.fd as CliToolMeta;
    const body = renderCliToolSkillBody(fd, "mac");
    expect(body).not.toContain("## Security");
  });
});

describe("renderCliToolSkillBody — OS-specific install rendering", () => {
  it("renders linux install commands when currentOs is 'linux'", () => {
    // F15.7-H3 (Cycle 10): the renderer emits canonical OS labels and marks
    // the host OS as "default for this machine"; the Linux block carries that
    // suffix when currentOs is "linux".
    const ripgrep = AVAILABLE_CLI_TOOLS.ripgrep as CliToolMeta;
    const body = renderCliToolSkillBody(ripgrep, "linux");
    expect(body).toContain("Install (Linux — default for this machine):");
    expect(body).toContain("sudo apt install ripgrep");
  });

  it("renders win install commands when currentOs is 'win'", () => {
    // F15.7-H3 (Cycle 10): canonical "Windows" label, marked default when
    // currentOs is "win".
    const ripgrep = AVAILABLE_CLI_TOOLS.ripgrep as CliToolMeta;
    const body = renderCliToolSkillBody(ripgrep, "win");
    expect(body).toContain("Install (Windows — default for this machine):");
    expect(body).toContain("scoop install ripgrep");
  });
});

describe("renderCliToolSkillBody — common contract", () => {
  it("emits every required section heading for every tier-1 tool", () => {
    const required = [
      "## When to Use",
      "## Token Cost",
      "## Recipes",
      "## Wrong Choice When",
      "## Alternatives",
      "## Detection / Install",
    ];
    for (const entry of Object.values(AVAILABLE_CLI_TOOLS) as readonly CliToolMeta[]) {
      if (entry.tier !== 1) continue;
      const body = renderCliToolSkillBody(entry, "mac");
      for (const heading of required) {
        expect(body, `${entry.id}: missing ${heading}`).toContain(heading);
      }
    }
  });

  it("uses the probe binary name in the Detection block", () => {
    // astgrep's probe is "sg" while id is "ast-grep" — Detection block must
    // tell the user to verify with the binary name they actually invoke.
    const astGrep = AVAILABLE_CLI_TOOLS["ast-grep"] as CliToolMeta;
    const body = renderCliToolSkillBody(astGrep, "mac");
    expect(body).toContain("command -v sg");
  });
});
