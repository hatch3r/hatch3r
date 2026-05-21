import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runValidator } from "../validate-fanout-emission.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  commandsDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p8-fanout-validator-"));
  const commandsDir = join(rootDir, "commands");
  await mkdir(commandsDir, { recursive: true });
  return { rootDir, commandsDir };
}

async function writeArtifact(absPath: string, frontmatter: string, body: string): Promise<void> {
  const fm = frontmatter.trim();
  const content = `---\n${fm}\n---\n${body}`;
  await writeFile(absPath, content, "utf-8");
}

describe("validate-fanout-emission", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Happy path ───────────────────────────────────────────────────

  it("PASSes when orchestrator command emits sub_agents_spawned {count, rationale}", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-reviewer]
triage_tiers: [1, 2, 3]
sub_agents_spawned:
  count: 2
  rationale: One implementer per independent module plus a reviewer for the post-write quality pass`,
      `# Workflow\n\nBody.\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.checkedFiles).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  // ── Missing field ────────────────────────────────────────────────

  it("ERRORs on orchestrator command missing sub_agents_spawned field", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]`,
      `# Workflow\n\nBody.\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    const miss = result.findings.find((f) => f.code === "P8-FANOUT-MISS");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/sub_agents_spawned/);
    expect(miss?.file).toMatch(/hatch3r-workflow\.md$/);
  });

  // ── Wrong shape — list ───────────────────────────────────────────

  it("ERRORs on sub_agents_spawned declared as a list", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-pr-resolve.md"),
      `id: hatch3r-pr-resolve
type: command
description: PR resolve
orchestrator: true
agentPipeline: [hatch3r-implementer]
sub_agents_spawned: [hatch3r-implementer, hatch3r-reviewer]`,
      `# PR Resolve\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    const shape = result.findings.find((f) => f.code === "P8-FANOUT-SHAPE");
    expect(shape).toBeDefined();
    expect(shape?.message).toMatch(/count.*rationale/);
  });

  // ── Wrong shape — scalar ─────────────────────────────────────────

  it("ERRORs on sub_agents_spawned declared as a scalar", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow
orchestrator: true
agentPipeline: [hatch3r-implementer]
sub_agents_spawned: 5`,
      `# Workflow\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings.some((f) => f.code === "P8-FANOUT-SHAPE")).toBe(true);
  });

  // ── Invalid count ────────────────────────────────────────────────

  it("ERRORs on count=0 (non-positive integer)", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow
orchestrator: true
agentPipeline: [hatch3r-implementer]
sub_agents_spawned:
  count: 0
  rationale: Placeholder rationale`,
      `# Workflow\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    const countErr = result.findings.find((f) => f.code === "P8-FANOUT-COUNT");
    expect(countErr).toBeDefined();
  });

  it("ERRORs on non-integer count", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow
orchestrator: true
agentPipeline: [hatch3r-implementer]
sub_agents_spawned:
  count: "two"
  rationale: Placeholder rationale`,
      `# Workflow\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings.some((f) => f.code === "P8-FANOUT-COUNT")).toBe(true);
  });

  // ── Invalid rationale ────────────────────────────────────────────

  it("ERRORs on empty rationale", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow
orchestrator: true
agentPipeline: [hatch3r-implementer]
sub_agents_spawned:
  count: 3
  rationale: ""`,
      `# Workflow\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings.some((f) => f.code === "P8-FANOUT-RATIO")).toBe(true);
  });

  // ── Non-orchestrator commands are skipped ────────────────────────

  it("does NOT flag non-orchestrator commands", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-debug.md"),
      `id: hatch3r-debug
type: command
description: Debug (inline)
orchestrator: false`,
      `# Debug\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.checkedFiles).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  // ── Audit-cycle exempt ───────────────────────────────────────────

  it("hard-exempts commands/hatch3r-audit-cycle*.md from fan-out emission", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-audit-cycle.md"),
      `id: hatch3r-audit-cycle
type: command
description: Audit cycle command
orchestrator: true
agentPipeline: [hatch3r-reviewer]`,
      `# Audit Cycle\n`,
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.checkedFiles).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  // ── Frontmatter parse failure → warning only ─────────────────────

  it("emits a WARNING (not error) on frontmatter parse failure", async () => {
    // Malformed YAML: unclosed bracket
    await writeFile(
      join(fx.commandsDir, "hatch3r-broken.md"),
      `---\nid: hatch3r-broken\norchestrator: true\nagentPipeline: [hatch3r-implementer\n---\n# Broken\n`,
      "utf-8",
    );

    const result = await runValidator({ commandsDir: fx.commandsDir });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
    expect(result.findings.some((f) => f.code === "P8-FANOUT-FM-PARSE")).toBe(true);
  });

  // ── Missing commands dir → silently empty ────────────────────────

  it("returns empty result when commands dir is missing", async () => {
    const result = await runValidator({ commandsDir: join(fx.rootDir, "does-not-exist") });
    expect(result.checkedFiles).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});
