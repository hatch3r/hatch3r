// Release/2.6.0 S7+S8: plan-execution handoff contract + `--plan-file` intake +
// the `hatch3r-plan` router. Corpus pins over the canonical commands:
//
//   (a) `hatch3r-workflow` advertises `--plan-file=<path>` in its argument-hint;
//   (b) its body carries the 1a-plan Plan-File Intake (existence guard with the
//       actionable missing-file error, freshness-drift ASK) WITHOUT dropping the
//       pre-existing GitHub-issue / user-description intake bullets
//       (backward-compat byte pins);
//   (c) the orchestration frame owns the Plan-Execution Handoff template
//       (section heading + the literal Shape A first line);
//   (d) the new `hatch3r-plan` router keeps the plan/act split (no
//       implementer/fixer in agentPipeline) and the planning primary tag;
//   (e) every pinned plan-handoff roster command declares `plan_handoff: true`
//       and places `## Execute This Plan` AFTER its `## Iteration Summary`
//       heading (the one sanctioned post-recap trailer).
//
// The machine gate for (e) also runs in CI as Mode K of
// `scripts/validate-efficiency-invariants.ts`; these pins keep the contract
// visible to `npm test` without invoking the script harness.
//
// Release/2.7.1 adds the in-session plan-gate pins at the bottom of this file
// ("plan gate content contract (2.7.1)") — the Mode M twin of the same script.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/__tests__/content → repo root is three levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function readRepoFile(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  expect(raw.startsWith("---\n")).toBe(true);
  const closeIdx = raw.indexOf("\n---", 4);
  expect(closeIdx).toBeGreaterThan(0);
  const frontmatter = parseYaml(raw.slice(4, closeIdx)) as Record<string, unknown>;
  const body = raw.slice(raw.indexOf("\n", closeIdx + 4) + 1);
  return { frontmatter, body };
}

// Mirror of PLAN_HANDOFF_COMMANDS in scripts/validate-efficiency-invariants.ts
// (Mode K). Intentionally re-pinned here so shrinking the roster in the script
// does not silently shrink the npm-test surface.
const PLAN_HANDOFF_ROSTER = [
  "hatch3r-feature-plan.md",
  "hatch3r-bug-plan.md",
  "hatch3r-migration-plan.md",
  "hatch3r-refactor-plan.md",
  "hatch3r-test-plan.md",
  "hatch3r-project-spec.md",
  "hatch3r-api-spec.md",
  "hatch3r-roadmap.md",
  "hatch3r-spec.md",
  "hatch3r-plan.md",
  "hatch3r-rework.md",
] as const;

describe("hatch3r-workflow --plan-file intake (S7)", () => {
  const raw = readRepoFile("commands/hatch3r-workflow.md");
  const { frontmatter, body } = splitFrontmatter(raw);

  it("(a) argument-hint advertises --plan-file=<path>", () => {
    expect(String(frontmatter["argument-hint"])).toContain("--plan-file=<path>");
  });

  it("(b) body carries the 1a-plan Plan-File Intake heading", () => {
    expect(body).toContain("#### 1a-plan. Plan-File Intake");
  });

  it("(b) existence guard states the actionable missing-file error", () => {
    expect(body).toContain("Plan file not found:");
    // Names the planning output dirs and the no-flag fallback.
    for (const dir of ["docs/specs/", "docs/investigations/", "docs/migrations/", "docs/rework/", "docs/api/"]) {
      expect(body).toContain(dir);
    }
    expect(body).toContain("without `--plan-file` and describe the task instead");
  });

  it("(b) freshness guard offers the proceed / re-validate / abort ASK and forbids silent stale execution", () => {
    expect(body).toContain("(b) re-validate the plan first");
    expect(body).toContain("Never execute a stale plan silently");
    expect(body).toContain("git log -1 --format=%cI");
  });

  it("(b) backward-compat: the GitHub-issue and user-description intake bullets survive byte-identical", () => {
    expect(body).toContain(
      "- **GitHub issue:** Read issue body, acceptance criteria, labels, parent epic context using `gh issue view` (fall back to `issue_read` MCP).",
    );
    expect(body).toContain(
      "- **User description:** Extract requirements, scope, constraints from the provided description.",
    );
  });

  it("workflow itself does NOT declare plan_handoff (it executes plans; it does not produce them)", () => {
    expect(frontmatter.plan_handoff).toBeUndefined();
  });
});

describe("orchestration frame owns the Plan-Execution Handoff template (S8)", () => {
  const raw = readRepoFile("commands/shared/orchestration-frame.md");

  it("(c) carries the section heading and the literal Shape A first line", () => {
    expect(raw).toContain("## Plan-Execution Handoff");
    expect(raw).toContain("/hatch3r-workflow --plan-file=");
    expect(raw).toContain("## Execute This Plan");
  });

  it("(c) documents the position rule (post-recap trailer) and the router suppression rule", () => {
    expect(raw).toContain("immediately AFTER the `## Iteration Summary` recap");
    expect(raw).toMatch(/UNDER `\/hatch3r-plan` does not emit its own block/);
  });
});

describe("hatch3r-plan router frontmatter (S8)", () => {
  const raw = readRepoFile("commands/hatch3r-plan.md");
  const { frontmatter } = splitFrontmatter(raw);

  it("(d) is an orchestrator with a non-empty agentPipeline", () => {
    expect(frontmatter.orchestrator).toBe(true);
    expect(Array.isArray(frontmatter.agentPipeline)).toBe(true);
    expect((frontmatter.agentPipeline as unknown[]).length).toBeGreaterThan(0);
  });

  it("(d) keeps the plan/act split — no implementer or fixer in the pipeline", () => {
    const pipeline = frontmatter.agentPipeline as string[];
    expect(pipeline).not.toContain("hatch3r-implementer");
    expect(pipeline).not.toContain("hatch3r-fixer");
  });

  it('(d) leads with the "planning" capability tag and declares plan_handoff', () => {
    const tags = frontmatter.tags as string[];
    expect(tags[0]).toBe("planning");
    expect(frontmatter.plan_handoff).toBe(true);
  });
});

describe("plan-handoff roster contract (S8)", () => {
  it.each(PLAN_HANDOFF_ROSTER)("(e) %s declares plan_handoff: true and closes with Execute This Plan after the recap heading", (name) => {
    const raw = readRepoFile(`commands/${name}`);
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter.plan_handoff).toBe(true);

    const recapIdx = body.indexOf("## Iteration Summary");
    const blockIdx = body.lastIndexOf("## Execute This Plan");
    expect(recapIdx).toBeGreaterThan(-1);
    expect(blockIdx).toBeGreaterThan(recapIdx);
  });
});

// ── Release/2.7.1: in-session plan gate + execute-now continuation ──
//
// Mirror of PLAN_GATE_COMMANDS in scripts/validate-efficiency-invariants.ts
// (Mode M). Intentionally re-pinned here so shrinking the roster in the script
// does not silently shrink the npm-test surface. Exempt by design (NOT
// gated): hatch3r-workflow (direct-execution entry), hatch3r-quick-change
// (Tier-1 carve-out), hatch3r-incident-response (urgency), hatch3r-healthcheck /
// hatch3r-security-audit / hatch3r-board-fill (board-artifact-only outputs).
const PLAN_GATE_ROSTER = [
  "hatch3r-board-pickup.md",
  "hatch3r-bug-pipeline.md",
  "hatch3r-debug.md",
  "hatch3r-diagnose.md",
  "hatch3r-design-system-create.md",
  "hatch3r-pr-resolve.md",
  "hatch3r-release.md",
  "hatch3r-auth-scaffold.md",
  "hatch3r-slo-scaffold.md",
] as const;

// The 7 executable-plan producers that gained an Execute or Defer ASK — the
// `hatch3r-plan` router's heading carries its phase prefix
// (`## Phase 3.5 — Execute or Defer`); the other six use `## Execute or Defer`.
const EXECUTE_OR_DEFER_PRODUCERS = [
  "hatch3r-plan.md",
  "hatch3r-feature-plan.md",
  "hatch3r-bug-plan.md",
  "hatch3r-migration-plan.md",
  "hatch3r-refactor-plan.md",
  "hatch3r-test-plan.md",
  "hatch3r-rework.md",
] as const;

// The 4 doc planners deliberately keep the two-step flow — no same-session
// execute, so no Execute or Defer ASK (negative pin: the seam must not creep
// onto them silently).
const DOC_PLANNERS = [
  "hatch3r-roadmap.md",
  "hatch3r-project-spec.md",
  "hatch3r-api-spec.md",
  "hatch3r-spec.md",
] as const;

describe("plan gate content contract (2.7.1)", () => {
  it("(a) orchestration frame owns the In-Session Plan Gate + Execute-Now Continuation sections and the ASK literal", () => {
    const raw = readRepoFile("commands/shared/orchestration-frame.md");
    expect(raw).toContain("## In-Session Plan Gate (plan_gate: true)");
    expect(raw).toContain("## Execute-Now Continuation (executable-plan producers)");
    expect(raw).toContain("execute now");
  });

  it.each(PLAN_GATE_ROSTER)("(b) %s declares plan_gate: true and cites the In-Session Plan Gate frame section", (name) => {
    const raw = readRepoFile(`commands/${name}`);
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter.plan_gate).toBe(true);
    expect(body).toContain("In-Session Plan Gate");
  });

  it.each(EXECUTE_OR_DEFER_PRODUCERS)("(c) %s carries an Execute or Defer heading and the execute-now ASK literal", (name) => {
    const raw = readRepoFile(`commands/${name}`);
    const { body } = splitFrontmatter(raw);
    expect(body).toMatch(/^## (?:Phase 3\.5 — )?Execute or Defer/m);
    expect(body).toContain("execute now");
  });

  it("(d) hatch3r-workflow 1a-plan existence-guard directory list includes docs/plans/", () => {
    const { body } = splitFrontmatter(readRepoFile("commands/hatch3r-workflow.md"));
    const intakeIdx = body.indexOf("#### 1a-plan. Plan-File Intake");
    expect(intakeIdx).toBeGreaterThan(-1);
    // Same containment style as the (b) existence-guard loop above, scoped to
    // the intake section so the pin cannot be satisfied by an unrelated mention.
    expect(body.slice(intakeIdx)).toContain("docs/plans/");
  });

  it.each(DOC_PLANNERS)("(e) %s (doc planner) carries NO Execute or Defer heading", (name) => {
    const { body } = splitFrontmatter(readRepoFile(`commands/${name}`));
    // Negative of the (c) heading regex, widened to any h2 that names the seam
    // (phase-prefixed or not) so a renamed heading cannot dodge the pin.
    expect(body).not.toMatch(/^##.*Execute or Defer/m);
  });
});
