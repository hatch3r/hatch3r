import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator } from "../validate-repo-token-adoption.js";
import { REPO_SUBSTITUTION_TOKENS } from "../../src/pipeline/repoSubstitution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "repo-token-adoption-"));
  return { rootDir };
}

async function writeContent(rootDir: string, relPath: string, body: string): Promise<void> {
  const abs = join(rootDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf-8");
}

const TOK_A = "${HATCH3R:TOKEN_A}";
const TOK_B = "${HATCH3R:TOKEN_B}";

describe("validate-repo-token-adoption", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  // ── Happy path ───────────────────────────────────────────────────

  it("PASSes when every token is referenced by at least one content file", async () => {
    await writeContent(fx.rootDir, "agents/hatch3r-a.md", `Run ${TOK_A} now.`);
    await writeContent(fx.rootDir, "rules/hatch3r-b.md", `CI is ${TOK_B}.`);

    const result = await runValidator({
      rootDir: fx.rootDir,
      tokens: [TOK_A, TOK_B],
    });

    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedTokens).toBe(2);
    expect(result.adopterCounts[TOK_A]).toBe(1);
    expect(result.adopterCounts[TOK_B]).toBe(1);
  });

  it("counts a token adopted by both a .md and its .mdc twin", async () => {
    await writeContent(fx.rootDir, "rules/hatch3r-b.md", `CI is ${TOK_B}.`);
    await writeContent(fx.rootDir, "rules/hatch3r-b.mdc", `CI is ${TOK_B}.`);

    const result = await runValidator({ rootDir: fx.rootDir, tokens: [TOK_B] });

    expect(result.errorCount).toBe(0);
    expect(result.adopterCounts[TOK_B]).toBe(2);
  });

  // ── Zero-adopter failure ─────────────────────────────────────────

  it("ERRORs once per token with zero canonical adopters", async () => {
    await writeContent(fx.rootDir, "agents/hatch3r-a.md", `Run ${TOK_A} now.`);
    // TOK_B is never referenced.

    const result = await runValidator({
      rootDir: fx.rootDir,
      tokens: [TOK_A, TOK_B],
    });

    expect(result.errorCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("REPO-TOKEN-ZERO-ADOPTERS");
    expect(result.findings[0].token).toBe(TOK_B);
    expect(result.adopterCounts[TOK_B]).toBe(0);
  });

  // ── src/ and scripts/ are NOT adopters ───────────────────────────

  it("does not count token definitions/tests under src or scripts as adopters", async () => {
    // The token appears only in a src/ file — the mechanism, not a consumer.
    await writeContent(fx.rootDir, "src/pipeline/repoSubstitution.ts", `const X = "${TOK_A}";`);
    await writeContent(fx.rootDir, "scripts/x.ts", `const Y = "${TOK_A}";`);

    const result = await runValidator({ rootDir: fx.rootDir, tokens: [TOK_A] });

    expect(result.errorCount).toBe(1);
    expect(result.findings[0].token).toBe(TOK_A);
    expect(result.adopterCounts[TOK_A]).toBe(0);
  });

  // ── Missing scan dir is skipped, not an error ────────────────────

  it("skips a non-existent scan dir without erroring", async () => {
    await writeContent(fx.rootDir, "agents/hatch3r-a.md", `Run ${TOK_A} now.`);
    // No prompts/ dir exists; it is in DEFAULT_SCAN_DIRS but must not throw.

    const result = await runValidator({ rootDir: fx.rootDir, tokens: [TOK_A] });

    expect(result.errorCount).toBe(0);
    expect(result.adopterCounts[TOK_A]).toBe(1);
  });

  // ── Live-corpus guard (D14-12 regression lock) ───────────────────

  it("PASSes against the live hatch3r corpus — every REPO_SUBSTITUTION_TOKENS member is adopted", async () => {
    const result = await runValidator({ rootDir: REPO_ROOT });

    expect(result.checkedTokens).toBe(REPO_SUBSTITUTION_TOKENS.length);
    expect(result.errorCount).toBe(0);
    for (const t of REPO_SUBSTITUTION_TOKENS) {
      expect(result.adopterCounts[t]).toBeGreaterThanOrEqual(1);
    }
  });
});
