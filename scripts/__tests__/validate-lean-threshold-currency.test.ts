import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  diffAgainstConstitution,
  extractClaudeRows,
  extractConstitutionRows,
  extractRuleRows,
  formatDrift,
  normalizeKey,
  normalizeLimit,
  runValidator,
} from "../validate-lean-threshold-currency.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "lean-threshold-currency-"));
  await mkdir(join(rootDir, "governance"), { recursive: true });
  await mkdir(join(rootDir, ".claude", "rules"), { recursive: true });
  return { rootDir };
}

/**
 * Minimal CONSTITUTION fixture with `#### Lean Thresholds` table inside
 * a §2 P5 region. Constitution rows are tab "| Metric | Limit | Calibration |".
 */
function buildConstitution(
  rows: Array<{ metric: string; limit: string; calibration?: string }>,
): string {
  let body = `# Constitution

## 2. The 8 Binding Pillars

### P5. Governance Self-Quality

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
`;
  for (const r of rows) {
    body += `| ${r.metric} | ${r.limit} | ${r.calibration ?? ""} |\n`;
  }
  body += `
#### Anti-Bloat Principles

1. Single source of truth.
`;
  return body;
}

function buildRule(rows: Array<{ file: string; limit: string }>): string {
  let body = `# Governance Lean Thresholds

**Pillars:** P5, P4

| File | Limit |
|------|-------|
`;
  for (const r of rows) {
    body += `| ${r.file} | ${r.limit} |\n`;
  }
  return body;
}

function buildClaudeMd(rows: Array<{ metric: string; limit: string }>): string {
  let body = `# CLAUDE

## Lean Thresholds

From CONSTITUTION §2 P5:

| Metric | Limit |
|--------|-------|
`;
  for (const r of rows) {
    body += `| ${r.metric} | ${r.limit} |\n`;
  }
  return body;
}

async function seedFiles(
  rootDir: string,
  opts: {
    constitution: string;
    rule: string;
    claudeMd: string;
  },
): Promise<void> {
  await writeFile(
    join(rootDir, "governance", "CONSTITUTION.md"),
    opts.constitution,
    "utf-8",
  );
  await writeFile(
    join(rootDir, ".claude", "rules", "governance-lean-thresholds.md"),
    opts.rule,
    "utf-8",
  );
  await writeFile(join(rootDir, "CLAUDE.md"), opts.claudeMd, "utf-8");
}

// ── normalizeKey ────────────────────────────────────────────────────

describe("normalizeKey", () => {
  it("strips backticks", () => {
    expect(normalizeKey("`CONSTITUTION.md`")).toBe("constitution.md");
  });

  it("strips leading governance/ prefix", () => {
    expect(normalizeKey("`governance/CONSTITUTION.md`")).toBe("constitution.md");
    expect(normalizeKey("governance/AUDIT.md")).toBe("audit.md");
  });

  it("lowercases", () => {
    expect(normalizeKey("AUDIT.MD")).toBe("audit.md");
  });

  it("collapses domain-file aliases", () => {
    expect(normalizeKey("Domain files (`governance/audit/domains/D*.md`)")).toBe(
      "domain files",
    );
    expect(normalizeKey("Domain file")).toBe("domain files");
  });

  it("collapses checklist-items synonym", () => {
    expect(normalizeKey("Checklist items per sub-agent")).toBe(
      "checklist items/sa",
    );
    expect(normalizeKey("Checklist items/sub-agent")).toBe(
      "checklist items/sa",
    );
  });

  it("strips trailing parenthetical qualifications", () => {
    expect(normalizeKey("CONSTITUTION.md (Cursor)")).toBe("constitution.md");
  });

  it("preserves distinguishing precedence qualifiers on rules/*.md", () => {
    // Cycle 10 Wave 1G: the unrestricted strip used to collapse these two
    // canonical rows into a single key, which then dropped one row via
    // last-insert-wins in `diffAgainstConstitution`'s map. Preserve them.
    expect(normalizeKey("rules/*.md (precedence: critical or high)")).toBe(
      "rules/*.md (precedence: critical or high)",
    );
    expect(normalizeKey("rules/*.md (precedence: normal or low)")).toBe(
      "rules/*.md (precedence: normal or low)",
    );
    // Backticked + governance-prefixed form normalizes to the same key.
    expect(normalizeKey("`rules/*.md` (precedence: critical or high)")).toBe(
      "rules/*.md (precedence: critical or high)",
    );
  });

  it("preserves distinguishing SA-bound qualifiers on Domain file rows", () => {
    expect(normalizeKey("Domain file (SA ≤5)")).toBe("domain files (sa ≤5)");
    expect(normalizeKey("Domain file (SA >5)")).toBe("domain files (sa >5)");
    // ASCII bound forms also accepted.
    expect(normalizeKey("Domain file (SA <= 5)")).toBe("domain files (sa ≤5)");
    expect(normalizeKey("Domain file (SA >= 8)")).toBe("domain files (sa >8)");
  });

  it("Domain file with no SA qualifier still collapses to plural form", () => {
    expect(normalizeKey("Domain file")).toBe("domain files");
    expect(normalizeKey("Domain files")).toBe("domain files");
  });
});

// ── normalizeLimit ──────────────────────────────────────────────────

describe("normalizeLimit", () => {
  it("strips backticks and collapses whitespace", () => {
    expect(normalizeLimit("`<=225` lines")).toBe("<=225 lines");
    expect(normalizeLimit("  <=225    lines  ")).toBe("<=225 lines");
  });

  it("is comparison-symmetric: matching values normalize equal", () => {
    expect(normalizeLimit("<=225 lines")).toBe(normalizeLimit("`<=225` lines"));
  });
});

// ── extractConstitutionRows ─────────────────────────────────────────

describe("extractConstitutionRows", () => {
  it("extracts every row under #### Lean Thresholds heading", () => {
    const body = buildConstitution([
      { metric: "CONSTITUTION.md", limit: "<=250 lines", calibration: "+25 per pillar" },
      { metric: "AUDIT.md", limit: "<=600 lines", calibration: "±4 per domain" },
    ]);
    const rows = extractConstitutionRows(body);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("constitution.md");
    expect(rows[0].limit).toBe("<=250 lines");
    expect(rows[1].key).toBe("audit.md");
    expect(rows[1].limit).toBe("<=600 lines");
  });

  it("returns [] when the Lean Thresholds heading is missing", () => {
    const body = `# Constitution\n\n## 2. Pillars\nNo lean table.\n`;
    expect(extractConstitutionRows(body)).toEqual([]);
  });

  it("stops at the next sub-heading after Lean Thresholds", () => {
    const body = `# C\n\n#### Lean Thresholds\n\n| Metric | Limit | Calibration |\n|--------|-------|-------------|\n| A | 1 | x |\n| B | 2 | y |\n\n#### Anti-Bloat\n| Z | 99 | should-not-appear |\n`;
    const rows = extractConstitutionRows(body);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

// ── extractRuleRows + extractClaudeRows ─────────────────────────────

describe("extractRuleRows", () => {
  it("extracts rows under # Governance Lean Thresholds heading", () => {
    const body = buildRule([
      { file: "`governance/CONSTITUTION.md`", limit: "<=225 lines" },
      { file: "`governance/AUDIT.md`", limit: "<=600 lines" },
    ]);
    const rows = extractRuleRows(body);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("constitution.md");
    expect(rows[0].limit).toBe("<=225 lines");
  });
});

describe("extractClaudeRows", () => {
  it("extracts rows under ## Lean Thresholds heading", () => {
    const body = buildClaudeMd([
      { metric: "CONSTITUTION.md", limit: "<=225 lines" },
      { metric: "AUDIT.md", limit: "<=600 lines" },
    ]);
    const rows = extractClaudeRows(body);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("constitution.md");
    expect(rows[0].limit).toBe("<=225 lines");
  });

  it("returns [] when no ## Lean Thresholds heading present", () => {
    const body = `# CLAUDE\n\nNo lean section.\n`;
    expect(extractClaudeRows(body)).toEqual([]);
  });
});

// ── diffAgainstConstitution ─────────────────────────────────────────

describe("diffAgainstConstitution", () => {
  it("returns [] when all downstream Limits match canonical", () => {
    const constitutionRows = extractConstitutionRows(
      buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
        { metric: "AUDIT.md", limit: "<=600 lines" },
      ]),
    );
    const downstream = extractRuleRows(
      buildRule([
        { file: "`governance/CONSTITUTION.md`", limit: "<=250 lines" },
        { file: "`governance/AUDIT.md`", limit: "<=600 lines" },
      ]),
    );
    const drifts = diffAgainstConstitution(
      ".claude/rules/governance-lean-thresholds.md",
      downstream,
      constitutionRows,
    );
    expect(drifts).toEqual([]);
  });

  it("flags LEAN-THRESHOLD-LIMIT-DRIFT on diverging Limit text", () => {
    const constitutionRows = extractConstitutionRows(
      buildConstitution([{ metric: "CONSTITUTION.md", limit: "<=250 lines" }]),
    );
    const downstream = extractRuleRows(
      buildRule([{ file: "`governance/CONSTITUTION.md`", limit: "<=225 lines" }]),
    );
    const drifts = diffAgainstConstitution(
      ".claude/rules/governance-lean-thresholds.md",
      downstream,
      constitutionRows,
    );
    const drift = drifts.find((d) => d.code === "LEAN-THRESHOLD-LIMIT-DRIFT");
    expect(drift).toBeDefined();
    expect(drift!.message).toContain("<=225");
    expect(drift!.message).toContain("<=250");
  });

  it("flags LEAN-THRESHOLD-UNKNOWN-ROW as warning when downstream key unknown", () => {
    const constitutionRows = extractConstitutionRows(
      buildConstitution([{ metric: "CONSTITUTION.md", limit: "<=250 lines" }]),
    );
    const downstream = extractRuleRows(
      buildRule([{ file: "Unknown row", limit: "<=10" }]),
    );
    const drifts = diffAgainstConstitution(
      ".claude/rules/governance-lean-thresholds.md",
      downstream,
      constitutionRows,
    );
    const warn = drifts.find((d) => d.code === "LEAN-THRESHOLD-UNKNOWN-ROW");
    expect(warn).toBeDefined();
    expect(warn!.level).toBe("warning");
  });

  it("does NOT flag CONSTITUTION rows that are absent from the downstream table", () => {
    // Downstream subset; absent CONSTITUTION rows are fine — the contract is
    // "if you reference a Constitution row, the Limit must match."
    const constitutionRows = extractConstitutionRows(
      buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
        { metric: "AUDIT.md", limit: "<=600 lines" },
        { metric: "VISION.md", limit: "<=250 lines" },
      ]),
    );
    const downstream = extractRuleRows(
      buildRule([{ file: "`governance/CONSTITUTION.md`", limit: "<=250 lines" }]),
    );
    const drifts = diffAgainstConstitution(
      ".claude/rules/governance-lean-thresholds.md",
      downstream,
      constitutionRows,
    );
    expect(drifts).toEqual([]);
  });
});

// ── runValidator (end-to-end via tmpdir fixtures) ───────────────────

describe("runValidator (lean-threshold-currency)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns 0 errors when CONSTITUTION + rule + CLAUDE.md agree", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
        { metric: "AUDIT.md", limit: "<=600 lines" },
      ]),
      rule: buildRule([
        { file: "`governance/CONSTITUTION.md`", limit: "<=250 lines" },
        { file: "`governance/AUDIT.md`", limit: "<=600 lines" },
      ]),
      claudeMd: buildClaudeMd([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
        { metric: "AUDIT.md", limit: "<=600 lines" },
      ]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.constitutionRowCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.drifts).toEqual([]);
  });

  it("flags drift in rule file when Constitution moves CONSTITUTION.md ≤225 → ≤250", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
      ]),
      rule: buildRule([
        { file: "`governance/CONSTITUTION.md`", limit: "<=225 lines" }, // stale
      ]),
      claudeMd: buildClaudeMd([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
      ]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    const drift = result.drifts.find(
      (d) =>
        d.code === "LEAN-THRESHOLD-LIMIT-DRIFT" &&
        d.file.endsWith("governance-lean-thresholds.md"),
    );
    expect(drift).toBeDefined();
  });

  it("flags drift in CLAUDE.md when it trails Constitution", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
      ]),
      rule: buildRule([
        { file: "`governance/CONSTITUTION.md`", limit: "<=250 lines" },
      ]),
      claudeMd: buildClaudeMd([
        { metric: "CONSTITUTION.md", limit: "<=225 lines" }, // stale
      ]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    const drift = result.drifts.find(
      (d) =>
        d.code === "LEAN-THRESHOLD-LIMIT-DRIFT" && d.file === "CLAUDE.md",
    );
    expect(drift).toBeDefined();
  });

  it("flags CONSTITUTION-TABLE-MISS when CONSTITUTION has no Lean Thresholds heading", async () => {
    const bareConstitution = `# C\n\n## 2. Pillars\nNo lean table.\n`;
    await seedFiles(fx.rootDir, {
      constitution: bareConstitution,
      rule: buildRule([]),
      claudeMd: buildClaudeMd([]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "CONSTITUTION-TABLE-MISS"),
    ).toBe(true);
  });

  it("warns (not errors) on unknown-row drift in downstream", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
      ]),
      rule: buildRule([
        { file: "`governance/CONSTITUTION.md`", limit: "<=250 lines" },
        { file: "Unknown row label", limit: "<=10" }, // unknown
      ]),
      claudeMd: buildClaudeMd([
        { metric: "CONSTITUTION.md", limit: "<=250 lines" },
      ]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "LEAN-THRESHOLD-UNKNOWN-ROW"),
    ).toBe(true);
  });
});

// ── formatDrift ─────────────────────────────────────────────────────

describe("formatDrift (lean-threshold-currency)", () => {
  it("formats an error drift with line number", () => {
    const line = formatDrift({
      level: "error",
      code: "LEAN-THRESHOLD-LIMIT-DRIFT",
      file: "CLAUDE.md",
      line: 12,
      message: "row x diverges",
    });
    expect(line).toBe(
      "[ERROR LEAN-THRESHOLD-LIMIT-DRIFT] CLAUDE.md:12: row x diverges",
    );
  });

  it("formats a warning without a line number", () => {
    const line = formatDrift({
      level: "warning",
      code: "LEAN-THRESHOLD-UNKNOWN-ROW",
      file: ".claude/rules/governance-lean-thresholds.md",
      message: "row z unknown",
    });
    expect(line).toBe(
      "[WARN  LEAN-THRESHOLD-UNKNOWN-ROW] .claude/rules/governance-lean-thresholds.md: row z unknown",
    );
  });
});
