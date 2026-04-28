import { describe, it, expect } from "vitest";
import { AmpAdapter } from "../../adapters/amp.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { resolveTestPath } from "../fixtures.js";

const FIXTURES_DIR = resolveTestPath(import.meta.url, "../fixtures/agents");

describe("AmpAdapter", () => {
  const adapter = new AmpAdapter();

  it("has correct name", () => {
    expect(adapter.name).toBe("amp");
  });

  // Root AGENTS.md is now written exclusively by generateRootAgentsMd() in
  // init/update. The amp adapter no longer emits it (multi-adapter installs
  // were producing duplicate writes).
  it("does not emit AGENTS.md (written by generateRootAgentsMd)", async () => {
    const manifest = createManifest({
      tools: ["amp"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.find((o) => o.path === "AGENTS.md")).toBeUndefined();
  });

  it("does not emit AGENTS.md when rules and agents are disabled either", async () => {
    const manifest = createManifest({
      tools: ["amp"],
      features: { rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    expect(outputs.find((o) => o.path === "AGENTS.md")).toBeUndefined();
  });

  it("generates skill files in .amp/skills/", async () => {
    const manifest = createManifest({
      tools: ["amp"],

    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".agents/skills/"));
    expect(skills.length).toBe(1);

    const skill = skills[0]!;
    expect(skill.path).toContain("hatch3r-");
    expect(skill.path).toMatch(/SKILL\.md$/);
    expect(skill.content).toContain("test-skill");
    expect(skill.managedContent).toBeDefined();
  });

  it("generates .amp/settings.json with MCP config when servers configured", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amp/settings.json");
    expect(settings).toBeDefined();

    const parsed = JSON.parse(settings!.content);
    expect(parsed["amp.mcpServers"]).toBeDefined();
    expect(parsed["amp.mcpServers"].github).toBeDefined();
    expect(parsed["amp.mcpServers"].github.url).toBe("https://api.githubcopilot.com/mcp/");
  });

  it("does not generate MCP settings when no servers configured", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: [],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const settings = outputs.find((o) => o.path === ".amp/settings.json");
    expect(settings).toBeUndefined();
  });

  it("skips skills when features.skills is false", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      features: { skills: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter((o) => o.path.startsWith(".agents/skills/"));
    expect(skills.length).toBe(0);
  });

  it("returns no outputs when all features are disabled and no MCP", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: [],
      features: { skills: false, mcp: false, rules: false, agents: false },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    // With AGENTS.md no longer emitted by amp, no skills, and no MCP servers,
    // the adapter has nothing to write.
    expect(outputs.length).toBe(0);
  });

  it("all outputs have action 'create'", async () => {
    const manifest = createManifest({
      tools: ["amp"],

      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.action).toBe("create");
    }
  });

  // ── Finding 3.16: no empty content assertion ──
  it("produces no empty content in any output", async () => {
    const manifest = createManifest({
      tools: ["amp"],
      mcpServers: ["github"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    for (const o of outputs) {
      expect(o.content.length).toBeGreaterThan(0);
    }
  });
});
