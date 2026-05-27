import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { HATCH3R_DIR } from "../../types.js";
import { WORKSPACE_MANIFEST_FILE } from "../../workspace/types.js";
import { setVerbose } from "../../cli/shared/ui.js";

/**
 * F1.9-H2 (Cycle 10 D1): detectWorkspaceContext parent-walk depth. The walk
 * cap was raised from a hard-coded 3 to MAX_WORKSPACE_PARENT_WALK (10) so a
 * deeply-nested monorepo member is classified as a member instead of falling
 * through to `standalone`.
 */
describe("detectWorkspaceContext parent-walk depth", () => {
  let tempDir: string;

  afterEach(async () => {
    setVerbose(false);
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  /** Write a workspace manifest marker under `<dir>/.hatch3r/workspace.json`. */
  async function makeWorkspaceRoot(dir: string): Promise<void> {
    await mkdir(join(dir, HATCH3R_DIR), { recursive: true });
    await writeFile(
      join(dir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE),
      JSON.stringify({ version: "1.0.0", name: "ws", repos: [] }),
      "utf-8",
    );
  }

  it("classifies a directory exactly 3 levels below the root as a member (legacy boundary)", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-3lvl-")));
    await makeWorkspaceRoot(tempDir);
    // root/a/b/c — c is 3 levels below root.
    const member = join(tempDir, "a", "b", "c");
    await mkdir(member, { recursive: true });

    const ctx = await detectWorkspaceContext(member);
    expect(ctx.type).toBe("workspace-member");
    expect(ctx.workspaceRoot).toBe(tempDir);
  });

  it("classifies a directory 5 levels below the root as a member (regression: was standalone under the old cap of 3)", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-5lvl-")));
    await makeWorkspaceRoot(tempDir);
    // root/apps/<area>/<name>/src/sub — sub is 5 levels below root, the kind of
    // depth a real apps/<area>/<name>/src/ monorepo layout produces.
    const member = join(tempDir, "apps", "area", "name", "src", "sub");
    await mkdir(member, { recursive: true });

    const ctx = await detectWorkspaceContext(member);
    expect(ctx.type).toBe("workspace-member");
    expect(ctx.workspaceRoot).toBe(tempDir);
  });

  it("emits a verbose() summary naming the search depth when classifying standalone", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-standalone-")));
    // No workspace marker anywhere up the tree.
    const dir = join(tempDir, "a", "b");
    await mkdir(dir, { recursive: true });

    // verbose() writes via console.error (see cli/shared/ui.ts).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setVerbose(true);

    const ctx = await detectWorkspaceContext(dir);
    expect(ctx.type).toBe("standalone");
    const stderrCalls = spy.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(
      stderrCalls.some((line: string) => /workspace\/detect:.*classified standalone.*cap 10/.test(line)),
    ).toBe(true);

    spy.mockRestore();
  });
});
