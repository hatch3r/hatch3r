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
  // implementer + reviewer carry the Phase 4 enumerations.
  await cp(
    join(REPO_ROOT, "agents", "hatch3r-implementer.md"),
    join(rootDir, "agents", "hatch3r-implementer.md"),
  );
  await cp(
    join(REPO_ROOT, "agents", "hatch3r-reviewer.md"),
    join(rootDir, "agents", "hatch3r-reviewer.md"),
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
    const wfPath = join(fx.rootDir, "commands", "hatch3r-workflow.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(wfPath, "utf-8");
    const stripped = body.replace("hatch3r-security-auditor, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(wfPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) => f.code === "ROSTER-CMD-MISSING" && f.message.includes("hatch3r-security-auditor"),
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
    const qcPath = join(fx.rootDir, "commands", "hatch3r-quick-change.md");
    const { readFile } = await import("node:fs/promises");
    const body = await readFile(qcPath, "utf-8");
    const stripped = body.replace("hatch3r-test-writer, ", "");
    expect(stripped).not.toBe(body);
    await writeFile(qcPath, stripped, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find(
      (f) =>
        f.file === "commands/hatch3r-quick-change.md" &&
        f.code === "ROSTER-CMD-MISSING" &&
        f.message.includes("hatch3r-test-writer"),
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
});
