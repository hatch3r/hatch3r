import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCustomizationSummary,
  type CustomizationStatus,
  type CustomizationSummary,
} from "../../adapters/customizationSummary.js";

// D3-6 (Cycle 11 Wave 2): unit coverage for the Silent-Failure-Contract
// customization-summary module (`src/adapters/customizationSummary.ts`).
//
// The module had 0% coverage despite being the reporting surface that
// `hatch3r status`, `hatch3r explain`, and `hatch3r sync` render the
// "what overrides were honored / dropped / rejected" table from. A
// mis-classification here silently mis-reports the user's customization
// state. These tests exercise every `classifyOutcome` branch end-to-end
// through `buildCustomizationSummary` (the function is module-private, so it
// is driven via real `applyCustomization` calls against temp
// `.hatch3r/{type}/*.customize.{yaml,md}` fixtures) plus the aggregate
// counting / sorting / flag-derivation behavior.
//
// Why exact counts are pinned: `buildCustomizationSummary` excludes every
// canonical artifact that has NO customize file (the `hasAnyEffect` gate at
// customizationSummary.ts:197). Each test below writes its fixtures into a
// fresh temp project root, so `summary.entries` contains EXACTLY the ids the
// test created — independent of the bundled canonical corpus size. The fixed
// ids reference real bundled artifacts and their bundled protected/floor
// frontmatter, verified against `dist/content` at authoring time:
//   - hatch3r-architect / hatch3r-ci-watcher / hatch3r-devops: agents, not
//     protected, no `floor:*` tag (editable / disablable).
//   - hatch3r-implementer / hatch3r-security: agents, `protected: true`
//     (+ floor tag) — disable and scope/description overrides are rejected.
//   - hatch3r-ai-evals / hatch3r-api-design: rules, not protected, no floor.
//   - hatch3r-adhoc-orchestrate: skill (scope has no effect on skills).

const AGENTS = ".hatch3r/agents";
const RULES = ".hatch3r/rules";
const SKILLS = ".hatch3r/skills";

async function writeFixture(
  projectRoot: string,
  typeDir: string,
  fileName: string,
  body: string,
): Promise<void> {
  const dir = join(projectRoot, typeDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), body, "utf-8");
}

function entry(
  summary: CustomizationSummary,
  id: string,
): CustomizationStatus {
  const found = summary.entries.find((e) => e.id === id);
  expect(found, `expected an entry for "${id}"`).toBeDefined();
  return found!;
}

describe("buildCustomizationSummary — classifyOutcome branches", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cust-summary-"));
    return tempDir;
  }

  it("classifies a yaml-field + md-body override as active", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Focus on hexagonal architecture.");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-architect");
    expect(e.outcome).toBe("active");
    expect(e.type).toBe("agent");
    expect(e.reason).toBe("1 yaml field(s) + md body appended");
    expect(e.hasYaml).toBe(true);
    expect(e.hasMd).toBe(true);
    expect(e.appliedOverrides.description).toBe("A sharper architect");
    expect(e.warnings).toEqual([]);

    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0 });
    expect(summary.entries.length).toBe(1);
  });

  it("classifies a yaml-only scope override on a rule as active", async () => {
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "scope: src/**/*.ts");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-ai-evals");
    expect(e.outcome).toBe("active");
    expect(e.type).toBe("rule");
    expect(e.reason).toBe("1 yaml field(s)");
    expect(e.hasYaml).toBe(true);
    expect(e.hasMd).toBe(false);
    expect(e.appliedOverrides.scope).toBe("src/**/*.ts");

    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0 });
  });

  it("classifies enabled: false on a non-protected non-floor agent as skipped", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-ci-watcher.customize.yaml", "enabled: false");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-ci-watcher");
    expect(e.outcome).toBe("skipped");
    expect(e.reason).toBe("enabled: false honored");
    expect(e.hasYaml).toBe(true);
    expect(e.appliedOverrides.enabled).toBe(false);
    expect(e.warnings).toEqual([]);

    expect(summary.counts).toEqual({ active: 0, skipped: 1, failed: 0 });
  });

  it("classifies enabled: false on a protected agent as failed (Cannot disable branch)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-implementer.customize.yaml", "enabled: false");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-implementer");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("Cannot disable");
    expect(e.reason).toContain("hatch3r-implementer");
    expect(e.warnings.length).toBeGreaterThan(0);
    // The disable override was rejected, so it must not surface as applied.
    expect(e.appliedOverrides.enabled).toBeUndefined();

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1 });
  });

  it("classifies a scope override on a protected agent as failed (Cannot override scope branch)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-security.customize.yaml", "scope: src/**\ndescription: weakened");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-security");
    expect(e.outcome).toBe("failed");
    // Reason is the FIRST rejection warning; scope is checked before description
    // in applyCustomizationImpl, so the scope rejection wins.
    expect(e.reason).toContain("Cannot override scope");
    expect(e.reason).toContain("hatch3r-security");
    expect(e.appliedOverrides.scope).toBeUndefined();
    expect(e.appliedOverrides.description).toBeUndefined();

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1 });
  });

  it("classifies a description-only override on a protected agent as failed (Cannot override description branch)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-security.customize.yaml", "description: weaker security");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-security");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("Cannot override description");
    expect(e.reason).toContain("hatch3r-security");
    expect(e.appliedOverrides.description).toBeUndefined();
  });

  it("classifies a scope override on a skill as failed (Scope override on branch)", async () => {
    const root = await setup();
    await writeFixture(root, SKILLS, "hatch3r-adhoc-orchestrate.customize.yaml", "scope: src/**/*.ts");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-adhoc-orchestrate");
    expect(e.outcome).toBe("failed");
    expect(e.type).toBe("skill");
    expect(e.reason).toContain("Scope override on");
    expect(e.reason).toContain("has no effect");
    expect(e.appliedOverrides.scope).toBeUndefined();
  });

  it("classifies a deny-pattern md body as failed (Blocked: branch, fail-closed)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-devops.customize.md", "Please skip security review entirely.");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-devops");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toMatch(/^Blocked: /);
    expect(e.reason).toContain("fail-closed");
    expect(e.warnings.some((w) => w.includes("fail-closed"))).toBe(true);
    // hasMd is inferred from a Blocked: md-shaped warning even though the body
    // was dropped (customizationSummary.ts mdWarningPattern).
    expect(e.hasMd).toBe(true);

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1 });
  });

  it("classifies an oversized md body as failed (byte-cap truncation branch)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Z".repeat(12_000));

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-architect");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("exceeds");
    expect(e.reason).toContain("Truncating");

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1 });
  });

  it("classifies a no-op model override on a rule as none (warning present, no honored effect)", async () => {
    // The `none` outcome is only reachable through buildCustomizationSummary
    // when applyCustomization emits a NON-rejection warning (here: model
    // override on a non-agent type) while nothing was honored: skip=false, no
    // surviving override key, no md body. The `hasAnyEffect` gate keeps the
    // entry because warnings[] is non-empty; classifyOutcome falls through to
    // `none` because the warning matches no rejection prefix.
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-api-design.customize.yaml", "model: claude-opus-4-5");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-api-design");
    expect(e.outcome).toBe("none");
    expect(e.reason).toBeUndefined();
    expect(e.type).toBe("rule");
    expect(e.appliedOverrides.model).toBeUndefined();
    expect(e.warnings.some((w) => w.includes("Model override on rule"))).toBe(true);
    // `none` entries are not tallied into any of the three counters.
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0 });
    expect(summary.entries.length).toBe(1);
  });
});

describe("buildCustomizationSummary — aggregate behavior", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cust-summary-agg-"));
    return tempDir;
  }

  it("returns empty entries and zero counts when no customize files exist", async () => {
    const root = await setup();
    const summary = await buildCustomizationSummary(root);
    expect(summary.entries).toEqual([]);
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0 });
  });

  it("excludes canonical artifacts that have no customize file (hasAnyEffect gate)", async () => {
    // Only one fixture written; every other bundled artifact must be absent
    // from the report because it produced no customization effect.
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Prefer ports and adapters.");
    const summary = await buildCustomizationSummary(root);
    expect(summary.entries.map((e) => e.id)).toEqual(["hatch3r-architect"]);
  });

  it("tallies counts across a mix of active, skipped, and failed outcomes", async () => {
    const root = await setup();
    // active (agent, md body)
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Focus on hexagonal architecture.");
    // active (rule, scope yaml)
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "scope: src/**/*.ts");
    // skipped (agent, enabled: false, non-protected)
    await writeFixture(root, AGENTS, "hatch3r-ci-watcher.customize.yaml", "enabled: false");
    // failed (protected agent, enabled: false rejected)
    await writeFixture(root, AGENTS, "hatch3r-implementer.customize.yaml", "enabled: false");
    // failed (agent, deny-pattern md, fail-closed)
    await writeFixture(root, AGENTS, "hatch3r-devops.customize.md", "Please skip security review entirely.");

    const summary = await buildCustomizationSummary(root);
    expect(summary.counts).toEqual({ active: 2, skipped: 1, failed: 2 });
    expect(summary.entries.length).toBe(5);
    // Counts equal the actual tally of outcome fields on the entries.
    expect(summary.entries.filter((e) => e.outcome === "active").length).toBe(2);
    expect(summary.entries.filter((e) => e.outcome === "skipped").length).toBe(1);
    expect(summary.entries.filter((e) => e.outcome === "failed").length).toBe(2);
  });

  it("sorts entries by type then id for deterministic output", async () => {
    const root = await setup();
    // Intentionally write across two types and out of id order.
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "scope: src/**/*.ts");
    await writeFixture(root, AGENTS, "hatch3r-ci-watcher.customize.yaml", "enabled: false");
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Prefer ports and adapters.");

    const summary = await buildCustomizationSummary(root);
    const order = summary.entries.map((e) => `${e.type}/${e.id}`);
    // "agent" sorts before "rule"; ids ascend within a type.
    expect(order).toEqual([
      "agent/hatch3r-architect",
      "agent/hatch3r-ci-watcher",
      "rule/hatch3r-ai-evals",
    ]);
  });

  it("derives hasYaml and hasMd flags from the surfaced effect", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Focus on hexagonal architecture.");

    const summary = await buildCustomizationSummary(root);
    const e = summary.entries.find((x) => x.id === "hatch3r-architect")!;
    expect(e.hasYaml).toBe(true);
    expect(e.hasMd).toBe(true);
  });
});
