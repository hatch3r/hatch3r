import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, formatFinding } from "../validate-trust-crosswalk-citations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const DOC_REL = "governance/audit/domains/D15-trust-reference.md";
const PACK_TRUST_DOC_REL = "governance/pack-trust-model.md";
const COMPLIANCE_REL = "src/pipeline/complianceVerification.ts";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

/**
 * Build a minimal repo skeleton: the trust-reference doc, the pack-trust-model
 * doc (both are read by runValidator), a compliance file registering a known
 * check-ID set, and a `src/` tree containing the modules a test wants to cite.
 * `docBody` populates the crosswalk doc by default; `packDocBody` populates the
 * pack-trust-model doc (empty unless a Check-C/pack test sets it). `srcFiles`
 * are empty stubs unless `srcFileContents` supplies a body (used by Check C to
 * place a symbol definition).
 */
async function makeFixture(opts: {
  docBody?: string;
  packDocBody?: string;
  checkIds?: string[];
  controlRefs?: string[];
  srcFiles?: string[];
  srcFileContents?: Record<string, string>;
}): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "trust-crosswalk-"));
  await mkdir(join(rootDir, dirname(DOC_REL)), { recursive: true });
  await writeFile(join(rootDir, DOC_REL), opts.docBody ?? "", "utf-8");
  await mkdir(join(rootDir, dirname(PACK_TRUST_DOC_REL)), { recursive: true });
  await writeFile(join(rootDir, PACK_TRUST_DOC_REL), opts.packDocBody ?? "", "utf-8");

  const idLines = (opts.checkIds ?? [])
    .map((id) => `  checks.push({ id: "${id}", controlRef: "X" });`)
    .join("\n");
  const refLines = (opts.controlRefs ?? [])
    .map((ref) => `  checks.push({ id: "z", controlRef: "${ref}" });`)
    .join("\n");
  await mkdir(join(rootDir, dirname(COMPLIANCE_REL)), { recursive: true });
  await writeFile(
    join(rootDir, COMPLIANCE_REL),
    `export function run() {\n${idLines}\n${refLines}\n}\n`,
    "utf-8",
  );

  for (const rel of opts.srcFiles ?? []) {
    await mkdir(join(rootDir, dirname(rel)), { recursive: true });
    const body = opts.srcFileContents?.[rel] ?? "// fixture\n";
    await writeFile(join(rootDir, rel), body, "utf-8");
  }
  return { rootDir };
}

// ── Tests ──────────────────────────────────────────────────────────

// Privatization gate: governance/audit/domains/D15-trust-reference.md is private
// overlay IP, gitignored and absent in public CI / contributor clones. Skip the
// live-corpus assertion when the doc is absent (mirrors
// validate-governance-total.test.ts's "skips clean when the CONSTITUTION is
// absent (private-corpus public CI)" contract); the fixture-driven Check A/B/C
// suites below stay fully effective regardless. The assertion runs unchanged
// wherever the doc is present.
const D15_DOC_PRESENT = existsSync(resolve(REPO_ROOT, DOC_REL));

describe("validate-trust-crosswalk-citations — live corpus", () => {
  it.skipIf(!D15_DOC_PRESENT)(
    "passes against the shipped D15-trust-reference.md (every citation resolves)",
    async () => {
      const findings = await runValidator(REPO_ROOT);
      expect(findings).toEqual([]);
    },
  );
});

describe("validate-trust-crosswalk-citations — Check A (cited-path resolution)", () => {
  let fx: Fixture;
  afterEach(async () => {
    if (fx) await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("does NOT flag a bare .ts module that resolves under src/", async () => {
    fx = await makeFixture({
      docBody: "row | agentIdentity.ts | done\n",
      srcFiles: ["src/pipeline/agentIdentity.ts"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("flags a bare .ts module that does not exist on disk", async () => {
    fx = await makeFixture({
      docBody: "row | secretDetect.ts | broken\n",
      srcFiles: ["src/env/secretDetection.ts"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("TRUST-CITE-PATH-MISSING");
    expect(findings[0].token).toBe("secretDetect.ts");
    expect(findings[0].line).toBe(1);
  });

  it("flags a rooted src/ path that does not exist", async () => {
    fx = await makeFixture({
      docBody: "row | `src/pipeline/diffHashVerify.ts` | broken\n",
      srcFiles: ["src/pipeline/diffHash.ts"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("TRUST-CITE-PATH-MISSING");
    expect(findings[0].token).toBe("src/pipeline/diffHashVerify.ts");
  });

  it("does NOT double-flag a bare basename already inside a resolved rooted path", async () => {
    fx = await makeFixture({
      docBody: "row | `src/env/secretDetection.ts` | done\n",
      srcFiles: ["src/env/secretDetection.ts"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("resolves a .test.ts citation only against the __tests__ tree", async () => {
    fx = await makeFixture({
      docBody: "row | `src/__tests__/pipeline/reviewLoop.test.ts` | done\n",
      srcFiles: ["src/__tests__/pipeline/reviewLoop.test.ts"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });
});

describe("validate-trust-crosswalk-citations — Check B (validate-ID resolution)", () => {
  let fx: Fixture;
  afterEach(async () => {
    if (fx) await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("does NOT flag a concrete validate-ID that a check registers verbatim", async () => {
    fx = await makeFixture({
      docBody: "row | `validate` pipeline-timeout | ok\n",
      checkIds: ["pipeline-timeout"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("flags an unwired validate-ID (e.g. legacy `timeouts`)", async () => {
    fx = await makeFixture({
      docBody: "row | `validate` timeouts | broken\n",
      checkIds: ["pipeline-timeout"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("TRUST-CITE-VALIDATE-ID-MISSING");
    expect(findings[0].token).toBe("timeouts");
  });

  it("resolves an asiNN-* glob via a matching check id prefix", async () => {
    fx = await makeFixture({
      docBody: "row | `validate` asi01-* | ok\n",
      checkIds: ["asi01-input-limit"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("resolves an asiNN-* glob via a controlRef when no id prefix matches", async () => {
    // asi03 has no `asi03-` id; it is backed by controlRef ASI03 on a sibling
    // check (asi02-monotonic-privilege in the live codebase).
    fx = await makeFixture({
      docBody: "row | `validate` asi03-* | ok\n",
      checkIds: ["asi02-monotonic-privilege"],
      controlRefs: ["ASI03"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("flags an asiNN-* glob that matches neither an id prefix nor a controlRef", async () => {
    fx = await makeFixture({
      docBody: "row | `validate` asi99-* | broken\n",
      checkIds: ["asi01-input-limit"],
      controlRefs: ["ASI01"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("TRUST-CITE-VALIDATE-ID-MISSING");
    expect(findings[0].token).toBe("asi99-*");
  });

  it("skips prose verbs after `validate` (asserts / self-tests)", async () => {
    fx = await makeFixture({
      docBody: "`validate` asserts the shape; `validate` self-tests the contract.\n",
      checkIds: ["pipeline-timeout"],
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });
});

describe("validate-trust-crosswalk-citations — Check C (file::symbol resolution)", () => {
  let fx: Fixture;
  afterEach(async () => {
    if (fx) await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("does NOT flag a file::symbol whose symbol is a top-level declaration", async () => {
    fx = await makeFixture({
      docBody: "row | `src/adapters/customization.ts::scanForDeniedPatterns` | ok\n",
      srcFiles: ["src/adapters/customization.ts"],
      srcFileContents: {
        "src/adapters/customization.ts":
          "export function scanForDeniedPatterns(content: string): string[] {\n  return [];\n}\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a file::symbol resolved via a bare-basename path", async () => {
    fx = await makeFixture({
      docBody: "row | `selfUpdate.ts::buildInvocation` | ok\n",
      srcFiles: ["src/install/selfUpdate.ts"],
      srcFileContents: {
        "src/install/selfUpdate.ts": "export function buildInvocation() {}\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("does NOT flag a file::symbol that is an object-literal property key", async () => {
    fx = await makeFixture({
      docBody: "row | `src/adapters/index.ts::ADAPTER_CAPABILITIES` | ok\n",
      srcFiles: ["src/adapters/index.ts"],
      srcFileContents: {
        "src/adapters/index.ts": "export const map = {\n  ADAPTER_CAPABILITIES: 1,\n};\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("flags a file::symbol whose symbol is absent (the deleted-symbol class)", async () => {
    // The D15-23 failure mode: add.ts::preflightIntegrityCheck — file resolves,
    // symbol was deleted with the integrity subsystem.
    fx = await makeFixture({
      docBody: "row | `src/cli/commands/add.ts::preflightIntegrityCheck` | broken\n",
      srcFiles: ["src/cli/commands/add.ts"],
      srcFileContents: {
        "src/cli/commands/add.ts": "export async function addCommand() {}\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("TRUST-CITE-SYMBOL-MISSING");
    expect(findings[0].token).toBe("`src/cli/commands/add.ts::preflightIntegrityCheck`");
    expect(findings[0].message).toContain("symbol `preflightIntegrityCheck` is not defined");
  });

  it("flags a file::symbol whose file does not resolve", async () => {
    // A missing rooted path trips both Check A (the path token) and Check C
    // (the symbol citation) — both are legitimate signals for the same root
    // cause. Assert the Check C symbol finding is present, with its file-missing
    // message, rather than that it is the only finding.
    fx = await makeFixture({
      docBody: "row | `src/cli/commands/missing.ts::someFn` | broken\n",
    });
    const findings = await runValidator(fx.rootDir);
    const symbolFinding = findings.find((f) => f.code === "TRUST-CITE-SYMBOL-MISSING");
    expect(symbolFinding).toBeDefined();
    expect(symbolFinding?.message).toContain("does not resolve on disk");
    expect(symbolFinding?.token).toBe("`src/cli/commands/missing.ts::someFn`");
  });

  it("verifies a file::symbol cited in the pack-trust-model doc (Check C spans both docs)", async () => {
    fx = await makeFixture({
      packDocBody: "row | `src/adapters/customization.ts::DENY_PATTERNS` | ok\n",
      srcFiles: ["src/adapters/customization.ts"],
      srcFileContents: {
        "src/adapters/customization.ts": "const DENY_PATTERNS: RegExp[] = [];\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toEqual([]);
  });

  it("attributes a pack-trust-model finding to that doc, not the crosswalk doc", async () => {
    fx = await makeFixture({
      packDocBody: "row | `src/adapters/customization.ts::ghostSymbol` | broken\n",
      srcFiles: ["src/adapters/customization.ts"],
      srcFileContents: {
        "src/adapters/customization.ts": "const DENY_PATTERNS: RegExp[] = [];\n",
      },
    });
    const findings = await runValidator(fx.rootDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].doc).toBe(PACK_TRUST_DOC_REL);
    expect(findings[0].code).toBe("TRUST-CITE-SYMBOL-MISSING");
  });
});

describe("validate-trust-crosswalk-citations — formatFinding", () => {
  it("renders a stable doc:line [code] message string", () => {
    const line = formatFinding({
      level: "error",
      code: "TRUST-CITE-PATH-MISSING",
      doc: DOC_REL,
      line: 42,
      token: "foo.ts",
      message: "cited source path `foo.ts` does not resolve on disk",
    });
    expect(line).toBe(
      `${DOC_REL}:42 [TRUST-CITE-PATH-MISSING] cited source path \`foo.ts\` does not resolve on disk`,
    );
  });

  it("renders the pack-trust-model doc path for a finding sourced there", () => {
    const line = formatFinding({
      level: "error",
      code: "TRUST-CITE-SYMBOL-MISSING",
      doc: PACK_TRUST_DOC_REL,
      line: 7,
      token: "`x.ts::y`",
      message: "cited `x.ts::y` — symbol `y` is not defined in `x.ts`",
    });
    expect(line).toBe(
      `${PACK_TRUST_DOC_REL}:7 [TRUST-CITE-SYMBOL-MISSING] cited \`x.ts::y\` — symbol \`y\` is not defined in \`x.ts\``,
    );
  });
});
