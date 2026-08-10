import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HatchManifest } from "../../types.js";
import {
  ADAPTER_WORKTREE_PATTERNS,
  WORKTREE_RECEIPT_RELPATH,
  generateWorktreeInclude,
  parseWorktreeInclude,
  setupWorktree,
} from "../../worktree/index.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (err) { void err; return false; }
}

function manifest(): HatchManifest {
  return {
    version: "3.0.0",
    hatch3rVersion: "test",
    owner: "test",
    repo: "test",
    namespace: "test",
    project: "test",
    tools: ["codex"],
    features: {
      agents: true, skills: true, rules: true, prompts: false, commands: true,
      mcp: true, githubAgents: false, hooks: true, handoffs: true,
    },
    mcp: { servers: [] },
    managedFiles: [],
    worktree: { enabled: true, nodeModules: "skip" },
  };
}

describe("Codex worktree isolation", () => {
  let main: string;
  let target: string;
  beforeEach(async () => {
    main = await mkdtemp(join(tmpdir(), "hatch3r-codex-wt-main-"));
    target = await mkdtemp(join(tmpdir(), "hatch3r-codex-wt-target-"));
    execFileSync("git", ["init", "-q"], { cwd: main });
  });
  afterEach(async () => {
    await rm(main, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });

  it("declares exact managed surfaces without broad .agents or .codex trees", async () => {
    const content = await generateWorktreeInclude(manifest(), main);
    const patterns = parseWorktreeInclude(content).map((entry) => entry.pattern);
    expect(patterns).toEqual(expect.arrayContaining([
      ".agents/skills/hatch3r-*/",
      ".codex/agents/hatch3r-*.toml",
      ".codex/config.toml",
      ".codex/hooks.json",
      ".codex/hatch3r/hooks/hatch3r-*.mjs",
      ".hatch3r/codex-support/",
      "AGENTS.md",
      "AGENTS.override.md",
    ]));
    expect(patterns).not.toContain(".agents/");
    expect(patterns).not.toContain(".codex/");
    expect(ADAPTER_WORKTREE_PATTERNS.codex.every((entry) => entry.strategy === "copy")).toBe(true);
  });

  it("copies managed/shared Codex files while excluding foreign agent and skill trees", async () => {
    await mkdir(join(main, ".agents/skills/hatch3r-feature"), { recursive: true });
    await mkdir(join(main, ".agents/skills/vendor"), { recursive: true });
    await mkdir(join(main, ".codex/agents"), { recursive: true });
    await mkdir(join(main, ".codex/hatch3r/hooks"), { recursive: true });
    await mkdir(join(main, ".hatch3r/codex-support/rules"), { recursive: true });
    await writeFile(join(main, ".agents/skills/hatch3r-feature/SKILL.md"), "managed skill\n");
    await writeFile(join(main, ".agents/skills/vendor/SKILL.md"), "foreign skill\n");
    await writeFile(join(main, ".codex/agents/hatch3r-reviewer.toml"), "managed agent\n");
    await writeFile(join(main, ".codex/agents/personal.toml"), "foreign agent\n");
    await writeFile(join(main, ".codex/config.toml"), "user and managed config\n");
    await writeFile(join(main, ".codex/hooks.json"), "{\"hooks\":{}}\n");
    await writeFile(join(main, ".codex/hatch3r/hooks/hatch3r-session.mjs"), "managed hook\n");
    await writeFile(join(main, ".hatch3r/codex-support/rules/hatch3r-safety.md"), "managed support\n");
    await writeFile(join(main, "AGENTS.md"), "user and managed instructions\n");
    await writeFile(join(main, "AGENTS.override.md"), "active user and managed override\n");
    await writeFile(join(main, ".gitignore"), ".agents/\n.codex/\nAGENTS.md\nAGENTS.override.md\n.worktreeinclude\n");
    await writeFile(join(main, ".worktreeinclude"), await generateWorktreeInclude(manifest(), main));

    const result = await setupWorktree(main, target);
    expect(result.errors).toEqual([]);
    expect(await readFile(join(target, ".codex/config.toml"), "utf-8")).toContain("user and managed");
    expect(await exists(join(target, ".agents/skills/hatch3r-feature/SKILL.md"))).toBe(true);
    expect(await exists(join(target, ".codex/agents/hatch3r-reviewer.toml"))).toBe(true);
    expect(await exists(join(target, ".agents/skills/vendor/SKILL.md"))).toBe(false);
    expect(await exists(join(target, ".codex/agents/personal.toml"))).toBe(false);
    expect(await exists(join(target, ".hatch3r/codex-support/rules/hatch3r-safety.md"))).toBe(true);
    expect(await readFile(join(target, "AGENTS.override.md"), "utf-8")).toContain("active user and managed override");
    const receipt = JSON.parse(await readFile(join(target, WORKTREE_RECEIPT_RELPATH), "utf-8")) as {
      entries: Array<{ relPath: string }>;
    };
    expect(receipt.entries).toContainEqual(expect.objectContaining({ relPath: "AGENTS.override.md" }));
  });
});
