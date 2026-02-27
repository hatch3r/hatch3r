import { describe, it, expect } from "vitest";
import { AiderAdapter } from "../../adapters/aider.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from "../../types.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AiderAdapter", () => {
  const adapter = new AiderAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("aider");
  });

  it("generates CONVENTIONS.md with rules and agents", async () => {
    const manifest = createManifest({
      tools: ["aider"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const conventions = outputs.find((o) => o.path === "CONVENTIONS.md");
    expect(conventions).toBeDefined();
    expect(conventions!.content).toContain(MANAGED_BLOCK_START);
    expect(conventions!.content).toContain(MANAGED_BLOCK_END);
    expect(conventions!.content).toContain("Hatch3r Agent Instructions");
    expect(conventions!.content).toContain("Mandatory Behaviors");
    expect(conventions!.content).toContain("test-rule");
    expect(conventions!.content).toContain("A test rule for unit testing");
    expect(conventions!.content).toContain("Agent: test-agent");
    expect(conventions!.content).toContain("A test agent for unit testing");
    expect(conventions!.managedContent).toBeDefined();
  });

  it("still generates CONVENTIONS.md with orchestration when rules and agents are disabled", async () => {
    const manifest = createManifest({
      tools: ["aider"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const conventions = outputs.find((o) => o.path === "CONVENTIONS.md");
    expect(conventions).toBeDefined();
    expect(conventions!.content).toContain("Mandatory Behaviors");
    expect(conventions!.content).not.toContain("Agent: test-agent");
    expect(conventions!.content).not.toContain("test-rule");
  });

  it("generates skill files in .aider/skills/", async () => {
    const manifest = createManifest({
      tools: ["aider"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".aider/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["aider"],
      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".aider/skills/"));
    expect(skills.length).toBe(0);
  });

  it("generates .aider.conf.yml with read references", async () => {
    const manifest = createManifest({
      tools: ["aider"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const config = outputs.find((o) => o.path === ".aider.conf.yml");
    expect(config).toBeDefined();
    expect(config!.content).toContain("read:");
    expect(config!.content).toContain("CONVENTIONS.md");
    expect(config!.content).toContain(".agents/AGENTS.md");
    expect(config!.content).toContain("auto-lint: true");
  });

  it("returns CONVENTIONS.md as first output", async () => {
    const manifest = createManifest({
      tools: ["aider"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs[0]!.path).toBe("CONVENTIONS.md");
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["aider"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  it("returns only CONVENTIONS.md and config when all features are disabled", async () => {
    const manifest = createManifest({
      tools: ["aider"],
      features: { skills: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.length).toBe(2);
    expect(outputs[0]!.path).toBe("CONVENTIONS.md");
    expect(outputs[1]!.path).toBe(".aider.conf.yml");
  });
});
