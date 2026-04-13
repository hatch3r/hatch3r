import { describe, it, expect } from "vitest";
import { AgentsMdAdapter } from "../../adapters/agentsmd.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AgentsMdAdapter", () => {
  const adapter = new AgentsMdAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("agents-md");
  });

  it("generates a single AGENTS.md at project root", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe("AGENTS.md");
  });

  it("wraps content in managed blocks", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const agentsMd = outputs[0]!;
    expect(agentsMd.content).toContain(MANAGED_BLOCK_START);
    expect(agentsMd.content).toContain(MANAGED_BLOCK_END);
    expect(agentsMd.managedContent).toBeDefined();
  });

  it("includes the Agents header", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.content).toContain("# Agents");
  });

  it("includes agent sections when agents feature is enabled", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const content = outputs[0]!.content;
    expect(content).toContain("## Agent: test-agent");
    expect(content).toContain("A test agent for unit testing");
    expect(content).toContain("### Instructions");
  });

  it("includes rule sections when rules feature is enabled", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const content = outputs[0]!.content;
    expect(content).toContain("## Rules");
    expect(content).toContain("### test-rule");
    expect(content).toContain("A test rule for unit testing");
  });

  it("includes skill sections when skills feature is enabled", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const content = outputs[0]!.content;
    expect(content).toContain("## Skills");
    expect(content).toContain("### test-skill");
  });

  it("excludes agents when features.agents is false", async () => {
    const manifest = createManifest({
      tools: ["agents-md"],
      features: { agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.content).not.toContain("## Agent:");
  });

  it("excludes rules when features.rules is false", async () => {
    const manifest = createManifest({
      tools: ["agents-md"],
      features: { rules: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.content).not.toContain("## Rules");
  });

  it("excludes skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["agents-md"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.content).not.toContain("## Skills");
  });

  it("still produces AGENTS.md when all features are disabled", async () => {
    const manifest = createManifest({
      tools: ["agents-md"],
      features: { agents: false, rules: false, skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(1);
    expect(outputs[0]!.path).toBe("AGENTS.md");
    expect(outputs[0]!.content).toContain("# Agents");
    expect(outputs[0]!.content).toContain("Mandatory Behaviors");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("produces no empty content", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });

  it("includes model annotation when agent has a model configured", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // The test-agent fixture has a customization file with model: claude-sonnet-4-6
    const content = outputs[0]!.content;
    expect(content).toContain("**Model:**");
  });

  it("includes hatch3r attribution in standard mode", async () => {
    const manifest = createManifest({ tools: ["agents-md"] });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.content).toContain("hatch3r");
  });
});
