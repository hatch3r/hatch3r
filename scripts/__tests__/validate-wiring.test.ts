import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectLibraryExportOnly, runValidator } from "../validate-wiring.js";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
  pipelineDir: string;
  integrityDir: string;
  cliDir: string;
  testsDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "wiring-validator-"));
  const pipelineDir = join(rootDir, "src", "pipeline");
  const integrityDir = join(rootDir, "src", "integrity");
  const cliDir = join(rootDir, "src", "cli", "commands");
  const testsDir = join(rootDir, "src", "__tests__", "pipeline");
  await mkdir(pipelineDir, { recursive: true });
  await mkdir(integrityDir, { recursive: true });
  await mkdir(cliDir, { recursive: true });
  await mkdir(testsDir, { recursive: true });
  return { rootDir, pipelineDir, integrityDir, cliDir, testsDir };
}

async function writeModule(absPath: string, body: string): Promise<void> {
  await writeFile(absPath, body, "utf-8");
}

// ── detectLibraryExportOnly unit ──────────────────────────────────

describe("detectLibraryExportOnly", () => {
  it("returns true when @library_export_only appears in the leading block comment", () => {
    const raw = [
      "/**",
      " * A helper module.",
      " *",
      " * @library_export_only — exported for downstream packs.",
      " */",
      "export const X = 1;",
      "",
    ].join("\n");
    expect(detectLibraryExportOnly(raw)).toBe(true);
  });

  it("returns false when the tag appears only in body code (not the leading block)", () => {
    const raw = [
      "import { foo } from './x.js';",
      "",
      "/** Module body. */",
      "export const X = 1; // @library_export_only inline only",
      "",
    ].join("\n");
    expect(detectLibraryExportOnly(raw)).toBe(false);
  });

  it("returns false when there is no leading block comment", () => {
    const raw = "export const X = 1;\n";
    expect(detectLibraryExportOnly(raw)).toBe(false);
  });

  it("rejects partial matches like @library_export_only_v2", () => {
    const raw = [
      "/**",
      " * @library_export_only_v2 — should not match the canonical tag.",
      " */",
      "export const X = 1;",
      "",
    ].join("\n");
    expect(detectLibraryExportOnly(raw)).toBe(false);
  });

  it("returns true when a shebang precedes the block comment", () => {
    const raw = [
      "#!/usr/bin/env node",
      "/**",
      " * Script with shebang.",
      " *",
      " * @library_export_only",
      " */",
      "export const X = 1;",
      "",
    ].join("\n");
    // The current detector restricts the directive to a leading block
    // comment; a shebang followed by a block is permitted because the
    // line before the open contains only `/^[#].*$/` (allowed regex
    // for non-executable leading text). The assertion documents that
    // contract.
    expect(detectLibraryExportOnly(raw)).toBe(true);
  });
});

// ── runValidator integration ───────────────────────────────────────

describe("validate-wiring runValidator", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("PASSes when every pipeline module is imported by a non-test file", async () => {
    await writeModule(
      join(fx.pipelineDir, "foo.ts"),
      `export const FOO = 1;\n`,
    );
    await writeModule(
      join(fx.cliDir, "use-foo.ts"),
      `import { FOO } from "../../pipeline/foo.js";\nexport const X = FOO;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.scannedModules).toBe(1);
    expect(result.wiredModules).toBe(1);
    expect(result.libraryOnlyModules).toBe(0);
  });

  it("ERRORs when a pipeline module is imported only by tests", async () => {
    await writeModule(
      join(fx.pipelineDir, "lonely.ts"),
      `export const LONELY = 1;\n`,
    );
    await writeModule(
      join(fx.testsDir, "lonely.test.ts"),
      `import { LONELY } from "../../pipeline/lonely.js";\nconst _ = LONELY;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("WIRING-UNWIRED");
    expect(result.findings[0].file).toMatch(/lonely\.ts$/);
    expect(result.wiredModules).toBe(0);
  });

  it("does NOT flag a module with @library_export_only when only tests import it", async () => {
    const raw = [
      "/**",
      " * Library module.",
      " *",
      " * @library_export_only — intentionally library-only.",
      " */",
      "export const LIB = 1;",
      "",
    ].join("\n");
    await writeModule(join(fx.pipelineDir, "lib.ts"), raw);
    await writeModule(
      join(fx.testsDir, "lib.test.ts"),
      `import { LIB } from "../../pipeline/lib.js";\nconst _ = LIB;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.libraryOnlyModules).toBe(1);
    expect(result.wiredModules).toBe(0);
  });

  it("treats integrity/ modules with the same gate", async () => {
    await writeModule(
      join(fx.integrityDir, "hashes.ts"),
      `export const HASHES = 1;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].file).toMatch(/integrity\/hashes\.ts$/);
  });

  it("counts non-test importers correctly across multiple files", async () => {
    await writeModule(
      join(fx.pipelineDir, "shared.ts"),
      `export const SHARED = 1;\n`,
    );
    await writeModule(
      join(fx.cliDir, "user-a.ts"),
      `import { SHARED } from "../../pipeline/shared.js";\nexport const A = SHARED;\n`,
    );
    await writeModule(
      join(fx.cliDir, "user-b.ts"),
      `import { SHARED } from "../../pipeline/shared.js";\nexport const B = SHARED;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.wiredModules).toBe(1);
  });

  it("scans nested sub-directories under scanned dirs", async () => {
    const nestedDir = join(fx.pipelineDir, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeModule(
      join(nestedDir, "deep.ts"),
      `export const DEEP = 1;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.scannedModules).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].file).toMatch(/pipeline\/nested\/deep\.ts$/);
  });

  it("ignores `.d.ts` declaration files", async () => {
    await writeModule(
      join(fx.pipelineDir, "types.d.ts"),
      `export interface SomeType { x: number; }\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.scannedModules).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it("returns zero findings when no scanned directories exist", async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), "wiring-empty-"));
    const result = await runValidator({ rootDir: emptyRoot });
    expect(result.scannedModules).toBe(0);
    expect(result.errorCount).toBe(0);
    await rm(emptyRoot, { recursive: true, force: true });
  });

  it("includes the @library_export_only justification in the error message hint", async () => {
    await writeModule(
      join(fx.pipelineDir, "orphan.ts"),
      `export const ORPHAN = 1;\n`,
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.findings[0].message).toContain("@library_export_only");
    expect(result.findings[0].message).toContain("Wire it into a CLI command");
  });
});
