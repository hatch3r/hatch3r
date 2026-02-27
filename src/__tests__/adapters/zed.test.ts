import { describe, it, expect } from "vitest";
import { ZedAdapter } from "../../adapters/zed.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("ZedAdapter", () => {
  const adapter = new ZedAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("zed");
  });

  it("generates .rules with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".rules");
    expect(rules).toBeDefined();
    expect(rules!.content).toContain(MANAGED_BLOCK_START);
    expect(rules!.content).toContain(MANAGED_BLOCK_END);
    expect(rules!.content).toContain("Hatch3r Agent Instructions");
    expect(rules!.content).toContain("Mandatory Behaviors");
    expect(rules!.content).toContain("test-rule");
    expect(rules!.content).toContain("A test rule for unit testing");
    expect(rules!.content).toContain("Agent: test-agent");
    expect(rules!.content).toContain("A test agent for unit testing");
    expect(rules!.managedContent).toBeDefined();
  });

  it("still generates .rules with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const rules = outputs.find((o) => o.path === ".rules");
    expect(rules).toBeDefined();
    expect(rules!.content).toContain("Mandatory Behaviors");
    expect(rules!.content).not.toContain("Agent: test-agent");
    expect(rules!.content).not.toContain("test-rule");
  });

  it("produces exactly one output file", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".rules");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["zed"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("returns only .rules when all features are disabled", async () => {
    const manifest = createManifest({
      tools: ["zed"],
      features: { skills: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".rules");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });
});
