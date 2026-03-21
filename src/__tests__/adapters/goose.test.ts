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
    expect(hints!.content).not.toContain("Skill: hatch3r-test-skill");
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

  it("produces .goosehints and profile output files", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const paths = outputs.map((o) => o.path);
    expect(paths).toContain(".goosehints");
    expect(paths).toContain(".goose/profiles/hatch3r.yaml");
    expect(outputs.length).toBe(2);
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

  it("generates profile with recipe and ACP configuration", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    expect(profile!.content).toContain("name: hatch3r");
    expect(profile!.content).toContain("hatch3r-pipeline");
    expect(profile!.content).toContain("Research");
    expect(profile!.content).toContain("Implement");
    expect(profile!.content).toContain("Review");
    expect(profile!.content).toContain("Quality");
  });

  it("profile includes ACP configuration", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    expect(profile!.content).toContain("acp:");
    expect(profile!.content).toContain("enabled: true");
    expect(profile!.content).toContain("version: \"0.2\"");
    expect(profile!.content).toContain("code-generation");
    expect(profile!.content).toContain("code-review");
  });

  it("profile recipe references agents from fixtures", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    // The fixture has test-agent which does not match pipeline patterns,
    // so recipe steps should use fallback instructions.
    expect(profile!.content).toContain("Gather context from the codebase");
    expect(profile!.content).toContain("Implement the requested changes");
  });

  it("profile omits extensions when no MCP servers configured", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    // Default manifest has no MCP servers selected, so extensions should not appear.
    expect(profile!.content).not.toContain("extensions:");
  });

  it("ACP capabilities include tool-use when MCP is enabled", async () => {
    const manifest = createManifest({
      tools: ["goose"],
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const profile = outputs.find((o) => o.path === ".goose/profiles/hatch3r.yaml");
    expect(profile).toBeDefined();
    // MCP feature is enabled by default, so tool-use capability should be present.
    expect(profile!.content).toContain("tool-use");
  });
});
