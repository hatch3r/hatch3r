import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENFORCEMENT_VALUES,
  parseControlTable,
  runValidator,
} from "../validate-control-reachability.js";

// ── Fixture helpers ────────────────────────────────────────────────
//
// Each fixture builds a tiny repo: a CLI entry that imports a chain of
// pipeline modules, plus a control-status doc whose table the validator reads.
// The doc registration is injected via `opts.docs` so the test never touches
// the real ADR-001.

interface Fixture {
  rootDir: string;
  pipelineDir: string;
  cliDir: string;
  docDir: string;
  docRel: string;
}

const DOC_REL = "docs/decisions/fixture-controls.md";
const TABLE_HEADING = "Fixture Pipeline Modules";

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "control-reach-"));
  const pipelineDir = join(rootDir, "src", "pipeline");
  const cliDir = join(rootDir, "src", "cli");
  const docDir = join(rootDir, "docs", "decisions");
  await mkdir(pipelineDir, { recursive: true });
  await mkdir(join(cliDir, "commands"), { recursive: true });
  await mkdir(docDir, { recursive: true });
  return { rootDir, pipelineDir, cliDir, docDir, docRel: DOC_REL };
}

async function writeFileAt(absPath: string, body: string): Promise<void> {
  await writeFile(absPath, body, "utf-8");
}

/** A control-status doc with the given rows (each `[module, enforcement]`). */
function docWithRows(rows: ReadonlyArray<readonly [string, string]>, opts: { dropEnforcementCol?: boolean } = {}): string {
  const header = opts.dropEnforcementCol
    ? "| Module | Purpose |\n|--------|---------|"
    : "| Module | Purpose | Enforcement |\n|--------|---------|-------------|";
  const body = rows
    .map(([mod, enf]) =>
      opts.dropEnforcementCol
        ? `| \`${mod}\` | purpose |`
        : `| \`${mod}\` | purpose | \`${enf}\` |`,
    )
    .join("\n");
  return `# Fixture\n\n## ${TABLE_HEADING}\n\n${header}\n${body}\n\n## Next\n`;
}

const DOC_REG = [
  {
    relPath: DOC_REL,
    tableHeading: TABLE_HEADING,
    moduleColumn: "Module",
    enforcementColumn: "Enforcement",
    moduleDir: "pipeline",
  },
];

const CLI_ENTRIES = ["src/cli/index.ts"];

// ── parseControlTable unit ─────────────────────────────────────────

describe("parseControlTable", () => {
  const doc = DOC_REG[0];

  it("extracts module + enforcement cells, stripping backticks", () => {
    const body = docWithRows([
      ["circuitBreaker", "runtime-CLI"],
      ["agentIdentity", "library-contract-for-downstream"],
    ]);
    const { rows, enforcementColumnMissing } = parseControlTable(body, doc);
    expect(enforcementColumnMissing).toBe(false);
    expect(rows).not.toBeNull();
    expect(rows).toEqual([
      { module: "circuitBreaker", enforcement: "runtime-CLI", modulePath: "pipeline/circuitBreaker" },
      {
        module: "agentIdentity",
        enforcement: "library-contract-for-downstream",
        modulePath: "pipeline/agentIdentity",
      },
    ]);
  });

  it("flags a table with no Enforcement column header", () => {
    const body = docWithRows([["circuitBreaker", ""]], { dropEnforcementCol: true });
    const { rows, enforcementColumnMissing } = parseControlTable(body, doc);
    expect(enforcementColumnMissing).toBe(true);
    expect(rows).toBeNull();
  });

  it("returns rows:null when the table heading is absent", () => {
    const body = "# No table here\n\njust prose.\n";
    const { rows, enforcementColumnMissing } = parseControlTable(body, doc);
    expect(rows).toBeNull();
    expect(enforcementColumnMissing).toBe(false);
  });
});

// ── runValidator integration ───────────────────────────────────────

describe("validate-control-reachability runValidator", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  /** Wire a CLI entry that imports `mods` from pipeline (direct, runtime). */
  async function wireCliImporting(mods: readonly string[]): Promise<void> {
    const imports = mods
      .map((m, i) => `import { M${i} } from "../pipeline/${m}.js";\nexport const U${i} = M${i};`)
      .join("\n");
    await writeFileAt(join(fx.cliDir, "index.ts"), `${imports}\n`);
  }

  async function writePipelineModule(name: string): Promise<void> {
    await writeFileAt(join(fx.pipelineDir, `${name}.ts`), `export const ${name.toUpperCase()} = 1;\n`);
  }

  it("PASSes when a runtime-CLI module is transitively reachable from the CLI entry", async () => {
    await writePipelineModule("circuitBreaker");
    await wireCliImporting(["circuitBreaker"]);
    await writeFileAt(join(fx.docDir, "fixture-controls.md"), docWithRows([["circuitBreaker", "runtime-CLI"]]));
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount, JSON.stringify(result.findings)).toBe(0);
    expect(result.controlsChecked).toBe(1);
    expect(result.runtimeCliControls).toBe(1);
  });

  it("PASSes through a transitive (non-direct) import chain", async () => {
    await writePipelineModule("diffHash");
    await writeFileAt(
      join(fx.pipelineDir, "complianceVerification.ts"),
      `import { DIFFHASH } from "./diffHash.js";\nexport const CV = DIFFHASH;\n`,
    );
    await writeFileAt(
      join(fx.cliDir, "commands", "validate.ts"),
      `import { CV } from "../../pipeline/complianceVerification.js";\nexport const V = CV;\n`,
    );
    await writeFileAt(join(fx.cliDir, "index.ts"), `import { V } from "./commands/validate.js";\nexport const X = V;\n`);
    await writeFileAt(join(fx.docDir, "fixture-controls.md"), docWithRows([["diffHash", "runtime-CLI"]]));
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount, JSON.stringify(result.findings)).toBe(0);
  });

  it("ERRORs (REACH-UNREACHABLE) when a runtime-CLI module is NOT reachable from any CLI entry — the dead-export pattern (D16-3 F4)", async () => {
    // The exact anti-pattern: a module a doc claims is runtime-enforced but which
    // no CLI codepath imports. A unit test calling the function directly would
    // keep `npm test` green; this gate fails on the unreachable claim.
    await writePipelineModule("agentIdentity");
    await wireCliImporting([]); // CLI entry imports nothing from pipeline
    await writeFileAt(join(fx.docDir, "fixture-controls.md"), docWithRows([["agentIdentity", "runtime-CLI"]]));
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("REACH-UNREACHABLE");
    expect(result.findings[0].message).toContain("agentIdentity");
  });

  it("does NOT require reachability for library-contract-for-downstream modules", async () => {
    // The honesty exemption: a module imported only by tests / build-time
    // scripts is correctly labelled library-only and carries no reachability
    // obligation — so the gate passes.
    await writePipelineModule("pipelineContext");
    await wireCliImporting([]);
    await writeFileAt(
      join(fx.docDir, "fixture-controls.md"),
      docWithRows([["pipelineContext", "library-contract-for-downstream"]]),
    );
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(0);
    expect(result.runtimeCliControls).toBe(0);
    expect(result.controlsChecked).toBe(1);
  });

  it("ERRORs (REACH-BAD-ENFORCEMENT) on an out-of-vocabulary enforcement value", async () => {
    await writePipelineModule("circuitBreaker");
    await wireCliImporting(["circuitBreaker"]);
    await writeFileAt(join(fx.docDir, "fixture-controls.md"), docWithRows([["circuitBreaker", "active"]]));
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("REACH-BAD-ENFORCEMENT");
  });

  it("ERRORs (REACH-MISSING-MODULE) when a row names a module file that does not exist", async () => {
    await wireCliImporting([]);
    await writeFileAt(join(fx.docDir, "fixture-controls.md"), docWithRows([["ghostModule", "runtime-CLI"]]));
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("REACH-MISSING-MODULE");
  });

  it("ERRORs (REACH-NO-ENFORCEMENT-COL) when the status table drops the Enforcement column", async () => {
    await writePipelineModule("circuitBreaker");
    await wireCliImporting(["circuitBreaker"]);
    await writeFileAt(
      join(fx.docDir, "fixture-controls.md"),
      docWithRows([["circuitBreaker", ""]], { dropEnforcementCol: true }),
    );
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("REACH-NO-ENFORCEMENT-COL");
  });

  it("ERRORs (REACH-DOC-MISSING) when a registered control-status doc is absent", async () => {
    await wireCliImporting([]);
    // no doc file written
    const result = await runValidator({ rootDir: fx.rootDir, docs: DOC_REG, cliEntries: CLI_ENTRIES });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("REACH-DOC-MISSING");
  });

  it("exposes the controlled Enforcement vocabulary as a stable contract", () => {
    expect(ENFORCEMENT_VALUES).toContain("runtime-CLI");
    expect(ENFORCEMENT_VALUES).toContain("setup-time-shape-check");
    expect(ENFORCEMENT_VALUES).toContain("library-contract-for-downstream");
    expect(ENFORCEMENT_VALUES).toContain("prompt-directive");
  });
});

// ── Real-corpus assertion (the gate this validator backstops) ──────

describe("validate-control-reachability against the real corpus", () => {
  it("the registered control-status docs pass: every runtime-CLI control is reachable", async () => {
    const result = await runValidator();
    expect(result.errorCount, JSON.stringify(result.findings, null, 2)).toBe(0);
    // ADR-001's 14-row pipeline table is registered and read end-to-end.
    expect(result.controlsChecked).toBeGreaterThanOrEqual(14);
    expect(result.runtimeCliControls).toBeGreaterThanOrEqual(1);
  });
});
