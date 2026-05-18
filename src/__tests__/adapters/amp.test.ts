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

  // Amp reads skills natively from `.agents/skills/` (populated once by
  // copyHatch3rFiles during init/update). The adapter must NOT re-emit them:
  // doing so re-targets the canonical mirror and corrupts SKILL.md
  // frontmatter via the managed-block wrap on safeWriteFile's
  // appendIfNoBlock branch.
  it("does not emit skills (canonical mirror is populated by copyHatch3rFiles)", async () => {
    const manifest = createManifest({
      tools: ["amp"],

    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);

    const skills = outputs.filter(
      (o) => o.path.startsWith(".agents/skills/") || o.path.startsWith(".amp/skills/"),
    );
    expect(skills.length).toBe(0);
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

    const skills = outputs.filter(
      (o) => o.path.startsWith(".agents/skills/") || o.path.startsWith(".amp/skills/"),
    );
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

  // ── Wave 5 (CLI-tooling pivot, plan §4.6) ───────────────────────
  //
  // amp has `cliTools: false` in ADAPTER_CAPABILITIES because it reads
  // canonical skills natively from `.agents/skills/`. The adapter MUST
  // emit zero `hatch3r-cli-*` skill files regardless of `manifest.cliTools`
  // state — the user's selection drives the canonical mirror copy, not amp's
  // adapter output.
  it("emits no CLI skill files even when cliTools is enabled and populated", async () => {
    const manifest = createManifest({
      tools: ["amp"],
      cliTools: { enabled: true, selected: ["ripgrep", "jq", "fd"] },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const cliSkills = outputs.filter((o) => o.path.includes("hatch3r-cli-"));
    expect(cliSkills).toEqual([]);
  });

  it("emits no CLI skill files when cliTools is disabled", async () => {
    const manifest = createManifest({
      tools: ["amp"],
      cliTools: { enabled: false, selected: [] },
    });
    const outputs = await adapter.generate(FIXTURES_DIR, manifest);
    const cliSkills = outputs.filter((o) => o.path.includes("hatch3r-cli-"));
    expect(cliSkills).toEqual([]);
  });
});
