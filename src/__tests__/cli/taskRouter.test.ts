import { describe, it, expect } from "vitest";
import { buildTaskRouterModel } from "../../cli/shared/taskRouter.js";
import type { ContentIndex, CatalogItem } from "../../content/index.js";
import { resolveTestPath } from "../fixtures.js";

// D1-SA1.7-F9 (Cycle 10 Wave 4): split out of the former agentsContent.test.ts
// when agentsContent.ts was decomposed into per-concern modules. These cases
// cover the task-router model in isolation, importing it directly from
// `taskRouter.ts` to demonstrate the module is independently coverable.

/**
 * Build a minimal ContentIndex stub from literal items — exercises
 * buildTaskRouterModel without touching disk.
 */
function makeIndex(items: CatalogItem[]): ContentIndex {
  const byType: Record<string, CatalogItem[]> = {};
  const byId = new Map<string, CatalogItem>();
  const byTypeAndId = new Map<string, CatalogItem>();
  for (const item of items) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
    byId.set(item.id, item);
    byTypeAndId.set(`${item.type}:${item.id}`, item);
  }
  return { items, byType, byId, byTypeAndId, collisions: [] };
}

function agent(id: string, tags: string[]): CatalogItem {
  return { id, type: "agent", description: `agent ${id}`, tags, relativePath: `agents/${id}.md`, source: "canonical" };
}
function skill(id: string, tags: string[]): CatalogItem {
  return { id, type: "skill", description: `skill ${id}`, tags, relativePath: `skills/${id}`, source: "canonical" };
}
function rule(id: string, tags: string[]): CatalogItem {
  return { id, type: "rule", description: `rule ${id}`, tags, relativePath: `rules/${id}.md`, source: "canonical" };
}
/**
 * Commands live in the content index under the `cmd-` prefix applied by
 * `applyCommandPrefix`. Tests that build synthetic indexes must match that
 * convention so the renderer's slash-command stripping logic is exercised.
 */
function command(id: string, tags: string[]): CatalogItem {
  const prefixed = id.startsWith("cmd-") ? id : `cmd-${id}`;
  return {
    id: prefixed,
    type: "command",
    description: `command ${id}`,
    tags,
    relativePath: `commands/${id}.md`,
    source: "canonical",
  };
}

describe("buildTaskRouterModel", () => {
  it("produces one row per capability (workflow) tag that has at least one matching agent", () => {
    // Wave 1 of the content-pack redesign renamed the capability tags:
    // the old `core` tag is now `orchestration` (capability facet) per
    // src/content/tags.ts. The router maps capability tags to workflow rows
    // via tagsForFacet("capability"). The fixture exercises the new names.
    const index = makeIndex([
      agent("hatch3r-implementer", ["orchestration", "implementation"]),
      agent("hatch3r-reviewer", ["orchestration", "review"]),
      agent("hatch3r-devops", ["devops"]),
      skill("hatch3r-feature", ["orchestration", "implementation"]),
      rule("hatch3r-code-standards", ["orchestration"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const byTag = new Map(rows.map((r) => [r.tag, r]));

    // Capability tags present: orchestration, implementation, review, devops.
    expect(byTag.has("orchestration")).toBe(true);
    expect(byTag.has("implementation")).toBe(true);
    expect(byTag.has("review")).toBe(true);
    expect(byTag.has("devops")).toBe(true);

    // Tags with no matching agent should be skipped.
    expect(byTag.has("planning")).toBe(false);
    expect(byTag.has("maintenance")).toBe(false);
  });

  it("picks the id-matching agent as primary", () => {
    // F16.3-H1 (Cycle 10 Wave 1C): legacy a11y-auditor + security-auditor
    // collapsed into CQ specialists. The test uses CQ specialists as
    // alphabetical-tie-break fallback fixtures because the legacy ids no
    // longer exist on disk.
    const index = makeIndex([
      agent("hatch3r-reviewer", ["core", "review"]),
      agent("hatch3r-security", ["review", "security"]),
      agent("hatch3r-ui", ["review", "a11y"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const reviewRow = rows.find((r) => r.tag === "review");
    expect(reviewRow).toBeDefined();
    expect(reviewRow!.primary).toEqual({ kind: "agent", id: "hatch3r-reviewer" });
    // Specialists appear as fallbacks in alphabetical order.
    expect(reviewRow!.fallbackAgents).toEqual([
      "hatch3r-security",
      "hatch3r-ui",
    ]);
  });

  it("produces domain-tag rows for floor + customize + ui-ux specialisations", () => {
    // Wave 1 split the old DOMAIN_TAGS array into floor markers (`floor:*`),
    // customize, and ui-ux-specialisation tags; the router now concatenates
    // the three facets when emitting domain rows. The `a11y` row picks up
    // the id-substring match on the skill (hatch3r-a11y-audit) under the
    // unchanged rankItemForTag scoring; the `floor:security` row no longer
    // benefits from id substring matching (ids don't carry the `floor:`
    // prefix), so the primary falls back to the alphabetical tie-break —
    // that behaviour is exercised here so a regression is loud.
    // F16.3-H1 (Cycle 10 Wave 1C): legacy auditor ids replaced with CQ
    // specialists (hatch3r-security carries floor:security; hatch3r-ui
    // carries the a11y tag per its WCAG scope; legacy a11y-auditor's
    // alphabetical-id role is filled by hatch3r-maintainability as a
    // second floor:security peer tag for the tie-break assertion).
    const index = makeIndex([
      agent("hatch3r-security", ["review", "floor:security"]),
      agent("hatch3r-maintainability", ["maintenance", "floor:security"]),
      agent("hatch3r-ui", ["review", "a11y"]),
      skill("hatch3r-a11y-audit", ["review", "a11y"]),
      rule("hatch3r-security-patterns", ["floor:security"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const securityRow = rows.find((r) => r.tag === "floor:security");
    expect(securityRow).toBeDefined();
    expect(securityRow!.tagKind).toBe("domain");
    // Both `hatch3r-security` and `hatch3r-maintainability` tie on the rank
    // vector (neither id contains `floor:security` or its 5-char prefix
    // `floor`); alphabetical id wins, so maintainability is primary.
    expect(securityRow!.primary).toEqual({ kind: "agent", id: "hatch3r-maintainability" });
    expect(securityRow!.fallbackAgents).toContain("hatch3r-security");
    expect(securityRow!.relevantRules).toEqual(["hatch3r-security-patterns"]);

    const a11yRow = rows.find((r) => r.tag === "a11y");
    expect(a11yRow).toBeDefined();
    // The skill `hatch3r-a11y-audit` contains the `a11y` substring at a
    // higher rank than the agent `hatch3r-ui` (no substring match), but
    // agents outrank skills at the type tier, so `hatch3r-ui` wins primary.
    expect(a11yRow!.primary).toEqual({ kind: "agent", id: "hatch3r-ui" });
    expect(a11yRow!.relevantSkills).toEqual(["hatch3r-a11y-audit"]);
  });

  it("falls back to a command when a tag has no matching agent", () => {
    // `board` has commands only — no agent carries the tag.
    const index = makeIndex([
      agent("hatch3r-implementer", ["core", "implementation"]),
      command("hatch3r-board-pickup", ["board", "team"]),
      command("hatch3r-board-fill", ["board", "team"]),
      rule("hatch3r-board-hygiene", ["board"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const boardRow = rows.find((r) => r.tag === "board");
    expect(boardRow).toBeDefined();
    expect(boardRow!.primary.kind).toBe("command");
    // `hatch3r-board-fill` and `hatch3r-board-pickup` tie on rank vector;
    // alphabetical tie-break puts "fill" first in the prefixed id space.
    expect(boardRow!.primary.id).toBe("cmd-hatch3r-board-fill");
    // Fallback agents list only contains agents — commands don't spill over.
    expect(boardRow!.fallbackAgents).toEqual([]);
    expect(boardRow!.relevantRules).toEqual(["hatch3r-board-hygiene"]);
  });

  it("falls back to a skill when a tag has no matching agent or command", () => {
    const index = makeIndex([
      agent("hatch3r-implementer", ["core", "implementation"]),
      skill("hatch3r-perf-audit", ["performance"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const perfRow = rows.find((r) => r.tag === "performance");
    expect(perfRow).toBeDefined();
    expect(perfRow!.primary).toEqual({ kind: "skill", id: "hatch3r-perf-audit" });
    expect(perfRow!.fallbackAgents).toEqual([]);
    expect(perfRow!.relevantSkills).toEqual(["hatch3r-perf-audit"]);
  });

  it("prefers agent over command over skill for the primary entry", () => {
    // All three content types tag `customize`; agent must win.
    const index = makeIndex([
      agent("hatch3r-customizer", ["customize"]),
      command("hatch3r-customize-runner", ["customize"]),
      skill("hatch3r-customize", ["customize"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const customizeRow = rows.find((r) => r.tag === "customize")!;
    expect(customizeRow.primary).toEqual({ kind: "agent", id: "hatch3r-customizer" });
  });

  it("skips rows whose tag has no matching agent, command, or skill", () => {
    // No content of any kind carries `maintenance` or `planning`.
    const index = makeIndex([
      agent("hatch3r-implementer", ["core", "implementation"]),
    ]);

    const rows = buildTaskRouterModel(index);
    // Every row has a primary populated.
    expect(rows.every((r) => r.primary && r.primary.id)).toBe(true);
    expect(rows.some((r) => r.tag === "board")).toBe(false);
    expect(rows.some((r) => r.tag === "customize")).toBe(false);
    expect(rows.some((r) => r.tag === "performance")).toBe(false);
    expect(rows.some((r) => r.tag === "maintenance")).toBe(false);
    expect(rows.some((r) => r.tag === "planning")).toBe(false);
  });

  it("returns alphabetised fallbacks when ranking ties", () => {
    const index = makeIndex([
      agent("hatch3r-alpha-impl", ["core", "implementation"]),
      agent("hatch3r-bravo-impl", ["core", "implementation"]),
      agent("hatch3r-charlie-impl", ["core", "implementation"]),
    ]);
    const rows = buildTaskRouterModel(index);
    const implRow = rows.find((r) => r.tag === "implementation")!;
    // No id contains "implementation" fully — "impl" prefix alone doesn't match.
    // All three have identical ranks and fall through to alphabetical order.
    expect(implRow.primary).toEqual({ kind: "agent", id: "hatch3r-alpha-impl" });
    expect(implRow.fallbackAgents).toEqual([
      "hatch3r-bravo-impl",
      "hatch3r-charlie-impl",
    ]);
  });

  it("populates relevantSkills and relevantRules from matching tags", () => {
    const index = makeIndex([
      agent("hatch3r-devops", ["devops"]),
      skill("hatch3r-ci-pipeline", ["devops"]),
      skill("hatch3r-release", ["devops"]),
      rule("hatch3r-ci-cd", ["devops"]),
    ]);
    const rows = buildTaskRouterModel(index);
    const devopsRow = rows.find((r) => r.tag === "devops")!;
    expect(devopsRow.relevantSkills).toEqual(["hatch3r-ci-pipeline", "hatch3r-release"]);
    expect(devopsRow.relevantRules).toEqual(["hatch3r-ci-cd"]);
  });
});

describe("buildTaskRouterModel against canonical content", () => {
  it("surfaces board and customize rows from the installed repo content", async () => {
    // Drive the real index builder against the repo root to verify that
    // C2's 9-row output grows to 11 rows once command/skill fallbacks land.
    const { buildContentIndex } = await import("../../content/index.js");
    // From src/__tests__/cli/taskRouter.test.ts → repo root is ../../../.
    const repoRoot = resolveTestPath(import.meta.url, "../../../");
    const index = await buildContentIndex(repoRoot);
    const rows = buildTaskRouterModel(index);

    const byTag = new Map(rows.map((r) => [r.tag, r]));
    expect(byTag.has("board")).toBe(true);
    expect(byTag.has("customize")).toBe(true);

    // Board has no agent owner so the primary must be a command.
    expect(byTag.get("board")!.primary.kind).toBe("command");
    // Customize now has an agent owner (hatch3r-creator, added in v1.7.0
    // for the /hatch3r-create flow) so the primary resolves to that agent
    // under the priority order (agent → command → skill).
    expect(byTag.get("customize")!.primary.kind).toBe("agent");
  });
});
