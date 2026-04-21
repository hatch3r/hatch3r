import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildTaskRouterModel,
  generateBridgeOrchestration,
} from "../../cli/shared/agentsContent.js";
import type { ContentIndex, CatalogItem } from "../../content/index.js";
import { resolveTestPath } from "../fixtures.js";

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
  return { id, type: "agent", description: `agent ${id}`, tags, relativePath: `agents/${id}.md` };
}
function skill(id: string, tags: string[]): CatalogItem {
  return { id, type: "skill", description: `skill ${id}`, tags, relativePath: `skills/${id}` };
}
function rule(id: string, tags: string[]): CatalogItem {
  return { id, type: "rule", description: `rule ${id}`, tags, relativePath: `rules/${id}.md` };
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
  };
}

describe("buildTaskRouterModel", () => {
  it("produces one row per workflow tag that has at least one matching agent", () => {
    const index = makeIndex([
      agent("hatch3r-implementer", ["core", "implementation"]),
      agent("hatch3r-reviewer", ["core", "review"]),
      agent("hatch3r-devops", ["devops"]),
      skill("hatch3r-feature", ["core", "implementation"]),
      rule("hatch3r-code-standards", ["core"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const byTag = new Map(rows.map((r) => [r.tag, r]));

    // Workflow tags present: core, implementation, review, devops.
    expect(byTag.has("core")).toBe(true);
    expect(byTag.has("implementation")).toBe(true);
    expect(byTag.has("review")).toBe(true);
    expect(byTag.has("devops")).toBe(true);

    // Tags with no matching agent should be skipped.
    expect(byTag.has("planning")).toBe(false);
    expect(byTag.has("maintenance")).toBe(false);
  });

  it("picks the id-matching agent as primary", () => {
    const index = makeIndex([
      agent("hatch3r-reviewer", ["core", "review"]),
      agent("hatch3r-a11y-auditor", ["review", "a11y"]),
      agent("hatch3r-security-auditor", ["review", "security"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const reviewRow = rows.find((r) => r.tag === "review");
    expect(reviewRow).toBeDefined();
    expect(reviewRow!.primary).toEqual({ kind: "agent", id: "hatch3r-reviewer" });
    // Specialists appear as fallbacks in alphabetical order.
    expect(reviewRow!.fallbackAgents).toEqual([
      "hatch3r-a11y-auditor",
      "hatch3r-security-auditor",
    ]);
  });

  it("produces domain-tag rows with specialist agents as primary", () => {
    const index = makeIndex([
      agent("hatch3r-security-auditor", ["review", "security"]),
      agent("hatch3r-dependency-auditor", ["maintenance", "security"]),
      agent("hatch3r-a11y-auditor", ["review", "a11y"]),
      skill("hatch3r-a11y-audit", ["review", "a11y"]),
      rule("hatch3r-security-patterns", ["security"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const securityRow = rows.find((r) => r.tag === "security");
    expect(securityRow).toBeDefined();
    expect(securityRow!.tagKind).toBe("domain");
    expect(securityRow!.primary).toEqual({ kind: "agent", id: "hatch3r-security-auditor" });
    expect(securityRow!.fallbackAgents).toContain("hatch3r-dependency-auditor");
    expect(securityRow!.relevantRules).toEqual(["hatch3r-security-patterns"]);

    const a11yRow = rows.find((r) => r.tag === "a11y");
    expect(a11yRow).toBeDefined();
    expect(a11yRow!.primary).toEqual({ kind: "agent", id: "hatch3r-a11y-auditor" });
    expect(a11yRow!.relevantSkills).toEqual(["hatch3r-a11y-audit"]);
  });

  it("falls back to a command when a tag has no matching agent", () => {
    // `board` has commands only — no agent carries the tag.
    const index = makeIndex([
      agent("hatch3r-implementer", ["core", "implementation"]),
      command("hatch3r-board-pickup", ["board", "team"]),
      command("hatch3r-board-init", ["board", "team"]),
      rule("hatch3r-board-hygiene", ["board"]),
    ]);

    const rows = buildTaskRouterModel(index);
    const boardRow = rows.find((r) => r.tag === "board");
    expect(boardRow).toBeDefined();
    expect(boardRow!.primary.kind).toBe("command");
    // `hatch3r-board-init` and `hatch3r-board-pickup` tie on rank vector;
    // alphabetical tie-break puts "init" first in the prefixed id space.
    expect(boardRow!.primary.id).toBe("cmd-hatch3r-board-init");
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
      command("hatch3r-agent-customize", ["customize"]),
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

describe("generateBridgeOrchestration — Task Type routing", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-bridge-c2-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedContent(): Promise<void> {
    await mkdir(join(tempDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "rules"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-feature"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-a11y-audit"), { recursive: true });

    await writeFile(
      join(tempDir, "agents", "hatch3r-implementer.md"),
      "---\nid: hatch3r-implementer\ntype: agent\ndescription: Implementation agent\ntags: [core, implementation]\n---\n# Implementer\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "agents", "hatch3r-reviewer.md"),
      "---\nid: hatch3r-reviewer\ntype: agent\ndescription: Review agent\ntags: [core, review]\n---\n# Reviewer\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "agents", "hatch3r-a11y-auditor.md"),
      "---\nid: hatch3r-a11y-auditor\ntype: agent\ndescription: a11y auditor\ntags: [review, a11y]\n---\n# A11y\n",
      "utf-8",
    );

    await writeFile(
      join(tempDir, "rules", "hatch3r-code-standards.md"),
      "---\nid: hatch3r-code-standards\ntype: rule\ndescription: Code standards\ntags: [core]\n---\n# Standards\n",
      "utf-8",
    );

    await writeFile(
      join(tempDir, "skills", "hatch3r-feature", "SKILL.md"),
      "---\nid: hatch3r-feature\ntype: skill\ndescription: Feature workflow skill\ntags: [core, implementation]\n---\n# Feature\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "hatch3r-a11y-audit", "SKILL.md"),
      "---\nid: hatch3r-a11y-audit\ntype: skill\ndescription: Accessibility audit skill\ntags: [review, a11y]\n---\n# A11y Audit\n",
      "utf-8",
    );
  }

  it("appends the Task Type → Routing section with at least one non-empty row", async () => {
    await seedContent();
    const output = await generateBridgeOrchestration(tempDir);

    expect(output).toContain("## Task Type → Routing");
    // The table header is emitted exactly once and now lists Primary without
    // the "Agent" qualifier because the cell can hold a command or skill too.
    const headerMatches = output.match(/\| Task Type \| Primary \| Fallback Agents \| Skills \| Rules \|/g);
    expect(headerMatches).not.toBeNull();
    expect(headerMatches!.length).toBe(1);

    // A concrete row: "review" primary should be hatch3r-reviewer (bare backtick = agent kind).
    expect(output).toMatch(/\| review \| `hatch3r-reviewer` \|/);
  });

  it("renders a command primary with a slash prefix and strips the cmd- index prefix", async () => {
    // Seed only a command tagged `board` — no agent carries it.
    await mkdir(join(tempDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "commands"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-feature"), { recursive: true });

    await writeFile(
      join(tempDir, "agents", "hatch3r-implementer.md"),
      "---\nid: hatch3r-implementer\ntype: agent\ndescription: Implementation agent\ntags: [core, implementation]\n---\n# Impl\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "commands", "hatch3r-board-pickup.md"),
      "---\nid: hatch3r-board-pickup\ntype: command\ndescription: Board pickup\ntags: [board, team]\n---\n# Pickup\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "hatch3r-feature", "SKILL.md"),
      "---\nid: hatch3r-feature\ntype: skill\ndescription: Feature workflow\ntags: [core, implementation]\n---\n# Feature\n",
      "utf-8",
    );

    const output = await generateBridgeOrchestration(tempDir);
    // Slash prefix on the id, no `cmd-` leak, and no `_(skill)_` marker.
    expect(output).toMatch(/\| board \| `\/hatch3r-board-pickup` \|/);
    expect(output).not.toContain("cmd-hatch3r-board-pickup");
  });

  it("renders a skill primary with a _(skill)_ kind hint", async () => {
    // Seed only a skill tagged `performance` — no agent or command carries it.
    await mkdir(join(tempDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-perf-audit"), { recursive: true });
    await mkdir(join(tempDir, "skills", "hatch3r-feature"), { recursive: true });

    await writeFile(
      join(tempDir, "agents", "hatch3r-implementer.md"),
      "---\nid: hatch3r-implementer\ntype: agent\ndescription: Implementation agent\ntags: [core, implementation]\n---\n# Impl\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "hatch3r-perf-audit", "SKILL.md"),
      "---\nid: hatch3r-perf-audit\ntype: skill\ndescription: Performance audit skill\ntags: [performance]\n---\n# Perf\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "hatch3r-feature", "SKILL.md"),
      "---\nid: hatch3r-feature\ntype: skill\ndescription: Feature workflow\ntags: [core, implementation]\n---\n# Feature\n",
      "utf-8",
    );

    const output = await generateBridgeOrchestration(tempDir);
    expect(output).toMatch(/\| performance \| `hatch3r-perf-audit` _\(skill\)_ \|/);
  });

  it("fills the Skill Dispatch Table Task Type column using the router model", async () => {
    await seedContent();
    const output = await generateBridgeOrchestration(tempDir);

    // The old placeholder "—" in the skill table should be replaced for
    // tagged skills. Look for the row for hatch3r-a11y-audit.
    const a11yRow = output
      .split("\n")
      .find((line) => line.includes("`hatch3r-a11y-audit`"));
    expect(a11yRow).toBeDefined();
    // Domain match beats workflow match: accessibility, not review.
    expect(a11yRow!).toContain("| accessibility |");

    const featureRow = output
      .split("\n")
      .find((line) => line.includes("`hatch3r-feature`"));
    expect(featureRow).toBeDefined();
    // No domain tag on this skill — should land in "core-workflow" (first
    // workflow-tag match in router row order).
    expect(featureRow!).toMatch(/\| (core-workflow|implementation) \|/);
  });

  it("returns the static BRIDGE_ORCHESTRATION when no skills are present", async () => {
    // No skills dir — bridge falls back to static content.
    const output = await generateBridgeOrchestration(tempDir);
    expect(output).not.toContain("## Task Type → Routing");
    expect(output).not.toContain("## Skill Dispatch Table");
  });
});

describe("buildTaskRouterModel against canonical content", () => {
  it("surfaces board and customize rows from the installed repo content", async () => {
    // Drive the real index builder against the repo root to verify that
    // C2's 9-row output grows to 11 rows once command/skill fallbacks land.
    const { buildContentIndex } = await import("../../content/index.js");
    // From src/__tests__/cli/agentsContent.test.ts → repo root is ../../../.
    const repoRoot = resolveTestPath(import.meta.url, "../../../");
    const index = await buildContentIndex(repoRoot);
    const rows = buildTaskRouterModel(index);

    const byTag = new Map(rows.map((r) => [r.tag, r]));
    expect(byTag.has("board")).toBe(true);
    expect(byTag.has("customize")).toBe(true);

    // Board has no agent owner so the primary must be a command.
    expect(byTag.get("board")!.primary.kind).toBe("command");
    // Customize has commands and skills but no agent — command wins the
    // priority order (agent → command → skill).
    expect(byTag.get("customize")!.primary.kind).toBe("command");
  });
});
