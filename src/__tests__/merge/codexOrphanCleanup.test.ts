import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_SESSION_START_HOOK_COMMAND } from "../helpers/codexLegacyHookFixture.js";
import { sweepOrphansForAdapter } from "../../merge/orphanCleanup.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (err) { void err; return false; }
}

describe("Codex orphan cleanup", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hatch3r-codex-orphan-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("removes recorded nested companions inside one hatch3r skill and prunes empty parents", async () => {
    const skillRoot = join(root, ".agents/skills/hatch3r-old");
    const paths = [
      ".agents/skills/hatch3r-old/SKILL.md",
      ".agents/skills/hatch3r-old/references/nested/guide.md",
      ".agents/skills/hatch3r-old/scripts/run.sh",
    ];
    for (const path of paths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), path.endsWith("SKILL.md")
        ? "<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\n"
        : "companion\n");
    }
    const result = await sweepOrphansForAdapter("codex", root, paths, []);
    expect(result.every((entry) => entry.removed)).toBe(true);
    expect(await exists(skillRoot)).toBe(false);
  });

  it("subtracts managed content from an exact recorded companion and preserves user content", async () => {
    const rel = ".agents/skills/hatch3r-old/references/guide.md";
    await mkdir(join(root, ".agents/skills/hatch3r-old/references"), { recursive: true });
    await writeFile(
      join(root, rel),
      "User prefix\n<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\nUser suffix\n",
    );

    const [entry] = await sweepOrphansForAdapter("codex", root, [rel], []);

    expect(entry).toMatchObject({ removed: true, reason: "unlinked" });
    expect(await readFile(join(root, rel), "utf-8")).toBe("User prefix\n\nUser suffix\n");
  });

  it("subtracts shared config and hooks while preserving user content", async () => {
    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(join(root, ".codex/config.toml"), 'model = "gpt-5"\n\n# HATCH3R:BEGIN\n[mcp_servers."x"]\ncommand = "x"\n# HATCH3R:END\n');
    const command = LEGACY_SESSION_START_HOOK_COMMAND;
    await writeFile(join(root, ".codex/hooks.json"), JSON.stringify({ hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "user" }] },
      { hooks: [{ type: "command", command, commandWindows: command, statusMessage: "hatch3r:session-start-learnings" }] },
    ] } }));

    const result = await sweepOrphansForAdapter(
      "codex",
      root,
      [".codex/config.toml", ".codex/hooks.json"],
      [],
    );
    expect(result.every((entry) => entry.removed)).toBe(true);
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8")).toBe('model = "gpt-5"\n');
    expect(await readFile(join(root, ".codex/hooks.json"), "utf-8")).toContain('"command": "user"');
  });

  it("subtracts only the managed region from an exact recorded active instruction override", async () => {
    const rel = "AGENTS.override.md";
    await writeFile(
      join(root, rel),
      "User prefix\n<!-- HATCH3R:BEGIN -->\nmanaged\n<!-- HATCH3R:END -->\nUser suffix\n",
    );

    const [entry] = await sweepOrphansForAdapter("codex", root, [rel], []);

    expect(entry).toMatchObject({ removed: true, reason: "unlinked" });
    expect(await readFile(join(root, rel), "utf-8")).toBe("User prefix\n\nUser suffix\n");
  });

  it("classifies malformed shared-file validation as read-failed before mutation", async () => {
    await mkdir(join(root, ".codex"), { recursive: true });
    const malformed = '# HATCH3R:BEGIN\nmodel = "x"\n';
    await writeFile(join(root, ".codex/config.toml"), malformed);
    const [entry] = await sweepOrphansForAdapter("codex", root, [".codex/config.toml"], []);
    expect(entry).toMatchObject({ removed: false, reason: "read-failed" });
    expect(entry?.error).toContain("broken or duplicate");
    expect(await readFile(join(root, ".codex/config.toml"), "utf-8")).toBe(malformed);
    expect(await readdir(join(root, ".codex"))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("quarantine")]),
    );
  });

  it("preserves symlinks and their external targets", async () => {
    const outside = join(root, "outside.md");
    await writeFile(outside, "foreign\n");
    const rel = ".agents/skills/hatch3r-old/references/guide.md";
    await mkdir(join(root, ".agents/skills/hatch3r-old/references"), { recursive: true });
    await symlink(outside, join(root, rel));
    const [entry] = await sweepOrphansForAdapter("codex", root, [rel], []);
    expect(entry).toMatchObject({ removed: false, reason: "symlink-skipped" });
    expect(await readFile(outside, "utf-8")).toBe("foreign\n");
  });

  it("does not let Codex provenance remove another adapter's output", async () => {
    const rel = ".cursor/rules/hatch3r-foreign.mdc";
    await mkdir(join(root, ".cursor/rules"), { recursive: true });
    await writeFile(join(root, rel), "foreign\n");
    const [entry] = await sweepOrphansForAdapter("codex", root, [rel], []);
    expect(entry).toMatchObject({ removed: false, reason: "outside-adapter-root" });
    expect(await exists(join(root, rel))).toBe(true);
  });
});
