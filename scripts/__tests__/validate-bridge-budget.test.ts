import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  measureBridgeBudget,
  formatTextReport,
} from "../validate-bridge-budget.js";
import { BRIDGE_ORCHESTRATION } from "../../src/cli/shared/agentsContent.js";
import {
  CONTEXT_BUDGET_TOKENS,
  estimateTokens,
} from "../../src/adapters/contextBudget.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p7-bridge-budget-"));
  return { rootDir };
}

// D6-SA6.1-03: seed skills at `<root>/skills/<id>` — the REAL repo layout the
// generator reads (`join(contentRoot, "skills")`), not the `<root>/agents/skills`
// layout the prior masking fixture used to match the validator's wrong root.
async function seedSkill(rootDir: string, id: string, description: string): Promise<void> {
  const skillDir = join(rootDir, "skills", id);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nid: ${id}\ntype: skill\ndescription: ${description}\ntags: [implementation]\n---\n# ${id}\n\n## Steps\n1. Do the thing.\n`,
    "utf-8",
  );
}

describe("validate-bridge-budget", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Static measurement ──────────────────────────────────────────

  it("measures the static BRIDGE_ORCHESTRATION constant in tokens", async () => {
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    const expected = estimateTokens(BRIDGE_ORCHESTRATION.length);
    expect(report.staticTokens).toBe(expected);
    // No skills in fixture → dynamic falls back to static, so the two
    // token counts agree and measuredTokens equals staticTokens.
    expect(report.dynamicTokens).toBe(expected);
    expect(report.measuredTokens).toBe(expected);
  });

  // ── Default ceiling: every adapter under 10% with current bridge content ─

  it("PASSes the 10% ceiling for every adapter at the current bridge size", async () => {
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    expect(report.maxPercent).toBe(10);
    expect(report.violations).toEqual([]);
    for (const adapter of report.perAdapter) {
      expect(adapter.exceedsCeiling).toBe(false);
      expect(adapter.utilizationPercent).toBeLessThanOrEqual(10);
    }
  });

  // ── Per-adapter coverage ────────────────────────────────────────

  it("reports one entry per adapter in CONTEXT_BUDGET_TOKENS", async () => {
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    const reportTools = report.perAdapter.map((a) => a.tool).sort();
    const expectedTools = Object.keys(CONTEXT_BUDGET_TOKENS).sort();
    expect(reportTools).toEqual(expectedTools);
  });

  it("sorts per-adapter results by utilization percent descending", async () => {
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    for (let i = 1; i < report.perAdapter.length; i++) {
      expect(report.perAdapter[i - 1].utilizationPercent).toBeGreaterThanOrEqual(
        report.perAdapter[i].utilizationPercent,
      );
    }
    // The smallest per-adapter budget yields the highest utilization (bridge
    // tokens are identical across adapters), so it lands at the top of the
    // descending sort. After D6-14 (copilot 64K → 128K, re-verified against
    // vendor docs) the smallest budget is cursor at 120K; copilot is no longer
    // the floor. See src/adapters/contextBudget.ts CONTEXT_BUDGET_TOKENS.
    const top = report.perAdapter[0];
    expect(top.budgetTokens).toBe(120_000);
  });

  // ── Dynamic skill table grows the measurement ───────────────────

  it("uses the larger of static or dynamic content for utilization", async () => {
    // Seed enough skills that the dynamic content exceeds the static.
    for (let i = 0; i < 20; i++) {
      await seedSkill(
        fx.rootDir,
        `hatch3r-skill-${i}`,
        `Skill number ${i} description used to grow the dispatch table beyond the static constant.`,
      );
    }
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    // Dynamic should now exceed static because the dispatch + routing
    // tables get inlined into the rendered output.
    expect(report.dynamicTokens).toBeGreaterThan(report.staticTokens);
    expect(report.measuredTokens).toBe(report.dynamicTokens);
  });

  // ── Real-repo wiring guard (no override) ────────────────────────

  it("real repo root (default contentRoot): dynamic skill table exceeds the static base", async () => {
    // D6-SA6.1-03 regression guard: with no override, contentRoot defaults to
    // the repo ROOT, which holds the real 53-dir skills/ catalogue, so the
    // dynamic bridge (skill dispatch + routing tables) MUST exceed the static
    // constant. If the default is re-pointed at `agents/` (no `skills/` child),
    // readSkillDirs returns [] and dynamic collapses to static — this assertion
    // fails, catching the wiring regression the masking fixture used to hide.
    const report = await measureBridgeBudget();
    expect(report.dynamicTokens).toBeGreaterThan(report.staticTokens);
    expect(report.measuredTokens).toBe(report.dynamicTokens);
  });

  // ── Ceiling override ────────────────────────────────────────────

  it("flags violations when ceiling is tightened below current utilization", async () => {
    // Tighten the ceiling to 0.001% so every adapter exceeds.
    const report = await measureBridgeBudget({
      contentRoot: fx.rootDir,
      maxPercent: 0.001,
    });
    expect(report.maxPercent).toBe(0.001);
    expect(report.violations.length).toBe(report.perAdapter.length);
    for (const adapter of report.perAdapter) {
      expect(adapter.exceedsCeiling).toBe(true);
    }
  });

  it("clears violations when ceiling is loosened above all utilization", async () => {
    const report = await measureBridgeBudget({
      contentRoot: fx.rootDir,
      maxPercent: 99,
    });
    expect(report.violations).toEqual([]);
  });

  // ── Missing agents directory fallback ───────────────────────────

  it("falls back to the static bridge content when contentRoot is unavailable", async () => {
    const report = await measureBridgeBudget({
      contentRoot: join(fx.rootDir, "does-not-exist"),
    });
    expect(report.staticTokens).toBe(estimateTokens(BRIDGE_ORCHESTRATION.length));
    // No skill dirs to read → dynamic generation returns static base.
    expect(report.dynamicTokens).toBe(report.staticTokens);
    expect(report.measuredTokens).toBe(report.staticTokens);
  });

  // ── Text formatter ──────────────────────────────────────────────

  it("formats a human-readable report with adapter rows and a status footer", async () => {
    const report = await measureBridgeBudget({ contentRoot: fx.rootDir });
    const text = formatTextReport(report);
    expect(text).toMatch(/validate-bridge-budget:/);
    expect(text).toMatch(/static BRIDGE_ORCHESTRATION:/);
    expect(text).toMatch(/dynamic \(with skill table\):/);
    expect(text).toMatch(/Per-adapter utilization/);
    // Every tool should appear in the formatted output.
    for (const tool of Object.keys(CONTEXT_BUDGET_TOKENS)) {
      expect(text).toContain(tool);
    }
    expect(text).toMatch(/All \d+ adapters stay within 10% bridge-budget ceiling\./);
  });

  it("text formatter surfaces the FAIL marker and remediation hint on overage", async () => {
    const report = await measureBridgeBudget({
      contentRoot: fx.rootDir,
      maxPercent: 0.001,
    });
    const text = formatTextReport(report);
    expect(text).toMatch(/\[FAIL\]/);
    expect(text).toMatch(/exceed the 0\.001% bridge-budget ceiling/);
    expect(text).toMatch(/agentsContent\.ts BRIDGE_ORCHESTRATION/);
  });
});
