import { describe, it, expect, afterEach, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// D1-SA1.10-01 (Cycle 12, Critical): regression coverage for the PUBLISHED
// npm layout. Since the 1.9.0 `files: ["dist/", ...]` cut, an installed
// package keeps canonical content ONLY under `<pkgRoot>/dist/content` — the
// package root itself has no agents/ or skills/ dirs. Workspace sync used to
// build its content index from `findPackageRoot(__dirname)` (the bare package
// root), so every installed execution scanned nonexistent dirs and silently
// produced an empty index: empty member `content.items`, universal-floor
// invariant off, 0-token dry-run estimates. All other workspace tests run
// against the dev checkout, where top-level agents/ exists and masks the bug;
// this file closes that blind spot by simulating the installed layout
// byte-for-byte (same dir set `scripts/copy-content.ts` stages into the
// tarball) and driving `syncWorkspaceRepos` end-to-end against it.
//
// The mock below is why this lives in its own file: redirecting
// `findPackageRoot` is module-graph-wide per test file, and the tests in
// `sync.test.ts` depend on the real implementation.

const published = vi.hoisted(() => ({ pkgRoot: "" }));

vi.mock("../../cli/shared/paths.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../cli/shared/paths.js")>();
  return {
    // Passthrough until the fixture is built, then pin every package-root
    // walk-up to the simulated `<tmp>/node_modules/hatch3r` install.
    findPackageRoot: (startDir: string): string =>
      published.pkgRoot !== "" ? published.pkgRoot : real.findPackageRoot(startDir),
  };
});

import { HATCH3R_DIR, DEFAULT_FEATURES } from "../../types.js";
import type { ContentSelection } from "../../types.js";
import {
  createWorkspaceManifest,
  writeWorkspaceManifest,
} from "../../workspace/manifest.js";
import { syncWorkspaceRepos } from "../../workspace/sync.js";
import { __resetCacheForTests } from "../../content/contentRoot.js";
import type { WorkspaceDefaults } from "../../workspace/types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Mirrors SOURCE_DIRS in `scripts/copy-content.ts` (postbuild) — the exact
// dir set staged into `dist/content/` for the published tarball. Dirs absent
// from the source checkout (e.g. prompts/, policy/) are skipped there too.
const SOURCE_DIRS = [
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "prompts",
  "github-agents",
  "mcp",
  "checks",
  "policy",
] as const;

describe("workspace sync — published npm layout (D1-SA1.10-01)", () => {
  let tempDir: string;

  afterEach(async () => {
    // Undo the simulated install before teardown so no other resolution in
    // this worker can observe the fixture root or a stale cached root.
    published.pkgRoot = "";
    __resetCacheForTests();
    // Windows-safe teardown — same rationale as sync.test.ts: fs.rm retries
    // ENOTEMPTY/EBUSY/EPERM while git/adapter file handles drain.
    if (tempDir) await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  const baseContent: ContentSelection = {
    preset: "minimal",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: ["hatch3r-researcher", "hatch3r-implementer", "hatch3r-reviewer", "hatch3r-security"],
      skills: [],
      // hatch3r-agent-orchestration carries floor:protocol (non-excludable per
      // D16-2); hatch3r-git-conventions is a non-floor cosmetic rule — the
      // pair proves the universal-floor invariant is ON in the installed
      // layout (pre-fix, the empty index left `unconditionalIds` empty and
      // the floor rule was strippable in every real install).
      rules: ["hatch3r-agent-orchestration", "hatch3r-git-conventions"],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
  };

  const defaults: WorkspaceDefaults = {
    platform: "github",
    tools: ["cursor"],
    features: { ...DEFAULT_FEATURES },
    mcp: { servers: [] },
    content: baseContent,
  };

  it("builds the member selection from dist/content when no top-level content dirs exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ws-published-"));

    // --- Simulated `npm i hatch3r` tree: content lives ONLY under dist/content.
    const pkgRoot = join(tempDir, "node_modules", "hatch3r");
    const distContent = join(pkgRoot, "dist", "content");
    for (const name of SOURCE_DIRS) {
      const src = join(REPO_ROOT, name);
      if (!existsSync(src)) continue;
      await cp(src, join(distContent, name), { recursive: true });
    }
    await writeFile(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "hatch3r", version: "0.0.0-test", files: ["dist/", "README.md", "LICENSE"] }),
    );
    // Layout invariant that makes this fixture a real regression probe: the
    // package root must NOT contain top-level content dirs, otherwise a
    // package-root index would be vacuously non-empty.
    expect(existsSync(join(pkgRoot, "agents"))).toBe(false);
    expect(existsSync(join(pkgRoot, "skills"))).toBe(false);

    // --- Workspace with one opted-in member repo.
    const wsRoot = join(tempDir, "ws");
    await mkdir(join(wsRoot, HATCH3R_DIR), { recursive: true });
    const apiDir = join(wsRoot, "api");
    await mkdir(apiDir, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: apiDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: apiDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: apiDir, stdio: "pipe" });

    const wsManifest = createWorkspaceManifest("test", defaults, [
      {
        path: "api",
        name: "api",
        sync: true,
        overrides: {
          contentOverrides: {
            // Attempt to exclude BOTH a floor rule and a non-floor rule.
            exclude: ["hatch3r-agent-orchestration", "hatch3r-git-conventions"],
          },
        },
      },
    ], "manual");
    await writeWorkspaceManifest(wsRoot, wsManifest);

    // Point every package-root resolution at the simulated install and drop
    // the process-cached bundled root so resolution re-runs against it.
    published.pkgRoot = pkgRoot;
    __resetCacheForTests();

    // Failure mode 3 (pre-fix): dry-run token estimate was 0 in every install.
    const dryRun = await syncWorkspaceRepos(wsRoot, { dryRun: true });
    expect(dryRun.repos).toHaveLength(1);
    expect(dryRun.repos[0].action).toBe("dry-run");
    expect(dryRun.repos[0].estimatedTokens).toBeGreaterThan(0);

    const result = await syncWorkspaceRepos(wsRoot);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].action).toBe("synced");

    const raw = await readFile(join(apiDir, HATCH3R_DIR, "hatch.json"), "utf-8");
    const manifest = JSON.parse(raw);

    // Failure mode 1 (pre-fix): member manifests were written with all-empty
    // `content.items` — the selected agents never reached members.
    expect(manifest.content.items.agents).toEqual(
      expect.arrayContaining(baseContent.items.agents),
    );

    // Failure mode 2 (pre-fix): `unconditionalIds` was empty, so a per-repo
    // exclude could strip floor-tagged artifacts. D16-2 semantics must hold
    // in the installed layout: floor rule retained, non-floor rule excluded.
    expect(manifest.content.items.rules).toContain("hatch3r-agent-orchestration");
    expect(manifest.workspace.excludedContent).not.toContain("hatch3r-agent-orchestration");
    expect(manifest.content.items.rules).not.toContain("hatch3r-git-conventions");
    expect(manifest.workspace.excludedContent).toContain("hatch3r-git-conventions");
    // Windows runners run the corpus copy + real git init + real adapter
    // generation ~5-10x slower than macOS; give the same headroom as the
    // parallel-sync tests in sync.test.ts.
  }, 90_000);
});
