import { describe, it, expect } from "vitest";
import { GooseAdapter } from "../../adapters/goose.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("GooseAdapter", () => {
  const adapter = new GooseAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("goose");
  });

  it("generates .goosehints with rules, agents, and skills", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hints = outputs.find((o) => o.path === ".goosehints");
    expect(hints).toBeDefined();
    expect(hints!.content).toContain(MANAGED_BLOCK_START);
    expect(hints!.content).toContain(MANAGED_BLOCK_END);
    expect(hints!.content).toContain("Hatch3r Agent Instructions");
    expect(hints!.content).toContain("Mandatory Behaviors");
    expect(hints!.content).toContain("test-rule");
    expect(hints!.content).toContain("A test rule for unit testing");
    expect(hints!.content).toContain("Agent: test-agent");
    expect(hints!.content).toContain("A test agent for unit testing");
    expect(hints!.content).toContain("test-skill");
    expect(hints!.managedContent).toBeDefined();
  });

  it("still generates .goosehints with orchestration when rules, agents, and skills are disabled", async () => {
    const manifest = createManifest({
      tools: ["goose"],
      features: { rules: false, agents: false, skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hints = outputs.find((o) => o.path === ".goosehints");
    expect(hints).toBeDefined();
    expect(hints!.content).toContain("Mandatory Behaviors");
    expect(hints!.content).not.toContain("Agent: test-agent");
    expect(hints!.content).not.toContain("test-rule");
    expect(hints!.content).not.toContain("test-skill");
  });

  it("includes skills inline in .goosehints", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hints = outputs.find((o) => o.path === ".goosehints")!;
    expect(hints.content).toContain("Skill:");
    expect(hints.content).toContain("hatch3r-");
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["goose"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const hints = outputs.find((o) => o.path === ".goosehints")!;
    expect(hints.content).not.toContain("Skill:");
  });

  it("produces exactly one output file", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe(".goosehints");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });
});
