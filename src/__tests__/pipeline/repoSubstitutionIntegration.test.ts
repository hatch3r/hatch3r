/**
 * C9-H47 (D14-SA14.4-H01): integration coverage for sync-time substitution
 * tokens. Verifies:
 *
 *   1. Adapter output carries RESOLVED values when canonical content uses
 *      `${HATCH3R:LINTER}` / `${HATCH3R:TEST_FRAMEWORK}` / `${HATCH3R:CI_PROVIDER}`.
 *   2. Adapter output falls back to the `"unknown"` sentinel when the
 *      manifest carries no detection context (pre-1.8.0 manifest shape).
 *   3. Canonical SOURCE files under the `agents/` content root remain
 *      UNCHANGED on disk after adapter generation — the substitution is
 *      output-time only, never an in-place rewrite of the canonical layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeAdapter } from "../../adapters/claude.js";
import { CursorAdapter } from "../../adapters/cursor.js";
import { createManifest } from "../../manifest/hatchJson.js";
import type { HatchManifest } from "../../types.js";

const TOKEN_RULE_BODY = [
  "# Test Rule",
  "",
  "Run `${HATCH3R:LINTER}` before committing.",
  "Tests run via `${HATCH3R:TEST_FRAMEWORK}`.",
  "CI: `${HATCH3R:CI_PROVIDER}`.",
].join("\n");

const TOKEN_RULE_MD = [
  "---",
  "id: detection-tokens-rule",
  "type: rule",
  "description: Rule body exercising HATCH3R detection tokens",
  "scope: always",
  "---",
  TOKEN_RULE_BODY,
  "",
].join("\n");

const TOKEN_AGENT_MD = [
  "---",
  "id: detection-tokens-agent",
  "type: agent",
  "description: Agent body exercising HATCH3R detection tokens",
  "---",
  "# Detection Tokens Agent",
  "",
  "Operate on this project's stack:",
  "- Linter: `${HATCH3R:LINTER}`",
  "- Test framework: `${HATCH3R:TEST_FRAMEWORK}`",
  "- CI provider: `${HATCH3R:CI_PROVIDER}`",
  "",
].join("\n");

async function buildFixture(): Promise<{ rootDir: string; agentsDir: string; rulesDir: string; rulePath: string; agentPath: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "hatch3r-h47-"));
  const agentsDir = join(rootDir, ".agents");
  const rulesDir = join(agentsDir, "rules");
  const agentsContentDir = join(agentsDir, "agents");
  await mkdir(rulesDir, { recursive: true });
  await mkdir(agentsContentDir, { recursive: true });
  const rulePath = join(rulesDir, "detection-tokens-rule.md");
  const agentPath = join(agentsContentDir, "detection-tokens-agent.md");
  await writeFile(rulePath, TOKEN_RULE_MD);
  await writeFile(agentPath, TOKEN_AGENT_MD);
  return { rootDir, agentsDir, rulesDir, rulePath, agentPath };
}

function manifestWithDetection(detected: HatchManifest["detected"]): HatchManifest {
  return {
    ...createManifest({
      tools: ["claude"],
      mcpServers: [],
      detected,
    }),
  };
}

describe("C9-H47 sync-time substitution — adapter integration", () => {
  let fx: Awaited<ReturnType<typeof buildFixture>>;

  beforeEach(async () => {
    fx = await buildFixture();
  });

  afterEach(async () => {
    await rm(fx.rootDir, { recursive: true, force: true });
  });

  it("ClaudeAdapter replaces all three tokens in rule output", async () => {
    const adapter = new ClaudeAdapter();
    const manifest = manifestWithDetection({
      linters: ["eslint"],
      testFrameworks: ["vitest"],
      ciProviders: ["github-actions"],
    });

    const outputs = await adapter.generate(fx.agentsDir, manifest);

    const rule = outputs.find((o) => o.path.endsWith("detection-tokens-rule.md"));
    expect(rule).toBeDefined();
    expect(rule!.content).toContain("Run `eslint` before committing.");
    expect(rule!.content).toContain("Tests run via `vitest`.");
    expect(rule!.content).toContain("CI: `github-actions`.");
    // Negative: no raw tokens leak into the generated artifact.
    expect(rule!.content).not.toContain("${HATCH3R:LINTER}");
    expect(rule!.content).not.toContain("${HATCH3R:TEST_FRAMEWORK}");
    expect(rule!.content).not.toContain("${HATCH3R:CI_PROVIDER}");
  });

  it("ClaudeAdapter replaces tokens in agent output", async () => {
    const adapter = new ClaudeAdapter();
    const manifest = manifestWithDetection({
      linters: ["biome"],
      testFrameworks: ["jest", "playwright"],
      ciProviders: ["circleci"],
    });

    const outputs = await adapter.generate(fx.agentsDir, manifest);

    const agent = outputs.find((o) => o.path.endsWith("detection-tokens-agent.md"));
    expect(agent).toBeDefined();
    expect(agent!.content).toContain("Linter: `biome`");
    // Multi-value rendering: comma-separated.
    expect(agent!.content).toContain("Test framework: `jest, playwright`");
    expect(agent!.content).toContain("CI provider: `circleci`");
  });

  it("CursorAdapter replaces tokens in rule output", async () => {
    const adapter = new CursorAdapter();
    const manifest = manifestWithDetection({
      linters: ["prettier"],
      testFrameworks: ["mocha"],
      ciProviders: ["gitlab-ci"],
    });

    const outputs = await adapter.generate(fx.agentsDir, manifest);

    const rule = outputs.find((o) => o.path.includes("detection-tokens-rule"));
    expect(rule).toBeDefined();
    expect(rule!.content).toContain("Run `prettier` before committing.");
    expect(rule!.content).toContain("Tests run via `mocha`.");
    expect(rule!.content).toContain("CI: `gitlab-ci`.");
    expect(rule!.content).not.toContain("${HATCH3R:LINTER}");
  });

  it("falls back to 'unknown' when manifest has no detection block", async () => {
    const adapter = new ClaudeAdapter();
    // Build a manifest WITHOUT a `detected` block — emulates a pre-1.8.0
    // manifest that ran init before C9-H47 landed.
    const manifest = createManifest({ tools: ["claude"], mcpServers: [] });
    expect(manifest.detected).toBeUndefined();

    const outputs = await adapter.generate(fx.agentsDir, manifest);

    const rule = outputs.find((o) => o.path.endsWith("detection-tokens-rule.md"));
    expect(rule).toBeDefined();
    expect(rule!.content).toContain("Run `unknown` before committing.");
    expect(rule!.content).toContain("Tests run via `unknown`.");
    expect(rule!.content).toContain("CI: `unknown`.");
  });

  it("leaves canonical source on disk UNCHANGED after adapter generation", async () => {
    const adapter = new ClaudeAdapter();
    const manifest = manifestWithDetection({
      linters: ["eslint"],
      testFrameworks: ["vitest"],
      ciProviders: ["github-actions"],
    });

    // Snapshot canonical content before generation.
    const ruleBefore = await readFile(fx.rulePath, "utf-8");
    const agentBefore = await readFile(fx.agentPath, "utf-8");

    await adapter.generate(fx.agentsDir, manifest);

    // Canonical files on disk MUST be byte-identical — the substitution
    // happens only on the adapter-output stream.
    const ruleAfter = await readFile(fx.rulePath, "utf-8");
    const agentAfter = await readFile(fx.agentPath, "utf-8");
    expect(ruleAfter).toBe(ruleBefore);
    expect(agentAfter).toBe(agentBefore);

    // Sanity: raw tokens persist verbatim in the canonical source.
    expect(ruleAfter).toContain("${HATCH3R:LINTER}");
    expect(ruleAfter).toContain("${HATCH3R:TEST_FRAMEWORK}");
    expect(ruleAfter).toContain("${HATCH3R:CI_PROVIDER}");
    expect(agentAfter).toContain("${HATCH3R:LINTER}");
  });
});
