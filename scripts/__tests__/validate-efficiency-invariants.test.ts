import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runValidator } from "../validate-efficiency-invariants.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  commandsDir: string;
  agentsDir: string;
  rulesDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p7-validator-"));
  const commandsDir = join(rootDir, "commands");
  const agentsDir = join(rootDir, "agents");
  const rulesDir = join(rootDir, "rules");
  await mkdir(commandsDir, { recursive: true });
  await mkdir(agentsDir, { recursive: true });
  await mkdir(rulesDir, { recursive: true });
  return { rootDir, commandsDir, agentsDir, rulesDir };
}

async function writeArtifact(absPath: string, frontmatter: string, body: string): Promise<void> {
  const fm = frontmatter.trim();
  const content = `---\n${fm}\n---\n${body}`;
  await writeFile(absPath, content, "utf-8");
}

const ALL_FLAGS = { triageFirst: true, staticFirst: true, parallelTool: true } as const;

describe("validate-efficiency-invariants", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Mode A: triage-first ────────────────────────────────────────

  it("Mode A: ERRORs on orchestrator command missing triage_tiers", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]`,
      `# Workflow

Some body content.

## Step 1: Plan

Do the planning work.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: true, staticFirst: false, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const triageMisses = findings.filter((f) => f.code === "P7-TRIAGE-MISS");
    expect(triageMisses.length).toBeGreaterThanOrEqual(1);
    expect(triageMisses.some((f) => /triage_tiers/.test(f.message))).toBe(true);
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it("Mode A: PASSes when triage_tiers and Triage heading both present", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]
triage_tiers: [1, 2, 3]`,
      `# Workflow

Intro text.

## Step 1: Triage

Pick a tier based on scope.

## Step 2: Plan

Continue.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: true, staticFirst: false, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-TRIAGE-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode B: static-first ────────────────────────────────────────

  it("Mode B: ERRORs on agent with `timestamp` in early body", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-implementer.md"),
      `id: hatch3r-implementer
type: agent
description: Implementer agent
tags: [impl]`,
      `# Implementer

Each session uses a fresh timestamp at startup.

## Responsibilities

Build features.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: true, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const violations = findings.filter((f) => f.code === "P7-STATIC-VIOL");
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toMatch(/hatch3r-implementer\.md$/);
    expect(violations[0].line).toBeTypeOf("number");
    expect(violations[0].message).toMatch(/timestamp/i);
    expect(errorCount).toBe(1);
  });

  it("Mode B: PASSes for agent with no volatile tokens", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-architect.md"),
      `id: hatch3r-architect
type: agent
description: Architect agent
tags: [arch]`,
      `# Architect

Design systems with measurable trade-offs.

## Responsibilities

- Document decisions
- Map dependencies
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: true, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-STATIC-VIOL")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode C: parallel-tool ───────────────────────────────────────

  it("Mode C: WARNs (non-blocking) on agent with 3 tool mentions and no parallel directive", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-architect.md"),
      `id: hatch3r-architect
type: agent
description: Architect agent
tags: [arch]`,
      `# Architect

## Responsibilities

Use the Task tool to delegate. Each sub-agent runs sequentially.
You can issue tool calls one at a time.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const warns = findings.filter((f) => f.code === "P7-PARALLEL-MISS");
    expect(warns).toHaveLength(1);
    expect(warns[0].level).toBe("warning");
    expect(warns[0].message).toMatch(/3 tool\/sub-agent mentions/);
    expect(errorCount).toBe(0);
    expect(warningCount).toBeGreaterThanOrEqual(1);
  });

  // ── extraOrchestratorFiles (governance/AUDIT-EXECUTE.md path) ───

  it("extraOrchestratorFiles: ERRORs on AUDIT-EXECUTE.md missing triage_tiers", async () => {
    const govDir = join(fx.rootDir, "governance");
    await mkdir(govDir, { recursive: true });
    const auditExec = join(govDir, "AUDIT-EXECUTE.md");
    await writeArtifact(
      auditExec,
      `id: governance-audit-execute
type: governance-prompt
description: Audit execution prompt
orchestrator: true`,
      `# Audit Execute

## Phase 0: Baseline

Capture state.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: true, staticFirst: false, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      extraOrchestratorFiles: [auditExec],
    });

    const triageMisses = findings.filter((f) => f.code === "P7-TRIAGE-MISS");
    expect(triageMisses.length).toBeGreaterThanOrEqual(1);
    expect(triageMisses.some((f) => /AUDIT-EXECUTE\.md/.test(f.file))).toBe(true);
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it("extraOrchestratorFiles: PASSes when AUDIT-EXECUTE.md has triage_tiers and Tier heading", async () => {
    const govDir = join(fx.rootDir, "governance");
    await mkdir(govDir, { recursive: true });
    const auditExec = join(govDir, "AUDIT-EXECUTE.md");
    await writeArtifact(
      auditExec,
      `id: governance-audit-execute
type: governance-prompt
description: Audit execution prompt
orchestrator: true
triage_tiers: [1, 2, 3]`,
      `# Audit Execute

## Phase 0: Baseline

Capture state.

## Tier Classification

Sort findings by execution tier.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: true, staticFirst: true, parallelTool: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      extraOrchestratorFiles: [auditExec],
    });

    expect(findings).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("extraOrchestratorFiles: missing file is silently skipped", async () => {
    const { findings, errorCount } = await runValidator({
      flags: ALL_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      extraOrchestratorFiles: [join(fx.rootDir, "governance/DOES-NOT-EXIST.md")],
    });

    expect(findings).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Audit-exempt list ───────────────────────────────────────────

  it("Audit exempt: commands/hatch3r-audit-cycle.md does NOT trigger any check", async () => {
    // Seed a file that would otherwise fail every mode:
    //   - orchestrator: true with no triage_tiers and no Triage heading (Mode A)
    //   - early-body `timestamp` token (Mode B)
    //   - 3 tool/sub-agent mentions, no parallel directive (Mode C)
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-audit-cycle.md"),
      `id: hatch3r-audit-cycle
type: command
description: Audit cycle command
tags: [audit]
orchestrator: true
agentPipeline: [hatch3r-reviewer]`,
      `# Audit Cycle

The current timestamp is captured per-run.

Use the Task tool. Use tool calls. Use a sub-agent.

## Steps

Walk through 19 domains.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: ALL_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  // ── Mode E: rule-narrative (F16.1-H6) ───────────────────────────

  const RULE_FM = `id: hatch3r-agent-orchestration
type: rule
description: Orchestration rule
tags: [orchestration]
scope: always`;

  it("Mode E: ERRORs when a rule justifies serialization with a context-cost rationale", async () => {
    await writeArtifact(
      join(fx.rulesDir, "hatch3r-agent-orchestration.md"),
      RULE_FM,
      `# Orchestration

## Parallel Safety

We cap parallelism for per-orchestrator context cost reasons.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, ruleNarrative: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    const viol = findings.filter((f) => f.code === "P8-RULE-NARRATIVE-VIOL");
    expect(viol.length).toBeGreaterThanOrEqual(1);
    expect(viol[0].file).toMatch(/hatch3r-agent-orchestration\.md$/);
    expect(viol[0].line).toBeTypeOf("number");
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it("Mode E: PASSes on the negated, principle-aligned phrasing (token cost never serializes)", async () => {
    await writeArtifact(
      join(fx.rulesDir, "hatch3r-agent-orchestration.md"),
      RULE_FM,
      `# Orchestration

## Parallel Safety

The bound exists for upstream provider rate-limit headroom (RPM/TPM) — NOT
per-orchestrator context cost; token cost never serializes independent work
(P8 dominates P7). Token cost is never a valid reason to serialize independent
work.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, ruleNarrative: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    expect(findings.filter((f) => f.code === "P8-RULE-NARRATIVE-VIOL")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode F: orchestrator-contract (F16.1-H1) ────────────────────

  it("Mode F: ERRORs on Cost/Iteration/B1 misses, WARNs on missing Resumability", async () => {
    // Orchestrator command with NONE of the four contracts present.
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]
triage_tiers: [1, 2, 3]`,
      `# Workflow

## Step 1: Triage

Pick a tier.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.some((f) => f.code === "P7-ORCH-COST-MISS" && f.level === "error")).toBe(true);
    expect(findings.some((f) => f.code === "P5-ORCH-ITER-MISS" && f.level === "error")).toBe(true);
    expect(findings.some((f) => f.code === "P8-ORCH-B1-MISS" && f.level === "error")).toBe(true);
    const resume = findings.filter((f) => f.code === "P5-ORCH-RESUME-MISS");
    expect(resume).toHaveLength(1);
    expect(resume[0].level).toBe("warning");
    expect(errorCount).toBe(3);
    expect(warningCount).toBeGreaterThanOrEqual(1);
  });

  it("Mode F: PASSes when all four orchestrator contracts are present", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]
triage_tiers: [1, 2, 3]`,
      `# Workflow

## Step 0: Ambiguity Gate (B1)

Resolve ambiguity via user-question-protocol before executing.

## Cost Estimate

Preview token/time cost before delegating.

## Resumability

Resume mid-flight from the last completed phase.

## Iteration Summary

Emit the standard iteration-summary block at turn end.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("P7-ORCH") || f.code.startsWith("P5-ORCH") || f.code.startsWith("P8-ORCH"))).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  it("Mode F: non-orchestrator command is exempt from the contract checks", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-report.md"),
      `id: hatch3r-report
type: command
description: Report command
tags: [report]
orchestrator: false`,
      `# Report

Single-pass report. No sub-agent delegation.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });
});
