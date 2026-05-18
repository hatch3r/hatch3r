import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkClaudeMd,
  checkQualityCharter,
  formatDrift,
  parseClaudePillarTable,
  parseConstitutionPillars,
  runValidator,
} from "../validate-pillar-currency.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "pillar-currency-x-"));
  await mkdir(join(rootDir, "governance"), { recursive: true });
  await mkdir(join(rootDir, "agents", "shared"), { recursive: true });
  return { rootDir };
}

function buildConstitution(pillarCount: number, sectionCount?: number): string {
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

function buildClaudeMd(
  pillarCount: number,
  opts: { tableCount?: number; extraStaleRange?: string } = {},
): string {
  const tableCount = opts.tableCount ?? pillarCount;
  let body = `# hatch3r — Development Instructions

## The ${pillarCount} Binding Pillars

Every change must serve at least one pillar. Full definitions: \`governance/CONSTITUTION.md\` §2 P1-P${pillarCount}.

| Pillar | Name | Enforcement | Primary Ref |
|--------|------|-------------|-------------|
`;
  for (let i = 1; i <= tableCount; i++) {
    body += `| P${i} | Pillar ${i} | enforcement | ref |\n`;
  }
  if (opts.extraStaleRange) {
    body += `\nLegacy line: ${opts.extraStaleRange} still referenced here.\n`;
  }
  return body;
}

function buildQualityCharter(refs: number[]): string {
  let body = `---
id: shared-quality-charter
type: reference
---

## Agent Quality Charter

Body content.

`;
  for (const j of refs) {
    body += `Cross-reference: CONSTITUTION §2 P${j} measurement.\n`;
  }
  return body;
}

async function seedFiles(
  rootDir: string,
  opts: {
    constitution: string;
    claudeMd: string;
    qualityCharter: string;
  },
): Promise<void> {
  await writeFile(
    join(rootDir, "governance", "CONSTITUTION.md"),
    opts.constitution,
    "utf-8",
  );
  await writeFile(join(rootDir, "CLAUDE.md"), opts.claudeMd, "utf-8");
  await writeFile(
    join(rootDir, "agents", "shared", "quality-charter.md"),
    opts.qualityCharter,
    "utf-8",
  );
}

// ── parseConstitutionPillars ───────────────────────────────────────

describe("parseConstitutionPillars (validate-pillar-currency)", () => {
  it("extracts pillar count and matching section count", () => {
    const content = buildConstitution(8);
    const { declaredCount, sectionCount } = parseConstitutionPillars(content);
    expect(declaredCount).toBe(8);
    expect(sectionCount).toBe(8);
  });

  it("returns mismatched counts when heading and sections diverge", () => {
    const content = buildConstitution(8, 7);
    const { declaredCount, sectionCount } = parseConstitutionPillars(content);
    expect(declaredCount).toBe(8);
    expect(sectionCount).toBe(7);
  });

  it("throws when the heading is missing", () => {
    const content = `# Constitution\n\n## 1. Identity\nNothing else.\n`;
    expect(() => parseConstitutionPillars(content)).toThrow(
      /could not locate.*Binding Pillars/i,
    );
  });
});

// ── parseClaudePillarTable ─────────────────────────────────────────

describe("parseClaudePillarTable", () => {
  it("extracts pillar indices from `| P{i} |` rows", () => {
    const body = `# CLAUDE
| P1 | a | b | c |
| P2 | a | b | c |
| P3 | a | b | c |
`;
    const set = parseClaudePillarTable(body);
    expect(set.has(1)).toBe(true);
    expect(set.has(2)).toBe(true);
    expect(set.has(3)).toBe(true);
    expect(set.size).toBe(3);
  });

  it("returns empty set when no pillar rows present", () => {
    const set = parseClaudePillarTable("# CLAUDE\n\nNo pillar table here.\n");
    expect(set.size).toBe(0);
  });

  it("does not match non-leading P tokens", () => {
    // The PXX token here is inside a cell after the first; ROW_RE anchors
    // on the very first | P{i} |, so this should not be picked up.
    const body = "| name | P99 |\n";
    const set = parseClaudePillarTable(body);
    expect(set.has(99)).toBe(false);
  });
});

// ── checkClaudeMd ──────────────────────────────────────────────────

describe("checkClaudeMd", () => {
  it("passes when canonical range and full pillar row set are present", () => {
    const body = buildClaudeMd(8);
    const drifts = checkClaudeMd("CLAUDE.md", body, 8);
    expect(drifts).toEqual([]);
  });

  it("flags missing canonical range P1-PK", () => {
    const body = `# CLAUDE\n\nNo range reference.\n\n| P1 | a | b | c |\n| P2 | a | b | c |\n`;
    const drifts = checkClaudeMd("CLAUDE.md", body, 8);
    expect(drifts.some((d) => d.code === "PILLAR-RANGE-MISS")).toBe(true);
  });

  it("flags stale P1-P7 range when canonical is 8", () => {
    const body = buildClaudeMd(8, { extraStaleRange: "P1-P7" });
    const drifts = checkClaudeMd("CLAUDE.md", body, 8);
    const stale = drifts.find((d) => d.code === "PILLAR-RANGE-STALE");
    expect(stale).toBeDefined();
    expect(stale!.message).toContain("P1-P7");
  });

  it("flags missing pillar table row (P8 absent when K=8)", () => {
    const body = buildClaudeMd(8, { tableCount: 7 });
    const drifts = checkClaudeMd("CLAUDE.md", body, 8);
    expect(
      drifts.some(
        (d) => d.code === "PILLAR-TABLE-MISSING-ROW" && /P8/.test(d.message),
      ),
    ).toBe(true);
  });

  it("flags extra pillar table row (P9 present when K=8)", () => {
    const body = buildClaudeMd(8, { tableCount: 9 });
    const drifts = checkClaudeMd("CLAUDE.md", body, 8);
    expect(
      drifts.some(
        (d) => d.code === "PILLAR-TABLE-EXTRA-ROW" && /P9/.test(d.message),
      ),
    ).toBe(true);
  });
});

// ── checkQualityCharter ────────────────────────────────────────────

describe("checkQualityCharter", () => {
  it("passes when all CONSTITUTION §2 references are in-band", () => {
    const body = buildQualityCharter([2, 2, 5, 6]);
    const drifts = checkQualityCharter("agents/shared/quality-charter.md", body, 8);
    expect(drifts).toEqual([]);
  });

  it("flags out-of-band reference (P9 when K=8)", () => {
    const body = buildQualityCharter([2, 9]);
    const drifts = checkQualityCharter("agents/shared/quality-charter.md", body, 8);
    const oob = drifts.find((d) => d.code === "PILLAR-RANGE-OUT-OF-BAND");
    expect(oob).toBeDefined();
    expect(oob!.message).toContain("P9");
  });

  it("flags multiple out-of-band references with line numbers", () => {
    const body = `## Charter\nCONSTITUTION §2 P10 measure.\nCONSTITUTION.md §2 P11 measure.\n`;
    const drifts = checkQualityCharter("agents/shared/quality-charter.md", body, 8);
    expect(drifts).toHaveLength(2);
    expect(drifts.every((d) => d.code === "PILLAR-RANGE-OUT-OF-BAND")).toBe(true);
    // Lines 2 and 3 (1-based).
    const lines = drifts.map((d) => d.line).sort();
    expect(lines).toEqual([2, 3]);
  });

  it("does not flag bare `P9` outside CONSTITUTION context (false positive guard)", () => {
    const body = `## Charter\nGeneric P9 reference unrelated to CONSTITUTION.\n`;
    const drifts = checkQualityCharter("agents/shared/quality-charter.md", body, 8);
    expect(drifts).toEqual([]);
  });
});

// ── runValidator (end-to-end via tmpdir fixtures) ──────────────────

describe("runValidator (pillar-currency)", () => {
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
      claudeMd: buildClaudeMd(8),
      qualityCharter: buildQualityCharter([2, 5]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.pillarCount).toBe(8);
    expect(result.errorCount).toBe(0);
    expect(result.drifts).toEqual([]);
  });

  it("flags CONSTITUTION-SELF-DRIFT when heading and section count differ", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8, 7),
      claudeMd: buildClaudeMd(8),
      qualityCharter: buildQualityCharter([2]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(
      result.drifts.some((d) => d.code === "CONSTITUTION-SELF-DRIFT"),
    ).toBe(true);
  });

  it("flags CLAUDE.md table missing the P8 row when CONSTITUTION declares 8", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8),
      claudeMd: buildClaudeMd(8, { tableCount: 7 }),
      qualityCharter: buildQualityCharter([2]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "PILLAR-TABLE-MISSING-ROW"),
    ).toBe(true);
  });

  it("flags quality-charter out-of-band P9 reference", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(8),
      claudeMd: buildClaudeMd(8),
      qualityCharter: buildQualityCharter([2, 9]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.drifts.some((d) => d.code === "PILLAR-RANGE-OUT-OF-BAND"),
    ).toBe(true);
  });

  it("uses the Constitution's declared K (not a hard-coded value)", async () => {
    // K=10 hypothetical: two more pillars added.
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(10),
      claudeMd: buildClaudeMd(10),
      qualityCharter: buildQualityCharter([2, 9, 10]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.pillarCount).toBe(10);
    expect(result.errorCount).toBe(0);
  });

  it("flags CLAUDE.md still on P1-P8 table when Constitution moves to P1-P9", async () => {
    await seedFiles(fx.rootDir, {
      constitution: buildConstitution(9),
      claudeMd: buildClaudeMd(8), // still 8 rows + P1-P8 range
      qualityCharter: buildQualityCharter([2]),
    });
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.drifts.some((d) => d.code === "PILLAR-RANGE-STALE")).toBe(true);
    expect(
      result.drifts.some((d) => d.code === "PILLAR-TABLE-MISSING-ROW"),
    ).toBe(true);
  });
});

// ── formatDrift ────────────────────────────────────────────────────

describe("formatDrift (pillar-currency)", () => {
  it("formats an error drift with line number", () => {
    const line = formatDrift({
      level: "error",
      code: "PILLAR-RANGE-STALE",
      file: "CLAUDE.md",
      line: 42,
      message: 'stale range "P1-P7"',
    });
    expect(line).toBe(
      '[ERROR PILLAR-RANGE-STALE] CLAUDE.md:42: stale range "P1-P7"',
    );
  });

  it("formats a drift without a line number", () => {
    const line = formatDrift({
      level: "error",
      code: "PILLAR-RANGE-MISS",
      file: "CLAUDE.md",
      message: "missing canonical range",
    });
    expect(line).toBe(
      "[ERROR PILLAR-RANGE-MISS] CLAUDE.md: missing canonical range",
    );
  });
});
