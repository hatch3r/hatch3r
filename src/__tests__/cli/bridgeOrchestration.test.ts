import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateBridgeOrchestration } from "../../cli/shared/bridgeOrchestration.js";

// D1-SA1.7-F9 (Cycle 10 Wave 4): split out of the former agentsContent.test.ts
// when agentsContent.ts was decomposed into per-concern modules. These cases
// cover the bridge-orchestration generator in isolation, importing it directly
// from `bridgeOrchestration.ts` to demonstrate the module is independently
// coverable.

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
      join(tempDir, "agents", "hatch3r-ui.md"),
      "---\nid: hatch3r-ui\ntype: agent\ndescription: CQ1 UI/a11y specialist\ntags: [review, a11y]\n---\n# UI\n",
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
