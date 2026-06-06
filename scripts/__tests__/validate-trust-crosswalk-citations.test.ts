import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, formatFinding } from "../validate-trust-crosswalk-citations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const DOC_REL = "governance/audit/domains/D15-trust-reference.md";
const COMPLIANCE_REL = "src/pipeline/complianceVerification.ts";

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

/**
 * Build a minimal repo skeleton: the trust-reference doc, a compliance file
 * registering a known check-ID set, and a `src/` tree containing the modules a
 * test wants to cite.
 */
async function makeFixture(opts: {
  docBody: string;
  checkIds?: string[];
  controlRefs?: string[];
  srcFiles?: string[];
}): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "trust-crosswalk-"));
  await mkdir(join(rootDir, dirname(DOC_REL)), { recursive: true });
  await writeFile(join(rootDir, DOC_REL), opts.docBody, "utf-8");

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
    await writeFile(join(rootDir, rel), "// fixture\n", "utf-8");
  }
  return { rootDir };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("validate-trust-crosswalk-citations — live corpus", () => {
  it("passes against the shipped D15-trust-reference.md (every citation resolves)", async () => {
    const findings = await runValidator(REPO_ROOT);
    expect(findings).toEqual([]);
  });
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

describe("validate-trust-crosswalk-citations — formatFinding", () => {
  it("renders a stable file:line [code] message string", () => {
    const line = formatFinding({
      level: "error",
      code: "TRUST-CITE-PATH-MISSING",
      line: 42,
      token: "foo.ts",
      message: "cited source path `foo.ts` does not resolve on disk",
    });
    expect(line).toBe(
      `${DOC_REL}:42 [TRUST-CITE-PATH-MISSING] cited source path \`foo.ts\` does not resolve on disk`,
    );
  });
});
