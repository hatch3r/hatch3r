import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectWorkspaceContext } from "../../workspace/detect.js";
import { createWorkspaceManifest, writeWorkspaceManifest } from "../../workspace/manifest.js";
import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";
import { WORKSPACE_MANIFEST_FILE } from "../../workspace/types.js";
import type { WorkspaceManifest } from "../../workspace/types.js";
import { setVerbose } from "../../cli/shared/ui.js";

const minimalDefaults: WorkspaceManifest["defaults"] = {
  platform: "github",
  tools: ["cursor"],
  features: { ...DEFAULT_FEATURES },
  mcp: { servers: ["github"] },
  content: {
    preset: "standard",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: ["hatch3r-researcher"],
      skills: [],
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
  },
};

/**
 * Write a VALID workspace manifest under `<dir>/.hatch3r/workspace.json` that
 * registers the given member rel-paths in `repos[]`. D1-31: membership is
 * registration-based, so a manifest with an empty `repos[]` no longer admits
 * arbitrary sub-directories — the registered paths drive classification.
 */
async function makeWorkspaceRoot(dir: string, repoPaths: string[]): Promise<void> {
  const manifest = createWorkspaceManifest(
    "ws",
    minimalDefaults,
    repoPaths.map((p) => ({ path: p, sync: true })),
    "manual",
  );
  await writeWorkspaceManifest(dir, manifest);
}

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

  it("classifies a directory exactly 3 levels below the root as a member (legacy boundary)", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-3lvl-")));
    // root/a/b/c — c is 3 levels below root, registered as a member.
    await makeWorkspaceRoot(tempDir, ["a/b/c"]);
    const member = join(tempDir, "a", "b", "c");
    await mkdir(member, { recursive: true });

    const ctx = await detectWorkspaceContext(member);
    expect(ctx.type).toBe("workspace-member");
    expect(ctx.workspaceRoot).toBe(tempDir);
  });

  it("classifies a directory 5 levels below the root as a member (regression: was standalone under the old cap of 3)", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-5lvl-")));
    // root/apps/<area>/<name>/src/sub — sub is 5 levels below root, the kind of
    // depth a real apps/<area>/<name>/src/ monorepo layout produces. The repo
    // is registered at apps/area/name; sub is nested inside that member.
    await makeWorkspaceRoot(tempDir, ["apps/area/name"]);
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

/**
 * D1-31 (Cycle 11 Wave 3, D1): workspace-member classification is
 * registration-based, not presence-based. A directory under a workspace root is
 * only a member when its rel-path equals — or is nested under — a registered
 * `repos[].path`. Unregistered siblings classify as `standalone` (no false
 * "managed / overwritten on sync" warning); an unreadable manifest degrades to
 * the legacy presence-based verdict so callers never crash.
 */
describe("detectWorkspaceContext registration-based membership (D1-31)", () => {
  let tempDir: string;

  afterEach(async () => {
    setVerbose(false);
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("classifies an unregistered sibling under a workspace root as standalone", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-unreg-")));
    // Workspace registers only `api`; `web` is an unregistered sibling.
    await makeWorkspaceRoot(tempDir, ["api"]);
    const unregistered = join(tempDir, "web");
    await mkdir(unregistered, { recursive: true });

    const ctx = await detectWorkspaceContext(unregistered);
    expect(ctx.type).toBe("standalone");
  });

  it("classifies an exact registered repo path as a member", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-exact-")));
    await makeWorkspaceRoot(tempDir, ["api", "web"]);
    const member = join(tempDir, "api");
    await mkdir(member, { recursive: true });

    const ctx = await detectWorkspaceContext(member);
    expect(ctx.type).toBe("workspace-member");
    expect(ctx.workspaceRoot).toBe(tempDir);
  });

  it("does not treat a path-prefix collision (api-internal vs api) as nested membership", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-prefix-")));
    // Registers `api`; `api-internal` shares a string prefix but is NOT nested
    // under `api/`, so it must classify as standalone (segment-boundary match).
    await makeWorkspaceRoot(tempDir, ["api"]);
    const sibling = join(tempDir, "api-internal");
    await mkdir(sibling, { recursive: true });

    const ctx = await detectWorkspaceContext(sibling);
    expect(ctx.type).toBe("standalone");
  });

  it("degrades to presence-based membership when the manifest is malformed (fail-safe)", async () => {
    tempDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hatch3r-detect-malformed-")));
    // Write a syntactically broken workspace.json: readWorkspaceManifest throws,
    // so confirmRegisteredMember returns "unverifiable" and the classifier keeps
    // the legacy presence-based verdict rather than crashing the caller.
    await mkdir(join(tempDir, HATCH3R_DIR), { recursive: true });
    await writeFile(join(tempDir, HATCH3R_DIR, WORKSPACE_MANIFEST_FILE), "{ not valid json", "utf-8");
    const member = join(tempDir, "api");
    await mkdir(member, { recursive: true });

    const ctx = await detectWorkspaceContext(member);
    expect(ctx.type).toBe("workspace-member");
    expect(ctx.workspaceRoot).toBe(tempDir);
  });
});
