import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator } from "../validate-specialist-roster.js";
import { SPECIALIST_TRIGGER_TABLE } from "../../src/pipeline/pipelineContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ── Fixture: a minimal but VALID roster surface ─────────────────────
//
// The fixture clones the real agent files, orchestration rule, and the four
// dispatching command files into a temp root so a test can mutate ONE surface
// in isolation and assert the gate fires. Cloning the real files keeps the
// fixture in lock-step with the SSOT — when a specialist is added to the code
// constant the unmodified clone keeps the baseline green.

interface Fixture {
  rootDir: string;
}

const COMMAND_FILES = [
  "hatch3r-workflow.md",
  "hatch3r-board-pickup.md",
  "hatch3r-pr-resolve.md",
  "hatch3r-quick-change.md",
];

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "roster-validator-"));
  await mkdir(join(rootDir, "agents"), { recursive: true });
  await mkdir(join(rootDir, "commands"), { recursive: true });
  await mkdir(join(rootDir, "rules"), { recursive: true });

  // Clone every specialist agent file named in the SSOT.
  for (const t of SPECIALIST_TRIGGER_TABLE) {
    await cp(
      join(REPO_ROOT, "agents", `${t.specialist}.md`),
      join(rootDir, "agents", `${t.specialist}.md`),
    );
  }
  // The four core 4-phase pipeline agents: implementer + reviewer carry the
  // Phase 4 enumerations; researcher + fixer round out the watchdog-coverage
  // required set (D8-12). Clone all four so the unmodified fixture is green.
  for (const core of [
    "hatch3r-researcher",
    "hatch3r-implementer",
    "hatch3r-fixer",
    "hatch3r-reviewer",
  ]) {
    await cp(
      join(REPO_ROOT, "agents", `${core}.md`),
      join(rootDir, "agents", `${core}.md`),
    );
  }
  // D22-6 single source: the 9-row CQ trigger table lives in
  // agents/shared/cq-specialist-roster.md; implementer/reviewer/fixer point at
  // it. checkCqTriggerTableParity reads this file as the reference copy, so the
  // fixture must clone it or the unmodified baseline reports a missing-roster
  // ROSTER-CQ-TABLE-DRIFT error.
  await mkdir(join(rootDir, "agents", "shared"), { recursive: true });
  await cp(
    join(REPO_ROOT, "agents", "shared", "cq-specialist-roster.md"),
    join(rootDir, "agents", "shared", "cq-specialist-roster.md"),
  );
  await cp(
    join(REPO_ROOT, "rules", "hatch3r-agent-orchestration.md"),
    join(rootDir, "rules", "hatch3r-agent-orchestration.md"),
  );
  for (const f of COMMAND_FILES) {
    await cp(join(REPO_ROOT, "commands", f), join(rootDir, "commands", f));
  }
  return { rootDir };
}

describe("validate-specialist-roster", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Happy path ─────────────────────────────────────────────────

  it("PASSes against the real (cloned) roster surface", async () => {
    const r = await runValidator({ rootDir: fx.rootDir });
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.ssotSpecialists.length).toBe(SPECIALIST_TRIGGER_TABLE.length);
  });

  it("PASSes against the actual repository root (live content)", async () => {
    // No rootDir override → validates the real repo. This is the gate CI runs.
    const r = await runValidator();
    expect(r.errorCount).toBe(0);
  });

  // ── Rule table drift ───────────────────────────────────────────

  it("ERRORs when a specialist is removed from the rule's Phase 4 table", async () => {
    const rulePath = join(fx.rootDir, "rules", "hatch3r-agent-orchestration.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(rulePath, "utf-8");
    const stripped = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("| `hatch3r-devops`"))
      .join("\n");
    await writeFile(rulePath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find((f) => f.code === "ROSTER-RULE-MISSING");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/hatch3r-devops/);
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("ERRORs when the rule table lists a specialist not in the SSOT", async () => {
    const rulePath = join(fx.rootDir, "rules", "hatch3r-agent-orchestration.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(rulePath, "utf-8");
    // Inject a bogus row directly after the existing devops row.
    const injected = body.replace(
      /(\| `hatch3r-devops`[^\n]*\n)/,
      "$1| `hatch3r-nonexistent` | Conditional | bogus |\n",
    );
    expect(injected).not.toBe(body); // ensure the replace matched
    await writeFile(rulePath, injected, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const extra = r.findings.find((f) => f.code === "ROSTER-RULE-EXTRA");
    expect(extra).toBeDefined();
    expect(extra?.message).toMatch(/hatch3r-nonexistent/);
  });

  // ── Trigger-mode parity (D7-M7 / D7-SA7.3-1) ───────────────────

  it("ERRORs when the rule table trigger mode disagrees with the SSOT", async () => {
    const rulePath = join(fx.rootDir, "rules", "hatch3r-agent-orchestration.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(rulePath, "utf-8");
    // hatch3r-security is "Always" in the SSOT; flip the rule row to
    // "Conditional" and expect the new parity check to surface the drift.
    const drifted = body.replace(
      /(\| `hatch3r-security`[^|]*\|\s*)Always(\s*\|)/,
      "$1Conditional$2",
    );
    expect(drifted).not.toBe(body);
    await writeFile(rulePath, drifted, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const drift = r.findings.find((f) => f.code === "ROSTER-RULE-MODE-MISMATCH");
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/hatch3r-security/);
    expect(drift?.message).toMatch(/"always" in SSOT but "conditional"/);
  });

  it("ERRORs when a Mandatory-on-match rule row is flipped back to Conditional (2.2.0)", async () => {
    // hatch3r-ui is "mandatory-on-match" in the SSOT; flip the rule row to
    // "Conditional" and expect the mode-parity check to read the 4-mode
    // vocabulary and surface the drift.
    const rulePath = join(fx.rootDir, "rules", "hatch3r-agent-orchestration.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(rulePath, "utf-8");
    const drifted = body.replace(
      /(\| `hatch3r-ui`[^|]*\|\s*)Mandatory-on-match(\s*\|)/,
      "$1Conditional$2",
    );
    expect(drifted).not.toBe(body);
    await writeFile(rulePath, drifted, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const drift = r.findings.find((f) => f.code === "ROSTER-RULE-MODE-MISMATCH");
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/hatch3r-ui/);
    expect(drift?.message).toMatch(/"mandatory-on-match" in SSOT but "conditional"/);
  });

  // ── Agent-file roster gap ──────────────────────────────────────

  it("ERRORs when a specialist's agent file is missing", async () => {
    await rm(join(fx.rootDir, "agents", "hatch3r-enhancability.md"), { force: true });

    const r = await runValidator({ rootDir: fx.rootDir });
    const gap = r.findings.find((f) => f.code === "ROSTER-AGENT-FILE");
    expect(gap).toBeDefined();
    expect(gap?.message).toMatch(/hatch3r-enhancability/);
  });

  // ── Implementer / reviewer enumeration drift ───────────────────

  it("ERRORs when implementer.md omits a specialist from its enumeration", async () => {
    const implPath = join(fx.rootDir, "agents", "hatch3r-implementer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(implPath, "utf-8");
    // Remove every backticked mention of hatch3r-maintainability so the
    // enumeration no longer names it.
    const stripped = body.split("`hatch3r-maintainability`").join("hatch3r-maintainability-PLAIN");
    await writeFile(implPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find((f) => f.code === "ROSTER-IMPL-MISSING");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/hatch3r-maintainability/);
  });

  it("ERRORs when reviewer.md omits a specialist from its enumeration", async () => {
    const reviewPath = join(fx.rootDir, "agents", "hatch3r-reviewer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(reviewPath, "utf-8");
    const stripped = body.split("`hatch3r-scalability`").join("hatch3r-scalability-PLAIN");
    await writeFile(reviewPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find((f) => f.code === "ROSTER-REVIEW-MISSING");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/hatch3r-scalability/);
  });

  // ── Command agentPipeline drift ────────────────────────────────

  it("ERRORs when a full-pipeline command drops an always-mode specialist", async () => {
    // F16.3-H1 (Cycle 10 Wave 1C): always-mode floor moved from
    // legacy security-auditor to CQ3 hatch3r-security; assertion follows.
    const wfPath = join(fx.rootDir, "commands", "hatch3r-workflow.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(wfPath, "utf-8");
    const stripped = body.replace("hatch3r-security, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(wfPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CMD-MISSING" && f.message.includes("hatch3r-security"),
    );
    expect(miss).toBeDefined();
    expect(miss?.file).toBe("commands/hatch3r-workflow.md");
  });

  it("ERRORs when a full-pipeline command drops the evaluate-mode docs-writer", async () => {
    const bpPath = join(fx.rootDir, "commands", "hatch3r-board-pickup.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(bpPath, "utf-8");
    const stripped = body.replace("hatch3r-docs-writer, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(bpPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CMD-MISSING" && f.message.includes("hatch3r-docs-writer"),
    );
    expect(miss).toBeDefined();
  });

  it("ERRORs when a full-pipeline command drops a mandatory-on-match specialist (2.2.0)", async () => {
    // hatch3r-ux is "mandatory-on-match" — a full-pipeline orchestrator must be
    // able to dispatch the hard-mandate Tier 2/3 specialist, so dropping it
    // from board-pickup's agentPipeline is a ROSTER-CMD-MISSING error.
    const bpPath = join(fx.rootDir, "commands", "hatch3r-board-pickup.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(bpPath, "utf-8");
    const stripped = body.replace("hatch3r-ux, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(bpPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) =>
        f.code === "ROSTER-CMD-MISSING" &&
        f.file === "commands/hatch3r-board-pickup.md" &&
        f.message.includes("hatch3r-ux"),
    );
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/mandatory-on-match/);
  });

  it("ERRORs when pr-resolve drops a mandatory-on-match specialist (2.2.0)", async () => {
    // 2.2.0 added hatch3r-ui/hatch3r-ux (mandatory-on-match) to pr-resolve's
    // agentPipeline; pr-resolve is in FULL_PIPELINE_COMMANDS so dropping
    // hatch3r-ux must fail the gate (Bugbot r3540353684).
    const prPath = join(fx.rootDir, "commands", "hatch3r-pr-resolve.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(prPath, "utf-8");
    const stripped = body.replace("hatch3r-ux, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(prPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) =>
        f.code === "ROSTER-CMD-MISSING" &&
        f.file === "commands/hatch3r-pr-resolve.md" &&
        f.message.includes("hatch3r-ux"),
    );
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/mandatory-on-match/);
  });

  it("does NOT require a mandatory-on-match specialist on quick-change (always floor only)", async () => {
    // quick-change is the Tier-1 carve-out held only to the always-mode floor;
    // the mandatory-on-match Tier 2/3 mandate never binds at Tier 1.
    //
    // CI-RECON-05 fixture reconciliation: wave 3 (D7-SA7.5-03, 9c8c087)
    // removed the over-declared hatch3r-ui/hatch3r-ux from the LIVE
    // agentPipeline (0 body dispatches — "declare what the body dispatches"),
    // so the old `body.replace("hatch3r-ui, ", "")` mutation no-opped and
    // tripped the mutation-detection guard. The live file now already IS the
    // "no mandatory-on-match specialist in the pipeline" state this test used
    // to create by stripping. Keep the mutation-detection intent by:
    //   1. guarding that neither mandatory-on-match id re-appears in the
    //      pipeline (if one does, restore the original strip-that-id form);
    //   2. stripping a dynamically derived, genuinely present core-pipeline
    //      token (not an SSOT specialist, so it can never intersect the
    //      always-mode floor) — proving the validator runs against a real
    //      mutation and still demands no mandatory-on-match specialist.
    const qcPath = join(fx.rootDir, "commands", "hatch3r-quick-change.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(qcPath, "utf-8");
    const pipelineMatch = body.match(/agentPipeline:\s*\[([^\]]*)\]/);
    expect(pipelineMatch, "quick-change must declare an agentPipeline").not.toBeNull();
    const pipeline = pipelineMatch![1].split(",").map((s) => s.trim());
    expect(pipeline).not.toContain("hatch3r-ui");
    expect(pipeline).not.toContain("hatch3r-ux");

    const specialistIds = new Set(SPECIALIST_TRIGGER_TABLE.map((t) => t.specialist));
    const stripToken = pipeline.find((id) => !specialistIds.has(id));
    expect(
      stripToken,
      "pipeline must contain a non-specialist core agent to strip",
    ).toBeDefined();
    const stripped = body.replace(`${stripToken}, `, "");
    expect(stripped).not.toBe(body);
    await writeFile(qcPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const uiMiss = r.findings.find(
      (f) =>
        f.file === "commands/hatch3r-quick-change.md" &&
        (f.message.includes("hatch3r-ui") || f.message.includes("hatch3r-ux")),
    );
    expect(uiMiss).toBeUndefined();
  });

  it("does NOT require the evaluate-mode docs-writer on quick-change (Tier-1 carve-out)", async () => {
    // quick-change already omits docs-writer in the real content. Baseline must
    // be clean — proving the always-floor (not always+evaluate) policy applies.
    const r = await runValidator({ rootDir: fx.rootDir });
    const qcDocsWriter = r.findings.find(
      (f) =>
        f.file === "commands/hatch3r-quick-change.md" && f.message.includes("hatch3r-docs-writer"),
    );
    expect(qcDocsWriter).toBeUndefined();
  });

  it("ERRORs when quick-change drops an always-mode specialist (floor still enforced)", async () => {
    // F16.3-H1 (Cycle 10 Wave 1C): always-mode floor moved from legacy
    // test-writer to CQ5 hatch3r-testability; assertion follows.
    const qcPath = join(fx.rootDir, "commands", "hatch3r-quick-change.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(qcPath, "utf-8");
    const stripped = body.replace("hatch3r-testability, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(qcPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) =>
        f.file === "commands/hatch3r-quick-change.md" &&
        f.code === "ROSTER-CMD-MISSING" &&
        f.message.includes("hatch3r-testability"),
    );
    expect(miss).toBeDefined();
  });

  // ── Missing command file ───────────────────────────────────────

  it("ERRORs when a full-pipeline command file is missing", async () => {
    await rm(join(fx.rootDir, "commands", "hatch3r-board-pickup.md"), { force: true });

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CMD-MISSING" && f.file === "commands/hatch3r-board-pickup.md",
    );
    expect(miss).toBeDefined();
  });

  // ── Frontmatter parse failure → warning, not error ─────────────

  it("emits a WARNING (not error) when a command's frontmatter is unparseable", async () => {
    const wfPath = join(fx.rootDir, "commands", "hatch3r-workflow.md");
    // Unclosed bracket inside the frontmatter block.
    await writeFile(
      wfPath,
      "---\nid: hatch3r-workflow\norchestrator: true\nagentPipeline: [hatch3r-implementer\n---\n# Workflow\n",
      "utf-8",
    );

    const r = await runValidator({ rootDir: fx.rootDir });
    expect(r.findings.some((f) => f.code === "ROSTER-CMD-FM-PARSE")).toBe(true);
    // The parse-failure path must not raise a CMD-MISSING error for that file.
    expect(
      r.findings.some(
        (f) => f.code === "ROSTER-CMD-MISSING" && f.file === "commands/hatch3r-workflow.md",
      ),
    ).toBe(false);
  });

  // ── Watchdog coverage (D8-12) ──────────────────────────────────

  it("ERRORs (ROSTER-WATCHDOG-MISSING) when an agent declares no watchdog directive", async () => {
    // Strip the watchdog directive from a core pipeline agent: remove both the
    // frontmatter field and any shared-frame reference.
    const fixerPath = join(fx.rootDir, "agents", "hatch3r-fixer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(fixerPath, "utf-8");
    const stripped = body
      .split("\n")
      .filter((l) => !/^\s*wall_clock_advisory_ms\s*:/.test(l))
      .join("\n")
      .split("quality-specialist-frame")
      .join("quality-OTHER-frame");
    await writeFile(fixerPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-WATCHDOG-MISSING" && f.file === "agents/hatch3r-fixer.md",
    );
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/wall_clock_advisory_ms/);
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("accepts the shared-frame reference as a watchdog carrier (no field needed)", async () => {
    // Replace docs-writer's watchdog field with a quality-specialist-frame
    // reference in the body — the second accepted carrier (D8-11). The gate
    // must NOT flag it.
    const dwPath = join(fx.rootDir, "agents", "hatch3r-docs-writer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(dwPath, "utf-8");
    const withoutField = body
      .split("\n")
      .filter((l) => !/^\s*wall_clock_advisory_ms\s*:/.test(l))
      .join("\n");
    const withFrameRef =
      withoutField + "\n\nWatchdog: see `agents/shared/quality-specialist-frame.md`.\n";
    await writeFile(dwPath, withFrameRef, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    expect(
      r.findings.some(
        (f) => f.code === "ROSTER-WATCHDOG-MISSING" && f.file === "agents/hatch3r-docs-writer.md",
      ),
    ).toBe(false);
  });

  // ── CQ trigger-table single-source parity (D16-12 / D6-15 / D22-6) ──
  //
  // D22-6 extracted the 9-row CQ trigger table to the single source
  // agents/shared/cq-specialist-roster.md and replaced the implementer/reviewer/
  // fixer copies with a one-line pointer. The three drift scenarios below mean,
  // in the single-source topology: (a) a consumer re-inlines a divergent copy of
  // a row, (b) a consumer drops its roster pointer, (c) a consumer re-inlines a
  // row that diverges from the shared source.

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when fixer re-inlines a divergent CQ row", async () => {
    // D22-6 single source: the CQ trigger table lives once in
    // agents/shared/cq-specialist-roster.md and fixer points at it. The
    // regression this catches is a copy reintroduced inline that diverges from
    // the source. Inject a CQ3 row into fixer's Specialist Delegation section
    // whose trigger prose does not match the shared roster's CQ3 row; the parity
    // check (which now opens fixer — the file the prior gate never read) must
    // flag the divergent reintroduced copy.
    const fixerPath = join(fx.rootDir, "agents", "hatch3r-fixer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(fixerPath, "utf-8");
    const injected = body.replace(
      /(## Specialist Delegation\n)/,
      "$1\n| CQ3 Security | `hatch3r-security` | DRIFTED reintroduced trigger prose |\n",
    );
    expect(injected).not.toBe(body); // ensure the replace matched
    await writeFile(fixerPath, injected, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const drift = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-fixer.md",
    );
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/CQ3/);
    expect(drift?.message).toMatch(/diverges/);
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when fixer loses its roster pointer entirely", async () => {
    // D22-6 single source: fixer carries no inline CQ rows — it points at the
    // shared roster. Drop that pointer (the path reference to
    // agents/shared/cq-specialist-roster.md) so fixer's Specialist Delegation
    // section neither inlines the table nor references the source; the gate must
    // report the lost roster reference.
    const fixerPath = join(fx.rootDir, "agents", "hatch3r-fixer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(fixerPath, "utf-8");
    // Remove every mention of the roster path so `pointsAtRoster` is false.
    const stripped = body
      .split("agents/shared/cq-specialist-roster.md")
      .join("agents/shared/cq-OTHER-roster.md");
    expect(stripped).not.toBe(body);
    await writeFile(fixerPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-fixer.md",
    );
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/lost the roster reference/);
  });

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when reviewer re-inlines a CQ row that diverges from the source", async () => {
    // D22-6 single source: reviewer points at the shared roster and carries no
    // inline CQ rows. Reintroduce a CQ9 row inline whose prose diverges from the
    // shared roster's CQ9 row; the gate compares each reintroduced row against
    // the single source (not against another agent) and flags the divergence on
    // the reviewer file.
    const reviewPath = join(fx.rootDir, "agents", "hatch3r-reviewer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(reviewPath, "utf-8");
    const injected = body.replace(
      /(## Specialist Delegation\n)/,
      "$1\n| CQ9 Enhancability | `hatch3r-enhancability` | bogus divergent reintroduced row |\n",
    );
    expect(injected).not.toBe(body);
    await writeFile(reviewPath, injected, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const drift = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-reviewer.md",
    );
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/CQ9/);
  });
});
