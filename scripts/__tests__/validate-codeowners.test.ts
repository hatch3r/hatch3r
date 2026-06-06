import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findSingleOwnerShadows,
  formatFinding,
  parseCodeowners,
  runValidator,
} from "../validate-codeowners.js";

// ── Pure parser ───────────────────────────────────────────────────

describe("parseCodeowners", () => {
  it("drops comments and blank lines and tokenizes pattern + owners", () => {
    const rules = parseCodeowners(
      "# header\n" +
        "\n" +
        "* @a @b\n" +
        "src/merge/** @a   # critical path\n" +
        "   \n" +
        "# trailing comment\n",
    );
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ line: 3, pattern: "*", owners: ["@a", "@b"] });
    expect(rules[1]).toEqual({ line: 4, pattern: "src/merge/**", owners: ["@a"] });
  });

  it("ignores a whole-line comment that contains an @owner token", () => {
    expect(parseCodeowners("# was: * @a\n")).toHaveLength(0);
  });
});

// ── Shadow detection ──────────────────────────────────────────────

describe("findSingleOwnerShadows", () => {
  it("ERROR: the exact D4-6 case — two single-owner * lines drop the first owner", () => {
    const rules = parseCodeowners("* @denismasatovic\n* @vicdotdevelop\n");
    const findings = findSingleOwnerShadows("CODEOWNERS", rules);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].code).toBe("CODEOWNERS-SINGLE-OWNER-SHADOW");
    // Anchored on the last (winning) line.
    expect(findings[0].line).toBe(2);
    // Names the silently-dropped owner and steers to the union fix.
    expect(findings[0].message).toMatch(/@denismasatovic/);
    expect(findings[0].message).toMatch(/\* @denismasatovic @vicdotdevelop/);
  });

  it("PASS: a single union line for the same pattern is clean", () => {
    const rules = parseCodeowners("* @denismasatovic @vicdotdevelop\n");
    expect(findSingleOwnerShadows("CODEOWNERS", rules)).toHaveLength(0);
  });

  it("PASS: distinct patterns (more-specific shadowing broad) are intended last-match-wins", () => {
    const rules = parseCodeowners("* @a @b\nsrc/merge/** @a\n.github/workflows/** @a\n");
    expect(findSingleOwnerShadows("CODEOWNERS", rules)).toHaveLength(0);
  });

  it("INFO (not error): a redeclared pattern where one line already has ≥2 owners", () => {
    const rules = parseCodeowners("* @a @b\n* @c\n");
    const findings = findSingleOwnerShadows("CODEOWNERS", rules);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("info");
    expect(findings[0].code).toBe("CODEOWNERS-PATTERN-REDECLARED");
  });

  it("ERROR: three single-owner lines name all earlier dropped owners", () => {
    const rules = parseCodeowners("docs/** @a\ndocs/** @b\ndocs/** @c\n");
    const findings = findSingleOwnerShadows("CODEOWNERS", rules);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("error");
    expect(findings[0].message).toMatch(/@a, @b/);
    expect(findings[0].message).toMatch(/docs\/\*\* @a @b @c/);
  });
});

// ── runValidator over a temp repo root ────────────────────────────

describe("runValidator (temp root)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "codeowners-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ERROR: duplicate single-owner * lines in root CODEOWNERS fail the gate", async () => {
    await writeFile(join(dir, "CODEOWNERS"), "* @a\n* @b\n", "utf8");
    const result = await runValidator({ rootDir: dir });
    expect(result.activeFile).toBe("CODEOWNERS");
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("CODEOWNERS-SINGLE-OWNER-SHADOW");
  });

  it("respects location precedence: root CODEOWNERS wins over .github/CODEOWNERS", async () => {
    // Root file is clean; the .github copy is buggy. Only the root (first match)
    // is consulted, so the gate passes.
    await writeFile(join(dir, "CODEOWNERS"), "* @a @b\n", "utf8");
    await mkdir(join(dir, ".github"), { recursive: true });
    await writeFile(join(dir, ".github", "CODEOWNERS"), "* @a\n* @b\n", "utf8");
    const result = await runValidator({ rootDir: dir });
    expect(result.activeFile).toBe("CODEOWNERS");
    expect(result.errorCount).toBe(0);
  });

  it("checks .github/CODEOWNERS when no root file exists", async () => {
    await mkdir(join(dir, ".github"), { recursive: true });
    await writeFile(join(dir, ".github", "CODEOWNERS"), "* @a\n* @b\n", "utf8");
    const result = await runValidator({ rootDir: dir });
    expect(result.activeFile).toBe(".github/CODEOWNERS");
    expect(result.errorCount).toBe(1);
  });

  it("INFO (not error): an absent CODEOWNERS everywhere is benign", async () => {
    const result = await runValidator({ rootDir: dir });
    expect(result.activeFile).toBeNull();
    expect(result.errorCount).toBe(0);
    expect(result.infoCount).toBe(1);
    expect(result.findings[0].code).toBe("CODEOWNERS-ABSENT");
  });
});

// ── Real-corpus guard (the D4-6 regression assertion) ─────────────
// The shipped root CODEOWNERS, after the D4-6 fix, must carry 0
// single-owner-shadow errors. This is the value-asserting test: it would have
// FAILED on the pre-fix `* @a` / `* @b` two-line form and passes only with the
// collapsed union line.
describe("runValidator against the shipped CODEOWNERS", () => {
  it("the repo's active CODEOWNERS has 0 single-owner-shadow errors", async () => {
    const result = await runValidator();
    expect(result.activeFile).toBe("CODEOWNERS");
    expect(
      result.errorCount,
      result.findings.map(formatFinding).join("\n"),
    ).toBe(0);
    expect(result.ruleCount).toBeGreaterThan(0);
  });
});
