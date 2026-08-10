import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeClean, type CleanInventory } from "../../clean/index.js";
import { LEGACY_SESSION_START_HOOK_COMMAND } from "../helpers/codexLegacyHookFixture.js";

describe("Codex hook clean lifecycle", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hatch3r-codex-hook-clean-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("removes only the exact prior Hatcher handler and preserves user hooks", async () => {
    await mkdir(join(root, ".codex"), { recursive: true });
    const hooksPath = join(root, ".codex/hooks.json");
    await writeFile(hooksPath, JSON.stringify({ hooks: { SessionStart: [
      { hooks: [{ type: "command", command: "user" }] },
      { hooks: [{
        type: "command",
        command: LEGACY_SESSION_START_HOOK_COMMAND,
        commandWindows: LEGACY_SESSION_START_HOOK_COMMAND,
        statusMessage: "hatch3r:session-start-learnings",
      }] },
    ] } }));
    const manifest = {
      managedFilesByAdapter: { codex: [".codex/hooks.json"] },
    } as unknown as NonNullable<CleanInventory["manifest"]>;
    const inventory = {
      adapterFiles: [".codex/hooks.json"], manifestPresent: false, archiveDir: false,
      hatch3rDir: false, worktreeInclude: false, envMcp: false,
      agentsMdHasUserContent: false, isWorkspaceRoot: false, isWorkspaceMember: false,
      workspaceRootPath: null, manifest,
    } satisfies CleanInventory;

    const result = await executeClean(root, inventory, false);
    expect(result.errors).toEqual([]);
    const cleaned = JSON.parse(await readFile(hooksPath, "utf-8"));
    expect(cleaned.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: "user" }] }]);
  });
});
