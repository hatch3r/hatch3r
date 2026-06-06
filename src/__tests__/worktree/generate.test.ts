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
    hatch3rVersion: "1.4.0",
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
      handoffs: true,
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
  it("always includes .hatch3r/ and .hatch3r/learnings/", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    expect(out).toContain(".hatch3r/");
    expect(out).toContain(".hatch3r/learnings/");
  });

  // Wave 3 (release/1.9.0): root AGENTS.md is no longer emitted.

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

  it("includes Cursor adapter patterns for cursor tool", async () => {
    const out = await generateWorktreeInclude(manifest(["cursor"]), ROOT);
    expect(out).toContain(".cursor/");
  });

  it("includes union of patterns for multiple tools", async () => {
    const out = await generateWorktreeInclude(manifest(["claude", "cursor"]), ROOT);
    expect(out).toContain("CLAUDE.md");
    expect(out).toContain(".claude/");
    expect(out).toContain(".mcp.json");
    expect(out).toContain(".cursor/");
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

  it(".hatch3r/ is symlinked and .hatch3r/learnings/ is copied", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    const entries = parseWorktreeInclude(out);
    const stateEntry = entries.find((e) => e.pattern === ".hatch3r/");
    const learningsEntry = entries.find((e) => e.pattern === ".hatch3r/learnings/");
    expect(stateEntry?.strategy).toBe("symlink");
    expect(learningsEntry?.strategy).toBe("copy");
  });

  // D1-12 (Cycle 11 Wave 2): the auto-sync the worktree-setup flow itself runs
  // rewrites hatch.json/provenance.json/breaker-state via atomic temp+rename,
  // which de-links or clobbers a symlinked `.hatch3r/`. These three must be
  // declared as literal copy overrides AFTER the `.hatch3r/` symlink so the
  // most-specific-match resolver gives each its own regular-file copy.
  it("hatch.json, provenance.json and breaker-state override the .hatch3r/ symlink with copy", async () => {
    const out = await generateWorktreeInclude(manifest(["claude"]), ROOT);
    const entries = parseWorktreeInclude(out);
    const manifestEntry = entries.find((e) => e.pattern === ".hatch3r/hatch.json");
    const provenanceEntry = entries.find((e) => e.pattern === ".hatch3r/provenance.json");
    const breakerEntry = entries.find((e) => e.pattern === ".hatch3r/.breaker-state.jsonl");
    expect(manifestEntry?.strategy).toBe("copy");
    expect(provenanceEntry?.strategy).toBe("copy");
    expect(breakerEntry?.strategy).toBe("copy");
    // Each copy override must appear AFTER the `.hatch3r/` symlink entry so the
    // setupWorktree resolver (last-matching-pattern wins) picks copy for them.
    const symlinkIdx = entries.findIndex((e) => e.pattern === ".hatch3r/");
    expect(symlinkIdx).toBeGreaterThanOrEqual(0);
    for (const p of [".hatch3r/hatch.json", ".hatch3r/provenance.json", ".hatch3r/.breaker-state.jsonl"]) {
      expect(entries.findIndex((e) => e.pattern === p)).toBeGreaterThan(symlinkIdx);
    }
    // The symlink reason no longer claims to share the manifest (it is copied now).
    const stateEntry = entries.find((e) => e.pattern === ".hatch3r/");
    expect(stateEntry?.strategy).toBe("symlink");
    expect(stateEntry?.reason ?? "").not.toContain("manifest");
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
    const out = await generateWorktreeInclude(manifest(["claude", "cursor"]), ROOT);
    const entries = parseWorktreeInclude(out);

    // Wave 3 + Wave 6 (release/1.9.0): no more .agents/ or root AGENTS.md.
    // Should have: .env, .env.*, .hatch3r/, .hatch3r/learnings/, .hatch3r/handoffs/,
    // CLAUDE.md, .claude/, .mcp.json, .cursor/, node_modules/
    expect(entries.length).toBeGreaterThanOrEqual(10);

    const patterns = entries.map((e) => e.pattern);
    expect(patterns).toContain(".env");
    expect(patterns).toContain(".hatch3r/");
    expect(patterns).toContain("CLAUDE.md");
    expect(patterns).toContain(".cursor/");
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
