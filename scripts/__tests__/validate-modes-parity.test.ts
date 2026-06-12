import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator } from "../validate-modes-parity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

// ── Fixture: clone the real modes surface ───────────────────────────
//
// Cloning agents/modes/, the researcher (registration table), and the caller
// directories keeps the fixture in lock-step with the corpus — an unmodified
// clone is the green baseline, and a test mutates exactly one surface.

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "modes-parity-"));
  // Clone the caller directories wholesale; agents/ brings modes/ + researcher.
  for (const d of ["agents", "commands", "skills", "rules"]) {
    await cp(join(REPO_ROOT, d), join(rootDir, d), { recursive: true });
  }
  return { rootDir };
}

describe("validate-modes-parity", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("PASSes against the cloned modes surface (0 errors, 0 warnings)", async () => {
    const r = await runValidator({ rootDir: fx.rootDir });
    expect(r.findings).toEqual([]);
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.modeStems.length).toBeGreaterThan(0);
  });

  it("PASSes against the actual repository root (live content — the gate CI runs)", async () => {
    const r = await runValidator();
    expect(r.errorCount).toBe(0);
  });

  it("ERRORs (MODES-FILE-NO-ROW) when a mode file has no Research Modes row", async () => {
    // Add a new mode file with no corresponding table row.
    await writeFile(
      join(fx.rootDir, "agents", "modes", "orphan-mode.md"),
      "---\nid: orphan-mode\ntype: agent\n---\n# Orphan\n",
      "utf-8",
    );
    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find((f) => f.code === "MODES-FILE-NO-ROW");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/orphan-mode/);
    expect(r.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("ERRORs (MODES-ROW-NO-FILE) when a Research Modes row names a nonexistent mode", async () => {
    // Remove a backing file while leaving its table row in place.
    await rm(join(fx.rootDir, "agents", "modes", "regression.md"), { force: true });
    const r = await runValidator({ rootDir: fx.rootDir });
    const miss = r.findings.find((f) => f.code === "MODES-ROW-NO-FILE");
    expect(miss).toBeDefined();
    expect(miss?.message).toMatch(/regression/);
  });

  it("WARNs (MODES-ZERO-CALLER) when a mode is only in the registration table", async () => {
    // Regression note: the rel-vs-RESEARCHER_FILE path-separator mismatch (join() backslashes vs normalized rel) only manifests on win32 runners — CI is the regression surface for this test.
    // Add a mode file AND a matching table row, but give it no caller anywhere.
    await writeFile(
      join(fx.rootDir, "agents", "modes", "lonely-mode.md"),
      "---\nid: lonely-mode\ntype: agent\n---\n# Lonely\n",
      "utf-8",
    );
    const researcherPath = join(fx.rootDir, "agents", "hatch3r-researcher.md");
    const body = await readFile(researcherPath, "utf-8");
    // Append the new mode into the External Research row of the table.
    const injected = body.replace(
      /(\| External Research \| `library-docs`)/,
      "$1, `lonely-mode`",
    );
    expect(injected).not.toBe(body);
    await writeFile(researcherPath, injected, "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const warn = r.findings.find((f) => f.code === "MODES-ZERO-CALLER");
    expect(warn).toBeDefined();
    expect(warn?.message).toMatch(/lonely-mode/);
    // A zero-caller mode is a warning, never an error.
    expect(r.findings.some((f) => f.code === "MODES-ZERO-CALLER" && f.level === "error")).toBe(false);
  });

  it("WARNs (MODES-ZERO-CALLER) on a CRLF researcher checkout (Windows runners)", async () => {
    // Same scenario as above, but the researcher body uses CRLF line endings —
    // without read-time normalization the registration-region subtraction
    // no-ops and the table row masquerades as a caller.
    await writeFile(
      join(fx.rootDir, "agents", "modes", "lonely-mode.md"),
      "---\nid: lonely-mode\ntype: agent\n---\n# Lonely\n",
      "utf-8",
    );
    const researcherPath = join(fx.rootDir, "agents", "hatch3r-researcher.md");
    const body = await readFile(researcherPath, "utf-8");
    const injected = body.replace(
      /(\| External Research \| `library-docs`)/,
      "$1, `lonely-mode`",
    );
    expect(injected).not.toBe(body);
    await writeFile(researcherPath, injected.replace(/\n/g, "\r\n"), "utf-8");

    const r = await runValidator({ rootDir: fx.rootDir });
    const warn = r.findings.find((f) => f.code === "MODES-ZERO-CALLER");
    expect(warn).toBeDefined();
    expect(warn?.message).toMatch(/lonely-mode/);
  });
});
