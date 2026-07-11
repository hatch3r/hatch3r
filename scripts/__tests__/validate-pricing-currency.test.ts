import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, formatFinding, DEFAULT_WINDOW_DAYS } from "../validate-pricing-currency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  skillsDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "pricing-currency-validator-"));
  const skillsDir = join(rootDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  return { rootDir, skillsDir };
}

/** Write `skills/<name>/SKILL.md` with a minimal frontmatter + the given body. */
async function writeSkill(skillsDir: string, name: string, body: string): Promise<void> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  const fm = `---\nid: ${name}\nname: ${name}\ntype: skill\ndescription: A skill\ntags: [maintenance]\n---\n`;
  await writeFile(join(dir, "SKILL.md"), `${fm}\n${body}`, "utf-8");
}

// A fixed "now" so window math is deterministic regardless of wall-clock date.
const NOW = Date.parse("2026-06-06T00:00:00Z");

/** A price table whose single data row carries the given accessed date. */
function priceTable(accessed: string): string {
  return (
    "| Model | Model ID | Input (per 1M) | Output (per 1M) | accessed |\n" +
    "|-------|----------|---------------:|----------------:|----------|\n" +
    `| Claude Haiku 4.5 | \`claude-haiku-4-5\` | $1.00 | $5.00 | ${accessed} |\n`
  );
}

describe("validate-pricing-currency — staleness window", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("does NOT flag a price row inside the 90-day window", async () => {
    // 2026-04-01 -> 66 days before NOW, well inside the window.
    await writeSkill(fx.skillsDir, "hatch3r-fresh", `# Fresh\n\n${priceTable("2026-04-01")}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.checkedSkills).toBe(1);
    expect(result.priceTables).toBe(1);
    expect(result.priceRows).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it("WARNs PRICING-STALE on a price row older than the 90-day window", async () => {
    // 2026-01-01 -> 156 days before NOW, > 90.
    await writeSkill(fx.skillsDir, "hatch3r-stale", `# Stale\n\n${priceTable("2026-01-01")}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("PRICING-STALE");
    expect(result.findings[0].file).toMatch(/hatch3r-stale\/SKILL\.md$/);
    expect(result.findings[0].line).toBeGreaterThan(0);
    expect(result.findings[0].message).toMatch(/2026-01-01/);
    expect(result.findings[0].message).toMatch(/90-day window/);
  });

  it("treats exactly 90 days old as fresh and 91 days old as stale (boundary)", async () => {
    const ninety = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ninetyOne = new Date(NOW - 91 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await writeSkill(fx.skillsDir, "hatch3r-90", `# Ninety\n\n${priceTable(ninety)}`);
    await writeSkill(fx.skillsDir, "hatch3r-91", `# NinetyOne\n\n${priceTable(ninetyOne)}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toMatch(/hatch3r-91\//);
  });

  it("honours a custom windowDays override", async () => {
    // 2026-04-01 is 66 days old: inside default 90 but outside a 30-day window.
    await writeSkill(fx.skillsDir, "hatch3r-win", `# Win\n\n${priceTable("2026-04-01")}`);

    const wide = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(wide.findings).toHaveLength(0);

    const narrow = await runValidator({ rootDir: fx.rootDir, nowTs: NOW, windowDays: 30 });
    expect(narrow.findings).toHaveLength(1);
    expect(narrow.findings[0].code).toBe("PRICING-STALE");
  });

  it("flags every stale row in a multi-row price table", async () => {
    const table =
      "| Model | Model ID | Input (per 1M) | Output (per 1M) | accessed |\n" +
      "|-------|----------|---------------:|----------------:|----------|\n" +
      "| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | 2026-01-01 |\n" +
      "| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3.00 | $15.00 | 2026-05-20 |\n" +
      "| Claude Opus 4.8 | `claude-opus-4-8` | $5.00 | $25.00 | 2026-01-15 |\n";
    await writeSkill(fx.skillsDir, "hatch3r-multi", `# Multi\n\n${table}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    // Two stale rows (Jan 01, Jan 15); the May 20 row is fresh.
    expect(result.priceRows).toBe(3);
    expect(result.warningCount).toBe(2);
    expect(result.findings.every((f) => f.code === "PRICING-STALE")).toBe(true);
  });
});

describe("validate-pricing-currency — missing date + non-price tables", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("WARNs PRICING-NO-DATE when a price-table row's accessed cell has no ISO date", async () => {
    const table =
      "| Model | Input (per 1M) | Output (per 1M) | accessed |\n" +
      "|-------|---------------:|----------------:|----------|\n" +
      "| Claude Haiku 4.5 | $1.00 | $5.00 | TBD |\n";
    await writeSkill(fx.skillsDir, "hatch3r-nodate", `# NoDate\n\n${table}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].code).toBe("PRICING-NO-DATE");
  });

  it("ignores a table that has an accessed column but no price-signal column", async () => {
    const table =
      "| Source | URL | accessed |\n" +
      "|--------|-----|----------|\n" +
      "| Anthropic docs | https://docs.anthropic.com | 2025-01-01 |\n";
    await writeSkill(fx.skillsDir, "hatch3r-refs", `# Refs\n\n${table}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.priceTables).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("ignores a price table that has no accessed column at all", async () => {
    const table =
      "| Model | Input (per 1M) | Output (per 1M) |\n" +
      "|-------|---------------:|----------------:|\n" +
      "| Claude Haiku 4.5 | $1.00 | $5.00 |\n";
    await writeSkill(fx.skillsDir, "hatch3r-undated", `# Undated\n\n${table}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.priceTables).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("skips bold-sub-note rows that do not reach the accessed column", async () => {
    const table =
      "| Model | Input (per 1M) | Output (per 1M) | accessed |\n" +
      "|-------|---------------:|----------------:|----------|\n" +
      "| Claude Haiku 4.5 | $1.00 | $5.00 | 2026-05-20 |\n" +
      "| **Cache note** | billed 0.1x |\n";
    await writeSkill(fx.skillsDir, "hatch3r-subnote", `# SubNote\n\n${table}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    // Only the full data row is counted; the short note row is skipped.
    expect(result.priceRows).toBe(1);
    expect(result.findings).toHaveLength(0);
  });
});

describe("validate-pricing-currency — strict mode + discovery", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("--strict promotes a staleness warning to an error", async () => {
    await writeSkill(fx.skillsDir, "hatch3r-stale", `# Stale\n\n${priceTable("2026-01-01")}`);

    const lenient = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(lenient.errorCount).toBe(0);
    expect(lenient.warningCount).toBe(1);

    const strict = await runValidator({ rootDir: fx.rootDir, nowTs: NOW, strict: true });
    expect(strict.errorCount).toBe(1);
    expect(strict.warningCount).toBe(0);
    expect(strict.findings[0].level).toBe("error");
    expect(strict.findings[0].code).toBe("PRICING-STALE");
  });

  it("returns an empty result when the skills dir is missing", async () => {
    const result = await runValidator({ rootDir: join(fx.rootDir, "does-not-exist"), nowTs: NOW });
    expect(result.checkedSkills).toBe(0);
    expect(result.priceTables).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("ignores a skill directory that has no SKILL.md", async () => {
    await mkdir(join(fx.skillsDir, "hatch3r-empty"), { recursive: true });

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.checkedSkills).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("formatFinding renders a file:line locator", async () => {
    await writeSkill(fx.skillsDir, "hatch3r-stale", `# Stale\n\n${priceTable("2026-01-01")}`);

    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(formatFinding(result.findings[0])).toMatch(/SKILL\.md:\d+:/);
    expect(formatFinding(result.findings[0])).toMatch(/\[WARN /);
  });

  it("exports a 90-day default window", () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(90);
  });
});

// ── Shipped-corpus regression gate ───────────────────────────────────
//
// The unit tests above use a tmpdir, so they never touch the real `skills/`
// corpus. This block runs the validator against the shipped tree with NO
// directory override — the way `npm run validate:efficiency` runs it in CI — to
// prove (a) the embedded cost-tracking price table is discovered (priceTables
// > 0, so a parser regression that found nothing cannot pass green), and (b)
// the shipped corpus emits 0 ERROR-level findings (the warning-gate exit-0
// contract). It is NOT pinned to wall-clock freshness: a price row legitimately
// crossing the 90-day line is a warning, never a test failure — the warning
// stream, not this assertion, is the durable drift backstop.
describe("validate-pricing-currency — shipped corpus", () => {
  it("discovers the embedded price table and emits 0 error-level findings", async () => {
    const result = await runValidator({ rootDir: REPO_ROOT });
    const errors = result.findings.filter((f) => f.level === "error");
    expect(errors, errors.map((f) => `${f.code} ${f.file}:${f.line}`).join("\n")).toHaveLength(0);
    expect(result.checkedSkills).toBeGreaterThan(0);
    expect(result.priceTables).toBeGreaterThan(0);
    expect(result.priceRows).toBeGreaterThan(0);
    // D6-SA6.3-01: the real src/pipeline/costEstimator.ts::MODEL_RATES constant is
    // now discovered too — a parser regression that stopped seeing it (0 rows)
    // cannot pass green. Not pinned to wall-clock freshness (warnings, not errors).
    expect(result.modelRateRows).toBeGreaterThan(0);
  });
});

// ── MODEL_RATES code-constant scan (D6-SA6.3-01) ─────────────────────
//
// D6-22 gated only the skills markdown price table; `hatch3r explain --cost`
// resolves per-model rates from the `MODEL_RATES` constant in
// src/pipeline/costEstimator.ts, which sat outside every gate. These tests use a
// tmpdir fixture + a fixed `nowTs`, so they assert the new second-source scan
// deterministically without depending on the repo's real rate dates.

/** Write a fixture `src/pipeline/costEstimator.ts` under `rootDir`. */
async function writeRatesSource(rootDir: string, content: string): Promise<void> {
  const dir = join(rootDir, "src", "pipeline");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "costEstimator.ts"), content, "utf-8");
}

/** Wrap rate rows in a minimal `export const MODEL_RATES = { ... } as const;`. */
function ratesBlock(rows: string): string {
  return `export const MODEL_RATES: Readonly<Record<string, ModelRate>> = {\n${rows}\n} as const;\n`;
}

describe("validate-pricing-currency — MODEL_RATES code constant (D6-SA6.3-01)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("discovers MODEL_RATES accessed rows and counts them (fresh → no findings)", async () => {
    await writeRatesSource(
      fx.rootDir,
      ratesBlock(
        `  "claude-opus-4-8": { inputCostPer1M: 5.0, outputCostPer1M: 25.0, accessed: "2026-05-20" },\n` +
          `  "claude-sonnet-4-6": { inputCostPer1M: 3.0, outputCostPer1M: 15.0, accessed: "2026-05-20" },`,
      ),
    );
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.modelRateRows).toBe(2); // 2026-05-20 is 17 days before NOW
    expect(result.findings).toHaveLength(0);
  });

  it("WARNs PRICING-STALE on a MODEL_RATES row older than the 90-day window", async () => {
    await writeRatesSource(
      fx.rootDir,
      ratesBlock(
        `  "claude-opus-4-8": { inputCostPer1M: 5.0, outputCostPer1M: 25.0, accessed: "2026-01-01" },\n` +
          `  "claude-sonnet-4-6": { inputCostPer1M: 3.0, outputCostPer1M: 15.0, accessed: "2026-05-20" },`,
      ),
    );
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.modelRateRows).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.findings[0].code).toBe("PRICING-STALE");
    expect(result.findings[0].file).toMatch(/src\/pipeline\/costEstimator\.ts$/);
    expect(result.findings[0].message).toMatch(/2026-01-01/);
    expect(result.findings[0].message).toMatch(/MODEL_RATES/);
  });

  it("WARNs PRICING-NO-DATE on a MODEL_RATES row with an unparseable accessed cell", async () => {
    await writeRatesSource(
      fx.rootDir,
      ratesBlock(
        `  "claude-opus-4-8": { inputCostPer1M: 5.0, outputCostPer1M: 25.0, accessed: "TBD" },`,
      ),
    );
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.modelRateRows).toBe(1);
    expect(result.findings[0].code).toBe("PRICING-NO-DATE");
  });

  it("--strict promotes a stale MODEL_RATES row to an error", async () => {
    await writeRatesSource(
      fx.rootDir,
      ratesBlock(
        `  "claude-opus-4-8": { inputCostPer1M: 5.0, outputCostPer1M: 25.0, accessed: "2026-01-01" },`,
      ),
    );
    const strict = await runValidator({ rootDir: fx.rootDir, nowTs: NOW, strict: true });
    expect(strict.errorCount).toBe(1);
    expect(strict.findings[0].level).toBe("error");
    expect(strict.findings[0].code).toBe("PRICING-STALE");
  });

  it("bounds the scan to the object literal — ignores the interface field + comments", async () => {
    // `accessed: string;` (interface) and an `accessed: "..."` inside a comment
    // sit OUTSIDE any `export const MODEL_RATES` literal, so the scan yields 0 rows.
    await writeRatesSource(
      fx.rootDir,
      `// historical note: accessed: "2020-01-01"\ninterface ModelRate { accessed: string; }\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.modelRateRows).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("skips silently when the MODEL_RATES source file is absent", async () => {
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW });
    expect(result.modelRateRows).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("honours an explicit modelRatesFile override (absolute path)", async () => {
    const custom = join(fx.rootDir, "custom-rates.ts");
    await writeFile(
      custom,
      ratesBlock(
        `  "claude-opus-4-8": { inputCostPer1M: 5.0, outputCostPer1M: 25.0, accessed: "2026-01-01" },`,
      ),
      "utf-8",
    );
    const result = await runValidator({ rootDir: fx.rootDir, nowTs: NOW, modelRatesFile: custom });
    expect(result.modelRateRows).toBe(1);
    expect(result.findings[0].code).toBe("PRICING-STALE");
  });
});
