import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_SEVERITIES,
  MAPPING_REF,
  OFF_CANONICAL_TERMS,
  findFrontmatterRange,
  findStructuredMatches,
  formatFinding,
  hasMappingReference,
  isOffCanonical,
  runValidator,
  scanFileContent,
} from "../validate-severity-vocabulary.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p5-severity-vocab-"));
  return { rootDir };
}

async function seedFile(rootDir: string, relPath: string, content: string): Promise<void> {
  const abs = join(rootDir, relPath);
  await mkdir(join(abs, "..").replace(/\/?$/, ""), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

// Single scan dir used by most tests so we don't depend on the full default set.
const ONE_DIR = ["agents"] as const;

describe("validate-severity-vocabulary", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Canonical vocabulary constants ──────────────────────────────

  describe("vocabulary constants", () => {
    it("declares all 5 canonical severity buckets in the same order as AUDIT.md", () => {
      expect(CANONICAL_SEVERITIES).toEqual([
        "Critical",
        "High",
        "Medium",
        "Low",
        "Info",
      ]);
    });

    it("enumerates the off-canonical terms documented in severity-mapping.md", () => {
      // Smoke check: WCAG (Major/Minor), CVSS (Moderate), legacy slang
      // (Blocker, Showstopper) must all be flagged when off-canonical.
      for (const t of ["Moderate", "Major", "Minor", "Blocker", "Showstopper"]) {
        expect(OFF_CANONICAL_TERMS.map((s) => s.toLowerCase())).toContain(
          t.toLowerCase(),
        );
      }
    });

    it("points at severity-mapping.md as the documented opt-out reference", () => {
      expect(MAPPING_REF).toBe("severity-mapping.md");
    });
  });

  // ── isOffCanonical classifier ───────────────────────────────────

  describe("isOffCanonical", () => {
    it("returns false for every canonical bucket (any casing)", () => {
      for (const s of CANONICAL_SEVERITIES) {
        expect(isOffCanonical(s)).toBe(false);
        expect(isOffCanonical(s.toLowerCase())).toBe(false);
        expect(isOffCanonical(s.toUpperCase())).toBe(false);
      }
    });

    it("returns true for documented off-canonical terms (any casing)", () => {
      for (const s of OFF_CANONICAL_TERMS) {
        expect(isOffCanonical(s)).toBe(true);
        expect(isOffCanonical(s.toLowerCase())).toBe(true);
      }
    });

    it("returns false for words that are not severity tokens at all", () => {
      expect(isOffCanonical("ImplementerAgent")).toBe(false);
      expect(isOffCanonical("PASS")).toBe(false);
    });
  });

  // ── Frontmatter range detection ─────────────────────────────────

  describe("findFrontmatterRange", () => {
    it("returns the open/close indices when the document opens with `---`", () => {
      const lines = ["---", "id: foo", "type: agent", "---", "# Body"];
      expect(findFrontmatterRange(lines)).toEqual({ open: 0, close: 3 });
    });

    it("returns null when the file does not start with `---`", () => {
      const lines = ["# Body", "Text"];
      expect(findFrontmatterRange(lines)).toBeNull();
    });

    it("returns null when an opening `---` has no closing fence", () => {
      const lines = ["---", "id: foo"];
      expect(findFrontmatterRange(lines)).toBeNull();
    });
  });

  // ── findStructuredMatches per emission style ────────────────────

  describe("findStructuredMatches", () => {
    it("detects `severity: <Term>` inside frontmatter", () => {
      const ms = findStructuredMatches("severity: Critical", true);
      expect(ms).toEqual([
        expect.objectContaining({ word: "Critical", reason: "frontmatter" }),
      ]);
    });

    it("detects quoted frontmatter values", () => {
      const ms = findStructuredMatches(`level: "High"`, true);
      expect(ms[0]?.word).toBe("High");
      expect(ms[0]?.reason).toBe("frontmatter");
    });

    it("ignores frontmatter labels that are not severity-related", () => {
      const ms = findStructuredMatches("tags: [Critical]", true);
      // The tags line is not a severity pair, so frontmatter detection misses it
      // (and the function does not run body checks when inFrontmatter=true).
      expect(ms).toEqual([]);
    });

    it("detects bracket tags like `[CRITICAL]` in body lines", () => {
      const ms = findStructuredMatches("Output marker: [CRITICAL] gate fail.", false);
      expect(ms.length).toBeGreaterThanOrEqual(1);
      expect(ms.some((m) => m.reason === "bracket-tag" && /critical/i.test(m.word))).toBe(true);
    });

    it("detects multiple bracket tags on the same line", () => {
      const ms = findStructuredMatches("Use [CRITICAL] or [RECOMMENDED] -- [LOW] otherwise.", false);
      // 2 of the 3 are severity tokens — `RECOMMENDED` is not severity.
      const tags = ms.filter((m) => m.reason === "bracket-tag").map((m) => m.word.toLowerCase());
      expect(tags).toEqual(expect.arrayContaining(["critical", "low"]));
    });

    it("detects labeled-pair body lines like `Severity: Major`", () => {
      const ms = findStructuredMatches("Severity: Major (WCAG AA blocker)", false);
      expect(ms.some((m) => m.reason === "labeled-pair" && m.word === "Major")).toBe(true);
    });

    it("detects bolded labeled pairs (`**Severity:** **High**`)", () => {
      const ms = findStructuredMatches("**Severity:** **High**", false);
      expect(ms.some((m) => m.reason === "labeled-pair" && m.word === "High")).toBe(true);
    });

    it("detects list-prefix severities under a Severity heading", () => {
      const ms = findStructuredMatches(
        "- **Critical**: blocks correct operation",
        false,
        { tableSeverityColumns: null, underSeverityHeading: true },
      );
      expect(ms.some((m) => m.reason === "list-prefix" && m.word === "Critical")).toBe(true);
    });

    it("does NOT flag list prefixes outside a Severity heading", () => {
      // SemVer Major/Minor under `## Semantic Versioning` is the canonical
      // false-positive shape the validator must suppress.
      const ms = findStructuredMatches(
        "- **Major:** Breaking changes (API, data model, config)",
        false,
        { tableSeverityColumns: null, underSeverityHeading: false },
      );
      expect(ms.filter((m) => m.reason === "list-prefix")).toEqual([]);
    });

    it("detects markdown table cells where the column header is severity-labeled", () => {
      // Column 1 (the second column, 0-indexed = 1) is the Severity column.
      const ms = findStructuredMatches("| Foo | High | Description |", false, {
        tableSeverityColumns: [1],
        underSeverityHeading: false,
      });
      expect(ms.some((m) => m.reason === "table-cell" && m.word === "High")).toBe(true);
    });

    it("detects bolded table cells `| **Critical** |` when the column is a severity column", () => {
      const ms = findStructuredMatches(
        "| File | **Critical** | Block release |",
        false,
        { tableSeverityColumns: [1], underSeverityHeading: false },
      );
      expect(ms.some((m) => m.reason === "table-cell" && m.word === "Critical")).toBe(true);
    });

    it("does NOT flag table cells when no severity column was declared", () => {
      const ms = findStructuredMatches("| Blocker | Impact | Fix Effort |", false, {
        tableSeverityColumns: null,
        underSeverityHeading: false,
      });
      expect(ms.filter((m) => m.reason === "table-cell")).toEqual([]);
    });

    it("emits only the cells under labeled severity columns (row-noun guard)", () => {
      // Column 0 ("Blocker") is the row noun. Column 1 is the Severity column.
      // The detector must emit at most one match (column 1 = "High"); the
      // "Blocker" cell at column 0 must NOT be reported.
      const ms = findStructuredMatches("| Blocker | High | Effort |", false, {
        tableSeverityColumns: [1],
        underSeverityHeading: false,
      });
      const tableCells = ms.filter((m) => m.reason === "table-cell");
      expect(tableCells.map((m) => m.word)).toEqual(["High"]);
    });

    it("skips markdown table separator rows", () => {
      // The separator row `| --- | --- |` must not produce matches.
      expect(
        findStructuredMatches("| --- | --- | --- |", false, {
          tableSeverityColumns: [1],
          underSeverityHeading: false,
        }),
      ).toEqual([]);
    });

    it("does NOT flag plain prose containing severity words", () => {
      // The phrase "critical path" is general English, not a severity emission.
      expect(findStructuredMatches("This is on the critical path of the build.", false)).toEqual([]);
      expect(findStructuredMatches("a minor enhancement", false)).toEqual([]);
    });
  });

  // ── hasMappingReference ─────────────────────────────────────────

  it("hasMappingReference returns true when the body cites severity-mapping.md", () => {
    expect(hasMappingReference("see [mapping](../severity-mapping.md) for details")).toBe(true);
    expect(hasMappingReference("no mapping in this string")).toBe(false);
  });

  // ── scanFileContent end-to-end ───────────────────────────────────

  describe("scanFileContent", () => {
    it("returns no off-canonical entries when only canonical buckets are emitted", () => {
      const md = [
        "---",
        "severity: Critical",
        "---",
        "# Doc",
        "",
        "| Item | Severity |",
        "| ---  | ---      |",
        "| A    | Critical |",
        "| B    | High     |",
        "| C    | Medium   |",
        "| D    | Low      |",
        "| E    | Info     |",
      ].join("\n");
      const r = scanFileContent(md);
      expect(r.offCanonical).toEqual([]);
    });

    it("collects multiple off-canonical occurrences with line numbers and reasons", () => {
      const md = [
        "# Doc",
        "",
        "## Severity Cataloging", // makes list-prefix under a severity heading
        "",
        "Severity: Moderate",
        "- **Major**: WCAG AA blocker",
        "",
        "| File | Severity |",
        "| ---  | ---      |",
        "| A    | Trivial  |",
      ].join("\n");
      const r = scanFileContent(md);
      const reasons = r.offCanonical.map((o) => o.reason).sort();
      expect(reasons).toEqual(["labeled-pair", "list-prefix", "table-cell"].sort());
      // Line numbers are 1-based.
      expect(r.offCanonical.find((o) => o.word === "Moderate")?.line).toBe(5);
      expect(r.offCanonical.find((o) => o.word === "Major")?.line).toBe(6);
      expect(r.offCanonical.find((o) => o.word === "Trivial")?.line).toBe(10);
    });

    it("reports off-canonical emissions even when the mapping is referenced (gating happens at orchestrator)", () => {
      // scanFileContent does not decide the verdict — it just enumerates.
      const md = [
        "# Doc — see [mapping](../severity-mapping.md)",
        "Severity: Major",
      ].join("\n");
      const r = scanFileContent(md);
      expect(r.hasMapping).toBe(true);
      expect(r.offCanonical.length).toBeGreaterThan(0);
    });
  });

  // ── runValidator: happy path ─────────────────────────────────────

  it("PASSes when every scanned file emits only canonical severity terms", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-clean.md",
      [
        "---",
        "id: hatch3r-clean",
        "type: agent",
        "severity: Critical",
        "---",
        "# Clean Agent",
        "",
        "| Item | Severity |",
        "| ---  | ---      |",
        "| A    | High     |",
        "| B    | Medium   |",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  // ── runValidator: off-canonical without mapping reference ───────

  it("ERRORs on off-canonical severity term with no mapping reference", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-bad.md",
      [
        "---",
        "id: hatch3r-bad",
        "type: agent",
        "---",
        "# Bad Agent",
        "",
        "Severity: Moderate",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBeGreaterThanOrEqual(2);
    // Aggregate file-level finding.
    expect(r.findings.some((f) => f.code === "SEVERITY-MAPPING-MISS")).toBe(true);
    // Per-occurrence finding with line + line number set.
    const off = r.findings.find((f) => f.code === "SEVERITY-OFF-CANONICAL");
    expect(off).toBeDefined();
    expect(off?.line).toBe(7);
    expect(off?.file).toMatch(/agents\/hatch3r-bad\.md$/);
    expect(off?.message).toMatch(/Moderate/);
    expect(off?.message).toMatch(/severity-mapping\.md/);
  });

  it("ERRORs on each off-canonical occurrence on its own line", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-multi.md",
      [
        "# Doc",
        "",
        "## Severity Cataloging",
        "",
        "Severity: Major",
        "- **Minor**: WCAG advisory",
        "",
        "| File | Severity |",
        "| ---  | ---      |",
        "| A    | Trivial  |",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    const perOcc = r.findings.filter((f) => f.code === "SEVERITY-OFF-CANONICAL");
    expect(perOcc.length).toBe(3);
    expect(perOcc.map((f) => f.line).sort()).toEqual([10, 5, 6]);
  });

  // ── runValidator: off-canonical WITH mapping reference (allowed) ─

  it("ALLOWs off-canonical severity terms when the file references severity-mapping.md", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-a11y-auditor.md",
      [
        "---",
        "id: hatch3r-a11y-auditor",
        "type: agent",
        "---",
        "# A11y Auditor",
        "",
        "> Severity vocabulary: see [mapping](../governance/audit/templates/severity-mapping.md).",
        "",
        "## Severity Output",
        "",
        "Severity: Major",
        "- **Minor**: advisory issue",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.filesScanned).toBe(1);
  });

  // ── runValidator: SemVer Major/Minor false-positive guard ───────

  it("does NOT flag SemVer Major/Minor lists under a versioning heading (false-positive guard)", async () => {
    await mkdir(join(fx.rootDir, "skills"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "skills/release.md",
      [
        "# Release",
        "",
        "## Semantic Versioning",
        "",
        "- **Major:** Breaking changes (API, data model, config)",
        "- **Minor:** New features, backward-compatible",
        "- **Patch:** Bug fixes",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["skills"] });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
  });

  // ── runValidator: row-noun "Blocker" cell guard ─────────────────

  it("does NOT flag row-noun cells in tables that lack a Severity column", async () => {
    await mkdir(join(fx.rootDir, "commands"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "commands/roadmap.md",
      [
        "# Roadmap",
        "",
        "### Production Readiness Blockers",
        "| Blocker | Business Impact | Fix Effort | Deadline |",
        "|---------|----------------|-----------|----------|",
        "| auth flow | login broken | M | 2026-06-01 |",
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ["commands"] });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
  });

  // ── runValidator: prose containing "critical path" stays clean ──

  it("does NOT flag plain prose like 'critical path' or 'minor improvement'", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-prose.md",
      [
        "# Prose Doc",
        "",
        "The implementer agent stays on the critical path of the build.",
        "We treat this as a minor improvement deferred to next cycle.",
        "Moderate confidence in the result.", // ← would be a problem if it were structured, but it is prose.
      ].join("\n"),
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.findings).toEqual([]);
  });

  // ── runValidator: multiple directories scanned ──────────────────

  it("scans every requested directory and aggregates findings", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await mkdir(join(fx.rootDir, "checks"), { recursive: true });

    await seedFile(
      fx.rootDir,
      "agents/hatch3r-clean.md",
      "---\nid: clean\n---\n# OK\n\nSeverity: High\n",
    );
    await seedFile(
      fx.rootDir,
      "checks/check-bad.md",
      "# Check\n\nSeverity: Moderate\n",
    );

    const r = await runValidator({
      rootDir: fx.rootDir,
      scannedDirs: ["agents", "checks"],
    });

    expect(r.filesScanned).toBe(2);
    expect(r.errorCount).toBeGreaterThanOrEqual(2);
    expect(r.findings.find((f) => f.file.includes("check-bad.md"))).toBeDefined();
    expect(r.findings.every((f) => !f.file.includes("hatch3r-clean.md"))).toBe(true);
  });

  // ── runValidator: missing dir is tolerated ──────────────────────

  it("silently skips scanned directories that do not exist", async () => {
    // No directories seeded; the validator must not throw.
    const r = await runValidator({
      rootDir: fx.rootDir,
      scannedDirs: ["does-not-exist"],
    });
    expect(r.filesScanned).toBe(0);
    expect(r.errorCount).toBe(0);
  });

  // ── runValidator: deeply nested .md files ───────────────────────

  it("recurses into nested subdirectories (e.g., agents/modes/)", async () => {
    await mkdir(join(fx.rootDir, "agents", "modes"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/modes/some-mode.md",
      "# Mode\n\nSeverity: Blocker\n",
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBeGreaterThanOrEqual(2);
    expect(
      r.findings.some(
        (f) => f.code === "SEVERITY-OFF-CANONICAL" && /modes/.test(f.file),
      ),
    ).toBe(true);
  });

  // ── runValidator: hidden / dot directories skipped ──────────────

  it("skips dot-prefixed directories (e.g. `.audit-workspace`)", async () => {
    await mkdir(join(fx.rootDir, "agents", ".transient"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/.transient/note.md",
      "Severity: Moderate\n",
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    expect(r.errorCount).toBe(0);
    expect(r.filesScanned).toBe(0);
  });

  // ── Frontmatter off-canonical detection ────────────────────────

  it("ERRORs on off-canonical severity in frontmatter without mapping reference", async () => {
    await mkdir(join(fx.rootDir, "agents"), { recursive: true });
    await seedFile(
      fx.rootDir,
      "agents/hatch3r-fm-bad.md",
      "---\nid: bad\nseverity: Blocker\n---\n# Doc\n",
    );

    const r = await runValidator({ rootDir: fx.rootDir, scannedDirs: ONE_DIR });
    const off = r.findings.find(
      (f) => f.code === "SEVERITY-OFF-CANONICAL" && /Blocker/.test(f.message),
    );
    expect(off).toBeDefined();
    expect(off?.message).toMatch(/frontmatter/);
  });

  // ── Output formatter ───────────────────────────────────────────

  it("formatFinding renders ERROR / WARN tag, file, and message", () => {
    const txt = formatFinding({
      level: "error",
      code: "SEVERITY-OFF-CANONICAL",
      file: "agents/hatch3r-bad.md",
      line: 7,
      message: 'off-canonical "Moderate" in labeled-pair',
    });
    expect(txt).toContain("ERROR");
    expect(txt).toContain("SEVERITY-OFF-CANONICAL");
    expect(txt).toContain("agents/hatch3r-bad.md:7");
    expect(txt).toContain("Moderate");
  });
});
