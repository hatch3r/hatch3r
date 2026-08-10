import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveToolOutputs, collectToolFiles } from "../../archive/index.js";
import { codexHookCommand } from "../../adapters/codexHooks.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (err) { void err; return false; }
}

describe("Codex archive co-tenancy", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hatch3r-codex-archive-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("discovers only the managed skill entrypoint and archives exact recorded companions", async () => {
    const managedRoot = join(root, ".agents/skills/hatch3r-feature");
    const foreignRoot = join(root, ".agents/skills/hatch3r-personal");
    const thirdPartyRoot = join(root, ".agents/skills/vendor");
    await mkdir(join(managedRoot, "references"), { recursive: true });
    await mkdir(foreignRoot, { recursive: true });
    await mkdir(thirdPartyRoot, { recursive: true });
    await writeFile(join(managedRoot, "SKILL.md"), "<!-- HATCH3R:BEGIN -->\nbody\n<!-- HATCH3R:END -->\n");
    await writeFile(join(managedRoot, "references/guide.md"), "companion\n");
    await writeFile(join(foreignRoot, "SKILL.md"), "user-owned\n");
    await writeFile(join(thirdPartyRoot, "SKILL.md"), "vendor-owned\n");
    const recorded = [
      ".agents/skills/hatch3r-feature/SKILL.md",
      ".agents/skills/hatch3r-feature/references/guide.md",
    ];

    expect(await collectToolFiles(root, "codex")).toEqual([
      ".agents/skills/hatch3r-feature/SKILL.md",
    ]);
    const result = await archiveToolOutputs(root, "codex", { recordedPaths: recorded });
    expect(result.archivedFiles.sort()).toEqual(recorded.sort());
    expect(await exists(managedRoot)).toBe(false);
    expect(await readFile(join(foreignRoot, "SKILL.md"), "utf-8")).toBe("user-owned\n");
    expect(await readFile(join(thirdPartyRoot, "SKILL.md"), "utf-8")).toBe("vendor-owned\n");
  });

  it("leaves an unrecorded hatch3r-looking skill untouched", async () => {
    const skill = join(root, ".agents/skills/hatch3r-unrecorded/SKILL.md");
    await mkdir(join(root, ".agents/skills/hatch3r-unrecorded"), { recursive: true });
    await writeFile(skill, "<!-- HATCH3R:BEGIN -->\nbody\n<!-- HATCH3R:END -->\n");
    const result = await archiveToolOutputs(root, "codex");
    expect(result.archivedFiles).toEqual([]);
    expect(await exists(skill)).toBe(true);
  });

  it("does not infer ownership of unrecorded descendants from a recorded SKILL.md", async () => {
    const skillRoot = join(root, ".agents/skills/hatch3r-feature");
    const skill = join(skillRoot, "SKILL.md");
    const userCompanion = join(skillRoot, "references/user-notes.md");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(skill, "<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\n");
    await writeFile(userCompanion, "user-owned companion\n");

    const result = await archiveToolOutputs(root, "codex", {
      recordedPaths: [".agents/skills/hatch3r-feature/SKILL.md"],
    });

    expect(result.archivedFiles).toEqual([".agents/skills/hatch3r-feature/SKILL.md"]);
    expect(await readFile(userCompanion, "utf-8")).toBe("user-owned companion\n");
  });

  it("subtracts a recorded skill block while preserving and rescuing user customization", async () => {
    const rel = ".agents/skills/hatch3r-feature/SKILL.md";
    const skill = join(root, rel);
    await mkdir(join(root, ".agents/skills/hatch3r-feature"), { recursive: true });
    await writeFile(skill, [
      "---",
      "name: hatch3r-feature",
      "description: generated",
      "---",
      "<!-- HATCH3R:BEGIN -->",
      "managed",
      "<!-- HATCH3R:END -->",
      "User-specific follow-up.",
      "",
    ].join("\n"));

    const result = await archiveToolOutputs(root, "codex", { recordedPaths: [rel] });

    expect(result.archivedFiles).toEqual([rel]);
    expect(await readFile(skill, "utf-8")).toContain("User-specific follow-up.");
    expect(await readFile(skill, "utf-8")).not.toContain("HATCH3R:BEGIN");
    expect(await readFile(join(root, ".hatch3r/skills/feature.customize.md"), "utf-8"))
      .toContain("User-specific follow-up.");
  });

  it("archives then subtracts only Codex-owned shared config, hooks, and instructions", async () => {
    await mkdir(join(root, ".codex"), { recursive: true });
    const config = [
      '# user config — Grüße',
      'model = "gpt-5"',
      '',
      '# HATCH3R:BEGIN',
      '[mcp_servers."context7"]',
      'command = "npx"',
      '# HATCH3R:END',
      '',
    ].join("\n");
    await writeFile(join(root, ".codex/config.toml"), config);

    const command = codexHookCommand("session-start-learnings");
    const hooks = {
      description: "user",
      hooks: { SessionStart: [
        { hooks: [{ type: "command", command: "user-command" }] },
        { hooks: [{ type: "command", command, commandWindows: command, statusMessage: "hatch3r:session-start-learnings" }] },
      ] },
    };
    await writeFile(join(root, ".codex/hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`);
    await writeFile(root + "/AGENTS.md", "User preface\n<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\nUser suffix\n");

    const result = await archiveToolOutputs(root, "codex");
    expect(result.archivedFiles.sort()).toEqual([".codex/config.toml", ".codex/hooks.json", "AGENTS.md"].sort());
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8")).toBe('# user config — Grüße\nmodel = "gpt-5"\n');
    const remainingHooks = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf-8"));
    expect(remainingHooks.hooks.SessionStart).toHaveLength(1);
    expect(remainingHooks.hooks.SessionStart[0].hooks[0].command).toBe("user-command");
    expect(await readFile(join(root, "AGENTS.md"), "utf-8")).toBe("User preface\n\nUser suffix\n");

    const archiveRoot = join(root, ".hatch3r-archive/codex");
    const entries = await readdir(archiveRoot, { recursive: true });
    expect(entries.some((entry) => String(entry).endsWith("config.toml"))).toBe(true);
  });

  it("archives an exact recorded active override and preserves user bytes outside its managed region", async () => {
    const rel = "AGENTS.override.md";
    await writeFile(
      join(root, rel),
      "User override prefix\n<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\nUser override suffix\n",
    );
    await writeFile(join(root, "AGENTS.md"), "Inactive user instructions\n");

    const result = await archiveToolOutputs(root, "codex", { recordedPaths: [rel] });

    expect(result.archivedFiles).toEqual([rel]);
    expect(await readFile(join(root, rel), "utf-8")).toBe(
      "User override prefix\n\nUser override suffix\n",
    );
    expect(await readFile(join(root, "AGENTS.md"), "utf-8")).toBe("Inactive user instructions\n");
  });

  it("does not discover an unrecorded user-only active override as Hatcher-owned", async () => {
    await writeFile(join(root, "AGENTS.override.md"), "User-only active instructions\n");

    expect(await collectToolFiles(root, "codex")).not.toContain("AGENTS.override.md");
    const result = await archiveToolOutputs(root, "codex");
    expect(result.archivedFiles).toEqual([]);
    expect(await readFile(join(root, "AGENTS.override.md"), "utf-8")).toBe(
      "User-only active instructions\n",
    );
  });

  it("does not follow a symlinked shared config", async () => {
    const outside = join(root, "outside.toml");
    await writeFile(outside, '# HATCH3R:BEGIN\nmodel = "outside"\n# HATCH3R:END\n');
    await mkdir(join(root, ".codex"), { recursive: true });
    await symlink(outside, join(root, ".codex/config.toml"));
    const result = await archiveToolOutputs(root, "codex");
    expect(result.archivedFiles).toEqual([]);
    expect(await readFile(outside, "utf-8")).toContain("outside");
  });
});
