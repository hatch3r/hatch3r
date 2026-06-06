import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SCOPED_FILES,
  countLines,
  formatResult,
  parseCeiling,
  runValidator,
} from "../validate-governance-total.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "governance-total-"));
  await mkdir(join(rootDir, "governance"), { recursive: true });
  return { rootDir };
}

/**
 * Minimal CONSTITUTION fixture carrying a §2 P5 "Governance total" row with
 * the given ceiling. The Limit cell is column index 1, matching the live
 * three-column table.
 */
function buildConstitution(ceiling: number, extraLines = 0): string {
  let body = `# Constitution

## 2. The 8 Binding Pillars

### P5. Governance Self-Quality

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| Governance total (sum of the 7 lean-tracked prompts) | <=${ceiling} lines | Ceiling = sum of per-file caps. |
`;
  for (let i = 0; i < extraLines; i++) body += `padding line ${i}\n`;
  return body;
}

/** Write all 7 scoped files, each with `linesPerFile` newline-terminated lines. */
async function writeScopedFiles(
  rootDir: string,
  linesPerFile: number,
  constitutionContent?: string,
): Promise<void> {
  for (const rel of SCOPED_FILES) {
    if (rel.endsWith("CONSTITUTION.md") && constitutionContent !== undefined) {
      await writeFile(join(rootDir, rel), constitutionContent, "utf-8");
      continue;
    }
    const content = Array.from({ length: linesPerFile }, (_, i) => `line ${i}`).join("\n") + "\n";
    await writeFile(join(rootDir, rel), content, "utf-8");
  }
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await makeFixture();
});

afterEach(async () => {
  await rm(fixture.rootDir, { recursive: true, force: true });
});

// ── countLines ─────────────────────────────────────────────────────

describe("countLines", () => {
  it("counts newline characters (matches wc -l for newline-terminated files)", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
  });

  it("does not add a phantom line for a missing trailing newline", () => {
    expect(countLines("a\nb\nc")).toBe(2);
  });

  it("returns 0 for empty content", () => {
    expect(countLines("")).toBe(0);
  });
});

// ── parseCeiling ───────────────────────────────────────────────────

describe("parseCeiling", () => {
  it("extracts the integer ceiling from the §2 P5 Governance total row", () => {
    expect(parseCeiling(buildConstitution(3370))).toBe(3370);
  });

  it("matches the row on its leading label, ignoring the inline scope parenthetical", () => {
    const body = buildConstitution(3000);
    expect(parseCeiling(body)).toBe(3000);
  });

  it("returns null when the row is absent", () => {
    const body = `# Constitution

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| CONSTITUTION.md | <=550 lines | per-file |
`;
    expect(parseCeiling(body)).toBeNull();
  });

  it("returns null when the Limit cell has no <=NNNN lines token", () => {
    const body = `# Constitution

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| Governance total | unbounded | n/a |
`;
    expect(parseCeiling(body)).toBeNull();
  });
});

// ── runValidator ───────────────────────────────────────────────────

describe("runValidator (governance-total)", () => {
  it("skips clean when the CONSTITUTION is absent (private-corpus public CI)", async () => {
    const result = await runValidator({ rootDir: fixture.rootDir });
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("passes when the summed total is at or under the ceiling", async () => {
    // 7 files * 100 lines = 700; CONSTITUTION replaced with a ~12-line table.
    const constitution = buildConstitution(5000);
    await writeScopedFiles(fixture.rootDir, 100, constitution);
    const result = await runValidator({ rootDir: fixture.rootDir });
    expect(result.skipped).toBe(false);
    expect(result.breached).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.ceiling).toBe(5000);
    expect(result.counts).toHaveLength(SCOPED_FILES.length);
  });

  it("flags a breach with exit 1 when the total exceeds the ceiling", async () => {
    const constitution = buildConstitution(50);
    await writeScopedFiles(fixture.rootDir, 100, constitution);
    const result = await runValidator({ rootDir: fixture.rootDir });
    expect(result.breached).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.total).toBeGreaterThan(50);
  });

  it("errors when a scoped file is missing", async () => {
    const constitution = buildConstitution(5000);
    await writeFile(join(fixture.rootDir, "governance", "CONSTITUTION.md"), constitution, "utf-8");
    // Only write CONSTITUTION; the other 6 scoped files are absent.
    const result = await runValidator({ rootDir: fixture.rootDir });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
  });

  it("errors when the ceiling cannot be parsed", async () => {
    const constitution = `# Constitution

#### Lean Thresholds

| Metric | Limit | Calibration |
|--------|-------|-------------|
| CONSTITUTION.md | <=550 lines | per-file |
`;
    await writeScopedFiles(fixture.rootDir, 10, constitution);
    const result = await runValidator({ rootDir: fixture.rootDir });
    expect(result.ceiling).toBeNull();
    expect(result.errors.some((e) => e.includes("ceiling"))).toBe(true);
    expect(result.exitCode).toBe(1);
  });
});

// ── formatResult ───────────────────────────────────────────────────

describe("formatResult (governance-total)", () => {
  it("returns the skip line when skipped", () => {
    const lines = formatResult({
      skipped: true,
      ceiling: null,
      counts: [],
      total: 0,
      breached: false,
      errors: [],
      exitCode: 0,
    });
    expect(lines.join("\n")).toContain("skipping governance-total");
  });

  it("emits a BREACH summary line when breached", () => {
    const lines = formatResult({
      skipped: false,
      ceiling: 100,
      counts: [{ relPath: "governance/CONSTITUTION.md", lines: 200 }],
      total: 200,
      breached: true,
      errors: [],
      exitCode: 1,
    });
    const joined = lines.join("\n");
    expect(joined).toContain("BREACH");
    expect(joined).toContain("sum 200 > ceiling 100");
  });

  it("emits an ok summary line when under ceiling", () => {
    const lines = formatResult({
      skipped: false,
      ceiling: 3370,
      counts: [{ relPath: "governance/CONSTITUTION.md", lines: 444 }],
      total: 444,
      breached: false,
      errors: [],
      exitCode: 0,
    });
    expect(lines.join("\n")).toContain("ok");
  });
});
