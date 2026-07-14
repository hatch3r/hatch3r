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
  skillsDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "p7-validator-"));
  const commandsDir = join(rootDir, "commands");
  const agentsDir = join(rootDir, "agents");
  const rulesDir = join(rootDir, "rules");
  const skillsDir = join(rootDir, "skills");
  await mkdir(commandsDir, { recursive: true });
  await mkdir(agentsDir, { recursive: true });
  await mkdir(rulesDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  return { rootDir, commandsDir, agentsDir, rulesDir, skillsDir };
}

/** Writes `skills/<name>/SKILL.md` and returns its absolute path. */
async function writeSkill(skillsDir: string, name: string, frontmatter: string, body: string): Promise<string> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  const abs = join(dir, "SKILL.md");
  await writeArtifact(abs, frontmatter, body);
  return abs;
}

async function writeArtifact(absPath: string, frontmatter: string, body: string): Promise<void> {
  const fm = frontmatter.trim();
  const content = `---\n${fm}\n---\n${body}`;
  await writeFile(absPath, content, "utf-8");
}

const ALL_FLAGS = { triageFirst: true, staticFirst: true, parallelTool: true, proofId: false } as const;

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
      flags: { triageFirst: true, staticFirst: false, parallelTool: false, proofId: false },
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
      flags: { triageFirst: true, staticFirst: false, parallelTool: false, proofId: false },
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
      flags: { triageFirst: false, staticFirst: true, parallelTool: false, proofId: false },
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
      flags: { triageFirst: false, staticFirst: true, parallelTool: false, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-STATIC-VIOL")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode B (D6-10): ERRORs on a `{{timestamp}}` template token AFTER the first heading (the pre-fix coverage hole)", async () => {
    // The body opens with a `##` heading on its first line — the exact
    // `commands/hatch3r-debug.md` shape that made stopAt === 0 and scanned
    // ZERO lines before the fix. A renderer-replaced `{{timestamp}}` deeper in
    // the body must now trip.
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-debug.md"),
      `id: hatch3r-debug
type: command
orchestrator: true
triage_tiers: [1, 2, 3]
parallel_tool_default: true
description: Debug command`,
      `## §0 Detect Ambiguity

Scan the brief for unresolved questions before acting.

## Step 1: Gather Context

Stamp each artifact with {{timestamp}} so the run is traceable.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: true, parallelTool: false, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const violations = findings.filter((f) => f.code === "P7-STATIC-VIOL");
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toMatch(/hatch3r-debug\.md$/);
    expect(violations[0].message).toMatch(/timestamp/i);
    expect(violations[0].message).toMatch(/section body/i);
    expect(errorCount).toBe(1);
  });

  it("Mode B (D6-10): PASSes on bare documentation tokens (a `timestamp` field, a `<run-id>` placeholder, the adverb \"now\") in a section body", async () => {
    // The full-body scan must NOT regress the canonical corpus: section bodies
    // legitimately document dynamic tokens in prose and tables. Only the
    // template-substitution form trips past the preamble.
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-handoff-loader.md"),
      `id: hatch3r-handoff-loader
type: agent
description: Handoff loader
tags: [handoff]`,
      `# Handoff Loader

Load the most recent handoff before planning.

## Schema

| Field | Meaning |
| \`created\` | ISO-8601 timestamp at write |

## Usage

Run \`gh run view <run-id>\` and record every action now.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: true, parallelTool: false, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-STATIC-VIOL")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode C: parallel-tool ───────────────────────────────────────

  it("Mode C: ERRORs (blocking) on agent with 3 tool mentions and no parallel directive (D6-M9: promoted from warning)", async () => {
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: true, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const errs = findings.filter((f) => f.code === "P7-PARALLEL-MISS");
    expect(errs).toHaveLength(1);
    expect(errs[0].level).toBe("error");
    expect(errs[0].message).toMatch(/3 tool\/sub-agent mentions/);
    expect(errorCount).toBeGreaterThanOrEqual(1);
    expect(warningCount).toBe(0);
  });

  it("Mode C (D6-9): ERRORs when serialized tool mentions are laundered only by distant safety boilerplate", async () => {
    // Two serialized mentions at the top; the word "parallel" appears far below
    // in governance safety boilerplate, NOT co-located with the mentions. The
    // pre-D6-9 whole-body check passed this; the windowed check must error.
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-architect.md"),
      `id: hatch3r-architect
type: agent
description: Architect agent
tags: [arch]`,
      `# Architect

Use the Task tool to delegate. Then issue tool calls one at a time, sequentially.

## Filler A

Lorem ipsum dolor sit amet.

## Filler B

Consectetur adipiscing elit.

## Safety Notes

Parallel-safety conditions: read-only or disjoint writes, deterministic aggregation.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: true, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const errs = findings.filter((f) => f.code === "P7-PARALLEL-MISS");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/within 3 lines/);
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it("Mode C (D6-9): PASSes when the parallel directive is co-located with the tool mentions", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-architect.md"),
      `id: hatch3r-architect
type: agent
description: Architect agent
tags: [arch]`,
      `# Architect

Use the Task tool and tool calls in parallel in a single message — never serialize independent sub-agent work.

## Safety Notes

Parallel-safety conditions apply.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: true, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-PARALLEL-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode C (D6-9): PASSes on the `parallel_tool_default: true` frontmatter flag regardless of body proximity", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-architect.md"),
      `id: hatch3r-architect
type: agent
description: Architect agent
tags: [arch]
parallel_tool_default: true`,
      `# Architect

Use the Task tool to delegate. Then issue tool calls and spawn each sub-agent.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: true, proofId: false },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-PARALLEL-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
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
      flags: { triageFirst: true, staticFirst: false, parallelTool: false, proofId: false },
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
      flags: { triageFirst: true, staticFirst: true, parallelTool: false, proofId: false },
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, ruleNarrative: true },
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, ruleNarrative: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    expect(findings.filter((f) => f.code === "P8-RULE-NARRATIVE-VIOL")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode F: orchestrator-contract (F16.1-H1) ────────────────────

  it("Mode F (D6-27): ERRORs on all four missing contracts including Resumability", async () => {
    // Orchestrator command with NONE of the four contracts present. Cycle 11
    // D6-27 promoted Resumability from warning to error (retrofit landed), so
    // all four are now error-level — 4 errors, 0 warnings.
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.some((f) => f.code === "P7-ORCH-COST-MISS" && f.level === "error")).toBe(true);
    expect(findings.some((f) => f.code === "P5-ORCH-ITER-MISS" && f.level === "error")).toBe(true);
    expect(findings.some((f) => f.code === "P8-ORCH-B1-MISS" && f.level === "error")).toBe(true);
    const resume = findings.filter((f) => f.code === "P5-ORCH-RESUME-MISS");
    expect(resume).toHaveLength(1);
    expect(resume[0].level).toBe("error");
    expect(errorCount).toBe(4);
    expect(warningCount).toBe(0);
  });

  it("Mode F (D6-27): a bare prose mention of \"resume\" does NOT satisfy the tightened Resumability probe", async () => {
    // The pre-D6-27 loose regex matched the bare word "resume" anywhere in the
    // body. The tightened probe requires a real heading (or the
    // `supports_resume` flag), so incidental prose like "resume work later" no
    // longer launders the gate — the three other contracts are present so
    // Resumability is the only miss.
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

## Iteration Summary

Emit the standard iteration-summary block at turn end. The operator can
resume work later from their notes.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const resume = findings.filter((f) => f.code === "P5-ORCH-RESUME-MISS");
    expect(resume).toHaveLength(1);
    expect(resume[0].level).toBe("error");
    expect(errorCount).toBe(1);
  });

  it("Mode F (D6-27): the `supports_resume: true` frontmatter flag satisfies Resumability without a heading", async () => {
    // A thin router that delegates the checkpointed phase to its sub-agents
    // (e.g. hatch3r-spec.md) declares the contract in frontmatter — Mode C
    // parity with `parallel_tool_default`. The other three contracts are
    // present, so the file passes Mode F entirely with no Resumability heading.
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-spec.md"),
      `id: hatch3r-spec
type: command
description: Spec router
tags: [spec]
orchestrator: true
agentPipeline: [hatch3r-greenfield-spec, hatch3r-brownfield-spec]
triage_tiers: [1, 2, 3]
supports_resume: true`,
      `# Spec

## Step 0: Ambiguity Gate (B1)

Resolve ambiguity via user-question-protocol before executing.

## Cost Estimate

Preview token/time cost before delegating.

## Iteration Summary

Emit the standard iteration-summary block at turn end.
`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("P7-ORCH") || f.code.startsWith("P5-ORCH") || f.code.startsWith("P8-ORCH"))).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  it("Mode F (D6-27): the `## Subcommand: resume` dispatcher heading satisfies Resumability", async () => {
    // The handoff dispatcher's resumability surface is its `resume` subcommand,
    // not a checkpointed `## Resumability` section. The dedicated
    // `## Subcommand: resume` heading satisfies the tightened probe.
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-handoff.md"),
      `id: hatch3r-handoff
type: command
description: Handoff dispatcher
tags: [orchestration]
orchestrator: true
agentPipeline: [hatch3r-handoff-preparer]
triage_tiers: [1, 2]`,
      `# Handoff

## Step 0: Ambiguity Gate (B1)

Resolve ambiguity via user-question-protocol before executing.

## Cost Estimate

Preview token/time cost before delegating.

## Iteration Summary

Emit the standard iteration-summary block at turn end.

## Subcommand: resume

Re-enter an in-flight handoff from its last recorded state.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P5-ORCH-RESUME-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
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
      flags: { triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, orchContract: true },
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  // ── Mode G: efficiency-tier (D6-SA6.6-Finding4) ─────────────────

  const TIER_FLAGS = {
    triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, efficiencyTier: true,
  } as const;

  it("Mode G: ERRORs on orchestrator command missing efficiency_tier", async () => {
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

    const { findings, errorCount } = await runValidator({
      flags: TIER_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const miss = findings.filter((f) => f.code === "P5-EFFICIENCY-TIER-MISS");
    expect(miss).toHaveLength(1);
    expect(miss[0].level).toBe("error");
    expect(errorCount).toBe(1);
  });

  it("Mode G: ERRORs on invalid efficiency_tier value", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]
efficiency_tier: turbo`,
      `# Workflow\n\nBody.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: TIER_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.some((f) => f.code === "P5-EFFICIENCY-TIER-INVALID" && f.level === "error")).toBe(true);
    expect(errorCount).toBe(1);
  });

  it("Mode G: PASSes when orchestrator command declares a valid efficiency_tier", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Workflow command
tags: [workflow]
orchestrator: true
agentPipeline: [hatch3r-implementer]
efficiency_tier: deep`,
      `# Workflow\n\nBody.\n`,
    );

    const { findings, errorCount, warningCount } = await runValidator({
      flags: TIER_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("P5-EFFICIENCY-TIER"))).toHaveLength(0);
    expect(errorCount).toBe(0);
    expect(warningCount).toBe(0);
  });

  it("Mode G: non-orchestrator command is exempt from the efficiency_tier requirement", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-report.md"),
      `id: hatch3r-report
type: command
description: Report command
tags: [report]
orchestrator: false`,
      `# Report\n\nSingle-pass; no efficiency_tier.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: TIER_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("P5-EFFICIENCY-TIER"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode G: ERRORs on agent missing efficiency_tier", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-implementer.md"),
      `id: hatch3r-implementer
type: agent
description: Implementer agent
tags: [implementation]`,
      `# Implementer\n\nBody.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: TIER_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const miss = findings.filter(
      (f) => f.code === "P5-EFFICIENCY-TIER-MISS" && f.file === "agents/hatch3r-implementer.md",
    );
    expect(miss).toHaveLength(1);
    expect(errorCount).toBe(1);
  });

  // ── Mode H: rule line-cap (D5-7) ────────────────────────────────

  const LINECAP_FLAGS = {
    triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, ruleLineCap: true,
  } as const;

  // Body with `n` content lines after the heading (each "Line k." is one line).
  const ruleBody = (n: number): string =>
    `# Rule\n\n` + Array.from({ length: n }, (_, i) => `Line ${i + 1}.`).join("\n") + "\n";

  it("Mode H: ERRORs on a normal-precedence rule over the 120-line cap", async () => {
    // Frontmatter (5 lines: ---, id, type, description, scope) + closing --- +
    // body. Push the body well past 120 total raw lines.
    await writeArtifact(
      join(fx.rulesDir, "hatch3r-bloated.md"),
      `id: hatch3r-bloated
type: rule
description: A normal-precedence rule that drifted over the cap
scope: always`,
      ruleBody(130),
    );

    const { findings, errorCount } = await runValidator({
      flags: LINECAP_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    const viol = findings.filter((f) => f.code === "P4-RULE-LINE-CAP");
    expect(viol).toHaveLength(1);
    expect(viol[0].file).toMatch(/hatch3r-bloated\.md$/);
    expect(viol[0].message).toMatch(/120-line cap/);
    expect(viol[0].message).toMatch(/normal\/low/);
    expect(errorCount).toBe(1);
  });

  it("Mode H: PASSes the same line count when precedence is high (cap rises to 250)", async () => {
    await writeArtifact(
      join(fx.rulesDir, "hatch3r-bloated.md"),
      `id: hatch3r-bloated
type: rule
description: A high-precedence rule under the 250-line cap
scope: always
precedence: high`,
      ruleBody(130),
    );

    const { findings, errorCount } = await runValidator({
      flags: LINECAP_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    expect(findings.filter((f) => f.code === "P4-RULE-LINE-CAP")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode H: PASSes a normal-precedence rule at or under 120 lines", async () => {
    await writeArtifact(
      join(fx.rulesDir, "hatch3r-lean.md"),
      `id: hatch3r-lean
type: rule
description: A lean normal-precedence rule
scope: always`,
      ruleBody(40),
    );

    const { findings, errorCount } = await runValidator({
      flags: LINECAP_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      rulesDir: fx.rulesDir,
    });

    expect(findings.filter((f) => f.code === "P4-RULE-LINE-CAP")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode I: runtime-efficiency SA6.5 gates (D6-11) ──────────────

  const RUNTIME_FLAGS = {
    triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, runtimeEfficiency: true,
  } as const;

  it("Mode I gate 1: ERRORs when a planning command bundles an execution agent", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-feature-plan.md"),
      `id: hatch3r-feature-plan
type: command
description: Feature planning command
tags: [planning, orchestration]
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-implementer]`,
      `# Feature Plan\n\nPlan the feature.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const viol = findings.filter((f) => f.code === "P7-PLAN-ACT-SPLIT");
    expect(viol).toHaveLength(1);
    expect(viol[0].message).toMatch(/hatch3r-implementer/);
    expect(errorCount).toBe(1);
  });

  it("Mode I gate 1: PASSes a planning command whose pipeline excludes execution agents", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-feature-plan.md"),
      `id: hatch3r-feature-plan
type: command
description: Feature planning command
tags: [planning, orchestration]
orchestrator: true
agentPipeline: [hatch3r-researcher, hatch3r-docs-writer]`,
      `# Feature Plan\n\nPlan the feature.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-PLAN-ACT-SPLIT")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode I gate 1: a non-planning command may list execution agents", async () => {
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-workflow.md"),
      `id: hatch3r-workflow
type: command
description: Full workflow command
tags: [implementation, orchestration]
orchestrator: true
agentPipeline: [hatch3r-implementer, hatch3r-fixer]`,
      `# Workflow\n\nBuild it.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-PLAN-ACT-SPLIT")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode I gate 2: ERRORs on a SKILL.md missing a description", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-nodesc",
      `id: hatch3r-nodesc
name: hatch3r-nodesc
type: skill
tags: [orchestration]`,
      `# No Description Skill\n\nBody.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      skillsDir: fx.skillsDir,
    });

    const viol = findings.filter((f) => f.code === "P7-SKILL-DESC-MISS");
    expect(viol).toHaveLength(1);
    expect(viol[0].file).toMatch(/hatch3r-nodesc\/SKILL\.md$/);
    expect(errorCount).toBe(1);
  });

  it("Mode I gate 2: PASSes a SKILL.md with a non-empty description", async () => {
    await writeSkill(
      fx.skillsDir,
      "hatch3r-good",
      `id: hatch3r-good
name: hatch3r-good
type: skill
description: A skill whose description loads independently of the body
tags: [orchestration]`,
      `# Good Skill\n\nBody.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
      skillsDir: fx.skillsDir,
    });

    expect(findings.filter((f) => f.code === "P7-SKILL-DESC-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode I gate 3: ERRORs when hatch3r-implementer.md lacks a fenced structured-result block", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-implementer.md"),
      `id: hatch3r-implementer
type: agent
description: Implementer agent
tags: [implementation]`,
      `# Implementer\n\nReturn a result in prose with no fenced block.\n`,
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const viol = findings.filter((f) => f.code === "P7-STRUCTURED-RESULT-MISS");
    expect(viol).toHaveLength(1);
    expect(viol[0].file).toBe("agents/hatch3r-implementer.md");
    expect(errorCount).toBe(1);
  });

  it("Mode I gate 3: PASSes when the mutating agent contains a fenced block", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-fixer.md"),
      `id: hatch3r-fixer
type: agent
description: Fixer agent
tags: [implementation]`,
      "# Fixer\n\n### Return Structured Result\n\n```\n## Fix Result\nStatus: SUCCESS\n```\n",
    );

    const { findings, errorCount } = await runValidator({
      flags: RUNTIME_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "P7-STRUCTURED-RESULT-MISS")).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode J: model-class (release/2.6.0) ─────────────────────────
  const MODEL_CLASS_FLAGS = {
    triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, modelClass: true,
  } as const;

  it("Mode J: ERRORs (MODEL-CLASS-VOCAB) on an agent with a non-class model value", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-worker.md"),
      `id: hatch3r-worker
type: agent
description: Worker agent
tags: [implementation]
model: standard`,
      "# Worker\n\nBody.\n",
    );

    const { findings, errorCount } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const viol = findings.filter((f) => f.code === "MODEL-CLASS-VOCAB");
    expect(viol).toHaveLength(1);
    expect(viol[0].file).toBe("agents/hatch3r-worker.md");
    expect(viol[0].message).toContain("economy|default|strongest");
    expect(errorCount).toBe(1);
  });

  it("Mode J: ERRORs (MODEL-CLASS-VOCAB) on an agent with NO model field", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-worker.md"),
      `id: hatch3r-worker
type: agent
description: Worker agent
tags: [implementation]`,
      "# Worker\n\nBody.\n",
    );

    const { findings } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const viol = findings.filter((f) => f.code === "MODEL-CLASS-VOCAB");
    expect(viol).toHaveLength(1);
    expect(viol[0].message).toContain("missing");
  });

  it("Mode J: PASSes agents declaring each of the three class words", async () => {
    for (const [slug, cls] of [["hatch3r-a", "economy"], ["hatch3r-b", "default"], ["hatch3r-c", "strongest"]]) {
      await writeArtifact(
        join(fx.agentsDir, `${slug}.md`),
        `id: ${slug}
type: agent
description: Class agent
tags: [implementation]
model: ${cls}`,
        "# Agent\n\nBody.\n",
      );
    }

    const { findings, errorCount } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("MODEL-CLASS"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode J: ERRORs (MODEL-CLASS-FLOOR) when an always-mode specialist is not strongest", async () => {
    // hatch3r-security is an always-mode SPECIALIST_TRIGGER_TABLE entry AND a
    // CQ specialist — `model: default` (a VALID class word) must still fail
    // the strongest floor.
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-security.md"),
      `id: hatch3r-security
type: agent
description: Security specialist
tags: [review]
model: default`,
      "# Security\n\nBody.\n",
    );

    const { findings, errorCount } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const floor = findings.filter((f) => f.code === "MODEL-CLASS-FLOOR");
    expect(floor).toHaveLength(1);
    expect(floor[0].file).toBe("agents/hatch3r-security.md");
    expect(floor[0].message).toContain("model: strongest");
    // The class word itself is valid vocabulary — only the floor fires.
    expect(findings.filter((f) => f.code === "MODEL-CLASS-VOCAB")).toHaveLength(0);
    expect(errorCount).toBe(1);
  });

  it("Mode J: ERRORs (MODEL-CLASS-FLOOR) when a CQ-roster specialist is not strongest", async () => {
    // hatch3r-product-spec (CQ10) is on the CQ roster but NOT an always-mode
    // trigger-table entry — the floor must still bind it.
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-product-spec.md"),
      `id: hatch3r-product-spec
type: agent
description: Product-spec specialist
tags: [review]
model: economy`,
      "# Product Spec\n\nBody.\n",
    );

    const { findings } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code === "MODEL-CLASS-FLOOR")).toHaveLength(1);
  });

  it("Mode J: PASSes a floor specialist declaring model: strongest", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-testability.md"),
      `id: hatch3r-testability
type: agent
description: Testability specialist
tags: [review]
model: strongest`,
      "# Testability\n\nBody.\n",
    );

    const { findings, errorCount } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("MODEL-CLASS"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode J: a non-floor agent may declare any class word (no floor finding)", async () => {
    await writeArtifact(
      join(fx.agentsDir, "hatch3r-lint-fixer.md"),
      `id: hatch3r-lint-fixer
type: agent
description: Lint fixer
tags: [implementation]
model: economy`,
      "# Lint Fixer\n\nBody.\n",
    );

    const { findings, errorCount } = await runValidator({
      flags: MODEL_CLASS_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("MODEL-CLASS"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  // ── Mode K: plan-handoff (release/2.6.0) ─────────────────────────
  const PLAN_HANDOFF_FLAGS = {
    triageFirst: false, staticFirst: false, parallelTool: false, proofId: false, planHandoff: true,
  } as const;

  const FRAME_BODY = `# Orchestration Frame

## Plan-Execution Handoff (terminal block)

Template first line: \`/hatch3r-workflow --plan-file=<plan-path>\`
`;

  /** Seeds commands/shared/orchestration-frame.md so check (c) passes. */
  async function writeFrame(commandsDir: string, body: string = FRAME_BODY): Promise<void> {
    const dir = join(commandsDir, "shared");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "orchestration-frame.md"), body, "utf-8");
  }

  it("Mode K: ERRORs (PLAN-HANDOFF-BLOCK-MISS) when a plan_handoff command has no handoff block", async () => {
    await writeFrame(fx.commandsDir);
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-myplan.md"),
      `id: hatch3r-myplan
type: command
description: Planning command
tags: [planning]
orchestrator: true
agentPipeline: [hatch3r-researcher]
plan_handoff: true`,
      `# My Plan

## Iteration Summary (mandatory output)

Close the run with the recap.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const miss = findings.filter((f) => f.code === "PLAN-HANDOFF-BLOCK-MISS");
    expect(miss).toHaveLength(1);
    expect(miss[0].file).toBe("commands/hatch3r-myplan.md");
    expect(miss[0].message).toContain("Execute This Plan");
    expect(errorCount).toBe(1);
  });

  it("Mode K: ERRORs when the handoff block appears BEFORE the Iteration Summary heading", async () => {
    await writeFrame(fx.commandsDir);
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-myplan.md"),
      `id: hatch3r-myplan
type: command
description: Planning command
tags: [planning]
orchestrator: true
agentPipeline: [hatch3r-researcher]
plan_handoff: true`,
      `# My Plan

## Execute This Plan

Block emitted too early.

## Iteration Summary (mandatory output)

Close the run with the recap.
`,
    );

    const { findings } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const miss = findings.filter((f) => f.code === "PLAN-HANDOFF-BLOCK-MISS");
    expect(miss).toHaveLength(1);
    expect(miss[0].message).toContain("BEFORE");
  });

  it("Mode K: ERRORs (PLAN-HANDOFF-ROSTER-MISS) when a pinned roster file lacks plan_handoff: true", async () => {
    await writeFrame(fx.commandsDir);
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-feature-plan.md"),
      `id: hatch3r-feature-plan
type: command
description: Feature planning
tags: [planning]
orchestrator: true
agentPipeline: [hatch3r-researcher]`,
      `# Feature Plan

## Iteration Summary (mandatory output)

Close the run with the recap.

## Execute This Plan

Handoff block.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const roster = findings.filter((f) => f.code === "PLAN-HANDOFF-ROSTER-MISS");
    expect(roster).toHaveLength(1);
    expect(roster[0].file).toBe("commands/hatch3r-feature-plan.md");
    // No BLOCK-MISS: the block check only binds commands declaring the key.
    expect(findings.filter((f) => f.code === "PLAN-HANDOFF-BLOCK-MISS")).toHaveLength(0);
    expect(errorCount).toBe(1);
  });

  it("Mode K: ERRORs (PLAN-HANDOFF-FRAME-MISS) when the frame lacks the --plan-file= template line", async () => {
    await writeFrame(fx.commandsDir, "# Orchestration Frame\n\n## Plan-Execution Handoff (terminal block)\n\nNo template here.\n");

    const { findings } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const frame = findings.filter((f) => f.code === "PLAN-HANDOFF-FRAME-MISS");
    expect(frame).toHaveLength(1);
    expect(frame[0].message).toContain("--plan-file=");
  });

  it("Mode K: ERRORs (PLAN-HANDOFF-FRAME-MISS) when the frame file is absent entirely", async () => {
    const { findings } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    const frame = findings.filter((f) => f.code === "PLAN-HANDOFF-FRAME-MISS");
    expect(frame).toHaveLength(1);
    expect(frame[0].message).toContain("not found");
  });

  it("Mode K: PASSes a roster command with plan_handoff: true and the block after the recap", async () => {
    await writeFrame(fx.commandsDir);
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-feature-plan.md"),
      `id: hatch3r-feature-plan
type: command
description: Feature planning
tags: [planning]
orchestrator: true
agentPipeline: [hatch3r-researcher]
plan_handoff: true`,
      `# Feature Plan

## Iteration Summary (mandatory output)

Close the run with the recap.

## Execute This Plan

Handoff block after the recap.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("PLAN-HANDOFF"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });

  it("Mode K: PASSes when the trailer is a pointer line naming Plan-Execution Handoff (no literal heading)", async () => {
    await writeFrame(fx.commandsDir);
    await writeArtifact(
      join(fx.commandsDir, "hatch3r-myplan.md"),
      `id: hatch3r-myplan
type: command
description: Planning command
tags: [planning]
orchestrator: true
agentPipeline: [hatch3r-researcher]
plan_handoff: true`,
      `# My Plan

## Iteration Summary (mandatory output)

Close the run with the recap. Then emit the Plan-Execution Handoff block per the orchestration frame.
`,
    );

    const { findings, errorCount } = await runValidator({
      flags: PLAN_HANDOFF_FLAGS,
      commandsDir: fx.commandsDir,
      agentsDir: fx.agentsDir,
    });

    expect(findings.filter((f) => f.code.startsWith("PLAN-HANDOFF"))).toHaveLength(0);
    expect(errorCount).toBe(0);
  });
});
