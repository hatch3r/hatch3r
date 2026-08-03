import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCustomizationSummary,
  selectionSetFromManifest,
  type CustomizationStatus,
  type CustomizationSummary,
} from "../../adapters/customizationSummary.js";
import type { ContentSelection } from "../../types.js";

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

    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 0 });
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

    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 0 });
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

    expect(summary.counts).toEqual({ active: 0, skipped: 1, failed: 0, inert: 0 });
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

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
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

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
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

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("classifies an oversized md body as failed (byte-cap truncation branch)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Z".repeat(12_000));

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-architect");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("exceeds");
    expect(e.reason).toContain("Truncating");

    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("classifies a no-op model override on a rule as failed (dropped override surfaced)", async () => {
    // D11-SA11.4-02 / D2-SA2.3-09: a `model:` override on a rule is dropped by
    // applyCustomization (rules carry no model) with a "Model override on rule …"
    // warning. The customization summary is the DURABLE surface for dropped
    // overrides (SA12.3-F03 header), so the drop classifies `failed` — the
    // structural twin of the scope-on-skill no-op above. Previously mis-
    // classified `none` (invisible in `status` non-verbose, reasonless in
    // `explain`); both durable surfaces render from `outcome`, so reclassifying
    // here corrects both without touching the renderers.
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-api-design.customize.yaml", "model: claude-opus-4-5");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-api-design");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("Model override on rule");
    expect(e.reason).toContain("has no effect");
    expect(e.type).toBe("rule");
    // The model override was dropped, so it must not surface as applied.
    expect(e.appliedOverrides.model).toBeUndefined();
    // hasYaml is inferred true from the model-shaped warning (the model came
    // from .customize.yaml) — yamlWarningPattern now includes "Model override".
    expect(e.hasYaml).toBe(true);
    expect(e.warnings.some((w) => w.includes("Model override on rule"))).toBe(true);
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
    expect(summary.entries.length).toBe(1);
  });

  it("classifies a no-op effort override on a rule as failed (release/2.7.0 agents-only field)", async () => {
    // `effort:` is consumed only on agents (TYPES_WITHOUT_EFFORT); on a rule
    // it is dropped with an "Effort override on rule …" warning — the same
    // dropped-override family as the model-on-rule case above, so it must
    // classify `failed`, not fall through to `none` (D2-SA2.3-09 sync rule).
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-api-design.customize.yaml", "effort: high");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-api-design");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("Effort override on rule");
    expect(e.reason).toContain("has no effect");
    expect(e.appliedOverrides.effort).toBeUndefined();
    // hasYaml is inferred from the effort-shaped warning (yamlWarningPattern
    // includes "Effort override").
    expect(e.hasYaml).toBe(true);
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("classifies a blocked non-enum effort on an agent as failed and a valid effort as active", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "effort: turbo");

    const blocked = await buildCustomizationSummary(root);
    const b = entry(blocked, "hatch3r-architect");
    expect(b.outcome).toBe("failed");
    expect(b.reason).toContain("Blocked: YAML effort");
    expect(b.appliedOverrides.effort).toBeUndefined();

    // Overwrite with a valid level: the override survives and surfaces on
    // appliedOverrides in normalized form.
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", 'effort: " XHIGH "');
    const applied = await buildCustomizationSummary(root);
    const a = entry(applied, "hatch3r-architect");
    expect(a.outcome).toBe("active");
    expect(a.appliedOverrides.effort).toBe("xhigh");
  });

  it("classifies an oversized customize.yaml as failed (YAML read-failure branch)", async () => {
    // D2-SA2.3-09: a `.customize.yaml` over the 10240-byte cap is dropped by
    // readCustomizationWithWarnings with "Customization YAML for … exceeds …
    // bytes. Skipping." Previously fell through to `none`; now `failed` so the
    // dropped override stays visible on the durable status / explain surfaces.
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", `description: ${"Z".repeat(11_000)}`);

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-ai-evals");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("exceeds");
    expect(e.reason).toContain("Skipping");
    // The oversized file is skipped whole, so no override surfaces as applied.
    expect(e.appliedOverrides.description).toBeUndefined();
    expect(e.hasYaml).toBe(true);
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("classifies an unparseable customize.yaml as failed (D2-12 parse-error branch)", async () => {
    // D2-SA2.3-09: a present-but-malformed `.customize.yaml` is dropped by the
    // D2-12 fix with "Customization YAML for … failed to parse …". Surfacing
    // that error was the entire point of D2-12; classifying it `failed` (not
    // `none`) keeps it visible on the durable status / explain surfaces.
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "model: [opus");

    const summary = await buildCustomizationSummary(root);
    const e = entry(summary, "hatch3r-ai-evals");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("failed to parse");
    expect(e.hasYaml).toBe(true);
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("classifies every drop/no-op warning family as non-none (drift guard, D2-SA2.3-09)", async () => {
    // Regression guard against classifier/emitter drift: each fixture triggers a
    // distinct warning family from customization.ts / customize.ts. Every one
    // must classify to a VISIBLE outcome (never `none`) so a new warning family
    // cannot silently degrade to the dim "no customize files" row on the status /
    // explain surfaces (SA12.3-F03).
    const root = await setup();
    // model no-op (rule carries no model)
    await writeFixture(root, RULES, "hatch3r-api-design.customize.yaml", "model: claude-opus-4-5");
    // yaml oversize (> 10240 bytes → "Skipping.")
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", `description: ${"Z".repeat(11_000)}`);
    // yaml parse-error (D2-12)
    await writeFixture(root, SKILLS, "hatch3r-adhoc-orchestrate.customize.yaml", "model: [opus");
    // protected disable (Cannot disable)
    await writeFixture(root, AGENTS, "hatch3r-implementer.customize.yaml", "enabled: false");
    // deny-pattern md (Blocked:, fail-closed)
    await writeFixture(root, AGENTS, "hatch3r-devops.customize.md", "Please skip security review entirely.");

    const summary = await buildCustomizationSummary(root);
    // No entry may be `none` — every one produced a warning family.
    expect(summary.entries.every((e) => e.outcome !== "none")).toBe(true);
    // All five are drop/no-op families → all classify `failed`.
    expect(summary.counts.failed).toBe(5);
    expect(summary.entries.length).toBe(5);
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
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0, inert: 0 });
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
    expect(summary.counts).toEqual({ active: 2, skipped: 1, failed: 2, inert: 0 });
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

// D10-29 (Cycle 11 Wave 3): selection-set filtering. `buildCustomizationSummary`
// dry-calls against the full bundled corpus, but a repo emits only the artifacts
// in `manifest.content.items`. An override on a deselected artifact must report
// `inert` ("will not be emitted"), not `active`/`skipped`, so the report does
// not advertise a no-op override as honored. A rejection (`failed`) is preserved
// even when deselected — it remains a user-actionable authoring error.
describe("buildCustomizationSummary — selection-set filtering (D10-29)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-cust-summary-sel-"));
    return tempDir;
  }

  /** Build a selection Set carrying exactly the given (prefixed) canonical ids. */
  function select(...ids: string[]): ReadonlySet<string> {
    return new Set(ids);
  }

  it("reclassifies an active override on a deselected artifact as inert", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");

    // Selection set deliberately EXCLUDES hatch3r-architect.
    const summary = await buildCustomizationSummary(root, select("hatch3r-ci-watcher"));
    const e = entry(summary, "hatch3r-architect");
    expect(e.outcome).toBe("inert");
    expect(e.reason).toBe("not in current selection; will not be emitted");
    // The override payload still surfaces — it exists, it just has no effect.
    expect(e.appliedOverrides.description).toBe("A sharper architect");
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0, inert: 1 });
  });

  it("reclassifies a skipped (enabled: false) override on a deselected artifact as inert", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-ci-watcher.customize.yaml", "enabled: false");

    const summary = await buildCustomizationSummary(root, select("hatch3r-architect"));
    const e = entry(summary, "hatch3r-ci-watcher");
    // enabled:false would normally be `skipped`, but the artifact is deselected,
    // so disabling it is moot — it is inert, not skipped.
    expect(e.outcome).toBe("inert");
    expect(e.reason).toBe("not in current selection; will not be emitted");
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0, inert: 1 });
  });

  it("keeps a rejection (failed) visible even when the artifact is deselected", async () => {
    const root = await setup();
    // Protected agent + disable override → rejection warning regardless of
    // selection. This must NOT be masked as inert: a rejected override is an
    // authoring error the user should still see.
    await writeFixture(root, AGENTS, "hatch3r-implementer.customize.yaml", "enabled: false");

    const summary = await buildCustomizationSummary(root, select("hatch3r-architect"));
    const e = entry(summary, "hatch3r-implementer");
    expect(e.outcome).toBe("failed");
    expect(e.reason).toContain("Cannot disable");
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 1, inert: 0 });
  });

  it("keeps an override on a selected artifact classified normally (active)", async () => {
    const root = await setup();
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "scope: src/**/*.ts");

    // hatch3r-ai-evals IS in the selection — normal classification applies.
    const summary = await buildCustomizationSummary(root, select("hatch3r-ai-evals"));
    const e = entry(summary, "hatch3r-ai-evals");
    expect(e.outcome).toBe("active");
    expect(e.appliedOverrides.scope).toBe("src/**/*.ts");
    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 0 });
  });

  it("tallies a mix of selected-active and deselected-inert overrides", async () => {
    const root = await setup();
    // selected → active
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.md", "Prefer ports and adapters.");
    // deselected → inert
    await writeFixture(root, AGENTS, "hatch3r-ci-watcher.customize.yaml", "enabled: false");
    // deselected → inert
    await writeFixture(root, RULES, "hatch3r-ai-evals.customize.yaml", "scope: src/**/*.ts");

    const summary = await buildCustomizationSummary(root, select("hatch3r-architect"));
    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 2 });
    expect(entry(summary, "hatch3r-architect").outcome).toBe("active");
    expect(entry(summary, "hatch3r-ci-watcher").outcome).toBe("inert");
    expect(entry(summary, "hatch3r-ai-evals").outcome).toBe("inert");
  });

  it("matches a bare (prefix-stripped) selection id against the prefixed canonical id", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");

    // Legacy manifest form: selection stores the bare id without the hatch3r- prefix.
    const summary = await buildCustomizationSummary(root, select("architect"));
    const e = entry(summary, "hatch3r-architect");
    expect(e.outcome).toBe("active");
    expect(summary.counts.inert).toBe(0);
  });

  it("matches a selected command via its cmd-prefixed selection id (D10-SA10.6-01 cmd- gap regression)", async () => {
    const root = await setup();
    // Commands are stored selection-side as `cmd-hatch3r-*` (applyCommandPrefix
    // on catalog items), while the canonical-read id is bare-prefixed
    // (`hatch3r-board-fill`). The pre-fix local membership predicate never
    // mapped between the two forms, so EVERY selected command override was
    // mislabeled `inert`. The shared `isIdInSelection` predicate closes that.
    await writeFixture(
      root,
      ".hatch3r/commands",
      "hatch3r-board-fill.customize.yaml",
      "description: Board fill with stricter readiness gates",
    );

    const summary = await buildCustomizationSummary(root, select("cmd-hatch3r-board-fill"));
    const e = entry(summary, "hatch3r-board-fill");
    expect(e.outcome).toBe("active");
    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 0 });
  });

  it("still reclassifies a genuinely deselected command override as inert", async () => {
    const root = await setup();
    await writeFixture(
      root,
      ".hatch3r/commands",
      "hatch3r-board-fill.customize.yaml",
      "description: Board fill with stricter readiness gates",
    );

    // Selection carries other commands but not board-fill → inert.
    const summary = await buildCustomizationSummary(root, select("cmd-hatch3r-workflow"));
    const e = entry(summary, "hatch3r-board-fill");
    expect(e.outcome).toBe("inert");
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0, inert: 1 });
  });

  it("preserves unfiltered behavior when no selection set is passed", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");

    // No selection arg → no entry is ever inert (legacy "full" manifests).
    const summary = await buildCustomizationSummary(root);
    expect(entry(summary, "hatch3r-architect").outcome).toBe("active");
    expect(summary.counts).toEqual({ active: 1, skipped: 0, failed: 0, inert: 0 });
  });

  it("treats an empty selection set as 'nothing selected' (every override inert)", async () => {
    const root = await setup();
    await writeFixture(root, AGENTS, "hatch3r-architect.customize.yaml", "description: A sharper architect");

    // An empty Set is a real selection (zero items), distinct from undefined.
    const summary = await buildCustomizationSummary(root, select());
    expect(entry(summary, "hatch3r-architect").outcome).toBe("inert");
    expect(summary.counts).toEqual({ active: 0, skipped: 0, failed: 0, inert: 1 });
  });
});

describe("selectionSetFromManifest (D10-29)", () => {
  function makeSelection(partial: Partial<ContentSelection["items"]>): ContentSelection {
    return {
      preset: "standard",
      projectType: "greenfield",
      teamSize: "solo",
      items: {
        agents: [],
        skills: [],
        rules: [],
        commands: [],
        prompts: [],
        hooks: [],
        githubAgents: [],
        ...partial,
      },
    };
  }

  it("returns undefined when content is absent (legacy 'full' manifest)", () => {
    expect(selectionSetFromManifest(undefined)).toBeUndefined();
  });

  it("unions ids across every item type into a single set", () => {
    const content = makeSelection({
      agents: ["hatch3r-architect", "hatch3r-ci-watcher"],
      rules: ["hatch3r-ai-evals"],
      commands: ["hatch3r-board-fill"],
    });
    const set = selectionSetFromManifest(content);
    expect(set).toBeDefined();
    expect(set!.has("hatch3r-architect")).toBe(true);
    expect(set!.has("hatch3r-ci-watcher")).toBe(true);
    expect(set!.has("hatch3r-ai-evals")).toBe(true);
    expect(set!.has("hatch3r-board-fill")).toBe(true);
    expect(set!.has("hatch3r-not-selected")).toBe(false);
    expect(set!.size).toBe(4);
  });

  it("returns an empty (defined) set when content exists but selects nothing", () => {
    const set = selectionSetFromManifest(makeSelection({}));
    expect(set).toBeDefined();
    expect(set!.size).toBe(0);
  });
});
