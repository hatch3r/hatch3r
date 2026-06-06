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
  "hatch3r-revision.md",
  "hatch3r-board-pickup.md",
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
    const revPath = join(fx.rootDir, "commands", "hatch3r-revision.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(revPath, "utf-8");
    const stripped = body.replace("hatch3r-docs-writer, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(revPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CMD-MISSING" && f.message.includes("hatch3r-docs-writer"),
    );
    expect(miss).toBeDefined();
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

  // ── CQ trigger-table parity (D16-12 / D6-15 / D22-6) ────────────

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when fixer's CQ trigger column diverges", async () => {
    // The CQ specialist trigger table is hand-copied into implementer, reviewer,
    // AND fixer. Drift fixer's CQ3 trigger prose only; the parity check (which
    // now opens fixer — the file the prior gate never read) must catch it.
    const fixerPath = join(fx.rootDir, "agents", "hatch3r-fixer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(fixerPath, "utf-8");
    const drifted = body.replace(
      /(\|\s*CQ3 Security\s*\|\s*`hatch3r-security`\s*\|)([^\n]*)/,
      "$1 DRIFTED trigger prose |",
    );
    expect(drifted).not.toBe(body); // ensure the replace matched
    await writeFile(fixerPath, drifted, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const drift = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-fixer.md",
    );
    expect(drift).toBeDefined();
    expect(drift?.message).toMatch(/CQ3/);
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when fixer's CQ trigger table is removed entirely", async () => {
    const fixerPath = join(fx.rootDir, "agents", "hatch3r-fixer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(fixerPath, "utf-8");
    // Drop every CQ table row from fixer; the gate must report a missing table.
    const stripped = body
      .split("\n")
      .filter((l) => !/^\s*\|\s*CQ\d\b/.test(l.trim()))
      .join("\n");
    expect(stripped).not.toBe(body);
    await writeFile(fixerPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-fixer.md",
    );
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/no CQ specialist trigger table rows/);
  });

  it("ERRORs (ROSTER-CQ-TABLE-DRIFT) when reviewer adds a CQ row the others lack", async () => {
    const reviewPath = join(fx.rootDir, "agents", "hatch3r-reviewer.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(reviewPath, "utf-8");
    // Inject a bogus extra CQ row after CQ9 in reviewer only.
    const injected = body.replace(
      /(\|\s*CQ9 Enhancability\s*\|[^\n]*\n)/,
      "$1| CQ9 Enhancability EXTRA | `hatch3r-enhancability` | bogus duplicate row |\n",
    );
    expect(injected).not.toBe(body);
    await writeFile(reviewPath, injected, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    // The injected row reuses the CQ9 label, so the reference (implementer) CQ9
    // row differs from reviewer's CQ9 — surfaced as a drift on the reviewer file.
    const drift = r.findings.find(
      (f) => f.code === "ROSTER-CQ-TABLE-DRIFT" && f.file === "agents/hatch3r-reviewer.md",
    );
    expect(drift).toBeDefined();
  });
});
