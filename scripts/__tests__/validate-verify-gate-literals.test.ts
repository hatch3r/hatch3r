import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runValidator, findBareGateBlocks } from "../validate-verify-gate-literals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// ── Fixture helpers ────────────────────────────────────────────────

interface Fixture {
  rootDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "verify-gate-literals-"));
  return { rootDir };
}

async function writeContent(rootDir: string, relPath: string, body: string): Promise<void> {
  const abs = join(rootDir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf-8");
}

const fence = (lang: string, ...lines: string[]) => ["```" + lang, ...lines, "```"].join("\n");

describe("findBareGateBlocks (unit)", () => {
  it("flags a bare npm gate-triple block with no token", () => {
    const body = ["# Verify", "", fence("bash", "npm run lint && npm run typecheck && npm run test")].join("\n");
    const findings = findBareGateBlocks(body, "skills/x/SKILL.md");
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("VERIFY-GATE-LITERAL-NPM");
    expect(findings[0].command).toBe("npm run lint");
  });

  it("flags a bare `npm test` and `npx tsc` gate line", () => {
    expect(findBareGateBlocks(fence("bash", "npm test"), "a.md")).toHaveLength(1);
    expect(findBareGateBlocks(fence("sh", "npx tsc --noEmit"), "a.md")).toHaveLength(1);
  });

  it("does NOT flag a block that already carries a VERIFY_GATE token", () => {
    // The literal line beside the token is the documented resolver fallback,
    // not a competing operative gate — this is the post-sweep shape.
    const body = fence(
      "bash",
      "${HATCH3R:VERIFY_GATE_ALL}",
    );
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(0);
  });

  it("does NOT flag a fallback note that mentions npm in the SAME block as the token", () => {
    const body = fence(
      "bash",
      "# fallback: npm run lint && npm run typecheck && npm run test",
      "${HATCH3R:VERIFY_GATE_ALL}",
    );
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(0);
  });

  it("does NOT flag pnpm / yarn / bun gate commands (word-boundary guard)", () => {
    // `pnpm run test` contains the substring `npm run test`; the regex must
    // not match it — these are already package-manager-correct.
    expect(findBareGateBlocks(fence("bash", "pnpm run lint && pnpm run test"), "a.md")).toHaveLength(0);
    expect(findBareGateBlocks(fence("bash", "yarn test"), "a.md")).toHaveLength(0);
    expect(findBareGateBlocks(fence("bash", "bun run test"), "a.md")).toHaveLength(0);
  });

  it("does NOT flag npm publish/build tooling that has no token equivalent", () => {
    const body = fence(
      "bash",
      "npm run build",
      "npm run validate",
      "npm audit --audit-level=moderate",
      "npx lockfile-lint --type npm --path package-lock.json",
    );
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(0);
  });

  it("does NOT flag prose or inline-code mentions of npm gates (only fenced blocks)", () => {
    const body = "Run `npm run test` after editing, or `npm run lint` for style.";
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(0);
  });

  it("emits a single finding per block even with multiple bare gate lines", () => {
    const body = fence("bash", "npm run lint", "npm run typecheck", "npm run test");
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(1);
  });

  it("tolerates a `$ ` shell prompt prefix on the gate line", () => {
    expect(findBareGateBlocks(fence("console", "$ npm run test"), "a.md")).toHaveLength(1);
  });

  it("does NOT flag a commented-out npm gate when no operative gate line exists", () => {
    // A `# npm run test` comment is documentation, not a runnable gate — the
    // command token does not start at the line's command position.
    const body = fence("bash", "# legacy: npm run test", "echo done");
    expect(findBareGateBlocks(body, "a.md")).toHaveLength(0);
  });
});

describe("validate-verify-gate-literals (fixture integration)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("PASSes when the operative gate uses the token", async () => {
    await writeContent(
      fx.rootDir,
      "skills/hatch3r-x/SKILL.md",
      ["# X", "", "## Verify", "", fence("bash", "${HATCH3R:VERIFY_GATE_ALL}")].join("\n"),
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("ERRORs once per offending block, citing file + line", async () => {
    await writeContent(
      fx.rootDir,
      "commands/hatch3r-y.md",
      ["# Y", "", fence("bash", "npm run lint && npm run typecheck && npm run test")].join("\n"),
    );
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(1);
    expect(result.findings[0].code).toBe("VERIFY-GATE-LITERAL-NPM");
    expect(result.findings[0].file).toBe("commands/hatch3r-y.md");
    expect(result.findings[0].line).toBe(3); // opening fence line
  });

  it("scans both .md and .mdc twins", async () => {
    await writeContent(fx.rootDir, "rules/hatch3r-z.md", fence("bash", "npm run test"));
    await writeContent(fx.rootDir, "rules/hatch3r-z.mdc", fence("bash", "npm run test"));
    const result = await runValidator({ rootDir: fx.rootDir });
    expect(result.errorCount).toBe(2);
  });

  it("skips a non-existent scan dir without erroring", async () => {
    await writeContent(fx.rootDir, "agents/hatch3r-ok.md", fence("bash", "${HATCH3R:VERIFY_GATE_ALL}"));
    const result = await runValidator({ rootDir: fx.rootDir, scanDirs: ["agents", "prompts"] });
    expect(result.errorCount).toBe(0);
  });
});

describe("validate-verify-gate-literals (live corpus)", () => {
  it("PASSes against the live hatch3r corpus — no operative gate hard-codes npm (D16-4)", async () => {
    const result = await runValidator({ rootDir: REPO_ROOT });
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.errorCount).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});
