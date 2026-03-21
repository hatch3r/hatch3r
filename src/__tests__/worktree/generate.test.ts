import { describe, it, expect } from "vitest";
import {
  generateWorktreeInclude,
  parseWorktreeInclude,
  ADAPTER_WORKTREE_PATTERNS,
} from "../../worktree/index.js";
import { TOOLS, type HatchManifest, type Tool } from "../../types.js";

/** Minimal manifest factory — only `tools` and `worktree` vary per test. */
function manifest(
  tools: Tool[],
  worktree?: HatchManifest["worktree"],
): HatchManifest {
  return {
    version: "1",
    hatch3rVersion: "1.3.0",
    owner: "test",
    repo: "test",
    namespace: "test",
    project: "test",
    tools,
    features: {
      agents: true,
      skills: false,
      rules: true,
      prompts: false,
      commands: false,
      mcp: false,
      githubAgents: false,
      hooks: false,
    },
    mcp: { servers: [] },
    managedFiles: [],
    worktree,
  };
}

// rootDir is unused by the rewritten function (no isGitIgnored calls), but
// we still pass a valid-ish path to satisfy the signature.
const ROOT = "/tmp/fake-root";

describe("generateWorktreeInclude", () => {
  it("always includes .agents/ and .agents/learnings/", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    expect(out).toContain(".agents/");
    expect(out).toContain(".agents/learnings/");
  });

  it("always includes AGENTS.md", async () => {
    const out = await generateWorktreeInclude(manifest(["gemini"]), ROOT);
    expect(out).toContain("AGENTS.md");
  });

  it("always includes .env patterns", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    expect(out).toContain(".env\n");
    expect(out).toContain(".env.*");
  });

  it("includes Claude adapter patterns for claude tool", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    expect(out).toContain("CLAUDE.md");
    expect(out).toContain(".claude/");
    expect(out).toContain(".mcp.json");
  });

  it("includes Gemini adapter patterns for gemini tool", async () => {
    const out = await generateWorktreeInclude(manifest(["gemini"]), ROOT);
    expect(out).toContain("GEMINI.md");
    expect(out).toContain(".gemini/");
  });

  it("includes union of patterns for multiple tools", async () => {
    const out = await generateWorktreeInclude(manifest(["claude", "gemini"]), ROOT);
    expect(out).toContain("CLAUDE.md");
    expect(out).toContain(".claude/");
    expect(out).toContain(".mcp.json");
    expect(out).toContain("GEMINI.md");
    expect(out).toContain(".gemini/");
  });

  it("includes node_modules by default", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    expect(out).toContain("node_modules/");
  });

  it("omits node_modules when nodeModules is skip", async () => {
    const out = await generateWorktreeInclude(
      manifest(["claude"], { enabled: true, nodeModules: "skip" }),
      ROOT,
    );
    expect(out).not.toContain("node_modules/");
  });

  it("includes extra user-specified patterns", async () => {
    const out = await generateWorktreeInclude(
      manifest(["claude"], { enabled: true, extraPatterns: ["data/", "secrets.json"] }),
      ROOT,
    );
    expect(out).toContain("data/");
    expect(out).toContain("secrets.json");
  });

  it(".agents/ is symlinked and .agents/learnings/ is copied", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    const entries = parseWorktreeInclude(out);
    const agentsEntry = entries.find((e) => e.pattern === ".agents/");
    const learningsEntry = entries.find((e) => e.pattern === ".agents/learnings/");
    expect(agentsEntry?.strategy).toBe("symlink");
    expect(learningsEntry?.strategy).toBe("copy");
  });

  it("adapter output patterns use copy strategy", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    const entries = parseWorktreeInclude(out);
    const claudeEntry = entries.find((e) => e.pattern === ".claude/");
    const claudeMdEntry = entries.find((e) => e.pattern === "CLAUDE.md");
    expect(claudeEntry?.strategy).toBe("copy");
    expect(claudeMdEntry?.strategy).toBe("copy");
  });
});

describe("parseWorktreeInclude round-trip", () => {
  it("parses all generated entries back correctly", async () => {
    const out = await generateWorktreeInclude(manifest(["claude", "gemini"]), ROOT);
    const entries = parseWorktreeInclude(out);

    // Should have: .env, .env.*, .agents/, .agents/learnings/, AGENTS.md,
    // CLAUDE.md, .claude/, .mcp.json, GEMINI.md, .gemini/, node_modules/
    expect(entries.length).toBeGreaterThanOrEqual(11);

    const patterns = entries.map((e) => e.pattern);
    expect(patterns).toContain(".env");
    expect(patterns).toContain(".agents/");
    expect(patterns).toContain("AGENTS.md");
    expect(patterns).toContain("CLAUDE.md");
    expect(patterns).toContain("GEMINI.md");
    expect(patterns).toContain("node_modules/");
  });
});

describe("ADAPTER_WORKTREE_PATTERNS coverage", () => {
  it("has an entry for every tool in TOOLS", () => {
    for (const tool of TOOLS) {
      expect(
        ADAPTER_WORKTREE_PATTERNS[tool],
        `Missing worktree patterns for tool: ${tool}`,
      ).toBeDefined();
      expect(ADAPTER_WORKTREE_PATTERNS[tool].length).toBeGreaterThan(0);
    }
  });
});
