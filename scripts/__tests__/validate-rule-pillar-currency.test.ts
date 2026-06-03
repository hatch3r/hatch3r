import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root for the real-repo end-to-end run: this file lives at
// scripts/__tests__/, so the root is two levels up (mirrors
// validate-specialist-roster.test.ts REPO_ROOT resolution).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const CONSTITUTION_REL = "governance/CONSTITUTION.md";

import {
  checkContentAuthoringFile,
  checkPillarComplianceFile,
  formatDrift,
  parseConstitutionPillars,
  runValidator,
} from "../validate-rule-pillar-currency.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "pillar-currency-"));
  await mkdir(join(rootDir, "governance"), { recursive: true });
  await mkdir(join(rootDir, ".claude", "rules"), { recursive: true });
  return { rootDir };
}

function buildConstitution(pillarCount: number, sectionCount?: number): string {
  // Default: sectionCount === pillarCount (coherent constitution).
  const sections = sectionCount ?? pillarCount;
  let body = `# hatch3r — Constitution

> Established: 2026-03-25

## 1. Identity
hatch3r is a CLI.

## 2. The ${pillarCount} Binding Pillars

Intro line.

`;
  for (let i = 1; i <= sections; i++) {
    body += `### P${i}. Pillar ${i}\nBody for P${i}.\n\n`;
  }
  body += `## 3. Traceability\nMatrix here.\n`;
  return body;
}

async function seedFiles(
  rootDir: string,
  opts: {
    constitution: string;
    pillarCompliance: string;
    contentAuthoring: string;
  },
): Promise<void> {
  await writeFile(
    join(rootDir, "governance", "CONSTITUTION.md"),
    opts.constitution,
    "utf-8",
  );
  await writeFile(
    join(rootDir, ".claude", "rules", "pillar-compliance.md"),
    opts.pillarCompliance,
    "utf-8",
  );
  await writeFile(
    join(rootDir, ".claude", "rules", "content-authoring.md"),
    opts.contentAuthoring,
    "utf-8",
  );
}

// Canonical (in-sync) rule bodies for K=8.
const CANONICAL_PILLAR_COMPLIANCE_8 = `# Pillar Compliance

**Pillars:** P5 (Governance Self-Quality)

Before modifying any file, answer:

1. **Which pillar(s) does this change serve?** (P1-P8, defined in CONSTITUTION §2)

The 8 pillars: P1 CLI UX, P2 Quality, P3 Currency, P4 Lean, P5 Governance, P6 Security, P7 Speed, P8 Clarification.
`;

const CANONICAL_CONTENT_AUTHORING_8 = `# Content Authoring

**Pillars:** P4, P2

7. **Pillar alignment:** Every artifact must serve at least one Binding Pillar (P1-P8). Document which.
`;

// ── parseConstitutionPillars ───────────────────────────────────────

describe("parseConstitutionPillars", () => {
  it("extracts pillar count from the heading and matches sub-section count", () => {
    const content = buildConstitution(8);
    const { declaredCount, sectionCount, declaredHeadingLine } =
      parseConstitutionPillars(content);
    expect(declaredCount).toBe(8);
    expect(sectionCount).toBe(8);
    expect(declaredHeadingLine).toBeGreaterThan(0);
  });

  it("returns mismatched counts when the heading and sub-sections disagree", () => {
    // Heading claims 8, only 7 ### P{i}. sections present.
    const content = buildConstitution(8, 7);
    const { declaredCount, sectionCount } = parseConstitutionPillars(content);
    expect(declaredCount).toBe(8);
    expect(sectionCount).toBe(7);
  });

  it("throws when the heading is missing", () => {
    const content = `# Constitution\n\n## 1. Identity\nNo pillars heading.\n`;
    expect(() => parseConstitutionPillars(content)).toThrow(
      /could not locate.*Binding Pillars/i,
    );
  });

  it("handles any section number (not hard-coded to §2)", () => {
    const content = `# Doc\n## 5. Identity\nx.\n\n## 7. The 4 Binding Pillars\n\n### P1. one\n### P2. two\n### P3. three\n### P4. four\n\n## 8. Next section\n`;
    const { declaredCount, sectionCount } = parseConstitutionPillars(content);
    expect(declaredCount).toBe(4);
    expect(sectionCount).toBe(4);
  });

  it("stops counting at the next ## heading boundary", () => {
    // P-style headings after the next ## must not be counted.
    const content = `## 2. The 3 Binding Pillars\n\n### P1. one\n### P2. two\n### P3. three\n\n## 3. Other\n\n### P99. spurious\n`;
    const { sectionCount } = parseConstitutionPillars(content);
    expect(sectionCount).toBe(3);
  });
});

// ── checkPillarComplianceFile ──────────────────────────────────────

describe("checkPillarComplianceFile", () => {
  it("passes when canonical range and count are present and no stale ranges", () => {
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      CANONICAL_PILLAR_COMPLIANCE_8,
      8,
    );
    expect(drifts).toEqual([]);
  });

  it("flags missing canonical range P1-PK", () => {
    const body = `# rule\n\n1. Pillars: serve which? (no range here).\n\nThe 8 pillars: foo.\n`;
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      body,
      8,
    );
    expect(drifts.some((d) => d.code === "PILLAR-RANGE-MISS")).toBe(true);
  });

  it("flags missing canonical count phrase", () => {
    const body = `# rule\n\n1. Pillars (P1-P8) defined in CONSTITUTION.\n`;
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      body,
      8,
    );
    expect(drifts.some((d) => d.code === "PILLAR-COUNT-MISS")).toBe(true);
  });

  it("flags stale P1-P7 fragment with line number when canonical is 8", () => {
    const body = `# rule\n\n1. Pillars (P1-P8) — defined.\nThe 8 pillars: foo.\nBut here: legacy text P1-P7 still present.\n`;
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      body,
      8,
    );
    const stale = drifts.find((d) => d.code === "PILLAR-RANGE-STALE");
    expect(stale).toBeDefined();
    expect(stale!.line).toBe(5);
    expect(stale!.message).toContain("P1-P7");
  });

  it("flags stale 'The 7 pillars' phrase when canonical is 8", () => {
    const body = `# rule\n\n1. Pillars (P1-P8) — defined.\nThe 8 pillars: foo.\nIn the past: The 7 pillars enumerated …\n`;
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      body,
      8,
    );
    const stale = drifts.find((d) => d.code === "PILLAR-COUNT-STALE");
    expect(stale).toBeDefined();
    expect(stale!.message).toContain("The 7");
  });

  it("does not flag the canonical 'The K pillars' phrase as stale", () => {
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      CANONICAL_PILLAR_COMPLIANCE_8,
      8,
    );
    expect(drifts.some((d) => d.code === "PILLAR-COUNT-STALE")).toBe(false);
  });

  it("recognizes 'The K Binding Pillars' phrasing as stale too", () => {
    const body = `# rule\n\n1. (P1-P8)\nThe 8 pillars: foo.\nThe 7 Binding Pillars were once canonical.\n`;
    const drifts = checkPillarComplianceFile(
      ".claude/rules/pillar-compliance.md",
      body,
      8,
    );
    expect(drifts.some((d) => d.code === "PILLAR-COUNT-STALE")).toBe(true);
  });
});

// ── checkContentAuthoringFile ──────────────────────────────────────

describe("checkContentAuthoringFile", () => {
  it("passes when canonical range is present", () => {
    const drifts = checkContentAuthoringFile(
      ".claude/rules/content-authoring.md",
      CANONICAL_CONTENT_AUTHORING_8,
      8,
    );
    expect(drifts).toEqual([]);
  });

  it("flags missing canonical range P1-PK", () => {
    const body = `# Content Authoring\n\nPillar alignment: serve one pillar. (no range here)\n`;
    const drifts = checkContentAuthoringFile(
      ".claude/rules/content-authoring.md",
      body,
      8,
    );
    expect(drifts.some((d) => d.code === "PILLAR-RANGE-MISS")).toBe(true);
  });

  it("flags stale P1-P7 with line number when canonical is 8", () => {
    const body = `# Content Authoring\n\nPillar alignment: (P1-P8).\nLegacy: P1-P7 still here.\n`;
    const drifts = checkContentAuthoringFile(
      ".claude/rules/content-authoring.md",
      body,
      8,
    );
    const stale = drifts.find((d) => d.code === "PILLAR-RANGE-STALE");
    expect(stale).toBeDefined();
    expect(stale!.line).toBe(4);
  });
});

// ── runValidator (end-to-end via tmpdir fixtures) ──────────────────

describe("runValidator", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("returns 0 errors when everything is in sync (K=8)", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8),
      pillarCompliance: CANONICAL_PILLAR_COMPLIANCE_8,
      contentAuthoring: CANONICAL_CONTENT_AUTHORING_8,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.pillarCount).toBe(8);
    expect(result.errorCount).toBe(0);
    expect(result.drifts).toEqual([]);
  });

  it("flags CONSTITUTION-SELF-DRIFT when heading count != section count", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8, 7), // heading says 8, only 7 ### P sections
      pillarCompliance: CANONICAL_PILLAR_COMPLIANCE_8,
      contentAuthoring: CANONICAL_CONTENT_AUTHORING_8,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "CONSTITUTION-SELF-DRIFT"),
    ).toBe(true);
  });

  it("flags stale P1-P7 in pillar-compliance when Constitution declares 8", async () => {
    const stale = `# Pillar Compliance\n\nWhich pillar(s) (P1-P7) defined in CONSTITUTION §2.\nThe 7 pillars: foo.\n`;
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8),
      pillarCompliance: stale,
      contentAuthoring: CANONICAL_CONTENT_AUTHORING_8,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some(
        (d) =>
          d.code === "PILLAR-RANGE-STALE" && d.file.endsWith("pillar-compliance.md"),
      ),
    ).toBe(true);
    expect(
      result.drifts.some(
        (d) =>
          d.code === "PILLAR-COUNT-STALE" && d.file.endsWith("pillar-compliance.md"),
      ),
    ).toBe(true);
    // Also the canonical range/count strings are absent → MISS reports too.
    expect(
      result.drifts.some(
        (d) => d.code === "PILLAR-RANGE-MISS" || d.code === "PILLAR-COUNT-MISS",
      ),
    ).toBe(true);
  });

  it("flags stale P1-P7 in content-authoring when Constitution declares 8", async () => {
    const stale = `# Content Authoring\n\nPillar alignment: (P1-P7).\n`;
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8),
      pillarCompliance: CANONICAL_PILLAR_COMPLIANCE_8,
      contentAuthoring: stale,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some(
        (d) =>
          d.code === "PILLAR-RANGE-STALE" &&
          d.file.endsWith("content-authoring.md"),
      ),
    ).toBe(true);
  });

  it("uses the Constitution's declared K (not a hard-coded value)", async () => {
    // K=10: a hypothetical future where two more pillars get added.
    const rule10 = `# Pillar Compliance\n\nWhich pillar(s) (P1-P10) defined in CONSTITUTION §2.\nThe 10 pillars: enumerated.\n`;
    const ca10 = `# Content Authoring\n\nPillar alignment: (P1-P10).\n`;
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(10),
      pillarCompliance: rule10,
      contentAuthoring: ca10,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.pillarCount).toBe(10);
    expect(result.errorCount).toBe(0);
  });

  it("flags rule files still on P1-P8 when Constitution moves to P1-P9", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(9),
      pillarCompliance: CANONICAL_PILLAR_COMPLIANCE_8, // still says P1-P8 / The 8 pillars
      contentAuthoring: CANONICAL_CONTENT_AUTHORING_8,
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.pillarCount).toBe(9);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "PILLAR-RANGE-STALE"),
    ).toBe(true);
  });
});

// ── End-to-end: run against the real repo state ────────────────────

describe("runValidator (real repo)", () => {
  it("passes against the current repo state (post-H76 propagation)", async () => {
    const result = await runValidator(); // default rootDir = repo root
    // Privatization gate: governance/CONSTITUTION.md is private and absent in
    // public CI / contributor clones. With no canonical pillar count to
    // cross-check, runValidator returns the graceful-skip contract
    // (validate-rule-pillar-currency.ts:292-298). Assert that contract when the
    // source is absent; assert the post-H76 in-sync contract when it is present.
    if (existsSync(resolve(REPO_ROOT, CONSTITUTION_REL))) {
      // After C9-H76 propagated P8, repo must be in sync.
      expect(result.pillarCount).toBeGreaterThanOrEqual(8);
      // The full canonical surface is verified by the script; any drift here
      // would mean a rule file lost its P8 reference between H76 and gate run.
      expect(result.errorCount).toBe(0);
    } else {
      expect(result.pillarCount).toBe(0);
      expect(result.errorCount).toBe(0);
    }
  });
});

// ── formatDrift ────────────────────────────────────────────────────

describe("formatDrift", () => {
  it("formats an error drift with line number", () => {
    const line = formatDrift({
      level: "error",
      code: "PILLAR-RANGE-STALE",
      file: ".claude/rules/pillar-compliance.md",
      line: 14,
      message: 'stale range "P1-P7" found',
    });
    expect(line).toBe(
      '[ERROR PILLAR-RANGE-STALE] .claude/rules/pillar-compliance.md:14: stale range "P1-P7" found',
    );
  });

  it("formats a drift without a line number", () => {
    const line = formatDrift({
      level: "error",
      code: "PILLAR-RANGE-MISS",
      file: ".claude/rules/content-authoring.md",
      message: "missing canonical range",
    });
    expect(line).toBe(
      "[ERROR PILLAR-RANGE-MISS] .claude/rules/content-authoring.md: missing canonical range",
    );
  });
});
