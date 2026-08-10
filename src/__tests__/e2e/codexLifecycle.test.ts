import { afterEach, describe, expect, it } from "vitest";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseToml } from "smol-toml";
import { getAdapter } from "../../adapters/index.js";
import { archiveToolOutputs } from "../../archive/index.js";
import { resolveBundledContentRoot } from "../../content/contentRoot.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { sweepOrphansForAdapter } from "../../merge/orphanCleanup.js";
import { safeWriteFile } from "../../merge/safeWrite.js";
import { applyRollback, createSnapshot } from "../../pipeline/snapshot.js";
import type { AdapterOutput, ContentSelection, HatchManifest } from "../../types.js";

function selection(overrides: Partial<ContentSelection["items"]> = {}): ContentSelection {
  return {
    preset: "custom",
    projectType: "brownfield",
    teamSize: "team",
    items: {
      agents: ["hatch3r-learnings-loader"],
      skills: ["hatch3r-bug-fix"],
      rules: ["hatch3r-git-conventions"],
      commands: ["cmd-hatch3r-ask"],
      prompts: [],
      hooks: ["hatch3r-session-start-learnings"],
      githubAgents: [],
      ...overrides,
    },
  };
}

function manifest(content = selection()): HatchManifest {
  return createManifest({
    tools: ["codex"],
    mcpServers: ["github"],
    content,
    features: { prompts: false, githubAgents: false, handoffs: false },
  });
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function writeOutputs(root: string, outputs: readonly AdapterOutput[]): Promise<void> {
  for (const output of outputs) {
    await safeWriteFile(join(root, output.path), output.content, {
      managedContent: output.managedContent,
      appendIfNoBlock: true,
      force: output.validatedFullDocument,
      backup: output.validatedFullDocument ? false : undefined,
    });
  }
}

describe("Codex full lifecycle and co-tenancy", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("initializes, repeats, updates, removes, rolls back, and archives without touching co-tenants", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-lifecycle-"));
    const canonicalRoot = resolveBundledContentRoot();
    await mkdir(join(root, ".agents/skills/personal"), { recursive: true });
    await mkdir(join(root, ".codex/agents"), { recursive: true });
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".agents/skills/personal/SKILL.md"), "personal skill\n");
    await writeFile(join(root, ".codex/agents/personal.toml"), 'name = "personal"\n');
    await writeFile(
      join(root, ".codex/config.toml"),
      'model = "gpt-5"\n\n[mcp_servers.personal]\nurl = "https://example.com/mcp"\n',
    );
    await writeFile(
      join(root, ".codex/hooks.json"),
      `${JSON.stringify({
        description: "user hooks",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "node user-stop.mjs" }] }],
        },
      }, null, 2)}\n`,
    );
    await writeFile(join(root, "AGENTS.md"), "# User instructions\n\nKeep this paragraph.\n");

    const firstManifest = manifest();
    const adapter = getAdapter("codex");
    const first = await adapter.generate(canonicalRoot, firstManifest, root);
    const firstPaths = first.map((output) => output.path);
    expect(firstPaths).toContain("AGENTS.md");
    expect(firstPaths).toContain(".codex/config.toml");
    expect(firstPaths).toContain(".codex/hooks.json");
    expect(firstPaths.some((path) => path.startsWith(".codex/agents/hatch3r-"))).toBe(true);
    expect(firstPaths).toContain(".agents/skills/hatch3r-bug-fix/SKILL.md");
    expect(firstPaths).toContain(".agents/skills/hatch3r-command-ask/SKILL.md");
    expect(firstPaths.some((path) => path.startsWith(".codex/skills/"))).toBe(false);
    await writeOutputs(root, first);
    firstManifest.managedFiles = [...firstPaths];
    firstManifest.managedFilesByAdapter = { codex: [...firstPaths] };

    const config = await readFile(join(root, ".codex/config.toml"), "utf-8");
    expect(() => parseToml(config)).not.toThrow();
    expect(config).toContain("[mcp_servers.personal]");
    expect(config).toContain('[mcp_servers."github"]');
    const hooks = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf-8"));
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe("node user-stop.mjs");
    expect(JSON.stringify(hooks)).toContain("hatch3r:session-start-learnings");
    expect(await readFile(join(root, "AGENTS.md"), "utf-8")).toContain("Keep this paragraph.");
    const supportRulePath = ".hatch3r/codex-support/rules/hatch3r-git-conventions.md";
    await appendFile(join(root, supportRulePath), "\nUser-owned support note.\n");

    const repeat = await getAdapter("codex").generate(canonicalRoot, firstManifest, root);
    expect(repeat.map(({ path, content }) => ({ path, content }))).toEqual(
      first.map(({ path, content }) => ({ path, content })),
    );
    await writeOutputs(root, repeat);
    expect(await readFile(join(root, supportRulePath), "utf-8")).toContain("User-owned support note.");

    const skillPath = ".agents/skills/hatch3r-bug-fix/SKILL.md";
    await createSnapshot("codex-update", [join(root, skillPath)], { projectRoot: root });
    await mkdir(join(root, ".hatch3r/skills"), { recursive: true });
    await writeFile(
      join(root, ".hatch3r/skills/hatch3r-bug-fix.customize.md"),
      "Use the repository-specific reproduction checklist.",
    );
    const updated = await getAdapter("codex").generate(canonicalRoot, firstManifest, root);
    await writeOutputs(root, updated);
    expect(await readFile(join(root, skillPath), "utf-8")).toContain(
      "repository-specific reproduction checklist",
    );
    const rollback = await applyRollback("codex-update", { projectRoot: root });
    expect(rollback.errors).toEqual([]);
    expect(await readFile(join(root, skillPath), "utf-8")).not.toContain(
      "repository-specific reproduction checklist",
    );

    const reducedManifest = manifest(selection({ skills: [], commands: [] }));
    reducedManifest.managedFilesByAdapter = { codex: [...firstPaths] };
    const reduced = await getAdapter("codex").generate(canonicalRoot, reducedManifest, root);
    await writeOutputs(root, reduced);
    const reducedPaths = reduced.map((output) => output.path);
    const removed = await sweepOrphansForAdapter("codex", root, firstPaths, reducedPaths);
    expect(removed.find((entry) => entry.path === skillPath)?.removed).toBe(true);
    expect(removed.find((entry) => entry.path === ".agents/skills/hatch3r-command-ask/SKILL.md")?.removed).toBe(true);
    expect(await exists(join(root, skillPath))).toBe(false);

    const archived = await archiveToolOutputs(root, "codex", { recordedPaths: reducedPaths });
    expect(archived.archivedFiles.length).toBeGreaterThan(0);
    expect(await readFile(join(root, ".agents/skills/personal/SKILL.md"), "utf-8")).toBe("personal skill\n");
    expect(await readFile(join(root, ".codex/agents/personal.toml"), "utf-8")).toContain("personal");
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8")).toContain("mcp_servers.personal");
    const finalHooks = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf-8"));
    expect(finalHooks.hooks.Stop[0].hooks[0].command).toBe("node user-stop.mjs");
    expect(await readFile(join(root, "AGENTS.md"), "utf-8")).toContain("Keep this paragraph.");
    expect(await readFile(join(root, supportRulePath), "utf-8")).toContain("User-owned support note.");
  }, 120_000);

  it("fails closed before output on malformed shared files and symlinked roots", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-preflight-"));
    const canonicalRoot = resolveBundledContentRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/config.toml"), "[broken\n");
    await expect(getAdapter("codex").generate(canonicalRoot, manifest(), root)).rejects.toThrow(
      /malformed TOML/,
    );

    await rm(join(root, ".codex/config.toml"));
    await writeFile(join(root, "AGENTS.override.md"), "shadow root instructions\n");
    const overrideManifest = manifest();
    overrideManifest.agentsMd = { enabled: true };
    const overrideOutputs = await getAdapter("codex").generate(canonicalRoot, overrideManifest, root);
    expect(overrideOutputs.some((output) => output.path === "AGENTS.override.md")).toBe(true);
    expect(overrideOutputs.some((output) => output.path === "AGENTS.md")).toBe(false);
    await writeOutputs(root, overrideOutputs);
    expect(await readFile(join(root, "AGENTS.override.md"), "utf-8")).toContain("shadow root instructions");
    expect(await readFile(join(root, "AGENTS.override.md"), "utf-8")).toContain("Hatcher Codex instructions");
    expect(await exists(join(root, "AGENTS.md"))).toBe(false);

    await rm(join(root, "AGENTS.override.md"));
    await rm(join(root, ".agents/skills"), { recursive: true, force: true });
    await mkdir(join(root, ".agents"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "hatch3r-codex-outside-"));
    await symlink(outside, join(root, ".agents/skills"));
    await expect(getAdapter("codex").generate(canonicalRoot, manifest(), root)).rejects.toThrow(
      /must be a regular directory/,
    );
    await rm(outside, { recursive: true, force: true });
  }, 120_000);

  it("attributes inline hook TOML to its canonical hook source", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-inline-hooks-"));
    const canonicalRoot = resolveBundledContentRoot();
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/config.toml"), '[[hooks."Stop"]]\nhooks = []\n');

    const outputs = await getAdapter("codex").generate(canonicalRoot, manifest(), root);
    const config = outputs.find((output) => output.path === ".codex/config.toml");
    expect(config).toBeDefined();
    expect(config!.sourceFiles).toEqual([
      join(canonicalRoot, "hooks/hatch3r-session-start.md"),
    ]);
    expect(() => parseToml(config!.content)).not.toThrow();
  }, 120_000);

  it("preserves nested instructions while transitioning the active root instruction file", async () => {
    root = await mkdtemp(join(tmpdir(), "hatch3r-codex-instruction-transition-"));
    const canonicalRoot = resolveBundledContentRoot();
    const rootUser = "# Root user instructions\n\nKeep root bytes.\n";
    const overrideUser = "# User override\n\nKeep override bytes.\n";
    const nestedAgents = "# Package instructions\r\n\r\nDo not normalize this file.\r\n";
    const nestedOverride = "# Nested override\nthird-party-owned\n";
    await mkdir(join(root, "packages", "app", "nested"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), rootUser);
    await writeFile(join(root, "packages", "app", "AGENTS.md"), nestedAgents);
    await writeFile(join(root, "packages", "app", "nested", "AGENTS.override.md"), nestedOverride);

    const activeManifest = manifest();
    const first = await getAdapter("codex").generate(canonicalRoot, activeManifest, root);
    await writeOutputs(root, first);
    const firstPaths = first.map((output) => output.path);
    expect((await readFile(join(root, "AGENTS.md"), "utf-8")).match(/HATCH3R:BEGIN/g)).toHaveLength(1);

    await writeFile(join(root, "AGENTS.override.md"), overrideUser);
    activeManifest.managedFiles = [...firstPaths];
    activeManifest.managedFilesByAdapter = { codex: [...firstPaths] };
    const second = await getAdapter("codex").generate(canonicalRoot, activeManifest, root);
    await writeOutputs(root, second);
    const secondPaths = second.map((output) => output.path);
    await sweepOrphansForAdapter("codex", root, firstPaths, secondPaths);

    expect(await readFile(join(root, "AGENTS.md"), "utf-8")).toBe(rootUser);
    const activeOverride = await readFile(join(root, "AGENTS.override.md"), "utf-8");
    expect(activeOverride).toContain(overrideUser);
    expect(activeOverride.match(/HATCH3R:BEGIN/g)).toHaveLength(1);
    expect(await readFile(join(root, "packages", "app", "AGENTS.md"), "utf-8")).toBe(nestedAgents);
    expect(await readFile(join(root, "packages", "app", "nested", "AGENTS.override.md"), "utf-8"))
      .toBe(nestedOverride);

    await rm(join(root, "AGENTS.override.md"));
    activeManifest.managedFiles = [...secondPaths];
    activeManifest.managedFilesByAdapter = { codex: [...secondPaths] };
    const third = await getAdapter("codex").generate(canonicalRoot, activeManifest, root);
    await writeOutputs(root, third);
    const thirdPaths = third.map((output) => output.path);
    await sweepOrphansForAdapter("codex", root, secondPaths, thirdPaths);

    const restoredRoot = await readFile(join(root, "AGENTS.md"), "utf-8");
    expect(restoredRoot).toContain(rootUser);
    expect(restoredRoot.match(/HATCH3R:BEGIN/g)).toHaveLength(1);
    expect(await exists(join(root, "AGENTS.override.md"))).toBe(false);
    expect(await readFile(join(root, "packages", "app", "AGENTS.md"), "utf-8")).toBe(nestedAgents);
    expect(await readFile(join(root, "packages", "app", "nested", "AGENTS.override.md"), "utf-8"))
      .toBe(nestedOverride);
  }, 120_000);
});
