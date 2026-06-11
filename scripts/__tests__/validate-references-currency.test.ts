import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, formatFinding } from "../validate-references-currency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  skillsDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "ref-currency-validator-"));
  const skillsDir = join(rootDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  return { rootDir, skillsDir };
}

/** Write `skills/<name>/SKILL.md` with a minimal frontmatter + the given body. */
async function writeSkill(skillsDir: string, name: string, body: string): Promise<void> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  const fm = `---\nid: ${name}\nname: ${name}\ntype: skill\ndescription: A skill\ntags: [orchestration]\n---\n`;
  await writeFile(join(dir, "SKILL.md"), `${fm}\n${body}`, "utf-8");
}

const COMPLIANT_REFERENCES =
  "## References\n\n" +
  "- OWASP ASI — https://owasp.org/www-project-application-security-verification-standard/ (accessed 2026-06-02, OWASP, official-docs)\n" +
  "- Stryker Mutator — `stryker-mutator.io/docs/` (accessed 2026-06-02, Stryker, official-docs)\n";

describe("validate-references-currency — Check A (reference-line hygiene)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("does NOT flag a References block whose lines carry access date + trust tier", async () => {
    await writeSkill(fx.skillsDir, "hatch3r-clean", `# Clean\n\n${COMPLIANT_REFERENCES}`);

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.checkedSkills).toBe(1);
    expect(result.skillsWithReferences).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("WARNs REF-LINE-NO-DATE + REF-LINE-NO-TIER on a bare-URL reference line", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-bare",
      "# Bare\n\n## References\n\n- Stryker Mutator — `stryker-mutator.io/docs/`\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(2);
    const codes = result.findings.map((f) => f.code).sort();
    expect(codes).toEqual(["REF-LINE-NO-DATE", "REF-LINE-NO-TIER"]);
    expect(result.findings.every((f) => f.file.endsWith("hatch3r-bare/SKILL.md"))).toBe(true);
    expect(result.findings.every((f) => f.line > 0)).toBe(true);
  });

  it("WARNs REF-LINE-NO-TIER only when the date is present but the tier is missing", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-dateonly",
      "# DateOnly\n\n## References\n\n- Foo — https://example.com/foo (accessed 2026-06-02)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("REF-LINE-NO-TIER");
  });

  it("WARNs REF-LINE-NO-DATE only when the tier is present but the date is missing", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-tieronly",
      "# TierOnly\n\n## References\n\n- Foo — https://example.com/foo (OWASP, official-docs)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("REF-LINE-NO-DATE");
  });

  it("accepts the established-library and peer-reviewed-methodology corpus tiers", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-corpus-tiers",
      "# CorpusTiers\n\n## References\n\n" +
        "- Atlassian Team Charter — `atlassian.com/x` (accessed 2026-06-02, atlassian.com, established-library)\n" +
        "- Some Methodology — https://example.com/m (accessed 2026-06-02, Author, peer-reviewed-methodology)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings).toHaveLength(0);
  });

  it("accepts a `tier:` label form (vendor advisory style) as a trust tier", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-tier-label",
      "# TierLabel\n\n## References\n\n" +
        "- GHSA-x — https://github.com/cli/cli/security/advisories/GHSA-x (accessed 2026-06-06; tier: vendor advisory — GitHub CLI maintainers)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings).toHaveLength(0);
  });

  it("skips non-URL bullets inside a References block (prose sub-notes)", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-prose",
      "# Prose\n\n## References\n\n" +
        "- See the canonical source list in the parent rule for the full citation set.\n" +
        "- OWASP — https://owasp.org/ (accessed 2026-06-02, OWASP, official-docs)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings).toHaveLength(0);
  });

  it("stops the References block at the next ## heading", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-bounded",
      "# Bounded\n\n## References\n\n" +
        "- OWASP — https://owasp.org/ (accessed 2026-06-02, OWASP, official-docs)\n\n" +
        "## Appendix\n\n- A bare-URL line outside References — https://example.com/x\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    // The bare-URL line under ## Appendix is outside the References block and
    // must not be scanned by Check A.
    expect(result.findings).toHaveLength(0);
  });
});

describe("validate-references-currency — Check B (missing References block)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("WARNs REF-BLOCK-MISSING when a CVE id is asserted with no References block", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-cve",
      "# CVE\n\n## Security\n\nGHSA-8xvp-7hj6-mcj9 (CVE-2026-48501, High): upgrade before relying on the tool.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("REF-BLOCK-MISSING");
    expect(result.findings[0].line).toBe(0);
    expect(result.findings[0].message).toMatch(/CVE\/GHSA advisory id/);
  });

  it("WARNs REF-BLOCK-MISSING on a version-floor claim with no References block", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-floor",
      "# Floor\n\n## Security\n\nMinimum recommended version: `>=2.93.0`.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings.some((f) => f.code === "REF-BLOCK-MISSING")).toBe(true);
    expect(result.findings[0].message).toMatch(/version floor/);
  });

  it("WARNs REF-BLOCK-MISSING on a WCAG contrast ratio with no References block", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-wcag",
      "# WCAG\n\nText contrast must meet 4.5:1 for body copy.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings.some((f) => f.code === "REF-BLOCK-MISSING")).toBe(true);
    expect(result.findings[0].message).toMatch(/WCAG contrast ratio/);
  });

  it("does NOT flag REF-BLOCK-MISSING when an empirical-claim skill carries a References block", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-cve-cited",
      "# CVECited\n\n## Security\n\nCVE-2026-48501 (High): upgrade.\n\n" +
        "## References\n\n- GHSA-x — https://github.com/cli/cli/security/advisories/GHSA-x (accessed 2026-06-06, GitHub, official-docs)\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings.some((f) => f.code === "REF-BLOCK-MISSING")).toBe(false);
    expect(result.errorCount).toBe(0);
  });

  it("does NOT flag a skill with no empirical-claim markers and no References block", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-plain",
      "# Plain\n\nA single-pass procedure skill that asserts no platform claim.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings).toHaveLength(0);
  });
});

describe("validate-references-currency — discovery + contract", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns an empty result when the skills dir is missing", async () => {
    const result = await runValidator({ rootDir: join(fx.rootDir, "does-not-exist") });
    expect(result.checkedSkills).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("ignores a skill directory that has no SKILL.md", async () => {
    await mkdir(join(fx.skillsDir, "hatch3r-empty"), { recursive: true });

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.checkedSkills).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("never emits an error-level finding (warning-level gate)", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-bare",
      "# Bare\n\n## References\n\n- Foo — https://example.com/foo\n",
    );
    await writeSkill(
      fx.skillsDir,
      "hatch3r-cve",
      "# CVE\n\nCVE-2026-48501 with no References block.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.findings.every((f) => f.level === "warning")).toBe(true);
  });

  it("formatFinding renders a file:line locator for line-scoped findings and file-only for block-scoped", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-bare",
      "# Bare\n\n## References\n\n- Foo — https://example.com/foo\n",
    );
    await writeSkill(
      fx.skillsDir,
      "hatch3r-cve",
      "# CVE\n\nCVE-2026-48501 with no References block.\n",
    );

    const result = await runValidator({ rootDir: fx.rootDir });
    const lineScoped = result.findings.find((f) => f.line > 0)!;
    const blockScoped = result.findings.find((f) => f.line === 0)!;
    expect(formatFinding(lineScoped)).toMatch(/SKILL\.md:\d+:/);
    expect(formatFinding(blockScoped)).toMatch(/SKILL\.md: /);
    expect(formatFinding(blockScoped)).not.toMatch(/SKILL\.md:\d+:/);
  });
});

// ── Shipped-corpus regression gate ───────────────────────────────────
//
// The unit tests above use a tmpdir, so they never check the real `skills/`
// corpus. This block runs the validator with NO directory overrides — the
// same way `npm run validate:efficiency` runs it in CI — so it (a) proves the
// shipped corpus emits 0 ERROR-level findings (the warning gate's exit-0
// contract), and (b) asserts `checkedSkills > 0` so a path-resolution break
// that made the discovery walk return `[]` cannot pass green (nothing
// scanned ⇒ nothing flagged would otherwise hide the regression).
describe("validate-references-currency — shipped corpus", () => {
  it("the live skills/ corpus emits 0 error-level findings and scans >0 skills", async () => {
    const result = await runValidator({ rootDir: REPO_ROOT });
    const errors = result.findings.filter((f) => f.level === "error");
    expect(errors, errors.map((f) => `${f.code} ${f.file}`).join("\n")).toHaveLength(0);
    expect(result.checkedSkills).toBeGreaterThan(0);
    expect(result.skillsWithReferences).toBeGreaterThan(0);
  });
});
